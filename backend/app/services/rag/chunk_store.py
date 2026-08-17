"""Chunk Store — ARCHITECTURE.md §8, the authoritative source for every
citation field.

A separate JSONL + in-memory dict, loaded once at startup, independent of
whatever Qdrant's payload happens to contain. This exists specifically so
citation resolution never depends on the vector store returning correct
metadata — if Qdrant's payload were ever wrong, stale, or partially
indexed, a citation built from it could be silently incorrect. The Chunk
Store is the single place a chunk_id is resolved to its real document,
section, and page for anything shown to a user (§12.2 Citation Resolver).
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass


@dataclass(frozen=True)
class ChunkRecord:
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


class ChunkStore:
    def __init__(self, records: dict[str, ChunkRecord]):
        self._records = records

    def get(self, chunk_id: str) -> ChunkRecord | None:
        return self._records.get(chunk_id)

    def __len__(self) -> int:
        return len(self._records)

    def __contains__(self, chunk_id: str) -> bool:
        return chunk_id in self._records

    def all_chunk_ids(self) -> list[str]:
        return list(self._records.keys())


def load_chunk_store(jsonl_path: pathlib.Path) -> ChunkStore:
    records: dict[str, ChunkRecord] = {}
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            record = ChunkRecord(
                chunk_id=row["chunk_id"],
                document_id=row["document_id"],
                document_title=row["document_title"],
                organization=row["organization"],
                publication_year=row["publication_year"],
                source_url=row["source_url"],
                license=row["license"],
                section=row["section"],
                subsection=row["subsection"],
                section_path=row["section_path"],
                section_confidence=row["section_confidence"],
                page_start=row["page_start"],
                page_end=row["page_end"],
                domains=row["domains"],
                chunk_type=row["chunk_type"],
                evidence_grade=row["evidence_grade"],
                recommendation_class=row["recommendation_class"],
                text=row["text"],
                token_count=row["token_count"],
                content_hash=row["content_hash"],
                kb_version=row["kb_version"],
                chunking_version=row["chunking_version"],
                embedding_version=row["embedding_version"],
            )
            if record.chunk_id in records:
                raise ValueError(f"Duplicate chunk_id in Chunk Store source: {record.chunk_id!r}")
            records[record.chunk_id] = record
    return ChunkStore(records)
