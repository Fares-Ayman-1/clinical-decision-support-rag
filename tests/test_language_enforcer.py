"""Language enforcement — the deterministic backstop for the
answer-in-the-question's-language rule (the generator's prompt nudges are
guidance; gpt-oss:20b still drifts to English intermittently).

Safety contract under test: citations are never touched, and EVERY failure
mode of the rewrite (provider error, count mismatch, English echoed back)
returns the original validated answer unchanged."""

from __future__ import annotations

import pytest

from app.prompts.language_enforcer import (
    LanguageRewrite,
    enforce_answer_language,
    statements_need_enforcement,
)
from app.services.rag.citation_resolver import (
    ResolvedAnswer,
    ResolvedCitation,
    ResolvedStatement,
)


def _citation(evidence_id: str = "E1") -> ResolvedCitation:
    return ResolvedCitation(
        evidence_id=evidence_id, chunk_id="chunk-1", document_id="doc-1",
        document_title="WHO guideline", organization="WHO",
        section_path="Recommendations", page_start=10, page_end=11,
        evidence_grade="strong", source_url="https://example.org", license="CC",
    )


def _answer(texts: list[str], limitations: list[str] | None = None) -> ResolvedAnswer:
    return ResolvedAnswer(
        statements=[ResolvedStatement(text=t, citations=[_citation()]) for t in texts],
        excerpts=[], limitations=limitations or [], conflicts=[], dropped=[],
        fell_back_to_refusal=False,
    )


class _StubLLM:
    def __init__(self, result=None, error=None):
        self._result = result
        self._error = error
        self.calls = 0

    def complete_structured(self, system, user, schema, temperature=0.1):
        self.calls += 1
        if self._error:
            raise self._error
        assert schema is LanguageRewrite
        return self._result


# --------------------------------------------------------------------------
# Drift detection
# --------------------------------------------------------------------------


def test_english_statements_for_arabic_question_need_enforcement():
    answer = _answer(["Stay active and continue daily movement.", "Exercise therapy is recommended."])
    assert statements_need_enforcement(answer, "ar") is True


def test_arabic_statements_for_arabic_question_pass():
    answer = _answer(["حافظ على النشاط واستمر في الحركة اليومية.", "يوصى بالعلاج بالتمارين."])
    assert statements_need_enforcement(answer, "ar") is False


def test_one_drifted_statement_is_enough():
    answer = _answer(["حافظ على النشاط واستمر في الحركة اليومية.", "Exercise therapy is recommended."])
    assert statements_need_enforcement(answer, "ar") is True


def test_english_limitation_inside_arabic_answer_triggers():
    answer = _answer(
        ["حافظ على النشاط واستمر في الحركة اليومية."],
        limitations=["This assessment is based on limited supporting evidence."],
    )
    assert statements_need_enforcement(answer, "ar") is True


def test_english_answer_for_english_question_passes():
    answer = _answer(["Stay active and continue daily movement."])
    assert statements_need_enforcement(answer, "en") is False


def test_unknown_language_never_triggers():
    answer = _answer(["Stay active."])
    assert statements_need_enforcement(answer, "de") is False


# --------------------------------------------------------------------------
# Rewrite application
# --------------------------------------------------------------------------


def test_successful_rewrite_replaces_text_and_keeps_citations():
    answer = _answer(["Stay active.", "Exercise therapy is recommended."], limitations=["Limited evidence."])
    llm = _StubLLM(result=LanguageRewrite(
        statements=["حافظ على النشاط.", "يوصى بالعلاج بالتمارين."],
        limitations=["الأدلة محدودة."],
    ))
    rewritten, applied = enforce_answer_language(llm, answer, "ar")
    assert applied is True
    assert [s.text for s in rewritten.statements] == ["حافظ على النشاط.", "يوصى بالعلاج بالتمارين."]
    assert rewritten.limitations == ["الأدلة محدودة."]
    # Citations survive byte-identical — the rewrite never sees them.
    assert rewritten.statements[0].citations == answer.statements[0].citations
    assert rewritten.statements[1].citations == answer.statements[1].citations


def test_no_drift_means_no_llm_call():
    answer = _answer(["حافظ على النشاط."])
    llm = _StubLLM()
    result, applied = enforce_answer_language(llm, answer, "ar")
    assert applied is False
    assert result is answer
    assert llm.calls == 0


@pytest.mark.parametrize(
    "bad_rewrite",
    [
        # Wrong statement count — a dropped statement is a dropped medical claim.
        LanguageRewrite(statements=["حافظ على النشاط."], limitations=[]),
        # Echoed English back — "rewrite" that changed nothing must not count.
        LanguageRewrite(statements=["Stay active.", "Exercise therapy is recommended."], limitations=[]),
    ],
)
def test_bad_rewrites_fall_back_to_original(bad_rewrite):
    answer = _answer(["Stay active.", "Exercise therapy is recommended."])
    llm = _StubLLM(result=bad_rewrite)
    result, applied = enforce_answer_language(llm, answer, "ar")
    assert applied is False
    assert result is answer


def test_provider_error_falls_back_to_original():
    answer = _answer(["Stay active."])
    llm = _StubLLM(error=RuntimeError("provider down"))
    result, applied = enforce_answer_language(llm, answer, "ar")
    assert applied is False
    assert result is answer
