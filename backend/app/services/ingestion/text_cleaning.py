"""Line-level text cleaning — ARCHITECTURE.md §6.2.

De-hyphenation, whitespace normalization, and ligature/unicode repair.
Operates on already-extracted text (from text_extraction.py), never touches
page numbers or bboxes — those are set once at extraction time and are never
recomputed (FR-1.2).

Two hazards found directly during Phase 2 profiling drove specific rules
here, not included in a generic ligature table:
  - who_bec: inline Wingdings-style checkbox glyphs (observed \x83\x83) in
    the control-character range U+0080-U+009F, appearing mid-body-text.
  - Multiple documents: dashes/minus signs rendered as U+2212 (MINUS SIGN)
    rather than a normal hyphen, breaking simple string comparisons
    downstream (encountered while building the Phase 3 verification script).
"""

from __future__ import annotations

import re
import unicodedata

_LIGATURES = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
    "ﬅ": "st",
    "ﬆ": "st",
}

# who_aware hazard, found during Phase 4 verification: this document's font
# renders BOTH the "fi" and "fl" ligature glyphs as the same broken control
# character (U+001F), so a blind 1:1 substitution is unsafe — "in\x1fuenzae"
# needs "fl" (influenzae) but "de\x1fnition" needs "fi" (definition), and the
# character alone cannot disambiguate which. 250 occurrences found across the
# document. Rather than guess with a phonetic heuristic, this is a verified
# word-level table built from every distinct occurrence actually present in
# the corpus (docs/corpus-profile.md-style evidence-first approach) — safer
# than risking a wrong guess on unseen words. Applied as whole-word
# replacements after the character-level ligature/quote/dash maps.
# Table rebuilt directly from the exact word list found in data/parsed/
# who_aware.json (verified with a corpus scan, not hand-transcribed from
# memory — an earlier draft of this table had a transcription error:
# "in\x1flammation" instead of the corpus's actual "in\x1fammation", which
# silently failed to match anything).
_U001F_WORD_FIXES = {
    "\x1fagellated": "flagellated",
    "\x1fank": "flank",
    "\x1feld": "field",
    "\x1fnding": "finding",
    "\x1fndings": "findings",
    "\x1frst": "first",
    "\x1fucloxacillin": "flucloxacillin",  # antibiotic name
    "\x1fuid": "fluid",
    "\x1fuids": "fluids",
    "\x1fushing": "flushing",
    "ampli\x1fcation": "amplification",
    "bene\x1ft": "benefit",
    "bio\x1flm": "biofilm",
    "ce\x1fderocol": "cefiderocol",  # antibiotic name
    "ce\x1fxime": "cefixime",  # antibiotic name
    "cipro\x1foxacin": "ciprofloxacin",  # antibiotic name
    "classi\x1fcation": "classification",
    "classi\x1fcations": "classifications",
    "classi\x1fed": "classified",
    "con\x1frm": "confirm",
    "con\x1frmed": "confirmed",
    "con\x1frms": "confirms",
    "de\x1fnition": "definition",
    "de\x1fnitions": "definitions",
    "de\x1fning": "defining",
    "de\x1fnitive": "definitive",
    "identi\x1fcation": "identification",
    "identi\x1fed": "identified",
    "in\x1famed": "inflamed",
    "in\x1fammation": "inflammation",
    "in\x1fuenza": "influenza",
    "in\x1fuenzae": "influenzae",
    "modi\x1fed": "modified",
    "non-speci\x1fc": "non-specific",
    "pro\x1fle": "profile",
    "re\x1fux": "reflux",
    "signi\x1fcant": "significant",
    "simpli\x1fed": "simplified",
    "speci\x1fc": "specific",
    "speci\x1fcally": "specifically",
    "speci\x1fcity": "specificity",
    "super\x1fcial": "superficial",
    "vulni\x1fcus": "vulnificus",  # Vibrio vulnificus, a real pathogen
    # Two rare cases with adjacent text glued on with no space — after
    # punctuation-stripping, the resulting lookup keys below are exact
    # matches for the whole run-together token, not just the ligature word.
    # Found on who_aware pages 178 and 287 during Phase 4 verification; not
    # worth building fuzzy matching for two cases.
    "in\x1fuenzaem": "influenzae M",
    "acuteonsetofvaginalin\x1fammationanddischarge": "acute onset of vaginal inflammation and discharge",
}

_QUOTE_MAP = {
    "‘": "'",
    "’": "'",
    "‚": "'",
    "“": '"',
    "”": '"',
    "„": '"',
    "′": "'",
    "″": '"',
}

_DASH_MAP = {
    "‐": "-",
    "‑": "-",
    "‒": "-",
    "–": "-",  # en dash
    "—": "-",  # em dash
    "−": "-",  # minus sign — found during Phase 3 verification script development
}

# who_bec hazard (docs/corpus-profile.md, config/heading_profiles/who_bec.yaml
# known_hazards.checkbox_glyphs): Wingdings-derived control-range codepoints
# used as checkbox glyphs in a print workbook. Not fixable by ligature or
# quote normalization — must be stripped outright.
_CONTROL_RANGE_RE = re.compile("[-]")

# who_acs_stroke hazard, found during Phase 4 verification: a bullet-point
# glyph renders as the control byte U+009F immediately followed by a stray
# "y" character (74 occurrences, always a whole line on its own, always the
# first line of a bulleted list item). Stripping only the control byte via
# _CONTROL_RANGE_RE above leaves a lone "y" behind as visible junk. This is
# a whole-line pattern, checked and dropped entirely before per-character
# cleaning runs, since a bare "y" carries no content once the glyph is gone.
_BULLET_ARTIFACT_LINE_RE = re.compile("^[-]y$")

_HYPHEN_LINEBREAK_RE = re.compile(r"(\w)-\s*$")
_WHITESPACE_RUN_RE = re.compile(r"[ \t]+")


# NOT \S+: Python's regex engine classifies U+001F (Unit Separator) as
# whitespace, which would split "De\x1fnition" into two separate "words"
# ("De", "nition") before the lookup ever runs — found while debugging why
# the word-fix table below matched nothing despite containing the correct
# keys. Match "one or more characters that are not real whitespace",
# explicitly carving \x1f out of the exclusion set rather than relying on \S.
_REAL_WHITESPACE = " \t\n\r\v\f"
_WORD_RE = re.compile(r"[^" + _REAL_WHITESPACE + r"]+")


def _fix_u001f_words(text: str) -> str:
    """Apply the verified word-level table for who_aware's broken fi/fl
    ligature glyph (see _U001F_WORD_FIXES). Case-preserving: matches the
    lookup key case-insensitively, but re-applies the original word's
    capitalization pattern (all-caps, title-case, or lowercase) to the
    replacement, since headings in this corpus are often Title Case."""
    if "\x1f" not in text:
        return text

    def replace(match: re.Match) -> str:
        word = match.group()
        stripped = word.strip(".,;:()\"'-•")
        lookup = stripped.lower()
        if lookup not in _U001F_WORD_FIXES:
            return word
        fixed = _U001F_WORD_FIXES[lookup]
        if stripped.isupper():
            fixed = fixed.upper()
        elif stripped[:1].isupper():
            fixed = fixed[:1].upper() + fixed[1:]
        return word.replace(stripped, fixed)

    return _WORD_RE.sub(replace, text)


def clean_line(text: str) -> str:
    """Clean a single extracted line: ligatures, quotes, dashes, control chars."""
    if _BULLET_ARTIFACT_LINE_RE.match(text.strip()):
        return ""
    out = text
    out = _fix_u001f_words(out)
    for src, dst in _LIGATURES.items():
        out = out.replace(src, dst)
    for src, dst in _QUOTE_MAP.items():
        out = out.replace(src, dst)
    for src, dst in _DASH_MAP.items():
        out = out.replace(src, dst)
    out = _CONTROL_RANGE_RE.sub("", out)
    out = unicodedata.normalize("NFKC", out)
    out = _WHITESPACE_RUN_RE.sub(" ", out).strip()
    return out


_NEXT_LINE_CONTINUATION_RE = re.compile(r"^([a-z]+)(.*)$", re.DOTALL)


def dehyphenate_lines(lines: list[str]) -> list[str]:
    """Rejoin words split across a line break by a trailing hyphen.

    "hyper-" + "tension" -> "hypertension" (the hyphen and the break both
    disappear). Two conditions must both hold, found necessary by testing
    against real corpus text (who_dcm) during Phase 4 verification:

    1. The first line ends in a hyphen immediately after a word character.
    2. The *next* line starts with a lowercase letter.

    Condition 2 is the important guard. Without it, "consider HIV-" followed
    by a bullet character "•" (a genuine occurrence in who_dcm) merges into
    the nonsense token "HIV•" and silently drops the bulleted line that
    should have followed as its own item. A line starting with lowercase is
    reliably a genuine word continuation; a line starting with punctuation,
    a bullet, a digit, or an uppercase letter (a new sentence/heading) is
    not, and is left alone.

    This still cannot distinguish a genuine mid-word break ("hyper-" +
    "tension") from a real hyphenated compound that happens to fall at a
    line boundary (e.g. "food-by-" + "prescription" -> merges to the wrong
    "food-byprescription" instead of the correct "food-by-prescription").
    That residual ambiguity is accepted as a rare, low-impact miss rather
    than building a dictionary-based disambiguator for a 5-day hackathon —
    but it is a documented, known limitation, not an unexamined one.
    """
    if not lines:
        return []

    result: list[str] = []
    i = 0
    while i < len(lines):
        current = lines[i]
        hyphen_match = _HYPHEN_LINEBREAK_RE.search(current)
        next_line = lines[i + 1] if i + 1 < len(lines) else ""
        continuation_match = _NEXT_LINE_CONTINUATION_RE.match(next_line) if next_line else None

        if hyphen_match and continuation_match:
            continuation_word, rest_of_next = continuation_match.group(1), continuation_match.group(2)
            rest_of_current = current[: current.rfind("-")]
            merged = f"{rest_of_current}{continuation_word}"
            result.append(merged)
            remainder = rest_of_next.lstrip()
            if remainder:
                lines[i + 1] = remainder
                i += 1
            else:
                i += 2
            continue

        result.append(current)
        i += 1
    return result
