# Knowledge Base — License & Provenance Attestation

**Purpose:** the Day-1 **Scope Approval** deliverable required by the hackathon guide —
"Verify public accessibility and legal usability" of every chosen guideline, reviewed by mentors.

**Scope decision D1** (see [ARCHITECTURE.md](../ARCHITECTURE.md) §3, §5.2): this project uses all
**7** documents against the guide's stated 1–2. Mitigation: a tiered corpus — Tier 1
(`who_acs_stroke`, `who_bec`) alone satisfies every acceptance criterion in
[SPEC.md](../SPEC.md); Tier 2 is demotable via `config/corpus.yaml` with no code change if mentors
require strict compliance.

All seven PDFs were verified as text-layer (not scanned) documents with SHA-256 checksums recorded
at [../data/raw/CHECKSUMS.sha256](../data/raw/CHECKSUMS.sha256). No document is redistributed by
this repository — only derived chunks are indexed; source PDFs stay local and git-ignored.

---

## Tier 1 — Primary Corpus

### `who_acs_stroke` — WHO Framework for the Care of Acute Coronary Syndrome and Stroke

| Field | Value |
|---|---|
| Publisher | World Health Organization (WHO) |
| PDF creation date (embedded metadata) | 2025-01-09 |
| Pages | 62 |
| License | CC BY-NC-SA 3.0 IGO (standard WHO IRIS license) |
| Source | WHO Institutional Repository for Information Sharing (IRIS) |
| Source URL | https://iris.who.int/handle/10665/380065 |
| URL provenance | ISBN 978-92-4-010366-5 on the PDF copyright page; IRIS title match; HTTP 200 |
| Access date | 2026-08-17 |
| Usage justification | Non-commercial, educational hackathon use under a share-alike license; document is not modified or redistributed, only chunked and indexed for retrieval with citation back to the original |
| Checksum | `053d8afc4f2991f11331770b5d28e91258043e75c05f4925073b4da788067c54` |

### `who_bec` — WHO/ICRC Basic Emergency Care

| Field | Value |
|---|---|
| Publisher | World Health Organization / International Committee of the Red Cross |
| PDF creation date (embedded metadata) | 2018-10-29 |
| Pages | 240 |
| License | CC BY-NC-SA 3.0 IGO (standard WHO IRIS license) |
| Source | WHO Institutional Repository for Information Sharing (IRIS) |
| Source URL | https://iris.who.int/handle/10665/275635 |
| URL provenance | IRIS exact title match; HTTP 200 |
| Access date | 2026-08-17 |
| Usage justification | Same as above |
| Checksum | `51e5000a8f268d67f28a8206e7b8a35ba7877bec0b45e28084970b074e00043e` |

---

## Tier 2 — Extended Corpus

### `who_sari` — WHO Clinical Care of Severe Acute Respiratory Infections Toolkit

| Field | Value |
|---|---|
| Publisher | World Health Organization |
| PDF creation date (embedded metadata) | 2022-03-30 ("2022 update," per document title) |
| Pages | 306 |
| License | CC BY-NC-SA 3.0 IGO (standard WHO IRIS license) |
| Source | WHO Institutional Repository for Information Sharing (IRIS) |
| Source URL | https://iris.who.int/handle/10665/352851 |
| URL provenance | IRIS record carries report no. 2022.1 matching the PDF's WHO/2019-nCoV/SARI_toolkit/2022.1; HTTP 200 |
| Access date | 2026-08-17 |
| Usage justification | Same as above |
| Checksum | `1181775bd1de374889a71db062048c7f649f0dd322ae04dce6925e92a735adf4` |

### `who_dcm` — WHO District Clinician Manual / Hospital Care (IMAI, Volume 2)

| Field | Value |
|---|---|
| Publisher | World Health Organization (SEARO / IMAI) |
| PDF creation date (embedded metadata) | 2021-11-10 ("January 2021," per document title page) |
| Pages | 396 |
| License | CC BY-NC-SA 3.0 IGO (standard WHO IRIS license) |
| Source | WHO Institutional Repository for Information Sharing (IRIS) |
| Source URL | TBD — 10665/350623 or 10665/350624 |
| URL provenance | both IRIS records hold the 2021 SEARO IMAI manual; neither their metadata nor the PDF's ISBNs identify which is Volume 2 (the volume in this corpus). A guessed link would resolve to the wrong volume, which is worse than an open placeholder. |
| Access date | 2026-08-17 |
| Usage justification | Same as above. Table-dense — table extraction path applies (RAG-2.4) |
| Checksum | `b69df48535ebc2c4a82d4baf6f17029619def7b3d6f830b4380115623a47e250` |

### `who_aware` — The WHO AWaRe (Access, Watch, Reserve) Antibiotic Book

| Field | Value |
|---|---|
| Publisher | World Health Organization |
| PDF creation date (embedded metadata) | 2023-11-30 |
| Pages | 697 |
| License | CC BY-NC-SA 3.0 IGO (standard WHO IRIS license) |
| Source | WHO Institutional Repository for Information Sharing (IRIS) |
| Source URL | https://iris.who.int/handle/10665/365135 |
| URL provenance | handle 10665/365135 printed inside the PDF itself; HTTP 200 |
| Access date | 2026-08-17 |
| Usage justification | Same as above. **Prescribing-restricted** (SAF-7.x) — enforced in the Safety Validator, not just this attestation. Table-dense — table extraction path applies |
| Checksum | `4960ecc4fa5bab8281feda656a0da3176dafa1fd21971d87e3b2092d7dac562f` |

### `uspstf_cvd_risk` — USPSTF Healthy Diet and Physical Activity, WITH CVD Risk Factors

| Field | Value |
|---|---|
| Publisher | U.S. Preventive Services Task Force (published via JAMA / American Medical Association) |
| PDF creation date (embedded metadata) | 2020-11-16 |
| Pages | 7 |
| License | U.S. Government public domain (USPSTF recommendation statements are federally funded work product) |
| Source | USPSTF Recommendation Topics |
| Source URL | https://doi.org/10.1001/jama.2020.21749 |
| URL provenance | DOI printed in the PDF; Crossref confirms title and 2020 |
| Access date | 2026-08-17 |
| Usage justification | Public domain — unrestricted use. Carries explicit A/B/C/D/I evidence grades (RAG-2.x) |
| Checksum | `20194393c719b4992b26cd7b2f16c923417bd4c9d7ef38efaef33b973d8ed6b7` |

### `uspstf_no_cvd_risk` — USPSTF Healthy Diet and Physical Activity, WITHOUT Known CVD Risk Factors

| Field | Value |
|---|---|
| Publisher | U.S. Preventive Services Task Force (published via JAMA / American Medical Association) |
| PDF creation date (embedded metadata) | 2022-07-14 |
| Pages | 8 |
| License | U.S. Government public domain |
| Source | USPSTF Recommendation Topics |
| Source URL | https://doi.org/10.1001/jama.2022.10951 |
| URL provenance | DOI printed in the PDF; Crossref confirms title and 2022 |
| Access date | 2026-08-17 |
| Usage justification | Same as above |
| Checksum | `063a22270a5524a69158f810bca0e96b755b10a5dde1c7dcf4e9b11dda5e91ce` |

---

## Outstanding Before the Day-1 Mentor Review

- [x] Fill in each source URL — 6 of 7 done, each derived from an identifier printed inside the
      PDF and verified to resolve (HTTP 200 / Crossref). `who_dcm` remains open: see its
      URL provenance note above.
- [ ] Confirm `who_dcm` and `who_aware` publication years against their title pages (creation-date
      metadata reflects the PDF file's generation date, not necessarily first publication)
- [ ] One-line verbal justification prepared for mentors on why 7 documents were chosen despite the
      guide's stated 1–2, referencing the Tier 1/2 fallback above

Corpus configuration with tier and enable/disable flags: [../config/corpus.yaml](../config/corpus.yaml).
