#!/usr/bin/env python
"""Run retrieval + compute metrics for a chunking benchmark config against
an eval split.

Hard-refuses --split golden unless --final is passed (enforced in the
harness itself, not by discipline alone — PROJECT-STATE.md risk log: "never
tune against golden. A technical panel will ask whether you did.").

Usage:
    python scripts/evaluate.py --config-id S1 --split dev --k 1 3 5 10
    python scripts/evaluate.py --config-id S2 --split golden --final --k 1 3 5 10
"""

from __future__ import annotations

import os
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from qdrant_client import QdrantClient  # noqa: E402

from app.services.evaluation.eval_runner import run_eval, write_runs  # noqa: E402
from app.services.evaluation.metrics import (  # noqa: E402
    hit_rate_at_k,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    wasted_context_ratio,
)
from app.services.evaluation.relevance import build_relevance_predicate, load_eval_queries  # noqa: E402
from app.services.retrieval.bm25_index import build_bm25_index  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.qdrant_index import load_chunks  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
EVAL_DIR = REPO_ROOT / "data" / "evaluation"
RUNS_DIR = EVAL_DIR / "runs"
# Read from the environment so a containerized or remote deployment can point
# at a non-local Qdrant. docker-compose.yml already sets this to
# http://qdrant:6333 for the `api` service; before this was env-driven that
# setting was silently ignored and the container looked for Qdrant inside
# itself. The default keeps single-machine dev behavior unchanged.
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-id", required=True)
    parser.add_argument("--split", required=True, choices=["dev", "golden", "out_of_domain"])
    parser.add_argument("--final", action="store_true", help="Required to run against --split golden")
    parser.add_argument("--k", nargs="+", type=int, default=[1, 3, 5, 10])
    args = parser.parse_args()

    if args.split == "golden" and not args.final:
        print(
            "REFUSED: --split golden requires --final. Golden is report-only and must never be "
            "used for tuning (PROJECT-STATE.md risk log). If you are certain this is the final "
            "reporting run, re-run with --final."
        )
        return 1

    queries = load_eval_queries(EVAL_DIR / f"{args.split}.jsonl")
    print(f"Loaded {len(queries)} queries from {args.split}.jsonl")

    chunks = load_chunks(CHUNKS_DIR / f"1.0_{args.config_id}.jsonl")
    chunk_lookup = {c["chunk_id"]: c for c in chunks}
    token_counts = {c["chunk_id"]: c["token_count"] for c in chunks}

    embedding_cfg = load_embedding_config()
    provider = SentenceTransformerProvider(embedding_cfg)
    bm25 = build_bm25_index(chunks)
    client = QdrantClient(url=QDRANT_URL)

    runs = run_eval(client, args.config_id, provider, bm25, queries)
    out_path = RUNS_DIR / f"{args.config_id}_{args.split}.jsonl"
    write_runs(runs, out_path)
    print(f"Wrote {len(runs)} retrieval runs -> {out_path.relative_to(REPO_ROOT)}")

    queries_by_id = {q.query_id: q for q in queries}
    avg_latency = sum(r.latency_ms for r in runs) / len(runs) if runs else 0.0

    print(f"\n--- {args.config_id} / {args.split} ---")
    print(f"avg retrieval latency: {avg_latency:.1f}ms")

    # out_of_domain queries carry relevant_sections=[] by design (nothing
    # in the corpus SHOULD match). Standard recall/precision/nDCG are
    # undefined against an empty relevant set (division by zero, or a
    # meaningless "did we retrieve nothing" signal) — they're excluded
    # from this table and belong in the refusal-rate metric instead
    # (Phase 14 Safety Validator, not this retrieval-only script).
    in_domain_runs = [r for r in runs if queries_by_id[r.query_id].relevant_sections]
    excluded = len(runs) - len(in_domain_runs)
    if excluded:
        print(f"({excluded} out-of-domain quer{'y' if excluded == 1 else 'ies'} excluded from IR metrics — "
              f"undefined without a relevant set; belongs in refusal-rate evaluation instead)")

    # Precompute is_relevant / n_relevant once per query (not once per k):
    # n_relevant is "how many chunks in THIS config's index match the
    # labeled section(s)" — the correct recall denominator, since recall
    # measures "of the relevant chunks that exist in the index, how many
    # did we find in top-k", not "how many of top-10 are relevant".
    per_query = {}
    for run in in_domain_runs:
        q = queries_by_id[run.query_id]
        is_relevant = build_relevance_predicate(q, chunk_lookup)
        n_relevant = sum(1 for cid in chunk_lookup if is_relevant(cid))
        per_query[run.query_id] = (is_relevant, max(n_relevant, 1))

    print(f"{'k':>3} {'Recall':>8} {'Precision':>10} {'Hit@k':>8} {'nDCG':>8} {'Wasted%':>9}")

    for k in args.k:
        recalls, precisions, hits, ndcgs, wasted = [], [], [], [], []
        for run in in_domain_runs:
            ranked_ids = [r.chunk_id for r in run.results]
            is_relevant, n_relevant = per_query[run.query_id]
            recalls.append(recall_at_k(ranked_ids, is_relevant, k, n_relevant))
            precisions.append(precision_at_k(ranked_ids, is_relevant, k))
            hits.append(hit_rate_at_k(ranked_ids, is_relevant, k))
            ndcgs.append(ndcg_at_k(ranked_ids, is_relevant, k, n_relevant))
            wasted.append(wasted_context_ratio(ranked_ids, is_relevant, token_counts, k))

        n = len(in_domain_runs) or 1
        print(
            f"{k:>3} {sum(recalls)/n:>8.3f} {sum(precisions)/n:>10.3f} "
            f"{sum(hits)/n:>8.3f} {sum(ndcgs)/n:>8.3f} {100*sum(wasted)/n:>8.1f}%"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
