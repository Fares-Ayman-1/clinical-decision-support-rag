"""Tests for the section+page relevance matching rule
(backend/app/services/evaluation/relevance.py) — this is the mechanism
that makes a 9-config chunking comparison affordable without re-labeling
per config, so a bug here would silently corrupt every metric."""

from __future__ import annotations

from app.services.evaluation.relevance import EvalQuery, RelevantSection, build_relevance_predicate

CHUNK_LOOKUP = {
    "c1": {"document_id": "docA", "section_path": "Intro", "page_start": 1, "page_end": 1},
    "c2": {"document_id": "docA", "section_path": "Intro", "page_start": 2, "page_end": 2},
    "c3": {"document_id": "docA", "section_path": "Methods", "page_start": 3, "page_end": 4},
    "c4": {"document_id": "docB", "section_path": "Intro", "page_start": 1, "page_end": 1},
}


def test_matches_by_section_path():
    q = EvalQuery(
        query_id="q1", query="x", split="dev",
        relevant_sections=[RelevantSection("docA", "Intro", 1, 1)],
        domains=[],
    )
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    assert is_relevant("c1") is True
    # c2 shares section_path "Intro" with docA even though its own page
    # (2) differs from the query's page_start/end (1) — section_path
    # match alone is sufficient per the documented rule.
    assert is_relevant("c2") is True
    assert is_relevant("c3") is False


def test_matches_by_page_overlap_when_section_path_differs():
    q = EvalQuery(
        query_id="q2", query="x", split="dev",
        relevant_sections=[RelevantSection("docA", "Some other heading text", 3, 4)],
        domains=[],
    )
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    # c3's section_path doesn't match, but its page range (3-4) overlaps
    # the labeled page range (3-4) -> relevant via the page-overlap rule.
    assert is_relevant("c3") is True
    assert is_relevant("c1") is False


def test_document_id_must_match():
    q = EvalQuery(
        query_id="q3", query="x", split="dev",
        relevant_sections=[RelevantSection("docA", "Intro", 1, 1)],
        domains=[],
    )
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    # c4 has section_path "Intro" and page 1, matching everything except
    # document_id (docB vs docA) -> must NOT be relevant.
    assert is_relevant("c4") is False


def test_unknown_chunk_id_is_not_relevant():
    q = EvalQuery(
        query_id="q4", query="x", split="dev",
        relevant_sections=[RelevantSection("docA", "Intro", 1, 1)],
        domains=[],
    )
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    assert is_relevant("nonexistent_chunk_id") is False


def test_out_of_domain_query_matches_nothing():
    q = EvalQuery(query_id="ood1", query="x", split="out_of_domain", relevant_sections=[], domains=[])
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    assert all(not is_relevant(cid) for cid in CHUNK_LOOKUP)


def test_multiple_relevant_sections_ored_together():
    q = EvalQuery(
        query_id="q5", query="x", split="dev",
        relevant_sections=[
            RelevantSection("docA", "Methods", 3, 4),
            RelevantSection("docB", "Intro", 1, 1),
        ],
        domains=[],
    )
    is_relevant = build_relevance_predicate(q, CHUNK_LOOKUP)
    assert is_relevant("c3") is True
    assert is_relevant("c4") is True
    assert is_relevant("c1") is False
