#!/usr/bin/env python
"""Build Qdrant + BM25 indexes for one or more benchmark chunking configs.

Refuses to silently rebuild a collection with a mismatched embedding_version
unless --recreate is passed. Warns loudly, with a count, when any chunk
exceeds the embedding model's max_seq_length (R10/finding 2 — a chunk that
size will be silently truncated by the model at embed time, and this
warning is the only thing standing between that and an invisible data-
quality bug).

Usage:
    python scripts/build_index.py --config-id S1 S2 S3 S4 S5 S6 S7
    python scripts/build_index.py --config-id S1 --recreate
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from qdrant_client import QdrantClient  # noqa: E402

from app.services.retrieval.bm25_index import build_bm25_index  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.qdrant_index import build_index, load_chunks  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
QDRANT_URL = "http://localhost:6333"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-id", nargs="+", required=True, help="Benchmark config id(s), e.g. S1 S2")
    parser.add_argument("--recreate", action="store_true", help="Rebuild even if collection exists")
    args = parser.parse_args()

    client = QdrantClient(url=QDRANT_URL)
    embedding_cfg = load_embedding_config()
    print(f"Loading {embedding_cfg.name} (max_seq_length={embedding_cfg.max_seq_length})...")
    provider = SentenceTransformerProvider(embedding_cfg)

    for config_id in args.config_id:
        jsonl_path = CHUNKS_DIR / f"1.0_{config_id}.jsonl"
        if not jsonl_path.exists():
            print(f"SKIP {config_id}: no chunk file at {jsonl_path}. Run scripts/chunk_benchmark.py first.")
            continue

        chunks = load_chunks(jsonl_path)
        over_ceiling = sum(1 for c in chunks if c["token_count"] > embedding_cfg.max_seq_length)

        print(f"--- {config_id}: {len(chunks)} chunks ---")
        if over_ceiling:
            print(
                f"  WARNING: {over_ceiling} chunk(s) ({100*over_ceiling/len(chunks):.1f}%) exceed "
                f"max_seq_length={embedding_cfg.max_seq_length} and will be silently truncated at embed time."
            )

        t0 = time.time()
        texts = [c["embedded_text"] for c in chunks]
        vectors = provider.embed_passages(texts)
        embed_time = time.time() - t0

        t1 = time.time()
        name = build_index(
            client, config_id, chunks, vectors, embedding_cfg.dim, embedding_cfg.embedding_version,
            recreate=args.recreate,
        )
        index_time = time.time() - t1

        t2 = time.time()
        bm25 = build_bm25_index(chunks)
        bm25_time = time.time() - t2

        print(f"  embedded in {embed_time:.1f}s, indexed in {index_time:.1f}s, BM25 built in {bm25_time:.1f}s")
        print(f"  collection={name}  points={len(chunks)}")
        print()

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
