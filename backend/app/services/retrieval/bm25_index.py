"""BM25 lexical index — ARCHITECTURE.md §8's hybrid retrieval half.

Indexes each chunk's raw `text` field, NOT `embedded_text`. The contextual
header prefix ("{document_title} > {section_path}\n\n") is useful for dense
embedding but would pollute BM25's term statistics — every chunk in a
document would share the same document_title tokens, artificially
inflating their document frequency and diluting genuine term signal.

One index per chunking config, matching qdrant_index.py's per-config
collections, so BM25 and dense search stay aligned to the same chunk set.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from rank_bm25 import BM25Okapi

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


@dataclass
class BM25Index:
    chunk_ids: list[str]
    _bm25: BM25Okapi

    def search(self, query: str, top_k: int) -> list[tuple[str, float]]:
        tokens = _tokenize(query)
        scores = self._bm25.get_scores(tokens)
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
        return [(self.chunk_ids[i], float(scores[i])) for i in ranked if scores[i] > 0]


def build_bm25_index(chunks: list[dict]) -> BM25Index:
    corpus_tokens = [_tokenize(c["text"]) for c in chunks]
    bm25 = BM25Okapi(corpus_tokens)
    return BM25Index(chunk_ids=[c["chunk_id"] for c in chunks], _bm25=bm25)
