# syntax=docker/dockerfile:1.7
#
# All-in-one image for the Hugging Face Space (SDK: docker, app_port: 7860).
# Uploaded to the Space as the root `Dockerfile`; source of truth lives at
# deploy/hf-space/Dockerfile in the repo.
#
# Why one container instead of the three services in docker-compose.yml: a
# Space exposes exactly one port. Qdrant and uvicorn therefore bind loopback
# and nginx is the only public listener. See deploy/hf-space/start.sh.

# --- Stage 1: faqarati UI + its Express API bundle ---------------------------
# The Space's web UI is the faqarati (فقراتي) physio platform imported at
# frontend-faqarati/ — landing page, patient/PT portals, and the Clinical
# Assistant tab that talks to the clinical API same-origin. Its own Express
# API (schedules, exercises, Einstein/Gemini suggestions) is esbuild-bundled
# to a single CJS file so the runtime needs a node BINARY but no node_modules.
FROM node:22-bookworm-slim AS faqarati

WORKDIR /fq
COPY frontend-faqarati/package.json ./
# No lockfile in the faqarati tree — plain install, prod+dev (vite/esbuild).
RUN npm install --no-audit --no-fund
COPY frontend-faqarati/ ./
RUN npx vite build  && npx esbuild server/prod.ts --bundle --platform=node --format=cjs       --outfile=server-bundle.cjs --external:fsevents

# --- Stage 2: runtime ------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp1 -> torch; nginx -> public listener; curl -> readiness gates in
# start.sh and the healthcheck. libunwind8 -> required by the Qdrant binary
# copied in below: it links libunwind-ptrace.so.0, which ships in the official
# qdrant image but not in python:3.12-slim. Without it the binary dies with
# 'error while loading shared libraries' before ever binding a port.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 libunwind8 curl nginx ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default

# Same pinned Qdrant the compose file uses (v1.12.5), lifted straight out of
# the official image rather than re-downloading a release tarball, so the
# Space and local dev run byte-identical server versions.
COPY --from=qdrant/qdrant:v1.12.5 /qdrant /qdrant

# Node runtime for the faqarati Express API. Binary-only copy: the server is
# a self-contained esbuild bundle, so no node_modules ships. Both images are
# Debian bookworm, so the glibc-linked binary runs as-is.
COPY --from=faqarati /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# CPU-only torch: the default sentence-transformers resolution drags in ~2.5GB
# of nvidia-* CUDA wheels. A free Space has no GPU, so that is pure image
# weight and pure build time.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url https://download.pytorch.org/whl/cpu torch==2.6.0

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# --- Models baked into the image ------------------------------------------
# embedding_provider.py does os.environ.setdefault("HF_HUB_OFFLINE", "1"), so
# nothing is fetched at runtime: an unbaked model fails startup with a
# confusing offline error instead of downloading. Baking also removes the
# ~80s cold-load stall on the first query.
ENV HF_HOME=/opt/hf-cache
# bge-reranker-v2-m3 replaces ms-marco-MiniLM: the MS MARCO cross-encoder is
# English-only, and its uniformly negative logits on non-English questions
# were read by the sufficiency gate as INSUFFICIENT — auto-refusing every
# Arabic query. bge-reranker-v2-m3 is multilingual (XLM-R family, same
# lineage as bge-m3), needs no remote code, and loads through the same
# CrossEncoder class. NOTE: its logit scale differs, so the gate thresholds
# MUST be recalibrated (SUFFICIENCY_TAU_{LOW,HIGH}_RERANK env vars).
# bge-reranker-v2-m3 (568M) was the first multilingual pick and it LOADED
# fine but needed 105s per query on 2 free vCPUs - the 3s rerank budget
# discarded every result. The mMARCO multilingual MiniLM is the same family
# as the original English reranker at ~2-3x its cost: multilingual (incl.
# Arabic) and it fits the budget on cpu-basic.
ARG RERANKER_MODEL=cross-encoder/mmarco-mMiniLMv2-L12-H384-v1
ENV RERANKER_MODEL=${RERANKER_MODEL}

# The embedding model name comes from config/embedding.yaml, NOT from an
# EMBEDDING_MODEL env var: no Python in this repo reads that variable -- the
# app resolves the model solely via load_embedding_config(). Baking from a
# separate env var let the two diverge silently, and since
# embedding_provider.py forces HF_HUB_OFFLINE=1, a divergence shows up at
# startup as an unrelated-looking offline error. Reading the same YAML the
# app reads makes that mismatch impossible.
COPY config/embedding.yaml /tmp/embedding.yaml
# snapshot_download fetches files into HF_HOME without LOADING either model:
# instantiating Qwen (2.4 GB fp32) and bge-reranker-v2-m3 (2.3 GB) in one
# python process OOMKilled the memory-starved builder. Offline mode at
# runtime only needs the files present, not a warm load.
RUN python -c "import os, yaml; \
from huggingface_hub import snapshot_download; \
cfg = yaml.safe_load(open('/tmp/embedding.yaml', encoding='utf-8'))['primary']; \
print('caching', cfg['name']); snapshot_download(cfg['name']); \
print('caching', os.environ['RERANKER_MODEL']); snapshot_download(os.environ['RERANKER_MODEL']); \
print('cached under', os.environ['HF_HOME'])"

# --- Application ----------------------------------------------------------
# Layout is load-bearing: modules under backend/app/services/ resolve config
# via Path(__file__).parents[4] and dependencies.py via parents[3]. Both land
# on /app only if the tree stays at /app/backend/app/...
COPY backend/ /app/backend/
COPY config/ /app/config/
COPY data/ /app/data/
COPY scripts/ /app/scripts/
ENV PYTHONPATH=/app/backend

# --- Index is built at STARTUP, not here -----------------------------------
# It used to be baked in this layer. That OOMKilled the builder (exit 137):
# a Hugging Face BUILD container has materially less memory than the Space
# RUNTIME container (16 GB on cpu-basic), and embedding ~7,400 chunks with a
# 0.6B model in float32 does not fit the former. Moving it to start.sh trades
# a slower first boot for a build that actually completes, and the runtime has
# the headroom the builder lacked.
#
# Consequence to keep in mind: free-tier Space storage is ephemeral, so the
# index is rebuilt on each cold start. start.sh skips the rebuild when a
# populated collection is already present, so warm restarts stay fast.

COPY --from=faqarati /fq/dist /usr/share/nginx/html
# The Express bundle plus the runtime-read data files (graphHelpers resolves
# graph.json/search_index.json from CWD — start.sh runs node with cwd=/faq).
COPY --from=faqarati /fq/server-bundle.cjs /faq/server-bundle.cjs
COPY --from=faqarati /fq/graph.json /fq/search_index.json /faq/
COPY deploy/hf-space/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/hf-space/start.sh /usr/local/bin/start.sh
COPY deploy/hf-space/index_persistence.py /usr/local/bin/index_persistence.py
RUN chmod +x /usr/local/bin/start.sh

# Defaults so the Space boots even before any Space variable is set. The
# OLLAMA_API_KEY is intentionally absent — it is injected as a Space secret,
# never baked into a public image layer.
ENV QDRANT_URL=http://127.0.0.1:6333 \
    DATABASE_URL=sqlite:///./data/traces.db \
    LOG_LEVEL=INFO \
    DEBUG_TRACE=true \
    RATE_LIMIT_REQUESTS=20 \
    RATE_LIMIT_WINDOW_SECONDS=60 \
    LLM_PROVIDER=ollama \
    LLM_MODEL=gpt-oss:20b \
    FRONTEND_ORIGIN=https://fatimahemadeldin-clinical-decision-support-rag.hf.space

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
  CMD curl -fsS http://127.0.0.1:7860/api/health || exit 1

CMD ["/usr/local/bin/start.sh"]
