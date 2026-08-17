"""GET /api/evidence/{chunk_id} response schema — SPEC.md §F.3.

Field-for-field the Chunk Store's ChunkRecord (backend/app/services/rag/
chunk_store.py), the authoritative source for every citation field
(ARCHITECTURE.md §8).
"""

from __future__ import annotations

from pydantic import BaseModel


class EvidenceDetailOut(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    organization: str
    publication_year: int | str | None
    source_url: str
    license: str
    section: str | None
    subsection: str | None
    section_path: str
    section_confidence: str
    page_start: int
    page_end: int
    domains: list[str]
    chunk_type: str
    evidence_grade: str | None
    recommendation_class: str | None
    text: str
    token_count: int
    content_hash: str
    kb_version: str
    chunking_version: str
    embedding_version: str
