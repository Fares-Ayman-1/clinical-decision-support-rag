"""Pydantic schemas for every prompt's structured output — ARCHITECTURE.md
§12.1. One schema per prompt file, validated by LLMProvider.complete_structured()
(backend/app/llm/provider.py) with one retry on violation.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# The full domain vocabulary actually present in config/corpus.yaml —
# kept in sync manually rather than loaded at prompt-schema-definition
# time, since Pydantic Literal/enum values must be static. If corpus.yaml
# ever adds a new domain, this list needs a matching update (there is no
# way around that without dynamic schema generation, which is overkill
# for 14 fixed labels).
DOMAIN_LABELS = (
    "abdominal", "acs", "acute-care", "cardiovascular", "emergency",
    "gastrointestinal", "general-acute", "infectious-disease",
    # Physiotherapy/rehabilitation expansion (WHO rehab MSK module + WHO
    # chronic low-back-pain guideline). Labels here AND in corpus.yaml must
    # agree: the classifier can only boost domains that chunks carry.
    "musculoskeletal", "nutrition", "physical-activity", "prevention",
    "rehabilitation", "respiratory", "stroke", "wellness",
)


class PatientState(BaseModel):
    """01_symptom_extractor output — ARCHITECTURE.md §12.1."""

    chief_complaint: str = Field(description="The primary symptom or concern, in the patient's own words, normalized to plain clinical English")
    symptoms: list[str] = Field(default_factory=list, description="Individual symptoms mentioned, one per entry")
    duration: str | None = Field(default=None, description="How long symptoms have been present, if stated")
    severity: str | None = Field(default=None, description="Severity as described (mild/moderate/severe), if stated")
    age_group: str | None = Field(default=None, description="child, adult, older-adult, or None if not stated")
    red_flag_phrases: list[str] = Field(default_factory=list, description="Verbatim phrases suggesting a time-critical emergency, if any")
    missing_information: list[str] = Field(default_factory=list, description="Clinically relevant details NOT provided that would help triage")


class DomainClassification(BaseModel):
    """02_domain_classifier output — ARCHITECTURE.md §9.2 / §12.1. Feeds
    hybrid_search's predicted_domains param directly."""

    domains: list[str] = Field(description=f"Zero or more of: {', '.join(DOMAIN_LABELS)}")
    reasoning: str = Field(description="One sentence explaining the classification")


class QueryVariants(BaseModel):
    """03_query_rewriter output — lay language to clinical query variants,
    the D2 vocabulary-gap mitigation."""

    variants: list[str] = Field(min_length=1, max_length=3, description="1-3 clinically-phrased rewordings of the original query")


class CitedStatement(BaseModel):
    text: str = Field(description="A single grounded clinical statement")
    evidence_ids: list[str] = Field(min_length=1, description="Evidence labels (E1, E2, ...) this statement is drawn from — never a chunk_id, document title, section, or page number")


class Excerpt(BaseModel):
    evidence_id: str
    quote: str = Field(description="A verbatim substring copied from that evidence_id's text — must be checkable against the Chunk Store")


class Conflict(BaseModel):
    description: str
    evidence_ids: list[str] = Field(min_length=2, description="The evidence_ids that disagree")


class GroundedGeneration(BaseModel):
    """04_grounded_generator output — ARCHITECTURE.md §12.2. The core
    grounding contract: no document title, section, or page number ever
    appears here, only evidence_id labels — this is what makes citation
    fabrication structurally impossible rather than merely detectable."""

    statements: list[CitedStatement] = Field(default_factory=list)
    excerpts: list[Excerpt] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list, description="What information would improve confidence in this answer")
    conflicts: list[Conflict] = Field(default_factory=list)
    insufficient_evidence: bool = Field(description="True if the Evidence Pack does not support a confident answer")


class FollowupQuestion(BaseModel):
    """05_followup_generator output — one targeted question when
    PatientState.missing_information suggests triage-relevant information
    is missing."""

    question: str = Field(description="One specific, patient-facing follow-up question")
    reason: str = Field(description="Why this specific piece of information matters for triage")


class FaithfulnessVerdict(BaseModel):
    """06_faithfulness_judge output — evaluation only, offline (not part
    of the live serving path). Scores whether GroundedGeneration's
    statements are actually supported by their cited evidence."""

    statement_index: int
    supported: bool
    reasoning: str
