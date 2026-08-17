"""PyMuPDF text + layout extraction, page-anchored.

FR-1.2: the page number is captured here, at extraction time, and is never
recomputed or inferred downstream. Every TextLine below carries the exact
0-indexed PDF page it came from for its entire lifetime through the pipeline.

Column-aware reading order (docs/corpus-profile.md, hazard
`two_column_reading_order`): uspstf_cvd_risk and uspstf_no_cvd_risk have a
genuine two-column layout that PyMuPDF's default block order does not
preserve correctly. This module sorts lines by x-band first, then by y
within each band, for every document — it is a no-op for single-column
documents and a correctness fix for the two-column ones.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

import pymupdf


@dataclass(frozen=True)
class TextLine:
    page_number: int  # 0-indexed, exactly as PyMuPDF reports it — never recomputed
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    font_sizes: tuple[float, ...]  # one per span on the line, for heading detection in Phase 4
    fonts: tuple[str, ...]
    bold: bool


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int  # 0-indexed
    width: float
    height: float
    lines: list[TextLine]


def extract_pages(path: pathlib.Path, column_band_width_frac: float = 0.5) -> list[ExtractedPage]:
    """Extract every page's text lines in column-aware reading order.

    `column_band_width_frac` splits the page into left/right bands at the
    page midpoint by default. For genuinely single-column documents this has
    no effect, since every line falls in the left band and y-order is
    preserved. For the confirmed two-column USPSTF documents, it prevents
    text from column B interleaving with column A mid-sentence.
    """
    doc = pymupdf.open(path)
    try:
        pages: list[ExtractedPage] = []
        for page in doc:
            width, height = page.rect.width, page.rect.height
            band_x = width * column_band_width_frac
            lines: list[TextLine] = []

            for block in page.get_text("dict")["blocks"]:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    spans = [s for s in line["spans"] if s["text"].strip()]
                    if not spans:
                        continue
                    text = "".join(s["text"] for s in spans)
                    x0, y0, x1, y1 = line["bbox"]
                    lines.append(
                        TextLine(
                            page_number=page.number,
                            x0=x0,
                            y0=y0,
                            x1=x1,
                            y1=y1,
                            text=text,
                            font_sizes=tuple(round(s["size"], 1) for s in spans),
                            fonts=tuple(s["font"] for s in spans),
                            bold=any(_looks_bold(s["font"]) for s in spans),
                        )
                    )

            lines.sort(key=lambda ln: (0 if ln.x0 < band_x else 1, ln.y0, ln.x0))
            pages.append(
                ExtractedPage(page_number=page.number, width=width, height=height, lines=lines)
            )
        return pages
    finally:
        doc.close()


def _looks_bold(font_name: str) -> bool:
    lowered = font_name.lower()
    return "bold" in lowered or "semibold" in lowered or "black" in lowered
