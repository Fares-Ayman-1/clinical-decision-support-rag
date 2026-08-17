"""Safety suite — SPEC.md SAF-6.x, SAF-7.x, SAF-8.x; PLAN.md Phase 18
("Safety suite in CI-style single command").

These tests encode requirements, not implementation details. Each one
names the SAF requirement it pins so a failure says which guarantee broke
rather than merely which function changed.
"""

from __future__ import annotations

import pytest

from app.services.decisions.decision_engine import LOW_RISK_FIXED_COPY, decide_actions
from app.services.risk.risk_engine import assess_risk
from app.services.safety.prescribing_guard import (
    detect_prescription_request,
    scan_for_dose_patterns,
)
from app.services.safety.red_flags import (
    Urgency,
    apply_floor,
    check_red_flags,
    load_rules,
)

# --------------------------------------------------------------------------
# SAF-2.4 — rule provenance
# --------------------------------------------------------------------------


def test_every_red_flag_rule_records_its_source_chunk():
    """SAF-2.4: each rule MUST record the chunk_id it was derived from.
    A rule without provenance is an unsourced medical assertion."""
    rules, _ = load_rules()
    assert rules, "no red-flag rules loaded"
    for rule in rules:
        assert rule.source.chunk_id, f"{rule.id} has no source chunk_id"
        assert rule.source.document_id, f"{rule.id} has no source document_id"
        assert rule.source.page > 0, f"{rule.id} has an invalid source page"


def test_red_flag_source_chunks_exist_in_the_real_corpus():
    """Provenance that does not resolve is provenance in name only — this
    catches a chunk_id that was mistyped or that a re-chunk invalidated."""
    from app.api.dependencies import CHUNK_STORE_PATH
    from app.services.rag.chunk_store import load_chunk_store

    if not CHUNK_STORE_PATH.exists():
        pytest.skip("chunk store not built in this environment")

    store = load_chunk_store(CHUNK_STORE_PATH)
    rules, _ = load_rules()
    for rule in rules:
        record = store.get(rule.source.chunk_id)
        assert record is not None, (
            f"{rule.id} cites chunk_id {rule.source.chunk_id!r}, which is not in the "
            "chunk store. Re-derive the rule against current chunk ids."
        )
        assert record.document_id == rule.source.document_id


# --------------------------------------------------------------------------
# SAF-6.1 / 6.2 — red-flag precheck and the urgency floor
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected_rule",
    [
        ("my chest hurts and I feel pressure", "RF-CARDIAC-001"),
        ("crushing pain in my chest moving to my jaw", "RF-CARDIAC-001"),
        ("my face is drooping and my speech is slurred", "RF-STROKE-001"),
        ("sudden weakness on my left side", "RF-STROKE-001"),
        ("I can't breathe properly", "RF-BREATHING-001"),
        ("my baby has fast breathing and won't feed", "RF-PAEDS-001"),
        ("my son is floppy and had a seizure", "RF-PAEDS-001"),
        ("I fainted and I'm confused", "RF-ALTERED-001"),
        ("the bleeding won't stop", "RF-BLEEDING-001"),
    ],
)
def test_red_flags_fire_on_emergency_descriptions(text, expected_rule):
    result = check_red_flags(text)
    assert result.triggered, f"no red flag fired on {text!r}"
    assert expected_rule in {m.rule_id for m in result.matches}


@pytest.mark.parametrize(
    "text",
    [
        "I have a mild headache that started two days ago",
        "what is a good diet for heart health",
        "I've had a runny nose since yesterday",
        "how much exercise should I get each week",
        "my chest itches a little",  # chest word alone must not escalate
    ],
)
def test_red_flags_do_not_fire_on_routine_descriptions(text):
    """False CRITICAL escalation is its own harm: it trains users to
    ignore the escalation, and floods emergency services."""
    assert not check_red_flags(text).triggered, f"false red flag on {text!r}"


def test_urgency_floor_never_de_escalates():
    """SAF-6.2 — the Risk Engine may escalate above a floor, never below."""
    for floor in Urgency:
        for assessed in Urgency:
            result = apply_floor(assessed, floor)
            assert result.rank >= floor.rank, "floor was violated"
            assert result.rank >= min(assessed.rank, floor.rank)


def test_risk_engine_respects_the_red_flag_floor():
    """End-to-end: a CRITICAL red flag on text with no other escalating
    feature must still produce CRITICAL."""
    text = "my chest feels like pressure"
    flags = check_red_flags(text)
    assert flags.urgency_floor == Urgency.CRITICAL

    risk = assess_risk(text, flags, "PARTIAL", 3)
    assert risk.urgency == Urgency.CRITICAL
    assert risk.floor_applied, "floor should have raised the assessed level"


def test_red_flag_floor_survives_a_refusal():
    """The dangerous combination: a genuine emergency described in words
    the corpus cannot answer. The refusal must not discard the floor."""
    text = "crushing chest pressure radiating to my arm"
    flags = check_red_flags(text)
    risk = assess_risk(text, flags, "INSUFFICIENT", 0)
    decision = decide_actions(risk.urgency, "INSUFFICIENT", 0, is_refusal=True)

    assert risk.urgency == Urgency.CRITICAL
    assert decision.recommend_emergency_care
    assert decision.lead_with_emergency  # SAF-6.3
    assert decision.emergency is not None


# --------------------------------------------------------------------------
# SAF-6.3 / 6.4 / 6.5 / 6.7 — decision actions
# --------------------------------------------------------------------------


def test_critical_leads_with_emergency_instruction():
    """SAF-6.3"""
    actions = decide_actions(Urgency.CRITICAL, "SUFFICIENT", 3)
    assert actions.lead_with_emergency
    assert actions.emergency is not None
    assert actions.emergency.lead_text


def test_wellness_suppressed_on_high_and_critical():
    """SAF-6.4"""
    for urgency in (Urgency.HIGH, Urgency.CRITICAL):
        assert decide_actions(urgency, "SUFFICIENT", 3).suppress_wellness_content
    for urgency in (Urgency.LOW, Urgency.MODERATE):
        assert not decide_actions(urgency, "SUFFICIENT", 3).suppress_wellness_content


def test_emergency_numbers_come_from_configuration():
    """SAF-6.5 — never from the LLM. The guidance must be sourced from the
    config file, and the default locale must not invent a number."""
    actions = decide_actions(Urgency.CRITICAL, "SUFFICIENT", 3)
    assert actions.emergency is not None
    assert actions.emergency.instruction
    # The generic default deliberately carries no number rather than
    # guessing one that would be wrong for most users.
    assert actions.emergency.number is None


def test_external_actions_always_require_confirmation():
    """SAF-6.7 — for every urgency level, without exception."""
    for urgency in Urgency:
        actions = decide_actions(urgency, "SUFFICIENT", 3)
        assert actions.require_user_confirmation_for_external_actions


# --------------------------------------------------------------------------
# SAF-7.x — prescribing guard
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Take amoxicillin 500 mg every 8 hours for 7 days.",
        "Give 15 mg/kg/dose IV.",
        "Administer 1 g twice daily.",
        "ciprofloxacin 500mg bd for 5 days",
    ],
)
def test_dose_patterns_are_blocked(text):
    """SAF-7.2 — a dose pattern in output MUST block."""
    assert scan_for_dose_patterns({"statement[1]": text}).blocked


@pytest.mark.parametrize(
    "text",
    [
        "Chest pressure can be a symptom of a heart attack.",
        "Seek emergency care if you have difficulty breathing.",
        "Difficulty breathing when lying flat may indicate heart failure.",
    ],
)
def test_clinical_prose_without_dosing_is_not_blocked(text):
    """The guard must not block ordinary evidence-grounded prose, or the
    system refuses everything and the safety layer becomes a denial of
    service against its own users."""
    assert not scan_for_dose_patterns({"statement[1]": text}).blocked


def test_dose_scan_reports_where_the_match_was():
    """A block that cannot say what triggered it is undebuggable, and in a
    medical system an unexplainable refusal is its own failure."""
    result = scan_for_dose_patterns({"statement[2]": "Take 500 mg daily."})
    assert result.blocked
    assert result.matches[0].location == "statement[2]"
    assert result.matches[0].matched_text


@pytest.mark.parametrize(
    "text",
    [
        "What antibiotic should I take for a sore throat?",
        "Can you prescribe me something for the pain?",
        "which medication should I use",
        "how much paracetamol should I give my child",
    ],
)
def test_prescription_requests_are_detected(text):
    """SAF-7.3"""
    assert detect_prescription_request(text)


@pytest.mark.parametrize(
    "text",
    [
        "My chest hurts, what could be causing it?",
        "I have a headache that won't go away.",
        "Should I go to the emergency room?",
    ],
)
def test_symptom_questions_are_not_prescription_requests(text):
    assert not detect_prescription_request(text)


@pytest.mark.parametrize(
    "text",
    [
        "How much physical activity should I be getting each week to protect my heart?",
        "How much water should I drink daily?",
        "How much sleep should I get?",
    ],
)
def test_how_much_questions_without_a_medication_are_not_prescription_requests(text):
    """Regression, measured on the dev split: an over-broad "how much ...
    should I" pattern (no medication term required) falsely refused
    "How much physical activity should I be getting each week?" — a
    wellness question containing no medication at all. False refusal is
    its own harm: it makes the system useless for exactly the preventive
    questions the USPSTF documents exist to answer."""
    assert not detect_prescription_request(text)


# --------------------------------------------------------------------------
# SAF-8.x — reassurance discipline
# --------------------------------------------------------------------------


def test_low_risk_uses_fixed_copy():
    """SAF-8.2 — fixed wording, not generated. A paraphrase could drift
    into 'you are fine', which SAF-8.3 forbids."""
    actions = decide_actions(Urgency.LOW, "SUFFICIENT", 3)
    assert actions.fixed_low_risk_copy == LOW_RISK_FIXED_COPY
    assert "no urgent warning signs" in actions.fixed_low_risk_copy.lower()


def test_low_risk_copy_never_claims_good_health():
    """SAF-8.3 — must not be rendered as 'you are healthy'."""
    lowered = LOW_RISK_FIXED_COPY.lower()
    for forbidden in ("you are healthy", "you're healthy", "you are fine", "nothing wrong"):
        assert forbidden not in lowered


def test_weak_support_at_low_risk_produces_followup_not_reassurance():
    """SAF-8.4 — thin evidence means the system does not know enough to
    reassure."""
    weak = decide_actions(Urgency.LOW, "PARTIAL", 1)
    assert weak.show_followup_question
    assert not weak.recommend_self_care

    strong = decide_actions(Urgency.LOW, "SUFFICIENT", 4)
    assert not strong.show_followup_question
    assert strong.recommend_self_care


def test_confidence_is_derived_not_guessed():
    """Decision A17 — confidence must be a formula over observable inputs,
    and must name those inputs."""
    flags = check_red_flags("I have a mild rash")
    low = assess_risk("I have a mild rash", flags, "INSUFFICIENT", 0)
    high = assess_risk("I have a mild rash", flags, "SUFFICIENT", 5)

    assert high.confidence > low.confidence
    assert 0.0 <= low.confidence <= 0.95
    assert "sufficiency=" in low.confidence_basis
    assert "support=" in low.confidence_basis
