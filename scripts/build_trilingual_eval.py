"""Builds the trilingual (ar/en/fr) evaluation dataset with reference answers.

Input:  data/evaluation/{dev,golden,out_of_domain}.jsonl  (49 base queries,
        English, with document/section/page ground-truth labels)
Output: data/evaluation/trilingual.jsonl — one row per (base query, language):

    {
      "query_id": "dev028_fr",
      "base_id":  "dev028",
      "lang":     "fr",                    # ar | en | fr
      "query":    "...",                   # the question in that language
      "split":    "dev",                   # dev | golden | out_of_domain
      "relevant_sections": [...],          # inherited from the base row
      "domains": [...],
      "expect_refusal": false,             # true for out_of_domain
      "reference_answer": "...",           # English, written STRICTLY from the
                                           # ground-truth sections' own text —
                                           # the LLM judge compares against it
      "notes": "..."
    }

Translations and reference answers come from the same Ollama Cloud model the
pipeline uses (OLLAMA_API_KEY in .env). Reference answers are generated from
the labeled sections' actual chunk text, never from the model's own medical
knowledge — the same grounding rule the system itself lives by.

RESUME-FRIENDLY: rows are appended per base query and flushed; a re-run skips
every base_id whose three language rows already exist. Kill it anytime.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
EVAL_DIR = ROOT / "data" / "evaluation"
OUT_PATH = EVAL_DIR / "trilingual.jsonl"
CHUNKS_PATH = ROOT / "data" / "chunk_store" / "medical_chunks.jsonl"

OLLAMA_URL = "https://ollama.com/v1/chat/completions"
MODEL = "gpt-oss:20b"


def _api_key() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("OLLAMA_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("OLLAMA_API_KEY not found in .env")


def llm(messages: list[dict], max_tokens: int = 900, retries: int = 3) -> str:
    body = json.dumps({
        "model": MODEL, "messages": messages,
        "temperature": 0.1, "max_tokens": max_tokens,
    }).encode()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                OLLAMA_URL, data=body,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {KEY}",
                         "User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.loads(res.read())
            return payload["choices"][0]["message"]["content"]
        except Exception as e:  # noqa: BLE001 — retry any transport/parse error
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"LLM call failed after {retries} attempts: {last}")


def extract_json(text: str) -> dict:
    """Fence-strip then slice the outermost JSON object — small models wrap
    JSON in prose or ``` fences unpredictably."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError(f"no JSON object in: {text[:200]}")
    return json.loads(text[start:end + 1])


def load_base_rows() -> list[dict]:
    rows = []
    for name in ("dev.jsonl", "golden.jsonl", "out_of_domain.jsonl"):
        for line in (EVAL_DIR / name).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_chunk_texts() -> list[dict]:
    chunks = []
    with CHUNKS_PATH.open(encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            chunks.append({
                "document_id": c["document_id"],
                "page_start": c["page_start"], "page_end": c["page_end"],
                "section_path": c.get("section_path", ""),
                "text": c["text"],
            })
    return chunks


def ground_truth_context(row: dict, chunks: list[dict], cap: int = 6000) -> str:
    parts = []
    for sec in row.get("relevant_sections", []):
        for c in chunks:
            if c["document_id"] != sec["document_id"]:
                continue
            if c["page_end"] < sec["page_start"] or c["page_start"] > sec["page_end"]:
                continue
            parts.append(c["text"])
    ctx = "\n\n".join(parts)
    return ctx[:cap]


def translate(query: str) -> dict:
    content = llm([
        {"role": "system", "content":
            "You are a precise medical translator. Return ONLY a JSON object "
            '{"ar": "...", "fr": "..."} — the faithful Arabic and French '
            "translations of the user's medical question, in natural patient "
            "voice, preserving all clinical meaning. No commentary."},
        {"role": "user", "content": query},
    ], max_tokens=1200)
    out = extract_json(content)
    if not out.get("ar") or not out.get("fr"):
        raise ValueError(f"missing translation keys: {out}")
    return out


def reference_answer(query: str, context: str) -> str:
    content = llm([
        {"role": "system", "content":
            "Write a concise reference answer (2-4 sentences, English) to the "
            "patient's question using ONLY the guideline text provided. Do not "
            "use any outside medical knowledge. Do not include medication doses. "
            "If the text does not answer the question, say what it does support. "
            "Return the answer text only."},
        {"role": "user", "content":
            f"<question>\n{query}\n</question>\n\n<guideline_text>\n{context}\n</guideline_text>"},
    ], max_tokens=2000)
    return content.strip()


def main() -> None:
    done: dict[str, set[str]] = {}
    if OUT_PATH.exists():
        for line in OUT_PATH.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                done.setdefault(r["base_id"], set()).add(r["lang"])

    base_rows = load_base_rows()
    chunks = load_chunk_texts()
    todo = [r for r in base_rows if done.get(r["query_id"], set()) != {"ar", "en", "fr"}]
    print(f"{len(base_rows)} base queries; {len(base_rows) - len(todo)} complete; {len(todo)} to build")

    with OUT_PATH.open("a", encoding="utf-8") as out:
        for i, row in enumerate(todo):
            base_id = row["query_id"]
            expect_refusal = row["split"] == "out_of_domain"
            t0 = time.time()
            try:
                tr = translate(row["query"])
                ref = ""
                if not expect_refusal:
                    ctx = ground_truth_context(row, chunks)
                    if ctx:
                        ref = reference_answer(row["query"], ctx)
                for lang, q in (("en", row["query"]), ("ar", tr["ar"]), ("fr", tr["fr"])):
                    if lang in done.get(base_id, set()):
                        continue
                    out.write(json.dumps({
                        "query_id": f"{base_id}_{lang}", "base_id": base_id,
                        "lang": lang, "query": q, "split": row["split"],
                        "relevant_sections": row.get("relevant_sections", []),
                        "domains": row.get("domains", []),
                        "expect_refusal": expect_refusal,
                        "reference_answer": ref,
                        "notes": row.get("notes", ""),
                    }, ensure_ascii=False) + "\n")
                out.flush()
                print(f"[{i+1}/{len(todo)}] {base_id} done in {time.time()-t0:.1f}s", flush=True)
            except Exception as e:  # noqa: BLE001 — skip and continue; re-run resumes
                print(f"[{i+1}/{len(todo)}] {base_id} FAILED: {e}", flush=True)


KEY = _api_key()

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
