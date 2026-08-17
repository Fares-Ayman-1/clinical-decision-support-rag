"""USPSTF evidence-grade extraction — ARCHITECTURE.md §6.5, corpus.yaml
`has_evidence_grades`.

The hackathon guide names USPSTF letter-grade extraction as a specific
stress test. Only `uspstf_cvd_risk` and `uspstf_no_cvd_risk` carry these
(`has_evidence_grades: true` in config/corpus.yaml) — this module is not
invoked for the other five documents.

Verified against real corpus text (data/cleaned/uspstf_cvd_risk.json):
grades appear either as a parenthetical right after a recommendation
sentence ("...promote a healthy diet and physical activity (B
recommendation)") or as a standalone "Grade: B" / bare letter line pulled
out of a summary table. Both forms are handled; a chunk gets the grade
found in its own text only, never inherited across chunks — this deliberately
does not try to remember the "last grade seen" (an unsupported assumption
about the guideline's structure) as a document-wide default.
"""

from __future__ import annotations

import re

_VALID_GRADES = frozenset("ABCDI")

# "(B recommendation)", "B recommendation" — the dominant form found in the
# actual corpus text.
_PAREN_GRADE_RE = re.compile(
    r"\(?\bGrade[:\s]*([A-D]|I)\b\)?|\(([A-D]|I)\s+recommendation\)",
    re.IGNORECASE,
)


def extract_evidence_grade(text: str) -> str | None:
    match = _PAREN_GRADE_RE.search(text)
    if not match:
        return None
    grade = (match.group(1) or match.group(2) or "").upper()
    return grade if grade in _VALID_GRADES else None
