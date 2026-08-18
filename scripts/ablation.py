#!/usr/bin/env python
"""Retrieval ablation table — PLAN.md Phase 9: dense -> +BM25 -> +rerank ->
+rewrite. Runs each stage against the dev split and reports Recall@5 and
Precision@5 (ARCHITECTURE.md/PROJECT-STATE.md §13's ablation table shape).

+rewrite uses the real 03_query_rewriter prompt (backend/app/prompts/
query_rewriter.py) via hybrid_search_multi_query — needs a real
LLM_API_KEY in .env; pass --skip-rewrite to omit this stage (e.g. no key
configured, or to save LLM calls during iteration on earlier stages).

+rerank is measured against whichever Reranker is currently active
(NullReranker as of this session — no cross-encoder model is downloadable,
PROJECT-STATE.md R12) — this stage's row will show identical numbers to
+BM25 until a real cross-encoder is wired in, which is expected and
reported honestly, not hidden.

Usage:
    python scripts/ablation.py --split dev
    python scripts/ablation.py --split dev --skip-rewrite
"""

from __future__ import annotations

import os
import argparse
import pathlib
import sys

from dotenv import load_dotenv

REPO_ROOT_FOR_ENV = pathlib.Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT_FOR_ENV / ".env")

sys.path.insert(0, str(REPO_ROOT_FOR_ENV / "backend"))

from qdrant_client import QdrantClient  # noqa: E402

from app.llm.provider import load_llm_provider  # noqa: E402
from app.prompts.query_rewriter import rewrite_query  # noqa: E402
from app.services.evaluation.metrics import precision_at_k, recall_at_k  # noqa: E402
from app.services.evaluation.relevance import build_relevance_predicate, load_eval_queries  # noqa: E402
from app.services.rag.chunk_store import load_chunk_store  # noqa: E402
from app.services.rag.retrieve_and_rerank import retrieve_and_rerank  # noqa: E402
from app.services.reranking.reranker import NullReranker  # noqa: E402
from app.services.retrieval.bm25_index import build_bm25_index  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.hybrid_search import hybrid_search, hybrid_search_multi_query  # noqa: E402
from app.services.retrieval.qdrant_index import load_chunks, search_dense  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
CHUNK_STORE_PATH = REPO_ROOT / "data" / "chunk_store" / "medical_chunks.jsonl"
EVAL_DIR = REPO_ROOT / "data" / "evaluation"
# Read from the environment so a containerized or remote deployment can point
# at a non-local Qdrant. docker-compose.yml already sets this to
# http://qdrant:6333 for the `api` service; before this was env-driven that
# setting was silently ignored and the container looked for Qdrant inside
# itself. The default keeps single-machine dev behavior unchanged.
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
K = 5
# Match the live pipeline's rerank input size rather than picking one here,
# so the ablation's +rewrite row reranks the same candidate-set width the
# real serving path does (ARCHITECTURE.md §9.4).
from app.services.rag.retrieve_and_rerank import RERANK_INPUT_SIZE as RERANK_INPUT_K  # noqa: E402


def _score(runs_by_query, queries_by_id, chunk_lookup):
    recalls, precisions = [], []
    for qid, ranked_ids in runs_by_query.items():
        q = queries_by_id[qid]
        is_relevant = build_relevance_predicate(q, chunk_lookup)
        n_relevant = max(sum(1 for cid in chunk_lookup if is_relevant(cid)), 1)
        recalls.append(recall_at_k(ranked_ids, is_relevant, K, n_relevant))
        precisions.append(precision_at_k(ranked_ids, is_relevant, K))
    n = len(recalls) or 1
    return sum(recalls) / n, sum(precisions) / n


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", default="dev")
    parser.add_argument("--source-config", default="S1")
    parser.add_argument("--skip-rewrite", action="store_true", help="Omit the +rewrite stage (saves LLM calls)")
    args = parser.parse_args()

    queries = load_eval_queries(EVAL_DIR / f"{args.split}.jsonl")
    in_domain = [q for q in queries if q.relevant_sections]
    queries_by_id = {q.query_id: q for q in in_domain}

    chunks = load_chunks(CHUNKS_DIR / f"1.0_{args.source_config}.jsonl")
    chunk_lookup = {c["chunk_id"]: c for c in chunks}
    chunk_store = load_chunk_store(CHUNK_STORE_PATH)

    embedding_cfg = load_embedding_config()
    provider = SentenceTransformerProvider(embedding_cfg)
    bm25 = build_bm25_index(chunks)
    client = QdrantClient(url=QDRANT_URL)
    # Use the same reranker the live app loads, so the ablation measures
    # the deployed configuration rather than a hardcoded stand-in.
    from app.api.dependencies import _load_reranker  # noqa: E402

    reranker = _load_reranker()
    print(f"Reranker: {reranker.__class__.__name__}")

    print(f"Ablation on {args.split} split ({len(in_domain)} in-domain queries), config={args.source_config}\n")
    print(f"{'Stage':<20} {'Recall@5':>10} {'Precision@5':>13}")
    print("-" * 45)

    # Stage 1: dense only
    dense_runs = {}
    for q in in_domain:
        qvec = provider.embed_queries([q.query])[0]
        results = search_dense(client, None, qvec, top_k=K)
        dense_runs[q.query_id] = [cid for cid, _ in results]
    r, p = _score(dense_runs, queries_by_id, chunk_lookup)
    print(f"{'Dense only':<20} {r:>10.3f} {p:>13.3f}")

    # Stage 2: +BM25 (hybrid, RRF fused, no domain boost/dedup to isolate
    # the fusion effect specifically)
    hybrid_runs = {}
    for q in in_domain:
        run = hybrid_search(client, None, provider, bm25, q.query, q.query_id, top_k=K, suppress_duplicates=False)
        hybrid_runs[q.query_id] = [r.chunk_id for r in run.results]
    r, p = _score(hybrid_runs, queries_by_id, chunk_lookup)
    print(f"{'+ BM25 (RRF)':<20} {r:>10.3f} {p:>13.3f}")

    # Stage 3: +rerank (currently NullReranker -> identical order to
    # hybrid's top-5, reported honestly, not hidden)
    rerank_runs = {}
    for q in in_domain:
        result = retrieve_and_rerank(client, None, provider, bm25, chunk_store, reranker, q.query, q.query_id, final_top_k=K)
        rerank_runs[q.query_id] = [r.chunk_id for r in result.rerank.results]
    r, p = _score(rerank_runs, queries_by_id, chunk_lookup)
    label = "+ rerank" if reranker.__class__.__name__ != "NullReranker" else "+ rerank (no-op)"
    print(f"{label:<20} {r:>10.3f} {p:>13.3f}")

    # Stage 4: +rewrite (real 03_query_rewriter, needs LLM_API_KEY)
    if args.skip_rewrite:
        print(f"{'+ rewrite':<20} {'skipped':>10} {'skipped':>13}  (--skip-rewrite passed)")
    else:
        try:
            llm = load_llm_provider()
        except RuntimeError as e:
            print(f"{'+ rewrite':<20} {'N/A':>10} {'N/A':>13}  (LLM not configured: {e})")
            return 0

        rewrite_runs = {}
        for q in in_domain:
            try:
                variants_result = rewrite_query(llm, q.query)
                variants = [q.query] + variants_result.variants
            except Exception as e:  # noqa: BLE001 — a rewrite failure must not
                # abort the whole ablation run; fall back to the original
                # query alone for this one row's contribution.
                print(f"  (rewrite failed for {q.query_id}, using original only: {e})", file=sys.stderr)
                variants = [q.query]

            # Retrieve a wider candidate set, then rerank it — this row is
            # "+rewrite" ON TOP OF the reranker, so the table stays
            # cumulative (each row adds exactly one component to the row
            # above). An earlier version called hybrid_search_multi_query
            # alone here, which silently made the last row "rewrite
            # INSTEAD OF rerank" and broke that contract.
            run = hybrid_search_multi_query(
                client, None, provider, bm25, variants, q.query_id,
                top_k=RERANK_INPUT_K, suppress_duplicates=False,
            )
            pairs = [
                (r.chunk_id, rec.text)
                for r in run.results
                if (rec := chunk_store.get(r.chunk_id)) is not None
            ]
            rerank_run = reranker.rerank(q.query, pairs, top_k=K)
            rewrite_runs[q.query_id] = [r.chunk_id for r in rerank_run.results]
        r, p = _score(rewrite_runs, queries_by_id, chunk_lookup)
        print(f"{'+ rewrite':<20} {r:>10.3f} {p:>13.3f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
