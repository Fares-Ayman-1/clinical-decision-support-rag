# فقراتي (Faqarati)

Bilingual (AR/EN) physiotherapy platform prototype — patient portal, PT plan builder (Einstein AI + FitKG), AI exercise room, and admin CMS.

**Stack:** React 19 · Vite · Express API · Gemini · Tailwind CSS v4

---

## Local development (Docker only)

Do **not** install Node.js on the host. Use Docker:

```bash
cp .env.example .env.local   # add GEMINI_API_KEY
docker compose up app --build
```

Open [http://localhost:3000](http://localhost:3000).

### Refresh `package-lock.json` (optional)

When you change `package.json`, regenerate the lockfile inside Docker:

```bash
docker compose run --rm deps
git add package-lock.json
git commit -m "Update package-lock.json"
```

Vercel uses `npm install` (no lockfile required). After generating a lockfile you can switch CI/Vercel to `npm ci` for reproducible builds.

---

## Deploy to Vercel (recommended)

This folder is a **standalone repo** — deploy only `faqarati`, not the parent `physui` monorepo.

### 1. Push to GitHub

```bash
cd faqarati
git init
git add .
git commit -m "Initial Faqarati app with Vercel config"
```

Create a new empty repo on GitHub (e.g. `your-org/faqarati`), then:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_ORG/faqarati.git
git push -u origin main
```

### 2. Connect Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the **faqarati** GitHub repo.
2. Vercel reads `vercel.json` automatically:
   - **Build command:** `npm run build:vercel`
   - **Output:** `dist/` (Vite static app)
   - **API:** `api/index.ts` handles all `/api/*` routes as serverless functions
3. Add environment variable in Vercel → **Settings → Environment Variables**:
   - `GEMINI_API_KEY` — your Google Gemini API key (required for Einstein AI routes)
4. Deploy. Every push to `main` triggers a new production deployment.

### 3. CI on GitHub

`.github/workflows/ci.yml` runs on every push/PR:

- `npm install`
- `npm run lint` (TypeScript)
- `npm run build:vercel`

Vercel’s GitHub integration handles CD (continuous deployment) separately — no extra workflow needed unless you want preview URLs on PRs (enabled by default in Vercel).

---

## Project layout

| Path | Purpose |
|------|---------|
| `src/` | React UI (portals, layout, AI demo) |
| `server/createApp.ts` | Express API routes (shared by local dev + Vercel) |
| `server.ts` | Local dev server (Vite HMR + API) |
| `api/index.ts` | Vercel serverless entry for `/api/*` |
| `graph.json` | FitKG knowledge graph data |
| `vercel.json` | Vercel build & routing config |

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes (for AI features) | Google Gemini API key |
| `NODE_ENV` | Auto | Set to `production` on Vercel |
| `PORT` | Local only | Default `3000` |

---

## Notes

- **In-memory data** (schedules, session logs) resets on Vercel serverless cold starts — fine for prototype; use Supabase in P2.
- **Parent repo:** `physui/` may contain BRDs and other projects; only this `faqarati/` folder should be linked to the GitHub remote and Vercel project.
