"""Tests for the Citation Resolver's programmatic validation —
ARCHITECTURE.md §12.3. This is the safety-critical core of the whole
grounding design, so every check gets adversarial coverage: fabricated
evidence_ids, non-verbatim quotes, and the all-statements-dropped ->
refusal fallback.
"""

from __future__ import annotations

from app.prompts.schemas import CitedStatement, Conflict, Excerpt, GroundedGeneration
from app.services.rag.chunk_store import ChunkRecord, ChunkStore
from app.services.rag.citation_resolver import resolve_and_validate
from app.services.rag.evidence_pack import EvidenceItem, EvidencePack


def _record(chunk_id: str, text: str) -> ChunkRecord:
    return ChunkRecord(
        chunk_id=chunk_id, document_id="doc1", document_title="Test Document",
        organization="WHO", publication_year=2024, source_url="https://example.org",
        license="CC BY", section=None, subsection=None, section_path="Chapter 1",
        section_confidence="detected", page_start=1, page_end=1, domains=["cardiovascular"],
        chunk_type="guidance", evidence_grade=None, recommendation_class=None, text=text,
        token_count=10, content_hash="sha256:x", kb_version="1.0", chunking_version="v1",
        embedding_version="v1",
    )


def _pack(evidence_texts: dict[str, str]) -> EvidencePack:
    evidence = [
        EvidenceItem(evidence_id=eid, chunk_id=eid, text=text, dense_score=0.5, bm25_score=1.0, rrf_score=0.03, rerank_score=None)
        for eid, text in evidence_texts.items()
    ]
    return EvidencePack(
        query_id="q1", rewritten_queries=(), predicted_domains=("cardiovascular",),
        evidence=evidence, top_rerank_score=None, top_rrf_score=0.03, support_count=len(evidence),
    )


def _store(evidence_texts: dict[str, str]) -> ChunkStore:
    return ChunkStore({eid: _record(eid, text) for eid, text in evidence_texts.items()})


def test_valid_statement_and_excerpt_resolve_correctly():
    pack = _pack({"E1": "Chest pain may indicate a cardiac emergency."})
    store = _store({"E1": "Chest pain may indicate a cardiac emergency."})
    generation = GroundedGeneration(
        statements=[CitedStatement(text="Chest pain can be serious.", evidence_ids=["E1"])],
        excerpts=[Excerpt(evidence_id="E1", quote="cardiac emergency")],
        limitations=[], conflicts=[], insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert len(result.statements) == 1
    assert result.statements[0].citations[0].document_title == "Test Document"
    assert len(result.excerpts) == 1
    assert not result.fell_back_to_refusal
    assert result.dropped == []


def test_fabricated_evidence_id_drops_the_statement():
    pack = _pack({"E1": "real evidence text"})
    store = _store({"E1": "real evidence text"})
    generation = GroundedGeneration(
        statements=[
            CitedStatement(text="real statement", evidence_ids=["E1"]),
            CitedStatement(text="fabricated statement", evidence_ids=["E99"]),  # E99 doesn't exist
        ],
        excerpts=[], limitations=[], conflicts=[], insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert len(result.statements) == 1
    assert result.statements[0].text == "real statement"
    assert len(result.dropped) == 1
    assert result.dropped[0].kind == "statement"
    assert "fabricated statement" in result.dropped[0].content


def test_non_verbatim_quote_drops_the_excerpt():
    pack = _pack({"E1": "The exact original sentence in the guideline."})
    store = _store({"E1": "The exact original sentence in the guideline."})
    generation = GroundedGeneration(
        statements=[CitedStatement(text="stmt", evidence_ids=["E1"])],
        excerpts=[
            Excerpt(evidence_id="E1", quote="The exact original sentence in the guideline."),  # real
            Excerpt(evidence_id="E1", quote="This sentence was paraphrased, not verbatim."),  # fabricated
        ],
        limitations=[], conflicts=[], insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert len(result.excerpts) == 1
    assert result.excerpts[0].quote == "The exact original sentence in the guideline."
    assert any(d.kind == "excerpt" and "verbatim" in d.reason for d in result.dropped)


def test_all_statements_dropped_falls_back_to_refusal():
    pack = _pack({"E1": "real text"})
    store = _store({"E1": "real text"})
    generation = GroundedGeneration(
        statements=[CitedStatement(text="fabricated", evidence_ids=["E404"])],
        excerpts=[], limitations=[], conflicts=[], insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert result.fell_back_to_refusal is True
    assert result.statements == []


def test_conflict_requires_at_least_two_valid_evidence_ids():
    pack = _pack({"E1": "text A", "E2": "text B"})
    store = _store({"E1": "text A", "E2": "text B"})
    generation = GroundedGeneration(
        statements=[CitedStatement(text="stmt", evidence_ids=["E1"])],
        excerpts=[],
        limitations=[],
        conflicts=[
            Conflict(description="A and B disagree", evidence_ids=["E1", "E2"]),
            Conflict(description="fabricated conflict", evidence_ids=["E1", "E999"]),  # only 1 valid id
        ],
        insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert len(result.conflicts) == 1
    assert result.conflicts[0]["description"] == "A and B disagree"


def test_chunk_store_missing_record_drops_statement_defensively():
    """A chunk_id present in the Evidence Pack but absent from the Chunk
    Store would be a real data-integrity bug — verify it degrades safely
    (drops the statement) rather than crashing or fabricating metadata."""
    pack = _pack({"E1": "orphaned evidence text"})
    store = ChunkStore({})  # empty — E1's chunk_id is not in the store
    generation = GroundedGeneration(
        statements=[CitedStatement(text="stmt", evidence_ids=["E1"])],
        excerpts=[], limitations=[], conflicts=[], insufficient_evidence=False,
    )
    result = resolve_and_validate(generation, pack, store)
    assert result.statements == []
    assert result.fell_back_to_refusal is True
