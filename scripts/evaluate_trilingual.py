"""Trilingual end-to-end evaluation of the deployed pipeline.

Runs every row of data/evaluation/trilingual.jsonl (ar/en/fr) against the
live API, computes retrieval metrics against the document/page ground truth,
judges answer quality with an LLM judge, and writes everything to JSON.

    python scripts/evaluate_trilingual.py                  # run (resumes)
    python scripts/evaluate_trilingual.py --max-seconds 540  # time-boxed slice
    python scripts/evaluate_trilingual.py --aggregate      # write summary.json

Outputs (under data/evaluation/runs/<run-name>/):
    results.jsonl   one row per (query, language) — appended and flushed per
                    item, so the run can be killed and resumed at any point
    summary.json    aggregate metrics: overall, per language, per split

Metrics per query (top-5 evidence vs labeled relevant sections; a retrieved
chunk is RELEVANT iff its document matches and its page range overlaps a
labeled section):
    hit@5          any relevant chunk retrieved
    precision@5    relevant retrieved / 5
    mrr            1 / rank of first relevant chunk
    ndcg@5         binary gains; IDCG uses the true number of relevant chunks
                   in the corpus (computed from the chunk store), capped at 5
    section_recall fraction of labeled sections covered by the top-5
plus refusal correctness (out_of_domain rows MUST refuse; in-domain rows must
not), answer-language correctness, sufficiency state and effective taus,
latency, and — for successful in-domain answers — LLM-judge scores:
    faithfulness   statements supported by the cited excerpts (0-1)
    relevance      statements answer the question asked (0-1)
    correctness    agreement with the reference answer (0-1)
    language_ok    the answer is written in the question's language

Judge disclosure: the judge is the same model family that generated the
answers (gpt-oss:20b via Ollama Cloud) — a known weakness, disclosed here
exactly as EVALUATION.md discloses it, not hidden.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "evaluation" / "trilingual.jsonl"
CHUNKS_PATH = ROOT / "data" / "chunk_store" / "medical_chunks.jsonl"
DEFAULT_BASE_URL = "https://fatimahemadeldin-clinical-decision-support-rag.hf.space"
OLLAMA_URL = "https://ollama.com/v1/chat/completions"
JUDGE_MODEL = "gpt-oss:20b"

ARABIC = re.compile("[؀-ۿݐ-ݿ]")
FRENCH_MARKS = set("àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ")


def _env_key() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OLLAMA_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("OLLAMA_API_KEY not found in .env")


def http_json(url: str, body: dict | None, headers: dict, timeout: int) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read())


# ---------------------------------------------------------------- ground truth

def load_chunk_map() -> dict[str, tuple[str, int, int]]:
    out = {}
    with CHUNKS_PATH.open(encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            out[c["chunk_id"]] = (c["document_id"], c["page_start"], c["page_end"])
    return out


def is_relevant(chunk_id: str, sections: list[dict], cmap: dict) -> bool:
    rec = cmap.get(chunk_id)
    if rec is None:
        return False
    doc, ps, pe = rec
    for s in sections:
        if doc == s["document_id"] and not (pe < s["page_start"] or ps > s["page_end"]):
            return True
    return False


def corpus_relevant_count(sections: list[dict], cmap: dict) -> int:
    n = 0
    for doc, ps, pe in cmap.values():
        for s in sections:
            if doc == s["document_id"] and not (pe < s["page_start"] or ps > s["page_end"]):
                n += 1
                break
    return n


def retrieval_metrics(evidence: list[dict], sections: list[dict], cmap: dict) -> dict:
    ranked = sorted(evidence, key=lambda e: e["index"])[:5]
    rel = [is_relevant(e["chunk_id"], sections, cmap) for e in ranked]
    hit = any(rel)
    precision = sum(rel) / 5 if ranked else 0.0
    mrr = next((1.0 / (i + 1) for i, r in enumerate(rel) if r), 0.0)
    dcg = sum(1.0 / math.log2(i + 2) for i, r in enumerate(rel) if r)
    total_rel = corpus_relevant_count(sections, cmap)
    ideal_n = min(total_rel, 5) or 1
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_n))
    covered = set()
    for e in ranked:
        rec = cmap.get(e["chunk_id"])
        if rec is None:
            continue
        doc, ps, pe = rec
        for j, s in enumerate(sections):
            if doc == s["document_id"] and not (pe < s["page_start"] or ps > s["page_end"]):
                covered.add(j)
    return {
        "hit_at_5": hit, "precision_at_5": round(precision, 4),
        "mrr": round(mrr, 4), "ndcg_at_5": round(dcg / idcg, 4),
        "section_recall": round(len(covered) / len(sections), 4) if sections else None,
        "relevant_in_corpus": total_rel,
        "relevant_retrieved": sum(rel),
    }


# ------------------------------------------------------------------- language

def detected_answer_lang(texts: list[str]) -> str:
    joined = " ".join(texts)
    letters = [c for c in joined if c.isalpha()]
    if not letters:
        return "none"
    if sum(1 for c in letters if ARABIC.match(c)) / len(letters) > 0.3:
        return "ar"
    if sum(1 for c in joined if c in FRENCH_MARKS) >= 3:
        return "fr"
    return "en"


# ---------------------------------------------------------------------- judge

def judge(key: str, row: dict, statements: list[str], excerpts: list[str]) -> dict:
    prompt = (
        f"<question lang=\"{row['lang']}\">\n{row['query']}\n</question>\n\n"
        f"<system_answer>\n" + "\n".join(f"- {s}" for s in statements) + "\n</system_answer>\n\n"
        f"<cited_evidence>\n" + "\n---\n".join(excerpts[:5]) + "\n</cited_evidence>\n\n"
        f"<reference_answer>\n{row.get('reference_answer') or '(none)'}\n</reference_answer>"
    )
    content = http_json(OLLAMA_URL, {
        "model": JUDGE_MODEL, "temperature": 0.0, "max_tokens": 1200,
        "messages": [
            {"role": "system", "content":
                "You are a strict evaluation judge for a medical RAG system. "
                "Score the system_answer and return ONLY a JSON object:\n"
                '{"faithfulness": 0.0-1.0,   // are the statements supported by the cited_evidence text?\n'
                ' "relevance": 0.0-1.0,      // do the statements answer the question asked?\n'
                ' "correctness": 0.0-1.0,    // do they agree with the reference_answer (meaning, not wording; ignore language differences)?\n'
                ' "language_ok": true/false, // is the answer written in the SAME language as the question?\n'
                ' "notes": "one sentence"}\n'
                "Judge only against the provided texts, never your own medical knowledge."},
            {"role": "user", "content": prompt},
        ],
    }, {"Content-Type": "application/json", "Authorization": f"Bearer {key}",
        "User-Agent": "Mozilla/5.0"}, timeout=120)["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.MULTILINE).strip()
    start, end = content.find("{"), content.rfind("}")
    verdict = json.loads(content[start:end + 1])
    return {
        "faithfulness": float(verdict.get("faithfulness", 0)),
        "relevance": float(verdict.get("relevance", 0)),
        "correctness": float(verdict.get("correctness", 0)),
        "language_ok": bool(verdict.get("language_ok", False)),
        "notes": str(verdict.get("notes", ""))[:300],
    }


# ----------------------------------------------------------------------- run

def query_api(base_url: str, message: str, attempts: int = 2) -> dict:
    last = None
    for i in range(attempts):
        try:
            return http_json(f"{base_url}/api/query",
                             {"message": message, "options": {"include_trace": True}},
                             {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
                             timeout=280)
        except Exception as e:  # noqa: BLE001 — cold-start flake: retry once
            last = e
            time.sleep(10)
    raise RuntimeError(f"query failed after {attempts} attempts: {last}")


def evaluate_row(row: dict, base_url: str, cmap: dict, key: str, use_judge: bool) -> dict:
    t0 = time.time()
    r = query_api(base_url, row["query"])
    wall = time.time() - t0

    out = {
        "query_id": row["query_id"], "base_id": row["base_id"], "lang": row["lang"],
        "split": row["split"], "expect_refusal": row["expect_refusal"],
        "status": r["status"], "wall_seconds": round(wall, 1),
        "latency_ms": r.get("meta", {}).get("latency_ms"),
    }
    for s in (r.get("trace") or {}).get("stages", []):
        o = s["output"]
        if s["name"] == "sufficiency":
            out["sufficiency"] = o["state"]
            out["top_rerank_score"] = round(o["top_score"], 3)
            out["tau_low_effective"] = o["tau_low"]
            out["cross_lingual_margin"] = o.get("cross_lingual_margin_applied")
        if s["name"] == "candidate_filter":
            out["front_matter_dropped"] = o["front_matter_dropped"]
        if s["name"] == "dose_scan":
            out["dose_blocked"] = o["blocked"]

    evidence = r.get("evidence", [])
    if row["relevant_sections"]:
        out["retrieval"] = retrieval_metrics(evidence, row["relevant_sections"], cmap)
    out["retrieved_chunk_ids"] = [e["chunk_id"] for e in sorted(evidence, key=lambda e: e["index"])[:5]]

    refused = r["status"] == "refusal"
    out["refusal_correct"] = (refused == row["expect_refusal"])
    if refused:
        out["refusal_reason"] = r["refusal"]["reason"]
        out["refusal_message_lang"] = detected_answer_lang([r["refusal"]["message"]])
        out["refusal_lang_ok"] = out["refusal_message_lang"] == row["lang"]
    else:
        statements = [s["text"] for s in r["assessment"]["statements"]]
        out["n_statements"] = len(statements)
        out["answer_lang_detected"] = detected_answer_lang(statements)
        # ar is decidable by script alone; en-vs-fr is confirmed by the judge.
        out["answer_lang_ok_heuristic"] = (
            out["answer_lang_detected"] == row["lang"]
            if row["lang"] != "fr" else out["answer_lang_detected"] in ("fr",)
        )
        out["answer_preview"] = statements[0][:160] if statements else ""
        if use_judge and not row["expect_refusal"]:
            excerpts = [e.get("excerpt") or "" for e in evidence if e.get("selected")]
            try:
                out["judge"] = judge(key, row, statements, [x for x in excerpts if x])
            except Exception as e:  # noqa: BLE001 — judge failure must not lose the row
                out["judge_error"] = f"{type(e).__name__}: {e}"[:200]
    return out


# ------------------------------------------------------------------ aggregate

def _mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 4) if xs else None


def aggregate(results: list[dict]) -> dict:
    def bucket(rows: list[dict]) -> dict:
        indomain = [r for r in rows if not r["expect_refusal"]]
        ood = [r for r in rows if r["expect_refusal"]]
        answered = [r for r in indomain if r["status"] == "success"]
        ret = [r["retrieval"] for r in indomain if "retrieval" in r]
        judged = [r["judge"] for r in answered if "judge" in r]
        return {
            "n": len(rows), "n_in_domain": len(indomain), "n_out_of_domain": len(ood),
            "retrieval": {
                "hit_at_5": _mean([m["hit_at_5"] for m in ret]),
                "precision_at_5": _mean([m["precision_at_5"] for m in ret]),
                "mrr": _mean([m["mrr"] for m in ret]),
                "ndcg_at_5": _mean([m["ndcg_at_5"] for m in ret]),
                "section_recall": _mean([m["section_recall"] for m in ret]),
            },
            "safety": {
                "correct_refusal_rate": _mean([r["refusal_correct"] for r in ood]),
                "false_refusal_rate": _mean([r["status"] == "refusal" for r in indomain]),
            },
            "answer_quality": {
                "n_judged": len(judged),
                "faithfulness": _mean([j["faithfulness"] for j in judged]),
                "relevance": _mean([j["relevance"] for j in judged]),
                "correctness_vs_reference": _mean([j["correctness"] for j in judged]),
                "language_ok_judge": _mean([j["language_ok"] for j in judged]),
                "language_ok_heuristic": _mean([r.get("answer_lang_ok_heuristic") for r in answered]),
            },
            "latency": {
                "mean_ms": _mean([r["latency_ms"] for r in rows]),
                "p95_ms": (sorted(x["latency_ms"] for x in rows if x["latency_ms"])
                           [max(0, int(0.95 * len(rows)) - 1)] if rows else None),
            },
        }

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "n_results": len(results),
        "judge_model": JUDGE_MODEL,
        "judge_disclosure": "Judge is the same model family that generated the answers — a known weakness, disclosed not hidden.",
        "overall": bucket(results),
        "by_language": {lang: bucket([r for r in results if r["lang"] == lang])
                        for lang in ("en", "ar", "fr")},
        "by_split": {split: bucket([r for r in results if r["split"] == split])
                     for split in ("dev", "golden", "out_of_domain")},
    }
    return summary


# ---------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--run-name", default="trilingual-qwen3-mmarco")
    ap.add_argument("--max-seconds", type=float, default=None,
                    help="exit cleanly after this budget; re-run to resume")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--aggregate", action="store_true", help="only write summary.json")
    args = ap.parse_args()

    run_dir = ROOT / "data" / "evaluation" / "runs" / args.run_name
    run_dir.mkdir(parents=True, exist_ok=True)
    results_path = run_dir / "results.jsonl"

    existing = []
    if results_path.exists():
        existing = [json.loads(l) for l in results_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    done_ids = {r["query_id"] for r in existing}

    if args.aggregate:
        summary = aggregate(existing)
        (run_dir / "summary.json").write_text(
            json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps(summary["overall"], indent=2))
        print(f"summary.json written for {len(existing)} results")
        return

    rows = [json.loads(l) for l in DATASET.read_text(encoding="utf-8").splitlines() if l.strip()]
    todo = [r for r in rows if r["query_id"] not in done_ids]
    print(f"{len(rows)} dataset rows; {len(done_ids)} done; {len(todo)} to run", flush=True)

    key = _env_key()
    cmap = load_chunk_map()
    started = time.time()
    with results_path.open("a", encoding="utf-8") as out:
        for i, row in enumerate(todo):
            if args.max_seconds and time.time() - started > args.max_seconds:
                print(f"time budget reached after {i} items — resume by re-running", flush=True)
                return
            try:
                result = evaluate_row(row, args.base_url, cmap, key, use_judge=not args.no_judge)
                out.write(json.dumps(result, ensure_ascii=False) + "\n")
                out.flush()
                tag = result["status"]
                if "retrieval" in result:
                    tag += f" hit={result['retrieval']['hit_at_5']}"
                if "judge" in result:
                    tag += f" faith={result['judge']['faithfulness']}"
                print(f"[{len(done_ids)+i+1}/{len(rows)}] {row['query_id']}: {tag} ({result['wall_seconds']}s)", flush=True)
            except Exception as e:  # noqa: BLE001 — one bad row must not kill the run
                print(f"[{len(done_ids)+i+1}/{len(rows)}] {row['query_id']} FAILED: {e}", flush=True)
    print("run complete — invoke with --aggregate to write summary.json", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
