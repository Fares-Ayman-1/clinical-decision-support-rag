#!/usr/bin/env python
"""Automatic failure-mode analysis across chunking benchmark configs
(chunking benchmark plan, "Failure analysis" section). Five of the six
named modes are computed here automatically; "orphaned headers" needs
manual review and is out of scope for this script.

Usage:
    python scripts/analyze_chunk_failures.py --config-id S1 S2 S4 S5 S7
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from app.services.evaluation.relevance import build_relevance_predicate, load_eval_queries  # noqa: E402
from app.services.retrieval.embedding_provider import load_embedding_config  # noqa: E402
from app.services.retrieval.qdrant_index import load_chunks  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
EVAL_DIR = REPO_ROOT / "data" / "evaluation"
RUNS_DIR = EVAL_DIR / "runs"


def analyze_config(config_id: str, split: str = "dev") -> dict:
    chunks = load_chunks(CHUNKS_DIR / f"1.0_{config_id}.jsonl")
    embedding_cfg = load_embedding_config()

    # 4. Tiny chunks: token_count < 40 surviving (should only be chunk_type
    # == "recommendation" per rule 6 — anything else here is a bug).
    tiny_non_recommendation = [c for c in chunks if c["token_count"] < 40 and c["chunk_type"] != "recommendation"]

    # 5. Oversized: over the model's real max_seq_length — will be
    # silently truncated at embed time.
    oversized = [c for c in chunks if c["token_count"] > embedding_cfg.max_seq_length]

    # 1. Split information: sections spanning >1 chunk (by page_start+section_path).
    by_unit = defaultdict(list)
    for c in chunks:
        by_unit[(c["document_id"], c["page_start"], c["section_path"])].append(c)
    unit_sizes = Counter(len(v) for v in by_unit.values())
    multi_chunk_units = {k: v for k, v in by_unit.items() if len(v) > 1}

    # 3. Overlap duplicates: pairs with equal content_hash.
    hash_counts = Counter(c["content_hash"] for c in chunks)
    duplicate_hash_groups = {h: n for h, n in hash_counts.items() if n > 1}

    result = {
        "config_id": config_id,
        "total_chunks": len(chunks),
        "tiny_non_recommendation_count": len(tiny_non_recommendation),
        "oversized_count": len(oversized),
        "oversized_pct": 100 * len(oversized) / len(chunks) if chunks else 0.0,
        "unit_size_distribution": dict(unit_sizes),
        "multi_chunk_unit_count": len(multi_chunk_units),
        "duplicate_content_hash_groups": len(duplicate_hash_groups),
    }

    # 1b (retrieval-dependent). Split-information failure: for each
    # in-domain dev query with a multi-chunk relevant section, check
    # whether ALL of that section's chunks were retrieved together in
    # top-5 — a proxy for "the answer got split across a retrieval
    # boundary and only part of it surfaced."
    run_path = RUNS_DIR / f"{config_id}_{split}.jsonl"
    if run_path.exists():
        queries = load_eval_queries(EVAL_DIR / f"{split}.jsonl")
        queries_by_id = {q.query_id: q for q in queries}
        chunk_lookup = {c["chunk_id"]: c for c in chunks}

        runs = []
        with run_path.open(encoding="utf-8") as f:
            for line in f:
                runs.append(json.loads(line))

        split_info_failures = 0
        checked = 0
        for run in runs:
            q = queries_by_id.get(run["query_id"])
            if not q or not q.relevant_sections:
                continue
            is_relevant = build_relevance_predicate(q, chunk_lookup)
            relevant_chunk_ids = {cid for cid in chunk_lookup if is_relevant(cid)}
            if len(relevant_chunk_ids) <= 1:
                continue
            checked += 1
            top5_ids = {r["chunk_id"] for r in run["results"][:5]}
            if not relevant_chunk_ids.issubset(top5_ids):
                split_info_failures += 1

        result["split_info_checked"] = checked
        result["split_info_failures"] = split_info_failures
    else:
        result["split_info_checked"] = None
        result["split_info_failures"] = None

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-id", nargs="+", required=True)
    parser.add_argument("--split", default="dev")
    args = parser.parse_args()

    print(f"{'config':>8} {'chunks':>8} {'tiny_bug':>9} {'oversized':>12} {'multi_unit':>11} "
          f"{'dup_hash':>9} {'split_fail':>12}")
    for config_id in args.config_id:
        r = analyze_config(config_id, args.split)
        split_fail_str = (
            f"{r['split_info_failures']}/{r['split_info_checked']}"
            if r["split_info_checked"] is not None else "n/a"
        )
        print(
            f"{r['config_id']:>8} {r['total_chunks']:>8} {r['tiny_non_recommendation_count']:>9} "
            f"{r['oversized_count']:>6} ({r['oversized_pct']:.1f}%) {r['multi_chunk_unit_count']:>11} "
            f"{r['duplicate_content_hash_groups']:>9} {split_fail_str:>12}"
        )

    print(
        "\ntiny_bug: rule-6 violations (should always be 0). oversized: chunks exceeding "
        "max_seq_length, silently truncated at embed time. multi_unit: section units spanning "
        ">1 chunk (the population at risk for split-information failures). dup_hash: chunk groups "
        "sharing identical text (legitimate repeated boilerplate unless investigated). "
        "split_fail: in-domain dev queries where a multi-chunk relevant section was NOT fully "
        "retrieved together in top-5, out of queries where that's even possible."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
