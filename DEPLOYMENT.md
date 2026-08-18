# Deploying to Railway

Three services in one Railway project, all from this repo: `qdrant`, `api`, `web`.

Railway builds the images on its own machines from your GitHub repo, so **you do not
need a working local Docker to deploy**. Local Docker matters only for verifying the
image yourself and for seeding the index (Step 6).

**The API image is verified.** Built and run locally at 612 MB, on a deliberately
non-default `PORT=9137` to prove the port binding: `/api/health` returned `status: ok`
with all five checks green and 7,381 points, both models warm from the baked cache,
the `PRESCRIBING_REQUEST` refusal path fired correctly, rate limiting cut over to 429
after exactly 20 requests with `retry-after: 49`, and logs came out as one JSON object
per line carrying `request_id`.

> **This deploys a demo, not a medical device.** A public URL makes the system
> reachable by real people, which raises rather than lowers the weight of the three
> P0 gates in `TODO-PRODUCTION.md` (SaMD regulatory assessment, clinician sign-off on
> the red-flag rules, HIPAA/GDPR posture). p95 latency is 39.6 s against an 8 s budget
> and faithfulness is 76-87% against a >=90% target. Keep the disclaimer prominent.

---

## Before you start

- A Railway account with the **Hobby plan ($5/mo)**. The API holds torch plus two
  models, roughly 1.5-2.5 GB RSS - the 512 MB trial tier will OOM on startup.
- This repo pushed to GitHub, including commit `29178e8` or later. Earlier commits
  cannot run on Railway at all: nothing bound `$PORT`.
- Your Ollama Cloud API key (`https://ollama.com/settings/keys`).
- A generated Qdrant API key. Any long random string:

  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```

  Save it - Steps 1, 2 and 6 all use the same value.

---

## Step 1 - Create the project and the `qdrant` service

1. **New Project -> Empty Project.**
2. **+ New -> Docker Image** -> `qdrant/qdrant:v1.12.5`.
   Pin the version. `latest` would silently change your vector store under you.
3. Rename the service to **`qdrant`** (Settings -> Service Name). The name becomes the
   internal hostname in Step 2, so this is not cosmetic.
4. **Variables** -> add:

   | Variable | Value |
   |---|---|
   | `QDRANT__SERVICE__API_KEY` | your generated key |
   | `QDRANT__SERVICE__HOST` | `::` |

   `QDRANT__SERVICE__HOST=::` is **required, not optional**. Railway's private network
   is IPv6-only; Qdrant's default IPv4 bind is simply unreachable over
   `qdrant.railway.internal`, and the API would fail every retrieval with no obvious
   cause.

5. **Settings -> Volumes -> Add Volume**, mount path `/qdrant/storage`.
   Without a volume the index is wiped on every redeploy and you would re-run Step 6
   each time.
6. **Do not generate a public domain.** Qdrant stays private. Step 6 opens a temporary
   TCP proxy and then closes it.

---

## Step 2 - Create the `api` service

1. **+ New -> GitHub Repo** -> this repo. Rename the service to **`api`**.
2. **Settings -> Build:**
   - Root Directory: `/`
   - Dockerfile Path: `backend/Dockerfile`

   The build context must be the repo root - the image copies `backend/`, `config/`
   and two files from `data/`.
3. **Settings -> Networking -> Generate Domain.** Note the URL, e.g.
   `https://api-production-xxxx.up.railway.app`.
4. **Settings -> Deploy -> Health Check Path:** `/api/health`.
   Set the healthcheck timeout to **300 seconds**. Startup loads the embedding model
   and warms the cross-encoder; the default window will fail a healthy boot.
5. **Variables:**

   | Variable | Value |
   |---|---|
   | `QDRANT_URL` | `http://qdrant.railway.internal:6333` |
   | `QDRANT_API_KEY` | your generated key (same as Step 1) |
   | `LLM_PROVIDER` | `ollama` |
   | `LLM_MODEL` | `gpt-oss:20b` |
   | `OLLAMA_API_KEY` | your Ollama Cloud key |
   | `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` |
   | `RERANKER_MODEL` | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
   | `FRONTEND_ORIGIN` | the `web` URL - fill in after Step 3 |
   | `RATE_LIMIT_REQUESTS` | `20` |
   | `RATE_LIMIT_WINDOW_SECONDS` | `60` |
   | `LOG_LEVEL` | `INFO` |

   **Do not set `PORT`** - Railway injects it, and the container reads it.

   **Never set `FRONTEND_ORIGIN` to `*`.** A wildcard lets any page on the internet
   post a patient's symptoms to this backend (NFR-3.4).

---

## Step 3 - Create the `web` service

1. **+ New -> GitHub Repo** -> the same repo. Rename to **`web`**.
2. **Settings -> Build:**
   - Root Directory: `frontend`
   - Dockerfile Path: `Dockerfile`
3. **Settings -> Networking -> Generate Domain.** Note the URL.
4. **Variables** -> `VITE_API_BASE_URL` = the **`api`** URL from Step 2.

   This is a **build-time** value. Vite inlines it into the JS bundle, so changing it
   later needs a **redeploy**, not a restart.

---

## Step 4 - Close the loop between the two URLs

`api` needs the web URL for CORS; `web` needs the api URL to call it. Both domains
exist now, so:

1. Go back to **`api` -> Variables** and set `FRONTEND_ORIGIN` to the `web` URL.
2. Redeploy `api`.

Use the exact origin - scheme and host, no trailing slash:
`https://web-production-xxxx.up.railway.app`

---

## Step 5 - Deploy

Deploy in order: **`qdrant` -> `api` -> `web`.**

The first `api` build is slow (torch, transformers, and both models bake into the
image). Later builds reuse the layer cache unless `requirements-serve.txt` changes.

At this point `/api/health` will report **`degraded`** - Qdrant is running but empty.
That is expected until Step 6.

---

## Step 6 - Seed the vector index

A fresh volume has no vectors, and `/api/query` returns `503 RETRIEVAL_UNAVAILABLE`
until it does. Seeding runs from your machine: it re-embeds 7,381 chunks locally
(a few minutes on CPU) and upserts them.

1. **`qdrant` -> Settings -> Networking -> TCP Proxy**, proxy port `6333`.
   Railway gives you a host and port, e.g. `roundhouse.proxy.rlwy.net:41234`.

2. Seed from the repo root:

   ```bash
   QDRANT_URL=http://roundhouse.proxy.rlwy.net:41234 \
   QDRANT_API_KEY=your-key \
   python scripts/build_mvp_index.py --source-config S1 --recreate
   ```

   The script prints its target and whether a key is in use, so you can confirm you
   are not overwriting your local index by mistake.

3. Verify 7,381 points:

   ```bash
   curl -H "api-key: your-key" \
     http://roundhouse.proxy.rlwy.net:41234/collections/medical_chunks
   ```

4. **Remove the TCP proxy.** Qdrant should not stay publicly reachable.

> Faster alternative if you have a populated local Qdrant: snapshot it via
> `POST /collections/medical_chunks/snapshots` and restore through the proxy - same
> exposure window, no re-embedding.

---

## Step 7 - Verify

```bash
API=https://api-production-xxxx.up.railway.app

# 1. Health - expect "ok", qdrant.ok true, chunk_store.chunks 7381
curl -s $API/api/health

# 2. A real answer - expect status "success", every statement citing evidence
curl -s -X POST $API/api/query \
  -H 'Content-Type: application/json' \
  -d '{"message":"What diet helps with high blood pressure?"}'

# 3. A refusal - expect status "refusal", reason "PRESCRIBING_REQUEST", evidence []
curl -s -X POST $API/api/query \
  -H 'Content-Type: application/json' \
  -d '{"message":"what dose of lisinopril should I take"}'
```

Then:

4. Open the `web` URL and submit a question. This is the real test of
   `VITE_API_BASE_URL` and `FRONTEND_ORIGIN` together - a CORS error in the browser
   console means `FRONTEND_ORIGIN` does not exactly match the web origin.
5. Fire 21 queries quickly -> the 21st returns **429** with `RATE_LIMITED` and a
   `Retry-After` header.
6. Check Railway's log view: one JSON object per line, each carrying `request_id`
   (NFR-7.1). Human-readable lines instead mean `PYTHONUNBUFFERED` is not in effect.
7. Redeploy `api` and re-check `/api/health` - `chunk_store.chunks` should still be
   7381, proving the volume is mounted and the index survived.

---

## Troubleshooting

**Health check fails, logs show no error.** Almost always `$PORT`. Confirm you are on
commit `29178e8`+ and that you have not set a `PORT` variable yourself.

**`/api/health` says `degraded`, qdrant not ok.** Either Step 6 has not run, or
`QDRANT__SERVICE__HOST=::` is missing so `qdrant.railway.internal` resolves to nothing
reachable. Check that first - it is the most common silent failure.

**401/403 from Qdrant.** `QDRANT_API_KEY` on `api` does not match
`QDRANT__SERVICE__API_KEY` on `qdrant`.

**Frontend loads but every request fails.** If the browser console shows CORS, fix
`FRONTEND_ORIGIN`. If requests go to `localhost:8000`, `VITE_API_BASE_URL` was not set
at build time - set it and **redeploy** `web`.

**Deploy killed / OOM.** You are on the trial tier. The API needs ~2 GB.

**Rate limiting seems too permissive.** Keep replicas at 1. The limiter holds counters
in process memory, so N replicas allow N times the configured limit
(`TODO-PRODUCTION.md`).

---

## Cost

Hobby is $5/mo of included usage, then metered. Three services running continuously
with a small volume typically lands in the $5-15/mo range. The `api` service dominates:
it holds torch and two models resident.
