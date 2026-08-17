"""Hand-computed fixture tests for backend/app/services/evaluation/metrics.py.

Per the benchmark plan's verification step: no config's retrieval numbers
are trusted until these pass. A silent bug here would corrupt every row of
the comparison table without any other symptom.
"""

from __future__ import annotations

from app.services.evaluation.metrics import (
    hit_rate_at_k,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    wasted_context_ratio,
)

# Fixture: 5 ranked results, relevant set = {"b", "d"} (2 relevant chunks
# total). Ranked: a(irrelevant), b(relevant), c(irrelevant), d(relevant), e(irrelevant)
RANKED = ["a", "b", "c", "d", "e"]
RELEVANT = {"b", "d"}
IS_RELEVANT = lambda cid: cid in RELEVANT  # noqa: E731
N_RELEVANT = len(RELEVANT)


def test_precision_at_k():
    assert precision_at_k(RANKED, IS_RELEVANT, k=1) == 0.0
    assert precision_at_k(RANKED, IS_RELEVANT, k=2) == 0.5
    assert precision_at_k(RANKED, IS_RELEVANT, k=5) == 2 / 5
    assert precision_at_k([], IS_RELEVANT, k=5) == 0.0


def test_recall_at_k():
    assert recall_at_k(RANKED, IS_RELEVANT, k=1, n_relevant=N_RELEVANT) == 0.0
    assert recall_at_k(RANKED, IS_RELEVANT, k=2, n_relevant=N_RELEVANT) == 0.5
    assert recall_at_k(RANKED, IS_RELEVANT, k=4, n_relevant=N_RELEVANT) == 1.0
    assert recall_at_k(RANKED, IS_RELEVANT, k=10, n_relevant=N_RELEVANT) == 1.0
    assert recall_at_k(RANKED, IS_RELEVANT, k=5, n_relevant=0) == 0.0


def test_hit_rate_at_k():
    assert hit_rate_at_k(RANKED, IS_RELEVANT, k=1) == 0.0
    assert hit_rate_at_k(RANKED, IS_RELEVANT, k=2) == 1.0
    assert hit_rate_at_k(["a", "c", "e"], IS_RELEVANT, k=3) == 0.0


def test_mrr():
    # first relevant hit is at rank 2 (index 1) -> 1/2
    assert mrr(RANKED, IS_RELEVANT) == 0.5
    assert mrr(["a", "c", "e"], IS_RELEVANT) == 0.0
    assert mrr(["b", "a"], IS_RELEVANT) == 1.0


def test_ndcg_at_k_monotonic_bounds():
    # nDCG must be in [0, 1] and a perfect ranking scores 1.0
    perfect = ["b", "d", "a", "c", "e"]
    score = ndcg_at_k(perfect, IS_RELEVANT, k=5, n_relevant=N_RELEVANT)
    assert abs(score - 1.0) < 1e-9

    worst = ["a", "c", "e", "b", "d"]
    worst_score = ndcg_at_k(worst, IS_RELEVANT, k=5, n_relevant=N_RELEVANT)
    assert 0.0 < worst_score < 1.0

    actual_score = ndcg_at_k(RANKED, IS_RELEVANT, k=5, n_relevant=N_RELEVANT)
    assert worst_score <= actual_score <= score


def test_ndcg_ideal_capped_at_n_relevant():
    # only 1 relevant item exists; a ranking that finds it at rank 1
    # should score 1.0 even though k=5 > n_relevant=1 (ideal DCG uses
    # min(n_relevant, k), not k itself)
    ranked = ["x", "a", "b", "c", "d"]
    is_rel = lambda cid: cid == "x"  # noqa: E731
    score = ndcg_at_k(ranked, is_rel, k=5, n_relevant=1)
    assert abs(score - 1.0) < 1e-9


def test_k_sweep_consistency_recall_is_monotonic():
    for k in [1, 3, 5, 10]:
        r = recall_at_k(RANKED, IS_RELEVANT, k=k, n_relevant=N_RELEVANT)
        assert 0.0 <= r <= 1.0
    r1 = recall_at_k(RANKED, IS_RELEVANT, k=1, n_relevant=N_RELEVANT)
    r3 = recall_at_k(RANKED, IS_RELEVANT, k=3, n_relevant=N_RELEVANT)
    r5 = recall_at_k(RANKED, IS_RELEVANT, k=5, n_relevant=N_RELEVANT)
    r10 = recall_at_k(RANKED, IS_RELEVANT, k=10, n_relevant=N_RELEVANT)
    assert r1 <= r3 <= r5 <= r10


def test_wasted_context_ratio():
    token_counts = {"a": 100, "b": 50, "c": 100, "d": 50, "e": 100}
    # top-2: a(100, wasted) + b(50, not wasted) = 150 total, 100 wasted
    ratio = wasted_context_ratio(RANKED, IS_RELEVANT, token_counts, k=2)
    assert abs(ratio - (100 / 150)) < 1e-9

    # all relevant -> 0 wasted
    all_relevant = lambda cid: True  # noqa: E731
    assert wasted_context_ratio(RANKED, all_relevant, token_counts, k=5) == 0.0

    # empty ranked list -> 0.0, not a division error
    assert wasted_context_ratio([], IS_RELEVANT, token_counts, k=5) == 0.0
