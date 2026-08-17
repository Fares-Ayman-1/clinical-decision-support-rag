# Evidence-Grounded AI · Clinical Core

React frontend for the heart-failure evidence-grounded decision-support system. The UI is a responsive clinical workspace with answer, evidence, and processing-trace panels. Its visual system uses cream and navy surfaces, restrained gold accents, technical metadata, and a dark command-shell trace panel.

This application supports clinical decision-making; it does not diagnose, replace a clinician, or automatically contact emergency services.

## Requirements

- Node.js 22.13 or newer in the Node 22 release line
- npm 10 or newer
- Chromium installed by Playwright for end-to-end tests

## Local setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

The app runs at `http://localhost:5173`. The API defaults to `http://localhost:8000`.

On Windows PowerShell, copy the environment file with:

```powershell
Copy-Item .env.example .env.local
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Base URL for the FastAPI service |
| `VITE_ENABLE_DEMO_MODE` | `true` | Allows the user to explicitly enter labeled synthetic-demo mode if the API is unavailable |
| `VITE_EMERGENCY_NUMBER` | empty | Optional country-specific number opened only after confirmation |

All `VITE_*` values are compiled into the browser bundle and must never contain secrets. Theme is the only preference permitted in browser storage; clinical questions and results must remain in memory.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server on port 5173 |
| `npm run build` | Type-check and create the production bundle |
| `npm run preview` | Preview the production bundle on port 5173 |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm test` | Run Vitest and React Testing Library tests once |
| `npm run test:watch` | Run component tests in watch mode |
| `npm run test:coverage` | Produce text, JSON summary, and HTML coverage reports |
| `npm run test:e2e` | Run the frontend-only Playwright demo flows |

Playwright starts Vite with demo mode enabled and points the API URL at an intentionally unavailable local port. This verifies the explicit offline-to-demo experience without depending on the backend. Install its browser once with `npx playwright install chromium`.

If Chromium downloads are blocked but Google Chrome is already installed, run the suite with `PLAYWRIGHT_USE_SYSTEM_CHROME=true npm run test:e2e` (or set that variable with `$env:PLAYWRIGHT_USE_SYSTEM_CHROME="true"` in PowerShell).

## API contract

The real API remains the primary data source:

- `GET /api/health`
- `POST /api/query` with `include_trace: true` and `stream: false`
- `GET /api/evidence/{chunk_id}` for canonical full evidence text

Demo results must always be visibly labeled. The app must not silently substitute synthetic data for a failed real request.

## Container build

The production image builds the Vite bundle with Node 22 and serves it from nginx on port 5173:

```bash
docker build -t clinical-core-frontend .
docker run --rm -p 5173:5173 clinical-core-frontend
```

The Dockerfile also accepts an optional BuildKit `npm_ca` secret for networks that inspect TLS. This keeps private trust roots out of the image and build context:

```bash
docker build --secret id=npm_ca,src=/path/to/organization-root-ca.pem -t clinical-core-frontend .
```

Vite variables are build-time values. Override them with build arguments when needed:

```bash
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.test \
  --build-arg VITE_ENABLE_DEMO_MODE=false \
  -t clinical-core-frontend .
```

The nginx configuration includes SPA routing fallback, immutable caching for fingerprinted assets, baseline response hardening, and a container health check.
