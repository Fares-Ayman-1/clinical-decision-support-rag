---
title: Clinical CDS Assistant
emoji: 🩻
colorFrom: green
colorTo: blue
sdk: gradio
sdk_version: 6.24.0
app_file: app.py
pinned: false
license: mit
short_description: GPU (ZeroGPU) clinical guideline RAG over WHO documents
---

# Clinical CDS Assistant (ZeroGPU)

GPU-accelerated sibling of the full-stack Docker Space
([clinical-decision-support-rag](https://huggingface.co/spaces/FatimahEmadEldin/clinical-decision-support-rag)).
Same corpus (7 WHO/national guideline documents, 7,381 chunks), same
`Qwen/Qwen3-Embedding-0.6B` contract — but embeddings run on a ZeroGPU H200
slice, so the corpus index builds in about a minute instead of the better part
of an hour on free CPUs.

**Architecture notes**

- Dense search is an exact numpy matmul — at 7,381 × 1024 there is nothing an
  ANN index would add except moving parts.
- Hybrid retrieval: dense top-25 + BM25 top-25 → reciprocal-rank fusion
  (same constants as the main backend).
- Corpus vectors are cached in
  [cds-qdrant-snapshots](https://huggingface.co/datasets/FatimahEmadEldin/cds-qdrant-snapshots),
  keyed by embedding version — only the first boot after a model change pays
  the GPU embed.
- Generation via Ollama cloud (`OLLAMA_API_KEY` secret); without the secret
  the app still retrieves and shows evidence.

> ⚠️ **Not a medical device.** Research prototype. Never use for real
> patient care.
