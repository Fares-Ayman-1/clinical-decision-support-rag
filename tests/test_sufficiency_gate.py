"""Tests for the Sufficiency Gate — PLAN.md Phase 11 completion criterion:
all four states must be reachable in testing.
"""

from __future__ import annotations

from app.services.rag.evidence_pack import EvidenceItem, EvidencePack
from app.services.rag.sufficiency_gate import (
    PROVISIONAL_TAU_HIGH_RRF,
    PROVISIONAL_TAU_LOW_RRF,
    TAU_HIGH_RERANK,
    TAU_LOW_RERANK,
    SufficiencyState,
    evaluate_sufficiency,
)


def _pack(top_rrf: float, support_count: int, domains: tuple[str, ...] = ("cardiovascular",)) -> EvidencePack:
    evidence = [
        EvidenceItem(
            evidence_id=f"E{i}", chunk_id=f"c{i}", text="text", dense_score=0.5,
            bm25_score=1.0, rrf_score=top_rrf if i == 1 else top_rrf * 0.9, rerank_score=None,
        )
        for i in range(1, support_count + 1)
    ]
    return EvidencePack(
        query_id="q1", rewritten_queries=(), predicted_domains=domains,
        evidence=evidence, top_rerank_score=None, top_rrf_score=top_rrf, support_count=support_count,
    )


def test_sufficient_when_high_score_and_enough_support():
    pack = _pack(top_rrf=PROVISIONAL_TAU_HIGH_RRF + 0.01, support_count=3)
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.SUFFICIENT
    assert result.signal_used == "rrf"


def test_partial_when_high_score_but_thin_support():
    pack = _pack(top_rrf=PROVISIONAL_TAU_HIGH_RRF + 0.01, support_count=1)
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.PARTIAL


def test_partial_when_mid_score():
    mid = (PROVISIONAL_TAU_HIGH_RRF + PROVISIONAL_TAU_LOW_RRF) / 2
    pack = _pack(top_rrf=mid, support_count=3)
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.PARTIAL


def test_insufficient_when_low_score_but_domain_matched():
    pack = _pack(top_rrf=PROVISIONAL_TAU_LOW_RRF - 0.001, support_count=1, domains=("cardiovascular",))
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.INSUFFICIENT


def test_out_of_scope_when_low_score_and_no_domain_matched():
    pack = _pack(top_rrf=PROVISIONAL_TAU_LOW_RRF - 0.001, support_count=1, domains=())
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.OUT_OF_SCOPE


def test_uses_rerank_signal_when_available():
    evidence = [
        EvidenceItem(evidence_id="E1", chunk_id="c1", text="t", dense_score=0.5, bm25_score=1.0, rrf_score=0.05, rerank_score=3.0),
    ]
    pack = EvidencePack(
        query_id="q1", rewritten_queries=(), predicted_domains=("cardiovascular",),
        evidence=evidence, top_rerank_score=3.0, top_rrf_score=0.05, support_count=1,
    )
    result = evaluate_sufficiency(pack)
    assert result.signal_used == "rerank"
    assert result.top_score == 3.0


def test_empty_evidence_pack_is_insufficient_or_out_of_scope():
    pack = EvidencePack(
        query_id="q1", rewritten_queries=(), predicted_domains=(),
        evidence=[], top_rerank_score=None, top_rrf_score=0.0, support_count=0,
    )
    result = evaluate_sufficiency(pack)
    assert result.state == SufficiencyState.OUT_OF_SCOPE


def _rerank_pack(top_rerank: float, support_count: int = 3,
                 domains: tuple[str, ...] = ("cardiovascular",)) -> EvidencePack:
    """A pack carrying a real cross-encoder score, so the gate selects the
    'rerank' signal and its fitted thresholds rather than the RRF fallback."""
    evidence = [
        EvidenceItem(
            evidence_id=f"E{i}", chunk_id=f"c{i}", text="text", dense_score=0.5,
            bm25_score=1.0, rrf_score=0.03,
            rerank_score=top_rerank if i == 1 else top_rerank - 1.0,
        )
        for i in range(1, support_count + 1)
    ]
    return EvidencePack(
        query_id="q1", rewritten_queries=(), predicted_domains=domains,
        evidence=evidence, top_rerank_score=top_rerank, top_rrf_score=0.03,
        support_count=support_count,
    )


def test_rerank_signal_is_preferred_over_rrf_when_available():
    result = evaluate_sufficiency(_rerank_pack(TAU_HIGH_RERANK + 1.0))
    assert result.signal_used == "rerank"
    assert result.tau_high == TAU_HIGH_RERANK
    assert result.tau_low == TAU_LOW_RERANK


def test_fitted_rerank_thresholds_reach_all_states():
    """The fitted thresholds must keep every state reachable. A fit that
    collapses the gate to one or two states is a broken fit, not a
    stricter one — this pins that against future re-fitting."""
    assert evaluate_sufficiency(
        _rerank_pack(TAU_HIGH_RERANK + 1.0, support_count=3)
    ).state == SufficiencyState.SUFFICIENT
    # Above tau_low but below tau_high -> PARTIAL.
    assert evaluate_sufficiency(
        _rerank_pack((TAU_HIGH_RERANK + TAU_LOW_RERANK) / 2, support_count=3)
    ).state == SufficiencyState.PARTIAL
    # High score but thin support -> PARTIAL, not SUFFICIENT.
    assert evaluate_sufficiency(
        _rerank_pack(TAU_HIGH_RERANK + 1.0, support_count=1)
    ).state == SufficiencyState.PARTIAL
    assert evaluate_sufficiency(
        _rerank_pack(TAU_LOW_RERANK - 1.0, support_count=3)
    ).state == SufficiencyState.INSUFFICIENT
    assert evaluate_sufficiency(
        _rerank_pack(TAU_LOW_RERANK - 1.0, support_count=3, domains=())
    ).state == SufficiencyState.OUT_OF_SCOPE


def test_fitted_thresholds_are_ordered():
    """tau_low < tau_high, or PARTIAL becomes unreachable and the gate
    silently degrades to a binary answer/refuse decision."""
    assert TAU_LOW_RERANK < TAU_HIGH_RERANK


def test_every_refusing_state_maps_to_a_valid_api_reason_code():
    """Regression: the orchestrator once passed SufficiencyState.value
    straight through as the API's refusal `reason`. 'INSUFFICIENT' is not
    a valid code — the API calls it 'INSUFFICIENT_EVIDENCE' — so every
    real refusal 500'd on RefusalOut validation. It went unnoticed because
    the pre-fitting placeholder thresholds meant no query ever refused.
    """
    from app.schemas.query import RefusalOut
    from app.services.rag.query_orchestrator import REFUSAL_MESSAGES, REFUSAL_REASON_CODES

    refusing_states = (SufficiencyState.INSUFFICIENT, SufficiencyState.OUT_OF_SCOPE)
    for state in refusing_states:
        assert state in REFUSAL_REASON_CODES, f"{state} has no API reason code"
        assert state in REFUSAL_MESSAGES, f"{state} has no refusal message"
        # Messages are language-keyed ('en'/'ar') so refusals come back in
        # the question's language. Every variant must construct without
        # raising — this is exactly what 500'd.
        for lang in ("en", "ar"):
            assert lang in REFUSAL_MESSAGES[state], f"{state} missing {lang} message"
            RefusalOut(reason=REFUSAL_REASON_CODES[state], message=REFUSAL_MESSAGES[state][lang])


def test_cross_lingual_margin_widens_both_rerank_taus():
    """A non-English question is scored through a rewrite (paraphrase
    penalty) or as a raw cross-lingual pair — measured ~3 points below the
    English-fitted taus for the same information need. The margin must
    rescue a score that would refuse under English taus, and the result
    must report the EFFECTIVE taus so traces are self-explaining."""
    from app.services.rag.sufficiency_gate import CROSS_LINGUAL_MARGIN

    # -6.45 was the live top score for a terse Arabic back-pain query whose
    # top-5 evidence was all genuinely on-topic LBP guidance.
    score = TAU_LOW_RERANK - CROSS_LINGUAL_MARGIN + 0.1
    assert evaluate_sufficiency(_rerank_pack(score)).state == SufficiencyState.INSUFFICIENT
    result = evaluate_sufficiency(_rerank_pack(score), cross_lingual=True)
    assert result.state == SufficiencyState.PARTIAL
    assert result.tau_low == TAU_LOW_RERANK - CROSS_LINGUAL_MARGIN
    assert result.tau_high == TAU_HIGH_RERANK - CROSS_LINGUAL_MARGIN


def test_cross_lingual_margin_does_not_shift_rrf_fallback():
    """RRF is rank fusion, not a text-pair score — no penalty to offset."""
    pack = _pack(top_rrf=PROVISIONAL_TAU_LOW_RRF - 0.001, support_count=2)
    result = evaluate_sufficiency(pack, cross_lingual=True)
    assert result.signal_used == "rrf"
    assert result.tau_low == PROVISIONAL_TAU_LOW_RRF
    assert result.state == SufficiencyState.INSUFFICIENT
