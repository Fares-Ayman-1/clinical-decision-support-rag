/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Clinical Assistant PRO — the physiotherapist's console for the
 * evidence-grounded clinical RAG. Redesigned for the doctor: a two-pane
 * layout (conversation + live evidence inspector), a polished light theme
 * with a true end-to-end dark mode toggle, and a demo cache — the example
 * chips render pre-captured full LLM answers (statements, citations,
 * evidence, trace) instantly, so the demo survives a slow or dead backend.
 * Flip "Live" to force real pipeline calls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Activity,
  BookOpenCheck,
  FileSearch,
  Loader2,
  Mic,
  MicOff,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Sun,
  UserRound,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../LanguageContext";

const CLINICAL_API: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_CLINICAL_API_URL?.trim() || "";
const THEME_KEY = "faqarati_pro_theme";
const PROFILE_KEY = "faqarati_clinical_profile";

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
  output?: Record<string, unknown>;
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

interface Turn {
  question: string;
  response?: ClinicalResponse;
  error?: string;
  cached?: boolean;
  wallMs?: number;
}

const EMPTY_PROFILE: PatientProfile = { age: "", sex: "", conditions: "", medications: "", allergies: "" };

// The chips below match keys in /demo_answers.json — full pre-captured
// pipeline responses (2026-08-20). In cached mode a click renders the real
// LLM answer with references instantly.
const EXAMPLES: Array<{ ar: string; en: string }> = [
  { ar: "ظهري يؤلمني ماذا افعل؟", en: "My back hurts, what should I do?" },
  { ar: "هل التمارين مفيدة لألم أسفل الظهر المزمن وما نوعها؟", en: "Is exercise recommended for chronic low back pain and what kind?" },
  { ar: "ما الذي تتضمنه إعادة التأهيل بعد كسر في العظام؟", en: "What does rehabilitation involve after a bone fracture?" },
  { ar: "كيف يساعد العلاج الطبيعي في خشونة الركبة؟", en: "How can physiotherapy help with knee osteoarthritis?" },
];
const EXAMPLE_FR = "J'ai mal au dos, que dois-je faire ?";

function loadProfile(): PatientProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? { ...EMPTY_PROFILE, ...(JSON.parse(raw) as PatientProfile) } : EMPTY_PROFILE;
  } catch {
    return EMPTY_PROFILE;
  }
}

function speak(text: string, onEnd: () => void) {
  if (typeof speechSynthesis === "undefined") return onEnd();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const arabic = [...text].filter((c) => c.charCodeAt(0) >= 0x0600 && c.charCodeAt(0) <= 0x06ff).length;
  u.lang = arabic > text.length * 0.2 ? "ar" : "en-US";
  const match = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.toLowerCase()));
  if (match) u.voice = match;
  u.onend = onEnd;
  u.onerror = onEnd;
  speechSynthesis.speak(u);
}

const STAGE_LABELS: Record<string, [string, string]> = {
  red_flag_check: ["فحص علامات الخطر", "Red-flag check"],
  extraction: ["استخلاص الأعراض", "Symptom extraction"],
  domain_predict: ["تصنيف المجال", "Domain classification"],
  query_rewrite: ["إعادة صياغة طبية", "Clinical query rewrite"],
  retrieval: ["الاسترجاع الهجين", "Hybrid retrieval"],
  candidate_filter: ["تنقية المرشحين", "Candidate filter"],
  rerank: ["إعادة الترتيب", "Cross-encoder rerank"],
  sufficiency: ["بوابة كفاية الأدلة", "Sufficiency gate"],
  generation: ["التوليد المسند", "Grounded generation"],
  validation: ["التحقق من الاستشهادات", "Citation validation"],
  dose_scan: ["فحص الجرعات", "Dose scan"],
  risk: ["تقييم الخطورة", "Risk engine"],
  decision: ["محرك القرار", "Decision engine"],
  prescribing_check: ["فحص طلب وصفة", "Prescribing check"],
};

export default function PTClinicalAssistantPro() {
  const { t, isRtl } = useLanguage();

  const [dk, setDk] = useState<boolean>(() => {
    try {
      const s = localStorage.getItem(THEME_KEY);
      if (s) return s === "dark";
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    } catch {
      return false;
    }
  });
  const toggleTheme = () => {
    setDk((v) => {
      try {
        localStorage.setItem(THEME_KEY, !v ? "dark" : "light");
      } catch {
        /* private mode */
      }
      return !v;
    });
  };

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [selected, setSelected] = useState<number>(-1);
  const [demoCache, setDemoCache] = useState<Record<string, ClinicalResponse> | null>(null);
  const [profile, setProfile] = useState<PatientProfile>(loadProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [speakingTurn, setSpeakingTurn] = useState<number | null>(null);
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [livePreview, setLivePreview] = useState("");
  const [voiceError, setVoiceError] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/demo_answers.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDemoCache(d))
      .catch(() => setDemoCache(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, isLoading]);

  const saveProfile = (p: PatientProfile) => {
    setProfile(p);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };

  const patientContext = useCallback(() => {
    const ctx: Record<string, unknown> = {};
    if (profile.age.trim()) ctx.age = Number(profile.age);
    if (profile.sex) ctx.sex = profile.sex;
    const list = (s: string) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
    if (profile.conditions.trim()) ctx.known_conditions = list(profile.conditions);
    if (profile.medications.trim()) ctx.medications = list(profile.medications);
    if (profile.allergies.trim()) ctx.allergies = list(profile.allergies);
    return Object.keys(ctx).length ? ctx : undefined;
  }, [profile]);

  const askQuestion = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || isLoading) return;
      setDraft("");
      const cachedHit = !liveMode && demoCache && demoCache[question];
      setTurns((prev) => {
        setSelected(prev.length);
        return [...prev, { question }];
      });
      if (cachedHit) {
        // Instant demo path: the pre-captured full pipeline response.
        setTurns((prev) =>
          prev.map((turn, i) => (i === prev.length - 1 ? { ...turn, response: cachedHit, cached: true } : turn)),
        );
        return;
      }
      setIsLoading(true);
      const t0 = performance.now();
      try {
        const res = await fetch(`${CLINICAL_API}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, patient_context: patientContext(), options: { include_trace: true } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as ClinicalResponse;
        setTurns((prev) =>
          prev.map((turn, i) =>
            i === prev.length - 1 ? { ...turn, response: payload, wallMs: performance.now() - t0 } : turn,
          ),
        );
      } catch {
        setTurns((prev) =>
          prev.map((turn, i) =>
            i === prev.length - 1
              ? { ...turn, error: t("تعذر الوصول للخدمة. جرّب وضع العرض السريع (⚡).", "Service unreachable. Try the instant demo chips (⚡).") }
              : turn,
          ),
        );
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, liveMode, demoCache, patientContext, t],
  );

  // ---- voice dictation with live preview --------------------------------
  const transcribe = useCallback(async (audio: Blob, signal?: AbortSignal): Promise<string> => {
    const res = await fetch(`${CLINICAL_API}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio,
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { text?: string };
    return (payload.text ?? "").trim();
  }, []);

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
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setLivePreview("");
      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
        if (recorder.state !== "recording") return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const text = await transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }), controller.signal);
          if (!controller.signal.aborted && text) setLivePreview(text);
        } catch {
          /* superseded or transient — final pass will settle it */
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setVoiceState("transcribing");
        abortRef.current?.abort();
        try {
          const text = await transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }));
          if (text) setDraft((d) => (d ? `${d} ${text}` : text));
        } catch {
          setVoiceError(t("تعذر تحويل الصوت لنص.", "Could not transcribe the audio."));
        } finally {
          setLivePreview("");
          setVoiceState("idle");
          inputRef.current?.focus();
        }
      };
      recorder.start(3000);
      setVoiceState("recording");
    } catch {
      setVoiceError(t("لم يُسمح بالوصول للميكروفون.", "Microphone access was denied."));
    }
  }, [voiceState, transcribe, t]);

  // ---- theme-conditional class helper ------------------------------------
  const c = (light: string, dark: string) => (dk ? dark : light);
  const selectedTurn = selected >= 0 && selected < turns.length ? turns[selected] : turns[turns.length - 1];
  const resp = selectedTurn?.response;

  const scoreChip = (label: string, v: number | null | undefined) =>
    v === null || v === undefined ? null : (
      <span key={label} className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold ${c("bg-slate-100 text-slate-600", "bg-slate-700 text-slate-300")}`}>
        {label} {typeof v === "number" ? v.toFixed(2) : v}
      </span>
    );

  return (
    <div className={`flex flex-col h-full rounded-3xl border overflow-hidden transition-colors ${c("bg-white border-slate-200", "bg-slate-950 border-slate-800")}`}>
      {/* ============================ header ============================ */}
      <div className={`flex items-center gap-3 px-4 sm:px-5 py-3 border-b flex-wrap ${c("bg-slate-50/80 border-slate-200", "bg-slate-900 border-slate-800")}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c("bg-brand-600 text-white", "bg-brand-500 text-slate-950")}`}>
          <Stethoscope className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className={`text-sm font-black truncate ${c("text-slate-900", "text-white")}`}>
            {t("المساعد السريري الموثق", "Evidence-Grounded Clinical Assistant")}
          </h3>
          <p className={`text-[10px] font-bold ${c("text-slate-400", "text-slate-500")}`}>
            {t("المستوى ١ · ٩ مراجع WHO · 8,542 مقطع دليل · عربي/EN/FR", "TIER 1 · 9 WHO guidelines · 8,542 evidence chunks · AR/EN/FR")}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLiveMode((v) => !v)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-black border transition-colors ${
              liveMode
                ? c("bg-emerald-50 text-emerald-700 border-emerald-200", "bg-emerald-900/40 text-emerald-300 border-emerald-800")
                : c("bg-amber-50 text-amber-700 border-amber-200", "bg-amber-900/30 text-amber-300 border-amber-800")
            }`}
            title={t("وضع مباشر: كل سؤال يمر بخط الأنابيب الحقيقي (~35 ثانية). وضع العرض: الأمثلة تعرض إجابات حقيقية محفوظة فوراً.", "Live: every question runs the real pipeline (~35s). Demo: example chips render pre-captured real answers instantly.")}
          >
            {liveMode ? <Activity className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
            {liveMode ? t("مباشر", "LIVE") : t("عرض سريع", "DEMO")}
          </button>
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className={`p-2 rounded-lg border transition-colors ${c("border-slate-200 text-slate-500 hover:bg-slate-100", "border-slate-700 text-slate-400 hover:bg-slate-800")}`}
            title={t("ملف المريض", "Patient profile")}
          >
            <UserRound className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className={`p-2 rounded-lg border transition-colors ${c("border-slate-200 text-slate-500 hover:bg-slate-100", "border-slate-700 text-amber-300 hover:bg-slate-800")}`}
            title={t("الوضع الداكن/الفاتح", "Toggle dark mode")}
          >
            {dk ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ======================= profile drawer ======================== */}
      {profileOpen && (
        <div className={`px-5 py-3 border-b grid grid-cols-2 sm:grid-cols-5 gap-3 ${c("bg-brand-50/50 border-slate-200", "bg-slate-900/70 border-slate-800")}`}>
          {(
            [
              ["age", t("العمر", "Age"), profile.age, "45"],
              ["conditions", t("حالات مزمنة", "Conditions"), profile.conditions, t("سكري…", "diabetes…")],
              ["medications", t("أدوية حالية", "Medications"), profile.medications, ""],
              ["allergies", t("حساسية", "Allergies"), profile.allergies, ""],
            ] as Array<[keyof PatientProfile, string, string, string]>
          ).map(([key, label, value, ph]) => (
            <label key={key} className={`text-[10px] font-bold ${c("text-slate-500", "text-slate-400")}`}>
              {label}
              <input
                value={value}
                onChange={(e) => saveProfile({ ...profile, [key]: e.target.value })}
                placeholder={ph}
                className={`mt-1 w-full rounded-lg px-2 py-1.5 text-xs font-normal border focus:outline-none ${c("bg-white border-slate-200 focus:border-brand-400 text-slate-800", "bg-slate-800 border-slate-700 focus:border-brand-500 text-slate-100")}`}
              />
            </label>
          ))}
          <label className={`text-[10px] font-bold ${c("text-slate-500", "text-slate-400")}`}>
            {t("الجنس", "Sex")}
            <select
              value={profile.sex}
              onChange={(e) => saveProfile({ ...profile, sex: e.target.value as PatientProfile["sex"] })}
              className={`mt-1 w-full rounded-lg px-2 py-1.5 text-xs border focus:outline-none ${c("bg-white border-slate-200 text-slate-800", "bg-slate-800 border-slate-700 text-slate-100")}`}
            >
              <option value="">—</option>
              <option value="female">{t("أنثى", "Female")}</option>
              <option value="male">{t("ذكر", "Male")}</option>
            </select>
          </label>
        </div>
      )}

      {/* =========================== body ============================== */}
      <div className="flex flex-1 min-h-0">
        {/* -------- conversation column -------- */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
            {turns.length === 0 && (
              <div className="text-center py-8">
                <BookOpenCheck className={`w-10 h-10 mx-auto mb-3 ${c("text-brand-300", "text-brand-600")}`} />
                <p className={`font-black ${c("text-slate-700", "text-slate-200")}`}>
                  {t("اسأل سؤالاً سريرياً — نصاً أو صوتاً", "Ask a clinical question — text or voice")}
                </p>
                <p className={`text-xs mt-1 mb-5 ${c("text-slate-400", "text-slate-500")}`}>
                  {t("⚡ الأمثلة أدناه تعرض إجابات حقيقية محفوظة فوراً — بمصادرها وأدلتها", "⚡ The chips below render pre-captured real answers instantly — with sources and evidence")}
                </p>
                <div className="flex flex-wrap justify-center gap-2 px-2">
                  {[...EXAMPLES.map((p) => t(p.ar, p.en)), EXAMPLE_FR].map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={isLoading}
                      onClick={() => void askQuestion(q)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${c(
                        "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100",
                        "border-brand-800 bg-brand-950/60 text-brand-300 hover:bg-brand-900/50",
                      )}`}
                    >
                      {!liveMode && demoCache && demoCache[q] ? <Zap className="w-3 h-3" /> : null}
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <div key={i} className="space-y-3" onClick={() => setSelected(i)}>
                <div className={`flex ${isRtl ? "justify-start" : "justify-end"}`}>
                  <div className={`rounded-2xl px-4 py-2.5 max-w-[85%] text-sm font-medium shadow-sm ${c("bg-clinical-600 text-white", "bg-clinical-500 text-white")}`}>
                    {turn.question}
                  </div>
                </div>

                {turn.error && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${c("bg-red-50 border-red-100 text-red-700", "bg-red-950/40 border-red-900 text-red-300")}`}>
                    {turn.error}
                  </div>
                )}

                {!turn.response && !turn.error && isLoading && i === turns.length - 1 && (
                  <div className={`flex items-center gap-2 text-xs font-bold ${c("text-slate-400", "text-slate-500")}`}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("خط الأنابيب يعمل: استخلاص ← استرجاع ← ترتيب ← توليد موثق…", "Pipeline running: extract → retrieve → rerank → grounded generation…")}
                  </div>
                )}

                {turn.response && (
                  <div className={`rounded-2xl border p-4 space-y-3 cursor-pointer transition-shadow ${selected === i ? "ring-2 ring-brand-400" : ""} ${c("bg-slate-50 border-slate-200", "bg-slate-900 border-slate-800")}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {turn.response.status === "success" ? (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md ${c("bg-emerald-100 text-emerald-700", "bg-emerald-900/50 text-emerald-300")}`}>
                          <ShieldCheck className="w-3 h-3" /> {t("إجابة موثقة", "GROUNDED")}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md ${c("bg-amber-100 text-amber-700", "bg-amber-900/50 text-amber-300")}`}>
                          <ShieldAlert className="w-3 h-3" /> {t("رفض آمن", "SAFE REFUSAL")}
                        </span>
                      )}
                      {turn.cached && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-md ${c("bg-amber-50 text-amber-600 border border-amber-200", "bg-amber-950/50 text-amber-300 border border-amber-900")}`}>
                          <Zap className="w-3 h-3" /> {t("إجابة محفوظة (عرض)", "CACHED DEMO ANSWER")}
                        </span>
                      )}
                      {turn.response.meta?.latency_ms ? (
                        <span className={`text-[10px] font-mono font-bold ${c("text-slate-400", "text-slate-500")}`}>
                          {(turn.response.meta.latency_ms / 1000).toFixed(1)}s
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (speakingTurn === i) {
                            speechSynthesis?.cancel();
                            setSpeakingTurn(null);
                          } else {
                            const text =
                              turn.response?.status === "success"
                                ? (turn.response.assessment?.statements || []).map((s) => s.text).join(". ")
                                : turn.response?.refusal?.message || "";
                            setSpeakingTurn(i);
                            speak(text, () => setSpeakingTurn(null));
                          }
                        }}
                        className={`ms-auto p-1.5 rounded-lg ${c("text-slate-400 hover:bg-slate-200", "text-slate-500 hover:bg-slate-800")}`}
                        title={t("قراءة صوتية", "Read aloud")}
                      >
                        {speakingTurn === i ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                    </div>

                    {turn.response.status === "success" ? (
                      <div className="space-y-2.5">
                        {(turn.response.assessment?.statements || []).map((s) => (
                          <p key={s.id} className={`text-sm leading-relaxed ${c("text-slate-800", "text-slate-100")}`}>
                            {s.text}
                            {s.citations.map((ci) => (
                              <sup key={ci} className={`ms-0.5 font-black text-[10px] ${c("text-brand-600", "text-brand-400")}`}>[{ci}]</sup>
                            ))}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-sm leading-relaxed ${c("text-slate-700", "text-slate-200")}`}>{turn.response.refusal?.message}</p>
                    )}

                    {turn.response.recommended_action?.message && (
                      <div className={`rounded-xl px-3 py-2 text-xs font-bold ${c("bg-brand-50 text-brand-800 border border-brand-100", "bg-brand-950/50 text-brand-200 border border-brand-900")}`}>
                        {t("التوصية:", "Recommendation:")} {turn.response.recommended_action.message}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <a href="tel:123" onClick={(e) => e.stopPropagation()} className={`rounded-lg px-2.5 py-1 text-[10px] font-black ${c("bg-red-600 text-white", "bg-red-500 text-white")}`}>
                        {t("الإسعاف 123", "Ambulance 123")}
                      </a>
                      <a href="tel:105" onClick={(e) => e.stopPropagation()} className={`rounded-lg px-2.5 py-1 text-[10px] font-black ${c("bg-slate-700 text-white", "bg-slate-600 text-white")}`}>
                        {t("الخط الصحي 105", "Health line 105")}
                      </a>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const open = (url: string) => window.open(url, "_blank", "noopener");
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(
                              (pos) => open(`https://www.google.com/maps/search/hospital/@${pos.coords.latitude},${pos.coords.longitude},14z`),
                              () => open("https://www.google.com/maps/search/hospital+near+me"),
                              { timeout: 4000 },
                            );
                          } else open("https://www.google.com/maps/search/hospital+near+me");
                        }}
                        className={`rounded-lg px-2.5 py-1 text-[10px] font-black ${c("bg-slate-200 text-slate-700", "bg-slate-700 text-slate-200")}`}
                      >
                        {t("مستشفيات قريبة", "Nearby hospitals")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* -------- composer -------- */}
          <div className={`border-t px-4 py-3 space-y-2 ${c("bg-white border-slate-200", "bg-slate-950 border-slate-800")}`}>
            {(voiceState !== "idle" || livePreview) && (
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${c("bg-brand-50 text-brand-800", "bg-brand-950/60 text-brand-200")}`}>
                {voiceState === "recording" ? <Mic className="w-3.5 h-3.5 animate-pulse text-red-500" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span className="truncate">
                  {livePreview || (voiceState === "recording" ? t("جارٍ الاستماع… تحدث الآن", "Listening… speak now") : t("جارٍ التحويل النهائي…", "Finalizing transcript…"))}
                </span>
              </div>
            )}
            {voiceError && <p className="text-[11px] font-bold text-red-500">{voiceError}</p>}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void toggleVoice()}
                className={`p-2.5 rounded-xl border transition-colors ${
                  voiceState === "recording"
                    ? "bg-red-500 border-red-500 text-white animate-pulse"
                    : c("border-slate-200 text-slate-500 hover:bg-slate-100", "border-slate-700 text-slate-400 hover:bg-slate-800")
                }`}
                title={t("إدخال صوتي", "Voice input")}
              >
                {voiceState === "recording" ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void askQuestion(draft);
                  }
                }}
                rows={1}
                placeholder={t("صف حالة المريض أو اسأل عن إرشادات العلاج…", "Describe the patient's case or ask about treatment guidance…")}
                className={`flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm border focus:outline-none ${c(
                  "bg-slate-50 border-slate-200 focus:border-brand-400 text-slate-900 placeholder:text-slate-400",
                  "bg-slate-900 border-slate-700 focus:border-brand-500 text-slate-100 placeholder:text-slate-500",
                )}`}
              />
              <button
                type="button"
                onClick={() => void askQuestion(draft)}
                disabled={isLoading || !draft.trim()}
                className={`p-2.5 rounded-xl font-black transition-colors disabled:opacity-40 ${c("bg-brand-600 text-white hover:bg-brand-700", "bg-brand-500 text-slate-950 hover:bg-brand-400")}`}
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* -------- evidence inspector rail (lg+) -------- */}
        <div className={`hidden lg:flex w-[340px] flex-shrink-0 border-s flex-col min-h-0 ${c("bg-slate-50 border-slate-200", "bg-slate-900 border-slate-800")}`}>
          <div className={`px-4 py-3 border-b flex items-center gap-2 ${c("border-slate-200", "border-slate-800")}`}>
            <FileSearch className={`w-4 h-4 ${c("text-brand-600", "text-brand-400")}`} />
            <span className={`text-xs font-black ${c("text-slate-700", "text-slate-200")}`}>{t("مفتش الأدلة وخط الأنابيب", "Evidence & Pipeline Inspector")}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {!resp && (
              <p className={`text-xs ${c("text-slate-400", "text-slate-500")}`}>
                {t("اسأل سؤالاً وسيظهر هنا كل دليل تم استرجاعه بدرجاته، وكل مرحلة من مراحل خط الأنابيب بزمنها.", "Ask a question and every retrieved evidence chunk with its scores — and every pipeline stage with its latency — appears here.")}
              </p>
            )}
            {resp && (
              <>
                <div>
                  <h4 className={`text-[10px] font-black uppercase mb-2 ${c("text-slate-400", "text-slate-500")}`}>
                    {t("الأدلة المسترجعة", "Retrieved evidence")} ({resp.evidence?.length || 0})
                  </h4>
                  <div className="space-y-2">
                    {(resp.evidence || []).map((ev) => (
                      <div key={ev.index} className={`rounded-xl border p-2.5 ${ev.selected ? c("bg-white border-brand-200", "bg-slate-800 border-brand-800") : c("bg-slate-100/60 border-slate-200 opacity-70", "bg-slate-900 border-slate-800 opacity-60")}`}>
                        <div className={`text-[11px] font-bold leading-snug ${c("text-slate-800", "text-slate-100")}`}>
                          [{ev.index}] {ev.document_title}
                        </div>
                        <div className={`text-[10px] mt-0.5 ${c("text-slate-500", "text-slate-400")}`}>
                          {ev.section_path || "—"} · {t("ص", "p.")} {ev.page_start}
                          {ev.page_end && ev.page_end !== ev.page_start ? `–${ev.page_end}` : ""}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {scoreChip("dense", ev.scores?.dense)}
                          {scoreChip("bm25", ev.scores?.bm25)}
                          {scoreChip("rrf", ev.scores?.rrf)}
                          {scoreChip("rerank", ev.scores?.rerank)}
                          {ev.selected ? (
                            <span className={`px-1 py-0.5 rounded text-[9px] font-black ${c("bg-emerald-100 text-emerald-700", "bg-emerald-900/60 text-emerald-300")}`}>✓ {t("مُستخدم", "used")}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {resp.trace?.stages?.length ? (
                  <div>
                    <h4 className={`text-[10px] font-black uppercase mb-2 ${c("text-slate-400", "text-slate-500")}`}>
                      {t("مراحل خط الأنابيب", "Pipeline stages")}
                    </h4>
                    <div className="space-y-1.5">
                      {resp.trace.stages.map((st, idx) => {
                        const max = Math.max(...resp.trace!.stages.map((x) => x.latency_ms || 0), 1);
                        const label = STAGE_LABELS[st.name] ? t(STAGE_LABELS[st.name][0], STAGE_LABELS[st.name][1]) : st.name;
                        return (
                          <div key={idx}>
                            <div className="flex justify-between text-[10px] font-bold">
                              <span className={c("text-slate-600", "text-slate-300")}>{label}</span>
                              <span className={`font-mono ${c("text-slate-400", "text-slate-500")}`}>{((st.latency_ms || 0) / 1000).toFixed(1)}s</span>
                            </div>
                            <div className={`h-1.5 rounded-full overflow-hidden ${c("bg-slate-200", "bg-slate-800")}`}>
                              <div className={c("bg-brand-500 h-full", "bg-brand-400 h-full")} style={{ width: `${Math.max(3, ((st.latency_ms || 0) / max) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
