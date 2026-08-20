"""Small-talk detector — greetings, thanks, farewells, and "who are you"
questions must never fall through the RAG pipeline into a safe refusal.

Observed live: "good morning" ran the full pipeline (4 LLM calls plus
retrieval, ~30s) and landed in the sufficiency gate's INSUFFICIENT
refusal — the user read a medical-safety warning in response to hello.
A greeting is not a medical question; the correct response is a warm,
instant, localized reply that steers toward what the assistant can do.

Conservative by construction: a message is small talk ONLY if, after
removing recognized greeting/thanks/farewell/identity phrases and polite
fillers ("please", "doctor", "يا دكتور"…), NO alphabetic content remains.
"Good morning, my back hurts" leaves "my back hurts" and goes through the
full pipeline; "صباح الخير يا دكتور" leaves nothing and gets a greeting.
The orchestrator additionally skips this check whenever a red-flag rule
fired — those matches are medical content by definition.

All Arabic patterns are written in NORMALIZED form (see _normalize):
alef variants unified to ا, ى→ي, ة→ه, diacritics and tatweel stripped —
so «شكراً», «شكرا», and «شُكْرًا» all hit the same pattern.
"""

from __future__ import annotations

import re

# Longer than this (after normalization) is a real message, whatever
# pleasantries it opens with — the residue check would catch it anyway,
# but the cap keeps the regex work bounded and the intent explicit.
_MAX_LEN = 100

_AR_DIACRITICS = re.compile(
    "[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]"
)


def _normalize(text: str) -> str:
    text = text.lower()
    text = _AR_DIACRITICS.sub("", text)
    text = text.replace("ـ", "")  # tatweel
    text = re.sub("[أإآٱ]", "ا", text)
    text = text.replace("ى", "ي").replace("ة", "ه")
    # Punctuation, emoji, and symbols become spaces; letters (any script,
    # accents included) and digits survive.
    text = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text)
    return re.sub(r"\s+", " ", text).strip()


# Category order is the tie-break priority; the winning category is the
# one with the LONGEST match, so "hi, what can you do?" is identity (the
# capability question outweighs the "hi") and "nice to meet you" is a
# greeting (the full phrase outweighs the acknowledgment "nice").
_CORE: dict[str, list[str]] = {
    "identity": [
        # en
        r"who\s+are\s+you", r"what\s+are\s+you", r"what\s+can\s+you\s+do",
        r"what\s+do\s+you\s+do", r"how\s+(do|can)\s+i\s+use\s+(you|this|it)",
        r"can\s+you\s+help(\s+me)?", r"help(\s+me)?", r"introduce\s+yourself",
        r"what\s+is\s+(this|faqarati)",
        # fr
        r"qui\s+es\s?tu", r"qui\s+etes\s?vous", r"qui\s+êtes\s?vous",
        r"que\s+(peux|sais)\s?tu\s+faire", r"que\s+pouvez\s?vous\s+faire",
        r"comment\s+(ca|ça)\s+marche", r"aide\s?moi", r"aidez\s?moi",
        r"c\s?est\s+quoi(\s+(ca|ça|faqarati))?",
        # ar (normalized spelling)
        r"من\s+انت", r"مين\s+انت", r"انت\s+مين", r"ما\s+انت",
        r"ما\s+هذا", r"ما\s+هو\s+(هذا|ده|فقراتي|التطبيق|النظام|الموقع)",
        r"ايه\s+(ده|هو\s+ده)", r"ماذا\s+تستطيع(\s+ان\s+تفعل)?",
        r"ماذا\s+يمكنك(\s+ان\s+تفعل)?", r"ماذا\s+تفعل", r"بتعمل\s+ايه",
        r"كيف\s+استخدمك", r"كيف\s+استخدم\s+(التطبيق|المنصه|النظام|الموقع)",
        r"ساعدني", r"مساعده", r"عرف\s+نفسك",
    ],
    "thanks": [
        # en
        r"thanks?", r"thank\s+you(\s+(so|very)\s+much)?", r"thx", r"ty",
        r"many\s+thanks", r"appreciate\s+it", r"great", r"awesome", r"perfect",
        r"ok(ay)?", r"cool", r"nice", r"(very\s+)?good", r"good\s+job",
        r"well\s+done", r"got\s+it", r"understood",
        # fr
        r"merci(\s+beaucoup)?", r"d\s?accord", r"parfait", r"super",
        r"g[eé]nial", r"tr[eè]s\s+bien",
        # ar
        r"شكرا(\s+جزيلا)?", r"الف\s+شكر", r"متشكر(ه|ين)?", r"تسلم(ي)?",
        r"تمام", r"ممتاز", r"جميل", r"رائع", r"جزاك(ي)?\s+الله\s+خيرا",
        r"ماشي", r"اوك(ي)?", r"حسنا", r"فهمت",
    ],
    "farewell": [
        # en
        r"(good\s?)?bye+", r"see\s+you(\s+later|\s+soon)?", r"take\s+care",
        r"good\s?night",
        # fr
        r"au\s+revoir", r"[aà]\s+bient[oô]t", r"bonne\s+(journ[eé]e|soir[eé]e|nuit)",
        r"adieu",
        # ar
        r"مع\s+السلامه", r"الي\s+اللقاء", r"تصبح(ي)?\s+علي\s+خير",
        r"باي", r"وداعا",
    ],
    "greeting": [
        # en
        r"good\s?(morning|afternoon|evening|day)", r"hi+", r"hey+(\s+there)?",
        r"hello+(\s+there)?", r"howdy", r"greetings",
        r"how\s+are\s+you(\s+doing)?", r"how\s?s\s+it\s+going",
        r"what\s?s\s+up", r"wassup", r"sup", r"nice\s+to\s+meet\s+you",
        r"test(ing)?", r"hello\s+world", r"salaa?m+",
        # fr
        r"bonjour", r"bonsoir", r"salut", r"coucou", r"(ca|ça)\s+va",
        r"comment\s+(ca|ça)\s+va", r"comment\s+allez\s?vous", r"enchant[eé]e?",
        # ar
        r"صباح\s+الخير", r"صباح\s+النور", r"صباحو",
        r"مساء\s+الخير", r"مساء\s+النور",
        r"السلام\s+عليكم(\s+ورحمه\s+الله(\s+وبركاته)?)?", r"وعليكم\s+السلام",
        r"سلام", r"مرحبا", r"اهلا(\s+وسهلا|\s+بيك|\s+بك)?", r"اهلين",
        r"هلا", r"هاي", r"كيف\s+حالك", r"كيف\s+الحال", r"ازيك",
        r"عامل(ه)?\s+ايه", r"اخبارك(\s+ايه)?",
    ],
}

# Polite fillers: never small talk on their own (a core phrase must also
# match), but they must not block the residue test — "good morning doctor,
# please" is still just a greeting.
_FILLER = [
    # en
    r"please", r"pls", r"dear", r"doctor", r"dr", r"doc", r"sir", r"madam",
    r"team", r"everyone", r"guys", r"all", r"there", r"my\s+friend",
    r"friend", r"again", r"faqarati", r"assistant", r"bot",
    # fr
    r"docteur", r"monsieur", r"madame", r"svp", r"stp",
    r"s\s?il\s+(vous|te)\s+pla[iî]t", r"mon\s+ami(e)?", r"encore",
    # ar (normalized spelling)
    r"يا", r"دكتور(ه)?", r"من\s+فضلك", r"لو\s+سمحت(ي)?", r"عزيزي",
    r"عزيزتي", r"اخي", r"اختي", r"حضرتك", r"جماعه", r"فقراتي",
    r"مره\s+اخري", r"تاني",
]


# Each pattern is compiled INDIVIDUALLY, not folded into one alternation:
# Python's re returns the first alternative that matches at a position, so
# in a combined regex "good" would eat the front of "good night" and
# "hello" the front of "hello world", leaving residue that wrongly fails
# the small-talk test. Per-pattern span marking unions all matches instead
# — overlap-proof by construction. ~150 tiny regexes over a <=100-char
# string is microseconds.
_CORE_COMPILED: list[tuple[str, re.Pattern[str]]] = [
    (cat, re.compile(r"\b(?:" + p + r")\b"))
    for cat, pats in _CORE.items()
    for p in pats
]
_FILLER_COMPILED = [re.compile(r"\b(?:" + p + r")\b") for p in _FILLER]
_LETTERS = re.compile(r"[^\W\d_]")

# detect_language() needs two lexicon words or a diacritic, so a bare
# "Bonjour" or "Merci" reads as English there. These words are
# unambiguously French; replying in English to them would be wrong.
_FRENCH_HINTS = re.compile(
    r"\b(?:bonjour|bonsoir|salut|coucou|merci|au\s+revoir|adieu|"
    r"d\s?accord|parfait|(ca|ça)\s+va|docteur|svp|enchant[eé]e?)\b"
)


def detect_small_talk(message: str) -> str | None:
    """Returns 'greeting' | 'thanks' | 'farewell' | 'identity' when the
    message is ONLY small talk, else None (run the real pipeline)."""
    text = _normalize(message)
    if not text or len(text) > _MAX_LEN:
        return None
    covered = bytearray(len(text))
    best_cat: str | None = None
    best_len = 0
    for cat, rx in _CORE_COMPILED:
        for m in rx.finditer(text):
            span = m.end() - m.start()
            covered[m.start():m.end()] = b"\x01" * span
            # Strict > keeps the earlier category on ties — _CORE's dict
            # order (identity, thanks, farewell, greeting) is the priority.
            if span > best_len:
                best_cat, best_len = cat, span
    if best_cat is None:
        return None
    for rx in _FILLER_COMPILED:
        for m in rx.finditer(text):
            covered[m.start():m.end()] = b"\x01" * (m.end() - m.start())
    residue = "".join(ch for ch, hit in zip(text, covered) if not hit)
    if _LETTERS.search(residue):
        return None
    return best_cat


def small_talk_reply_language(message: str, detected: str) -> str:
    """detect_language() falls back to 'en' for single French words with no
    diacritic ("Bonjour", "Merci") — for small talk, an unambiguous French
    marker overrides that fallback. Arabic detection (script-based) is
    already reliable and passes through unchanged."""
    if detected == "en" and _FRENCH_HINTS.search(_normalize(message)):
        return "fr"
    return detected


# One reply per category per language. Each steers toward the platform's
# actual purpose and, where natural, offers a proven example question —
# the same ones the UI exposes as verified example chips.
SMALL_TALK_MESSAGES: dict[str, dict[str, str]] = {
    "greeting": {
        "en": (
            "Hello! 👋 I'm Faqarati's clinical assistant. I answer physiotherapy and "
            "rehabilitation questions using evidence from approved clinical guidelines — "
            "every answer shows its sources. Try asking me something like: "
            "“My back hurts, what should I do?”"
        ),
        "ar": (
            "أهلًا بك! 👋 أنا مساعد فقراتي الإكلينيكي. أجيب عن أسئلة العلاج الطبيعي "
            "وإعادة التأهيل استنادًا إلى أدلة من إرشادات سريرية معتمدة — وكل إجابة "
            "تعرض مصادرها. جرّب أن تسألني مثلًا: «ظهري يؤلمني، ماذا أفعل؟»"
        ),
        "fr": (
            "Bonjour ! 👋 Je suis l'assistant clinique de Faqarati. Je réponds aux "
            "questions de physiothérapie et de rééducation à partir de recommandations "
            "cliniques approuvées — chaque réponse affiche ses sources. Essayez par "
            "exemple : « J'ai mal au dos, que dois-je faire ? »"
        ),
    },
    "thanks": {
        "en": (
            "Glad to help! If you have another physiotherapy or rehabilitation "
            "question, I'm here — every answer is grounded in approved clinical "
            "sources."
        ),
        "ar": (
            "على الرحب والسعة! إذا كان لديك سؤال آخر عن العلاج الطبيعي أو إعادة "
            "التأهيل فأنا هنا — كل إجابة مستندة إلى مصادر سريرية معتمدة."
        ),
        "fr": (
            "Avec plaisir ! Si vous avez une autre question de physiothérapie ou de "
            "rééducation, je suis là — chaque réponse s'appuie sur des sources "
            "cliniques approuvées."
        ),
    },
    "farewell": {
        "en": (
            "Take care! Keep up with your exercises, and come back any time you have "
            "a physiotherapy question. If symptoms become severe or rapidly worse, "
            "seek professional medical care."
        ),
        "ar": (
            "مع السلامة! واظب على تمارينك، وعُد في أي وقت لديك سؤال عن العلاج "
            "الطبيعي. وإذا اشتدت الأعراض أو تفاقمت بسرعة، فاطلب رعاية طبية متخصصة."
        ),
        "fr": (
            "Prenez soin de vous ! Continuez vos exercices et revenez dès que vous "
            "avez une question de physiothérapie. Si vos symptômes deviennent sévères "
            "ou s'aggravent rapidement, consultez un professionnel de santé."
        ),
    },
    "identity": {
        "en": (
            "I'm Faqarati's clinical assistant — an evidence-grounded physiotherapy "
            "helper. Ask me about back, neck, or joint pain, rehabilitation exercises, "
            "or recovery plans, and I'll answer from approved clinical guidelines with "
            "the sources shown. For example: “My back hurts, what should I do?”"
        ),
        "ar": (
            "أنا مساعد فقراتي الإكلينيكي — مساعد للعلاج الطبيعي مستند إلى الأدلة. "
            "اسألني عن آلام الظهر أو الرقبة أو المفاصل، أو تمارين إعادة التأهيل وخطط "
            "التعافي، وسأجيبك من إرشادات سريرية معتمدة مع عرض المصادر. "
            "مثلًا: «ظهري يؤلمني، ماذا أفعل؟»"
        ),
        "fr": (
            "Je suis l'assistant clinique de Faqarati — un assistant de physiothérapie "
            "fondé sur des preuves. Posez-moi vos questions sur les douleurs du dos, du "
            "cou ou des articulations, les exercices de rééducation ou les plans de "
            "récupération : je réponds à partir de recommandations cliniques "
            "approuvées, sources à l'appui. Par exemple : « J'ai mal au dos, que "
            "dois-je faire ? »"
        ),
    },
}
