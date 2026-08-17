"""Orchestrates hybrid_search -> reranking -> Chunk Store resolution —
ARCHITECTURE.md §9. The composition point between retrieval (§8-9.3, RRF +
domain boost + dedup) and reranking (§9.4), which are separate concerns in
separate modules but run as one pipeline stage in practice.

hybrid_search() is called for the full 25-candidate list (not the final
top-5) so the reranker has its intended input size; the reranker then
narrows to the final top-5 — matching ARCHITECTURE.md §9.4's stated
input/output shape exactly.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from qdrant_client import QdrantClient

from app.services.rag.chunk_store import ChunkStore
from app.services.reranking.reranker import Reranker, RerankRun
from app.services.retrieval.bm25_index import BM25Index
from app.services.retrieval.embedding_provider import SentenceTransformerProvider
from app.services.retrieval.hybrid_search import RetrievalRun, hybrid_search

RERANK_INPUT_SIZE = 25
FINAL_OUTPUT_SIZE = 5


@dataclass(frozen=True)
class PipelineResult:
    query_id: str
    retrieval: RetrievalRun
    rerank: RerankRun
    total_latency_ms: float


def retrieve_and_rerank(
    client: QdrantClient,
    config_id: str | None,
    provider: SentenceTransformerProvider,
    bm25: BM25Index,
    chunk_store: ChunkStore,
    reranker: Reranker,
    query: str,
    query_id: str,
    predicted_domains: list[str] | None = None,
    final_top_k: int = FINAL_OUTPUT_SIZE,
) -> PipelineResult:
    t0 = time.perf_counter()

    retrieval = hybrid_search(
        client, config_id, provider, bm25, query, query_id,
        top_k=RERANK_INPUT_SIZE, predicted_domains=predicted_domains,
    )

    candidates: list[tuple[str, str]] = []
    for r in retrieval.results:
        record = chunk_store.get(r.chunk_id)
        # A chunk_id present in the vector index but missing from the
        # Chunk Store would be a real data-integrity bug (the two are
        # built from the same source JSONL in scripts/build_mvp_index.py)
        # — skip defensively rather than crash the whole query on it, but
        # this should never actually happen against a correctly-built
        # index and is not a normal/expected path.
        if record is None:
            continue
        candidates.append((r.chunk_id, record.text))

    rerank = reranker.rerank(query, candidates, top_k=final_top_k)

    total_latency_ms = (time.perf_counter() - t0) * 1000
    return PipelineResult(
        query_id=query_id, retrieval=retrieval, rerank=rerank, total_latency_ms=total_latency_ms
    )
