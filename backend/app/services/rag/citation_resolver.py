"""Citation Resolver — ARCHITECTURE.md §12.2, §12.3, PLAN.md Phase 12.

Two jobs:
1. Programmatic validation of the generator's structured output — every
   check here is deterministic (no LLM call), replacing what an earlier
   design spent two extra LLM round-trips on.
2. Resolving each surviving evidence_id -> chunk_id -> the real
   document_title/section/page/evidence_grade/source_url from the Chunk
   Store, which is the only place that metadata exists — the generator
   was never shown it (§12.2), so it structurally cannot fabricate it.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.prompts.schemas import GroundedGeneration
from app.services.rag.chunk_store import ChunkStore
from app.services.rag.evidence_pack import EvidencePack


@dataclass(frozen=True)
class ResolvedCitation:
    evidence_id: str
    chunk_id: str
    document_id: str
    document_title: str
    organization: str
    section_path: str
    page_start: int
    page_end: int
    evidence_grade: str | None
    source_url: str
    license: str


@dataclass(frozen=True)
class ResolvedStatement:
    text: str
    citations: list[ResolvedCitation]


@dataclass(frozen=True)
class ResolvedExcerpt:
    evidence_id: str
    quote: str
    citation: ResolvedCitation


@dataclass(frozen=True)
class ValidationDrop:
    kind: str  # "statement" | "excerpt"
    reason: str
    content: str


@dataclass(frozen=True)
class ResolvedAnswer:
    statements: list[ResolvedStatement]
    excerpts: list[ResolvedExcerpt]
    limitations: list[str]
    conflicts: list[dict]
    dropped: list[ValidationDrop]
    fell_back_to_refusal: bool


def _resolve_citation(evidence_id: str, pack: EvidencePack, chunk_store: ChunkStore) -> ResolvedCitation | None:
    item = next((e for e in pack.evidence if e.evidence_id == evidence_id), None)
    if item is None:
        return None
    record = chunk_store.get(item.chunk_id)
    if record is None:
        return None
    return ResolvedCitation(
        evidence_id=evidence_id,
        chunk_id=record.chunk_id,
        document_id=record.document_id,
        document_title=record.document_title,
        organization=record.organization,
        section_path=record.section_path,
        page_start=record.page_start,
        page_end=record.page_end,
        evidence_grade=record.evidence_grade,
        source_url=record.source_url,
        license=record.license,
    )


def resolve_and_validate(
    generation: GroundedGeneration, pack: EvidencePack, chunk_store: ChunkStore
) -> ResolvedAnswer:
    valid_ids = {e.evidence_id for e in pack.evidence}
    dropped: list[ValidationDrop] = []

    # Check 1 + 2: every statement cited (schema already enforces
    # min_length=1 on evidence_ids — see schemas.py — so this loop's real
    # job is check 2, referenced ids must exist in the pack) — a model
    # violating check 1 never reaches here at all, since complete_structured
    # already rejected/retried on that schema violation.
    resolved_statements: list[ResolvedStatement] = []
    for stmt in generation.statements:
        citations = []
        all_ids_valid = True
        for eid in stmt.evidence_ids:
            if eid not in valid_ids:
                all_ids_valid = False
                break
            citation = _resolve_citation(eid, pack, chunk_store)
            if citation is None:
                all_ids_valid = False
                break
            citations.append(citation)

        if not all_ids_valid or not citations:
            dropped.append(ValidationDrop(kind="statement", reason="referenced an invalid or unresolvable evidence_id", content=stmt.text))
            continue
        resolved_statements.append(ResolvedStatement(text=stmt.text, citations=citations))

    # Check 3: excerpts verbatim — quote must be a real substring of the
    # cited chunk's text, checked against the Chunk Store's authoritative
    # text, not the (possibly hallucinated) text the model might echo back.
    resolved_excerpts: list[ResolvedExcerpt] = []
    for excerpt in generation.excerpts:
        if excerpt.evidence_id not in valid_ids:
            dropped.append(ValidationDrop(kind="excerpt", reason="unknown evidence_id", content=excerpt.quote))
            continue
        item = next(e for e in pack.evidence if e.evidence_id == excerpt.evidence_id)
        if excerpt.quote not in item.text:
            dropped.append(ValidationDrop(kind="excerpt", reason="quote is not a verbatim substring of the cited evidence", content=excerpt.quote))
            continue
        citation = _resolve_citation(excerpt.evidence_id, pack, chunk_store)
        if citation is None:
            dropped.append(ValidationDrop(kind="excerpt", reason="evidence_id could not be resolved to a Chunk Store record", content=excerpt.quote))
            continue
        resolved_excerpts.append(ResolvedExcerpt(evidence_id=excerpt.evidence_id, quote=excerpt.quote, citation=citation))

    # Check 4: statements remain after filtering, else fall back to refusal.
    fell_back = len(resolved_statements) == 0

    conflicts_out = []
    for c in generation.conflicts:
        valid_conflict_ids = [eid for eid in c.evidence_ids if eid in valid_ids]
        if len(valid_conflict_ids) >= 2:
            conflicts_out.append({"description": c.description, "evidence_ids": valid_conflict_ids})

    return ResolvedAnswer(
        statements=resolved_statements,
        excerpts=resolved_excerpts,
        limitations=list(generation.limitations),
        conflicts=conflicts_out,
        dropped=dropped,
        fell_back_to_refusal=fell_back,
    )
