"""File validation — the FR-1.9 loud-fail guard.

A PDF with no extractable text layer must stop ingestion with a clear error,
not silently degrade to empty chunks. OCR is explicitly out of MVP scope
(ARCHITECTURE.md §6.1) — all seven corpus documents are born-digital.
"""

from __future__ import annotations

import hashlib
import pathlib
from dataclasses import dataclass

import pymupdf


class NoTextLayerError(RuntimeError):
    """Raised when a PDF has no extractable text on its sampled pages.

    This is a hard stop, not a warning — see FR-1.9 and RAG-1.2.
    """


@dataclass(frozen=True)
class ValidationResult:
    document_id: str
    file: pathlib.Path
    sha256: str
    page_count: int
    sampled_pages_with_text: int
    sampled_pages_total: int


def sha256_of(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_pdf(document_id: str, path: pathlib.Path, sample_size: int = 5) -> ValidationResult:
    """Confirm the PDF exists, opens, and has a text layer.

    Samples up to `sample_size` pages spread across the document rather than
    just the first few — front matter can be image-heavy (cover pages) even
    when the body text is fine, and vice versa.
    """
    if not path.exists():
        raise FileNotFoundError(f"{document_id}: PDF not found at {path}")

    digest = sha256_of(path)

    doc = pymupdf.open(path)
    try:
        page_count = doc.page_count
        if page_count == 0:
            raise NoTextLayerError(f"{document_id}: PDF has zero pages")

        sample_indices = _spread_sample(page_count, sample_size)
        pages_with_text = sum(
            1 for i in sample_indices if doc[i].get_text().strip()
        )

        if pages_with_text == 0:
            raise NoTextLayerError(
                f"{document_id}: no extractable text on any of "
                f"{len(sample_indices)} sampled pages ({sample_indices}). "
                "This looks like a scanned/image-only PDF. OCR is out of "
                "MVP scope (ARCHITECTURE.md §6.1) — ingestion refuses to "
                "proceed rather than silently producing empty chunks."
            )

        return ValidationResult(
            document_id=document_id,
            file=path,
            sha256=digest,
            page_count=page_count,
            sampled_pages_with_text=pages_with_text,
            sampled_pages_total=len(sample_indices),
        )
    finally:
        doc.close()


def _spread_sample(page_count: int, sample_size: int) -> list[int]:
    if page_count <= sample_size:
        return list(range(page_count))
    step = page_count / sample_size
    return sorted({int(i * step) for i in range(sample_size)})
