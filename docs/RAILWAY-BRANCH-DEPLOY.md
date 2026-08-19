# Auto-deploying a feature branch on Railway

Companion to [`DEPLOYMENT.md`](../DEPLOYMENT.md) (which sets up `main`). This adds a
parallel, auto-deploying preview of **`feat/qwen3-embedding-and-deploy`** without
touching the production services.

Railway redeploys a service automatically on every push **to the branch that service
tracks** — so "auto-deploy for a branch" just means "a service whose Source is that
branch". No webhooks, no extra CI.

## Recommended: two branch services inside the existing environment

This reuses the production `qdrant` service (and its already-seeded volume), so the
branch preview needs **no Step-6 re-seed**. Safe because the API only reads the
collection at serve time, and both branches embed with the same
`embedding_version: qwen3-embed-0.6b-1` — the vectors are interchangeable.

### api-branch (~3 minutes)

1. Project canvas → **+ New → GitHub Repo** → this repo. Name it **`api-branch`**.
2. **Settings → Source**:
   - **Branch: `feat/qwen3-embedding-and-deploy`** ← the whole point
   - **Root Directory: `/`** (build context; `backend/Dockerfile` copies `config/`
     and two `data/` files that live outside `backend/` — see DEPLOYMENT.md Step 2
     for the ~30–40 MB snapshot-size sanity check)
3. **Settings → Networking → Generate Domain.** Note it — call it
   `https://api-branch-xxxx.up.railway.app`.
4. **Variables** — same table as DEPLOYMENT.md Step 2 **with these corrections**
   (the guide's table predates the reranker fix on this branch):

   | Variable | Value | Why it differs from the old table |
   |---|---|---|
   | `QDRANT_URL` | `http://qdrant.railway.internal:6333` | same shared qdrant |
   | `QDRANT_API_KEY` | the existing key | |
   | `LLM_PROVIDER` / `LLM_MODEL` | `ollama` / `gpt-oss:20b` | |
   | `OLLAMA_API_KEY` | your Ollama Cloud key | |
   | `RERANKER_MODEL` | `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` | **not** bge-v2-m3 — measured ~96–105 s/query on CPU; mmarco is multilingual (Arabic) and takes ~2–4 s |
   | `RERANK_TIMEOUT_SECONDS` | `8.0` | headroom for the L12 model on shared CPU |
   | `SUFFICIENCY_TAU_LOW_RERANK` | `-3.60` | calibrated for mmarco's logit scale |
   | `SUFFICIENCY_TAU_HIGH_RERANK` | `-0.39` | " |
   | `GROQ_API_KEY` | your Groq key | voice input (`/api/transcribe`); omit → mic returns 503 STT_UNCONFIGURED, everything else works |
   | `GROQ_STT_MODEL` | `whisper-large-v3` | |
   | `FRONTEND_ORIGIN` | the `web-branch` URL | fill in after the next section |
   | `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS` | `20` / `60` | |
   | `LOG_LEVEL` | `INFO` | |

### web-branch (~2 minutes)

1. **+ New → GitHub Repo** → this repo again. Name it **`web-branch`**.
2. **Settings → Source**: branch `feat/qwen3-embedding-and-deploy`,
   **Root Directory: `frontend`** (the frontend image is self-contained;
   `frontend/railway.json` pins the rest).
3. **Generate Domain** → this URL is what you open in the browser.
4. **Variables**: `VITE_API_BASE_URL` = the `api-branch` domain from above.
   (Baked at build time — changing it triggers a rebuild, which is correct.)
5. Go back to `api-branch` → set `FRONTEND_ORIGIN` to this `web-branch` URL
   (exact origin, no trailing slash — it's a CORS allow-list, never `*`).

### Verify

```bash
curl https://api-branch-xxxx.up.railway.app/api/health
# expect: status ok, qdrant points 7381 (shared collection), reranker warm
```

Then open the `web-branch` domain, ask the Arabic test question
`ماهي أسباب الالم في الرقبة`, and try the mic button.

Every later `git push` to the branch redeploys both branch services automatically;
pushes to `main` keep deploying the original `api`/`web` pair. Delete the two
branch services when the branch merges.

## Alternative: a full duplicate environment

Project → **Environments → New** → duplicate from production, then in the new
environment change each repo service's branch. Cleaner isolation (own qdrant), but
you must re-seed the index (DEPLOYMENT.md Step 6) because the new volume starts
empty — that's the cost of not sharing.

## Sharp edge to know

Both branch and main services build from the same repo but **different Dockerfiles
per railway.json**, and the branch's `backend/Dockerfile` inherited main's Railway
hardening (PORT binding, `requirements-serve.txt`, baked models via
`backend/scripts/bake_models.py`). If a branch build fails while main's succeeds,
diff those files first.
