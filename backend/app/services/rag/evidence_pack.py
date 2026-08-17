"""Evidence Pack builder — ARCHITECTURE.md §10, PLAN.md Phase 11.

The ONLY medical content passed to the generator. Assigns short opaque
evidence_id labels (E1, E2, ...) to retrieved/reranked chunks — the
generator never sees a chunk_id, document title, section, or page number
(ARCHITECTURE.md §12.2), which is what makes citation fabrication
structurally impossible rather than merely detectable.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.rag.chunk_store import ChunkStore
from app.services.rag.retrieve_and_rerank import PipelineResult


@dataclass(frozen=True)
class EvidenceItem:
    evidence_id: str  # E1, E2, ... — stable label used INSIDE the prompt
    chunk_id: str  # never shown to the generator; kept for Citation Resolver
    text: str
    dense_score: float | None
    bm25_score: float | None
    rrf_score: float | None
    rerank_score: float | None


@dataclass(frozen=True)
class EvidencePack:
    query_id: str
    rewritten_queries: tuple[str, ...]
    predicted_domains: tuple[str, ...]
    evidence: list[EvidenceItem]
    top_rerank_score: float | None
    top_rrf_score: float
    support_count: int


def build_evidence_pack(
    pipeline_result: PipelineResult,
    chunk_store: ChunkStore,
    rewritten_queries: list[str] | None = None,
) -> EvidencePack:
    retrieval_by_id = {r.chunk_id: r for r in pipeline_result.retrieval.results}

    evidence: list[EvidenceItem] = []
    for i, rr in enumerate(pipeline_result.rerank.results, start=1):
        record = chunk_store.get(rr.chunk_id)
        if record is None:
            # Same defensive skip as retrieve_and_rerank.py — a chunk_id in
            # the reranked results but absent from the Chunk Store would be
            # a data-integrity bug, not a normal path.
            continue
        retrieval_info = retrieval_by_id.get(rr.chunk_id)
        evidence.append(
            EvidenceItem(
                evidence_id=f"E{i}",
                chunk_id=rr.chunk_id,
                text=record.text,
                dense_score=retrieval_info.dense_score if retrieval_info else None,
                bm25_score=retrieval_info.bm25_score if retrieval_info else None,
                rrf_score=retrieval_info.rrf_score if retrieval_info else None,
                rerank_score=rr.rerank_score,
            )
        )

    top_rrf_score = max((e.rrf_score or 0.0 for e in evidence), default=0.0)
    rerank_scores = [e.rerank_score for e in evidence if e.rerank_score is not None]
    top_rerank_score = max(rerank_scores) if rerank_scores else None

    return EvidencePack(
        query_id=pipeline_result.query_id,
        rewritten_queries=tuple(rewritten_queries or []),
        predicted_domains=pipeline_result.retrieval.predicted_domains,
        evidence=evidence,
        top_rerank_score=top_rerank_score,
        top_rrf_score=top_rrf_score,
        support_count=len(evidence),
    )


def format_evidence_for_prompt(pack: EvidencePack) -> str:
    """Renders the Evidence Pack as the delimited, labeled-untrusted-data
    block the generator prompt embeds — ARCHITECTURE.md §12.1's precedence
    rule (evidence is data, never instructions)."""
    if not pack.evidence:
        return "<evidence>\n(no evidence retrieved)\n</evidence>"

    lines = ["<evidence>"]
    for item in pack.evidence:
        lines.append(f"[{item.evidence_id}]: {item.text}")
    lines.append("</evidence>")
    return "\n".join(lines)
