"""Section+page relevance matching — the rule that makes a 9-config
comparison affordable without re-labeling per config (chunking-benchmark
plan, Stage 0).

Eval queries in data/evaluation/*.jsonl label relevance at
(document_id, section_path, page_start, page_end) granularity, never at
chunk_id (chunk_ids change with every chunking config). A retrieved chunk
counts as relevant to a query iff its (document_id, section_path) matches
a labeled section, OR its page range intersects the labeled page range.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RelevantSection:
    document_id: str
    section_path: str
    page_start: int
    page_end: int


@dataclass(frozen=True)
class EvalQuery:
    query_id: str
    query: str
    split: str
    relevant_sections: list[RelevantSection]
    domains: list[str]
    notes: str = ""


def load_eval_queries(path) -> list[EvalQuery]:
    import json

    queries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            sections = [
                RelevantSection(
                    document_id=s["document_id"],
                    section_path=s["section_path"],
                    page_start=s["page_start"],
                    page_end=s["page_end"],
                )
                for s in row.get("relevant_sections", [])
            ]
            queries.append(
                EvalQuery(
                    query_id=row["query_id"],
                    query=row["query"],
                    split=row["split"],
                    relevant_sections=sections,
                    domains=row.get("domains", []),
                    notes=row.get("notes", ""),
                )
            )
    return queries


def build_relevance_predicate(query: EvalQuery, chunk_lookup: dict[str, dict]):
    """chunk_lookup: chunk_id -> chunk dict (document_id, section_path,
    page_start, page_end). Returns a predicate closure over this query's
    relevant_sections, per the module docstring's matching rule."""

    def is_relevant(chunk_id: str) -> bool:
        chunk = chunk_lookup.get(chunk_id)
        if chunk is None:
            return False
        for rel in query.relevant_sections:
            if chunk["document_id"] != rel.document_id:
                continue
            if chunk["section_path"] == rel.section_path:
                return True
            chunk_pages = set(range(chunk["page_start"], chunk["page_end"] + 1))
            rel_pages = set(range(rel.page_start, rel.page_end + 1))
            if chunk_pages & rel_pages:
                return True
        return False

    return is_relevant
