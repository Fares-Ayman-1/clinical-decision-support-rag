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
    # Both default to None, which reproduces the previous load exactly, so
    # adding them cannot change MiniLM's behavior.
    #
    # padding_side is load-bearing for last-token-pooling models (the Qwen3
    # embedding family): they pool the FINAL token, so right-padding pools a
    # pad token instead of real content and yields quietly wrong vectors with
    # no error raised. Mean-pooling models (MiniLM/BGE) are unaffected.
    tokenizer_padding_side: str | None = None
    # e.g. "float32" — CPU inference on a bf16-native checkpoint is much
    # slower without an explicit cast, and float16 on CPU is worse still.
    torch_dtype: str | None = None


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
        tokenizer_padding_side=model.get("tokenizer_padding_side"),
        torch_dtype=model.get("torch_dtype"),
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
        load_kwargs: dict = {}
        if config.tokenizer_padding_side:
            # sentence-transformers renamed tokenizer_kwargs -> processor_kwargs
            # and warns on the old name. Picking by signature keeps this working
            # across both versions instead of pinning one and emitting a
            # DeprecationWarning on every single model load.
            import inspect

            params = inspect.signature(SentenceTransformer.__init__).parameters
            key = "processor_kwargs" if "processor_kwargs" in params else "tokenizer_kwargs"
            load_kwargs[key] = {"padding_side": config.tokenizer_padding_side}
        if config.torch_dtype:
            load_kwargs["model_kwargs"] = {"torch_dtype": config.torch_dtype}
        self._model = SentenceTransformer(config.name, **load_kwargs)
        self._model.max_seq_length = config.max_seq_length

        # Fail loudly on a config/checkpoint mismatch. Qdrant would otherwise
        # accept the collection at the configured dim and every later upsert
        # would raise a shape error far from the actual cause.
        # get_sentence_embedding_dimension() is deprecated in favour of
        # get_embedding_dimension(); prefer the new name when present.
        _dim_of = getattr(
            self._model, "get_embedding_dimension", None
        ) or self._model.get_sentence_embedding_dimension
        actual_dim = _dim_of()
        if actual_dim != config.dim:
            raise ValueError(
                f"config/embedding.yaml declares dim={config.dim} for {config.name!r} "
                f"but the loaded model reports {actual_dim}. Fix the config before indexing."
            )

        if register_tokenizer:
            tokenizer = self._model.tokenizer

            def _count(text: str) -> int:
                return len(tokenizer.encode(text, add_special_tokens=True))

            set_tokenizer(_count)

    # Padded tokens per batch. Ordinary ~140-token chunks still pack ~58 to a
    # batch, while the corpus's 4,708-token table chunk cannot drag neighbours
    # up to its length. Set deliberately low: a Hugging Face build container
    # OOMKilled (exit 137) on this corpus with fixed batch_size=32, so peak
    # activation memory is the binding constraint here, not throughput.
    MAX_BATCH_TOKENS = 8192

    def _encode(self, texts: list[str]) -> np.ndarray:
        """Encodes with TOKEN-budget batching rather than a fixed batch count.

        Two problems this solves, both found by measurement:

        1. Fixed batch_size wastes compute proportional to length variance.
           sentence-transformers pads every item in a batch up to the longest
           one, and attention is O(n^2), so one long chunk taxes the whole
           batch. With max_seq_length now 32768 (the real Qwen3 ceiling), a
           fixed batch of 32 around the 4,708-token table chunk is a genuine
           memory spike, not just waste.

        2. It supersedes an earlier 500-item outer-batching workaround. Handing
           the whole list to model.encode() once was reproducibly pathological:
           500 items took ~13-15s either way, but a single 5,273-item call never
           finished after 500+ CPU-seconds against the ~150s the per-batch rate
           predicted. Capping work per batch removes that cliff by construction
           instead of by a magic chunk size.

        Items are grouped longest-first so each batch's padding is bounded by a
        similar-length neighbour, then results are scattered back into the
        caller's original order — callers index vectors positionally against
        their input list, so preserving order is a correctness requirement.
        """
        if not texts:
            return np.zeros((0, self.config.dim), dtype=np.float32)

        tokenizer = self._model.tokenizer
        cap = self.config.max_seq_length
        # min(..., cap) because anything past the cap is truncated before the
        # forward pass, so it must not inflate the budget arithmetic.
        lengths = [
            min(len(tokenizer.encode(t, add_special_tokens=True)), cap) for t in texts
        ]

        order = sorted(range(len(texts)), key=lambda i: -lengths[i])
        batches: list[list[int]] = []
        current: list[int] = []
        current_max = 0
        for i in order:
            candidate_max = max(current_max, lengths[i])
            # `current and ...` so a single item larger than the whole budget
            # still gets its own batch rather than looping forever.
            if current and candidate_max * (len(current) + 1) > self.MAX_BATCH_TOKENS:
                batches.append(current)
                current, current_max = [i], lengths[i]
            else:
                current.append(i)
                current_max = candidate_max
        if current:
            batches.append(current)

        out = np.zeros((len(texts), self.config.dim), dtype=np.float32)
        for batch in batches:
            vectors = self._model.encode(
                [texts[i] for i in batch],
                batch_size=len(batch),
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=self.config.normalize,
            )
            for position, index in enumerate(batch):
                out[index] = vectors[position]
        return out

    def embed_queries(self, queries: list[str]) -> np.ndarray:
        prefixed = [f"{self.config.query_prefix}{q}" for q in queries]
        return self._encode(prefixed)

    def embed_passages(self, passages: list[str]) -> np.ndarray:
        prefixed = [f"{self.config.passage_prefix}{p}" for p in passages]
        return self._encode(prefixed)

    def count_tokens(self, text: str) -> int:
        return len(self._model.tokenizer.encode(text, add_special_tokens=True))
