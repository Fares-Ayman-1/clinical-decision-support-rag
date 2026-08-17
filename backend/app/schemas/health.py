"""GET /api/health response schema — SPEC.md §F.4.

Field shape matches the frontend's typed Zod schema exactly (each check
has its own concrete fields, not a generic dict) rather than a looser
backend-side shape the frontend would have to loosen around.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class QdrantCheck(BaseModel):
    ok: bool
    points: int


class ChunkStoreCheck(BaseModel):
    ok: bool
    chunks: int


class WarmCheck(BaseModel):
    ok: bool
    warm: bool


class LlmCheck(BaseModel):
    ok: bool


class HealthChecks(BaseModel):
    qdrant: QdrantCheck
    chunk_store: ChunkStoreCheck
    embedding_model: WarmCheck
    reranker: WarmCheck
    llm: LlmCheck


class HealthVersions(BaseModel):
    kb: str
    embedding: str
    prompts: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "down"]
    checks: HealthChecks
    versions: HealthVersions
