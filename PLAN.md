# PLAN.md — Implementation Plan

**Project:** Evidence-Grounded AI Clinical Decision Support Lite
**Duration:** 5 days · **Team:** 5 people
**Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) · **Requirements:** [SPEC.md](SPEC.md) · **Live status:** [PROJECT-STATE.md](PROJECT-STATE.md)
**Original product vision (preserved):** [docs/plan-v0-original.md](docs/plan-v0-original.md)

> **Task tags**
> `[MVP]` — required for a complete hackathon submission
> `[OPT]` — do it only if the phase finishes ahead of schedule
> `[PROD]` — explicitly deferred; tracked in [TODO-PRODUCTION.md](TODO-PRODUCTION.md)
>
> **[GUIDE]** marks a hackathon-mandated item. **[TEAM]** marks a team recommendation.

---

## 0. How to Read This Plan

Nineteen logical phases are mapped onto the five-day timeline the hackathon guide defines. Phases
are not strictly sequential — five people work in parallel across four tracks, and the dependency
column tells you what must land before a phase can start.

### The governing constraint

**70 of 100 rubric points are Retrieval Precision (30), Answer Grounding & Citations (25), and
Evaluation Metrics (15).** When time runs short, protect those three. The cut-lines at the end of
each day tell you exactly what to drop and in what order.

### Team roles

| Role | Owner | Owns |
|---|---|---|
| **R1** — Ingestion Engineer | _assign_ | Phases 2–5: parsing, cleaning, chunking, metadata |
| **R2** — Retrieval Engineer | _assign_ | Phases 6–9: embeddings, vector store, hybrid search, reranking |
| **R3** — Evaluation & Safety Engineer | _assign_ | Phases 13, 16–17: eval harness, safety, risk rules |
| **R4** — Backend Engineer | _assign_ | Phases 10–12, 14: prompts, generation, citations, API |
| **R5** — Frontend Engineer | _assign_ | Phases 15, 19: UI, evidence inspector, trace panel, demo |

Everyone must be able to explain the full end-to-end pipeline. **[GUIDE]** Day 5 is a live
presentation with judge stress-testing; a team member who only knows their own module is a
liability under questioning.

### Hackathon gates **[GUIDE]**

| Gate | When | Requirement | Owner |
|---|---|---|---|
| **Initial Screening** | Pre-event | Python/API skills verified; team of 2–4 | All |
| **Scope Approval** | **Day 1** | Mentors approve chosen guidelines for legal + technical suitability | R1 + R3 |
| **Technical Milestone** | **Day 3** | Internal review of functional RAG pipeline and citation accuracy | All |
| **Final Evaluation** | **Day 5** | Live presentation, 15–30 min, judge-provided query | All |

> ⚠️ **Two open items to resolve before the event starts.** (1) The guide specifies teams of
> **2–4 members**; this team has **5**. Confirm with organizers. (2) The guide requires selecting
> **1–2** guideline PDFs; this project uses **7** (decision D1). Phase 1 prepares the justification
> and the fallback.

---

# PHASE 1 — Project Setup & Scope Approval

**Day 1 morning · Owners: all · Duration: ~2h**

### Objective
Establish the repository, environment, and — critically — pass the **[GUIDE]** Day-1 Scope Approval
gate with a 7-document corpus.

### Tasks
- `[MVP]` Initialize git repository; `.gitignore` covering `data/raw/`, `.env`, `__pycache__`, `node_modules`
- `[MVP]` Python 3.11 virtualenv; `requirements.txt` with **pinned** versions
- `[MVP]` Scaffold the directory tree from [ARCHITECTURE.md](ARCHITECTURE.md) §15
- `[MVP]` `docker-compose.yml` with the `qdrant` service; verify it starts
- `[MVP]` `.env.example` — `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `EMBEDDING_MODEL`, `RERANKER_MODEL`, `QDRANT_URL`, `DEBUG_TRACE`
- `[MVP]` Download all 7 PDFs into `data/raw/`; record SHA-256 for each
- `[MVP]` **[GUIDE]** Write `docs/knowledge-base.md`: per document — title, publisher, year, source URL, access date, **license**, usage justification
- `[MVP]` **[GUIDE]** Verify public accessibility and legal usability of every document
- `[MVP]` Write `config/corpus.yaml` with **`tier` and `enabled` flags per document** (the D1 fallback)
- `[MVP]` Prepare a one-page scope justification for mentors: why 7 documents, and the Tier-1 fallback to 2
- `[MVP]` Confirm team-size question with organizers
- `[MVP]` Agree on the demo laptop and verify it can run Qdrant + a cross-encoder

### Expected output
Running skeleton repository · 7 PDFs staged with checksums · `docs/knowledge-base.md` license
attestation · mentor-ready scope justification.

### Dependencies
None.

### Completion criteria
- [ ] `docker compose up qdrant` succeeds
- [ ] All 7 PDFs present and checksummed
- [ ] License attestation complete for every document
- [ ] **Mentors have approved the scope** ← blocking gate
- [ ] If mentors require 1–2 documents: Tier 2 set to `enabled: false`, Tier 1 confirmed sufficient for every acceptance criterion

---

# PHASE 2 — Data & Source Preparation

**Day 1 morning · Owner: R1 · Duration: ~1h**

### Objective
Profile each PDF so that parsing decisions are informed rather than discovered mid-implementation.

### Tasks
- `[MVP]` For each PDF record: page count, text-layer presence, heading style, table density
- `[MVP]` **Fail loudly on any document with no extractable text layer** — OCR is out of MVP scope
- `[MVP]` Confirm Tier 1 = `who_acs_stroke` + `who_bec`
- `[MVP]` Flag table-dense documents (`who_aware`, `who_sari`) for the table-extraction path
- `[MVP]` Sample 5 random pages per document; note parsing hazards (multi-column, figures, footnotes)
- `[MVP]` Draft `config/heading_profiles/{document_id}.yaml` for both Tier-1 documents

### Expected output
`docs/corpus-profile.md` · two hand-tuned heading profiles · five generic ones.

### Dependencies
Phase 1.

### Completion criteria
- [ ] Every document profiled; no document lacks a text layer
- [ ] Table-dense documents identified
- [ ] Tier-1 heading profiles drafted

---

# PHASE 3 — Document Ingestion

**Day 1 · Owner: R1 · Duration: ~3h**

### Objective
**[GUIDE]** Parse all PDFs with exact, never-inferred page anchoring.

### Tasks
- `[MVP]` PyMuPDF extraction preserving page number and layout coordinates
- `[MVP]` pdfplumber table extraction → Markdown, for flagged documents
- `[MVP]` Emit the Canonical Document Object → `data/parsed/{document_id}.json`
- `[MVP]` **Page number captured at extraction time and never recomputed downstream**
- `[MVP]` `scripts/ingest.py` CLI: `--document-id`, `--all`
- `[MVP]` Parse-quality gate: % pages yielding text, warn below 95%
- `[OPT]` Figure-caption extraction

### Expected output
7 canonical document JSON files with page-accurate text and Markdown tables.

### Dependencies
Phase 2.

### Completion criteria
- [ ] All enabled documents parsed
- [ ] Spot-check: 5 random chunks per document match the real PDF page **exactly**
- [ ] Tables render as readable Markdown
- [ ] Parse-quality gate passes for every document

---

# PHASE 4 — Cleaning & Preprocessing

**Day 1 · Owner: R1 · Duration: ~2h**

### Objective
Remove content that would otherwise pollute retrieval and directly depress Precision@5.

### Tasks
- `[MVP]` Header/footer removal via frequency analysis (lines on >30% of pages at consistent y-position)
- `[MVP]` De-hyphenation across line breaks
- `[MVP]` Whitespace normalization preserving paragraph structure
- `[MVP]` Ligature and smart-quote repair
- `[MVP]` **Boilerplate section filter** — TOC, index, references, acknowledgements, copyright
- `[MVP]` Section detection using the heading profiles; build hierarchical `section_path`
- `[MVP]` Inherited-section fallback with `section_confidence: "inherited"`
- `[MVP]` Before/after diff report for manual inspection

### Expected output
Cleaned canonical documents with hierarchical section paths.

### Dependencies
Phase 3.

### Completion criteria
- [ ] No repeated headers/footers survive in sampled output
- [ ] TOC and reference sections excluded
- [ ] Section paths correct on 10 manually-checked pages per Tier-1 document
- [ ] No text lost from body content (verified by diff review)

---

# PHASE 5 — Chunking & Metadata

**Day 1 afternoon · Owner: R1 · Duration: ~3h**

### Objective
**[GUIDE]** Section-aware chunking with complete, citation-ready metadata.

### Tasks
- `[MVP]` Section-aware chunker — **a chunk never crosses a section boundary**
- `[MVP]` Config A: 400–600 tokens, 15% overlap
- `[MVP]` Config B: 250–350 tokens, 20% overlap
- `[MVP]` Tables are never split; oversized tables flagged
- `[MVP]` **Contextual header prefixing** — build `embedded_text` as `"{doc} > {section} > {subsection}\n\n{text}"`
- `[MVP]` Chunk IDs: `{document_id}_p{page}_s{section}_c{n}`
- `[MVP]` Domain tagging from `config/corpus.yaml`
- `[MVP]` `chunk_type` classification: recommendation / guidance / table / background
- `[MVP]` **`evidence_grade` extraction** — USPSTF A/B/C/D/I via regex on both USPSTF documents
- `[MVP]` Quality gate: drop <40-token chunks (unless `recommendation`), dedup by `content_hash`
- `[MVP]` Emit `data/chunks/{kb_version}_{config}.jsonl`
- `[MVP]` Build the Chunk Store loader — the authoritative citation source

### Expected output
Two chunk datasets (config A and B) with full metadata per [ARCHITECTURE.md](ARCHITECTURE.md) §6.5.

### Dependencies
Phase 4.

### Completion criteria
- [ ] Every chunk carries valid `document_id`, `section_path`, `page_start`, `page_end`
- [ ] No chunk spans two sections
- [ ] `embedded_text` includes the contextual prefix
- [ ] `evidence_grade` populated where USPSTF grades exist
- [ ] Manual review of 20 random chunks: coherent and correctly attributed

---

# PHASE 6 — Embeddings

**Day 1 evening → Day 2 midday · Owner: R2 · Duration: ~2h + benchmark**

### Objective
Select and correctly apply an embedding model. **Decision deadline: Day 2 midday.**

### Tasks
- `[MVP]` `EmbeddingProvider` interface — `embed_queries()` / `embed_passages()`
- `[MVP]` **Declare the asymmetric prefix pair per model** in `config/embedding.yaml`, applied centrally
- `[MVP]` L2-normalize all vectors; cosine everywhere
- `[MVP]` Batch embedding with a progress bar
- `[MVP]` Stamp `embedding_version` on every chunk
- `[MVP]` Pin exactly **two** candidate models
- `[MVP]` **[GUIDE]** Benchmark both on the `dev` split; decide by Day 2 midday
- `[MVP]` Record the decision and its numbers in [PROJECT-STATE.md](PROJECT-STATE.md)

> ⚠️ Omitting the `query:`/`passage:` prefixes degrades retrieval substantially and **silently** —
> no error, just worse results. Verify the prefixes are actually being applied before benchmarking,
> or the benchmark measures nothing.

### Expected output
Embedded chunk vectors · a two-model comparison with a recorded decision.

### Dependencies
Phase 5, and Phase 13's `dev` split for the benchmark.

### Completion criteria
- [ ] Prefixes verifiably applied (assert in a unit test)
- [ ] All vectors normalized
- [ ] Two models benchmarked; winner recorded with numbers
- [ ] `embedding_version` stamped everywhere

---

# PHASE 7 — Vector Database

**Day 2 morning · Owner: R2 · Duration: ~2h**

### Objective
**[GUIDE]** Index all chunks with retrievable metadata.

### Tasks
- `[MVP]` Qdrant collection `medical_chunks` with named vectors `dense` and `sparse`
- `[MVP]` Payload schema mirroring the chunk metadata
- `[MVP]` Payload indexes on `document_id`, `domains`, `chunk_type`
- `[MVP]` Build BM25 sparse vectors over the same chunks
- `[MVP]` `scripts/build_index.py` — idempotent, with a `--recreate` flag
- `[MVP]` **Refuse to run against a collection with a mismatched `embedding_version`**
- `[MVP]` Chunk Store loads into memory at startup
- `[MVP]` Verify count: indexed points == chunk count

### Expected output
Populated Qdrant collection with dense + sparse vectors and complete payloads.

### Dependencies
Phase 6.

### Completion criteria
- [ ] Point count matches chunk count exactly
- [ ] Both named vectors queryable
- [ ] A sample query returns plausible chunks with correct page metadata
- [ ] Rebuild from scratch takes under 10 minutes

---

# PHASE 8 — Retrieval

**Day 2 · Owner: R2 · Duration: ~4h**

### Objective
**[GUIDE]** High-precision semantic search. **This phase carries 30 of 100 points.**

### Tasks
- `[MVP]` Dense top-25, **unfiltered**
- `[MVP]` BM25 top-25, **unfiltered**
- `[MVP]` **Reciprocal Rank Fusion**, `k=60`
- `[MVP]` **Domain boost — a score bonus, never a filter** (see the warning below)
- `[MVP]` Unfiltered fallback whenever boosted results are weak
- `[MVP]` Near-duplicate suppression: `content_hash`, then pairwise cosine > 0.95
- `[MVP]` **[GUIDE]** Log every score — dense, BM25, RRF — for the trace panel
- `[MVP]` **[GUIDE]** Tune chunk size/overlap: run config A vs B, pick the winner
- `[MVP]` **[GUIDE]** Tune `k`
- `[MVP]` Tune `DOMAIN_BOOST` on the `dev` split; **set it to zero if it doesn't help**

> ⚠️ **Never hard-filter on a predicted domain.** With 7 documents, a misroute excludes the correct
> document and returns recall of zero — silently, with a confident-looking answer built on the wrong
> evidence. Boost, never filter. This is the single most consequential retrieval decision in the
> project.

### Expected output
Hybrid retrieval service with full score transparency and tuned parameters.

### Dependencies
Phases 7, 13.

### Completion criteria
- [ ] Hybrid beats dense-only on `dev` Recall@5 (or BM25 is dropped, with the number recorded)
- [ ] Chunk config chosen on measured results
- [ ] Domain boost never reduces the candidate set
- [ ] All scores exposed in the API response

---

# PHASE 9 — Reranking & Query Optimization

**Day 2 afternoon · Owner: R2 · Duration: ~3h**

### Objective
Maximize top-5 precision and produce the calibrated signal the Sufficiency Gate depends on.

### Tasks
- `[MVP]` Cross-encoder reranker behind a `Reranker` interface
- `[MVP]` Rerank 25 candidates → top 5
- `[MVP]` Measure CPU latency; confirm it fits the ~2s stage budget
- `[MVP]` **Query rewriter** — lay language → 2–3 clinical variants, results fused *(the D2 mitigation)*
- `[MVP]` Cache rewrites by input hash
- `[MVP]` Warm the reranker at startup
- `[MVP]` Timeout fallback: on reranker failure, use RRF order and flag it in the trace
- `[MVP]` Produce the **ablation table**: dense → +BM25 → +rerank → +rewrite
- `[OPT]` Tune the candidate count (25 vs 40)

### Expected output
Reranked retrieval and the completed ablation table.

### Dependencies
Phase 8.

### Completion criteria
- [ ] Reranking measurably improves `dev` Precision@5
- [ ] Query rewriting measurably improves `dev` Recall@5 (**or is removed**)
- [ ] Latency inside budget
- [ ] Ablation table populated with real numbers

---

# PHASE 10 — Prompt Engineering

**Day 3 morning · Owner: R4 · Duration: ~3h**

### Objective
**[GUIDE]** Strict grounding prompts that prohibit external knowledge.

### Tasks
- `[MVP]` `01_symptom_extractor` — free text → structured patient state
- `[MVP]` `02_domain_classifier` — patient state → domain labels
- `[MVP]` `03_query_rewriter` — lay → clinical variants
- `[MVP]` `04_grounded_generator` — Evidence Pack → cited statements
- `[MVP]` `05_followup_generator` — one targeted question
- `[MVP]` **[GUIDE]** Explicit prohibition on external medical knowledge in the generator prompt
- `[MVP]` Enforce precedence: System Policy > App Rules > Evidence > User Content
- `[MVP]` Wrap evidence in delimiters, labeled untrusted data
- `[MVP]` Pydantic schema for every prompt output; one retry on violation
- `[MVP]` Version every prompt file
- `[OPT]` `06_faithfulness_judge` for offline evaluation

> The generator prompt must present evidence as `E1`, `E2`, … **with no document title, section, or
> page number.** This is what makes fabricated citations unrepresentable rather than merely
> detectable.

### Expected output
Six versioned prompts with validated schemas.

### Dependencies
Phase 5 (Evidence Pack shape).

### Completion criteria
- [ ] Every prompt returns schema-valid JSON across 10 test inputs
- [ ] Generator prompt contains no citation metadata
- [ ] Injection attempt in user text does not alter behavior

---

# PHASE 11 — LLM Integration & Generation

**Day 3 · Owner: R4 · Duration: ~3h**

### Objective
Assemble Evidence Pack → Sufficiency Gate → grounded generation.

### Tasks
- `[MVP]` `LLMProvider` interface — `complete()`, `complete_structured()`
- `[MVP]` Temperature 0.1, structured output, timeout, one retry
- `[MVP]` Evidence Pack builder with `E1…En` labels
- `[MVP]` **Sufficiency Gate** — four states, thresholds from Phase 13
- `[MVP]` Grounded Generator producing `statements[{text, evidence_ids[]}]`
- `[MVP]` **[GUIDE]** Structured response: recommendation, excerpt, citation
- `[MVP]` Conflict detection → populate `conflicts[]`
- `[MVP]` Streaming to the client
- `[MVP]` **[GUIDE]** Refusal path for `INSUFFICIENT` / `OUT_OF_SCOPE`
- `[MVP]` Refusal templates adapted to risk context

### Expected output
Working generation producing structured, evidence-labeled output.

### Dependencies
Phases 9, 10.

### Completion criteria
- [ ] Generator never emits a document, section, or page
- [ ] Every statement carries ≥1 `evidence_id`
- [ ] Four sufficiency states all reachable in testing
- [ ] Refusal fires reliably on out-of-domain queries

---

# PHASE 12 — Citation Handling

**Day 3 · Owner: R4 · Duration: ~2h**

### Objective
**[GUIDE]** Transparent citations — document name, section, page. **25 points.**

### Tasks
- `[MVP]` **Citation Resolver** — `evidence_id` → `chunk_id` → Chunk Store record
- `[MVP]` Attach `document_title`, `section_path`, `page_start`, `page_end`, `evidence_grade`, `source_url`
- `[MVP]` **Programmatic validation** (no LLM call):
  - every statement has ≥1 `evidence_id`
  - every id exists in the Evidence Pack
  - every excerpt is a verbatim substring of its chunk
  - refuse if no statements survive
- `[MVP]` Inline `[1] [2]` citation markers in rendered text
- `[MVP]` `GET /api/evidence/{chunk_id}` for the inspector
- `[MVP]` Unit tests for each validation rule

### Expected output
Server-resolved citations that cannot be fabricated.

### Dependencies
Phase 11.

### Completion criteria
- [ ] 100% of citations resolve to real chunks with correct pages
- [ ] Fabricated `evidence_id` in a test payload is rejected
- [ ] Non-verbatim excerpt is dropped
- [ ] Zero LLM calls in the validation path

---

# PHASE 13 — Evaluation Harness

**Day 1 evening → Day 2 · Owner: R3 · Duration: ~5h**

> **This phase starts on Day 1, not Day 4.** Evaluation is the only instrument for tuning the
> 30-point retrieval criterion, and it is worth 15 points itself. Building it late means every
> earlier tuning decision was guesswork.

### Objective
Ground-truth datasets and a metrics harness that runs on one command.

### Tasks
- `[MVP]` Author **50–70 labeled queries** with known document / section / page
- `[MVP]` Write queries in **patient voice**; label against clinician-language sections *(this measures the real D2 gap)*
- `[MVP]` Split: `dev` (~40, tuning) · `golden` (~20, **report only**) · `out_of_domain` (~15)
- `[MVP]` Retrieval metrics: Recall@5, **[GUIDE]** Precision@5, MRR, nDCG@5, Hit@k
- `[MVP]` `scripts/evaluate.py --split dev|golden|out_of_domain`
- `[MVP]` Ablation runner producing the 4-row table
- `[MVP]` **Threshold calibration** — fit `τ_high` / `τ_low` on `dev` + `out_of_domain`
- `[MVP]` **[GUIDE]** Citation accuracy metric
- `[MVP]` **[GUIDE]** Faithfulness evaluation (LLM-judge, versioned rubric)
- `[MVP]` Correct-refusal and false-refusal rates
- `[MVP]` Results → `EVALUATION.md` + `GET /api/eval/report`
- `[OPT]` Confidence calibration plot

> Never tune against `golden`. A technical panel will ask whether you did.

### Expected output
Three labeled splits · one-command harness · `EVALUATION.md` · calibrated thresholds.

### Dependencies
Phase 5 for labels; feeds Phases 6, 8, 9, 11.

### Completion criteria
- [ ] ≥50 labeled queries across three splits
- [ ] All retrieval metrics computed
- [ ] Ablation table populated
- [ ] Thresholds fitted, not chosen by hand
- [ ] Generation metrics computed
- [ ] `EVALUATION.md` contains real numbers

---

# PHASE 14 — Medical Safety Guardrails

**Day 3 evening → Day 4 · Owner: R3 · Duration: ~4h**

### Objective
**[GUIDE]** Hallucination detection and refusal. Clinical Safety = 10 points.

### Tasks
- `[MVP]` `config/redflags.yaml` — each rule carries `derived_from: <chunk_id>`, reviewer, review date
- `[MVP]` Red-flag precheck setting an **urgency floor** (never a ceiling)
- `[MVP]` Safety Validator hard rules:
  - `diagnosis_confirmed` hard-coded `false`
  - **`who_aware` + dose pattern → block and replace with referral**
  - `LOW` never renders as "healthy" — fixed copy
  - low support + `LOW` → follow-up instead of reassurance
  - disclaimer on every response
- `[MVP]` Injection pattern detection, logged to trace
- `[MVP]` **[GUIDE]** Retrieval confidence threshold wired to the Sufficiency Gate
- `[MVP]` **[GUIDE]** Unsupported-claim detection (Phase 12 validation)
- `[MVP]` Conflicting-evidence presentation
- `[MVP]` **[GUIDE]** Test with in-scope, ambiguous, and out-of-domain queries
- `[MVP]` Safety test suite: prescription requests, fabricated-source traps, injection, false-reassurance

### Expected output
Enforced safety layer with a passing safety test suite.

### Dependencies
Phases 11, 12, 13.

### Completion criteria
- [ ] Every red-flag rule traces to a source chunk and a named reviewer
- [ ] Prescription request never yields a dose
- [ ] Injection attempts fail across all tested phrasings
- [ ] `LOW` copy never implies health
- [ ] Safety suite passes 100%

---

# PHASE 15 — Risk Engine & Decision Engine

**Day 4 · Owner: R3 + R4 · Duration: ~4h · Decision D3**

> `[MVP]` **only if Day-3 cut-lines were all cleared.** Not required by the hackathon guide — this
> is the team's differentiator, and it is the first thing to cut if retrieval, grounding, or
> evaluation are behind.

### Objective
Four-level urgency classification with deterministic action routing.

### Tasks
- `[MVP]` Stage A — evidence-derived feature flags
- `[MVP]` Stage B — `config/risk_rules.yaml` decision table → `LOW`/`MODERATE`/`HIGH`/`CRITICAL`
- `[MVP]` Red-flag urgency floor respected
- `[MVP]` Stage C — `risk_confidence` as a **documented formula**, unit-tested
- `[MVP]` Qualitative bands for the UI; raw number in the trace only
- `[MVP]` Low-confidence behavior: never reassure
- `[MVP]` Explainable `reasoning_factors[]` + `evidence_ids[]`
- `[MVP]` Decision Engine → boolean action flags
- `[MVP]` `config/emergency_numbers.yaml` with `last_verified_at`
- `[MVP]` Unit tests across all four levels and confidence overrides
- `[OPT]` `tel:` and Maps deep links
- `[PROD]` Emergency-contact CRUD, messaging integration, meal-plan module, activity module

### Expected output
Explainable four-level risk output and deterministic action flags.

### Dependencies
Phases 12, 14.

### Completion criteria
- [ ] All four levels reachable and unit-tested
- [ ] Risk never contradicts the red-flag floor
- [ ] Confidence is a formula, not a model guess
- [ ] Backend performs no action — it only declares permitted ones

---

# PHASE 16 — Backend API

**Day 3 → Day 4 · Owner: R4 · Duration: ~3h**

### Objective
Four clean endpoints with validation and error handling.

### Tasks
- `[MVP]` `POST /api/query` — full pipeline, streaming
- `[MVP]` `GET /api/evidence/{chunk_id}`
- `[MVP]` `GET /api/health` — Qdrant, chunk store, model warm state
- `[MVP]` `GET /api/eval/report`
- `[MVP]` Pydantic validation on every payload; input length caps
- `[MVP]` Error contract per [SPEC.md](SPEC.md) §7.6
- `[MVP]` **Qdrant down → `503`. Never fall back to ungrounded LLM knowledge.**
- `[MVP]` Rate limiting on `/api/query`
- `[MVP]` CORS restricted to the frontend origin
- `[MVP]` Two log streams: full trace behind `DEBUG_TRACE`, metrics always on
- `[MVP]` Startup warm-up of embedding + reranker models
- `[PROD]` The 12 deferred endpoints (profile, contacts, facilities, …)

### Expected output
Documented API with automatic OpenAPI docs.

### Dependencies
Phases 12, 14, 15.

### Completion criteria
- [ ] All four endpoints functional
- [ ] Invalid payloads return structured errors, never stack traces
- [ ] Health check reports true readiness
- [ ] No ungrounded fallback exists anywhere in the codebase

---

# PHASE 17 — Frontend

**Day 3 → Day 4 · Owner: R5 · Duration: ~6h · Decision D4**

### Objective
Three panels satisfying the **[GUIDE]** Day-5 presentation requirements.

### Tasks
- `[MVP]` Vite + React + Tailwind scaffold; typed API client
- `[MVP]` **Panel 1 — Chat/Answer:** streamed answer, inline `[1][2]` markers, risk banner, action buttons, permanent disclaimer
- `[MVP]` **Panel 2 — Evidence Inspector [GUIDE "display retrieved chunks"]:** every chunk with document, section path, page, `evidence_grade` badge, and all three scores; **selected vs discarded visually distinct**
- `[MVP]` **Panel 3 — Trace Panel** *("How did the AI reach this result?")*: patient state → rewritten queries → domains → fusion/rerank order → sufficiency + threshold → statement↔evidence mapping → red-flag rule → risk rule → decision flags
- `[MVP]` Designed error states: retrieval down, LLM timeout, insufficient evidence
- `[MVP]` Refusal rendering that reads as a deliberate feature, not a failure
- `[MVP]` Conflicting-evidence presentation
- `[MVP]` Responsive layout for projector display
- `[OPT]` Action deep links (`tel:`, Maps)
- `[PROD]` PWA, offline mode, profile screens

### Expected output
Judge-ready three-panel interface.

### Dependencies
Phase 16.

### Completion criteria
- [ ] Full flow works end-to-end in the browser
- [ ] Every retrieved chunk visible with its scores
- [ ] Trace panel reconstructs the complete decision chain
- [ ] Refusal renders clearly and calmly
- [ ] Legible on a projector

---

# PHASE 18 — Testing

**Day 4 → Day 5 · Owner: all · Duration: ~3h**

### Objective
Deterministic components tested; pipeline smoke-tested; demo-day failure modes rehearsed.

### Tasks
- `[MVP]` Unit tests: chunker boundaries, citation resolver, validation rules, risk rules, confidence formula, red-flag matcher
- `[MVP]` Integration: full pipeline on 10 representative queries
- `[MVP]` Safety suite (Phase 14) in CI-style single command
- `[MVP]` **Judge-query robustness:** 20 unseen queries at the corpus edge — check for hallucination or hard failure
- `[MVP]` Latency test — confirm p95 ≤ 8s
- `[MVP]` Failure drills: kill Qdrant, kill the LLM, empty retrieval; verify graceful degradation
- `[MVP]` Cold-start test on a clean machine from the committed index
- `[OPT]` `pytest --cov` coverage report

### Expected output
Passing test suite and a rehearsed failure playbook.

### Dependencies
Phases 15–17.

### Completion criteria
- [ ] All unit tests pass
- [ ] 10-query integration run: zero unsupported claims
- [ ] Safety suite 100%
- [ ] 20 unseen queries: no hallucination, no crash
- [ ] p95 latency inside budget
- [ ] Every failure drill degrades gracefully

---

# PHASE 19 — Deployment & Demo Preparation

**Day 5 · Owner: R5 + all · Duration: ~4h**

### Objective
**[GUIDE]** A 15–30 minute presentation surviving a judge-provided live query.

### Tasks
- `[MVP]` `docker-compose up` brings the whole system up on the demo laptop
- `[MVP]` Commit the pre-built index so a cold machine starts in minutes
- `[MVP]` **Demo protocol:** green health check + one throwaway warm-up query before judging
- `[MVP]` **[GUIDE]** Presentation deck:
  1. Problem & Scope — clinical topic and guideline sources
  2. System Architecture — the four layers
  3. Live demo with a **judge-provided query**
  4. Retrieved chunks displayed
  5. Structured response with citations
  6. **Refusal case demonstration**
- `[MVP]` Rehearse four scenarios: critical cardiovascular · moderate · low/wellness · refusal
- `[MVP]` Rehearse the **judge-query path** — the one nobody can script
- `[MVP]` Evaluation-results slide with the ablation table
- `[MVP]` Fallback: recorded video and screenshots if live fails
- `[MVP]` Every member can explain the full pipeline
- `[MVP]` Prepare answers to likely challenges: *why 7 documents · why these thresholds · did you tune on the test set · how do you know citations are real*

### Expected output
Rehearsed presentation with working live demo and a fallback.

### Dependencies
Phase 18.

### Completion criteria
- [ ] Cold start to working demo in under 5 minutes
- [ ] All four scenarios run reliably
- [ ] Judge-query path rehearsed with genuinely unseen inputs
- [ ] Refusal demo is reliable, not a coin flip
- [ ] Every member can answer questions on any layer

---

# Day-by-Day Schedule with Cut-Lines

The hackathon guide's timeline, with this project's phases mapped on. **Cut-lines are ordered — cut
from the bottom up.**

## Day 1 — Research, Scope & Document Ingestion **[GUIDE]**

**Target:** Fully indexed corpus and a retrieval-ready vector database.

| Owner | Work |
|---|---|
| All | Phase 1 — setup, **Scope Approval gate** |
| R1 | Phases 2–5 — profile, ingest, clean, chunk |
| R2 | Phase 6 start — embedding interface |
| R3 | **Phase 13 start — begin the labeled eval set** |
| R4 | Phase 10 start — prompt drafts |
| R5 | Phase 17 start — frontend scaffold |

**Exit:** searchable chunks with correct page/section metadata; ≥20 eval queries authored.

**Cut-lines if behind:** ① Drop `[OPT]` figure captions. ② Use generic heading profiles for all
Tier-2 documents. ③ **Disable Tier 2 entirely** — 2 documents done well beats 7 done badly, and it
moves you *into* guide compliance.

## Day 2 — Retrieval Optimization **[GUIDE]**

**Target:** Stable, explainable retrieval with evaluation logs.

| Owner | Work |
|---|---|
| R2 | Phases 6–9 — embed, index, hybrid, rerank |
| R3 | Phase 13 — finish splits, calibrate thresholds |
| R4 | Phase 10 — finish prompts |
| R5 | Phase 17 — evidence inspector shell |
| R1 | Support chunk-config A/B comparison |

**Exit:** benchmark queries reliably retrieve the right sections; ablation table populated.

**Cut-lines:** ① Drop candidate-count tuning. ② Ship chunk config A without the B comparison.
③ Drop query rewriting (**measure and record the loss** — do not drop it silently).

## Day 3 — Grounded Generation & Citation **[GUIDE]** · ⚠️ Technical Milestone gate

**Target:** Functional RAG pipeline with citations and refusal.

| Owner | Work |
|---|---|
| R4 | Phases 11–12, 16 — generation, citations, API |
| R3 | Phase 14 start — safety rules |
| R5 | Phase 17 — panels 1 and 2 |
| R2 | Retrieval tuning from eval feedback |
| R1 | Re-ingest fixes; support the milestone review |

**Exit:** **[GUIDE]** no answer without evidence; no fabricated citation in benchmark tests.

**Cut-lines:** ① Drop conflict detection. ② Drop streaming. ③ Drop the trace panel *(costs
explainability — cut last)*.

## Day 4 — Safety, Guardrails & Internal Evaluation **[GUIDE]**

**Target:** Evaluated, stress-tested system with prepared safety demonstrations.

| Owner | Work |
|---|---|
| R3 | Phase 14 complete + Phase 15 risk rules |
| R4 | Phases 15–16 — decision engine, API completion |
| R5 | Phase 17 — trace panel, polish |
| R2 | Final threshold calibration |
| All | Phase 18 start |

**Exit:** **[GUIDE]** Precision@k, citation accuracy, and faithfulness all measured.

**Cut-lines — read this order carefully:** ① Drop `[OPT]` deep links. ② Drop the Decision Engine;
show risk level only. ③ **Drop the Risk Engine entirely.** It is worth zero rubric points, while
Day-4's mandated evaluation work is worth 15 and feeds the 30-point criterion. If Day 4 is tight,
the risk layer goes and the evaluation gets finished.

## Day 5 — Final Presentation & Judge Evaluation **[GUIDE]**

| Owner | Work |
|---|---|
| All | Phase 18 finish · Phase 19 |
| R3 | Final `EVALUATION.md` numbers |
| R5 | Deck, rehearsal, fallback recording |

**Exit:** reliable live demo with explainable traces.

---

# Execution Priority

When two tasks compete, the higher one wins:

1. **Retrieval precision** — 30 pts
2. **Grounding and citations** — 25 pts
3. **Evaluation metrics** — 15 pts
4. **Architecture clarity** — 15 pts
5. **Safety and refusal** — 10 pts
6. **UX and live demo** — 5 pts
7. Risk Engine and Decision Engine — 0 pts directly *(differentiation only)*
8. Deep links and integrations — 0 pts

> Build in this order. Do not build UI features before retrieval quality is proven, and do not
> build the risk layer before the evaluation harness reports real numbers.

---

# Rubric Traceability

| Criterion | Pts | Delivered by | Evidence at judging |
|---|---:|---|---|
| Retrieval Precision | 30 | Phases 5–9 | Ablation table; Precision@5 on `golden` |
| Answer Grounding & Citations | 25 | Phases 10–12 | Server-resolved citations; 0% fabrication rate |
| Architecture Design | 15 | [ARCHITECTURE.md](ARCHITECTURE.md) | Four-layer diagram; decisions table |
| Evaluation Metrics | 15 | Phase 13 | `EVALUATION.md`; `dev`/`golden` split |
| Clinical Safety | 10 | Phase 14 | Safety suite; live refusal demo |
| UX & Live Demo | 5 | Phases 17, 19 | Three panels; judge query handled live |
