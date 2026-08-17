#!/usr/bin/env python
"""PLAN.md Phase 4 CLI — clean data/parsed/*.json into data/cleaned/*.json.

Runs header/footer removal, boilerplate filtering, text cleaning
(dehyphenation, ligature/unicode repair), and section detection.

Usage:
    python scripts/clean.py --all
    python scripts/clean.py --document-id who_acs_stroke who_bec
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.services.ingestion.clean_document import clean_document, write_cleaned_document  # noqa: E402
from app.services.ingestion.corpus_config import (  # noqa: E402
    CORPUS_CONFIG_PATH,
    load_corpus_config,
)

DATA_PARSED_DIR = Path(__file__).resolve().parents[1] / "data" / "parsed"
DATA_CLEANED_DIR = Path(__file__).resolve().parents[1] / "data" / "cleaned"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="Clean every enabled document")
    group.add_argument("--document-id", nargs="+", metavar="ID", help="Clean specific document_id(s)")
    args = parser.parse_args()

    corpus = load_corpus_config(CORPUS_CONFIG_PATH)
    targets = corpus.enabled_documents() if args.all else [corpus.get(d) for d in args.document_id]

    print(f"Cleaning {len(targets)} document(s): {[t.document_id for t in targets]}")
    print()

    failures: list[str] = []

    for config in targets:
        parsed_path = DATA_PARSED_DIR / f"{config.document_id}.json"
        if not parsed_path.exists():
            print(f"--- {config.document_id} ---\n  FAIL  no parsed JSON at {parsed_path}. Run scripts/ingest.py first.\n")
            failures.append(config.document_id)
            continue

        t0 = time.time()
        parsed_doc = json.loads(parsed_path.read_text(encoding="utf-8"))
        cleaned = clean_document(config, parsed_doc)
        out_path = write_cleaned_document(cleaned, DATA_CLEANED_DIR)
        elapsed = time.time() - t0

        total_pages_in = parsed_doc["page_count"]
        total_pages_out = len(cleaned.pages)
        detected = sum(1 for p in cleaned.pages if p.section_confidence == "detected")
        inherited = sum(1 for p in cleaned.pages if p.section_confidence == "inherited")
        detect_rate = 100.0 * detected / total_pages_out if total_pages_out else 0.0

        print(f"--- {config.document_id} ---")
        print(
            f"  pages_in={total_pages_in}  pages_out={total_pages_out}  "
            f"(dropped {total_pages_in - total_pages_out} boilerplate pages)"
        )
        print(
            f"  section detection: {detected} detected ({detect_rate:.1f}%), "
            f"{inherited} inherited"
        )
        print(
            f"  lines dropped: header/footer={cleaned.lines_dropped_as_header_footer}  "
            f"worksheet={cleaned.lines_dropped_as_worksheet_artifact}  "
            f"boilerplate-page={cleaned.lines_dropped_as_boilerplate}"
        )
        print(f"  wrote {out_path.relative_to(out_path.parents[2])}  [{elapsed:.1f}s]")
        print()

    print("=" * 60)
    if failures:
        print(f"FAILED: {failures}")
    else:
        print(f"All {len(targets)} document(s) cleaned.")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
