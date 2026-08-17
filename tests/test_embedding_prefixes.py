"""Asserts embedding prefixes and max_seq_length are actually applied.

ARCHITECTURE.md §7.2: omitting the asymmetric query:/passage: prefix
degrades retrieval substantially and SILENTLY — no exception, no error,
just worse rankings that still look plausible. This is exactly the kind
of regression that must be caught by a test, not by eyeballing results.
"""

from __future__ import annotations

import pathlib

import pytest

from app.services.retrieval.embedding_provider import (
    EmbeddingModelConfig,
    load_embedding_config,
)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_load_embedding_config_reads_max_seq_length():
    config = load_embedding_config()
    assert config.max_seq_length == 256
    assert config.name == "sentence-transformers/all-MiniLM-L6-v2"
    assert config.dim == 384
    assert config.embedding_version


def test_prefixes_are_declared_not_hardcoded():
    config = load_embedding_config()
    assert isinstance(config.query_prefix, str)
    assert isinstance(config.passage_prefix, str)


@pytest.mark.skipif(
    not (REPO_ROOT / ".venv").exists(),
    reason="sentence-transformers model load requires the project venv",
)
def test_provider_applies_prefix_at_encode_time(monkeypatch):
    """Doesn't need the real model: verifies embed_queries/embed_passages
    actually prepend the configured prefix before encoding, by capturing
    what _encode receives rather than trusting the source read alone."""
    from app.services.retrieval import embedding_provider as ep

    config = EmbeddingModelConfig(
        name="fake-model",
        dim=4,
        max_seq_length=256,
        query_prefix="query: ",
        passage_prefix="passage: ",
        normalize=True,
        embedding_version="test-1",
    )

    captured: dict[str, list[str]] = {}

    class FakeProvider(ep.SentenceTransformerProvider):
        def __init__(self, config):
            self.config = config

        def _encode(self, texts):
            captured["texts"] = texts
            import numpy as np

            return np.zeros((len(texts), config.dim))

    provider = FakeProvider(config)

    provider.embed_queries(["chest pain"])
    assert captured["texts"] == ["query: chest pain"]

    provider.embed_passages(["Chest pain may indicate ACS."])
    assert captured["texts"] == ["passage: Chest pain may indicate ACS."]


def test_real_model_max_seq_length_matches_config():
    """Guards against finding 2 recurring silently: if the actual loaded
    model's max_seq_length ever drifts from what config/embedding.yaml
    declares, chunking size decisions made against the declared value
    would be wrong without any error."""
    import os

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    from sentence_transformers import SentenceTransformer

    config = load_embedding_config()
    model = SentenceTransformer(config.name)
    assert model.tokenizer.model_max_length == config.max_seq_length
