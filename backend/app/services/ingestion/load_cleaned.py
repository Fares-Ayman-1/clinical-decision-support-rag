"""Shared loader: data/cleaned/{document_id}.json -> CleanedDocument.

Extracted from scripts/chunk.py so scripts/chunk_benchmark.py doesn't
duplicate this deserialization logic.
"""

from __future__ import annotations

import json
import pathlib

from app.services.ingestion.clean_document import CleanedBlock, CleanedDocument, CleanedPage

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
DATA_CLEANED_DIR = REPO_ROOT / "data" / "cleaned"


def load_cleaned_document(document_id: str, cleaned_dir: pathlib.Path = DATA_CLEANED_DIR) -> CleanedDocument:
    path = cleaned_dir / f"{document_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No cleaned JSON at {path}. Run scripts/clean.py first.")
    raw = json.loads(path.read_text(encoding="utf-8"))
    pages = [
        CleanedPage(
            page_number=p["page_number"],
            section=p["section"],
            subsection=p["subsection"],
            section_path=p["section_path"],
            section_confidence=p["section_confidence"],
            blocks=[CleanedBlock(**b) for b in p["blocks"]],
        )
        for p in raw["pages"]
    ]
    return CleanedDocument(
        document_id=raw["document_id"],
        document_title=raw["document_title"],
        organization=raw["organization"],
        publication_year=raw["publication_year"],
        source_url=raw["source_url"],
        license=raw["license"],
        domain_tags=raw["domain_tags"],
        tier=raw["tier"],
        prescribing_restricted=raw["prescribing_restricted"],
        has_evidence_grades=raw["has_evidence_grades"],
        sha256=raw["sha256"],
        page_count=raw["page_count"],
        lines_dropped_as_boilerplate=raw["lines_dropped_as_boilerplate"],
        lines_dropped_as_header_footer=raw["lines_dropped_as_header_footer"],
        lines_dropped_as_worksheet_artifact=raw["lines_dropped_as_worksheet_artifact"],
        pages=pages,
    )
