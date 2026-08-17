#!/usr/bin/env python
"""Comparison table across chunking benchmark configs, with bootstrap 95%
CIs — the CI column is what separates a real ablation from a leaderboard
of noise (chunking benchmark plan, Stage 1/2).

Reads persisted run files from data/evaluation/runs/{config_id}_{split}.jsonl
(written by scripts/evaluate.py) and recomputes metrics per config, per k,
with a bootstrap CI over queries.

Usage:
    python scripts/compare_chunking.py --config-id S1 S2 S4 S5 S7 --split dev --k 5
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from app.services.evaluation.metrics import (  # noqa: E402
    ndcg_at_k,
    recall_at_k,
)
from app.services.evaluation.relevance import build_relevance_predicate, load_eval_queries  # noqa: E402
from app.services.retrieval.qdrant_index import load_chunks  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
EVAL_DIR = REPO_ROOT / "data" / "evaluation"
RUNS_DIR = EVAL_DIR / "runs"

N_BOOTSTRAP = 2000
RNG_SEED = 42


def bootstrap_ci(values: list[float], n_bootstrap: int = N_BOOTSTRAP, seed: int = RNG_SEED) -> tuple[float, float, float]:
    """Returns (mean, ci_low, ci_high) for a 95% bootstrap CI over the
    per-query values (resampling queries with replacement)."""
    if not values:
        return 0.0, 0.0, 0.0
    arr = np.array(values)
    rng = np.random.default_rng(seed)
    means = []
    n = len(arr)
    for _ in range(n_bootstrap):
        sample = rng.choice(arr, size=n, replace=True)
        means.append(sample.mean())
    means = np.array(means)
    return float(arr.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-id", nargs="+", required=True)
    parser.add_argument("--split", default="dev")
    parser.add_argument("--k", type=int, default=5)
    args = parser.parse_args()

    queries = load_eval_queries(EVAL_DIR / f"{args.split}.jsonl")
    queries_by_id = {q.query_id: q for q in queries}
    in_domain = [q for q in queries if q.relevant_sections]

    print(f"Chunking benchmark comparison — split={args.split}, k={args.k}, "
          f"{len(in_domain)} in-domain queries, {N_BOOTSTRAP} bootstrap resamples\n")

    header = f"{'config':>8} {'chunks':>8} {'avg_tok':>8} {'Recall@k':>20} {'nDCG@k':>20} {'latency_ms':>12}"
    print(header)
    print("-" * len(header))

    rows = []
    for config_id in args.config_id:
        run_path = RUNS_DIR / f"{config_id}_{args.split}.jsonl"
        if not run_path.exists():
            print(f"{config_id:>8}  (no run file at {run_path.relative_to(REPO_ROOT)} — run scripts/evaluate.py first)")
            continue

        chunks = load_chunks(CHUNKS_DIR / f"1.0_{config_id}.jsonl")
        chunk_lookup = {c["chunk_id"]: c for c in chunks}
        avg_tokens = sum(c["token_count"] for c in chunks) / len(chunks) if chunks else 0.0

        runs = []
        with run_path.open(encoding="utf-8") as f:
            for line in f:
                runs.append(json.loads(line))
        runs = [r for r in runs if queries_by_id.get(r["query_id"]) and queries_by_id[r["query_id"]].relevant_sections]

        recalls, ndcgs, latencies = [], [], []
        for run in runs:
            q = queries_by_id[run["query_id"]]
            ranked_ids = [r["chunk_id"] for r in run["results"]]
            is_relevant = build_relevance_predicate(q, chunk_lookup)
            n_relevant = max(sum(1 for cid in chunk_lookup if is_relevant(cid)), 1)
            recalls.append(recall_at_k(ranked_ids, is_relevant, args.k, n_relevant))
            ndcgs.append(ndcg_at_k(ranked_ids, is_relevant, args.k, n_relevant))
            latencies.append(run["latency_ms"])

        r_mean, r_lo, r_hi = bootstrap_ci(recalls)
        n_mean, n_lo, n_hi = bootstrap_ci(ndcgs)
        avg_latency = sum(latencies) / len(latencies) if latencies else 0.0

        print(
            f"{config_id:>8} {len(chunks):>8} {avg_tokens:>8.0f} "
            f"{r_mean:>6.3f} [{r_lo:.3f},{r_hi:.3f}] "
            f"{n_mean:>6.3f} [{n_lo:.3f},{n_hi:.3f}] "
            f"{avg_latency:>12.1f}"
        )
        rows.append((config_id, r_mean, r_lo, r_hi, n_mean, n_lo, n_hi, avg_latency))

    print()
    if len(rows) >= 2:
        best = max(rows, key=lambda r: r[1])
        print(f"Highest mean Recall@{args.k}: {best[0]} ({best[1]:.3f})")
        # Two configs' 95% CIs overlap iff neither's low bound exceeds the
        # other's high bound. rows[i] = (config_id, r_mean, r_lo, r_hi, ...)
        overlapping = [
            r for r in rows
            if r[0] != best[0] and r[2] <= best[3] and best[2] <= r[3]
        ]
        if overlapping:
            names = ", ".join(r[0] for r in overlapping)
            print(f"CIs overlap with: {names} — differences from these configs are NOT statistically "
                  f"significant at 95% confidence with this query count. Do not claim a winner over them.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
