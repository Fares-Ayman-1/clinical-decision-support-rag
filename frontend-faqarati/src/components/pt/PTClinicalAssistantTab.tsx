/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Clinical Assistant tab — embeds the evidence-grounded clinical RAG system
 * (clinical-decision-support-rag) inside the PT portal. Every statement the
 * assistant makes cites retrieved WHO guideline text; when evidence is
 * insufficient it refuses rather than guessing. Bilingual (the backend
 * answers in the question's language) with voice dictation via Groq Whisper.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpenCheck,
  ChevronDown,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  ShieldAlert,
  Stethoscope,
  UserRound,
  Volume2,
  VolumeX,
  Workflow,
} from "lucide-react";
import { useLanguage } from "../../LanguageContext";

// Same-origin by default: in this repo the faqarati UI is served by the same
// nginx that proxies the clinical API, so relative /api/* is correct. The env
// override exists for standalone dev against a remote backend.
const CLINICAL_API: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_CLINICAL_API_URL?.trim() || "";

interface EvidenceItem {
  index: number;
  chunk_id: string;
  document_title: string;
  organization: string;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  excerpt: string;
  source_url: string | null;
  scores?: { dense?: number | null; bm25?: number | null; rrf?: number | null; rerank?: number | null };
  selected?: boolean;
}

interface Statement {
  id: number;
  text: string;
  citations: number[];
}

interface TraceStage {
  name: string;
  latency_ms: number;
}

interface ClinicalResponse {
  status: "success" | "refusal";
  domains: string[];
  assessment?: { statements: Statement[] };
  refusal?: { reason: string; message: string };
  recommended_action?: { type: string; message: string };
  evidence: EvidenceItem[];
  trace?: { stages: TraceStage[] } | null;
  meta?: { latency_ms?: number };
}

interface PatientProfile {
  age: string;
  sex: "" | "female" | "male";
  conditions: string;
  medications: string;
  allergies: string;
}

const EMPTY_PROFILE: PatientProfile = { age: "", sex: "", conditions: "", medications: "", allergies: "" };
const PROFILE_KEY = "faqarati_clinical_profile";

// Verified example prompts — each was run against the deployed pipeline
// (2026-08-19) and returned a grounded SUFFICIENT/PARTIAL answer in the
// question's own language, citing the WHO physio corpus (LBP guideline /
// Rehab MSK module). Don't add examples here without live-verifying them
// first: an example that refuses is worse than no example.
const EXAMPLE_PROMPTS: Array<{ ar: string; en: string }> = [
  {
    ar: "ظهري يؤلمني ماذا افعل؟",
    en: "My back hurts, what should I do?",
  },
  {
    ar: "هل التمارين مفيدة لألم أسفل الظهر المزمن وما نوعها؟",
    en: "Is exercise recommended for chronic low back pain and what kind?",
  },
  {
    ar: "ما الذي تتضمنه إعادة التأهيل بعد كسر في العظام؟",
    en: "What does rehabilitation involve after a bone fracture?",
  },
  {
    ar: "كيف يساعد العلاج الطبيعي في خشونة الركبة؟",
    en: "How can physiotherapy help with knee osteoarthritis?",
  },
];

function loadProfile(): PatientProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? { ...EMPTY_PROFILE, ...(JSON.parse(raw) as PatientProfile) } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

/** Browser TTS read-aloud. Arabic answers get an Arabic voice by script
 *  detection; zero backend cost. speechSynthesis is a singleton, so starting
 *  a new utterance cancels the previous one. */
function speak(text: string, onEnd: () => void) {
  if (typeof speechSynthesis === "undefined") return onEnd();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const arabicChars = [...text].filter((c) => c.charCodeAt(0) >= 0x0600 && c.charCodeAt(0) <= 0x06ff).length;
  utterance.lang = arabicChars > text.length * 0.2 ? "ar" : "en-US";
  const voices = speechSynthesis.getVoices();
  const match = voices.find((v) => v.lang.toLowerCase().startsWith(utterance.lang.toLowerCase()));
  if (match) utterance.voice = match;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  speechSynthesis.speak(utterance);
}

interface ChatTurn {
  question: string;
  response?: ClinicalResponse;
  error?: string;
}

interface CareFacility {
  id: string;
  name_ar: string;
  name_en: string;
  city: string;
  specialties: string[];
  maps_url: string;
}

interface CareHotline {
  id: string;
  name_ar: string;
  name_en: string;
  phone: string;
}

/** Working call-to-action row: national hotlines (tel:), geolocated nearby-
 *  hospitals maps search, and a lazy-loaded facility directory served by the
 *  clinical API (/api/care-directory, curated in data/care_directory.json). */
function CareActions() {
  const { t, lang } = useLanguage();
  const [directory, setDirectory] = useState<{ hotlines: CareHotline[]; facilities: CareFacility[] } | null>(null);
  const [open, setOpen] = useState(false);

  const openNearby = () => {
    const fallback = () =>
      window.open("https://www.google.com/maps/search/?api=1&query=hospital+near+me", "_blank", "noopener,noreferrer");
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        window.open(`https://www.google.com/maps/search/hospital/@${latitude},${longitude},14z`, "_blank", "noopener,noreferrer");
      },
      fallback,
      { timeout: 5000 },
    );
  };

  const loadDirectory = async () => {
    setOpen((value) => !value);
    if (directory) return;
    try {
      const res = await fetch(`${CLINICAL_API}/api/care-directory`);
      if (res.ok) setDirectory(await res.json());
    } catch {
      /* the buttons above still work without the directory */
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="tel:123"
          className="text-xs font-bold bg-red-600 text-white rounded-full px-3 py-1.5 hover:bg-red-700 transition"
        >
          {t("اتصل بالإسعاف 123", "Call ambulance 123")}
        </a>
        <a
          href="tel:105"
          className="text-xs font-bold bg-clinical-600 text-white rounded-full px-3 py-1.5 hover:bg-clinical-700 transition"
        >
          {t("الخط الساخن للصحة 105", "Health hotline 105")}
        </a>
        <button
          type="button"
          onClick={openNearby}
          className="text-xs font-bold border border-brand-400 text-brand-700 rounded-full px-3 py-1.5 hover:bg-brand-50 transition cursor-pointer"
        >
          {t("مستشفيات قريبة مني", "Hospitals near me")}
        </button>
        <button
          type="button"
          onClick={() => void loadDirectory()}
          className="text-xs font-bold border border-slate-300 text-slate-500 rounded-full px-3 py-1.5 hover:bg-slate-50 transition cursor-pointer"
        >
          {t("دليل المنشآت الصحية", "Care directory")}
        </button>
      </div>
      {open && directory && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {directory.facilities.map((facility) => (
            <a
              key={facility.id}
              href={facility.maps_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 hover:border-brand-300 transition"
            >
              <span className="font-bold text-slate-600">{lang === "ar" ? facility.name_ar : facility.name_en}</span>
              <span className="text-slate-400 shrink-0">{facility.city}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClinicalAssistantProps {
  /** Doctor view: fill the available height, conversation flexes, composer pinned. */
  fullScreen?: boolean;
}

export default function PTClinicalAssistantTab({ fullScreen = false }: ClinicalAssistantProps) {
  const { t, isRtl } = useLanguage();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceError, setVoiceError] = useState("");
  // Live preview while speaking: every 3s timeslice re-transcribes the
  // accumulated audio (Groq has no streaming STT endpoint, so progressive
  // re-transcription of the growing buffer is the real-time equivalent —
  // each pass REPLACES the preview, it never appends).
  const [livePreview, setLivePreview] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const [speakingTurn, setSpeakingTurn] = useState<number | null>(null);
  const [profile, setProfile] = useState<PatientProfile>(loadProfile);
  const [profileOpen, setProfileOpen] = useState(false);

  // Scrollable history: keep the newest exchange in view as turns arrive.
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, isLoading]);

  const saveProfile = (next: PatientProfile) => {
    setProfile(next);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — profile just won't persist */
    }
  };

  const patientContext = () => {
    const list = (value: string) => value.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
    const context: Record<string, unknown> = {};
    const age = parseInt(profile.age, 10);
    if (!Number.isNaN(age)) context.age = age;
    if (profile.sex) context.sex = profile.sex;
    if (profile.conditions.trim()) context.known_conditions = list(profile.conditions);
    if (profile.medications.trim()) context.medications = list(profile.medications);
    if (profile.allergies.trim()) context.allergies = list(profile.allergies);
    return Object.keys(context).length ? context : undefined;
  };

  const toggleSpeak = (turnIndex: number, response: ClinicalResponse) => {
    if (speakingTurn === turnIndex) {
      speechSynthesis.cancel();
      setSpeakingTurn(null);
      return;
    }
    const text =
      response.status === "refusal"
        ? response.refusal?.message ?? ""
        : (response.assessment?.statements ?? []).map((statement) => statement.text).join(" ");
    if (!text) return;
    setSpeakingTurn(turnIndex);
    speak(text, () => setSpeakingTurn(null));
  };

  const transcribeBlob = useCallback(async (audio: Blob, signal?: AbortSignal): Promise<string> => {
    const res = await fetch(`${CLINICAL_API}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": (audio.type || "audio/webm").split(";")[0] },
      body: audio,
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { text?: string };
    return (payload.text ?? "").trim();
  }, []);

  const askQuestion = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || isLoading) return;
    setDraft("");
    setIsLoading(true);
    setTurns((prev) => [...prev, { question }]);
    try {
      const res = await fetch(`${CLINICAL_API}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          patient_context: patientContext(),
          options: { include_trace: true },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as ClinicalResponse;
      setTurns((prev) => prev.map((turn, i) => (i === prev.length - 1 ? { ...turn, response: payload } : turn)));
    } catch {
      setTurns((prev) =>
        prev.map((turn, i) =>
          i === prev.length - 1
            ? { ...turn, error: t("تعذر الوصول إلى الخدمة السريرية. حاول مرة أخرى.", "Could not reach the clinical service. Try again.") }
            : turn,
        ),
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, t]);

  const ask = useCallback(() => askQuestion(draft), [askQuestion, draft]);

  const toggleVoice = useCallback(async () => {
    setVoiceError("");
    if (voiceState === "recording") {
      recorderRef.current?.stop();
      return;
    }
    if (voiceState !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError(t("المتصفح لا يدعم الإدخال الصوتي.", "Voice input is not supported in this browser."));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      let stopping = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
        // Progressive preview: transcribe everything captured so far. The
        // previous in-flight preview is aborted — only the newest matters,
        // and letting them race would show older text over newer.
        if (stopping || chunksRef.current.length === 0) return;
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (audio.size < 2048) return;
        previewAbortRef.current?.abort();
        const controller = new AbortController();
        previewAbortRef.current = controller;
        transcribeBlob(audio, controller.signal)
          .then((text) => {
            if (!controller.signal.aborted && text) setLivePreview(text);
          })
          .catch(() => {});
      };
      recorder.onstop = async () => {
        stopping = true;
        previewAbortRef.current?.abort();
        stream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (audio.size < 1024) {
          setLivePreview("");
          setVoiceState("idle");
          return;
        }
        setVoiceState("transcribing");
        try {
          const text = await transcribeBlob(audio);
          if (text) setDraft((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        } catch {
          setVoiceError(t("فشل تحويل الصوت إلى نص.", "Transcription failed."));
        } finally {
          setLivePreview("");
          setVoiceState("idle");
          inputRef.current?.focus();
        }
      };
      recorder.start(3000); // timeslice: fires ondataavailable every 3s for the live preview
      recorderRef.current = recorder;
      setVoiceState("recording");
    } catch {
      setVoiceError(t("تم رفض الوصول إلى الميكروفون.", "Microphone access was denied."));
      setVoiceState("idle");
    }
  }, [voiceState, t]);

  return (
    <div className={fullScreen ? "flex flex-col h-full gap-4" : "space-y-6"}>
      {/* Safety banner — this system refuses rather than guesses */}
      <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 flex items-start gap-3">
        <Stethoscope className="w-5 h-5 text-brand-700 mt-0.5 shrink-0" />
        <div className="text-sm text-brand-900">
          <p className="font-bold">{t("المساعد السريري المسند بالأدلة", "Evidence-Grounded Clinical Assistant")}</p>
          <p className="text-brand-800/80 mt-0.5">
            {t(
              "كل إجابة موثقة من إرشادات منظمة الصحة العالمية، وعند نقص الأدلة يرفض النظام الإجابة بدل التخمين. ليس بديلاً عن التقييم الطبي.",
              "Every answer cites WHO guideline text; with insufficient evidence the system refuses instead of guessing. Not a substitute for medical evaluation.",
            )}
          </p>
        </div>
      </div>

      {/* Patient profile — folded into every query as patient_context */}
      <div className="bg-white border border-slate-200 rounded-2xl">
        <button
          type="button"
          onClick={() => setProfileOpen((value) => !value)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-bold text-slate-600 cursor-pointer"
        >
          <UserRound className="w-4 h-4 text-brand-500" />
          {t("ملف المريض", "Patient profile")}
          {patientContext() ? (
            <span className="text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-200 rounded-full px-2 py-0.5">
              {t("مُفعل", "active")}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400">{t("(اختياري — يحسّن دقة الإجابات)", "(optional — improves answer accuracy)")}</span>
          )}
          <ChevronDown className={`w-4 h-4 ms-auto transition ${profileOpen ? "rotate-180" : ""}`} />
        </button>
        {profileOpen && (
          <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-slate-500">
              {t("العمر", "Age")}
              <input
                type="number" min={0} max={120} value={profile.age}
                onChange={(event) => saveProfile({ ...profile, age: event.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal focus:outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t("الجنس", "Sex")}
              <select
                value={profile.sex}
                onChange={(event) => saveProfile({ ...profile, sex: event.target.value as PatientProfile["sex"] })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal focus:outline-none focus:border-brand-400 bg-white"
              >
                <option value="">{t("غير محدد", "Unspecified")}</option>
                <option value="female">{t("أنثى", "Female")}</option>
                <option value="male">{t("ذكر", "Male")}</option>
              </select>
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t("الحالات المزمنة (مفصولة بفواصل)", "Conditions (comma-separated)")}
              <input
                value={profile.conditions}
                onChange={(event) => saveProfile({ ...profile, conditions: event.target.value })}
                placeholder={t("سكري، ضغط…", "diabetes, hypertension…")}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal focus:outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-bold text-slate-500">
              {t("الأدوية الحالية", "Current medications")}
              <input
                value={profile.medications}
                onChange={(event) => saveProfile({ ...profile, medications: event.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal focus:outline-none focus:border-brand-400"
              />
            </label>
            <label className="text-xs font-bold text-slate-500 sm:col-span-2">
              {t("الحساسية", "Allergies")}
              <input
                value={profile.allergies}
                onChange={(event) => saveProfile({ ...profile, allergies: event.target.value })}
                placeholder={t("بنسلين…", "penicillin…")}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal focus:outline-none focus:border-brand-400"
              />
            </label>
          </div>
        )}
      </div>

      {/* Knowledge-tier badge — this assistant is TIER 1 of the two-tier
          knowledge system: public, evidence-grounded general guidance from
          the WHO corpus. Tier 2 (the 8,043-node FitKG specialist graph)
          lives in the doctor portal's Einstein planner. */}
      <div className="flex items-center gap-2 rounded-xl bg-brand-50 border border-brand-100 px-3 py-1.5 text-[11px] font-semibold text-brand-700">
        <span className="rounded-md bg-brand-600 text-white px-1.5 py-0.5 text-[10px] font-black">{t("المستوى ١", "TIER 1")}</span>
        <span>
          {t(
            "إرشادات عامة موثقة للجمهور — ٩ مراجع WHO/USPSTF · 8,542 مقطع دليل · عربي/EN/FR",
            "Public evidence-grounded guidance — 9 WHO/USPSTF guidelines · 8,542 evidence chunks · AR/EN/FR",
          )}
        </span>
      </div>

      {/* Conversation — scrollable history, pinned to the newest turn */}
      <div className={`space-y-5 overflow-y-auto pe-1 ${fullScreen ? "flex-1 min-h-0" : "max-h-[62vh]"}`}>
        {turns.length === 0 && (
          <div className="text-center py-10 text-slate-400">
            <BookOpenCheck className="w-10 h-10 mx-auto mb-3 text-brand-300" />
            <p className="font-bold text-slate-500">{t("اسأل سؤالاً سريرياً", "Ask a clinical question")}</p>
            <p className="text-xs mt-1 mb-4">
              {t("جرّب أحد الأمثلة — كل سؤال مُجرَّب ويُجيب من إرشادات منظمة الصحة العالمية", "Try an example — each one is verified to answer from WHO guidelines")}
            </p>
            {/* Verified example prompts: every question below was tested
                against the live pipeline and returns a grounded, correctly-
                languaged answer. Click = send, in the current UI language. */}
            <div className="flex flex-wrap justify-center gap-2 px-4">
              {EXAMPLE_PROMPTS.map((p) => {
                const q = t(p.ar, p.en);
                return (
                  <button
                    key={p.en}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void askQuestion(q)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-100 disabled:opacity-50"
                  >
                    {q}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-3">
            {/* Doctor's question bubble */}
            <div className={`flex ${isRtl ? "justify-start" : "justify-end"}`}>
              <div className="bg-clinical-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[80%] text-sm font-medium shadow-sm">
                {turn.question}
              </div>
            </div>

            {/* Assistant response */}
            {turn.error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 text-sm">{turn.error}</div>
            )}
            {!turn.response && !turn.error && (
              <div className="flex items-center gap-2 text-slate-400 text-sm px-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("جاري البحث في الإرشادات السريرية…", "Searching clinical guidelines…")}
              </div>
            )}
            {turn.response && turn.response.status === "refusal" && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                  <ShieldAlert className="w-4 h-4" />
                  {turn.response.refusal?.reason === "OUT_OF_SCOPE"
                    ? t("غير متعلق بالمجال الطبي", "Not related to the medical field")
                    : t("رفض آمن — أدلة غير كافية", "Safe refusal — insufficient evidence")}
                  <button
                    type="button"
                    onClick={() => toggleSpeak(i, turn.response!)}
                    className="ms-auto text-amber-700 hover:text-amber-900 cursor-pointer"
                    title={t("قراءة بصوت عالٍ", "Read aloud")}
                  >
                    {speakingTurn === i ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-sm text-amber-900/80 mt-2">{turn.response.refusal?.message}</p>
              </div>
            )}
            {turn.response && turn.response.status === "success" && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex justify-end -mb-1">
                  <button
                    type="button"
                    onClick={() => toggleSpeak(i, turn.response!)}
                    className="text-brand-500 hover:text-brand-700 cursor-pointer"
                    title={t("قراءة بصوت عالٍ", "Read aloud")}
                  >
                    {speakingTurn === i ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
                {turn.response.assessment?.statements.map((statement) => (
                  <p key={statement.id} className="text-sm text-slate-700 leading-relaxed">
                    {statement.text}
                    {statement.citations.map((citation) => (
                      <sup key={citation} className="text-brand-600 font-bold mx-0.5">[{citation}]</sup>
                    ))}
                  </p>
                ))}
                {turn.response.recommended_action?.message && (
                  <div className="bg-clinical-50 border border-clinical-500/20 rounded-xl px-3 py-2 text-xs text-clinical-900">
                    <span className="font-bold">{t("التوصية: ", "Recommendation: ")}</span>
                    {turn.response.recommended_action.message}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {turn.response.domains.map((domain) => (
                    <span key={domain} className="text-[10px] font-bold uppercase tracking-wide bg-brand-50 text-brand-700 border border-brand-200 rounded-full px-2 py-0.5">
                      {domain}
                    </span>
                  ))}
                  {turn.response.meta?.latency_ms ? (
                    <span className="text-[10px] font-mono text-slate-400 ms-auto">
                      {(turn.response.meta.latency_ms / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
              </div>
            )}

            {/* Evidence + trace, collapsible */}
            {turn.response && turn.response.evidence.length > 0 && (
              <details className="group border border-slate-200 rounded-2xl bg-slate-50/60">
                <summary className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-500 cursor-pointer select-none">
                  <BookOpenCheck className="w-4 h-4 text-brand-500" />
                  {t(`الأدلة المسترجعة (${turn.response.evidence.length})`, `Retrieved evidence (${turn.response.evidence.length})`)}
                  <ChevronDown className="w-4 h-4 ms-auto transition group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-4 space-y-3">
                  {turn.response.evidence.map((item) => (
                    <div key={item.chunk_id} className="bg-white border border-slate-200 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700">
                          <span className="text-brand-600">[{item.index}]</span> {item.document_title}
                        </p>
                        {item.source_url && (
                          <a href={item.source_url} target="_blank" rel="noreferrer" className="text-brand-500 hover:text-brand-700 shrink-0">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5" dir="ltr">
                        {item.section_path || "—"} · {t("صفحة", "p.")} {item.page_start}
                        {item.scores?.rerank != null ? ` · rerank ${item.scores.rerank.toFixed(2)}` : ""}
                      </p>
                      <p className="text-xs text-slate-600 mt-1.5 leading-relaxed line-clamp-4" dir="ltr">
                        {item.excerpt}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {turn.response && <CareActions />}
            {turn.response?.trace?.stages?.length ? (
              <details className="group border border-slate-200 rounded-2xl bg-slate-50/60">
                <summary className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-500 cursor-pointer select-none">
                  <Workflow className="w-4 h-4 text-clinical-500" />
                  {t("خط المعالجة", "Decision pipeline")}
                  <ChevronDown className="w-4 h-4 ms-auto transition group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-4 flex flex-wrap gap-1.5" dir="ltr">
                  {turn.response.trace.stages.map((stage, stageIndex) => (
                    <span key={stageIndex} className="text-[10px] font-mono bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-500">
                      {stage.name} {(stage.latency_ms / 1000).toFixed(1)}s
                    </span>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ))}
        <div ref={historyEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm sticky bottom-4"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={t("صف الأعراض أو اسأل عن إرشادات العلاج…", "Describe symptoms or ask about treatment guidance…")}
          className="w-full resize-none bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          disabled={isLoading}
        />
        {(voiceState === "recording" || livePreview) && (
          <div className="flex items-start gap-2 px-1 pb-2 text-xs text-brand-700">
            <span className="mt-1 w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="italic leading-relaxed">
              {livePreview || t("جاري الاستماع…", "Listening…")}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span className="text-[10px] text-slate-400 font-mono">
            {draft.length}/2000 {voiceState === "transcribing" ? t("· جاري التحويل…", "· transcribing…") : ""}
            {voiceError ? <span className="text-red-500 ms-2">{voiceError}</span> : null}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleVoice()}
              disabled={isLoading || voiceState === "transcribing"}
              title={t("إملاء صوتي (عربي أو إنجليزي)", "Dictate (Arabic or English)")}
              className={`w-9 h-9 grid place-items-center rounded-full border transition cursor-pointer disabled:opacity-40 ${
                voiceState === "recording"
                  ? "bg-red-500 border-red-500 text-white animate-pulse"
                  : "border-brand-400 text-brand-600 hover:bg-brand-50"
              }`}
            >
              {voiceState === "recording" ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              type="submit"
              disabled={isLoading || !draft.trim()}
              className="w-9 h-9 grid place-items-center rounded-full bg-brand-600 text-white hover:bg-brand-700 transition cursor-pointer disabled:opacity-40"
              title={t("إرسال", "Send")}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
