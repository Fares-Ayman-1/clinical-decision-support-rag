---
title: Clinical Decision Support RAG
emoji: 🩺
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
short_description: Evidence-grounded clinical decision support (RAG)
---

# Evidence-Grounded Clinical Decision Support (RAG)

Retrieval-augmented clinical decision support over a frozen corpus of seven WHO
and national clinical guideline documents. Every generated statement is tied to
a retrieved guideline chunk, and the system refuses rather than guesses when
retrieved evidence is insufficient.

> **Not a medical device.** This is a hackathon research prototype. Its red-flag
> rules have not been clinician-reviewed, and it must not be used for real
> patient care.

## What is running in this Space

One container, one public port (7860):

| Process | Bind | Role |
|---|---|---|
| nginx | `0.0.0.0:7860` | serves the React bundle, proxies `/api/` |
| uvicorn | `127.0.0.1:8000` | FastAPI backend |
| Qdrant `v1.12.5` | `127.0.0.1:6333` | vector store, index baked at build time |

The vector index is built **during the Docker build**, not at startup: a free
Space has ephemeral storage, so a runtime build would re-embed ~7,400 chunks on
2 vCPU on every cold start while the app served broken queries.

## Retrieval pipeline

Dense (`all-MiniLM-L6-v2`) top-25 + BM25 top-25 → RRF fusion → domain boost
(a score bonus, never a filter) → near-duplicate suppression → cross-encoder
rerank (`ms-marco-MiniLM-L-6-v2`) → sufficiency gate → grounded generation.

## Known limitations, stated plainly

These are measured, not hidden — see `EVALUATION.md` in the repo for the full set:

- **Only 1 of 5 chunking configurations was benchmarked.** The serving config
  (S1, 90–140 real tokens) is the one that finished indexing, not the one that
  measured best.
- **Recall@5 is 0.032**; `Hit@5 = 0.480` is the more meaningful "was the right
  section found" figure, since section-granularity labels cap recall
  mechanically.
- **BM25 measured worse than dense-only**, contradicting the design assumption
  and probably confounded by chunk fragmentation.
- **p95 latency exceeds the 8 s budget.** The first query after a cold start is
  slower still.
- **Faithfulness misses its ≥90% target**; the generator appends care-seeking
  advice its cited text does not state.

## Configuration

Set as Space **variables** (non-secret) or **secrets** (keys) in Space settings:

| Name | Kind | Purpose |
|---|---|---|
| `OLLAMA_API_KEY` | secret | LLM provider credential |
| `LLM_PROVIDER` / `LLM_MODEL` | variable | provider selection |
| `EMBEDDING_MODEL` | build arg | changing it requires a rebuild — the model is baked |
| `RATE_LIMIT_REQUESTS` | variable | in-process sliding window on `/api/query` |

`EMBEDDING_MODEL` is a **build argument**, not a runtime switch: the weights are
baked into the image and `HF_HUB_OFFLINE=1` is set, so pointing it at a model
that was never baked fails at startup instead of downloading.
