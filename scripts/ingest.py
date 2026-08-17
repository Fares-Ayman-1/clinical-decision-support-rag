#!/usr/bin/env python
"""PLAN.md Phase 3 CLI — parse corpus PDFs into data/parsed/{document_id}.json.

Usage:
    python scripts/ingest.py --all
    python scripts/ingest.py --document-id who_acs_stroke who_bec
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.ingestion.canonical_document import (  # noqa: E402
    build_canonical_document,
    write_canonical_document,
)
from app.services.ingestion.corpus_config import (  # noqa: E402
    CORPUS_CONFIG_PATH,
    load_corpus_config,
)
from app.services.ingestion.validation import NoTextLayerError  # noqa: E402

PARSE_QUALITY_WARN_THRESHOLD = 95.0
DATA_PARSED_DIR = Path(__file__).resolve().parents[1] / "data" / "parsed"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Ingest every enabled document")
    group.add_argument(
        "--document-id", nargs="+", metavar="ID", help="Ingest specific document_id(s)"
    )
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Also ingest documents with enabled: false in corpus.yaml (debugging only)",
    )
    args = parser.parse_args()

    corpus = load_corpus_config(CORPUS_CONFIG_PATH)

    if args.all:
        targets = corpus.documents if args.include_disabled else corpus.enabled_documents()
    else:
        targets = [corpus.get(doc_id) for doc_id in args.document_id]
        skipped = [t.document_id for t in targets if not t.enabled and not args.include_disabled]
        if skipped:
            print(
                f"NOTE: {skipped} are disabled in corpus.yaml (Tier 2 demotion). "
                "Pass --include-disabled to force.",
                file=sys.stderr,
            )
            targets = [t for t in targets if t.enabled or args.include_disabled]

    if not targets:
        print("Nothing to ingest.", file=sys.stderr)
        return 1

    print(f"Ingesting {len(targets)} document(s): {[t.document_id for t in targets]}")
    print()

    failures: list[str] = []
    warnings: list[str] = []

    for config in targets:
        t0 = time.time()
        print(f"--- {config.document_id} ({config.file.name}) ---")
        try:
            doc, validation = build_canonical_document(config)
        except FileNotFoundError as e:
            print(f"  FAIL  {e}")
            failures.append(config.document_id)
            continue
        except NoTextLayerError as e:
            print(f"  FAIL  {e}")
            failures.append(config.document_id)
            continue

        out_path = write_canonical_document(doc, DATA_PARSED_DIR)
        elapsed = time.time() - t0

        quality = doc.parse_quality_pct
        quality_flag = "OK" if quality >= PARSE_QUALITY_WARN_THRESHOLD else "WARN"
        if quality_flag == "WARN":
            warnings.append(
                f"{config.document_id}: parse quality {quality:.1f}% "
                f"< {PARSE_QUALITY_WARN_THRESHOLD:.0f}% threshold"
            )

        n_tables = sum(
            1 for p in doc.pages for b in p.blocks if b.block_type == "table"
        )
        print(f"  pages={doc.page_count}  parse_quality={quality:.1f}% [{quality_flag}]  tables={n_tables}")
        print(f"  sha256={validation.sha256[:16]}...  wrote {out_path.relative_to(out_path.parents[2])}  [{elapsed:.1f}s]")
        print()

    print("=" * 60)
    if failures:
        print(f"FAILED: {failures}")
    if warnings:
        print("PARSE QUALITY WARNINGS:")
        for w in warnings:
            print(f"  - {w}")
    if not failures and not warnings:
        print(f"All {len(targets)} document(s) ingested cleanly.")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
