"""Assembles the full Phase 4 cleaning pipeline over a Phase 3 canonical
document: header/footer removal, boilerplate filtering, text cleaning
(dehyphenation, ligatures, unicode repair), and section detection.

Output feeds Phase 5's section-aware chunker — every retained text block
carries the section_path and section_confidence it needs to build a
citation-ready chunk (ARCHITECTURE.md §6.5).
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
from dataclasses import dataclass, field

from app.services.ingestion.boilerplate_filter import is_worksheet_artifact_line
from app.services.ingestion.corpus_config import DocumentConfig, load_heading_profile
from app.services.ingestion.header_footer import detect_header_footer, is_header_footer_line
from app.services.ingestion.section_detection import (
    assign_sections,
    compute_body_text_size,
    detect_headings_generic,
    detect_headings_hand_tuned,
)
from app.services.ingestion.text_cleaning import clean_line, dehyphenate_lines


@dataclass(frozen=True)
class CleanedBlock:
    block_type: str  # "text" | "table"
    text: str | None = None
    table_markdown: str | None = None
    table_n_rows: int | None = None
    table_n_cols: int | None = None
    table_oversized: bool | None = None


@dataclass(frozen=True)
class CleanedPage:
    page_number: int
    section: str | None
    subsection: str | None
    section_path: str
    section_confidence: str  # "detected" | "inherited"
    blocks: list[CleanedBlock] = field(default_factory=list)


@dataclass(frozen=True)
class CleanedDocument:
    document_id: str
    document_title: str
    organization: str
    publication_year: int | str | None
    source_url: str
    license: str
    domain_tags: list[str]
    tier: int
    prescribing_restricted: bool
    has_evidence_grades: bool
    sha256: str
    page_count: int
    lines_dropped_as_boilerplate: int
    lines_dropped_as_header_footer: int
    lines_dropped_as_worksheet_artifact: int
    pages: list[CleanedPage] = field(default_factory=list)


def clean_document(config: DocumentConfig, parsed_doc: dict) -> CleanedDocument:
    profile = load_heading_profile(config.heading_profile)
    pages = parsed_doc["pages"]
    page_height = pages[0]["height"] if pages else 0.0

    hf_profile = detect_header_footer(config.document_id, pages, page_height)

    if profile["profile_type"] == "hand_tuned":
        headings = detect_headings_hand_tuned(pages, profile)
    else:
        body_size = compute_body_text_size(pages)
        hd = profile.get("heading_detection", {})
        headings = detect_headings_generic(
            pages,
            body_size,
            min_size_delta=hd.get("min_size_delta_over_body", 1.5),
            bold_required_below_delta=hd.get("bold_required_if_size_delta_below", 3.0),
            min_length=hd.get("min_heading_line_length", 3),
            max_length=hd.get("max_heading_line_length", 120),
        )

    section_assignments = assign_sections(pages, headings)

    # A heading LINE is retained as body content too (it's meaningful text,
    # e.g. "Introduction" as a heading also reads fine inline) — it is not
    # stripped here. What Phase 4 strips is header/footer boilerplate,
    # worksheet artifacts, and pages whose ENTIRE heading is an excluded
    # boilerplate section (Contents, References, etc.) — RAG-1.5.

    boilerplate_dropped = 0
    header_footer_dropped = 0
    worksheet_dropped = 0
    cleaned_pages: list[CleanedPage] = []

    for page in pages:
        pno = page["page_number"]
        assignment = section_assignments.get(pno)
        section = assignment.section if assignment else None
        subsection = assignment.subsection if assignment else None
        section_path = assignment.section_path if assignment else "(no section detected)"
        confidence = assignment.confidence if assignment else "inherited"

        # A page whose *current* section is itself boilerplate (e.g. every
        # page under "References") has its entire body dropped — RAG-1.5.
        # Driven by the is_boilerplate flag carried through from
        # detect_headings_*/assign_sections, not re-derived from section
        # text here — re-deriving it from a possibly-None `section` string
        # was the source of a real bug: excluded headings (Contents,
        # Acknowledgements, ...) were being filtered out of detection
        # entirely, so their pages showed as "(no section detected)"
        # instead of being recognized and skipped as boilerplate.
        if assignment and assignment.is_boilerplate:
            boilerplate_dropped += sum(
                1 for b in page["blocks"] if b["block_type"] == "text"
            )
            continue

        raw_lines: list[tuple[str, dict]] = []
        cleaned_blocks: list[CleanedBlock] = []

        for block in page["blocks"]:
            if block["block_type"] == "table":
                cleaned_blocks.append(
                    CleanedBlock(
                        block_type="table",
                        table_markdown=block["table_markdown"],
                        table_n_rows=block["table_n_rows"],
                        table_n_cols=block["table_n_cols"],
                        table_oversized=block["table_oversized"],
                    )
                )
                continue

            text = block["text"]
            y0 = block["y0"]

            if is_header_footer_line(text, y0, hf_profile):
                header_footer_dropped += 1
                continue
            if is_worksheet_artifact_line(text):
                worksheet_dropped += 1
                continue

            raw_lines.append((text, block))

        # De-hyphenate across the page's retained text lines, in original
        # document order, before individual-line cleaning (ligatures, etc.)
        # so a hyphen-broken word is rejoined before unicode normalization
        # could otherwise interfere with the trailing-hyphen match.
        dehyphenated = dehyphenate_lines([t for t, _ in raw_lines])
        for text in dehyphenated:
            cleaned = clean_line(text)
            if cleaned:
                cleaned_blocks.append(CleanedBlock(block_type="text", text=cleaned))

        if not cleaned_blocks:
            continue

        cleaned_pages.append(
            CleanedPage(
                page_number=pno,
                section=section,
                subsection=subsection,
                section_path=section_path,
                section_confidence=confidence,
                blocks=cleaned_blocks,
            )
        )

    return CleanedDocument(
        document_id=parsed_doc["document_id"],
        document_title=parsed_doc["document_title"],
        organization=parsed_doc["organization"],
        publication_year=parsed_doc["publication_year"],
        source_url=parsed_doc["source_url"],
        license=parsed_doc["license"],
        domain_tags=parsed_doc["domain_tags"],
        tier=parsed_doc["tier"],
        prescribing_restricted=parsed_doc["prescribing_restricted"],
        has_evidence_grades=parsed_doc["has_evidence_grades"],
        sha256=parsed_doc["sha256"],
        page_count=parsed_doc["page_count"],
        lines_dropped_as_boilerplate=boilerplate_dropped,
        lines_dropped_as_header_footer=header_footer_dropped,
        lines_dropped_as_worksheet_artifact=worksheet_dropped,
        pages=cleaned_pages,
    )


def write_cleaned_document(doc: CleanedDocument, out_dir: pathlib.Path) -> pathlib.Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{doc.document_id}.json"
    payload = dataclasses.asdict(doc)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path
