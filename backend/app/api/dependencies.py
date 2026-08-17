"""App-wide resource loading — everything expensive (embedding model,
Qdrant client, BM25 index, Chunk Store, LLM provider) is loaded ONCE at
FastAPI startup, not per-request. Mirrors PLAN.md Phase 16's "Chunk Store
loads into memory at startup" / "warm the reranker at startup" MVP items.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

from dotenv import load_dotenv
from qdrant_client import QdrantClient

from app.llm.provider import LLMProvider, load_llm_provider
from app.services.rag.chunk_store import ChunkStore, load_chunk_store
from app.services.reranking.reranker import NullReranker, Reranker
from app.services.retrieval.bm25_index import BM25Index, build_bm25_index
from app.services.retrieval.embedding_provider import (
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.qdrant_index import load_chunks

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
CHUNK_STORE_PATH = REPO_ROOT / "data" / "chunk_store" / "medical_chunks.jsonl"
# The MVP serving collection is built from S1 (PROJECT-STATE.md — the
# 5-config chunking-strategy comparison, R13, is still incomplete; S1 is
# the one config proven end-to-end). Swap once the comparison finishes.
MVP_SOURCE_CHUNKS_PATH = REPO_ROOT / "data" / "chunks" / "benchmark" / "1.0_S1.jsonl"
QDRANT_URL = "http://localhost:6333"
KB_VERSION = "1.0"


@dataclass
class AppResources:
    qdrant_client: QdrantClient
    embedding_provider: SentenceTransformerProvider
    bm25_index: BM25Index
    chunk_store: ChunkStore
    reranker: Reranker
    llm_provider: LLMProvider
    kb_version: str
    embedding_version: str
    llm_model: str


def _load_reranker() -> Reranker:
    """Cross-encoder if RERANKER_MODEL names one and it loads; otherwise
    the NullReranker passthrough.

    Model loading is deliberately guarded: a reranker that cannot load is
    a degraded-quality condition, not an outage. PLAN.md Phase 9's
    completion criterion is "on reranker failure, use RRF order and flag
    it in the trace" — failing app startup instead would turn a ranking
    regression into total unavailability, which is strictly worse for a
    system whose retrieval still works without it.
    """
    import logging
    import os

    model_name = os.environ.get("RERANKER_MODEL", "").strip()
    if not model_name or model_name == "TBD":
        return NullReranker("RERANKER_MODEL is not configured")

    try:
        from app.services.reranking.reranker import CrossEncoderReranker

        reranker = CrossEncoderReranker(model_name)
        # Warm the model on a throwaway pair (PLAN.md Phase 16: "warm the
        # reranker at startup"). The first predict() call pays lazy
        # initialization that would otherwise land on a real user request
        # and risk tripping the per-request timeout budget.
        reranker.rerank("warmup", [("_warmup", "warmup passage")], top_k=1)
        return reranker
    except Exception as e:  # noqa: BLE001 — see docstring: degrade, never fail startup.
        logging.getLogger(__name__).warning(
            "Cross-encoder %r failed to load (%s: %s) — falling back to NullReranker.",
            model_name, type(e).__name__, e,
        )
        return NullReranker(f"cross-encoder {model_name!r} failed to load: {type(e).__name__}")


def load_app_resources() -> AppResources:
    load_dotenv(REPO_ROOT / ".env")

    embedding_cfg = load_embedding_config()
    embedding_provider = SentenceTransformerProvider(embedding_cfg)

    chunks = load_chunks(MVP_SOURCE_CHUNKS_PATH)
    bm25_index = build_bm25_index(chunks)

    chunk_store = load_chunk_store(CHUNK_STORE_PATH)

    qdrant_client = QdrantClient(url=QDRANT_URL)

    reranker = _load_reranker()

    llm_provider = load_llm_provider()
    import os

    llm_model = os.environ.get("LLM_MODEL", "unknown")

    return AppResources(
        qdrant_client=qdrant_client,
        embedding_provider=embedding_provider,
        bm25_index=bm25_index,
        chunk_store=chunk_store,
        reranker=reranker,
        llm_provider=llm_provider,
        kb_version=KB_VERSION,
        embedding_version=embedding_cfg.embedding_version,
        llm_model=llm_model,
    )
