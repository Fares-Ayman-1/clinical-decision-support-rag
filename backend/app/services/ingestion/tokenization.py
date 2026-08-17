"""Token counting — ARCHITECTURE.md §6.4, §7. R10 (PROJECT-STATE.md Known Issues).

Two counters:

- `count_tokens` — the original provisional word-count approximation
  (words * 1.3). Kept as the always-available fallback so callers that
  cannot inject a real tokenizer (e.g. a fresh checkout with no model
  downloaded yet) still work.
- `count_tokens_real` — delegates to whatever tokenizer was registered via
  `set_tokenizer()`, falling back to `count_tokens` if none was registered.

`set_tokenizer()` is injected rather than imported directly here, so this
module (and callers like chunk_document.py) never take a hard dependency on
sentence-transformers/transformers — only backend/app/services/retrieval/
embedding_provider.py, which owns the actual model, calls set_tokenizer()
at startup.

Verified against the real tokenizer (sentence-transformers/all-MiniLM-L6-v2,
the only model reachable in this sandbox — no network route to the HF Hub
for any other candidate) that the 1.3x word-count ratio under-counts real
BPE tokens by ~26% at the median (p90 1.64x). At this model's actual
max_seq_length of 256 (not the 512 originally assumed), the OLD provisional
counts would have produced silent truncation on 70.2% of config A's chunks
and 65.2% of config B's, losing 45.9% / 31.1% of all text respectively —
this is why re-chunking with the real tokenizer, not just documenting the
gap, was a prerequisite for the chunking benchmark rather than cleanup.
"""

from __future__ import annotations

import re
from typing import Callable

WORDS_TO_TOKENS_RATIO = 1.3

_WORD_RE = re.compile(r"\S+")

_real_tokenizer: Callable[[str], int] | None = None


def set_tokenizer(fn: Callable[[str], int] | None) -> None:
    """Register a real token-counting function, e.g.
    lambda text: len(model.tokenizer.encode(text, add_special_tokens=True)).
    Pass None to clear (falls back to the word-count approximation)."""
    global _real_tokenizer
    _real_tokenizer = fn


def has_real_tokenizer() -> bool:
    return _real_tokenizer is not None


def count_tokens(text: str) -> int:
    if not text:
        return 0
    word_count = len(_WORD_RE.findall(text))
    return max(1, round(word_count * WORDS_TO_TOKENS_RATIO))


def count_tokens_real(text: str) -> int:
    if not text:
        return 0
    if _real_tokenizer is not None:
        return _real_tokenizer(text)
    return count_tokens(text)
