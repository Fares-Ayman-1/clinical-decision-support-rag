# Clinical Decision Support RAG — فقراتي (Faqarati)

Evidence-grounded clinical question answering with a **two-tier knowledge system**:

- **Tier 1 — public**: a trilingual (ar/en/fr) assistant over a frozen corpus of **nine
  WHO/USPSTF guideline documents (8,542 section-aware chunks)**. Every generated statement
  cites retrieved guideline text; when evidence is insufficient, the system **refuses
  instead of guessing**.
- **Tier 2 — specialist**: the doctor portal's exercise planner runs on the full
  **FitKG-CN knowledge graph — 8,043 nodes / 13,510 edges** (900 exercises, 1,826 anatomy
  nodes, 1,799 exercise→muscle "Trains" links, 1,157 muscle origin/insertion edges, 100%
  bilingual zh/en labels), explorable live via `/api/fitkg/stats` and `/api/fitkg/search`.

> ⚠️ **Not a medical device.** Research/hackathon prototype. Red-flag rules are not
> clinician-reviewed. Never use for real patient care.

**Live deployments**

| Deployment | URL | Stack |
|---|---|---|
| Full app (React + FastAPI + Qdrant) | [clinical-decision-support-rag](https://huggingface.co/spaces/FatimahEmadEldin/clinical-decision-support-rag) | HF Docker Space, free cpu-basic |
| GPU retrieval demo (Gradio) | [clinical-cds-assistant](https://huggingface.co/spaces/FatimahEmadEldin/clinical-cds-assistant) | HF ZeroGPU (H200 slice) |
| Index snapshots / vector caches | [cds-qdrant-snapshots](https://huggingface.co/datasets/FatimahEmadEldin/cds-qdrant-snapshots) | HF dataset repo |

---

## 1. Pipeline architecture

```
patient question (any language)
   │
   ├─ red-flag check ──────────────── rule table (config/red_flags.yaml)
   ├─ clinical extraction ─────────── LLM (gpt-oss:20b via Ollama cloud)
   ├─ domain prediction ───────────── LLM → domain labels (boost, NEVER filter)
   ├─ query rewrite ───────────────── LLM → 1-3 ENGLISH clinical variants
   │                                  (non-English questions are translated here)
   ├─ hybrid retrieval ────────────── per variant: dense top-25 + BM25 top-25 → RRF(k=60)
   │     dense: Qwen3-Embedding-0.6B → Qdrant (cosine, 1024-d)
   │     cross-variant RRF fusion → near-duplicate suppression
   ├─ cross-encoder rerank ────────── mmarco-mMiniLMv2-L12 (multilingual), top-5
   │                                  non-Latin questions: rerank every English
   │                                  variant, keep the best-scoring run
   ├─ sufficiency gate ────────────── thresholds on rerank logits (τ_low/τ_high)
   │                                  → SUFFICIENT / PARTIAL / INSUFFICIENT → refusal
   ├─ grounded generation ─────────── LLM, cite-every-statement, answers in the
   │                                  language of the question
   └─ validation + dose scan + risk + decision engine
```

## 2. Model dimensions & limits

| Component | Model | Params | Output dim | Real token ceiling | Notes |
|---|---|---|---|---|---|
| Embedding (current) | `Qwen/Qwen3-Embedding-0.6B` | 595M | **1024** | **32,768** (`max_position_embeddings`; the tokenizer's 131,072 is a trap) | last-token pooling → **left padding required**; instruct query prefix ending `\nQuery:` (no trailing space); bf16 checkpoint → fp32 on CPU |
| Embedding (previous) | `sentence-transformers/all-MiniLM-L6-v2` | 23M | 384 | **256** (ST cap, not the 512 a BERT assumption suggests) | symmetric, no prefix; kept as `alt_minilm` in `config/embedding.yaml` |
| Reranker (current) | `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` | ~118M | logit | 512 | **multilingual** (mMARCO, incl. Arabic); ~3.7 s / 25 pairs on 2 vCPU |
| Reranker (rejected) | `BAAI/bge-reranker-v2-m3` | 568M | logit | 8,192 | measured **105 s / 25 pairs** on 2 free vCPUs — unusable in-path on cpu-basic |
| Reranker (previous) | `cross-encoder/ms-marco-MiniLM-L-6-v2` | 22M | logit | 512 | **English-only** — auto-refused every non-English question (see findings) |
| Generator | `gpt-oss:20b` via Ollama cloud | 20B | — | — | swappable via `LLM_PROVIDER`/`LLM_MODEL` |

Corpus truncation math that drove the embedding swap (7,381 chunks, 835,893 tokens,
largest chunk 4,708 tokens — a never-split table):

| Embed cap | Tokens truncated away | Chunks affected |
|---|---|---|
| 256 (MiniLM) | 33,223 | 120 |
| 512 | 13,434 | 52 |
| **32,768 (Qwen)** | **0** | **0** |

Storage: 7,381 × 1024 × 4 B ≈ 30 MB of vectors; the full Qdrant snapshot is 79 MB.

## 3. Repository structure

```
├── backend/
│   ├── app/
│   │   ├── api/                dependencies.py (resource wiring, env-driven QDRANT_URL)
│   │   ├── llm/                provider.py (anthropic | openai | ollama, config-swappable)
│   │   ├── observability/      structured JSON logging, request-id middleware, rate limit
│   │   ├── prompts/            domain_classifier, query_rewriter (English-variants rule),
│   │   │                       grounded_generator (+ answer-language detector), judges
│   │   ├── schemas/            pydantic contracts (mirrored by frontend Zod types)
│   │   └── services/
│   │       ├── ingestion/      PDF → clean → section-aware chunking (7 strategies)
│   │       ├── retrieval/      embedding_provider (token-budget batching), bm25, qdrant,
│   │       │                   hybrid_search (RRF + domain boost + dedup)
│   │       ├── reranking/      CrossEncoder wrapper, time-budgeted, Null fallback
│   │       ├── rag/            query_orchestrator, sufficiency_gate, evidence_pack,
│   │       │                   citation_resolver
│   │       ├── decisions/      decision engine (emergency/urgent flags)
│   │       └── evaluation/     metrics, eval_runner, relevance
│   └── tests/
├── config/                     chunking.yaml · embedding.yaml (model source of truth) ·
│                               llm.yaml · red_flags.yaml · emergency.yaml · corpus.yaml
├── data/
│   ├── chunk_store/            medical_chunks.jsonl (7,381 chunks, 14 MB)
│   ├── chunks/benchmark/       per-config chunk sets (1.0_S1.jsonl, …)
│   └── evaluation/             dev.jsonl (25) · golden.jsonl · out_of_domain.jsonl (8) · runs/
├── deploy/
│   ├── hf-space/               Docker Space: Dockerfile · nginx.conf (CSP frame-ancestors) ·
│   │                           start.sh (background index build) · index_persistence.py
│   │                           (snapshot restore/publish, keyed by embedding_version)
│   └── gradio-space/           ZeroGPU app: app.py · requirements.txt (torch pinned to
│                               the ZeroGPU allow-list) · README.md
├── docs/                       EMBEDDING-MODELS.md — reusable model field guide
├── frontend/                   React 19 + Vite + Zod; Dockerfile (nginx runtime)
├── scripts/                    ingest → chunk → build_index → evaluate → ablation →
│                               fit_thresholds → compare_chunking
├── tests/                      incl. test_encode_batching.py, test_embedding_prefixes.py
├── backend/Dockerfile          compose `api` service (repo-root context — path-resolution
│                               via parents[4] makes the layout load-bearing)
└── docker-compose.yml          qdrant + api + web
```

## 4. Environment variables

Backend (`.env`, compose `env_file`, or Space variables/secrets):

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `anthropic` \| `openai` \| `ollama` — config swap, never a code change |
| `LLM_MODEL` | `gpt-oss:20b` | generation model |
| `LLM_API_KEY` | — | anthropic/openai key (unused by ollama) |
| `OLLAMA_API_KEY` | — | Ollama cloud key (takes precedence over `LLM_API_KEY`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | local daemon vs cloud |
| `RERANKER_MODEL` | `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` | empty → NullReranker passthrough |
| `RERANKER_TIMEOUT_SECONDS` | `3.0` (Space: `8.0`) | rerank wall-clock budget; blowing it falls back to RRF order, flagged in trace |
| `SUFFICIENCY_TAU_LOW_RERANK` | `-3.60` | refusal threshold on rerank logits — **married to the reranker's logit scale**; recalibrate on any reranker swap |
| `SUFFICIENCY_TAU_HIGH_RERANK` | `-0.39` | "confident" threshold (in-domain p60 policy) |
| `SUFFICIENCY_CROSS_LINGUAL_MARGIN` | `3.0` | widens both rerank taus for mostly-non-Latin questions — the taus are English-fitted, and rewrite paraphrases / cross-lingual pairs score ~3 points lower for the same information need (measured: -3.40 EN vs -6.95 via Arabic rewrite) |
| `QDRANT_URL` | `http://localhost:6333` | env-driven in all 6 call sites (was hardcoded — compose's `qdrant:6333` was silently ignored) |
| `DATABASE_URL` | `sqlite:///./data/traces.db` | trace storage |
| `SNAPSHOT_REPO` | `FatimahEmadEldin/cds-qdrant-snapshots` | dataset repo for index snapshots / vector caches |
| `HF_TOKEN` | — | lets the Space publish its built snapshot (secret) |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allow-list — never `*` |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` | `20` / `60` | in-process sliding window on `/api/query` (per worker — needs Redis for multi-worker) |
| `DEBUG_TRACE` | `true` | include pipeline trace in responses |
| `LOG_LEVEL` | `INFO` | structured JSON logs |

**Not an env var, deliberately:** the embedding model is selected only by
`config/embedding.yaml` (`primary:` block) — the Space Dockerfile bakes weights from that
same file, so image and app can never disagree. An `EMBEDDING_MODEL` env var exists in old
examples but **no code reads it**.

Frontend build args: `VITE_API_BASE_URL` (must be absolute — the transport throws on
empty/relative), `VITE_ENABLE_DEMO_MODE`, `VITE_EMERGENCY_NUMBER`.

## 5. Ablation study

`scripts/ablation.py --split dev`, 25 in-domain queries. **Measured on the previous stack**
(MiniLM embeddings, config S1, ms-marco reranker) — each row adds exactly one component:

| Stage | Recall@5 | Precision@5 | Verdict |
|---|---|---|---|
| Dense only | 0.050 | 0.240 | baseline |
| + BM25 (RRF) | 0.034 | 0.192 | **hurts on this config** — fragmentation confound |
| + rerank (cross-encoder) | 0.052 | 0.224 | +63% over the no-op it replaced |
| + rewrite (multi-query) | 0.056 | 0.248 | best overall |

Context for the low absolute recall: labels are section-granularity while S1 chunks average
113 tokens, so a 20-chunk relevant section caps Recall@5 at 0.25 mechanically; **Hit@5 = 0.48**
("found the right section") is the honest headline. Full analysis, bootstrap CIs, and the
generation/faithfulness evaluation: [`EVALUATION.md`](EVALUATION.md).

> These numbers describe the MiniLM-era stack. The Qwen + multilingual-reranker stack
> deployed on this branch has **not** been re-benchmarked yet — re-running
> `scripts/ablation.py` and `scripts/evaluate.py` under the new stack is the top open item.

## 6. Findings (measured on this branch, 2026-08-18)

**Embedding swap (MiniLM → Qwen3-0.6B)**
- MiniLM's real ceiling is **256 tokens** (sentence-transformers cap), not 512; the original
  chunk configs were 65–70% truncated, which shaped every downstream decision.
- Qwen3-Embedding-0.6B removes truncation entirely (table in §2). Its tokenizer advertises
  131,072 but the model has 32,768 positions — always read `max_position_embeddings`.
- Last-token pooling silently produces garbage with right padding: `padding_side="left"`
  is asserted, not assumed. Loaded dim is checked against config at startup.
- Embedding batches are grouped by **token budget** (8,192 padded tokens), not item count:
  attention is O(n²) and one 4,708-token chunk in a fixed batch of 64 OOMed both a HF build
  container and a ZeroGPU MIG slice (the latter masked as
  `NVML_SUCCESS == r INTERNAL ASSERT` in `CUDACachingAllocator`).

**Multilingual chain (why Arabic questions were auto-refused)**
- Qwen's dense arm is multilingual and worked all along. The failure was downstream: the
  English-only ms-marco reranker scored Arabic↔English pairs at uniformly deep negative
  logits, which the sufficiency gate (fitted on English logits) read as INSUFFICIENT.
- Measured on the same borderline question: **−3.40** asked in English vs **−6.95** through
  its first Arabic rewrite — straddling the old τ_low = −3.93. Translated queries now rerank
  against *every* English variant and keep the best run.
- A named-language instruction beside the question was required to flip the *answer*
  language — a system-prompt rule alone lost to the all-English evidence block.
- Reranker sizing on 2 free vCPUs: bge-reranker-v2-m3 (568M) = 105 s/query (discarded by
  budget); mmarco-mMiniLMv2-L12 = 3.7 s/query. Compute budget is a first-class constraint.

**Gate recalibration (new reranker's logit scale)**
- 20-query live-API fit: in-domain tops −3.52…+5.53, out-of-domain −6.05…−2.09.
- τ_low = −3.60 → refuses 5/7 OOD with **0/12 false refusals** (previous fit: 7/8 with 8%).
  The two escaping OOD queries are the documented overlap class (corpus contains related
  content); catching them would falsely refuse ~⅓ of legitimate queries.

**Deployment (the operational findings)**
- HF **build** containers have far less memory than the 16 GB runtime: never load models or
  build indexes at image-build time — `snapshot_download` files, build the index at startup.
- Free-tier storage is ephemeral: the index is snapshotted to a dataset repo, keyed by
  `embedding_version` (79 MB); every later cold start restores in ~1 minute instead of a
  30–90 min re-embed. A model swap changes the key, so a stale space can never restore.
- A Space must bind its port within ~30 min → the first index build runs in the background
  while nginx serves; `/api/health` reports the honest point count throughout.
- ZeroGPU: torch must be pinned to the platform allow-list; `.to("cuda")` at module scope
  only; the NVML assert masks both wrong-torch and plain OOM.
- Assorted: CRLF shebangs kill Linux containers (`.gitattributes` enforces LF); the Qdrant
  binary needs `libunwind8` in slim images; HF iframes need CSP `frame-ancestors` (both
  `X-Frame-Options` values blank the embed); hardcoded `QDRANT_URL` had made compose's
  service networking dead config.

## 7. Running locally

```bash
cp .env.example .env          # fill OLLAMA_API_KEY (or another LLM provider)
docker compose up             # qdrant :6333, api :8000, web :5173
```

First boot builds the index (or restores the published snapshot if `SNAPSHOT_REPO` is
reachable). Tests: `PYTHONPATH=backend python -m pytest tests/ -q`.

## 8. Reference docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system design
- [`EVALUATION.md`](EVALUATION.md) — full evaluation, limitations stated plainly
- [`docs/EMBEDDING-MODELS.md`](docs/EMBEDDING-MODELS.md) — reusable embedding-model field guide
- [`SPEC.md`](SPEC.md) · [`PLAN.md`](PLAN.md) · [`PROJECT-STATE.md`](PROJECT-STATE.md) · [`TODO-PRODUCTION.md`](TODO-PRODUCTION.md)
