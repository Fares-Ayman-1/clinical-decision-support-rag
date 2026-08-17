"""Section-aware chunker — ARCHITECTURE.md §6.4, §6.5, PLAN.md Phase 5.

Consumes Phase 4's CleanedDocument and produces the Chunk Store's
authoritative records: one JSON object per chunk, carrying every citation
field (document_id, section_path, page_start/end, ...) so citation
fabrication is structurally impossible downstream (§12.2 — the generator
only ever emits a short evidence_id, never a page number itself).

Chunking rules, in priority order (ARCHITECTURE.md §6.4):
  1. A chunk never crosses a section boundary.
  2. Target token range + overlap from config/chunking.yaml (config A or B).
  3. A section shorter than the target becomes one chunk.
  4. A section longer than target splits at sentence boundaries, with overlap.
  5. A table is always its own chunk, never split, never merged with text.
  6. Chunks under min_chunk_tokens are dropped unless chunk_type ==
     "recommendation".

Paragraph reconstruction hazard (carried forward from Phase 4's R6):
cleaned pages are a flat list of pre-wrapped lines with no surviving
paragraph-break signal (Phase 3's y0/font_sizes are not present in
CleanedDocument — dropped once section assignment is done with them).
Two real failure modes were found by inspecting actual cleaned output
before writing the joiner below, not assumed in the abstract:

  - who_acs_stroke page 0 (cover): "Frameworkfor" / "the care of" /
    "acute coronary syndrome" / "and stroke" — four cover-title fragments
    that must NOT be joined into one run-on sentence.
  - uspstf_cvd_risk's title/author-block page: an interleaved sidebar
    ("Corresponding Author: Alex H." / "Krist, MD, MPH, Virginia" /
    "(B recommendation)" / "Commonwealth University, 830 East" / ...)
    where line order is not real reading order even after Phase 3's
    column-aware sort — a residual layout hazard beyond simple 2-column
    text, not a new bug (docs/corpus-profile.md already documents the
    2-column fix; this is the JAMA title-block layout on top of it).

Both are on pages with LOW section_confidence context (no body prose) or
irregular line lengths. The joiner below is deliberately conservative:
lines are only merged into a running paragraph when the prior line ends
without terminal punctuation AND the next line starts lowercase or with a
clear continuation word — the same guard already proven safe in Phase 4's
dehyphenate_lines. When in doubt, lines stay separate (joined with a
single space, not merged into false sentences) rather than risking a wrong
merge — a chunk with slightly choppier internal spacing is a much smaller
problem than one with fabricated sentence structure.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import pathlib
import re
from dataclasses import dataclass, field

from app.services.ingestion.clean_document import CleanedDocument, CleanedPage
from app.services.ingestion.evidence_grade import extract_evidence_grade

# count_tokens_real falls back to the word-count approximation (R10,
# tokenization.py) until a real tokenizer is registered via set_tokenizer()
# — so this alias is behavior-preserving for existing callers (config A/B
# with no tokenizer registered) while letting the chunking benchmark
# (scripts/chunk_benchmark.py) register a real tokenizer first and get real
# token counts through the exact same call sites, with no signature change.
from app.services.ingestion.tokenization import count_tokens_real as count_tokens

MIN_CHUNK_TOKENS = 40

_SENTENCE_END_RE = re.compile(r'[.!?]["\')\]]?\s*$')
_LOWERCASE_START_RE = re.compile(r"^[a-z]")

# Deliberately narrow. An earlier version matched "recommend(s|ed|ation)?"
# and "should", found by direct inspection to fire on nearly every sentence
# of ordinary WHO guideline prose ("should ensure", "should aim to...") AND
# on unrelated front matter ("...not implied to be endorsed or
# recommended by WHO"). "Should"/"recommend" are this corpus's default
# register, not a useful discriminator. Restricted to unambiguous imperative
# clinical-action language — dosing, administration, explicit contraindication
# — plus the literal USPSTF "RECOMMENDATION" callout marker (verified present
# in data/cleaned/uspstf_cvd_risk.json page 0). This makes "recommendation" a
# rare, high-precision tag rather than the dominant type.
_RECOMMENDATION_KEYWORDS_RE = re.compile(
    r"\bRECOMMENDATION\b|"
    r"\b(contraindicat\w*|do not administer|administer\w*\s+\d|"
    r"initiat\w*\s+(immediately|within)|refer\w*\s+(immediately|urgently)|"
    r"\d+\s*(mg|mcg|g|ml|units?)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ChunkUnit:
    """One packed unit before final Chunk assembly — either a run of joined
    text paragraphs or a single table, always within one section."""

    kind: str  # "text" | "table"
    text: str
    page_start: int
    page_end: int
    section: str | None
    subsection: str | None
    section_path: str
    section_confidence: str
    table_oversized: bool | None = None


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    document_title: str
    organization: str
    publication_year: int | str | None
    source_url: str
    license: str

    section: str | None
    subsection: str | None
    section_path: str
    section_confidence: str

    page_start: int
    page_end: int

    domains: list[str]
    chunk_type: str  # recommendation | guidance | table | background
    evidence_grade: str | None
    recommendation_class: str | None

    text: str
    embedded_text: str
    token_count: int
    content_hash: str

    kb_version: str
    chunking_version: str
    embedding_version: str
    chunking_config: str  # "A" | "B"
    oversized: bool = False


def _join_lines_conservatively(lines: list[str]) -> list[str]:
    """Merge a page's line list into paragraph-like runs. A line is merged
    into the current run only when the current run doesn't already end in
    terminal punctuation and the new line starts lowercase — the same
    "genuine continuation" signal already validated in Phase 4's
    dehyphenate_lines. Anything else starts a new run: this is what keeps
    who_acs_stroke's cover-title fragments and uspstf's interleaved
    title-block sidebar from being fused into nonsense sentences."""
    if not lines:
        return []

    runs: list[str] = [lines[0]]
    for line in lines[1:]:
        prev = runs[-1]
        prev_ends_sentence = bool(_SENTENCE_END_RE.search(prev))
        next_starts_lowercase = bool(_LOWERCASE_START_RE.match(line))
        if not prev_ends_sentence and next_starts_lowercase:
            runs[-1] = f"{prev} {line}"
        else:
            runs.append(line)
    return runs


def _split_into_sentences(paragraph: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", paragraph)
    return [p.strip() for p in parts if p.strip()]


def _build_units(pages: list[CleanedPage]) -> list[ChunkUnit]:
    """Flatten a document's cleaned pages into ChunkUnits, splitting at every
    section_path change, at every table (rule 1 and rule 5), and — critically
    — at every page boundary where the page has no *detected* heading
    (section_confidence != "detected").

    That last split was added after direct inspection of chunked output:
    without it, who_acs_stroke's cover page, copyright page, and legal
    boilerplate page (pages 0-2) all share the identical fallback
    section_path "(no section detected)" and got silently concatenated into
    one chunk — "Frameworkfor the care of acute coronary syndrome and
    stroke Framework for thecare of acute coronary syndrome andstroke ISBN
    978-... Some rights reserved...". These pages have no real evidence
    they're one semantic unit; only a genuinely detected heading (chapters
    that legitimately span many consecutive pages, verified against
    who_acs_stroke's page 23-43 "components of care" chapter) justifies
    merging across a page boundary."""
    units: list[ChunkUnit] = []
    current_lines: list[str] = []
    current_page_start: int | None = None
    current_page_end: int | None = None
    current_meta: tuple[str | None, str | None, str, str] | None = None

    def flush() -> None:
        nonlocal current_lines, current_page_start, current_page_end, current_meta
        if current_lines and current_meta is not None:
            paragraphs = _join_lines_conservatively(current_lines)
            units.append(
                ChunkUnit(
                    kind="text",
                    text="\n\n".join(paragraphs),
                    page_start=current_page_start,  # type: ignore[arg-type]
                    page_end=current_page_end,  # type: ignore[arg-type]
                    section=current_meta[0],
                    subsection=current_meta[1],
                    section_path=current_meta[2],
                    section_confidence=current_meta[3],
                )
            )
        current_lines = []
        current_page_start = None
        current_page_end = None
        current_meta = None

    for page in pages:
        meta = (page.section, page.subsection, page.section_path, page.section_confidence)

        if page.section_confidence != "detected" and current_meta is not None:
            flush()

        for block in page.blocks:
            if block.block_type == "table":
                flush()
                units.append(
                    ChunkUnit(
                        kind="table",
                        text=block.table_markdown or "",
                        page_start=page.page_number,
                        page_end=page.page_number,
                        section=page.section,
                        subsection=page.subsection,
                        section_path=page.section_path,
                        section_confidence=page.section_confidence,
                        table_oversized=block.table_oversized,
                    )
                )
                continue

            if current_meta is not None and current_meta != meta:
                flush()
            current_meta = meta
            if current_page_start is None:
                current_page_start = page.page_number
            current_page_end = page.page_number
            current_lines.append(block.text)  # type: ignore[arg-type]

    flush()
    return units


def _classify_chunk_type(text: str, is_table: bool) -> str:
    if is_table:
        return "table"
    if _RECOMMENDATION_KEYWORDS_RE.search(text):
        return "recommendation"
    return "guidance"


def _pack_text_unit(
    unit: ChunkUnit, target_min: int, target_max: int, overlap_fraction: float
) -> list[str]:
    """Greedily pack a text unit's sentences into chunk texts within
    [target_min, target_max] tokens, carrying trailing-sentence overlap
    forward into the next chunk (rule 4). A unit shorter than target_min
    becomes exactly one chunk, unpadded (rule 3)."""
    sentences: list[str] = []
    for paragraph in unit.text.split("\n\n"):
        sentences.extend(_split_into_sentences(paragraph))
    if not sentences:
        return []

    if count_tokens(unit.text) <= target_max:
        return [unit.text]

    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0
    i = 0
    while i < len(sentences):
        sentence = sentences[i]
        sentence_tokens = count_tokens(sentence)

        # A single sentence longer than target_max on its own. Not
        # currently reachable with configs A/B against the real tokenizer
        # (measured corpus-wide max single-sentence length is 144 real
        # tokens, under B's target_max=250), but the same packing
        # algorithm is shared with chunking_strategies.py's smaller
        # benchmark configs (target_max as low as 140), where this WAS hit
        # and caused a genuine infinite loop: without this guard, an
        # over-budget sentence never fits alongside any non-empty
        # `current`, so it repeatedly triggers a flush whose overlap
        # carryover can reproduce the same `current` it just flushed, and
        # `i` never advances. Fixed here too, at the source, rather than
        # leaving a latent hang in production code merely because today's
        # inputs don't happen to trigger it.
        if sentence_tokens > target_max:
            if current:
                chunks.append(" ".join(current))
                current = []
                current_tokens = 0
            chunks.append(sentence)
            i += 1
            continue

        if current and current_tokens + sentence_tokens > target_max:
            chunks.append(" ".join(current))
            overlap_tokens_budget = round(current_tokens * overlap_fraction)
            overlap_sentences: list[str] = []
            budget = overlap_tokens_budget
            for s in reversed(current):
                t = count_tokens(s)
                # Never force an over-budget sentence into the overlap set
                # (see chunking_strategies.py's _pack_sentences for the
                # full incident writeup — this file's original version had
                # the same "force-include the first candidate anyway"
                # escape hatch, which can reproduce the exact `current` it
                # just flushed and spin forever with `i` never advancing).
                if t > budget:
                    break
                overlap_sentences.insert(0, s)
                budget -= t
                if budget <= 0:
                    break
            current = overlap_sentences
            current_tokens = sum(count_tokens(s) for s in current)
            continue
        current.append(sentence)
        current_tokens += sentence_tokens
        i += 1

    if current:
        chunks.append(" ".join(current))

    return chunks


def chunk_document(
    doc: CleanedDocument,
    config_label: str,
    target_min_tokens: int,
    target_max_tokens: int,
    overlap_fraction: float,
    chunking_version: str,
    kb_version: str,
    embedding_version: str = "TBD (pending Day-2 benchmark)",
) -> list[Chunk]:
    units = _build_units(doc.pages)
    chunks: list[Chunk] = []
    section_counters: dict[str, int] = {}
    # Stable numeric index per distinct section_path, first-seen order —
    # not a truncated name slug. An earlier version used the section
    # name's first letter as the "s{section}" id component; two different
    # sections on the same page sharing a first letter (e.g. "Diagnosis"
    # and "Definitions") would then collide on the exact same chunk_id,
    # since the per-chunk counter is keyed by the full section_path but the
    # id string itself was not. No collision happened to occur in this
    # corpus (checked directly), but chunk_id uniqueness is load-bearing
    # for the whole citation system (ARCHITECTURE.md §12.2 — the Citation
    # Resolver keys off it), so this is fixed at the source rather than
    # left as a latent risk for a future document.
    section_path_index: dict[str, int] = {}

    for unit in units:
        if unit.kind == "table":
            texts = [unit.text]
        else:
            if not unit.text.strip():
                continue
            texts = _pack_text_unit(unit, target_min_tokens, target_max_tokens, overlap_fraction)

        for text in texts:
            if not text.strip():
                continue
            token_count = count_tokens(text)
            chunk_type = _classify_chunk_type(text, is_table=unit.kind == "table")

            if token_count < MIN_CHUNK_TOKENS and chunk_type != "recommendation":
                continue

            section_idx = section_path_index.setdefault(unit.section_path, len(section_path_index) + 1)
            section_key = f"{unit.page_start}:{unit.section_path}"
            n = section_counters.get(section_key, 0) + 1
            section_counters[section_key] = n
            chunk_id = f"{doc.document_id}_p{unit.page_start}_s{section_idx}_c{n}"

            evidence_grade = extract_evidence_grade(text) if doc.has_evidence_grades else None

            embedded_text = f"{doc.document_title} > {unit.section_path}\n\n{text}"
            content_hash = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()

            oversized = unit.kind == "table" and bool(unit.table_oversized)

            chunks.append(
                Chunk(
                    chunk_id=chunk_id,
                    document_id=doc.document_id,
                    document_title=doc.document_title,
                    organization=doc.organization,
                    publication_year=doc.publication_year,
                    source_url=doc.source_url,
                    license=doc.license,
                    section=unit.section,
                    subsection=unit.subsection,
                    section_path=unit.section_path,
                    section_confidence=unit.section_confidence,
                    page_start=unit.page_start,
                    page_end=unit.page_end,
                    domains=list(doc.domain_tags),
                    chunk_type=chunk_type,
                    evidence_grade=evidence_grade,
                    recommendation_class=None,
                    text=text,
                    embedded_text=embedded_text,
                    token_count=token_count,
                    content_hash=content_hash,
                    kb_version=kb_version,
                    chunking_version=chunking_version,
                    embedding_version=embedding_version,
                    chunking_config=config_label,
                    oversized=oversized,
                )
            )

    return chunks


def write_chunks(chunks: list[Chunk], out_path: pathlib.Path) -> pathlib.Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps(dataclasses.asdict(chunk), ensure_ascii=False) + "\n")
    return out_path
