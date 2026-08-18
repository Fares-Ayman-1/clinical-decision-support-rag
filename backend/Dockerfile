# syntax=docker/dockerfile:1.7
#
# Backend image for docker-compose.yml's `api` service. Built from the REPO
# ROOT (compose sets `context: .`), not from backend/, because the app reads
# ../config and ../data relative to its own package location.
#
# Directory layout is load-bearing, not cosmetic: every module under
# backend/app/services/ resolves config with
# `pathlib.Path(__file__).resolve().parents[4]` (embedding_provider.py:30,
# corpus_config.py:15, load_cleaned.py:14, red_flags.py:31,
# decision_engine.py:29) and dependencies.py:25 uses parents[3]. Both land on
# the repo root only if the code stays at /app/backend/app/... with config at
# /app/config. Flattening backend/app to /app/app would silently point every
# config lookup one directory too high.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgomp1 is required by torch (sentence-transformers); curl is used by the
# healthcheck below. Kept minimal — no build toolchain, since every pinned
# dependency ships manylinux wheels.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only torch first. The default sentence-transformers dependency
# resolution pulls the CUDA build (~2.5GB of nvidia-* wheels) which is dead
# weight in this container — retrieval runs on CPU here.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url https://download.pytorch.org/whl/cpu torch==2.6.0

COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# --- Model pre-bake -------------------------------------------------------
# embedding_provider.py does `os.environ.setdefault("HF_HUB_OFFLINE", "1")`,
# so at runtime the model is never fetched — it MUST already be in the image
# cache or startup fails with a confusing offline-mode error rather than a
# download attempt. Baked at build time so the container starts with no
# network and no cold-download stall on first query (~80s for the reranker).
ARG EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
ARG RERANKER_MODEL=cross-encoder/ms-marco-MiniLM-L-6-v2
# Promoted ARG -> ENV so the baked model is the same one the app loads at
# runtime: the backend reads EMBEDDING_MODEL/RERANKER_MODEL from the
# environment, so if the two ever diverge the container starts in offline
# mode and then asks for a model that was never cached.
ENV HF_HOME=/opt/hf-cache \
    EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    RERANKER_MODEL=${RERANKER_MODEL}
RUN python -c "import os; \
from sentence_transformers import CrossEncoder, SentenceTransformer; \
SentenceTransformer(os.environ['EMBEDDING_MODEL']); \
CrossEncoder(os.environ['RERANKER_MODEL']); \
print('cached under', os.environ['HF_HOME'])"

# --- Application ----------------------------------------------------------
# config/ and data/ are also bind-mounted by docker-compose.yml, which shadows
# these copies at runtime. They are still copied so the image runs standalone
# (`docker run cds_api`) without the compose mounts.
COPY backend/ /app/backend/
COPY config/ /app/config/
COPY data/ /app/data/

# `import app.main` resolves against /app/backend while __file__-based config
# lookups still resolve to /app — see the layout note at the top.
ENV PYTHONPATH=/app/backend

RUN useradd --create-home --uid 10001 appuser \
  && chown -R appuser:appuser /app /opt/hf-cache
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
