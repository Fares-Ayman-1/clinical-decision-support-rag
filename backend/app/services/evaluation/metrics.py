"""Retrieval metrics — pure functions over one ranked list. No I/O.

All take (ranked_chunk_ids, relevant_predicate, k) where relevant_predicate
is a callable checking whether a given chunk_id counts as relevant — this
indirection is what lets the eval runner apply the section+page matching
rule (a chunk is relevant iff its (document_id, section_path) matches a
labeled section OR its page range intersects the labeled range) without
this module needing to know about chunk metadata at all.

Honesty note (carried into EVALUATION.md, not just here): with
section-level labels, a section that legitimately spans N chunks makes
Precision@k mechanically cap below 1.0 even for a perfect retriever, once
k > N. Recall@k and nDCG@k are the decision metrics for that reason;
Precision@k is still reported, just not over-interpreted.
"""

from __future__ import annotations

import math
from typing import Callable

RelevancePredicate = Callable[[str], bool]


def precision_at_k(ranked_ids: list[str], is_relevant: RelevancePredicate, k: int) -> float:
    top_k = ranked_ids[:k]
    if not top_k:
        return 0.0
    hits = sum(1 for cid in top_k if is_relevant(cid))
    return hits / len(top_k)


def recall_at_k(ranked_ids: list[str], is_relevant: RelevancePredicate, k: int, n_relevant: int) -> float:
    if n_relevant == 0:
        return 0.0
    top_k = ranked_ids[:k]
    hits = sum(1 for cid in top_k if is_relevant(cid))
    return hits / n_relevant


def hit_rate_at_k(ranked_ids: list[str], is_relevant: RelevancePredicate, k: int) -> float:
    top_k = ranked_ids[:k]
    return 1.0 if any(is_relevant(cid) for cid in top_k) else 0.0


def mrr(ranked_ids: list[str], is_relevant: RelevancePredicate) -> float:
    for i, cid in enumerate(ranked_ids):
        if is_relevant(cid):
            return 1.0 / (i + 1)
    return 0.0


def ndcg_at_k(ranked_ids: list[str], is_relevant: RelevancePredicate, k: int, n_relevant: int) -> float:
    """Binary relevance nDCG. Ideal DCG uses min(n_relevant, k) — the best
    achievable ranking given how many relevant items actually exist,
    which is the correct normalization when n_relevant < k (a section
    with only 1 relevant chunk cannot achieve DCG proportional to 5
    relevant hits at k=5)."""
    top_k = ranked_ids[:k]
    dcg = sum(
        (1.0 if is_relevant(cid) else 0.0) / math.log2(i + 2) for i, cid in enumerate(top_k)
    )
    ideal_hits = min(n_relevant, k)
    if ideal_hits == 0:
        return 0.0
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
    return dcg / idcg if idcg > 0 else 0.0


def wasted_context_ratio(
    ranked_ids: list[str], is_relevant: RelevancePredicate, token_counts: dict[str, int], k: int
) -> float:
    """Programmatic proxy for "context relevance" (no LLM judge per
    config): fraction of retrieved top-k tokens that come from chunks NOT
    matching a labeled relevant section. Directly measures the "chunks
    containing too much unrelated information" failure mode."""
    top_k = ranked_ids[:k]
    total_tokens = sum(token_counts.get(cid, 0) for cid in top_k)
    if total_tokens == 0:
        return 0.0
    wasted_tokens = sum(token_counts.get(cid, 0) for cid in top_k if not is_relevant(cid))
    return wasted_tokens / total_tokens
