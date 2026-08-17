#!/usr/bin/env python
"""Phase 6 chunking-strategy benchmark — chunk data/cleaned/*.json under
config/chunking.yaml's benchmark_configs (S1-S7) using real token counts.

Registers the actual embedding model's tokenizer (config/embedding.yaml)
before chunking, so target_min/max_tokens are measured in real BPE tokens,
not the provisional word-count approximation — this is what makes the
screening sizes' relationship to the model's max_seq_length trustworthy.

Usage:
    python scripts/chunk_benchmark.py --all
    python scripts/chunk_benchmark.py --all --config-id S1 S2
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.ingestion.chunk_document import write_chunks  # noqa: E402
from app.services.ingestion.chunking_strategies import (  # noqa: E402
    StrategyParams,
    chunk_document_with_strategy,
)
from app.services.ingestion.corpus_config import CORPUS_CONFIG_PATH, load_corpus_config  # noqa: E402
from app.services.ingestion.load_cleaned import load_cleaned_document  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
CHUNKING_CONFIG_PATH = REPO_ROOT / "config" / "chunking.yaml"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Chunk every enabled document")
    group.add_argument("--document-id", nargs="+", metavar="ID", help="Chunk specific document_id(s)")
    parser.add_argument(
        "--config-id", nargs="+", default=None,
        help="Benchmark config id(s) to run (default: all of S1-S7 in config/chunking.yaml)",
    )
    args = parser.parse_args()

    corpus = load_corpus_config(CORPUS_CONFIG_PATH)
    targets = corpus.enabled_documents() if args.all else [corpus.get(d) for d in args.document_id]

    chunking_cfg = yaml.safe_load(CHUNKING_CONFIG_PATH.read_text(encoding="utf-8"))
    benchmark_configs = chunking_cfg["benchmark_configs"]
    chunking_version = chunking_cfg["benchmark_chunking_version"]
    config_ids = args.config_id or list(benchmark_configs.keys())

    print(f"Loading embedding model to register the real tokenizer (R10 fix)...")
    embedding_cfg = load_embedding_config()
    provider = SentenceTransformerProvider(embedding_cfg)
    print(f"  {embedding_cfg.name}  max_seq_length={embedding_cfg.max_seq_length}  dim={embedding_cfg.dim}")
    print()

    print(f"Chunking {len(targets)} document(s) under {len(config_ids)} benchmark config(s): "
          f"{config_ids}")
    print()

    over_ceiling_total = 0
    all_config_totals: dict[str, int] = {}

    for config_id in config_ids:
        if config_id not in benchmark_configs:
            print(f"Unknown benchmark config_id {config_id!r}; skipping.")
            continue
        cfg = benchmark_configs[config_id]
        params = StrategyParams(
            target_min_tokens=cfg["target_min_tokens"],
            target_max_tokens=cfg["target_max_tokens"],
            overlap_fraction=cfg["overlap_fraction"],
        )
        strategy_name = cfg["strategy"]

        all_chunks = []
        for doc_config in targets:
            cleaned = load_cleaned_document(doc_config.document_id)
            t0 = time.time()
            chunks = chunk_document_with_strategy(
                cleaned,
                config_id=config_id,
                strategy_name=strategy_name,
                params=params,
                chunking_version=chunking_version,
                kb_version=corpus.kb_version,
                embedding_version=embedding_cfg.embedding_version,
            )
            elapsed = time.time() - t0
            all_chunks.extend(chunks)

            over_ceiling = sum(1 for c in chunks if c.token_count > embedding_cfg.max_seq_length)
            over_ceiling_total += over_ceiling

            print(f"--- {doc_config.document_id} [{config_id}/{strategy_name}] ---")
            type_counts = Counter(c.chunk_type for c in chunks)
            avg_tokens = sum(c.token_count for c in chunks) / len(chunks) if chunks else 0.0
            print(f"  chunks={len(chunks)}  avg_tokens={avg_tokens:.0f}  types={dict(type_counts)}")
            if over_ceiling:
                print(f"  WARNING: {over_ceiling} chunk(s) exceed max_seq_length={embedding_cfg.max_seq_length} "
                      f"and will be silently truncated at embed time")
            print(f"  [{elapsed:.2f}s]")

        out_path = DATA_CHUNKS_DIR / f"{corpus.kb_version}_{config_id}.jsonl"
        write_chunks(all_chunks, out_path)
        all_config_totals[config_id] = len(all_chunks)
        print(f"  wrote {len(all_chunks)} total chunks -> {out_path.relative_to(REPO_ROOT)}")
        print()

    print("=" * 60)
    for config_id, total in all_config_totals.items():
        print(f"  {config_id}: {total} chunks")
    if over_ceiling_total:
        print(f"\nTOTAL chunks exceeding max_seq_length across all configs: {over_ceiling_total}")
    print("Done.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
