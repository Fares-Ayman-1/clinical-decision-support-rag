# syntax=docker/dockerfile:1.7
#
# All-in-one image for the Hugging Face Space (SDK: docker, app_port: 7860).
# Uploaded to the Space as the root `Dockerfile`; source of truth lives at
# deploy/hf-space/Dockerfile in the repo.
#
# Why one container instead of the three services in docker-compose.yml: a
# Space exposes exactly one port. Qdrant and uvicorn therefore bind loopback
# and nginx is the only public listener. See deploy/hf-space/start.sh.

# --- Stage 1: React bundle -------------------------------------------------
FROM node:22.17-alpine AS frontend

WORKDIR /fe

# Absolute, not relative: api-transport.ts:78 (`normalizeBaseUrl`) throws a
# TypeError on an empty base, so "" or "/" would break the app at runtime.
# Same origin as the Space itself, so nginx proxies /api without CORS.
ARG VITE_API_BASE_URL=https://fatimahemadeldin-clinical-decision-support-rag.hf.space
ARG VITE_ENABLE_DEMO_MODE=true
ARG VITE_EMERGENCY_NUMBER=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_ENABLE_DEMO_MODE=${VITE_ENABLE_DEMO_MODE} \
    VITE_EMERGENCY_NUMBER=${VITE_EMERGENCY_NUMBER}

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline --no-audit --no-fund --maxsockets=4
COPY frontend/ ./
RUN npm run build

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
ARG RERANKER_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
ENV RERANKER_MODEL=${RERANKER_MODEL}

# The embedding model name comes from config/embedding.yaml, NOT from an
# EMBEDDING_MODEL env var: no Python in this repo reads that variable -- the
# app resolves the model solely via load_embedding_config(). Baking from a
# separate env var let the two diverge silently, and since
# embedding_provider.py forces HF_HUB_OFFLINE=1, a divergence shows up at
# startup as an unrelated-looking offline error. Reading the same YAML the
# app reads makes that mismatch impossible.
COPY config/embedding.yaml /tmp/embedding.yaml
RUN python -c "import os, yaml; \
from sentence_transformers import CrossEncoder, SentenceTransformer; \
cfg = yaml.safe_load(open('/tmp/embedding.yaml', encoding='utf-8'))['primary']; \
kw = {}; \
kw.update({'tokenizer_kwargs': {'padding_side': cfg['tokenizer_padding_side']}} if cfg.get('tokenizer_padding_side') else {}); \
kw.update({'model_kwargs': {'torch_dtype': cfg['torch_dtype']}} if cfg.get('torch_dtype') else {}); \
print('baking embedding model:', cfg['name']); \
SentenceTransformer(cfg['name'], **kw); \
CrossEncoder(os.environ['RERANKER_MODEL']); \
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

COPY --from=frontend /fe/dist /usr/share/nginx/html
COPY deploy/hf-space/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/hf-space/start.sh /usr/local/bin/start.sh
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
