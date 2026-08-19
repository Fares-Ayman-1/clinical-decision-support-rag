/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { useLanguage } from "../../LanguageContext";
import ExercisePosePreview from "../exercise/ExercisePosePreview";
import { Database, RefreshCw, Save, GitBranch, Activity } from "lucide-react";

interface GraphNode {
  id: string;
  type: string;
  name_ar?: string;
  name_en?: string;
  suggested_sets?: number;
  suggested_reps?: number;
  kimore_thresholds?: { min: number; max: number };
  target_muscle?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string; relation: string }[];
}

export default function ExerciseLibraryCMS() {
  const { t, isRtl } = useLanguage();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/admin/exercises")
      .then((r) => r.json())
      .then((data) => {
        setGraph(data);
        const first = (data.nodes || []).find((n: GraphNode) => n.type === "Exercise");
        if (first && !selectedId) setSelectedId(first.id);
      })
      .catch(() => setMessage(t("تعذر تحميل مخطط المعرفة.", "Could not load knowledge graph.")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const exercises = graph?.nodes.filter((n) => n.type === "Exercise") || [];
  const selected = exercises.find((e) => e.id === selectedId) || exercises[0];
  const relatedEdges =
    graph?.edges.filter((e) => e.source === selected?.id || e.target === selected?.id) || [];

  const updateSelected = (patch: Partial<GraphNode>) => {
    if (!graph || !selected) return;
    setGraph({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === selected.id ? { ...n, ...patch } : n)),
    });
  };

  const updateKimore = (field: "min" | "max", value: number) => {
    if (!selected) return;
    const kt = selected.kimore_thresholds || { min: 90, max: 120 };
    updateSelected({ kimore_thresholds: { ...kt, [field]: value } });
  };

  const handleSync = async () => {
    if (!graph) return;
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/graph/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graph),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync failed");
      setMessage(t("تمت مزامنة FitKG مع أينشتاين والبحث ✓", "FitKG synced to Einstein & search index ✓"));
    } catch {
      setMessage(t("فشلت المزامنة — البيانات محفوظة في الذاكرة للجلسة.", "Sync failed — data kept in session memory."));
      setGraph(graph);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        {t("جاري تحميل مكتبة التمارين و FitKG...", "Loading exercise library & FitKG...")}
      </div>
    );
  }

  return (
    <div className={`max-w-7xl mx-auto px-4 py-8 space-y-6 ${isRtl ? "text-right" : "text-left"}`} dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl font-display font-black text-slate-900 flex items-center gap-2">
            <Database className="w-6 h-6 text-brand-600" />
            {t("مكتبة التمارين ومحتوى FitKG", "Exercise Library & FitKG CMS")}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t("تحرير العقد، زوايا Kimore، ونشر المخطط لأينشتاين وغرفة التمارين.", "Edit nodes, Kimore angles, and publish graph to Einstein & AI room.")}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm px-5 py-2.5 rounded-xl disabled:opacity-60"
        >
          {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {syncing ? t("جاري النشر...", "Publishing...") : t("نشر إلى FitKG", "Publish to FitKG")}
        </button>
      </div>

      {message && (
        <p className="text-xs font-bold text-brand-700 bg-brand-50 border border-brand-200 rounded-xl px-4 py-2">{message}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Exercise list */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-4 space-y-2 max-h-[520px] overflow-y-auto">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-wide mb-2">
            {t("تمارين المخطط", "Graph exercises")} ({exercises.length})
          </h3>
          {exercises.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => setSelectedId(ex.id)}
              className={`w-full p-3 rounded-xl border text-left transition ${
                selected?.id === ex.id ? "border-brand-500 bg-brand-50" : "border-slate-100 hover:bg-slate-50"
              }`}
            >
              <span className="font-bold text-sm text-slate-900 block">
                {t(ex.name_ar || "", ex.name_en || ex.id)}
              </span>
              <span className="text-[10px] font-mono text-slate-400">{ex.id}</span>
            </button>
          ))}
        </div>

        {/* Editor + preview */}
        <div className="lg:col-span-8 space-y-4">
          {selected && (
            <>
              <ExercisePosePreview
                exerciseId={selected.id}
                kimoreMin={selected.kimore_thresholds?.min}
                kimoreMax={selected.kimore_thresholds?.max}
              />

              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">{t("الاسم (عربي)", "Name (AR)")}</label>
                    <input
                      value={selected.name_ar || ""}
                      onChange={(e) => updateSelected({ name_ar: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">{t("الاسم (إنجليزي)", "Name (EN)")}</label>
                    <input
                      value={selected.name_en || ""}
                      onChange={(e) => updateSelected({ name_en: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">{t("مجموعات", "Sets")}</label>
                    <input
                      type="number"
                      value={selected.suggested_sets ?? 3}
                      onChange={(e) => updateSelected({ suggested_sets: Number(e.target.value) })}
                      className="w-full border rounded-lg px-2 py-1.5 text-center font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">{t("تكرارات", "Reps")}</label>
                    <input
                      type="number"
                      value={selected.suggested_reps ?? 10}
                      onChange={(e) => updateSelected({ suggested_reps: Number(e.target.value) })}
                      className="w-full border rounded-lg px-2 py-1.5 text-center font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Kimore min°</label>
                    <input
                      type="number"
                      value={selected.kimore_thresholds?.min ?? 90}
                      onChange={(e) => updateKimore("min", Number(e.target.value))}
                      className="w-full border rounded-lg px-2 py-1.5 text-center font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Kimore max°</label>
                    <input
                      type="number"
                      value={selected.kimore_thresholds?.max ?? 120}
                      onChange={(e) => updateKimore("max", Number(e.target.value))}
                      className="w-full border rounded-lg px-2 py-1.5 text-center font-mono text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-1">{t("العضلة المستهدفة", "Target muscle")}</label>
                  <input
                    value={selected.target_muscle || ""}
                    onChange={(e) => updateSelected({ target_muscle: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Mini graph */}
              <div className="bg-slate-950 text-slate-300 rounded-2xl p-5 border border-slate-800">
                <h4 className="text-xs font-bold text-brand-400 flex items-center gap-1.5 mb-3">
                  <GitBranch className="w-4 h-4" />
                  {t("روابط المخطط لهذا التمرين", "Graph edges for this exercise")}
                </h4>
                <ul className="space-y-1.5 text-xs font-mono">
                  {relatedEdges.length === 0 && <li className="text-slate-500">{t("لا روابط", "No edges")}</li>}
                  {relatedEdges.map((e, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Activity className="w-3 h-3 text-teal-400" />
                      <span>{e.source}</span>
                      <span className="text-brand-400">{e.relation}</span>
                      <span>{e.target}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
