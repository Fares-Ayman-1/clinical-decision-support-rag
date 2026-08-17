"""Hybrid dense + BM25 retrieval with RRF, domain boost, and near-duplicate
suppression — ARCHITECTURE.md §9.

Pipeline: dense top-25 + BM25 top-25 -> RRF fuse -> domain boost (score
bonus, NEVER a filter — a misrouted domain prediction must cost ranking
quality, never recall, §9.2) -> near-duplicate suppression (§9.5) -> top-k.

This module serves two callers with different needs:
- The chunking benchmark (scripts/evaluate.py) calls hybrid_search() with
  domain boosting disabled (predicted_domains=None) and no chunk metadata
  beyond chunk_id, since it only needs ranked chunk_ids to score against
  section+page labels.
- The MVP serving path (backend/app/api/, once built) calls it with a real
  predicted_domains list from the domain classifier (Phase 10) and gets
  back full RankedResult objects carrying domains/content_hash for the
  Evidence Pack builder and trace panel.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from qdrant_client import QdrantClient

from app.services.retrieval.bm25_index import BM25Index
from app.services.retrieval.embedding_provider import SentenceTransformerProvider
from app.services.retrieval.qdrant_index import search_dense, search_dense_full

DENSE_CANDIDATES = 25
BM25_CANDIDATES = 25
RRF_K = 60
FINAL_TOP_K = 10

# TBD (pending Day-2 tuning) per PLAN.md Phase 8 — "set it to zero if it
# doesn't help" on the dev split. Starting value chosen to be a meaningful
# but not overwhelming nudge: RRF scores from two lists of 25 top out
# around 2/(k+1) ~= 0.033 for a rank-1-in-both hit, so a boost on that
# order can move a boosted candidate a few ranks without ever letting a
# domain match override a much stronger unboosted RRF score outright.
DOMAIN_BOOST = 0.02

DEDUP_COSINE_THRESHOLD = 0.95


@dataclass(frozen=True)
class RankedResult:
    chunk_id: str
    rrf_score: float
    boosted_score: float
    domain_boosted: bool
    dense_rank: int | None
    bm25_rank: int | None
    dense_score: float | None
    bm25_score: float | None
    domains: tuple[str, ...] = ()
    content_hash: str | None = None


@dataclass(frozen=True)
class RetrievalRun:
    query_id: str
    config_id: str | None
    results: list[RankedResult]
    latency_ms: float
    predicted_domains: tuple[str, ...] = ()
    suppressed_duplicate_count: int = 0


def _rrf_fuse(
    dense: list[tuple[str, float]], bm25: list[tuple[str, float]], k: int = RRF_K
) -> dict[str, tuple[float, int | None, int | None, float | None, float | None]]:
    """Returns chunk_id -> (rrf_score, dense_rank, bm25_rank, dense_score, bm25_score)."""
    dense_rank = {cid: i + 1 for i, (cid, _) in enumerate(dense)}
    dense_score = dict(dense)
    bm25_rank = {cid: i + 1 for i, (cid, _) in enumerate(bm25)}
    bm25_score = dict(bm25)

    all_ids = set(dense_rank) | set(bm25_rank)
    out = {}
    for cid in all_ids:
        rrf = 0.0
        if cid in dense_rank:
            rrf += 1.0 / (k + dense_rank[cid])
        if cid in bm25_rank:
            rrf += 1.0 / (k + bm25_rank[cid])
        out[cid] = (rrf, dense_rank.get(cid), bm25_rank.get(cid), dense_score.get(cid), bm25_score.get(cid))
    return out


def _suppress_near_duplicates(
    ranked: list[RankedResult], dense_vectors: dict[str, "np.ndarray"] | None
) -> tuple[list[RankedResult], int]:
    """content_hash equality first (cheap, exact), then pairwise cosine >
    0.95 among survivors if vectors are available — keeping the
    higher-ranked (earlier in `ranked`) chunk in each duplicate group,
    per ARCHITECTURE.md §9.5."""
    import numpy as np

    kept: list[RankedResult] = []
    seen_hashes: set[str] = set()
    suppressed = 0

    for r in ranked:
        if r.content_hash and r.content_hash in seen_hashes:
            suppressed += 1
            continue
        if r.content_hash:
            seen_hashes.add(r.content_hash)
        kept.append(r)

    if not dense_vectors:
        return kept, suppressed

    final: list[RankedResult] = []
    for r in kept:
        vec = dense_vectors.get(r.chunk_id)
        is_dup = False
        if vec is not None:
            for existing in final:
                other = dense_vectors.get(existing.chunk_id)
                if other is None:
                    continue
                cosine = float(np.dot(vec, other))
                if cosine > DEDUP_COSINE_THRESHOLD:
                    is_dup = True
                    break
        if is_dup:
            suppressed += 1
        else:
            final.append(r)

    return final, suppressed


def hybrid_search(
    client: QdrantClient,
    config_id: str | None,
    provider: SentenceTransformerProvider,
    bm25: BM25Index,
    query: str,
    query_id: str,
    top_k: int = FINAL_TOP_K,
    predicted_domains: list[str] | None = None,
    domain_boost: float = DOMAIN_BOOST,
    suppress_duplicates: bool = True,
) -> RetrievalRun:
    t0 = time.perf_counter()

    qvec = provider.embed_queries([query])[0]

    vector_by_id: dict[str, "np.ndarray"] = {}
    if predicted_domains or suppress_duplicates:
        # Full-payload path: need domains for boosting, content_hash for
        # dedup's exact-match stage, and dense vectors for dedup's
        # pairwise-cosine stage (ARCHITECTURE.md §9.5) — all without a
        # second round-trip per candidate.
        import numpy as np

        dense_full = search_dense_full(client, config_id, qvec, top_k=DENSE_CANDIDATES, with_vectors=True)
        dense_results = [(row["chunk_id"], row["score"]) for row in dense_full]
        domains_by_id = {row["chunk_id"]: tuple(row.get("domains", [])) for row in dense_full}
        hash_by_id = {row["chunk_id"]: row.get("content_hash") for row in dense_full}
        vector_by_id = {row["chunk_id"]: np.array(row["vector"]) for row in dense_full if row.get("vector")}
    else:
        dense_results = search_dense(client, config_id, qvec, top_k=DENSE_CANDIDATES)
        domains_by_id = {}
        hash_by_id = {}

    bm25_results = bm25.search(query, top_k=BM25_CANDIDATES)

    fused = _rrf_fuse(dense_results, bm25_results)
    predicted_set = set(predicted_domains or [])

    ranked: list[RankedResult] = []
    for cid, (rrf, drank, brank, dscore, bscore) in fused.items():
        domains = domains_by_id.get(cid, ())
        boosted = bool(predicted_set) and bool(predicted_set & set(domains))
        boosted_score = rrf + (domain_boost if boosted else 0.0)
        ranked.append(
            RankedResult(
                chunk_id=cid,
                rrf_score=rrf,
                boosted_score=boosted_score,
                domain_boosted=boosted,
                dense_rank=drank,
                bm25_rank=brank,
                dense_score=dscore,
                bm25_score=bscore,
                domains=domains,
                content_hash=hash_by_id.get(cid),
            )
        )

    # Sort by boosted_score. When predicted_domains is empty, boosted_score
    # == rrf_score for every candidate, so this is a no-op ordering change
    # vs the pre-boost design — the invariant that a wrong/absent domain
    # prediction never changes ranking, only ever a correct one does.
    ranked.sort(key=lambda r: r.boosted_score, reverse=True)

    suppressed_count = 0
    if suppress_duplicates:
        ranked, suppressed_count = _suppress_near_duplicates(ranked, dense_vectors=vector_by_id or None)

    final = ranked[:top_k]
    latency_ms = (time.perf_counter() - t0) * 1000
    return RetrievalRun(
        query_id=query_id,
        config_id=config_id,
        results=final,
        latency_ms=latency_ms,
        predicted_domains=tuple(predicted_domains or []),
        suppressed_duplicate_count=suppressed_count,
    )


def hybrid_search_multi_query(
    client: QdrantClient,
    config_id: str | None,
    provider: SentenceTransformerProvider,
    bm25: BM25Index,
    queries: list[str],
    query_id: str,
    top_k: int = FINAL_TOP_K,
    predicted_domains: list[str] | None = None,
    domain_boost: float = DOMAIN_BOOST,
    suppress_duplicates: bool = True,
) -> RetrievalRun:
    """Query-rewriting fusion (PLAN.md Phase 9 / 03_query_rewriter): runs
    the full hybrid_search pipeline independently per query variant
    (original + rewritten clinical phrasings), then fuses the resulting
    ranked lists across variants with a second RRF pass over each
    variant's rank position — reusing hybrid_search's already-tested
    dense+BM25+RRF+domain-boost+dedup per variant rather than re-deriving
    fusion logic. Domain boost and dedup are applied once per variant
    (inside each hybrid_search call) AND the cross-variant fusion
    preserves boosted_score ordering as the tie-break, so a chunk found by
    multiple variants naturally ranks higher without double-boosting.

    With a single query (queries == [q]), this reduces to exactly
    hybrid_search(q)'s behavior — verified in tests/test_hybrid_search.py."""
    t0 = time.perf_counter()

    if len(queries) == 1:
        single = hybrid_search(
            client, config_id, provider, bm25, queries[0], query_id, top_k,
            predicted_domains, domain_boost, suppress_duplicates,
        )
        return single

    per_variant_runs = [
        hybrid_search(
            client, config_id, provider, bm25, q, f"{query_id}_v{i}",
            top_k=DENSE_CANDIDATES, predicted_domains=predicted_domains,
            domain_boost=domain_boost, suppress_duplicates=False,
        )
        for i, q in enumerate(queries)
    ]

    # Cross-variant RRF: each variant's ranked list contributes 1/(k+rank)
    # per chunk it contains, summed across variants. A chunk retrieved
    # near the top by multiple variants outranks one found by only one.
    fused_scores: dict[str, float] = {}
    result_by_id: dict[str, RankedResult] = {}
    for run in per_variant_runs:
        for rank, r in enumerate(run.results, start=1):
            fused_scores[r.chunk_id] = fused_scores.get(r.chunk_id, 0.0) + 1.0 / (RRF_K + rank)
            # Keep the highest-boosted_score instance of each chunk's
            # metadata (domains/content_hash/dense+bm25 sub-scores) —
            # identical chunk, so any variant's copy is representative.
            if r.chunk_id not in result_by_id or r.boosted_score > result_by_id[r.chunk_id].boosted_score:
                result_by_id[r.chunk_id] = r

    merged = [
        RankedResult(
            chunk_id=cid,
            rrf_score=result_by_id[cid].rrf_score,
            boosted_score=score,
            domain_boosted=result_by_id[cid].domain_boosted,
            dense_rank=result_by_id[cid].dense_rank,
            bm25_rank=result_by_id[cid].bm25_rank,
            dense_score=result_by_id[cid].dense_score,
            bm25_score=result_by_id[cid].bm25_score,
            domains=result_by_id[cid].domains,
            content_hash=result_by_id[cid].content_hash,
        )
        for cid, score in fused_scores.items()
    ]
    merged.sort(key=lambda r: r.boosted_score, reverse=True)

    suppressed_count = 0
    if suppress_duplicates:
        merged, suppressed_count = _suppress_near_duplicates(merged, dense_vectors=None)

    final = merged[:top_k]
    latency_ms = (time.perf_counter() - t0) * 1000
    return RetrievalRun(
        query_id=query_id,
        config_id=config_id,
        results=final,
        latency_ms=latency_ms,
        predicted_domains=tuple(predicted_domains or []),
        suppressed_duplicate_count=suppressed_count,
    )
