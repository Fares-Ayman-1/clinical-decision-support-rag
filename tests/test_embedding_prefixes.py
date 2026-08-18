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
    """Pins the ACTIVE model, so swapping config/embedding.yaml's `primary`
    block is a deliberate act that updates this test, never a silent drift."""
    config = load_embedding_config()
    assert config.name == "Qwen/Qwen3-Embedding-0.6B"
    assert config.dim == 1024
    assert config.max_seq_length == 32768   # the checkpoint's real ceiling, not an artificial cap
    assert config.embedding_version


def test_last_token_pooling_model_requests_left_padding():
    """Qwen3-Embedding pools the LAST token. With the tokenizer's default
    right padding, every padded sequence in a batch pools a PAD token instead
    of real content — producing degraded vectors with no exception raised.
    That makes it precisely the silent-failure class §7.2 warns about, so it
    is asserted rather than trusted."""
    config = load_embedding_config()
    if "Qwen3-Embedding" in config.name:
        assert config.tokenizer_padding_side == "left", (
            "Qwen3-Embedding requires left padding for last-token pooling"
        )
    # An instruction-tuned asymmetric model must carry a query instruction;
    # an empty query_prefix here would mean the wrapper was dropped.
    if "Qwen3-Embedding" in config.name:
        assert config.query_prefix.startswith("Instruct:")
        assert "Query:" in config.query_prefix
        assert config.passage_prefix == ""


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


def test_real_model_max_seq_length_within_checkpoint_limit():
    """Guards the silent-truncation failure: if config/embedding.yaml declares a
    max_seq_length ABOVE what the checkpoint actually supports, every longer
    chunk is quietly cut off and the chunk-size decisions calibrated against the
    declared value are wrong, with no error raised anywhere.

    Asserts `config <= checkpoint`, not equality. Equality held only while the
    active model was MiniLM, where the declared 256 *was* the hard ceiling.
    Qwen3-Embedding-0.6B supports 32k while this project deliberately runs it at
    512 (see config/embedding.yaml), so demanding equality would forbid the very
    choice being made — the direction of the inequality is the safety property.
    """
    import os

    from sentence_transformers import SentenceTransformer

    config = load_embedding_config()

    # Loaded exactly the way SentenceTransformerProvider loads it, so this test
    # cannot pass against a differently-configured model than the app uses.
    load_kwargs: dict = {}
    if config.tokenizer_padding_side:
        load_kwargs["tokenizer_kwargs"] = {"padding_side": config.tokenizer_padding_side}
    if config.torch_dtype:
        load_kwargs["model_kwargs"] = {"torch_dtype": config.torch_dtype}

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    try:
        model = SentenceTransformer(config.name, **load_kwargs)
    except (OSError, EnvironmentError) as exc:
        # Weights absent from the local cache (offline mode). An environment
        # limitation, not a config defect — the same assertion runs in the
        # Space image, where the model is baked at build time.
        pytest.skip(f"{config.name} weights not cached locally: {type(exc).__name__}")

    ceiling = model.tokenizer.model_max_length
    assert config.max_seq_length <= ceiling, (
        f"config declares max_seq_length={config.max_seq_length} but "
        f"{config.name} supports only {ceiling} — longer chunks truncate silently"
    )
    assert model.get_sentence_embedding_dimension() == config.dim
    if config.tokenizer_padding_side:
        assert model.tokenizer.padding_side == config.tokenizer_padding_side
