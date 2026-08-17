"""Assembles the Canonical Document Object — data/parsed/{document_id}.json.

This is Phase 3's terminal output. It carries raw extracted text lines and
tables per page, anchored to exact page numbers, with nothing cleaned or
segmented into sections yet — that is Phase 4/5's job. Phase 3's contract is
narrower and stricter: extraction must be faithful to the source PDF, not
already interpreted.

Tables are merged into their page's line stream in document order (by y
position) so a downstream section-aware chunker sees a single ordered
sequence per page, with each table represented as one atomic block that
carries its own Markdown rather than raw cell text.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
from dataclasses import dataclass, field

from app.services.ingestion.corpus_config import DocumentConfig
from app.services.ingestion.table_extraction import ExtractedTable, extract_tables
from app.services.ingestion.text_extraction import ExtractedPage, TextLine, extract_pages
from app.services.ingestion.validation import ValidationResult, validate_pdf


@dataclass(frozen=True)
class PageBlock:
    """One ordered unit on a page — either a text line or a whole table."""

    block_type: str  # "text" | "table"
    y0: float
    text: str | None = None
    font_sizes: tuple[float, ...] | None = None
    bold: bool | None = None
    table_markdown: str | None = None
    table_n_rows: int | None = None
    table_n_cols: int | None = None
    table_oversized: bool | None = None


@dataclass(frozen=True)
class CanonicalPage:
    page_number: int  # 0-indexed — exact PDF page, never recomputed
    width: float
    height: float
    blocks: list[PageBlock]


@dataclass(frozen=True)
class CanonicalDocument:
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
    parse_quality_pct: float
    pages: list[CanonicalPage] = field(default_factory=list)


def build_canonical_document(config: DocumentConfig) -> tuple[CanonicalDocument, ValidationResult]:
    validation = validate_pdf(config.document_id, config.file)

    text_pages = extract_pages(config.file)
    tables = extract_tables(config.file)

    tables_by_page: dict[int, list[ExtractedTable]] = {}
    for t in tables:
        tables_by_page.setdefault(t.page_number, []).append(t)

    canonical_pages = [
        _merge_page(page, tables_by_page.get(page.page_number, []))
        for page in text_pages
    ]

    non_empty_pages = sum(1 for p in canonical_pages if p.blocks)
    parse_quality_pct = 100.0 * non_empty_pages / len(canonical_pages) if canonical_pages else 0.0

    doc = CanonicalDocument(
        document_id=config.document_id,
        document_title=config.title,
        organization=config.organization,
        publication_year=config.publication_year,
        source_url=config.source_url,
        license=config.license,
        domain_tags=config.domains,
        tier=config.tier,
        prescribing_restricted=config.prescribing_restricted,
        has_evidence_grades=config.has_evidence_grades,
        sha256=validation.sha256,
        page_count=validation.page_count,
        parse_quality_pct=round(parse_quality_pct, 2),
        pages=canonical_pages,
    )
    return doc, validation


def _merge_page(page: ExtractedPage, tables: list[ExtractedTable]) -> CanonicalPage:
    blocks: list[PageBlock] = []

    for line in page.lines:
        blocks.append(
            PageBlock(
                block_type="text",
                y0=line.y0,
                text=line.text,
                font_sizes=line.font_sizes,
                bold=line.bold,
            )
        )

    for t in tables:
        # Anchor the table block at its bounding box top so it interleaves
        # correctly with surrounding text lines in reading order.
        blocks.append(
            PageBlock(
                block_type="table",
                y0=t.bbox[1],
                table_markdown=t.markdown,
                table_n_rows=t.n_rows,
                table_n_cols=t.n_cols,
                table_oversized=t.oversized,
            )
        )

    # A table's constituent cell text was already captured as separate text
    # lines by PyMuPDF above. Once the table block is inserted, drop text
    # lines whose bbox falls fully inside any table's bbox on this page so
    # the same content doesn't appear twice — once as raw lines, once as
    # the table's Markdown.
    table_bboxes = [_table_bbox(t) for t in tables]
    if table_bboxes:
        blocks = [
            b
            for b in blocks
            if b.block_type == "table" or not _line_inside_any(b, page.lines, table_bboxes)
        ]

    blocks.sort(key=lambda b: b.y0)
    return CanonicalPage(page_number=page.page_number, width=page.width, height=page.height, blocks=blocks)


def _table_bbox(t: ExtractedTable) -> tuple[float, float, float, float]:
    return t.bbox


def _line_inside_any(block: PageBlock, lines: list[TextLine], bboxes: list[tuple[float, float, float, float]]) -> bool:
    if block.block_type != "text":
        return False
    # Reconstruct approximate line bbox from the block's y0 and matching text.
    # We match by (text, y0) against the original lines list since PageBlock
    # doesn't carry x-coordinates — cheap enough at per-page scale.
    for line in lines:
        if line.text == block.text and abs(line.y0 - block.y0) < 0.5:
            for x0, y0, x1, y1 in bboxes:
                if x0 - 2 <= line.x0 and line.x1 <= x1 + 2 and y0 - 2 <= line.y0 and line.y1 <= y1 + 2:
                    return True
    return False


def write_canonical_document(doc: CanonicalDocument, out_dir: pathlib.Path) -> pathlib.Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{doc.document_id}.json"
    payload = dataclasses.asdict(doc)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path
