"""Tests for backend/app/services/reranking/reranker.py.

The invariant that matters most (PLAN.md Phase 9 completion criterion):
a reranker failure must degrade to RRF/incoming order, never propagate
and take retrieval down. CrossEncoderReranker's exception handling is
tested with a mock model (no real cross-encoder download needed — none
is reachable in this sandbox, PROJECT-STATE.md R12) so the fallback path
itself is verified without depending on network access.
"""

from __future__ import annotations

from app.services.reranking.reranker import CrossEncoderReranker, NullReranker


def test_null_reranker_passthrough_order_and_truncation():
    reranker = NullReranker()
    candidates = [("a", "text a"), ("b", "text b"), ("c", "text c"), ("d", "text d")]
    run = reranker.rerank("query", candidates, top_k=2)

    assert run.rerank_used is False
    assert run.fallback_reason is not None
    assert [r.chunk_id for r in run.results] == ["a", "b"]
    assert all(r.rerank_score is None for r in run.results)
    assert run.results[0].pre_rerank_rank == run.results[0].post_rerank_rank == 1


def test_null_reranker_top_k_larger_than_candidates():
    reranker = NullReranker()
    candidates = [("a", "text a")]
    run = reranker.rerank("query", candidates, top_k=5)
    assert len(run.results) == 1


def _make_cross_encoder_with_mock_model(predict_fn):
    """Bypass __init__'s real CrossEncoder load (network-blocked) by
    constructing the object directly and injecting a fake model with a
    controllable .predict()."""
    reranker = CrossEncoderReranker.__new__(CrossEncoderReranker)
    reranker._timeout_seconds = 3.0

    class FakeModel:
        def predict(self, pairs):
            return predict_fn(pairs)

    reranker._model = FakeModel()
    return reranker


def test_cross_encoder_reranker_reorders_by_score():
    # Lower score for "a", higher for "b", "c" -> expect reorder to b, c, a
    reranker = _make_cross_encoder_with_mock_model(lambda pairs: [0.1, 0.9, 0.5])
    candidates = [("a", "text a"), ("b", "text b"), ("c", "text c")]
    run = reranker.rerank("query", candidates, top_k=3)

    assert run.rerank_used is True
    assert run.fallback_reason is None
    assert [r.chunk_id for r in run.results] == ["b", "c", "a"]
    assert run.results[0].rerank_score == 0.9


def test_cross_encoder_reranker_falls_back_on_model_exception():
    def raises(pairs):
        raise RuntimeError("simulated model failure")

    reranker = _make_cross_encoder_with_mock_model(raises)
    candidates = [("a", "text a"), ("b", "text b")]
    run = reranker.rerank("query", candidates, top_k=2)

    # Must degrade to incoming order, never raise.
    assert run.rerank_used is False
    assert "simulated model failure" in run.fallback_reason
    assert [r.chunk_id for r in run.results] == ["a", "b"]


def test_cross_encoder_reranker_falls_back_on_timeout():
    import time

    def slow_predict(pairs):
        time.sleep(0.05)
        return [1.0] * len(pairs)

    reranker = _make_cross_encoder_with_mock_model(slow_predict)
    reranker._timeout_seconds = 0.01  # force the budget to be exceeded
    candidates = [("a", "text a"), ("b", "text b")]
    run = reranker.rerank("query", candidates, top_k=2)

    assert run.rerank_used is False
    assert "budget" in run.fallback_reason
    assert [r.chunk_id for r in run.results] == ["a", "b"]
