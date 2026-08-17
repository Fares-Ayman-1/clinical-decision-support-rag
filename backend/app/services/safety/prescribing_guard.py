"""Prescribing guard — SPEC.md SAF-7.1 through SAF-7.4.

The system must never recommend a medication, dose, frequency, or
duration (SAF-7.1), and enforcement MUST be in code, not prompt
instruction alone (SAF-7.4). Prompts can be talked around; a regex over
the generated output cannot.

Two independent checks, deliberately separate because they fail
differently:

1. `detect_prescription_request` — INPUT side (SAF-7.3). A patient asking
   "what antibiotic should I take" gets a referral, not a partial answer.
   Catching this at input avoids spending a full pipeline run to produce
   something that must then be suppressed.

2. `scan_for_dose_patterns` — OUTPUT side (SAF-7.2). Responses drawing on
   who_aware (the AWaRe antibiotic book, which is dense with real dosing
   tables) MUST be scanned for dose patterns and blocked on match.

The output scan runs on ALL responses, not only who_aware-sourced ones.
SAF-7.2 names who_aware as the requirement's origin, but a dose pattern
reaching a patient is equally unsafe whichever document it came from, and
restricting the scan by source document would make the guard depend on
correct provenance tracking — a weaker guarantee than scanning everything.
The originating document is still reported, so a block is explainable.

Note on `who_aware` specifically (PROJECT-STATE.md §11): it may inform
evidence about infections but must never drive an autonomous antibiotic,
dose, frequency, or duration recommendation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Dose patterns. Written to match how dosing actually appears in this
# corpus's tables (verified against real who_aware content, e.g.
# "Amikacin | IV: 15 mg/kg/dose") and how a model would restate it in
# prose, rather than from a generic idea of what a dose looks like.
_DOSE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # 500 mg, 1 g, 15 mg/kg, 5 mL — a number bound to a dose unit.
    (
        "dose_amount",
        re.compile(
            r"\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|g|kg|ml|mL|l|iu|units?)\b"
            r"(?:\s*/\s*(?:kg|m2|day|dose|hr|h))?",
            re.IGNORECASE,
        ),
    ),
    # every 8 hours, twice daily, q8h, BD/TDS/QDS, once a day.
    (
        "frequency",
        re.compile(
            r"\b(?:every\s+\d+\s*(?:hours?|hrs?|h|days?)"
            r"|\d+\s*times?\s+(?:a|per)\s+(?:day|week)"
            r"|once|twice|thrice)\s+(?:a\s+|per\s+)?(?:daily|day|week)\b"
            r"|\bq\d+h\b|\b(?:bd|tds|qds|od|bid|tid|qid|prn)\b",
            re.IGNORECASE,
        ),
    ),
    # for 7 days, over 2 weeks — a treatment duration.
    (
        "duration",
        re.compile(
            r"\b(?:for|over|during)\s+\d+\s*(?:to\s*\d+\s*)?(?:day|week|month)s?\b",
            re.IGNORECASE,
        ),
    ),
    # Route + drug-shaped instruction: "take amoxicillin", "IV ceftriaxone".
    (
        "administration_instruction",
        re.compile(
            r"\b(?:take|give|administer|inject|swallow)\s+(?:\d|\w+(?:cillin|mycin|cycline"
            r"|azole|prazole|statin|olol|sartan|pril|floxacin|ceph|cef)\w*)",
            re.IGNORECASE,
        ),
    ),
)

# Input-side: the patient is asking to be prescribed something.
_PRESCRIPTION_REQUEST_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"\b(?:what|which|how much)\b[^.?!]{0,60}\b"
        r"(?:medication|medicine|drug|antibiotic|painkiller|tablet|pill|dose|dosage)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:should|can|could|may)\s+(?:i|my|he|she|they|we)\b[^.?!]{0,40}\b"
        r"(?:take|use|give|start|stop)\b[^.?!]{0,40}\b"
        r"(?:medication|medicine|drug|antibiotic|tablet|pill|mg|dose)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:prescribe|prescription)\b",
        re.IGNORECASE,
    ),
    # "how much ... should I take" — but ONLY when a medication-ish term is
    # present. An earlier version omitted that requirement and matched any
    # "how much X should I" phrasing, which falsely refused
    # "How much physical activity should I be getting each week?" — a
    # wellness question with no medication in it at all. Measured on the
    # dev split: that single over-broad pattern was a real false-refusal
    # source, so the medication term is now required rather than assumed.
    re.compile(
        r"\bhow (?:much|many)\b[^.?!]{0,40}\b"
        r"(?:medication|medicine|drug|antibiotic|painkiller|tablet|pill|dose|dosage|"
        r"paracetamol|ibuprofen|aspirin|insulin|\w+(?:cillin|mycin|cycline|azole|statin))\b"
        r"|\bhow (?:much|many)\b[^.?!]{0,25}\b(?:should|do|can)\s+(?:i|my|we)\b[^.?!]{0,30}\b"
        r"(?:take|give|swallow|inject|administer)\b",
        re.IGNORECASE,
    ),
)


@dataclass(frozen=True)
class DoseMatch:
    kind: str
    matched_text: str
    location: str  # which field of the response it was found in


@dataclass(frozen=True)
class DoseScanResult:
    matches: tuple[DoseMatch, ...]
    source_documents: tuple[str, ...]

    @property
    def blocked(self) -> bool:
        return bool(self.matches)


def scan_for_dose_patterns(
    texts: dict[str, str], source_documents: tuple[str, ...] = ()
) -> DoseScanResult:
    """SAF-7.2 output scan.

    `texts` maps a location label (e.g. "statement[1]", "excerpt[2]") to
    the text to scan, so a block can say exactly where the pattern was —
    a bare boolean would make every block unexplainable and undebuggable.
    """
    matches: list[DoseMatch] = []
    for location, text in texts.items():
        if not text:
            continue
        for kind, pattern in _DOSE_PATTERNS:
            for m in pattern.finditer(text):
                matches.append(DoseMatch(kind=kind, matched_text=m.group(0), location=location))
    return DoseScanResult(matches=tuple(matches), source_documents=tuple(source_documents))


def detect_prescription_request(patient_text: str) -> bool:
    """SAF-7.3 input check — the patient is asking what to take."""
    return any(p.search(patient_text) for p in _PRESCRIPTION_REQUEST_PATTERNS)


PRESCRIBING_REFERRAL_MESSAGE = (
    "I can't recommend medications, doses, or treatment durations — that decision "
    "needs a qualified healthcare professional who can examine you and knows your "
    "medical history, allergies, and current medications. Please speak to a doctor, "
    "pharmacist, or nurse about this. If your symptoms are severe or rapidly "
    "worsening, seek urgent medical care."
)

DOSE_BLOCKED_MESSAGE = (
    "I found relevant guidance in the medical knowledge base, but it contains "
    "specific medication dosing information that I can't pass on. Medication and "
    "dosing decisions must come from a qualified healthcare professional who can "
    "assess you directly. Please consult a doctor or pharmacist."
)
