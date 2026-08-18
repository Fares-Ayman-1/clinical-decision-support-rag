"""Clinical CDS Assistant — Gradio + ZeroGPU Space.

A GPU-accelerated sibling of the Docker Space
(FatimahEmadEldin/clinical-decision-support-rag). Same corpus, same
Qwen3-Embedding-0.6B model and instruct-prefix contract, but engineered
around ZeroGPU's constraints:

- No Qdrant server (a Space runs one public process): the corpus is 7,381
  vectors, so dense search is an exact numpy matmul — no ANN index needed.
- Embeddings run inside @spaces.GPU functions on an H200 slice: the corpus
  embed that takes 30-90 min on 2 free vCPUs takes ~1 minute here.
- Corpus vectors are cached in a public dataset repo, keyed by
  EMB_VERSION, so only the very first boot after a model change pays the
  GPU embed; every later cold start downloads a ~30 MB .npz instead.

NOT A MEDICAL DEVICE. Research/hackathon prototype for demonstrating
evidence-grounded retrieval; never for real patient care.
"""

from __future__ import annotations

import os

# Before ANY torch import (sentence_transformers pulls it in): the default
# caching allocator NVML-asserts inside ZeroGPU's MIG slice
# (c10/cuda/CUDACachingAllocator.cpp:1165) on the first dynamic allocation —
# reproduced on both unpinned torch and allow-listed 2.11.0, so it is the
# allocator/MIG interaction, not the torch version. cudaMallocAsync delegates
# to the CUDA driver and skips that NVML path entirely.
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "backend:cudaMallocAsync")

import json
import pathlib
import re
import threading

import gradio as gr
import httpx
import numpy as np
import spaces
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

# --- Configuration (mirrors config/embedding.yaml in the main repo) ---------
EMB_MODEL = "Qwen/Qwen3-Embedding-0.6B"
EMB_VERSION = "qwen3-embed-0.6b-1"
# Qwen3-Embedding is asymmetric: instruct-wrapped queries, bare documents.
# Format from the checkpoint's own config_sentence_transformers.json — the
# wrapper ends "\nQuery:" with NO trailing space.
QUERY_PREFIX = (
    "Instruct: Given a clinical question, retrieve relevant passages "
    "from clinical practice guidelines\nQuery:"
)
SNAPSHOT_REPO = os.environ.get("SNAPSHOT_REPO", "FatimahEmadEldin/cds-qdrant-snapshots")
VECTORS_FILE = f"gradio-vectors-{EMB_VERSION}.npz"
DATA_PATH = pathlib.Path(__file__).parent / "data" / "medical_chunks.jsonl"

LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-oss:20b")
OLLAMA_KEY = os.environ.get("OLLAMA_API_KEY", "").strip()

DENSE_K = 25
BM25_K = 25
RRF_K = 60
TOP_K = 5

DISCLAIMER = (
    "⚠️ **Not a medical device.** Research prototype over a frozen corpus of "
    "seven WHO/national guideline documents. Do not use for real patient care. "
    "**In an emergency, contact local emergency services immediately.**"
)

# --- Corpus ------------------------------------------------------------------
print("loading corpus…", flush=True)
CHUNKS: list[dict] = []
with DATA_PATH.open(encoding="utf-8") as f:
    for line in f:
        CHUNKS.append(json.loads(line))
TEXTS = [c.get("embedded_text") or c["text"] for c in CHUNKS]
print(f"corpus: {len(CHUNKS)} chunks", flush=True)


def _tokenize(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


BM25 = BM25Okapi([_tokenize(t) for t in TEXTS])

# ZeroGPU contract: `.to("cuda")` must happen at MODULE scope — the `spaces`
# package virtualizes CUDA in the main process and materializes the model
# inside the GPU worker. Loading on CPU and moving it inside a @spaces.GPU
# function is exactly what crashed with the NVML INTERNAL ASSERT in
# CUDACachingAllocator. Left padding is REQUIRED: this family pools the last
# token, and right padding would pool a PAD token into quietly wrong vectors.
print("loading embedding model…", flush=True)
import inspect as _inspect

_st_params = _inspect.signature(SentenceTransformer.__init__).parameters
_pad_kw = "processor_kwargs" if "processor_kwargs" in _st_params else "tokenizer_kwargs"
MODEL = SentenceTransformer(EMB_MODEL, **{_pad_kw: {"padding_side": "left"}})
MODEL.max_seq_length = 32768  # the checkpoint's real ceiling (config.json)
MODEL.to("cuda")  # virtualized by `spaces` — see comment above

VECTORS: np.ndarray | None = None
_INDEX_LOCK = threading.Lock()

# GPU-failure fallback. The main process cannot run the packed (virtual-cuda)
# MODEL on CPU, so the fallback is a second, plain-CPU instance, loaded only
# if a GPU call actually fails. Slow for the one-time corpus embed, but a
# working app on CPU beats a crashed one on GPU — and single-query embeds are
# sub-second on CPU anyway.
_CPU_MODEL = None
_CPU_LOCK = threading.Lock()


def _cpu_model() -> SentenceTransformer:
    global _CPU_MODEL
    with _CPU_LOCK:
        if _CPU_MODEL is None:
            print("loading CPU fallback model…", flush=True)
            _CPU_MODEL = SentenceTransformer(EMB_MODEL, device="cpu", **{_pad_kw: {"padding_side": "left"}})
            _CPU_MODEL.max_seq_length = 32768
        return _CPU_MODEL


def _embed_corpus_any() -> np.ndarray:
    try:
        return _gpu_embed_corpus()
    except Exception as exc:
        print(f"GPU corpus embed failed ({type(exc).__name__}: {exc}) - falling back to CPU", flush=True)
        model = _cpu_model()
        out = []
        for i in range(0, len(TEXTS), 32):
            out.append(model.encode(TEXTS[i : i + 32], batch_size=32, convert_to_numpy=True,
                                    normalize_embeddings=True, show_progress_bar=False))
            if i % 640 == 0:
                print(f"CPU embed progress: {i}/{len(TEXTS)}", flush=True)
        return np.vstack(out).astype(np.float32)


def _embed_query_any(q: str) -> np.ndarray:
    try:
        return _gpu_embed_query(q)
    except Exception as exc:
        print(f"GPU query embed failed ({type(exc).__name__}) - CPU fallback", flush=True)
        vec = _cpu_model().encode([f"{QUERY_PREFIX}{q}"], convert_to_numpy=True,
                                  normalize_embeddings=True, show_progress_bar=False)
        return vec[0].astype(np.float32)


def _try_load_cached_vectors() -> np.ndarray | None:
    """Pull the corpus matrix from the dataset repo — tokenless, it's public."""
    try:
        from huggingface_hub import hf_hub_download

        local = hf_hub_download(repo_id=SNAPSHOT_REPO, repo_type="dataset", filename=VECTORS_FILE)
        data = np.load(local)
        vecs, ids = data["vectors"], data["chunk_ids"]
        if len(ids) != len(CHUNKS) or list(ids[:3]) != [c["chunk_id"] for c in CHUNKS[:3]]:
            print("cached vectors don't match this corpus — ignoring", flush=True)
            return None
        print(f"loaded cached vectors {vecs.shape}", flush=True)
        return vecs.astype(np.float32)
    except Exception as exc:
        print(f"no cached vectors ({type(exc).__name__})", flush=True)
        return None


def _publish_vectors(vecs: np.ndarray) -> None:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        print("HF_TOKEN unset — vectors not published (next cold start re-embeds)", flush=True)
        return
    try:
        from huggingface_hub import HfApi

        tmp = pathlib.Path(f"/tmp/{VECTORS_FILE}")
        np.savez_compressed(tmp, vectors=vecs, chunk_ids=np.array([c["chunk_id"] for c in CHUNKS]))
        HfApi(token=token).upload_file(
            repo_id=SNAPSHOT_REPO, repo_type="dataset",
            path_or_fileobj=str(tmp), path_in_repo=VECTORS_FILE,
            commit_message=f"gradio corpus vectors, {EMB_VERSION}",
        )
        tmp.unlink(missing_ok=True)
        print("vectors published to dataset repo", flush=True)
    except Exception as exc:
        print(f"vector publish failed: {type(exc).__name__}: {exc}", flush=True)


# No gr.Progress and no device= inside GPU functions: arguments are pickled
# into the GPU worker process, and the model is already (virtually) on cuda.
@spaces.GPU(duration=240)
def _gpu_embed_corpus() -> np.ndarray:
    """TOKEN-budget batching, not a fixed batch count. A fixed batch of 64 was
    a masked OOM here: this corpus holds a 4,708-token table chunk (never
    split, by the main repo's safety rule), and 64 items padded to 4,708
    tokens exceeds a ZeroGPU MIG slice's memory — surfacing as the cryptic
    'NVML_SUCCESS == r INTERNAL ASSERT' in CUDACachingAllocator rather than a
    clean torch.cuda.OutOfMemoryError. Same design as the Docker provider's
    _encode(); results are scattered back to corpus order because callers
    index vectors positionally."""
    tok = MODEL.tokenizer
    cap = MODEL.max_seq_length
    lengths = [min(len(tok.encode(t)), cap) for t in TEXTS]
    order = sorted(range(len(TEXTS)), key=lambda i: -lengths[i])

    MAX_BATCH_TOKENS = 32768
    MAX_BATCH_ITEMS = 128
    batches, current, current_max = [], [], 0
    for i in order:
        cand = max(current_max, lengths[i])
        if current and (cand * (len(current) + 1) > MAX_BATCH_TOKENS or len(current) >= MAX_BATCH_ITEMS):
            batches.append(current)
            current, current_max = [i], lengths[i]
        else:
            current.append(i)
            current_max = cand
    if current:
        batches.append(current)

    out = np.zeros((len(TEXTS), MODEL.get_sentence_embedding_dimension()), dtype=np.float32)
    for batch in batches:
        vecs = MODEL.encode(
            [TEXTS[i] for i in batch], batch_size=len(batch),
            convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False,
        )
        for pos, idx in enumerate(batch):
            out[idx] = vecs[pos]
    return out


@spaces.GPU(duration=60)
def _gpu_embed_query(q: str) -> np.ndarray:
    vec = MODEL.encode(
        [f"{QUERY_PREFIX}{q}"],
        convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False,
    )
    return vec[0].astype(np.float32)


def _ensure_index(progress=gr.Progress()) -> str:
    global VECTORS
    if VECTORS is not None:
        return "ready"
    with _INDEX_LOCK:
        if VECTORS is not None:
            return "ready"
        cached = _try_load_cached_vectors()
        if cached is not None:
            VECTORS = cached
            return "ready (restored from cache)"
        progress(0.1, desc="Embedding corpus on GPU (~1 min, first launch only)")
        vecs = _embed_corpus_any()
        VECTORS = vecs
        _publish_vectors(vecs)
        return "ready (built on GPU and published)"


# --- Retrieval ---------------------------------------------------------------
def _search(query: str) -> list[tuple[dict, dict]]:
    qvec = _embed_query_any(query)
    dense_scores = VECTORS @ qvec  # exact cosine (both sides L2-normalized)
    dense_top = np.argsort(-dense_scores)[:DENSE_K]
    bm25_scores = BM25.get_scores(_tokenize(query))
    bm25_top = np.argsort(-bm25_scores)[:BM25_K]

    # Reciprocal-rank fusion, same constants as the main backend.
    fused: dict[int, float] = {}
    for rank, idx in enumerate(dense_top, 1):
        fused[int(idx)] = fused.get(int(idx), 0.0) + 1.0 / (RRF_K + rank)
    for rank, idx in enumerate(bm25_top, 1):
        fused[int(idx)] = fused.get(int(idx), 0.0) + 1.0 / (RRF_K + rank)

    ranked = sorted(fused.items(), key=lambda kv: -kv[1])[:TOP_K]
    return [
        (CHUNKS[i], {"rrf": s, "dense": float(dense_scores[i]), "bm25": float(bm25_scores[i])})
        for i, s in ranked
    ]


def _generate(query: str, hits: list[tuple[dict, dict]]) -> str:
    if not OLLAMA_KEY:
        return "_LLM generation disabled (no OLLAMA_API_KEY secret) — retrieved evidence shown below._"
    evidence = "\n\n".join(
        f"[{n}] ({c['document_title']} — {c.get('section_path') or 'n/a'}, "
        f"p.{c.get('page_start')})\n{c['text']}"
        for n, (c, _) in enumerate(hits, 1)
    )
    system = (
        "You are a clinical evidence assistant. Answer ONLY from the numbered "
        "guideline excerpts provided. Cite every claim as [n]. If the excerpts "
        "are insufficient to answer safely, say so plainly and do not guess. "
        "Never give drug doses. Answer in the SAME LANGUAGE as the question — "
        "an Arabic question gets an Arabic answer — even though the excerpts "
        "are English; citation markers [n] stay as-is. "
        "End with: 'This is not medical advice.' translated into that language."
    )
    try:
        r = httpx.post(
            "https://ollama.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OLLAMA_KEY}"},
            json={
                "model": LLM_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": f"Question: {query}\n\nGuideline excerpts:\n{evidence}"},
                ],
            },
            timeout=120,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        return f"_LLM call failed ({type(exc).__name__}) — retrieved evidence shown below._"


@spaces.GPU(duration=30)
def _gpu_diag() -> str:
    """Minimal CUDA op inside the GPU worker: separates 'ZeroGPU/torch broken'
    from 'this app's model call broken' with one click."""
    import torch

    lines = [f"torch {torch.__version__}", f"cuda available: {torch.cuda.is_available()}"]
    a = torch.randn(512, 512, device="cuda")
    lines.append(f"matmul ok: {(a @ a).sum().item():.1f}")
    lines.append(f"device: {torch.cuda.get_device_name(0)}")
    v = MODEL.encode(["diagnostic sentence"], convert_to_numpy=True, normalize_embeddings=True)
    lines.append(f"model encode ok: dim={v.shape[1]}, norm={float((v[0]**2).sum())**0.5:.4f}")
    return "\n".join(lines)


def diagnostics() -> str:
    import traceback

    try:
        return _gpu_diag()
    except Exception:
        return "```\n" + traceback.format_exc()[-1800:] + "\n```"


def answer(query: str, progress=gr.Progress()):
    import traceback

    try:
        return _answer_inner(query, progress)
    except Exception:
        # Surface the real traceback in the UI/API instead of an opaque
        # "RuntimeError" — remote log streaming has been unreliable.
        return "```\n" + traceback.format_exc()[-1800:] + "\n```", "", None


def _answer_inner(query: str, progress):
    query = (query or "").strip()
    if not query:
        return "Please enter a clinical question.", "", None
    state = _ensure_index(progress)
    progress(0.7, desc="Searching + generating…")
    hits = _search(query)
    text = _generate(query, hits)

    evid_md = "\n\n---\n\n".join(
        f"**[{n}] {c['document_title']}**  \n"
        f"*{c.get('section_path') or '(no section)'} — pages {c.get('page_start')}–{c.get('page_end')}*"
        + (f"  \n[source]({c['source_url']})" if c.get("source_url") else "")
        + f"\n\n> {c['text'][:700]}{'…' if len(c['text']) > 700 else ''}"
        for n, (c, _) in enumerate(hits, 1)
    )
    rows = [
        [n, c["chunk_id"], round(s["rrf"], 4), round(s["dense"], 3), round(s["bm25"], 2)]
        for n, (c, s) in enumerate(hits, 1)
    ]
    footer = f"\n\n<sub>index: {state} · model: {EMB_MODEL} · corpus: {len(CHUNKS)} chunks</sub>"
    return text + footer, evid_md, rows


# --- UI ----------------------------------------------------------------------
with gr.Blocks(title="Clinical CDS Assistant") as demo:
    gr.Markdown("# 🩺 Clinical CDS Assistant\nEvidence-grounded answers over WHO clinical guidelines — GPU-accelerated (ZeroGPU).")
    gr.Markdown(DISCLAIMER)
    with gr.Row():
        q = gr.Textbox(
            label="Clinical question",
            placeholder="e.g. What are the danger signs in a child with severe pneumonia?",
            lines=2, scale=4,
        )
        go = gr.Button("Search guidelines", variant="primary", scale=1)
    ans = gr.Markdown(label="Answer")
    with gr.Accordion("Evidence (retrieved guideline excerpts)", open=False):
        evid = gr.Markdown()
    with gr.Accordion("Retrieval scores", open=False):
        table = gr.Dataframe(headers=["#", "chunk_id", "RRF", "dense cos", "BM25"], interactive=False)
    gr.Examples(
        examples=[
            "What are the danger signs in a child with severe pneumonia that require urgent referral?",
            "How should suspected acute coronary syndrome be managed at first contact?",
            "When is oxygen therapy indicated in severe acute respiratory infection?",
            "What are the red flags for stroke requiring immediate transfer?",
        ],
        inputs=q,
    )
    go.click(answer, inputs=q, outputs=[ans, evid, table])
    q.submit(answer, inputs=q, outputs=[ans, evid, table])
    with gr.Accordion("Diagnostics", open=False):
        diag_btn = gr.Button("Run GPU diagnostics")
        diag_out = gr.Markdown()
        diag_btn.click(diagnostics, outputs=diag_out)

if __name__ == "__main__":
    # show_error surfaces worker exceptions to API clients — without it a GPU
    # crash reaches gradio_client as an opaque "enable verbose error" message.
    demo.launch(show_error=True)
