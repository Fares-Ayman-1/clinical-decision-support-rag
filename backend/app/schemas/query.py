"""POST /api/query request/response schemas — SPEC.md §F.1, matched to the
frontend's Zod contract (frontend/src/types/api.ts) field-for-field where a
subsystem exists to back it.

`risk`, `recommended_action.type` beyond a generic default, and `actions`
beyond all-false are NOT populated with real Risk & Decision Engine output
(Phase 15 not started) — `recommended_action`/`actions` are still sent
with honest, generic values (not fabricated risk-derived ones) because the
frontend's UI unconditionally renders a recommended-action line and an
actions section. `risk` itself is correctly omitted (frontend already
handles it as optional). PROJECT-STATE.md decision D5 — Phase 14
(red-flag/dose-pattern blocking) is not wired in either.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

_PROFILE_PREAMBLE = re.compile(r"\n*\[Patient profile:[^\]]*\]\s*$")

_ARABIC_CHARS = re.compile("[؀-ۿݐ-ݿࢠ-ࣿ]")
_FRENCH_DIACRITICS = set("àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ")
# High-frequency French function/medical words that are rare in English
# prose. Detection requires TWO distinct hits (or one plus a French
# diacritic) so a stray loanword in an English question cannot flip it.
_FRENCH_WORDS = frozenset(
    "le la les un une des du de et est que qui quoi pourquoi comment avec pour "
    "mon ma mes je j'ai dois faire mal douleur dos au aux quels quelles quel "
    "quelle exercices traitement santé médecin genou colonne vertébrale après "
    "fracture arthrose lombaire kinésithérapie rééducation".split()
)


def detect_language(text: str) -> str:
    """'ar', 'fr', or 'en' — the three languages this deployment localizes.

    Arabic is decided by script. French shares the Latin script with
    English, so it is decided by lexical markers: ≥2 distinct French
    function/medical words, or 1 word plus a French diacritic. Anything
    else falls back to 'en' — the safe default, since every localized
    string has an English value. The always-English profile preamble is
    stripped first (it would otherwise flip short non-English questions to
    'en' for exactly the users who filled in their profile)."""
    text = strip_profile_preamble(text)
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return "en"
    if sum(1 for ch in letters if _ARABIC_CHARS.match(ch)) / len(letters) > 0.5:
        return "ar"
    words = {w.strip(".,;:!?()\"'").lower() for w in text.split()}
    french_hits = len(words & _FRENCH_WORDS)
    has_diacritic = any(ch in _FRENCH_DIACRITICS for ch in text)
    if french_hits >= 2 or (french_hits >= 1 and has_diacritic):
        return "fr"
    return "en"


def strip_profile_preamble(message: str) -> str:
    """Removes the as_preamble() block for language detection. The preamble
    is always English regardless of the question's language, so a short
    Arabic question plus a filled-in profile reads as majority-Latin and
    flips script-based detection to English — the answer and refusal would
    come back in the wrong language precisely for users who bothered to
    complete their profile. Kept next to as_preamble() so the two formats
    can never drift apart silently."""
    return _PROFILE_PREAMBLE.sub("", message)

Severity = Literal["mild", "moderate", "severe", "unknown"]

_SEVERITY_KEYWORDS: dict[str, Severity] = {
    "mild": "mild",
    "slight": "mild",
    "minor": "mild",
    "moderate": "moderate",
    "severe": "severe",
    "intense": "severe",
    "extreme": "severe",
    "crushing": "severe",
    "unbearable": "severe",
}


def normalize_severity(raw: str | None) -> Severity:
    """The 01_symptom_extractor prompt returns free-text severity (its
    schema/prompt were already verified against a live LLM and are not
    being reopened just to add an enum mid-session). The frontend wants a
    fixed 4-value enum for consistent rendering, so the mapping happens
    here at the API boundary instead — keyword match against the free
    text, defaulting to "unknown" rather than guessing wrong."""
    if not raw:
        return "unknown"
    lowered = raw.lower()
    for keyword, value in _SEVERITY_KEYWORDS.items():
        if keyword in lowered:
            return value
    return "unknown"


class PatientContext(BaseModel):
    age: int | None = Field(default=None, ge=0, le=120)
    sex: Literal["female", "male", "intersex", "other", "unknown"] | None = None
    known_conditions: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)

    def as_preamble(self) -> str:
        """Renders the profile as a bracketed context block appended to the
        patient's message before the pipeline runs. This field was previously
        accepted and then consumed by NOTHING — a silent no-op that made the
        profile page a placebo. Folding it into the message text means every
        stage that reads the message (red flags, extraction, retrieval
        rewrites, generation) sees the context without any of them needing a
        new parameter."""
        parts: list[str] = []
        if self.age is not None:
            parts.append(f"age {self.age}")
        if self.sex and self.sex != "unknown":
            parts.append(f"sex {self.sex}")
        if self.known_conditions:
            parts.append("known conditions: " + ", ".join(self.known_conditions))
        if self.medications:
            parts.append("current medications: " + ", ".join(self.medications))
        if self.allergies:
            parts.append("allergies: " + ", ".join(self.allergies))
        return f"\n\n[Patient profile: {'; '.join(parts)}]" if parts else ""


class QueryOptions(BaseModel):
    include_trace: bool = False
    stream: bool = False  # streaming not yet wired into the endpoint — see TODO-PRODUCTION.md


class QueryRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str | None = None
    patient_context: PatientContext | None = None
    options: QueryOptions = Field(default_factory=QueryOptions)


class PatientStateOut(BaseModel):
    symptoms: list[str]
    severity: Severity
    onset: str | None = None  # backend's extractor doesn't distinguish onset from duration yet
    duration: str | None
    missing_information: list[str]


class StatementOut(BaseModel):
    id: int
    text: str
    citations: list[int] = Field(min_length=1)  # indexes into evidence[]


class AssessmentOut(BaseModel):
    statements: list[StatementOut] = Field(min_length=1)
    limitations: list[str]
    conflicts: list[str]
    diagnosis_confirmed: Literal[False] = False  # ALWAYS false — SPEC.md SAF-1.1


class EvidenceScores(BaseModel):
    dense: float | None
    bm25: float | None
    rrf: float
    rerank: float | None


class EvidenceOut(BaseModel):
    index: int
    chunk_id: str
    document_title: str
    organization: str
    section_path: str
    page_start: int
    page_end: int
    evidence_grade: str | None
    excerpt: str | None
    source_url: str
    scores: EvidenceScores
    selected: bool


class SafetyOut(BaseModel):
    sufficiency: Literal["SUFFICIENT", "PARTIAL", "INSUFFICIENT", "OUT_OF_SCOPE"]
    retrieval_confidence_band: Literal["strong", "moderate", "weak"] | None = None
    unsupported_statements_dropped: int = 0
    injection_detected: bool = False
    disclaimer: str = (
        "This system provides information from published medical guidelines. It is not a "
        "diagnosis and does not replace professional medical evaluation. Medical Safety "
        "Guardrails (red-flag rules, prescribing blocks) are not enabled in this build — "
        "see PROJECT-STATE.md decision D5."
    )


class RecommendedActionOut(BaseModel):
    type: Literal["emergency", "urgent_care", "evaluation", "guidance"] = "guidance"
    message: str


class DecisionActionsOut(BaseModel):
    """Populated by the Decision Engine (Phase 15). Boolean display flags
    only — SAF-6.6/6.7: nothing here executes, and every external action
    still requires explicit user confirmation in the UI."""

    show_call_emergency: bool = False
    show_find_facility: bool = False
    show_alert_contacts: bool = False
    show_wellness: bool = False


class RiskOut(BaseModel):
    """Risk Engine output — SPEC.md SAF-6.2, decision D3/A9.

    `red_flag_rules` carries the rule IDs that fired; each is traceable to
    an approved source chunk via config/red_flags.yaml (SAF-2.4).
    `confidence_value` is a DERIVED formula, never an LLM-guessed decimal
    (decision A17) — `reasoning_factors` names its inputs.
    """

    level: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    # Lowercase strong/moderate/weak — matches the frontend's established
    # confidenceBandSchema vocabulary (and SafetyOut's existing
    # retrieval_confidence_band), deliberately distinct from `level`'s
    # uppercase urgency enum so the two are never confused.
    confidence_band: Literal["strong", "moderate", "weak"]
    confidence_value: float | None = None
    reasoning_factors: list[str] = Field(default_factory=list)
    red_flag_rules: list[str] = Field(default_factory=list)
    evidence_ids: list[int] = Field(default_factory=list)


class RefusalOut(BaseModel):
    # SMALL_TALK is a refusal only in the contract sense (no evidence, no
    # generated answer) — the message is a friendly greeting/capabilities
    # reply, and clients should render it as a normal chat bubble, not a
    # safety warning.
    reason: Literal["OUT_OF_SCOPE", "INSUFFICIENT_EVIDENCE", "PRESCRIBING_REQUEST", "SMALL_TALK"]
    message: str
    recommend_professional_evaluation: bool = True


class TraceStageOut(BaseModel):
    name: str
    latency_ms: float
    output: dict


class TraceOut(BaseModel):
    stages: list[TraceStageOut]


class QueryMeta(BaseModel):
    latency_ms: float
    kb_version: str
    embedding_version: str
    prompt_version: str = "rag-gen-v1"
    risk_policy_version: str | None = None  # set from the Risk Engine's policy_version


class QuerySuccessOut(BaseModel):
    request_id: str
    status: Literal["success"] = "success"
    supported_domain: bool
    domains: list[str]
    patient_state: PatientStateOut
    assessment: AssessmentOut
    risk: RiskOut | None = None
    recommended_action: RecommendedActionOut
    actions: DecisionActionsOut
    evidence: list[EvidenceOut] = Field(min_length=1)
    safety: SafetyOut
    trace: TraceOut | None = None
    meta: QueryMeta


class QueryRefusalOut(BaseModel):
    request_id: str
    status: Literal["refusal"] = "refusal"
    supported_domain: bool
    domains: list[str]
    refusal: RefusalOut
    evidence: list[EvidenceOut]
    safety: SafetyOut
    trace: TraceOut | None = None
    meta: QueryMeta
