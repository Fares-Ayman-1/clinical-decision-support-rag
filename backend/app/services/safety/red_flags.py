"""Red-flag precheck — SPEC.md SAF-6.1/6.2, SAF-2.4.

Runs BEFORE the RAG pipeline (SAF-6.1) so a possible emergency is never
delayed behind retrieval and 4+ LLM calls. Matching is pure regex over
normalized patient text: deterministic, explainable, testable, and
incapable of hallucinating — the opposite of asking a model "is this an
emergency?".

A match sets an urgency FLOOR (SAF-6.2). The Risk Engine may escalate
above the floor; nothing may de-escalate below it. That asymmetry is the
whole safety property, so `apply_floor` is the only way the floor is
consumed and it never returns something lower than what it was given.

Every rule carries the chunk_id it was derived from (SAF-2.4) and that
provenance travels with the match into the API response, so a red-flag
escalation is auditable back to an approved source document rather than
appearing as an unexplained assertion.
"""

from __future__ import annotations

import functools
import pathlib
import re
import unicodedata
from dataclasses import dataclass
from enum import Enum

import yaml

CONFIG_PATH = pathlib.Path(__file__).resolve().parents[4] / "config" / "red_flags.yaml"


class Urgency(str, Enum):
    """Four levels, ordered. Comparison is by rank, never by string, so
    escalation logic cannot be silently broken by renaming a level."""

    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

    @property
    def rank(self) -> int:
        return _URGENCY_RANK[self]


_URGENCY_RANK = {
    Urgency.LOW: 0,
    Urgency.MODERATE: 1,
    Urgency.HIGH: 2,
    Urgency.CRITICAL: 3,
}


@dataclass(frozen=True)
class RuleSource:
    """SAF-2.4 provenance — what approved content this rule came from."""

    chunk_id: str
    document_id: str
    page: int
    section_path: str
    source_excerpt: str


@dataclass(frozen=True)
class RedFlagRule:
    id: str
    label: str
    urgency_floor: Urgency
    rationale: str
    source: RuleSource
    # Compiled matchers. `all_of` groups must every one match; each group
    # is itself a list of alternatives. `any_of` is a single such group.
    groups: tuple[tuple[re.Pattern[str], ...], ...]

    def matches(self, text: str) -> list[str]:
        """Returns the matched substrings (one per group) if EVERY group
        matches, else an empty list. Returning the actual matched text —
        not just True — is what lets the response explain *why* a rule
        fired instead of asserting that it did."""
        hits: list[str] = []
        for group in self.groups:
            hit = None
            for pattern in group:
                m = pattern.search(text)
                if m:
                    hit = m.group(0)
                    break
            if hit is None:
                return []
            hits.append(hit)
        return hits


@dataclass(frozen=True)
class RedFlagMatch:
    rule_id: str
    label: str
    urgency_floor: Urgency
    matched_text: tuple[str, ...]
    source: RuleSource


@dataclass(frozen=True)
class RedFlagResult:
    matches: tuple[RedFlagMatch, ...]
    urgency_floor: Urgency
    rules_version: str

    @property
    def triggered(self) -> bool:
        return bool(self.matches)


def normalize(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace, and normalize
    apostrophe variants. Patient input arrives with smart quotes from
    phones and copy-paste; a rule written with a straight apostrophe must
    still fire on a curly one, or the guard silently misses."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", text).strip().lower()


def _compile_groups(raw: dict) -> tuple[tuple[re.Pattern[str], ...], ...]:
    """A rule is either `any_of` (one group) or `all_of` (several groups,
    each possibly a nested `any_of`)."""
    if "any_of" in raw:
        return (tuple(re.compile(p, re.IGNORECASE) for p in raw["any_of"]),)
    if "all_of" in raw:
        groups = []
        for entry in raw["all_of"]:
            if isinstance(entry, dict) and "any_of" in entry:
                groups.append(tuple(re.compile(p, re.IGNORECASE) for p in entry["any_of"]))
            else:
                groups.append((re.compile(str(entry), re.IGNORECASE),))
        return tuple(groups)
    raise ValueError(f"Rule {raw.get('id')!r} has neither any_of nor all_of")


@functools.lru_cache(maxsize=1)
def load_rules(config_path: str | None = None) -> tuple[tuple[RedFlagRule, ...], str]:
    path = pathlib.Path(config_path) if config_path else CONFIG_PATH
    data = yaml.safe_load(path.read_text(encoding="utf-8"))

    rules = []
    for raw in data.get("rules", []):
        src = raw["source"]
        # SAF-2.4 is enforced here rather than trusted: a rule without
        # complete provenance is a configuration error, not a warning.
        missing = [k for k in ("chunk_id", "document_id", "page", "section_path") if k not in src]
        if missing:
            raise ValueError(f"Rule {raw['id']!r} missing SAF-2.4 provenance fields: {missing}")

        rules.append(
            RedFlagRule(
                id=raw["id"],
                label=raw["label"],
                urgency_floor=Urgency(raw["urgency_floor"]),
                rationale=raw.get("rationale", "").strip(),
                source=RuleSource(
                    chunk_id=src["chunk_id"],
                    document_id=src["document_id"],
                    page=int(src["page"]),
                    section_path=src["section_path"],
                    source_excerpt=src.get("source_excerpt", "").strip(),
                ),
                groups=_compile_groups(raw),
            )
        )
    return tuple(rules), str(data.get("version", "unknown"))


def check_red_flags(patient_text: str, config_path: str | None = None) -> RedFlagResult:
    """The SAF-6.1 precheck. Call this BEFORE the RAG pipeline."""
    rules, version = load_rules(config_path)
    normalized = normalize(patient_text)

    matches = []
    for rule in rules:
        hits = rule.matches(normalized)
        if hits:
            matches.append(
                RedFlagMatch(
                    rule_id=rule.id,
                    label=rule.label,
                    urgency_floor=rule.urgency_floor,
                    matched_text=tuple(hits),
                    source=rule.source,
                )
            )

    floor = Urgency.LOW
    for m in matches:
        if m.urgency_floor.rank > floor.rank:
            floor = m.urgency_floor

    return RedFlagResult(matches=tuple(matches), urgency_floor=floor, rules_version=version)


def apply_floor(assessed: Urgency, floor: Urgency) -> Urgency:
    """SAF-6.2: a red flag sets a floor the Risk Engine may escalate above
    but never fall below. This is the ONLY place the floor is applied, so
    the invariant lives in one testable function rather than being
    re-implemented (and eventually mis-implemented) at each call site."""
    return assessed if assessed.rank >= floor.rank else floor
