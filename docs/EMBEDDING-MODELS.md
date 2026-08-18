# Embedding Models — Field Guide

A project-agnostic reference for choosing text/multimodal embedding models:
dimensions, real token ceilings, Matryoshka support, prefixes/pooling quirks,
multimodality, licenses, and hosted-API options.

**Provenance:** rows marked ✅ were verified on 2026-08-18 directly from each
checkpoint's `config.json` / `sentence_bert_config.json` / `tokenizer_config.json`
on the Hugging Face Hub. Unmarked rows are from working knowledge (May 2026
cutoff) — re-verify before betting a production index on them. Prices are
deliberately omitted; they drift too fast to be trustworthy in a document.

---

## 1. TL;DR — quick picks

| Need | Pick | Why |
|---|---|---|
| Tiny + fast, English, short chunks | `all-MiniLM-L6-v2` | 384d, 80 MB — but its **real** cap is 256 tokens, not 512 |
| Best small open model, long docs | `Qwen/Qwen3-Embedding-0.6B` | 1024d, 32k ctx, 1.2 GB, Apache-2.0, top MTEB for its size |
| Multilingual + hybrid (dense+sparse+ColBERT) | `BAAI/bge-m3` | one model, three retrieval signals, 8k ctx |
| Long English docs, mid size | `Alibaba-NLP/gte-large-en-v1.5` | 1024d, 8k ctx |
| Max open-weights quality, GPU available | `Qwen/Qwen3-Embedding-8B` | 4096d, 32k ctx — needs ~16 GB (bf16) |
| Storage-constrained | `mxbai-embed-large-v1` or `nomic-embed-text-v1.5` | Matryoshka + binary quantization support |
| Hosted API, text | OpenAI `text-embedding-3-large` / Voyage `voyage-3-large` / Cohere `embed-v4.0` | all support dimension reduction |
| Hosted API, multimodal docs (PDF pages, screenshots) | Cohere `embed-v4.0` or Voyage `voyage-multimodal-3` | image+text in one vector space |
| Medical/clinical text | `abhinand/MedEmbed-large-v0.1`, `NeuML/pubmedbert-base-embeddings`, `ncbi/MedCPT-*` | domain-tuned; all capped at 512 tokens |
| Code search | `nvidia/nv-embedcode-7b-v1` (NIM), `voyage-code-3`, Mistral `codestral-embed` | code-tuned |

---

## 2. How to read the specs (the traps)

**Three different "max tokens" exist, and only one binds.**

1. `config.json → max_position_embeddings` — the model's real positional
   capacity. **This is the binding limit.**
2. `sentence_bert_config.json → max_seq_length` — what sentence-transformers
   *truncates to by default*. Often far below (1). MiniLM-L6-v2: positions=512
   but ST cap=**256** ✅. `all-mpnet-base-v2`: positions=514, ST cap=**384** ✅.
3. `tokenizer_config.json → model_max_length` — frequently garbage: either a
   sentinel (`~1e30`, seen ✅ on `e5-mistral`, `NV-Embed-v2`, `gte-large`) or
   bigger than the model supports (Qwen3-Embedding-0.6B tokenizer says 131072;
   the model has 32768 positions ✅).

**Everything past the cap is truncated silently.** No exception, no warning —
just missing content. Histogram your corpus tokens against the cap before
choosing chunk sizes.

**Asymmetric models need their prefix/instruction — also silently.**
Omitting it costs a few retrieval points with zero errors. Centralize
prefixing in one provider class; never at call sites.

| Family | Query side | Document side |
|---|---|---|
| E5 (`intfloat/e5-*`) | `query: ` | `passage: ` |
| BGE en v1.5 | `Represent this sentence for searching relevant passages: ` | none |
| Qwen3-Embedding | `Instruct: {task}\nQuery:` — **no trailing space** (per the checkpoint's own `config_sentence_transformers.json` ✅) | none |
| GTE-Qwen2 / e5-mistral / NV-Embed | task instruction template | none |
| MiniLM / mpnet / GTE-v1 / arctic | none (symmetric) | none |

**Pooling determines a hidden requirement.**

- *Mean pooling* (MiniLM, BGE, E5, GTE-BERT): padding side irrelevant.
- *CLS pooling* (arctic-embed): irrelevant.
- *Last-token pooling* (Qwen3-Embedding, e5-mistral, GTE-Qwen2, NV-Embed):
  **requires left padding**. Right padding pools a PAD token — quietly wrong
  vectors for every batched item. Set `padding_side="left"`.

**Matryoshka (MRL):** models trained so vectors can be *truncated to the first
k dims* (then re-normalized) with modest quality loss. Cuts storage/latency
without re-embedding. Only works on models trained for it (marked below).

**bf16 checkpoints on CPU:** cast to `float32` explicitly (Qwen3, LLM-based
embedders). CPU bf16 without AMX is slow; fp16 on CPU is worse.

**Never mix vector spaces.** Different model — or same model with a different
prefix or cap — is a different space. Stamp an `embedding_version` into the
vector-store payload and refuse to upsert on mismatch.

---

## 3. Open weights — general text

`dim` = output dimension. `ctx` = binding token ceiling. Params approximate.

### Small (≤150M) — CPU-friendly

| Model | Params | dim | ctx | MRL | Multilingual | License | Notes |
|---|---|---|---|---|---|---|---|
| `all-MiniLM-L6-v2` ✅ | 23M | 384 | **256** | – | ✗ | Apache-2.0 | ST cap is 256, not 512. The default everyone starts with |
| `all-mpnet-base-v2` ✅ | 110M | 768 | **384** | – | ✗ | Apache-2.0 | better than MiniLM, same era |
| `BAAI/bge-small-en-v1.5` ✅ | 33M | 384 | 512 | – | ✗ | MIT | needs the query instruction |
| `Snowflake/snowflake-arctic-embed-m-v1.5` ✅ | 109M | 768 | 512 | ✅ (→256) | ✗ | Apache-2.0 | MRL-trained |
| `thenlper/gte-small` | 33M | 384 | 512 | – | ✗ | MIT | GTE v1 |

### Mid (150M–1B)

| Model | Params | dim | ctx | MRL | Multilingual | License | Notes |
|---|---|---|---|---|---|---|---|
| `BAAI/bge-base-en-v1.5` ✅ | 110M | 768 | 512 | – | ✗ | MIT | |
| `BAAI/bge-large-en-v1.5` ✅ | 335M | 1024 | 512 | – | ✗ | MIT | |
| `intfloat/e5-large-v2` ✅ | 335M | 1024 | 512 | – | ✗ | MIT | `query:`/`passage:` prefixes required |
| `thenlper/gte-large` ✅ | 335M | 1024 | 512 | – | ✗ | MIT | tokenizer max is a sentinel; real cap 512 |
| `mixedbread-ai/mxbai-embed-large-v1` ✅ | 335M | 1024 | 512 | ✅ | ✗ | Apache-2.0 | also binary-quantization-friendly |
| `Alibaba-NLP/gte-large-en-v1.5` ✅ | 434M | 1024 | **8192** | – | ✗ | Apache-2.0 | long-context BERT variant |
| `nomic-ai/nomic-embed-text-v1.5` ✅ | 137M | 768 | **8192** (2048 native positions, RoPE-scaled ✅) | ✅ (64–768) | ✗ | Apache-2.0 | prefixes: `search_query:` / `search_document:` |
| `Qwen/Qwen3-Embedding-0.6B` ✅ | 595M | 1024 | **32768** | ✅ (32–1024) | ✅ 100+ | Apache-2.0 | last-token pooling → **left padding**; instruct query prefix; bf16→fp32 on CPU |
| `Snowflake/snowflake-arctic-embed-l` ✅ | 335M | 1024 | 512 | – | ✗ | Apache-2.0 | |

### Multilingual

| Model | Params | dim | ctx | MRL | License | Notes |
|---|---|---|---|---|---|---|
| `BAAI/bge-m3` ✅ | 568M | 1024 | **8192** | – | MIT | unique: dense + **sparse** + **ColBERT multi-vector** from one model |
| `intfloat/multilingual-e5-large` ✅ | 560M | 1024 | 512 | – | MIT | prefixes required |
| `Alibaba-NLP/gte-multilingual-base` ✅ | 305M | 768 | **8192** | – | Apache-2.0 | |
| `jinaai/jina-embeddings-v3` ✅ | 572M | 1024 | **8192** | ✅ (32–1024) | **CC-BY-NC-4.0** | task-specific LoRA adapters; non-commercial weights (API is commercial) |
| `Snowflake/snowflake-arctic-embed-l-v2.0` ✅ | 568M | 1024 | **8192** | ✅ (→256) | Apache-2.0 | |
| `nomic-ai/nomic-embed-text-v2-moe` ✅ | 475M (305M active) | 768 | **512** ✅ | ✅ (→256) | Apache-2.0 | MoE; note the short ctx despite the v1.5 sibling's 8k |

### Large / LLM-based (1B+, GPU territory)

| Model | Params | dim | ctx | MRL | License | Notes |
|---|---|---|---|---|---|---|
| `Qwen/Qwen3-Embedding-4B` ✅ | 4B | 2560 | 32768 | ✅ | Apache-2.0 | left padding; instruct prefix |
| `Qwen/Qwen3-Embedding-8B` ✅ | 8B | 4096 | 32768 | ✅ | Apache-2.0 | **15.1 GB bf16** ✅ — top of MTEB multilingual |
| `intfloat/e5-mistral-7b-instruct` ✅ | 7B | 4096 | 32768 | – | MIT | last-token pooling |
| `Alibaba-NLP/gte-Qwen2-7B-instruct` ✅ | 7B | 3584 | 32768 (131k positions ✅, served at 32k) | – | Apache-2.0 | |
| `nvidia/NV-Embed-v2` ✅ | 7.8B | 4096 | 32768 | – | **CC-BY-NC-4.0** | latent-attention pooling; **non-commercial** |
| `nvidia/llama-3.2-nv-embedqa-1b-v2` ✅ | 1B | 2048 | 131072 positions ✅ (served 8192 on NIM) | ✅ | NVIDIA license | bidirectional Llama |

---

## 4. Domain-specific

### Medical / clinical (all 512-token capped — plan chunks accordingly)

| Model | dim | ctx | Notes |
|---|---|---|---|
| `abhinand/MedEmbed-base-v0.1` ✅ | 768 | 512 | BGE fine-tuned on clinical QA; also `-small` (384d) / `-large` (1024d ✅) |
| `NeuML/pubmedbert-base-embeddings` ✅ | 768 | 512 | PubMed-abstracts domain |
| `ncbi/MedCPT-Query-Encoder` + `-Article-Encoder` | 768 | 512 | two-tower: query and article encoders are different models |
| `FremyCompany/BioLORD-2023` | 768 | 512 | strongest for clinical *concept/entity* similarity |

General-model caveat: Qwen3-0.6B or BGE-M3 frequently beat small medical
models on medical *retrieval*, because scale wins; domain models shine for
terminology-dense similarity (entity linking, synonym matching). Benchmark on
your own queries before assuming "medical model = better".

### Code

| Model | Access | Notes |
|---|---|---|
| `nvidia/nv-embedcode-7b-v1` | NIM API ✅ / weights | code-retrieval tuned |
| `voyage-code-3` | API | strong docstring↔code |
| Mistral `codestral-embed` | API | MRL dims |
| `Salesforce/SFR-Embedding-Code` family | weights | |

---

## 5. Multimodal embeddings

Two architectures — don't conflate them:

- **Dual-encoder (CLIP-style):** image and text → same vector space. Fast ANN
  search. Weak on dense text inside images.
- **Doc-screenshot / VLM embedders:** embed *rendered pages* (PDFs, tables,
  scans) — often as multi-vector late interaction (ColPali-style), which needs
  a MaxSim index, not plain cosine ANN.

| Model | Modality | dim | Text ctx | License | Notes |
|---|---|---|---|---|---|
| `openai/clip-vit-large-patch14` | img+text | 768 | **77 tokens (!)** | MIT | the 77-token text cap surprises everyone |
| `google/siglip2-*` | img+text | 768–1152 | 64 typical | Apache-2.0 | better than CLIP at the same size |
| `jinaai/jina-clip-v2` ✅ | img+text | 1024 (MRL 64+) | **8192** ✅ | CC-BY-NC-4.0 | rare: real long-text + image in one space |
| `nomic-ai/nomic-embed-vision-v1.5` | img | 768 | – | Apache-2.0 | aligned to nomic-text-v1.5's space → cross-modal search against a text index you already have |
| `vidore/colpali-v1.3`, `colqwen2` | doc pages | multi-vector | – | base-model dependent | late interaction; retrieves tables/figures without OCR |
| `nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1` ✅ | doc pages + text | 2048 | 8192 | NVIDIA | serves on NIM ✅ |
| Cohere `embed-v4.0` | text+img+PDF | 256–1536 (MRL) | ~128k | API | int8/binary output options |
| Voyage `voyage-multimodal-3` | interleaved text+img | 1024 | 32k | API | |
| Google `multimodalembedding@001` | img+text+video | 1408 | – | API | |
| `jina-embeddings-v4` | text+img | 2048 (MRL) | 32k | API / CC-BY-NC | Qwen2.5-VL-based; optional late-interaction mode |

---

## 6. Hosted APIs (no weights)

| Provider / model | dim | Max input | MRL | Multimodal | Notes |
|---|---|---|---|---|---|
| OpenAI `text-embedding-3-small` | 1536 | 8191 tok | ✅ (`dimensions` param) | ✗ | |
| OpenAI `text-embedding-3-large` | 3072 | 8191 tok | ✅ | ✗ | |
| Cohere `embed-v4.0` | 1536 (256/512/1024 opts) | ~128k | ✅ | ✅ | also int8 + binary output |
| Voyage `voyage-3-large` | 1024 (256–2048) | 32k | ✅ | ✗ | Anthropic-recommended pairing |
| Voyage `voyage-3.5` / `-lite` | 1024 | 32k | ✅ | ✗ | price/quality tiers |
| Google `gemini-embedding-001` | 3072 | 2048 tok | ✅ | ✗ | 100+ languages |
| Mistral `mistral-embed` | 1024 | 8k | – | ✗ | |
| Alibaba DashScope `text-embedding-v4` | 64–2048 | 32k | ✅ | ✗ | the hosted Qwen3-Embedding family (8B) |
| Jina API (`jina-embeddings-v3/v4`, `jina-clip-v2`) | varies | 8k–32k | ✅ | v4/clip: ✅ | commercial route around the NC weights |
| NVIDIA NIM (`integrate.api.nvidia.com`) ✅ | varies | varies | – | 2 VLM embedders ✅ | catalog verified live: `bge-m3`, `nv-embedqa-e5-v5`, `nv-embedqa-mistral-7b-v2`, `llama-nemotron-embed-1b-v2`, `nemotron-3-embed-1b`, `arctic-embed-l`, `embed-qa-4`, `nv-embedcode-7b-v1`, + VLM embed models |
| AWS Titan Text Embeddings v2 | 1024/512/256 | 8k | ✅ | ✗ | Bedrock; Cohere is also on Bedrock |

API caveats that bite: per-request batch caps (~96–128 texts), truncation
defaults (silently on for some providers), rate limits during bulk indexing,
and *data governance* — every document and every user query leaves your
infrastructure. For clinical/PII workloads that is a compliance decision, not
a convenience decision.

---

## 7. Sparse & hybrid signals (pair with dense)

| Signal | What | Notes |
|---|---|---|
| BM25 | lexical, no model | strong baseline; hybrid via RRF. *Measure it* — on one fragmented-chunk corpus we tested, BM25 hurt (dense-only R@5 0.050 → +BM25 0.034) |
| `naver/splade-v3` family | learned sparse | inverted-index compatible |
| BGE-M3 sparse head ✅ | learned sparse | free if you already run M3 dense |
| ColBERT (`colbert-ir/colbertv2.0`, `answerdotai/answerai-colbert-small-v1`) | multi-vector late interaction | needs PLAID/MaxSim infra, not plain ANN |

---

## 8. Storage & memory math

```
index bytes (float32) = N_vectors × dim × 4
+ payload + graph overhead (HNSW ≈ 1.1–1.5×)
```

| dim | 100k vecs | 1M vecs | 10M vecs |
|---|---|---|---|
| 384 | 154 MB | 1.5 GB | 15 GB |
| 768 | 307 MB | 3.1 GB | 31 GB |
| 1024 | 410 MB | 4.1 GB | 41 GB |
| 3072 | 1.2 GB | 12 GB | 123 GB |
| 4096 | 1.6 GB | 16 GB | 164 GB |

Quantization: int8 = ÷4 (≈no quality loss with rescoring); binary = ÷32
(pair with float rescoring of the top ~100). MRL truncation stacks with both.

Model RAM to *run*: params × 2 bytes (bf16) or × 4 (fp32), plus activations.
Embedding-time activations scale ~O(seq²) per batch — **batch by token budget
(e.g. ≤8k padded tokens per batch), not by item count**, or one long document
in a batch of 32 will spike memory. (A hosted build container OOMKilled on
exactly this ✅.)

---

## 9. Selection checklist

1. **Languages?** → multilingual table. **Modalities?** → §5.
2. **Chunk length:** histogram your corpus tokens; pick ctx ≥ p99, or accept
   *measured* truncation. Real example ✅: on a 7,381-chunk clinical corpus,
   cap 256 lost 33,223 tokens across 120 chunks; cap 32768 lost zero.
3. **Deployment floor:** CPU-only → ≤0.6B at fp32; free-tier containers →
   check *build* memory separately from runtime memory.
4. **License:** NV-Embed-v2, jina-v3 weights, jina-clip-v2 are **NC** — use
   the API or a different model for commercial work.
5. **Storage budget:** dim × N math above; prefer MRL models when unsure.
6. **Wire the model contract:** prefix/instruction, pooling → padding side,
   normalization, dtype. Assert `loaded_dim == config_dim` at startup.
7. **Version-pin:** stamp `embedding_version` in the index; refuse mixed
   upserts.
8. **Benchmark on your own queries** (~50 labeled pairs is enough to see
   Recall@k / nDCG deltas): MTEB rank ≠ your-corpus rank, especially for
   domain text.
9. **Plan the re-index:** swapping models = full re-embed. Keep raw chunks
   stored so the swap is mechanical.

## 10. Score sources

- **MTEB leaderboard** (HF `mteb/leaderboard`) — filter by size and language;
  beware instruction-tuned models scoring high partly via per-task prompts.
- **BEIR** — the zero-shot IR classic.
- **LongEmbed** — long-context retrieval specifically.
- **Your own eval set** — the only one that settles arguments.
