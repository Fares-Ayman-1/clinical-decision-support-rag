"""Token-budget batching in SentenceTransformerProvider._encode().

Worth testing without the real model because both properties fail SILENTLY:
a batch that busts the token budget just uses more memory (or OOMs on a big
machine, far from the cause), and a scatter-back bug returns vectors in the
wrong order — every chunk gets a plausible-looking embedding belonging to a
different chunk, which no exception would ever reveal.
"""

from __future__ import annotations

import numpy as np

from app.services.retrieval.embedding_provider import (
    EmbeddingModelConfig,
    SentenceTransformerProvider,
)

DIM = 8


class _FakeTokenizer:
    """One "token" per whitespace-separated word — enough to drive the
    length-based grouping deterministically."""

    padding_side = "left"

    def encode(self, text, add_special_tokens=True):
        return text.split()


class _FakeModel:
    def __init__(self):
        self.tokenizer = _FakeTokenizer()
        self.max_seq_length = 0
        self.batches: list[list[str]] = []

    def encode(self, texts, batch_size=None, show_progress_bar=False,
               convert_to_numpy=True, normalize_embeddings=True):
        self.batches.append(list(texts))
        # Encode each text to a vector whose first component is its word count,
        # so the caller can verify which input produced which row.
        return np.array([[float(len(t.split()))] + [0.0] * (DIM - 1) for t in texts])

    def get_sentence_embedding_dimension(self):
        return DIM


def _provider(max_seq_length=32768):
    config = EmbeddingModelConfig(
        name="fake", dim=DIM, max_seq_length=max_seq_length,
        query_prefix="", passage_prefix="", normalize=True,
        embedding_version="test-1",
    )
    provider = SentenceTransformerProvider.__new__(SentenceTransformerProvider)
    provider.config = config
    provider._model = _FakeModel()
    return provider


def test_no_batch_exceeds_the_token_budget():
    provider = _provider()
    budget = SentenceTransformerProvider.MAX_BATCH_TOKENS
    # A deliberately skewed mix: many short items plus one item far longer than
    # any neighbour — the shape that makes fixed-size batching pad wastefully.
    texts = ["word " * 10 for _ in range(200)] + ["word " * 5000]

    provider._encode(texts)

    assert provider._model.batches, "nothing was encoded"
    for batch in provider._model.batches:
        longest = max(len(t.split()) for t in batch)
        assert longest * len(batch) <= budget, (
            f"batch of {len(batch)} x {longest} tokens = {longest * len(batch)} "
            f"exceeds budget {budget}"
        )


def test_the_outsized_item_gets_a_small_batch():
    """The guarantee is a bounded batch, NOT an isolated one.

    An earlier version of this test asserted the 5,000-token item ended up
    alone. That is stricter than the implementation promises and stricter than
    is useful: at a 16,384-token budget, three 5,000-token slots fit, so the
    grouping is correct. The padding waste from filling those slots with short
    neighbours is ~10k padded tokens across a corpus of 835,893 real ones --
    not worth extra machinery to avoid. What actually matters is that the item
    cannot pull an unbounded number of neighbours up to its length."""
    provider = _provider()
    budget = SentenceTransformerProvider.MAX_BATCH_TOKENS
    texts = ["word " * 10 for _ in range(50)] + ["word " * 5000]

    provider._encode(texts)

    big = [b for b in provider._model.batches if any(len(t.split()) == 5000 for t in b)]
    assert len(big) == 1, "the outsized item should appear in exactly one batch"
    assert len(big[0]) <= budget // 5000, (
        f"batch of {len(big[0])} items at 5000 tokens each exceeds the budget"
    )
    # And the vast majority of short items must NOT be paying that padding.
    assert len(big[0]) < 10


def test_results_are_returned_in_input_order():
    provider = _provider()
    # Lengths deliberately NOT sorted, so an implementation that forgets to
    # scatter results back would visibly reorder them.
    lengths = [5, 900, 12, 4000, 7, 250, 3, 60]
    texts = ["word " * n for n in lengths]

    out = provider._encode(texts)

    assert out.shape == (len(texts), DIM)
    # Component 0 carries the source word count, so this pins each output row
    # to the exact input that produced it.
    assert [int(v) for v in out[:, 0]] == lengths


def test_empty_input_returns_empty_array_without_encoding():
    provider = _provider()
    out = provider._encode([])
    assert out.shape == (0, DIM)
    assert provider._model.batches == []


def test_budget_uses_truncated_length_not_raw_length():
    """An item past max_seq_length is truncated before the forward pass, so its
    raw length must not inflate the budget arithmetic and strand it alone."""
    provider = _provider(max_seq_length=128)
    texts = ["word " * 10000 for _ in range(4)]
    provider._encode(texts)
    # All four truncate to 128 tokens: 4 x 128 = 512, far inside the budget,
    # so they belong together in one batch.
    assert len(provider._model.batches) == 1
    assert len(provider._model.batches[0]) == 4
