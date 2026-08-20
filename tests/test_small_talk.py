"""Small-talk short-circuit — greetings must never reach the sufficiency
gate's refusal path (observed live: "good morning" got a medical-safety
refusal after a full 30s pipeline run).

The detector's contract has two halves, and both are safety-relevant:
- POSITIVE: pure pleasantries in all three languages get an instant,
  localized, friendly reply.
- NEGATIVE: any message with real clinical content — even one that opens
  with a greeting — must fall through to the full evidence pipeline.
  A false positive here would answer a medical question with chit-chat.
"""

from __future__ import annotations

import pytest

from app.services.rag.small_talk import (
    SMALL_TALK_MESSAGES,
    detect_small_talk,
    small_talk_reply_language,
)


# --------------------------------------------------------------------------
# Positives — pure small talk, per language
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "category"),
    [
        # English
        ("good morning", "greeting"),
        ("Good Morning!!", "greeting"),
        ("good morning doctor", "greeting"),
        ("hi", "greeting"),
        ("hello there", "greeting"),
        ("how are you?", "greeting"),
        ("nice to meet you", "greeting"),
        ("hello world", "greeting"),
        ("test", "greeting"),
        ("thanks", "thanks"),
        ("thank you so much!", "thanks"),
        ("ok great", "thanks"),
        ("bye", "farewell"),
        ("good night", "farewell"),
        ("who are you?", "identity"),
        ("what can you do?", "identity"),
        ("hi, what can you do?", "identity"),
        ("help", "identity"),
        # French
        ("Bonjour", "greeting"),
        ("bonsoir docteur", "greeting"),
        ("ça va ?", "greeting"),
        ("merci beaucoup", "thanks"),
        ("au revoir", "farewell"),
        ("qui es-tu ?", "identity"),
        # Arabic — diacritized and hamza-variant spellings included, since
        # normalization is what makes them all hit the same pattern.
        ("صباح الخير", "greeting"),
        ("السلام عليكم", "greeting"),
        ("مرحبا", "greeting"),
        ("كيف حالك؟", "greeting"),
        ("شُكْرًا جزيلا", "thanks"),
        ("مع السلامة", "farewell"),
        ("من أنت؟", "identity"),
    ],
)
def test_pure_small_talk_is_detected(message, category):
    assert detect_small_talk(message) == category


# --------------------------------------------------------------------------
# Negatives — real questions must reach the pipeline, greeting or not
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "good morning, my back hurts",
        "hi doctor, I have knee pain",
        "my back hurts, what should I do?",
        "hip pain",  # "hi" must not fire inside "hip"
        "help me with my back pain",
        "what exercises help low back pain?",
        "can you recommend a dose of ibuprofen?",
        "J'ai mal au dos, que dois-je faire ?",
        "ظهري يؤلمني ماذا افعل",
        "الم الظهر",
        "صباح الخير، رقبتي تؤلمني",  # greeting + symptom -> pipeline
        "",
    ],
)
def test_clinical_content_is_never_small_talk(message):
    assert detect_small_talk(message) is None


# --------------------------------------------------------------------------
# Reply language — bare French pleasantries override the 'en' fallback
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("message", "detected", "expected"),
    [
        ("Bonjour", "en", "fr"),
        ("merci", "en", "fr"),
        ("good morning", "en", "en"),
        ("صباح الخير", "ar", "ar"),  # Arabic passes through untouched
    ],
)
def test_reply_language(message, detected, expected):
    assert small_talk_reply_language(message, detected) == expected


# --------------------------------------------------------------------------
# Message table — every category localized in all three languages
# --------------------------------------------------------------------------


def test_every_category_has_all_three_languages():
    assert set(SMALL_TALK_MESSAGES) == {"greeting", "thanks", "farewell", "identity"}
    for category, by_lang in SMALL_TALK_MESSAGES.items():
        for lang in ("en", "ar", "fr"):
            assert len(by_lang[lang]) > 40, f"{category}/{lang} reply missing or trivial"


def test_replies_never_read_as_refusals():
    """The whole point: a greeting reply must not contain refusal language
    in any localization."""
    for by_lang in SMALL_TALK_MESSAGES.values():
        for text in by_lang.values():
            lowered = text.lower()
            for banned in ("insufficient", "refus", "رفض", "أدلة غير"):
                assert banned not in lowered
