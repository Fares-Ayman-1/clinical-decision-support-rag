#!/usr/bin/env python
"""PLAN.md Phase 5 CLI — chunk data/cleaned/*.json into data/chunks/*.jsonl.

Runs the section-aware chunker (never crosses a section boundary, tables
kept whole, contextual header prefixing, evidence-grade extraction) under
one or both of config/chunking.yaml's two configurations.

Usage:
    python scripts/chunk.py --all --config A
    python scripts/chunk.py --all --config A B
    python scripts/chunk.py --document-id who_acs_stroke --config A
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.ingestion.chunk_document import chunk_document, write_chunks  # noqa: E402
from app.services.ingestion.corpus_config import CORPUS_CONFIG_PATH, load_corpus_config  # noqa: E402
from app.services.ingestion.load_cleaned import load_cleaned_document as _load_cleaned_document  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_CLEANED_DIR = REPO_ROOT / "data" / "cleaned"
DATA_CHUNKS_DIR = REPO_ROOT / "data" / "chunks"
CHUNKING_CONFIG_PATH = REPO_ROOT / "config" / "chunking.yaml"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Chunk every enabled document")
    group.add_argument("--document-id", nargs="+", metavar="ID", help="Chunk specific document_id(s)")
    parser.add_argument(
        "--config", nargs="+", choices=["A", "B"], default=["A"], help="Chunking config(s) to run"
    )
    args = parser.parse_args()

    corpus = load_corpus_config(CORPUS_CONFIG_PATH)
    targets = corpus.enabled_documents() if args.all else [corpus.get(d) for d in args.document_id]

    chunking_cfg = yaml.safe_load(CHUNKING_CONFIG_PATH.read_text(encoding="utf-8"))
    chunking_version = chunking_cfg["chunking_version"]

    print(f"Chunking {len(targets)} document(s) under config(s) {args.config}: "
          f"{[t.document_id for t in targets]}")
    print()

    failures: list[str] = []

    for config_label in args.config:
        cfg = chunking_cfg["configs"][config_label]
        all_chunks = []

        for doc_config in targets:
            try:
                cleaned = _load_cleaned_document(doc_config.document_id)
            except FileNotFoundError as e:
                print(f"--- {doc_config.document_id} [{config_label}] ---\n  FAIL  {e}\n")
                failures.append(doc_config.document_id)
                continue

            t0 = time.time()
            chunks = chunk_document(
                cleaned,
                config_label=config_label,
                target_min_tokens=cfg["target_min_tokens"],
                target_max_tokens=cfg["target_max_tokens"],
                overlap_fraction=cfg["overlap_fraction"],
                chunking_version=chunking_version,
                kb_version=corpus.kb_version,
            )
            elapsed = time.time() - t0
            all_chunks.extend(chunks)

            type_counts = Counter(c.chunk_type for c in chunks)
            token_counts = [c.token_count for c in chunks]
            avg_tokens = sum(token_counts) / len(token_counts) if token_counts else 0.0
            oversized = sum(1 for c in chunks if c.oversized)
            under_min = sum(
                1 for c in chunks if c.token_count < 40 and c.chunk_type != "recommendation"
            )
            inherited = sum(1 for c in chunks if c.section_confidence == "inherited")

            print(f"--- {doc_config.document_id} [{config_label}] ---")
            print(f"  chunks={len(chunks)}  avg_tokens={avg_tokens:.0f}  oversized={oversized}")
            print(f"  types: {dict(type_counts)}")
            print(
                f"  inherited_section_confidence={inherited} "
                f"({100.0 * inherited / len(chunks):.1f}%)" if chunks else "  (no chunks)"
            )
            if under_min:
                print(f"  WARNING: {under_min} chunk(s) under 40 tokens survived that are NOT chunk_type=recommendation (rule 6 violation)")
            print(f"  [{elapsed:.2f}s]")
            print()

        out_path = DATA_CHUNKS_DIR / f"{corpus.kb_version}_{config_label}.jsonl"
        write_chunks(all_chunks, out_path)
        print(f"  wrote {len(all_chunks)} total chunks -> {out_path.relative_to(REPO_ROOT)}")
        print()

    print("=" * 60)
    if failures:
        print(f"FAILED: {sorted(set(failures))}")
    else:
        print(f"All document(s) chunked under config(s) {args.config}.")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
