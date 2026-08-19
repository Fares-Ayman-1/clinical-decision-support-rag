# Trilingual Evaluation — Qwen3 + mmarco stack (2026-08-20)

End-to-end evaluation of the **deployed** system (https://fatimahemadeldin-clinical-decision-support-rag.hf.space)
on 147 queries: the 49 labeled queries (`dev` 31 · `golden` 10 · `out_of_domain` 8) asked in
**Arabic, English, and French**. Every number below was measured against the live API — nothing is
projected or copied from an older stack.

**Artifacts (all JSON, all committed):**

| File | Contents |
|---|---|
| `data/evaluation/trilingual.jsonl` | The dataset: 147 rows — question per language, ground-truth sections, reference answers written strictly from the labeled sections' own text |
| `data/evaluation/runs/trilingual-qwen3-mmarco/results.jsonl` | One row per query: retrieved chunks, retrieval metrics, sufficiency state + effective taus, refusal fields, full statements/excerpts, latency |
| `data/evaluation/runs/trilingual-qwen3-mmarco/judgments.jsonl` | LLM-judge verdict per successful in-domain answer |
| `data/evaluation/runs/trilingual-qwen3-mmarco/summary.json` | Aggregates: overall · per language · per split |

Reproduce / extend: `python scripts/evaluate_trilingual.py` (resume-friendly — every result is
flushed on write; re-running skips completed rows; `--max-seconds` gives clean time-boxed slices;
`--judge-pass` judges separately; `--aggregate` rebuilds the summary).

## Headline results

A retrieved chunk counts as **relevant** iff its document matches a labeled section AND its page
range overlaps it. Judge scores are 0–1 from gpt-oss:20b with a fixed rubric.

| | n | Hit@5 | P@5 | MRR | nDCG@5 | Section recall | Correct refusal | False refusal | Faithfulness | Relevance | Correct vs ref | Answer in right language |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| **Overall** | 147 | **0.72** | 0.30 | 0.51 | 0.32 | 0.66 | **0.92** | 0.065 | 0.75 | **0.93** | 0.77 | 0.92 |
| English | 49 | 0.73 | 0.31 | 0.51 | 0.33 | 0.67 | 1.00 | 0.122 | 0.65 | 0.91 | 0.76 | 1.00 |
| Arabic | 49 | 0.73 | 0.28 | 0.50 | 0.30 | 0.67 | 0.88 | 0.000 | 0.82 | 0.92 | 0.75 | 0.85 |
| French | 49 | 0.68 | 0.30 | 0.52 | 0.32 | 0.63 | 0.88 | 0.073 | 0.78 | 0.96 | 0.81 | 0.92 |
| dev | 93 | 0.80 | 0.34 | 0.59 | 0.36 | 0.74 | — | 0.054 | 0.76 | 0.93 | 0.80 | 0.93 |
| golden | 30 | 0.47 | 0.18 | 0.24 | 0.17 | 0.42 | — | 0.100 | 0.72 | 0.93 | 0.69 | 0.89 |
| out_of_domain | 24 | — | — | — | — | — | 0.92 | — | — | — | — | — |

Latency on free `cpu-basic` hardware with a shared cloud LLM: mean ≈ 48s, p95 ≈ 76s per query.

## What the numbers say

1. **Language parity is real.** Arabic and French retrieval land within a few points of English
   (Hit@5: 0.73 / 0.68 vs 0.73; MRR essentially equal). This is the direct payoff of the
   multilingual chain — Qwen3's shared vector space, English rewrite fusion, best-of-variants
   reranking, and the cross-lingual sufficiency margin. Before that chain, every Arabic question
   was auto-refused, and French didn't exist.
2. **The cross-lingual margin behaves as designed — and exposes the English taus.** Arabic has a
   **0% false-refusal rate** and French 7%, while English shows **12%** — the English-fitted taus
   are now the *strictest* path. The coarse 20-query calibration should be re-fit with
   `scripts/fit_thresholds.py`; the margin itself needed no adjustment.
3. **dev ≫ golden (0.80 vs 0.47 Hit@5) is an honest, expected gap.** `golden` is never tuned
   against, and its queries target the original seven documents (skin disorders, pediatrics)
   while retrieval tuning this branch focused on the physiotherapy pivot. Report both, never
   just dev.
4. **Refusals work in all three languages**: 22/24 out-of-domain queries refused (both misses are
   borderline wellness questions the corpus partially covers), and refusal messages come back in
   the question's language.
5. **Judged answer quality is consistent across languages** (faithfulness 0.65–0.82, relevance
   0.91–0.96). Arabic answers scored *highest* on faithfulness — grounded generation survives
   translation.
6. **Language correctness**: English 100%, French 92%, Arabic 85% as judged. The Arabic misses are
   mostly partially-English mixed answers on PARTIAL-evidence responses — a prompt-tightening
   candidate, tracked, not hidden.

## Honest limitations

- **Judge is the same model family that generated the answers** (gpt-oss:20b) — a known weakness,
  disclosed here as in `EVALUATION.md`. An independent-model judge pass is the obvious upgrade.
- Precision@5 (~0.30) reads low by construction: most questions have ONE relevant section, so even
  perfect retrieval caps near 0.2–0.4 when 5 slots are always returned. Hit@5/MRR/nDCG are the
  informative numbers.
- The reference answers were LLM-written (from ground-truth text only) and spot-checked, not
  clinician-reviewed.
- Translations were LLM-produced (one hand-authored: `ood008`, which the translator refused).
- Sufficiency taus remain the coarse live calibration; the per-language false-refusal asymmetry
  above is the strongest argument yet for the full re-fit.
