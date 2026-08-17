"""Retrieval eval runner — retrieves top-10 once per (config, query) and
persists the full ranked list plus latency to
data/evaluation/runs/{config_id}_{split}.jsonl.

Metrics are computed in a SEPARATE pass (scripts/evaluate.py) over these
persisted files, not here. This split is what makes the Top-K sweep free:
K=1,3,5,10 (or any future K) are all read off the same persisted top-10
list without re-retrieving.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib

from qdrant_client import QdrantClient

from app.services.evaluation.relevance import EvalQuery
from app.services.retrieval.bm25_index import BM25Index
from app.services.retrieval.embedding_provider import SentenceTransformerProvider
from app.services.retrieval.hybrid_search import RetrievalRun, hybrid_search


def run_eval(
    client: QdrantClient,
    config_id: str,
    provider: SentenceTransformerProvider,
    bm25: BM25Index,
    queries: list[EvalQuery],
) -> list[RetrievalRun]:
    runs = []
    for q in queries:
        run = hybrid_search(client, config_id, provider, bm25, q.query, q.query_id, top_k=10)
        runs.append(run)
    return runs


def write_runs(runs: list[RetrievalRun], out_path: pathlib.Path) -> pathlib.Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for run in runs:
            payload = {
                "query_id": run.query_id,
                "config_id": run.config_id,
                "latency_ms": run.latency_ms,
                "results": [dataclasses.asdict(r) for r in run.results],
            }
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return out_path


def load_runs(path: pathlib.Path) -> list[dict]:
    runs = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            runs.append(json.loads(line))
    return runs
