# Corpus Profile — Phase 2

Per-document parsing profile, built by direct inspection of font sizes, layout coordinates, and
table structure with PyMuPDF and pdfplumber against the real PDFs in `data/raw/`. This informs the
Phase 3 ingestion and Phase 4 cleaning implementations — every hazard below was observed directly,
not assumed.

**Table counts below are "real tables"** — `pdfplumber.find_tables()` output filtered to ≥2 rows
and ≥2 columns. The raw detector also fires on running headers/footers and cover-page layout blocks
(see `who_dcm` note); those are false positives, not table content, and are excluded from these
counts and handled by the boilerplate filter in Phase 4 instead.

---

## Tier 1

### `who_acs_stroke` — WHO Framework for the Care of Acute Coronary Syndrome and Stroke

| Property | Value |
|---|---|
| Pages | 62 |
| Text layer | Confirmed present |
| Heading structure | **Two clean size tiers**: 24pt = chapter title (`"N \t" + name`), 14pt = subsection heading. Body text is 11pt. |
| Header/footer | No top header. Footer at y≈808/842 carries page number + running section title on ~23 pages — strip in Phase 4. |
| Column layout | Single column throughout. |
| Table density | 20 pages with real tables (32.3% of body pages), 26 tables total. Denser than expected — not flagged in the original architecture assumption, now corrected. |
| Hazards | None structural. Clean, well-formed WHO framework document — the easiest of the seven to parse. |
| Heading profile | **Hand-tuned** — `config/heading_profiles/who_acs_stroke.yaml` |

### `who_bec` — WHO/ICRC Basic Emergency Care

| Property | Value |
|---|---|
| Pages | 240 |
| Text layer | Confirmed present |
| Heading structure | **Two-tier module structure**: 25pt = module title (`"Module N: <name>"`), 18pt = section heading within a module (`OBJECTIVES`, `KEY TERMS`, `OVERVIEW`, `SAFETY CONSIDERATIONS` — repeated fixed labels across modules, useful as anchors). Body text 10–11pt. |
| Header/footer | Running top header on 108/240 pages: `"PARTICIPANT WORKBOOK"` plus a second running header with the current module name (up to 28 pages per module) — **must strip both** in Phase 4. Page numbers in footer. |
| Column layout | Single column. Indented bullet lists (x≈99 vs body x≈85) can look like a second column to naive x-position heuristics — false signal, not a real hazard. |
| Table density | 37 pages with real tables (15.4%), 42 tables. |
| Hazards | **Worksheet artifacts**: pages contain dotted-line "Notes" fill-in areas (`size=20.5`, repeated `....` runs) meant for trainee handwriting — must be filtered as boilerplate, not embedded as content. **Checkbox glyphs**: `\x83\x83` control-character sequences from a Wingdings-style checkbox font appear inline in body text (e.g. before "L: LAST ORAL INTAKE") — needs explicit stripping in the unicode-repair step, will not resolve via normal ligature fixes. |
| Heading profile | **Hand-tuned** — `config/heading_profiles/who_bec.yaml` |

---

## Tier 2

### `who_sari` — WHO Clinical Care of Severe Acute Respiratory Infections Toolkit

| Property | Value |
|---|---|
| Pages | 306 |
| Text layer | Confirmed present |
| Heading structure | **No large-font heading tier** — body text tops out around 11pt with no distinct size jump for headings. Headings likely rely on bold weight at body size rather than size delta. **Generic heading profile is expected to underperform here**; flagged as a known Tier-2 weak point rather than assumed to work. |
| Column layout | Mostly single column; some later pages show layout variation consistent with COVID-19-update inserts (document is a "2022 update" per its title metadata). |
| Table density | 103 pages with real tables (33.7%), 154 tables — second-most table-dense document after `who_aware`. |
| Hazards | Weak heading signal (above) is the primary risk. Update/insert pages may carry different formatting than the base toolkit. |
| Heading profile | Generic — `config/heading_profiles/generic.yaml`. Section detection will likely fall back to `section_confidence: "inherited"` more often than other documents; acceptable for Tier 2. |

### `who_dcm` — WHO District Clinician Manual / Hospital Care (IMAI, Volume 2)

| Property | Value |
|---|---|
| Pages | 396 |
| Text layer | Confirmed present |
| Heading structure | Not yet hand-profiled (Tier 2 — generic profile by design). |
| Column layout | Mixed — mostly single column in clinical sections; front matter (first ~55 pages) includes cover/ISBN/multi-column ToC blocks. |
| Table density | 95 pages with real tables (24.0%), 111 tables. Front matter alone triggers 370 raw `find_tables()` hits (93.4% of pages) — almost entirely **false positives**: ISBN blocks, single-cell footer/running-title fragments (e.g. `['', 'Weight loss and malnutrition 10.2 − 47', '']`), and a multi-column table-of-contents misread as tabular. Confirmed genuine tables exist from page ~61 onward, including real clinical dosing tables (e.g. a nutritional-therapy table with age-banded kcal/kg and ml/kg values). |
| Hazards | **The false-positive table rate is the most important finding in this profile.** A naive `find_tables()` call without a ≥2×2 size filter will pollute the corpus with running-header junk misclassified as `chunk_type: table`. The Phase 4/5 pipeline must apply this filter, not just flag "table-dense" documents by raw detector output. |
| Heading profile | Generic — `config/heading_profiles/generic.yaml` |

### `who_aware` — The WHO AWaRe (Access, Watch, Reserve) Antibiotic Book

| Property | Value |
|---|---|
| Pages | 697 |
| Text layer | Confirmed present |
| Heading structure | Not yet hand-profiled (Tier 2 — generic profile by design). |
| Column layout | Narrower page geometry (width≈420pt vs the standard ≈595pt A4 used elsewhere) with layout variation across sampled pages — some single-column, some with side annotations at larger x-offsets. |
| Table density | 229 pages with real tables (32.9%), 292 tables — most table-dense document in the corpus by page percentage, consistent with the original architecture assumption. Carries dosing and antibiotic-selection tables directly relevant to the SAF-7.x prescribing restriction. |
| Hazards | **Prescribing-restricted** (`config/corpus.yaml: prescribing_restricted: true`) — enforced downstream in the Safety Validator, not by ingestion. Table extraction quality matters more here than in any other document, since a corrupted dose table is the highest-severity possible parsing failure in this corpus (Risk #9 in PROJECT-STATE.md). |
| Heading profile | Generic — `config/heading_profiles/generic.yaml` |

### `uspstf_cvd_risk` — USPSTF Healthy Diet & Physical Activity, WITH CVD Risk Factors

| Property | Value |
|---|---|
| Pages | 7 |
| Text layer | Confirmed present |
| Heading structure | Short document; JAMA-style clinical review format. |
| Column layout | **Genuine two-column academic layout**, confirmed by direct coordinate inspection: a "Clinician Summary" figure with a label column (x≈80) and answer column (x≈160), plus the main article body in two page-columns (x≈72 and x≈293). PyMuPDF's default block order does **not** reliably preserve reading order across these columns — Phase 3 extraction needs explicit column-aware ordering (sort blocks by x-band, then y) for both USPSTF documents specifically. |
| Table density | 3 pages with real tables (42.9%), 6 tables — dense for its length. |
| Hazards | Column reading order (above) is the only real hazard; document is otherwise clean. |
| **Evidence grade** | **Confirmed machine-extractable.** Direct text search found `"Grade: B"` inline in the clinician-summary figure. Regex `Grade:\s*[A-DI]\b` is sufficient — resolves open question Q7 in PROJECT-STATE.md. |
| Heading profile | Generic — `config/heading_profiles/generic.yaml` |

### `uspstf_no_cvd_risk` — USPSTF Healthy Diet & Physical Activity, WITHOUT Known CVD Risk Factors

| Property | Value |
|---|---|
| Pages | 8 |
| Text layer | Confirmed present |
| Heading structure | Same JAMA-style format as the paired `uspstf_cvd_risk` document. |
| Column layout | Same two-column hazard as `uspstf_cvd_risk` — same fix applies. |
| Table density | 2 pages with real tables (25.0%), 4 tables. |
| Hazards | Same as `uspstf_cvd_risk`. |
| **Evidence grade** | **Confirmed machine-extractable** — `"Grade: C"` found inline, same pattern as the paired document. |
| Heading profile | Generic — `config/heading_profiles/generic.yaml` |

---

## Cross-Document Findings for Phase 3/4/5

1. **Table density was systematically underestimated in the architecture doc.** All seven
   documents carry meaningful real table content (15–33% of pages), not just the two originally
   flagged (`who_aware`, `who_sari`). The table-extraction path (RAG-2.4: never split a table
   across chunks) applies corpus-wide, not to a subset.

2. **Raw `find_tables()` output is not usable directly** — it must be filtered to ≥2 rows × ≥2
   columns before being trusted, or running headers/footers and ToC layout get misclassified as
   `chunk_type: table`. This filter must be implemented in Phase 3/4, not assumed to come for free
   from pdfplumber.

3. **USPSTF evidence grades are confirmed extractable** by a simple regex on both documents —
   de-risks RAG-2.x and closes open question Q7.

4. **Two distinct heading-detection regimes exist**: `who_acs_stroke` and `who_bec` have clean,
   size-based heading tiers and get hand-tuned profiles as planned. `who_sari` shows no size-based
   heading signal at all — its generic-profile section detection should be expected to lean more
   heavily on the `section_confidence: "inherited"` fallback than other Tier-2 documents. This is
   an acceptable, now-documented weak point rather than a surprise discovered mid-Phase-4.

5. **Two real cleaning hazards, both in `who_bec`**: dotted-line worksheet fill-in areas (strip as
   boilerplate) and inline Wingdings-style checkbox glyphs (strip in the unicode-repair step, not
   fixable by standard ligature handling).

6. **Column-aware reading order is required for both USPSTF documents.** This is the one document
   pair where default block order will scramble text across the two-column layout if not handled
   explicitly.

---

## Heading Profiles

| Document | Profile | Basis |
|---|---|---|
| `who_acs_stroke` | `config/heading_profiles/who_acs_stroke.yaml` | Hand-tuned from confirmed 24pt/14pt size tiers |
| `who_bec` | `config/heading_profiles/who_bec.yaml` | Hand-tuned from confirmed 25pt/18pt size tiers |
| `who_sari`, `who_dcm`, `who_aware`, `uspstf_cvd_risk`, `uspstf_no_cvd_risk` | `config/heading_profiles/generic.yaml` | Tier 2 — generic by design per ARCHITECTURE.md §6.3 |

## Completion Against Phase 2 Criteria

- [x] Every document profiled; no document lacks a text layer (all 7 confirmed)
- [x] Table-dense documents identified — **corrected**: table content is corpus-wide, `who_aware`
      and `who_sari` remain the two most dense by real-table percentage
- [x] Tier-1 heading profiles drafted (`who_acs_stroke.yaml`, `who_bec.yaml`)
