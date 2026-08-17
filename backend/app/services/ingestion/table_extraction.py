"""pdfplumber table extraction, with the mandatory false-positive filter.

docs/corpus-profile.md finding: raw pdfplumber.find_tables() misdetects
running headers/footers and ToC layout as 1-row/1-column "tables" — confirmed
93.4% false-positive rate on who_dcm's front matter before filtering. The
`min_rows: 2, min_columns: 2` threshold (config/heading_profiles/generic.yaml
`table_detection`) is not optional; skipping it pollutes the corpus with
junk tagged chunk_type: table.

RAG-2.4: a table occupies exactly one chunk and is never split. This module
converts each confirmed real table to Markdown so it survives as a single
coherent unit through chunking.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

import pdfplumber

MIN_ROWS = 2
MIN_COLUMNS = 2
MIN_NON_EMPTY_CELL_FRACTION = 0.5
MIN_BBOX_AREA_PT2 = 8000.0


@dataclass(frozen=True)
class ExtractedTable:
    page_number: int  # 0-indexed, matches text_extraction's page_number convention
    bbox: tuple[float, float, float, float]
    n_rows: int
    n_cols: int
    markdown: str
    oversized: bool  # RAG-2.4: flagged, never split


def extract_tables(
    path: pathlib.Path,
    min_rows: int = MIN_ROWS,
    min_cols: int = MIN_COLUMNS,
    min_non_empty_fraction: float = MIN_NON_EMPTY_CELL_FRACTION,
    min_bbox_area: float = MIN_BBOX_AREA_PT2,
) -> list[ExtractedTable]:
    tables: list[ExtractedTable] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for t in page.find_tables():
                rows = t.extract()
                if not rows:
                    continue
                n_rows = len(rows)
                n_cols = max((len(r) for r in rows), default=0)
                if n_rows < min_rows or n_cols < min_cols:
                    continue  # shape false positive per docs/corpus-profile.md — drop, don't warn per-hit
                if _non_empty_fraction(rows) < min_non_empty_fraction:
                    # Sparse-cell false positive: a real bounding box with mostly
                    # blank cells (e.g. a cover-page title caught inside a
                    # near-full-page phantom grid). Found during Phase 3
                    # verification on who_acs_stroke page 0 — the row/column
                    # shape filter alone was not sufficient.
                    continue
                x0, y0, x1, y1 = t.bbox
                if (x1 - x0) * (y1 - y0) < min_bbox_area:
                    # Tiny-fragment false positive: a small icon/diagram-label
                    # region (e.g. an SpO2 figure annotation) that happens to
                    # have a dense, non-empty 2x2 grid shape. Found on
                    # who_sari page 215 during Phase 3 verification — real
                    # data tables in this corpus span tens of thousands of
                    # sq-pt; this one was ~2,100.
                    continue
                tables.append(
                    ExtractedTable(
                        page_number=page.page_number - 1,  # pdfplumber is 1-indexed; normalize to 0-indexed
                        bbox=tuple(t.bbox),
                        n_rows=n_rows,
                        n_cols=n_cols,
                        markdown=_rows_to_markdown(rows),
                        oversized=n_rows > 40,  # a table this long will exceed the chunk token budget
                    )
                )
    return tables


def _non_empty_fraction(rows: list[list[str | None]]) -> float:
    total = 0
    non_empty = 0
    for row in rows:
        for cell in row:
            total += 1
            if cell is not None and cell.strip():
                non_empty += 1
    return non_empty / total if total else 0.0


def _rows_to_markdown(rows: list[list[str | None]]) -> str:
    def clean(cell: str | None) -> str:
        if cell is None:
            return ""
        return " ".join(cell.split()).replace("|", "\\|")

    header = rows[0]
    body = rows[1:]

    lines = ["| " + " | ".join(clean(c) for c in header) + " |"]
    lines.append("| " + " | ".join("---" for _ in header) + " |")
    for row in body:
        # Pad short rows so column count stays consistent with the header.
        padded = list(row) + [None] * (len(header) - len(row))
        lines.append("| " + " | ".join(clean(c) for c in padded[: len(header)]) + " |")

    return "\n".join(lines)
