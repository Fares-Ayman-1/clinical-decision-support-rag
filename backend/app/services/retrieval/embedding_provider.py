"""Embedding provider — ARCHITECTURE.md §7.

Wraps sentence-transformers behind a small interface so the model can be
swapped after a real benchmark (only one candidate is actually usable in
this sandbox right now — see config/embedding.yaml). Owns three things
that ARCHITECTURE.md §7.2 calls out as easy to get silently wrong:

1. Asymmetric query:/passage: prefixes applied centrally, never at call
   sites. For the only model actually available here (MiniLM, a symmetric
   model) both prefixes are "" — but the mechanism is still centralized so
   a future asymmetric model (E5/BGE/GTE family) is a config change, not a
   code change at every call site.
2. L2 normalization, always, so cosine distance is meaningful.
3. Registers this model's real tokenizer with
   backend/app/services/ingestion/tokenization.py's set_tokenizer(), so
   chunk_document.py's count_tokens_real() calls route through the actual
   BPE tokenizer instead of the provisional word-count approximation (R10).
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass

import numpy as np
import yaml

from app.services.ingestion.tokenization import set_tokenizer

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
EMBEDDING_CONFIG_PATH = REPO_ROOT / "config" / "embedding.yaml"


@dataclass(frozen=True)
class EmbeddingModelConfig:
    name: str
    dim: int
    max_seq_length: int
    query_prefix: str
    passage_prefix: str
    normalize: bool
    embedding_version: str


def load_embedding_config(
    path: pathlib.Path = EMBEDDING_CONFIG_PATH, key: str = "primary"
) -> EmbeddingModelConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    model = raw[key]
    return EmbeddingModelConfig(
        name=model["name"],
        dim=model["dim"],
        max_seq_length=model["max_seq_length"],
        query_prefix=model.get("query_prefix", ""),
        passage_prefix=model.get("passage_prefix", ""),
        normalize=model.get("normalize", True),
        embedding_version=raw["embedding_version"],
    )


class SentenceTransformerProvider:
    """Loads the model once; embed_queries()/embed_passages() apply the
    asymmetric prefix and normalization centrally so no call site can
    forget either — ARCHITECTURE.md §7.2 flags omitting the prefix as a
    silent, substantial retrieval degradation with no error raised."""

    def __init__(self, config: EmbeddingModelConfig, register_tokenizer: bool = True):
        # Imported lazily: sentence-transformers/torch are heavy and this
        # keeps `import embedding_provider` cheap for callers that only
        # need load_embedding_config() (e.g. scripts computing token counts
        # without loading the full model).
        import os

        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        from sentence_transformers import SentenceTransformer

        self.config = config
        self._model = SentenceTransformer(config.name)
        self._model.max_seq_length = config.max_seq_length

        if register_tokenizer:
            tokenizer = self._model.tokenizer

            def _count(text: str) -> int:
                return len(tokenizer.encode(text, add_special_tokens=True))

            set_tokenizer(_count)

    def _encode(self, texts: list[str]) -> np.ndarray:
        # Chunked into outer batches of 500 rather than handing the whole
        # list to model.encode(batch_size=32) in one call. Found necessary
        # by direct reproduction: encoding data/chunks/benchmark's S2 set
        # (5273 items) as one call to encode() ran far slower than
        # encoding the same items 500 at a time back-to-back (500 items
        # consistently took ~13-15s either way, but the single 5273-item
        # call never finished after 500+ CPU-seconds, well past the
        # ~150s the per-batch rate predicts). Root cause not fully
        # isolated (plausibly encode()'s internal length-sort/bucketing
        # degrading on a large, mixed-length list, or memory pressure from
        # allocating output for the whole list before returning) — the
        # outer-chunking workaround is verified to avoid it, which is what
        # matters for the benchmark's wall-clock budget.
        outer_batch = 500
        all_vectors = []
        for start in range(0, len(texts), outer_batch):
            batch = texts[start : start + outer_batch]
            vectors = self._model.encode(
                batch,
                batch_size=32,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=self.config.normalize,
            )
            all_vectors.append(vectors)
        return np.concatenate(all_vectors, axis=0) if all_vectors else np.zeros((0, self.config.dim))

    def embed_queries(self, queries: list[str]) -> np.ndarray:
        prefixed = [f"{self.config.query_prefix}{q}" for q in queries]
        return self._encode(prefixed)

    def embed_passages(self, passages: list[str]) -> np.ndarray:
        prefixed = [f"{self.config.passage_prefix}{p}" for p in passages]
        return self._encode(prefixed)

    def count_tokens(self, text: str) -> int:
        return len(self._model.tokenizer.encode(text, add_special_tokens=True))
