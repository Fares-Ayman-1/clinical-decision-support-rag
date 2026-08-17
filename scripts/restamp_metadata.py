#!/usr/bin/env python
"""Re-stamp document-level metadata onto already-built chunk files.

Some fields in a chunk record are copied straight from config/corpus.yaml
at chunking time (source_url, license, publication_year, document_title,
organization). When one of those is corrected — e.g. filling in a real
source_url that was a TBD placeholder — the chunks still carry the old
value until they are rebuilt.

A full re-chunk + re-embed + re-index is unnecessary for these fields, and
this script exists to make that claim checkable rather than assumed:

  - `content_hash` is sha256 over `text` ONLY (chunk_document.py), so
    nothing here changes it.
  - `embedded_text` is `{document_title} > {section_path}\\n\\n{text}` and
    contains no URL, licence, or year — verified before writing this — so
    the vectors already in Qdrant stay correct.

Only fields that are genuinely document-level constants are touched.
`document_title` and `organization` ARE part of embedded_text via the
contextual prefix, so changing them WOULD invalidate the embeddings —
this script refuses to touch them for that reason and tells you to
re-index instead.

Usage
-----
    python scripts/restamp_metadata.py --dry-run
    python scripts/restamp_metadata.py
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.ingestion.corpus_config import load_corpus_config  # noqa: E402

# Safe to re-stamp: document-level, and provably absent from embedded_text
# and content_hash.
RESTAMPABLE = ("source_url", "license", "publication_year")

# Present in embedded_text via the contextual prefix — changing either
# would silently invalidate every stored vector, so they are refused here.
EMBEDDING_AFFECTING = ("document_title", "organization")

TARGETS = (
    REPO_ROOT / "data" / "chunk_store" / "medical_chunks.jsonl",
    REPO_ROOT / "data" / "chunks" / "benchmark" / "1.0_S1.jsonl",
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="Report changes without writing")
    args = ap.parse_args()

    config = load_corpus_config(REPO_ROOT / "config" / "corpus.yaml")
    by_id = {d.document_id: d for d in config.documents}
    print(f"Loaded {len(by_id)} documents from corpus.yaml\n")

    total_changed = 0
    for path in TARGETS:
        if not path.exists():
            print(f"  SKIP (absent): {path.relative_to(REPO_ROOT)}")
            continue

        lines = path.read_text(encoding="utf-8").splitlines()
        out: list[str] = []
        changed = 0
        per_field: dict[str, int] = {}
        unknown_docs: set[str] = set()

        for line in lines:
            if not line.strip():
                continue
            rec = json.loads(line)
            doc = by_id.get(rec.get("document_id"))
            if doc is None:
                unknown_docs.add(rec.get("document_id", "?"))
                out.append(line)
                continue

            touched = False
            for field in RESTAMPABLE:
                new = getattr(doc, field, None)
                if new is not None and rec.get(field) != new:
                    rec[field] = new
                    per_field[field] = per_field.get(field, 0) + 1
                    touched = True

            # Guard, not a comment: if a title/org drifted, re-stamping
            # would leave the record inconsistent with its own vector.
            for field in EMBEDDING_AFFECTING:
                new = getattr(doc, field, None)
                if new is not None and rec.get(field) != new:
                    print(f"  REFUSING: {rec['chunk_id']} has {field}={rec.get(field)!r} but "
                          f"corpus.yaml says {new!r}. This field is part of embedded_text — "
                          f"re-index with scripts/build_mvp_index.py instead of re-stamping.")
                    return 2

            if touched:
                changed += 1
            out.append(json.dumps(rec, ensure_ascii=False))

        if unknown_docs:
            print(f"  WARNING: document_ids not in corpus.yaml: {sorted(unknown_docs)}")

        print(f"  {path.relative_to(REPO_ROOT)}")
        print(f"    {changed}/{len(out)} records updated")
        for field, count in sorted(per_field.items()):
            print(f"      {field}: {count}")

        if not args.dry_run and changed:
            path.write_text("\n".join(out) + "\n", encoding="utf-8")
        total_changed += changed

    if args.dry_run:
        print(f"\nDRY RUN — {total_changed} records would change. Re-run without --dry-run.")
    else:
        print(f"\nDone. {total_changed} records updated.")
        print("Qdrant vectors are unaffected (source_url/license/publication_year are not in")
        print("embedded_text), but the Qdrant PAYLOAD may still carry stale copies — check")
        print("whether your payload includes these fields before relying on them from search.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
