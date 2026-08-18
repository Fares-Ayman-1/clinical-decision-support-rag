# TODO-PRODUCTION.md

Work deliberately **excluded from the hackathon MVP** and required before any serious production
deployment.

**Companions:** [ARCHITECTURE.md](ARCHITECTURE.md) · [PLAN.md](PLAN.md) · [SPEC.md](SPEC.md) · [PROJECT-STATE.md](PROJECT-STATE.md)

> **Priorities**
> **P0** — a blocker for any real deployment; safety, legal, or data-integrity critical
> **P1** — required before serving real users at any scale
> **P2** — required as usage grows
> **P3** — valuable, not urgent

---

## ⚠️ Read This First

Three items below are **absolute gates**. Nothing else on this list matters until they are resolved,
and no amount of engineering quality substitutes for them.

- [ ] **Complete a Software-as-a-Medical-Device (SaMD) regulatory assessment** — **P0**
  **Reason:** A patient-facing system that assesses symptoms and assigns urgency is very likely a
  regulated medical device in most jurisdictions (FDA, EU MDR, MHRA). Deploying without this
  determination is a legal and patient-safety failure, not a technical debt item.
  **Dependencies:** Regulatory counsel; a defined intended-use statement.

- [ ] **Obtain clinical validation and sign-off from licensed clinicians** — **P0**
  **Reason:** Every red-flag rule, risk rule, and refusal threshold in the MVP was authored by
  engineers reading guidelines. That is adequate for a demonstrator and inadequate for patients.
  **Dependencies:** Clinical advisory panel; documented review of `redflags.yaml` and `risk_rules.yaml`.

- [ ] **Establish a PHI handling and compliance posture (HIPAA / GDPR as applicable)** — **P0**
  **Reason:** The MVP runs on synthetic data only. The moment a real person types a real symptom,
  the system processes health data and every requirement in the Privacy section below becomes
  mandatory rather than aspirational.
  **Dependencies:** Legal review; a data processing agreement; a defined data residency decision.

---

## RAG Quality

- [ ] **Recalibrate the sufficiency thresholds for bge-reranker-v2-m3 — THE GATE CURRENTLY FAILS OPEN** — **P0**
  **Reason:** The default reranker changed to `BAAI/bge-reranker-v2-m3`, whose outputs are
  sigmoid-normalised to roughly 0..1. `TAU_HIGH_RERANK` / `TAU_LOW_RERANK` still hold ms-marco's
  fitted values (+0.7285 / -3.9325), which were raw logits on a roughly -10..+10 scale.
  **Impact — safety-relevant, and in the dangerous direction.** Every bge score clears
  `tau_low = -3.9325`, so nothing is ever classified INSUFFICIENT. Measured in the built image
  for "What diet helps with high blood pressure?":

      relevant passage   +0.8687
      related passage    +0.1373
      irrelevant passage +0.0000   (a femur-fracture passage)

  The irrelevant passage lands in PARTIAL, so the system generates an answer where it should
  refuse. SAF-4's evidence-sufficiency gate is the control that stops ungrounded clinical
  answers; on this scale it is inert.
  **Interim mitigation:** set `SUFFICIENCY_TAU_LOW_RERANK` / `SUFFICIENCY_TAU_HIGH_RERANK` to
  values on the 0..1 scale on any deployment running bge. This needs no rebuild.
  **Fix:** `python scripts/fit_thresholds.py --write` against the labeled splits with bge active,
  then update the defaults.

- [ ] **Finish the chunking-strategy benchmark (S2, S4, S5, S7)** — **P1**
  **Reason:** Only config S1 was successfully indexed and evaluated (PROJECT-STATE.md §5, §8 R13) —
  sustained CPU-bound embedding proved unreliable in the dev sandbox across 5 reproduction attempts,
  even on the smallest reduced config. Every piece of the harness (`scripts/build_index.py`,
  `scripts/evaluate.py`, `scripts/compare_chunking.py`, `scripts/analyze_chunk_failures.py`) is
  built and proven correct on S1 — this is a completion task, not a build task.
  **Dependencies:** A machine/environment where `scripts/build_index.py --config-id S2 S4 S5 S7
  --recreate` can run to completion (retry on a more stable machine, or budget 15–20+ min per
  config in background jobs). Once done, run `scripts/compare_chunking.py --config-id S1 S2 S4 S5
  S7 --split dev` for the real comparison table, then `--split golden --final` for the reported
  numbers, and update the recommended default chunking config in ARCHITECTURE.md §6.4 and
  `config/chunking.yaml` from measured results, not the current S1-only placeholder.
- [ ] **Pin a second embedding candidate and re-run the Day-2 benchmark** — **P1**
  **Reason:** ARCHITECTURE.md §7.3 calls for benchmarking two candidates (E5/BGE/GTE family) before
  choosing a default. Only `sentence-transformers/all-MiniLM-L6-v2` was reachable in the dev sandbox
  (no network route to the HF Hub — PROJECT-STATE.md §8 R12). `config/embedding.yaml` already has a
  documented, commented-out second slot.
  **Dependencies:** Network access to download a candidate (e.g. `BAAI/bge-small-en-v1.5`, 512
  `max_seq_length` vs MiniLM's 256). Re-chunk and re-run the finished chunking-strategy benchmark
  above under the new model too, since chunk-size decisions are calibrated to a specific model's
  token ceiling (found the hard way this session — see R10/R12 in PROJECT-STATE.md).
- [ ] Add semantic chunking (embedding-similarity boundary detection) as an 8th chunking strategy — P3
  **Reason:** Requested but deliberately deferred rather than built during the chunking-strategy
  benchmark (PROJECT-STATE.md §5) — it needs embedding every sentence to find boundaries (~10× the
  embed cost of the other strategies) plus a threshold to tune, against a 256-token model ceiling
  that already dominates retrieval behavior more than chunk-boundary placement does. Revisit once a
  larger-context embedding model is pinned (see above) and the sizing questions are settled.
- [ ] **Expand the corpus beyond the frozen seven documents** — **P1**
  **Reason:** Nine clinical domains cannot be responsibly covered by seven documents. Coverage gaps
  currently surface as refusals, which is safe but limits usefulness.
  **Dependencies:** KB update workflow below.
- [ ] **Add OCR for scanned documents** — P2
  **Reason:** The MVP fails loudly on image-only PDFs. Many national and regional guidelines are scanned.
- [ ] Implement multi-hop retrieval for questions spanning several guideline sections — P2
- [ ] Add HyDE or generated-answer-embedding retrieval and measure it against the current pipeline — P3
- [ ] Fine-tune the reranker on domain-labeled clinical query/passage pairs — P3
  **Dependencies:** ≥5,000 labeled pairs.
- [ ] Fine-tune or select a medical-domain embedding model — P3
- [ ] Add cross-document consistency checks that flag contradictions at ingestion rather than query time — P2
- [ ] Implement contextual/parent-document retrieval — return the surrounding section for context while citing the precise chunk — P2
- [ ] Add table-aware retrieval that can answer against structured cell values — P2
- [ ] Support multilingual queries and corpora — P3

## Evaluation

- [ ] **Expand the evaluation set to ≥500 labeled queries** — **P1**
  **Reason:** 50–70 queries is enough to choose between two configurations; it is not enough to
  detect a regression or to make a defensible claim about production quality.
- [ ] **Add clinician-authored and clinician-reviewed ground truth** — **P1**
  **Reason:** Engineer-authored labels encode engineer assumptions about what the right answer is.
  **Dependencies:** Clinical advisory panel.
- [ ] **Gate deployments on evaluation results in CI** — **P1**
  **Reason:** Without a gate, a prompt tweak can silently degrade retrieval quality between releases.
  **Dependencies:** CI/CD pipeline.
- [ ] Integrate RAGAS or a comparable framework alongside the custom metrics — P2
  **Reason:** The MVP deliberately uses six hand-rolled metrics for explainability under judging. Production benefits from a standardized second opinion.
- [ ] Replace single-model LLM-as-judge with a multi-model panel — P2
  **Reason:** Judging generations with the same model family that produced them is a known bias, disclosed but not fixed in the MVP.
- [ ] Add human evaluation with inter-rater agreement measurement — P2
- [ ] Build regression suites per document, so a KB update cannot silently break existing retrieval — **P1**
- [ ] Add adversarial and red-team evaluation sets — P1
- [ ] Track evaluation metrics over time with a dashboard — P2
- [ ] Add confidence calibration measurement (reliability diagrams, ECE) — P2

## Medical Safety

- [ ] **Establish a clinician review loop for red-flag and risk rules** — **P0** *(see gates above)*
- [ ] **Validate the Risk Engine against real triage outcomes** — **P0**
  **Reason:** The MVP's rule table has never been measured against ground truth. Critical-case recall
  is currently unknown, and under-triage is the most dangerous failure this system can produce.
  **Dependencies:** A labeled clinical triage dataset with outcome data; IRB review if using patient records.
- [ ] Add pediatric, geriatric, and pregnancy-specific safety pathways — **P1**
  **Reason:** The MVP applies adult guidance uniformly. Dose thresholds, red flags, and normal ranges all differ.
- [ ] Add drug-interaction and contraindication checking — P1
  **Dependencies:** A licensed drug database.
- [ ] Implement clinician escalation and human-in-the-loop review for `HIGH`/`CRITICAL` cases — P1
- [ ] Add an adverse-event reporting mechanism — **P1**
- [ ] Build a safety incident review process with root-cause analysis — P1
- [ ] Add jurisdiction-specific medical disclaimers — P1
- [ ] Implement age verification and minor-consent handling — P1
- [ ] Add self-harm and mental-health crisis detection with appropriate routing — **P1**
  **Reason:** Entirely absent from the MVP corpus and rules. A user in crisis currently receives a scope refusal.

## Security

- [ ] **Implement authentication and session management** — **P0**
- [ ] **Implement RBAC (patient / clinician / admin)** — **P1**
  **Dependencies:** Authentication.
- [ ] Add per-user and per-IP rate limiting with abuse detection — P1
- [ ] Complete a full prompt-injection red-team exercise — P1
- [ ] Add API key rotation and a secrets manager (Vault, AWS Secrets Manager) — P1
- [ ] Run dependency vulnerability scanning in CI (Dependabot, Snyk) — P1
- [ ] Add SAST and DAST to the pipeline — P2
- [ ] Commission a third-party penetration test — P2
- [ ] Implement a Content Security Policy and security headers — P2
- [ ] Add request signing for service-to-service calls — P3
- [ ] Add DDoS protection at the edge — P2

## Privacy

- [ ] **Encrypt health data at rest and in transit** — **P0**
- [ ] **Define and enforce a data retention and deletion policy** — **P0**
- [ ] **Implement right-to-erasure (GDPR Art. 17)** — **P0**
- [ ] Add explicit, revocable consent capture before any health data is stored — **P0**
- [ ] Implement PII/PHI detection and redaction in all logs — **P1**
  **Reason:** The MVP resolves this by logging nothing sensitive and using synthetic data. Real usage requires active redaction.
- [ ] Separate identity from telemetry with pseudonymous identifiers — P1
- [ ] Add data export for portability requests — P1
- [ ] Document data residency and cross-border transfer decisions — P1
- [ ] Add a privacy policy and terms of service — **P0**
- [ ] Implement audit logging of every access to health data — **P1**

## Authentication & Authorization

- [ ] Implement OAuth2 / OIDC with a managed identity provider — P1
- [ ] Add multi-factor authentication for clinician accounts — P1
- [ ] Implement session timeout and forced re-authentication for sensitive actions — P1
- [ ] Add account recovery that cannot be socially engineered — P1
- [ ] Implement organization/tenant isolation — P2
- [ ] Add service accounts and scoped API keys for integrations — P2

## Data Governance

- [ ] **Build the knowledge-base update workflow** — **P1**
  **Reason:** Guidelines are revised. Silently replacing one changes clinical behavior with no record of what changed or why.
  **Flow:** new guideline → source validation → license check → versioning → parsing → chunk QA → retrieval regression test → clinician approval → staged index deployment.
  **Dependencies:** Regression suites; clinician review loop.
- [ ] Never silently replace a guideline — require an explicit version bump and changelog — **P1**
- [ ] Add document provenance tracking and license compliance monitoring — P1
- [ ] Implement guideline expiry warnings when a source exceeds its review date — P1
- [ ] Add a data catalog documenting every field's origin and meaning — P2
- [ ] Define data classification tiers (public / internal / PHI) — P1
- [ ] Add lineage tracking from answer → chunk → document → version — P2

## Performance

- [ ] Move reranking to GPU or a hosted inference endpoint — P1
  **Reason:** CPU cross-encoding is the largest single latency component (~2s of an 8s budget).
- [ ] Add batch and async processing for concurrent requests — P1
- [ ] Optimize the embedding pipeline with ONNX or quantization — P2
- [ ] Add connection pooling for the vector store — P1
- [ ] Implement request prioritization so `CRITICAL` red-flag paths bypass queues — **P1**
  **Reason:** A queued emergency response is a safety issue, not a performance one.
- [ ] Profile and optimize prompt token usage — P2
- [ ] Add CDN for frontend assets — P3

## Scalability

- [ ] Horizontally scale the API behind a load balancer — P1
- [ ] Move to managed Qdrant Cloud or a clustered deployment — P1
- [ ] Split ingestion into a separate worker service — P2
- [ ] Add a job queue for long-running ingestion (Celery, RQ) — P2
- [ ] Implement graceful shutdown and rolling restarts — P1
- [ ] Add autoscaling policies driven by queue depth — P2
- [ ] Load-test to establish real concurrency limits — **P1**

## Caching

- [ ] Cache embeddings for repeated queries — P2
- [ ] Cache query rewrites (partially done in MVP; make it durable) — P2
- [ ] Add semantic caching for near-identical questions — P2
  **Caution:** Never cache across users in a way that could leak one person's context into another's answer.
- [ ] Cache reranker scores per (query_hash, chunk_id) — P3
- [ ] Add HTTP caching headers for static evidence endpoints — P3
- [ ] Implement cache invalidation tied to `kb_version` — **P1**
  **Reason:** A stale cache serving pre-update guideline content is a clinical correctness bug.

## Observability

- [ ] **Add distributed tracing (OpenTelemetry)** — **P1**
- [ ] **Add error aggregation (Sentry) with PII scrubbing** — **P1**
  **Dependencies:** PII redaction.
- [ ] Add metrics collection and dashboards (Prometheus + Grafana) — P1
- [ ] Track LLM token usage and cost per request — P1
- [ ] Add a real-time quality dashboard: refusal rate, unsupported-claim rate, latency percentiles — P1
- [ ] Alert on quality regressions, not just outages — **P1**
  **Reason:** This system fails quietly. A retrieval regression produces confident, wrong-sourced answers with a perfectly healthy uptime graph.
- [ ] Add synthetic monitoring that runs golden queries against production hourly — P1
- [ ] Implement SLO definitions and error budgets — P2

## Logging

- [ ] Centralize logs (ELK, Loki, or a managed service) — P1
- [ ] Add structured log schemas with enforced field validation — P2
- [ ] Implement log retention aligned to the data retention policy — **P1**
- [ ] Add tamper-evident audit logs for clinical decisions — **P1**
  **Reason:** If the system ever influences care, its decision record must be defensible after the fact.
- [ ] Separate application, audit, and security log streams — P1
- [ ] Add log sampling for high-volume paths — P3

## Monitoring

- [ ] Add uptime monitoring with external probes — P1
- [ ] Monitor vector store health, index size, and query latency — P1
- [ ] Monitor LLM provider availability with automatic failover — **P1**
  **Dependencies:** A second provider configured behind the existing abstraction.
- [ ] Add on-call rotation and an escalation policy — P1
- [ ] Monitor for corpus drift — queries increasingly falling outside coverage — P2
- [ ] Add anomaly detection on refusal-rate spikes — P2

## CI/CD

- [ ] Set up a full CI pipeline: lint, type-check, unit, integration — **P1**
- [ ] **Gate merges on the evaluation suite** — **P1** *(see Evaluation)*
- [ ] Add automated dependency updates with test gating — P2
- [ ] Implement staged deployment: dev → staging → production — P1
- [ ] Add smoke tests that run post-deploy against the live environment — P1
- [ ] Implement automated rollback on health-check failure — **P1**
- [ ] Add database and index migration automation — P1
- [ ] Require code review with a clinical-safety checklist for changes touching rules or prompts — **P1**

## Infrastructure

- [ ] Define infrastructure as code (Terraform / Pulumi) — P1
- [ ] Separate development, staging, and production environments — P1
  **Reason:** Deliberately collapsed to one in the MVP; unacceptable once real data exists.
- [ ] Add container image scanning and a signed image registry — P1
- [ ] Implement network segmentation and private networking for the vector store — P1
- [ ] Add a WAF in front of the API — P2
- [ ] Configure resource limits and quotas per service — P1
- [ ] Document a disaster recovery runbook — **P1**

## Database Improvements

- [ ] **Migrate from SQLite to PostgreSQL** — **P1**
  **Reason:** SQLite was chosen because the MVP stores no durable user data. Auth, profiles, consent records, and audit logs all require concurrent writes and real durability.
  **Dependencies:** Authentication.
- [ ] Add Alembic migrations with reversible scripts — P1
- [ ] Evaluate pgvector to consolidate vector and relational storage — P2
  **Reason:** Two datastores is one more than necessary at moderate scale.
- [ ] Add read replicas for analytics workloads — P2
- [ ] Implement soft deletes with a purge job aligned to retention policy — P1
- [ ] Add database connection pooling (PgBouncer) — P1
- [ ] Index-tune based on real query patterns — P2

## Model Management

- [ ] Build a model registry tracking embedding, reranker, and LLM versions in production — **P1**
- [ ] Implement A/B testing infrastructure for model and prompt changes — P2
- [ ] Add shadow-mode evaluation — run a candidate model on live traffic without serving it — P2
- [ ] Implement prompt versioning with rollback — P1
- [ ] Add model performance monitoring and drift detection — P1
- [ ] Pin and reproducibly build all model artifacts — **P1**
  **Reason:** A silently updated hosted model changes clinical output with no code change and no record.
- [ ] Document a model deprecation and migration process — P2

## Cost Optimization

- [ ] Track per-request LLM cost and set budget alerts — P1
- [ ] Route simple queries to a smaller model — P2
- [ ] Optimize prompt length; measure cost per token saved — P2
- [ ] Evaluate self-hosted inference against API cost at projected volume — P2
- [ ] Add usage quotas per user or tenant — P2
- [ ] Right-size infrastructure based on real load data — P2

## Testing

- [ ] Raise unit coverage to ≥80% on safety-critical paths — **P1**
- [ ] Add property-based testing for the chunker and citation resolver — P2
- [ ] Add contract tests between frontend and API — P2
- [ ] Add load and soak testing — P1
- [ ] Add chaos testing: kill dependencies under load — P2
- [ ] Add end-to-end browser tests (Playwright) — P2
- [ ] Add mutation testing for the safety validator — P3
- [ ] Build a continuous adversarial test suite for prompt injection — **P1**
- [ ] Add accessibility testing (WCAG 2.1 AA) — **P1**
  **Reason:** A patient-facing health tool that excludes users with disabilities fails its own purpose.

## Backup & Disaster Recovery

- [ ] **Automate database backups with tested restores** — **P0**
  **Reason:** An untested backup is not a backup.
- [ ] Back up the vector index and chunk store — P1
- [ ] Define and test RTO and RPO targets — P1
- [ ] Document and rehearse a disaster recovery runbook — P1
- [ ] Implement cross-region replication for critical data — P2
- [ ] Add point-in-time recovery — P2
- [ ] Version and archive every corpus release for reproducibility — **P1**
  **Reason:** Reconstructing why the system said something in the past requires the exact index that said it.

## UX Improvements

- [ ] Add multi-turn conversation with persistent structured patient state — P1
  **Reason:** Deferred from MVP; single-turn is a significant usability limitation.
- [ ] Implement the follow-up question engine end to end — P1
- [ ] Add the wellness module: nutrition and physical activity guidance — P2
  **Reason:** Cut from MVP by decision D3.
- [ ] Add the personalized meal-plan module with strict evidence boundaries — P3
  **Reason:** Cut from MVP. Weakest evidence grounding of any proposed feature; needs careful scoping before it returns.
- [ ] Add emergency contacts management and messaging integration — P2
- [ ] Add nearby facility search with a real maps integration — P2
- [ ] Add user profile persistence — P2
  **Dependencies:** Authentication, PostgreSQL.
- [ ] Add conversation history and the ability to revisit past assessments — P2
- [ ] Add full accessibility support: screen readers, keyboard navigation, contrast — **P1**
- [ ] Add plain-language and reading-level adaptation — P2
- [ ] Add multilingual UI — P2
- [ ] Add a mobile application or PWA — P3
- [ ] Add offline mode for the emergency red-flag path — P3
  **Reason:** The moment a user most needs guidance may be the moment they have no connectivity.

---

## Deferred API Endpoints

Specified in [SPEC.md](SPEC.md) §F.7, excluded from MVP:

- [ ] `POST /api/follow-up` — P1
- [ ] `POST /api/wellness` — P2
- [ ] `POST /api/meal-plan` — P3
- [ ] `GET|PUT /api/profile` — P2 *(depends on auth + PostgreSQL)*
- [ ] `GET|POST|PUT|DELETE /api/emergency-contacts` — P2 *(depends on auth + PostgreSQL)*
- [ ] `GET /api/facilities/nearby` — P2 *(depends on a maps provider)*
- [ ] `GET /api/emergency/number` — P2

---

## Summary by Priority

| Priority | Count | Character |
|---|---:|---|
| **P0** | 11 | Regulatory, clinical validation, PHI, encryption, consent, backups — **absolute gates** |
| **P1** | ~70 | Required before serving real users at any scale |
| **P2** | ~45 | Required as usage grows |
| **P3** | ~15 | Valuable, not urgent |

**The honest summary:** the hackathon MVP is a well-engineered demonstrator on synthetic data. The
distance between it and a system that may safely face a real patient is measured mostly in P0 and P1
items on this list — and the largest of those gaps are clinical and regulatory, not technical.
