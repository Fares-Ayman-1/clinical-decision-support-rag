"""Post-generation language enforcement — the deterministic backstop for
the answer-in-the-question's-language rule.

The grounded generator carries three language nudges already (system-prompt
rule 9, a named-language note in the user prompt, a native-script
reinforcement line). They are all PROMPT guidance, and gpt-oss:20b still
drifts to English on some Arabic/French questions when the all-English
evidence block dominates the prompt — observed live, repeatedly, and by
its nature intermittent. A prompt cannot make a probabilistic model
deterministic; a post-generation CHECK can. This module detects the
language of what the generator actually wrote and, on mismatch, runs one
bounded rewrite call that translates the user-visible prose into the
question's language.

Grounding safety: the rewrite touches ONLY statement text and limitation
text. Citations are structured fields that never enter the rewrite call,
excerpt quotes stay verbatim-English by contract (they are validated
substrings of the source chunks), and if the rewrite fails in any way —
provider error, wrong statement count, still-wrong language — the
original English answer is returned unchanged. Wrong language is a
usability bug; a dropped or mutated citation would be a safety bug, so
every failure mode falls back to the already-validated answer.
"""

from __future__ import annotations

from dataclasses import replace

from pydantic import BaseModel, Field

from app.llm.provider import LLMProvider
from app.schemas.query import detect_language
from app.services.rag.citation_resolver import ResolvedAnswer

VERSION = "v1"

LANGUAGE_NAMES = {"ar": "Arabic", "fr": "French", "en": "English"}


class LanguageRewrite(BaseModel):
    statements: list[str] = Field(description="Each input statement translated, same order, same count")
    limitations: list[str] = Field(default_factory=list, description="Each input limitation translated, same order, same count")


SYSTEM_PROMPT = """You are a precise clinical translator. You will receive numbered clinical \
statements (and possibly limitations) that were written in the wrong language. Rewrite each one \
in {language}.

RULES:
1. Preserve the meaning EXACTLY — no additions, no omissions, no new medical claims, no advice \
that is not already in the text.
2. Keep clinical precision: numbers, durations, and qualifiers ("may", "should", "in most cases") \
must survive translation with the same strength.
3. Return exactly the SAME NUMBER of statements, in the same order, and the same number of \
limitations.
4. Output the translations only — never commentary, never the originals."""


def statements_need_enforcement(resolved: ResolvedAnswer, target_lang: str) -> bool:
    """True when any user-visible statement is not in the question's
    language. detect_language is script-based for Arabic and lexical for
    French, both computed per statement — a single drifted statement in an
    otherwise-correct answer still reads as broken to the user, so ANY
    mismatch triggers the rewrite of the whole set (one call either way,
    and translating an already-correct statement is a no-op)."""
    if target_lang not in LANGUAGE_NAMES:
        return False
    texts = [s.text for s in resolved.statements] + list(resolved.limitations)
    return any(detect_language(t) != target_lang for t in texts if t.strip())


def enforce_answer_language(
    llm: LLMProvider, resolved: ResolvedAnswer, target_lang: str
) -> tuple[ResolvedAnswer, bool]:
    """Returns (possibly-rewritten answer, whether a rewrite was applied).
    Never raises for enforcement-specific reasons: any failure returns the
    original answer — wrong language beats a lost answer."""
    if not statements_need_enforcement(resolved, target_lang):
        return resolved, False

    language = LANGUAGE_NAMES[target_lang]
    numbered_statements = "\n".join(f"S{i + 1}: {s.text}" for i, s in enumerate(resolved.statements))
    numbered_limitations = "\n".join(f"L{i + 1}: {t}" for i, t in enumerate(resolved.limitations))
    user_prompt = (
        f"Rewrite in {language}.\n\nSTATEMENTS:\n{numbered_statements}"
        + (f"\n\nLIMITATIONS:\n{numbered_limitations}" if numbered_limitations else "")
    )

    try:
        rewrite = llm.complete_structured(
            SYSTEM_PROMPT.format(language=language), user_prompt, LanguageRewrite
        )
    except Exception:  # noqa: BLE001 — deliberate: enforcement must never
        # turn a good-but-English answer into a failed request.
        return resolved, False

    if len(rewrite.statements) != len(resolved.statements):
        return resolved, False
    if resolved.limitations and len(rewrite.limitations) != len(resolved.limitations):
        return resolved, False
    # The rewrite itself must actually be in the target language — a model
    # that echoes the English back would otherwise "pass".
    if any(detect_language(t) != target_lang for t in rewrite.statements if t.strip()):
        return resolved, False

    new_statements = [
        replace(stmt, text=new_text)
        for stmt, new_text in zip(resolved.statements, rewrite.statements)
    ]
    new_limitations = list(rewrite.limitations) if resolved.limitations else resolved.limitations
    return (
        replace(resolved, statements=new_statements, limitations=new_limitations),
        True,
    )
