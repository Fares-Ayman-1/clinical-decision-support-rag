/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin Pipeline Console — the end-to-end breakdown of every query through
 * the clinical RAG pipeline, mirroring the original clinical workspace's
 * trace panel: stage-by-stage latencies and outputs, the full retrieval
 * table (dense / BM25 / RRF / rerank scores, selected vs discarded),
 * sufficiency-gate internals (state, top score, effective taus,
 * cross-lingual margin), safety scans, and the raw JSON. Demo chips render
 * pre-captured full responses instantly so the console works even with a
 * cold or unreachable backend.
 */

import { useEffect, useState } from "react";
import { Activity, Loader2, Play, ShieldAlert, ShieldCheck, Zap } from "lucide-react";
import { useLanguage } from "../../LanguageContext";

const CLINICAL_API: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_CLINICAL_API_URL?.trim() || "";

interface TraceStage {
  name: string;
  latency_ms: number;
  output?: Record<string, unknown>;
}

interface EvidenceRow {
  index: number;
  chunk_id: string;
  document_title: string;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  selected?: boolean;
  scores?: { dense?: number | null; bm25?: number | null; rrf?: number | null; rerank?: number | null };
}

interface PipelineResponse {
  status: "success" | "refusal";
  domains: string[];
  assessment?: { statements: Array<{ id: number; text: string; citations: number[] }> };
  refusal?: { reason: string; message: string };
  evidence: EvidenceRow[];
  safety?: Record<string, unknown>;
  trace?: { stages: TraceStage[] } | null;
  meta?: { latency_ms?: number; embedding_version?: string; kb_version?: string };
  [k: string]: unknown;
}

const STAGE_INFO: Record<string, { ar: string; en: string; describe: (o: Record<string, unknown>) => string }> = {
  red_flag_check: { ar: "فحص علامات الخطر", en: "Red-flag precheck", describe: (o) => `triggered: ${o.triggered} · floor: ${o.urgency_floor ?? "—"}` },
  prescribing_check: { ar: "فحص طلب وصفة", en: "Prescribing check", describe: (o) => `detected: ${o.prescription_request_detected}` },
  extraction: { ar: "استخلاص الأعراض", en: "Symptom extraction", describe: (o) => `symptoms: ${JSON.stringify(o.symptoms ?? []).slice(0, 60)}` },
  domain_predict: { ar: "تصنيف المجال", en: "Domain classification", describe: (o) => `domains: ${JSON.stringify(o.domains ?? [])}` },
  query_rewrite: { ar: "إعادة الصياغة الطبية", en: "Clinical query rewrite", describe: (o) => `variants: ${(o.variants as unknown[] | undefined)?.length ?? 0} (all English — translation is rewriting)` },
  retrieval: { ar: "الاسترجاع الهجين", en: "Hybrid retrieval (dense + BM25 → RRF)", describe: (o) => `candidates: ${o.candidates} · variants used: ${o.query_variants_used} · dedup: ${o.suppressed_duplicates}` },
  candidate_filter: { ar: "تنقية المرشحين", en: "Front-matter filter", describe: (o) => `front-matter dropped: ${o.front_matter_dropped}` },
  rerank: { ar: "إعادة الترتيب بالمشفر المتقاطع", en: "Cross-encoder rerank (mmarco)", describe: (o) => `used: ${o.rerank_used} · variants scored: ${o.variants_scored ?? 1} · via rewrite: ${o.reranked_against_rewrite ?? false}` },
  sufficiency: { ar: "بوابة كفاية الأدلة", en: "Sufficiency gate", describe: (o) => `state: ${o.state} · top: ${Number(o.top_score).toFixed(2)} · τ_low(eff): ${o.tau_low} · x-lingual margin: ${o.cross_lingual_margin_applied ?? false}` },
  generation: { ar: "التوليد المسند", en: "Grounded generation", describe: (o) => `statements: ${o.statements} · insufficient: ${o.insufficient_evidence ?? false}` },
  validation: { ar: "التحقق من الاستشهادات", en: "Citation validation (programmatic)", describe: (o) => `kept: ${o.statements_kept} · dropped: ${o.dropped} · excerpts: ${o.excerpts_kept}` },
  dose_scan: { ar: "فحص أنماط الجرعات", en: "Dose-pattern scan (SAF-7.2)", describe: (o) => `blocked: ${o.blocked} · matches: ${(o.matches as unknown[] | undefined)?.length ?? 0}` },
  risk: { ar: "محرك الخطورة", en: "Risk engine", describe: (o) => `urgency: ${o.urgency} · floor applied: ${o.floor_applied ?? false}` },
  decision: { ar: "محرك القرار", en: "Decision engine", describe: (o) => `emergency: ${o.recommend_emergency_care} · follow-up: ${o.show_followup_question}` },
};

const SAMPLES = [
  "ظهري يؤلمني ماذا افعل؟",
  "My back hurts, what should I do?",
  "J'ai mal au dos, que dois-je faire ?",
];

export default function AdminPipelineConsole() {
  const { t, isRtl } = useLanguage();
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [cached, setCached] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [demoCache, setDemoCache] = useState<Record<string, PipelineResponse> | null>(null);

  useEffect(() => {
    fetch("/demo_answers.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDemoCache(d))
      .catch(() => setDemoCache(null));
  }, []);

  const run = async (q: string) => {
    const question = q.trim();
    if (!question || running) return;
    setError("");
    setQuery(question);
    const hit = !liveMode && demoCache?.[question];
    if (hit) {
      setResult(hit);
      setCached(true);
      return;
    }
    setRunning(true);
    setCached(false);
    try {
      const res = await fetch(`${CLINICAL_API}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, options: { include_trace: true } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as PipelineResponse);
    } catch (e) {
      setError(t("تعذر الوصول لخط الأنابيب. استخدم أزرار العرض السريع (⚡).", "Pipeline unreachable. Use the instant demo chips (⚡)."));
    } finally {
      setRunning(false);
    }
  };

  const stages = result?.trace?.stages || [];
  const maxLatency = Math.max(...stages.map((s) => s.latency_ms || 0), 1);
  const sufficiency = stages.find((s) => s.name === "sufficiency")?.output as Record<string, unknown> | undefined;
  const doseScan = stages.find((s) => s.name === "dose_scan")?.output as Record<string, unknown> | undefined;

  return (
    <div className={`p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto ${isRtl ? "text-right" : "text-left"}`}>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-display font-black text-slate-900 text-xl sm:text-2xl">
            {t("وحدة تحكم خط أنابيب RAG", "RAG Pipeline Console")}
          </h2>
          <button
            type="button"
            onClick={() => setLiveMode((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-black border ${
              liveMode ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
            }`}
          >
            {liveMode ? <Activity className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
            {liveMode ? t("مباشر", "LIVE") : t("عرض سريع", "DEMO")}
          </button>
        </div>
        <p className="text-xs sm:text-sm text-slate-500">
          {t(
            "التفكيك الكامل لكل استعلام: كل مرحلة بزمنها ومخرجاتها، وجدول الاسترجاع بدرجاته الأربع، وبوابة الكفاية، وفحوص الأمان — كما في مساحة العمل السريرية الأصلية.",
            "The full end-to-end breakdown per query: every stage with latency and outputs, the retrieval table with all four scores, the sufficiency gate, and the safety scans — like the original clinical workspace.",
          )}
        </p>
      </div>

      {/* runner */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(query); }}
            placeholder={t("اكتب سؤالاً سريرياً لتشغيله عبر خط الأنابيب…", "Type a clinical question to run through the pipeline…")}
            className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand-400"
          />
          <button
            type="button"
            onClick={() => void run(query)}
            disabled={running || !query.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-black text-sm px-5 py-2.5 disabled:opacity-40"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? t("يعمل…", "Running…") : t("تشغيل", "Run")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void run(s)}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100"
            >
              {!liveMode && demoCache?.[s] ? <Zap className="w-3 h-3" /> : null}
              {s}
            </button>
          ))}
        </div>
        {error && <p className="text-xs font-bold text-red-600">{error}</p>}
        {running && (
          <p className="text-xs font-bold text-slate-400">
            {t("خط الأنابيب الحقيقي يستغرق ~35-60 ثانية على الاستضافة المجانية…", "The live pipeline takes ~35-60s on free hosting…")}
          </p>
        )}
      </div>

      {result && (
        <>
          {/* verdict strip */}
          <div className="flex flex-wrap items-center gap-2">
            {result.status === "success" ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 text-emerald-700 px-2.5 py-1 text-xs font-black">
                <ShieldCheck className="w-3.5 h-3.5" /> {t("إجابة موثقة", "GROUNDED ANSWER")}
              </span>
            ) : result.refusal?.reason === "SMALL_TALK" ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-brand-50 text-brand-700 px-2.5 py-1 text-xs font-black">
                <ShieldCheck className="w-3.5 h-3.5" /> {t("محادثة — رد فوري بدون استرجاع", "SMALL TALK — instant reply, no retrieval")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 text-amber-700 px-2.5 py-1 text-xs font-black">
                <ShieldAlert className="w-3.5 h-3.5" /> {t("رفض آمن", "SAFE REFUSAL")} · {result.refusal?.reason}
              </span>
            )}
            {cached && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 px-2.5 py-1 text-xs font-black">
                <Zap className="w-3.5 h-3.5" /> {t("استجابة محفوظة (عرض)", "CACHED DEMO RESPONSE")}
              </span>
            )}
            {result.meta?.latency_ms ? (
              <span className="text-xs font-mono font-bold text-slate-400">
                {t("زمن خط الأنابيب:", "pipeline:")} {(result.meta.latency_ms / 1000).toFixed(1)}s
              </span>
            ) : null}
            {result.meta?.embedding_version ? (
              <span className="text-[10px] font-mono text-slate-400">emb: {result.meta.embedding_version}</span>
            ) : null}
            <span className="text-[10px] font-mono text-slate-400">domains: {JSON.stringify(result.domains)}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* stage timeline */}
            <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3">
              <h3 className="font-black text-slate-900 text-sm">{t("مراحل خط الأنابيب (من البداية للنهاية)", "Pipeline stages, end to end")}</h3>
              <div className="space-y-2">
                {stages.map((st, i) => {
                  const info = STAGE_INFO[st.name];
                  return (
                    <details key={i} className="group rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">
                            {i + 1}. {info ? t(info.ar, info.en) : st.name}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-slate-400">{((st.latency_ms || 0) / 1000).toFixed(2)}s</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mt-1">
                          <div className="h-full bg-brand-500" style={{ width: `${Math.max(2, ((st.latency_ms || 0) / maxLatency) * 100)}%` }} />
                        </div>
                        {info && st.output ? (
                          <div className="text-[10px] font-mono text-slate-500 mt-1 truncate">{info.describe(st.output)}</div>
                        ) : null}
                      </summary>
                      <pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-slate-900 text-emerald-300 text-[10px] p-2.5" dir="ltr">
                        {JSON.stringify(st.output ?? {}, null, 2)}
                      </pre>
                    </details>
                  );
                })}
                {!stages.length && <p className="text-xs text-slate-400">{t("لا توجد بيانات تتبع في هذه الاستجابة.", "No trace data on this response.")}</p>}
              </div>
            </div>

            {/* sufficiency + safety + answer */}
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3">
                <h3 className="font-black text-slate-900 text-sm">{t("بوابة الكفاية والأمان", "Sufficiency gate & safety")}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    [String(sufficiency?.state ?? "—"), t("الحالة", "state")],
                    [sufficiency?.top_score !== undefined ? Number(sufficiency.top_score).toFixed(2) : "—", t("أعلى درجة", "top score")],
                    [String(sufficiency?.tau_low ?? "—"), t("τ الفعلية", "effective τ_low")],
                    [String(sufficiency?.cross_lingual_margin_applied ?? false), t("هامش اللغات", "x-lingual margin")],
                  ].map(([v, label]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2.5">
                      <div className="text-sm font-black text-brand-700 font-mono">{v}</div>
                      <div className="text-[9px] font-bold text-slate-400">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[11px] font-bold text-slate-500">
                  {t("فحص الجرعات:", "Dose scan:")}{" "}
                  <span className={doseScan?.blocked ? "text-red-600" : "text-emerald-600"}>
                    {doseScan ? (doseScan.blocked ? t("حجب", "BLOCKED") : t("نظيف", "clean")) : "—"}
                  </span>
                  {" · "}
                  {t("إسقاط عبارات غير مدعومة:", "Unsupported statements dropped:")}{" "}
                  {String((result.safety as Record<string, unknown> | undefined)?.unsupported_statements_dropped ?? 0)}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-2">
                <h3 className="font-black text-slate-900 text-sm">{t("الإجابة النهائية", "Final answer")}</h3>
                {result.status === "success" ? (
                  (result.assessment?.statements || []).map((s) => (
                    <p key={s.id} className="text-xs leading-relaxed text-slate-700">
                      {s.text} <span className="text-brand-600 font-black">{s.citations.map((ci) => `[${ci}]`).join("")}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-xs leading-relaxed text-slate-700">{result.refusal?.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* retrieval table */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 space-y-3">
            <h3 className="font-black text-slate-900 text-sm">
              {t("جدول الاسترجاع وإعادة الترتيب — المختار مقابل المستبعد", "Retrieval & rerank table — selected vs discarded")}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" dir="ltr">
                <thead>
                  <tr className="text-left text-slate-400 font-black border-b border-slate-100">
                    <th className="py-1.5 pe-2">#</th>
                    <th className="py-1.5 pe-2">{t("المستند والقسم", "Document · section")}</th>
                    <th className="py-1.5 pe-2">{t("صفحات", "pages")}</th>
                    <th className="py-1.5 pe-2">dense</th>
                    <th className="py-1.5 pe-2">bm25</th>
                    <th className="py-1.5 pe-2">rrf</th>
                    <th className="py-1.5 pe-2">rerank</th>
                    <th className="py-1.5">{t("الحالة", "status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.evidence || []).map((ev) => (
                    <tr key={ev.index} className={`border-b border-slate-50 ${ev.selected ? "" : "opacity-50"}`}>
                      <td className="py-1.5 pe-2 font-black text-slate-500">{ev.index}</td>
                      <td className="py-1.5 pe-2">
                        <div className="font-bold text-slate-800 max-w-[360px] truncate">{ev.document_title}</div>
                        <div className="text-slate-400 max-w-[360px] truncate">{ev.section_path || "—"}</div>
                      </td>
                      <td className="py-1.5 pe-2 font-mono text-slate-500">
                        {ev.page_start}
                        {ev.page_end && ev.page_end !== ev.page_start ? `–${ev.page_end}` : ""}
                      </td>
                      <td className="py-1.5 pe-2 font-mono">{ev.scores?.dense?.toFixed(3) ?? "—"}</td>
                      <td className="py-1.5 pe-2 font-mono">{ev.scores?.bm25?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5 pe-2 font-mono">{ev.scores?.rrf?.toFixed(4) ?? "—"}</td>
                      <td className="py-1.5 pe-2 font-mono font-black text-brand-700">{ev.scores?.rerank?.toFixed(2) ?? "—"}</td>
                      <td className="py-1.5">
                        {ev.selected ? (
                          <span className="rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[9px] font-black">✓ {t("مختار", "selected")}</span>
                        ) : (
                          <span className="rounded bg-slate-100 text-slate-400 px-1.5 py-0.5 text-[9px] font-black">{t("مستبعد", "discarded")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="bg-slate-900 rounded-3xl p-5">
            <summary className="text-xs font-black text-slate-300 cursor-pointer">{t("الاستجابة الخام (JSON)", "Raw response (JSON)")}</summary>
            <pre className="mt-3 max-h-96 overflow-auto text-[10px] text-emerald-300" dir="ltr">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
