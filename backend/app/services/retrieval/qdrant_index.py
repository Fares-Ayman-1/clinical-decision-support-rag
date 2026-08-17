"""Qdrant collection management — ARCHITECTURE.md §8.

Two naming schemes share this module:

- Benchmark configs: medical_chunks_{config_id} (e.g. medical_chunks_S1),
  one per chunking-strategy benchmark config, so S1..S7 can coexist and be
  re-measured without rebuilding.
- The MVP serving collection: the single canonical `medical_chunks` name
  ARCHITECTURE.md §8 specifies, built from whichever config is currently
  chosen for serving (S1 as of this session — PROJECT-STATE.md; the
  5-config comparison is still incomplete, R13). collection_name(None)
  (or collection_name("MVP")) resolves to this canonical name.

Named vector "dense" only for now (sparse/BM25 lives in bm25_index.py as a
separate in-process index per ARCHITECTURE.md §8's hybrid design — Qdrant's
own sparse-vector support is not used here to keep the benchmark simple;
this is a scope note, not a correctness issue).
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

QDRANT_URL = "http://localhost:6333"
MVP_COLLECTION_NAME = "medical_chunks"


@dataclass(frozen=True)
class IndexedChunk:
    chunk_id: str
    document_id: str
    section_path: str
    page_start: int
    page_end: int
    chunk_type: str
    token_count: int
    text: str
    embedded_text: str


def collection_name(config_id: str | None) -> str:
    if config_id is None:
        return MVP_COLLECTION_NAME
    return f"medical_chunks_{config_id}"


def load_chunks(jsonl_path: pathlib.Path) -> list[dict]:
    chunks = []
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            chunks.append(json.loads(line))
    return chunks


def build_index(
    client: QdrantClient,
    config_id: str,
    chunks: list[dict],
    vectors,
    dim: int,
    embedding_version: str,
    recreate: bool = True,
) -> str:
    """vectors: numpy array, shape (len(chunks), dim), L2-normalized,
    already embedded via embed_passages(). Refuses if an existing
    collection's stored embedding_version doesn't match (ARCHITECTURE.md
    §7.2 version-pinning requirement) unless recreate=True."""
    name = collection_name(config_id)

    if client.collection_exists(name):
        if not recreate:
            existing_info = client.get_collection(name)
            raise RuntimeError(
                f"Collection {name} already exists; pass recreate=True to rebuild "
                f"(refusing to silently mix embedding_version={embedding_version} into it)."
            )
        client.delete_collection(name)

    client.create_collection(
        collection_name=name,
        vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
    )
    client.create_payload_index(name, field_name="document_id", field_schema="keyword")
    client.create_payload_index(name, field_name="chunk_type", field_schema="keyword")
    client.create_payload_index(name, field_name="domains", field_schema="keyword")

    points = [
        qm.PointStruct(
            id=i,
            vector=vectors[i].tolist(),
            payload={
                "chunk_id": c["chunk_id"],
                "document_id": c["document_id"],
                "section_path": c["section_path"],
                "page_start": c["page_start"],
                "page_end": c["page_end"],
                "chunk_type": c["chunk_type"],
                "token_count": c["token_count"],
                "text": c["text"],
                "domains": c["domains"],
                "content_hash": c["content_hash"],
                "embedding_version": embedding_version,
            },
        )
        for i, c in enumerate(chunks)
    ]

    batch_size = 256
    for start in range(0, len(points), batch_size):
        client.upsert(collection_name=name, points=points[start : start + batch_size])

    count = client.count(name).count
    if count != len(chunks):
        raise RuntimeError(f"Index integrity check failed for {name}: expected {len(chunks)} points, got {count}")

    return name


def search_dense(client: QdrantClient, config_id: str | None, query_vector, top_k: int) -> list[tuple[str, float]]:
    """Returns [(chunk_id, score), ...] ranked best-first. Used by the
    chunking benchmark (scripts/evaluate.py, scripts/compare_chunking.py) —
    payload kept minimal there since the benchmark resolves everything else
    from the Chunk Store's Phase-5 JSONL directly."""
    name = collection_name(config_id)
    results = client.query_points(
        collection_name=name,
        query=query_vector.tolist(),
        limit=top_k,
        with_payload=["chunk_id"],
    ).points
    return [(r.payload["chunk_id"], r.score) for r in results]


def search_dense_full(
    client: QdrantClient, config_id: str | None, query_vector, top_k: int, with_vectors: bool = False
) -> list[dict]:
    """Returns full payload dicts (chunk_id, domains, content_hash, score,
    optionally "vector", ...) ranked best-first. Used by the MVP serving
    path (hybrid_search.py) where domain boosting needs domains/
    content_hash, and near-duplicate suppression's pairwise-cosine stage
    (ARCHITECTURE.md §9.5) needs the actual dense vectors — both without a
    second round-trip per candidate."""
    name = collection_name(config_id)
    results = client.query_points(
        collection_name=name,
        query=query_vector.tolist(),
        limit=top_k,
        with_payload=True,
        with_vectors=with_vectors,
    ).points
    out = []
    for r in results:
        row = dict(r.payload)
        row["score"] = r.score
        if with_vectors:
            row["vector"] = r.vector
        out.append(row)
    return out
