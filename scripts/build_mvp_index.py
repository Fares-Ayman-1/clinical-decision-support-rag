#!/usr/bin/env python
"""Build the canonical `medical_chunks` MVP serving collection —
ARCHITECTURE.md §8. Distinct from scripts/build_index.py, which builds the
per-config benchmark collections (medical_chunks_S1, ...).

Currently built from the S1 benchmark config (section-aware, 90-140 real
tokens) — the only config proven end-to-end this session (PROJECT-STATE.md
R13: the full 5-config comparison is still incomplete). Swap
--source-config once the comparison finishes and a winner is chosen.

Usage:
    python scripts/build_mvp_index.py --source-config S1 --recreate
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")

from qdrant_client import QdrantClient  # noqa: E402

from app.api.dependencies import qdrant_api_key, qdrant_url  # noqa: E402
from app.services.retrieval.bm25_index import build_bm25_index  # noqa: E402
from app.services.retrieval.embedding_provider import (  # noqa: E402
    SentenceTransformerProvider,
    load_embedding_config,
)
from app.services.retrieval.qdrant_index import build_index, load_chunks  # noqa: E402

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BENCHMARK_CHUNKS_DIR = REPO_ROOT / "data" / "chunks" / "benchmark"
CHUNK_STORE_DIR = REPO_ROOT / "data" / "chunk_store"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-config", default="S1", help="Benchmark config id to serve as the MVP index")
    parser.add_argument("--recreate", action="store_true")
    args = parser.parse_args()

    jsonl_path = BENCHMARK_CHUNKS_DIR / f"1.0_{args.source_config}.jsonl"
    if not jsonl_path.exists():
        print(f"FAIL: no chunk file at {jsonl_path}. Run scripts/chunk_benchmark.py first.")
        return 1

    # Env-driven so this script can seed a REMOTE Qdrant (a hosted
    # deployment starts with an empty volume and returns 503
    # RETRIEVAL_UNAVAILABLE until this runs against it):
    #   QDRANT_URL=https://host:6333 QDRANT_API_KEY=... python scripts/build_mvp_index.py --recreate
    target = qdrant_url()
    print(f"Target Qdrant: {target}" + ("  (with api key)" if qdrant_api_key() else "  (no api key)"))
    # Long timeout: upserting 7,381 points over the public internet is far
    # slower than to localhost, and the default would abort a remote seed
    # part-way through, leaving a half-populated collection.
    client = QdrantClient(url=target, api_key=qdrant_api_key(), timeout=120)
    embedding_cfg = load_embedding_config()
    print(f"Loading {embedding_cfg.name} (max_seq_length={embedding_cfg.max_seq_length})...")
    provider = SentenceTransformerProvider(embedding_cfg)

    chunks = load_chunks(jsonl_path)
    over_ceiling = sum(1 for c in chunks if c["token_count"] > embedding_cfg.max_seq_length)
    print(f"Source: {args.source_config} ({len(chunks)} chunks)")
    if over_ceiling:
        print(
            f"  WARNING: {over_ceiling} chunk(s) ({100*over_ceiling/len(chunks):.1f}%) exceed "
            f"max_seq_length={embedding_cfg.max_seq_length} and will be silently truncated at embed time."
        )

    t0 = time.time()
    texts = [c["embedded_text"] for c in chunks]
    vectors = provider.embed_passages(texts)
    print(f"  embedded in {time.time()-t0:.1f}s")

    t1 = time.time()
    # config_id=None -> the canonical "medical_chunks" collection name,
    # not "medical_chunks_S1" (qdrant_index.collection_name(None)).
    name = build_index(
        client, None, chunks, vectors, embedding_cfg.dim, embedding_cfg.embedding_version,
        recreate=args.recreate,
    )
    print(f"  indexed as '{name}' in {time.time()-t1:.1f}s")

    # Chunk Store: the same JSONL, copied to its own directory under the
    # canonical name so it's addressed independently of the benchmark's
    # per-config files (ARCHITECTURE.md §8: citation resolution must not
    # depend on the vector store, or on which benchmark config produced
    # the source data).
    CHUNK_STORE_DIR.mkdir(parents=True, exist_ok=True)
    store_path = CHUNK_STORE_DIR / "medical_chunks.jsonl"
    store_path.write_text(jsonl_path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"  Chunk Store copied to {store_path.relative_to(REPO_ROOT)}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
