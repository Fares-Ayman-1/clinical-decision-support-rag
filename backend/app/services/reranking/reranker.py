"""Cross-encoder reranking — ARCHITECTURE.md §9.4, PLAN.md Phase 9.

Reranks the fused top-25 candidates to a precision-focused top-5. The
reranker score is also the Sufficiency Gate's calibrated relevance signal
(§11) — unlike raw cosine, which has no absolute meaning across embedding
models, cross-encoder logits are comparable and thresholdable.

Timeout/unavailability fallback is a first-class MVP requirement (PLAN.md
Phase 9: "on reranker failure, use RRF order and flag it in the trace"),
not an afterthought — no cross-encoder model is downloadable in the dev
sandbox (same HF Hub network restriction documented in
PROJECT-STATE.md R12), so NullReranker is the currently-active
implementation, and CrossEncoderReranker is the real one, ready to swap
in the moment a model is available. Both share the same Reranker
protocol so nothing downstream needs to know which is active.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RerankedResult:
    chunk_id: str
    rerank_score: float | None  # None when rerank_used is False
    pre_rerank_rank: int
    post_rerank_rank: int


@dataclass(frozen=True)
class RerankRun:
    results: list[RerankedResult]
    rerank_used: bool
    fallback_reason: str | None
    latency_ms: float


class Reranker(Protocol):
    def rerank(self, query: str, candidates: list[tuple[str, str]], top_k: int) -> RerankRun:
        """candidates: [(chunk_id, chunk_text), ...] in incoming (pre-rerank)
        order. Returns the top_k reranked, or — on any failure/absence of
        a model — the same candidates truncated to top_k in their
        incoming order, with rerank_used=False and fallback_reason set."""
        ...


class NullReranker:
    """The active reranker until a cross-encoder model is available.
    Passes candidates through in their incoming (RRF/domain-boosted)
    order, truncated to top_k — exactly the fallback behavior
    CrossEncoderReranker uses on a real failure, so the rest of the
    pipeline (Sufficiency Gate, trace panel) sees identical shape and
    semantics whether the fallback is deliberate (no model) or reactive
    (model errored/timed out)."""

    def __init__(self, reason: str = "no cross-encoder model available in this environment"):
        self._reason = reason

    def rerank(self, query: str, candidates: list[tuple[str, str]], top_k: int) -> RerankRun:
        t0 = time.perf_counter()
        results = [
            RerankedResult(chunk_id=cid, rerank_score=None, pre_rerank_rank=i + 1, post_rerank_rank=i + 1)
            for i, (cid, _) in enumerate(candidates[:top_k])
        ]
        return RerankRun(
            results=results,
            rerank_used=False,
            fallback_reason=self._reason,
            latency_ms=(time.perf_counter() - t0) * 1000,
        )


class CrossEncoderReranker:
    """Real implementation — wraps sentence_transformers.CrossEncoder.
    Not currently instantiated anywhere (no model downloadable in this
    sandbox — see module docstring), but complete and ready: swap
    NullReranker() for CrossEncoderReranker(model_name) in whatever wires
    up the retrieval pipeline once a model is available, with zero other
    changes needed downstream."""

    # Env-overridable because the right budget depends entirely on the model
    # and the hardware, and getting it wrong is expensive in both directions.
    # Measured, not estimated: bge-reranker-v2-m3 (568M XLM-R) takes ~96-105s
    # for 25 candidates on both Railway's CPU and a HF Space's 2 vCPU;
    # ms-marco-MiniLM-L6 takes ~1s; the multilingual mmarco L12 sibling ~2-4s.
    # A budget below the model's real cost means every query pays the full
    # latency and then DISCARDS the result (see rerank() below), which is the
    # worst of both worlds.
    #
    # Both spellings accepted: RERANK_TIMEOUT_SECONDS (main's docs) and
    # RERANKER_TIMEOUT_SECONDS (already set on the HF Space deployment).
    DEFAULT_TIMEOUT_SECONDS = float(
        os.environ.get("RERANK_TIMEOUT_SECONDS")
        or os.environ.get("RERANKER_TIMEOUT_SECONDS")
        or "3.0"
    )

    def __init__(self, model_name: str, timeout_seconds: float | None = None):
        from sentence_transformers import CrossEncoder

        self._model = CrossEncoder(model_name)
        self._timeout_seconds = (
            timeout_seconds if timeout_seconds is not None else self.DEFAULT_TIMEOUT_SECONDS
        )

    def rerank(self, query: str, candidates: list[tuple[str, str]], top_k: int) -> RerankRun:
        t0 = time.perf_counter()
        try:
            pairs = [(query, text) for _, text in candidates]
            scores = self._model.predict(pairs)
            elapsed = time.perf_counter() - t0
            if elapsed > self._timeout_seconds:
                return self._fallback(candidates, top_k, t0, f"reranker exceeded {self._timeout_seconds}s budget")

            order = sorted(range(len(candidates)), key=lambda i: scores[i], reverse=True)
            results = [
                RerankedResult(
                    chunk_id=candidates[idx][0],
                    rerank_score=float(scores[idx]),
                    pre_rerank_rank=idx + 1,
                    post_rerank_rank=rank + 1,
                )
                for rank, idx in enumerate(order[:top_k])
            ]
            return RerankRun(
                results=results, rerank_used=True, fallback_reason=None,
                latency_ms=(time.perf_counter() - t0) * 1000,
            )
        except Exception as e:  # noqa: BLE001 — deliberate: any reranker
            # failure must degrade to RRF order, never propagate and take
            # down retrieval (PLAN.md Phase 9 completion criterion).
            return self._fallback(candidates, top_k, t0, f"{type(e).__name__}: {e}")

    def _fallback(self, candidates, top_k, t0, reason) -> RerankRun:
        results = [
            RerankedResult(chunk_id=cid, rerank_score=None, pre_rerank_rank=i + 1, post_rerank_rank=i + 1)
            for i, (cid, _) in enumerate(candidates[:top_k])
        ]
        return RerankRun(
            results=results, rerank_used=False, fallback_reason=reason,
            latency_ms=(time.perf_counter() - t0) * 1000,
        )
