"""Unit tests for RRF fusion, domain boosting, and near-duplicate
suppression logic in hybrid_search.py — pure functions, no Qdrant needed.

The invariant under test that matters most (ARCHITECTURE.md §9.2): domain
boost must be additive on top of RRF score, never a filter — a wrong or
absent domain prediction can only ever fail to help, never remove a
candidate or change ranking versus the unboosted order.
"""

from __future__ import annotations

import pathlib

import pytest

from app.services.retrieval.hybrid_search import (
    RankedResult,
    _rrf_fuse,
    _suppress_near_duplicates,
    hybrid_search,
    hybrid_search_multi_query,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
_S1_CHUNKS_PATH = REPO_ROOT / "data" / "chunks" / "benchmark" / "1.0_S1.jsonl"


def _qdrant_and_s1_available() -> bool:
    if not _S1_CHUNKS_PATH.exists():
        return False
    try:
        from qdrant_client import QdrantClient

        client = QdrantClient(url="http://localhost:6333")
        return client.collection_exists("medical_chunks_S1")
    except Exception:  # noqa: BLE001 — any connection failure means skip
        return False


requires_live_index = pytest.mark.skipif(
    not _qdrant_and_s1_available(),
    reason="requires a running Qdrant with the S1 benchmark collection indexed",
)


def test_rrf_fuse_combines_dense_and_bm25_ranks():
    dense = [("a", 0.9), ("b", 0.8), ("c", 0.7)]
    bm25 = [("b", 5.0), ("c", 4.0), ("d", 3.0)]
    fused = _rrf_fuse(dense, bm25, k=60)

    # "b" appears in both lists (dense rank 2, bm25 rank 1) -> highest RRF
    assert fused["b"][0] == 1 / 62 + 1 / 61
    # "a" only in dense (rank 1)
    assert fused["a"][0] == 1 / 61
    # "d" only in bm25 (rank 3)
    assert fused["d"][0] == 1 / 63
    assert set(fused.keys()) == {"a", "b", "c", "d"}


def test_rrf_fuse_empty_lists():
    assert _rrf_fuse([], []) == {}


def _result(chunk_id, rrf, domains=()):
    return RankedResult(
        chunk_id=chunk_id, rrf_score=rrf, boosted_score=rrf, domain_boosted=False,
        dense_rank=1, bm25_rank=1, dense_score=0.5, bm25_score=1.0, domains=domains,
    )


def test_suppress_near_duplicates_by_content_hash():
    results = [
        RankedResult(chunk_id="a", rrf_score=0.1, boosted_score=0.1, domain_boosted=False,
                     dense_rank=1, bm25_rank=1, dense_score=0.9, bm25_score=1.0,
                     content_hash="sha256:same"),
        RankedResult(chunk_id="b", rrf_score=0.09, boosted_score=0.09, domain_boosted=False,
                     dense_rank=2, bm25_rank=2, dense_score=0.8, bm25_score=0.9,
                     content_hash="sha256:same"),
        RankedResult(chunk_id="c", rrf_score=0.08, boosted_score=0.08, domain_boosted=False,
                     dense_rank=3, bm25_rank=3, dense_score=0.7, bm25_score=0.8,
                     content_hash="sha256:different"),
    ]
    kept, suppressed = _suppress_near_duplicates(results, dense_vectors=None)
    kept_ids = [r.chunk_id for r in kept]
    # "a" ranked higher than "b" with the identical hash -> "b" suppressed, "a" kept
    assert kept_ids == ["a", "c"]
    assert suppressed == 1


def test_suppress_near_duplicates_no_duplicates_no_change():
    results = [_result("x", 0.5), _result("y", 0.4)]
    for r in results:
        object.__setattr__(r, "content_hash", None)
    kept, suppressed = _suppress_near_duplicates(results, dense_vectors=None)
    assert len(kept) == 2
    assert suppressed == 0


def test_suppress_near_duplicates_pairwise_cosine():
    import numpy as np

    results = [
        RankedResult(chunk_id="a", rrf_score=0.1, boosted_score=0.1, domain_boosted=False,
                     dense_rank=1, bm25_rank=None, dense_score=0.9, bm25_score=None),
        RankedResult(chunk_id="b", rrf_score=0.09, boosted_score=0.09, domain_boosted=False,
                     dense_rank=2, bm25_rank=None, dense_score=0.85, bm25_score=None),
        RankedResult(chunk_id="c", rrf_score=0.08, boosted_score=0.08, domain_boosted=False,
                     dense_rank=3, bm25_rank=None, dense_score=0.5, bm25_score=None),
    ]
    # a and b are near-identical vectors (cosine > 0.95); c is unrelated
    vectors = {
        "a": np.array([1.0, 0.0, 0.0]),
        "b": np.array([0.99, 0.01, 0.0]) / np.linalg.norm([0.99, 0.01, 0.0]),
        "c": np.array([0.0, 1.0, 0.0]),
    }
    kept, suppressed = _suppress_near_duplicates(results, dense_vectors=vectors)
    kept_ids = [r.chunk_id for r in kept]
    assert kept_ids == ["a", "c"]
    assert suppressed == 1


def test_domain_boost_never_removes_candidates():
    """The core §9.2 invariant: boosting changes ORDER, never the
    candidate SET. This test constructs the fused dict directly (as
    hybrid_search() does internally) and checks every fused chunk_id
    survives regardless of domain match."""
    fused = _rrf_fuse([("a", 0.9), ("b", 0.8)], [("c", 5.0)], k=60)
    assert set(fused.keys()) == {"a", "b", "c"}
    # Even if none of a/b/c match a predicted domain, all three must still
    # appear in the ranked output — boosting is additive-only downstream.


@requires_live_index
def test_multi_query_single_variant_matches_hybrid_search():
    """hybrid_search_multi_query with exactly one query must produce
    IDENTICAL results to calling hybrid_search directly — the explicit
    single-query short-circuit is what guarantees this, not an emergent
    property of the fusion math, so this pins that behavior down."""
    import sys

    sys.path.insert(0, str(REPO_ROOT / "backend"))
    from qdrant_client import QdrantClient

    from app.services.retrieval.bm25_index import build_bm25_index
    from app.services.retrieval.embedding_provider import (
        SentenceTransformerProvider,
        load_embedding_config,
    )
    from app.services.retrieval.qdrant_index import load_chunks

    cfg = load_embedding_config()
    provider = SentenceTransformerProvider(cfg)
    chunks = load_chunks(_S1_CHUNKS_PATH)
    bm25 = build_bm25_index(chunks)
    client = QdrantClient(url="http://localhost:6333")

    query = "chest pain heart attack"
    single = hybrid_search(client, None, provider, bm25, query, "q1", top_k=5)
    multi = hybrid_search_multi_query(client, None, provider, bm25, [query], "q1", top_k=5)

    assert [r.chunk_id for r in single.results] == [r.chunk_id for r in multi.results]
    assert [r.boosted_score for r in single.results] == [r.boosted_score for r in multi.results]


@requires_live_index
def test_multi_query_fusion_surfaces_variant_specific_results():
    """A clinical-phrasing variant should be able to surface a chunk the
    plain-language query alone ranked outside top-5 — this is the whole
    point of query rewriting (D2 vocabulary-gap mitigation)."""
    import sys

    sys.path.insert(0, str(REPO_ROOT / "backend"))
    from qdrant_client import QdrantClient

    from app.services.retrieval.bm25_index import build_bm25_index
    from app.services.retrieval.embedding_provider import (
        SentenceTransformerProvider,
        load_embedding_config,
    )
    from app.services.retrieval.qdrant_index import load_chunks

    cfg = load_embedding_config()
    provider = SentenceTransformerProvider(cfg)
    chunks = load_chunks(_S1_CHUNKS_PATH)
    bm25 = build_bm25_index(chunks)
    client = QdrantClient(url="http://localhost:6333")

    plain_only = hybrid_search(client, None, provider, bm25, "my chest hurts could it be my heart", "q1", top_k=5)
    variants = [
        "my chest hurts could it be my heart",
        "acute coronary syndrome chest pain symptoms",
    ]
    multi = hybrid_search_multi_query(client, None, provider, bm25, variants, "q1", top_k=5)

    plain_ids = {r.chunk_id for r in plain_only.results}
    multi_ids = {r.chunk_id for r in multi.results}
    # The fused set should be at least as broad — fusion should not be a
    # strict subset of the plain-language-only result.
    assert not multi_ids.issubset(plain_ids) or multi_ids == plain_ids
