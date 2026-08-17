# Scope Justification — for the Day-1 Mentor Review

**One page. For the Scope Approval gate.**

## What we're asking approval for

A 7-document corpus, against the guide's stated 1–2 documents.

## Why

The product goal is triage across nine clinical domains (emergency, cardiovascular, stroke,
respiratory, GI, infectious disease, and CVD prevention/wellness). A single guideline cannot
plausibly cover that surface — WHO and USPSTF guidelines are each scoped to one clinical area by
design. Seven documents is the minimum needed for the intended demo to touch more than one domain.

## Why this doesn't compromise the RAG quality the rubric scores

We are not treating this as "7 documents, uniform effort." The corpus is **tiered**
(`config/corpus.yaml`):

- **Tier 1** — `who_acs_stroke` + `who_bec` — gets full section-aware parsing, hand-tuned heading
  profiles, and full evaluation coverage. **Tier 1 alone satisfies every acceptance criterion in
  SPEC.md.** The critical-cardiovascular and refusal demo scenarios are drawn from Tier 1.
- **Tier 2** — the remaining five — same generic ingestion pipeline, lighter evaluation depth.

If reviewers judge 7 documents too broad for a 5-day build, disabling Tier 2 is a one-line
configuration change (`enabled: false` per document), not a re-architecture. We can demonstrate
this live if useful.

## Licensing

All seven documents are WHO (CC BY-NC-SA 3.0 IGO) or USPSTF (U.S. public domain) — both families
permit non-commercial educational use. No document is redistributed; only derived, cited chunks are
indexed. Full attestation: [knowledge-base.md](knowledge-base.md).

## What we'd like from mentors

Approval to proceed with all 7 documents (preferred), or a decision to restrict to Tier 1 only — in
which case we proceed immediately with no schedule impact, since Tier 1 is already the fallback
plan and the acceptance bar for it is identical.
