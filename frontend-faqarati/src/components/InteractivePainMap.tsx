/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { mockPainAreas, mockExercises, mockTherapists } from "../mockData";
import { Activity, ShieldCheck, Dumbbell, Star, MessageSquare, Clipboard, FileText, Download, AlertTriangle, ShieldAlert } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { PainArea } from "../types";

interface IndexMapProps {
  onSelectDoctor: (doctorId: string) => void;
  openAuth: (role: "patient") => void;
}

interface Bilingual {
  ar: string;
  en: string;
}

const DURATION_OPTIONS: (Bilingual & { key: string; chronic?: boolean })[] = [
  { key: "acute", ar: "أقل من أسبوع (ألم حاد مؤقت)", en: "Less than a week (Acute)" },
  { key: "subacute", ar: "من أسبوع إلى شهر (تحت حاد)", en: "1 week to 1 month (Sub-acute)", chronic: true },
  { key: "chronic_onset", ar: "من شهر إلى ٣ أشهر (بداية مزمن)", en: "1 to 3 months (Chronic onset)", chronic: true },
  { key: "persistent", ar: "أكثر من ٣ أشهر (تصلب حاد مستمر)", en: "More than 3 months (Severe persistent)", chronic: true },
];

const TRIGGER_OPTIONS: (Bilingual & { key: string })[] = [
  { key: "sitting", ar: "يزداد عند الجلوس لفترات طويلة والانحناء", en: "Worsens on prolonged sitting/bending" },
  { key: "morning", ar: "يزداد فور الاستيقاظ والمشي الصباحي", en: "Worsens upon walking in the morning" },
  { key: "rotation", ar: "يزداد بمجرد ثني أو تدوير المفصل حركياً", en: "Worsens upon active joint rotation" },
  { key: "constant", ar: "نوبات مستمرة تدق في أي وقت من اليوم", en: "Constant throbbing anytime of day" },
];

const ANALYZING_STEPS: Record<string, Bilingual> = {
  extract: {
    ar: "جاري استخلاص معطيات الجسم وسجلات التماثل الحركي...",
    en: "Extracting body metrics and movement symmetry records...",
  },
  match: {
    ar: "جاري مطابقة الأعراض المكتوبة مع دليل السلوك الحركي السريري...",
    en: "Matching symptoms against the clinical movement behavior guide...",
  },
  dose: {
    ar: "مقارنة زوايا المفاصل المسجلة بـ MediaPipe لتوزيع الجرعة العلاجية...",
    en: "Comparing recorded joint angles with MediaPipe to assign therapeutic dose...",
  },
};

interface TriageReport {
  timestamp: string;
  bodyPart: Bilingual;
  painLevel: number;
  duration: Bilingual;
  triggers: Bilingual;
  historyText: string;
  historyFallback: Bilingual;
  riskCategory: "green" | "amber" | "red";
  recommendations: Bilingual[];
}

export default function InteractivePainMap({ onSelectDoctor, openAuth }: IndexMapProps) {
  const { lang, t, isRtl } = useLanguage();
  const bt = (b: Bilingual) => t(b.ar, b.en);
  const [selectedAreaId, setSelectedAreaId] = useState<string>("back");

  const [painLevel, setPainLevel] = useState<number>(5);
  const [painDurationKey, setPainDurationKey] = useState("subacute");
  const [painTriggersKey, setPainTriggersKey] = useState("sitting");
  const [historyText, setHistoryText] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzingStepKey, setAnalyzingStepKey] = useState<string>("");
  const [generatedReport, setGeneratedReport] = useState<TriageReport | null>(null);

  const selectedArea = mockPainAreas.find((area) => area.id === selectedAreaId) || mockPainAreas[1];

  // Matched entities based on area selected
  const matchedExercisesList = mockExercises.filter((ex) =>
    selectedArea.matchedExercises.includes(ex.id)
  );

  const matchedTherapistsList = mockTherapists.filter((pt) =>
    pt.specialty.some((spec) =>
      selectedArea.nameAr.includes("الظهر")
        ? spec.includes("العمود الفقري")
        : selectedArea.nameAr.includes("الرقبة")
        ? spec.includes("الرقبة")
        : spec.includes("المفاصل") || spec.includes("تأهيل")
    )
  );

  const handleGenerateReport = () => {
    const durationOpt = DURATION_OPTIONS.find((d) => d.key === painDurationKey) || DURATION_OPTIONS[1];
    const triggerOpt = TRIGGER_OPTIONS.find((tr) => tr.key === painTriggersKey) || TRIGGER_OPTIONS[0];
    const locale = lang === "ar" ? "ar-SA" : "en-US";

    setIsAnalyzing(true);
    setAnalyzingStepKey("extract");

    setTimeout(() => {
      setAnalyzingStepKey("match");

      setTimeout(() => {
        setAnalyzingStepKey("dose");

        setTimeout(() => {
          let risk: "green" | "amber" | "red" = "green";
          let recs: Bilingual[] = [];

          if (painLevel >= 8) {
            risk = "red";
            recs = [
              {
                ar: "يُنصح بشدة بالتوقف عن أي حمل بدني ثقيل فوراً لتجنب زيادة ديسك العمود الفقري.",
                en: "Stop heavy lifting immediately to avoid worsening spinal disc compression.",
              },
              {
                ar: "يرجى حجز موعد عيادة مرئية عاجل مع الأخصائي لتفادي تطور الألم لعنق الفخذ أو تنمل الأطراف.",
                en: "Book an urgent telehealth session with a specialist to rule out radiating leg pain or numbness.",
              },
              {
                ar: "يمكن أداء حركات تمدد خفيفة جداً بدون أي ثني حاد للجذع.",
                en: "Only very gentle stretches are allowed — avoid sharp trunk flexion.",
              },
            ];
          } else if (painLevel >= 4 || durationOpt.chronic) {
            risk = "amber";
            recs = [
              {
                ar: "حالة مستقرة ولكنها تتطلب إشرافاً لمتابعة انحناء الفقرات واستوائها.",
                en: "Stable but needs supervised monitoring of spinal flexion and alignment.",
              },
              {
                ar: "البدء في تمارين إطالة الظهر الرقيقة المحددة أدناه (١٠ تكرارات مع ثبات ٥ ثوان).",
                en: "Start gentle lumbar stretches below (10 reps with 5-second holds).",
              },
              {
                ar: "تتبع استقامة ظهرك عبر الكاميرا والذكاء الاصطناعي على الأقل مرتين يومياً.",
                en: "Track back alignment with AI camera guidance at least twice daily.",
              },
            ];
          } else {
            risk = "green";
            recs = [
              {
                ar: "الحالة ممتازة ومثالية لبدء التأهيل الذاتي الذكي فورا في البيت.",
                en: "Excellent candidate for immediate smart home rehabilitation.",
              },
              {
                ar: "الالتزام بتمارين استقامة الركبة والظهر ٣ مرات في الأسبوع لتقوية العضلات المساندة.",
                en: "Perform knee and back alignment exercises 3× weekly to strengthen supporting muscles.",
              },
              {
                ar: "الجلوس السليم وتفادي الجلوس المستمر لأكثر من ٤٥ دقيقة متواصلة.",
                en: "Maintain ergonomic sitting and break every 45 minutes of desk work.",
              },
            ];
          }

          setGeneratedReport({
            timestamp: new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
            bodyPart: { ar: selectedArea.nameAr, en: selectedArea.nameEn },
            painLevel,
            duration: { ar: durationOpt.ar, en: durationOpt.en },
            triggers: { ar: triggerOpt.ar, en: triggerOpt.en },
            historyText,
            historyFallback: {
              ar: "لا يوجد تشخيص سابق أو عمليات مسجلة",
              en: "No prior diagnosis or surgeries on record",
            },
            riskCategory: risk,
            recommendations: recs,
          });
          setIsAnalyzing(false);
          setAnalyzingStepKey("");
        }, 1200);
      }, 1000);
    }, 1000);
  };

  // UI helpers for pain level
  const getPainLevelColor = (level: number) => {
    if (level <= 3) return "bg-emerald-500 text-white";
    if (level <= 6) return "bg-amber-500 text-white";
    if (level <= 8) return "bg-orange-500 text-white";
    return "bg-rose-500 text-white";
  };

  const getPainLevelDescriptor = (level: number) => {
    if (level <= 3) return t("ألم خفيف (بسيط ومتقطع)", "Mild (intermittent)");
    if (level <= 6) return t("ألم متوسط (يعوق الحركة البسيطة)", "Moderate (limits simple movement)");
    if (level <= 8) return t("ألم شديد (يمنع القيام بالأنشطة اليومية)", "Severe (blocks daily activities)");
    return t("ألم شديد جداً لا يطاق (يتطلب تدخل عاجل)", "Extreme (requires urgent care)");
  };

  return (
    <section id="pain-map" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <span className="text-xs font-black bg-brand-100 text-brand-800 border border-brand-200 px-3.5 py-1.5 rounded-full uppercase tracking-wider">
            {t("منظومة الفرز والتشخيص الأولي", "Symptom Triage & Clinical Assessment Indicator")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-display font-black text-slate-900">
            {t("أداة الفرز الحركي التفاعلية واستبيان الألم 🗺️", "Interactive Pain Map & Clinical Triage Tool 🗺️")}
          </h2>
          <p className="text-slate-650 font-medium">
            {t(
              "انقر على منطقة الألم الشائعة في المجسم التفاعلي وثق حالتك لتوليد تقرير الفرس الطبي الحركي الأول وتحديد عيادتك الأنسب.",
              "Click on any primary pain region on the interactive body silhouette. Complete the quick assessment questionnaire to generate an instant clinical triage report."
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          {/* Right Col (Width 5/12): Human Body Target Map (Interactive SVG Layout) */}
          <div className="lg:col-span-5 bg-slate-50 rounded-3xl p-6 sm:p-8 border border-slate-100 flex flex-col items-center relative">
            <h3 className="font-display font-bold text-slate-800 text-lg mb-6 text-center">
              {t("اختر موضع الألم في الهيكل المفاصل:", "Select Pain Hotspot Area:")}
            </h3>

            {/* Interactive Human Silhouette SVG */}
            <div className="relative w-full max-w-xs h-96 flex justify-center items-center">
              <svg viewBox="0 0 120 220" className="w-full h-full select-none">
                {/* Silhouette Shadow Base */}
                <ellipse cx="60" cy="205" rx="30" ry="6" fill="#cbd5e1" opacity="0.6"/>

                {/* Human Body Outline Silhouette */}
                <path
                  d="M60,15 C54,15 50,19 50,25 C50,31 54,35 60,35 C66,35 70,31 70,25 C70,19 66,15 60,15 Z 
                     M54,37 C42,40 38,55 38,70 L38,105 C38,110 42,112 45,112 L47,70 L52,70 L52,140 L45,200 L55,200 L60,150 L65,200 L75,200 L68,140 L68,70 L73,70 L75,112 C78,112 82,110 82,105 L82,70 C82,55 78,40 66,37 Z"
                  fill="#e2e8f0"
                  stroke="#cbd5e1"
                  strokeWidth="1.5"
                />

                {/* Neck area hotspot */}
                <g 
                  onClick={() => { setSelectedAreaId("neck"); setGeneratedReport(null); }} 
                  className="cursor-pointer group"
                >
                  <circle 
                    cx="60" 
                    cy="40" 
                    r="8" 
                    fill={selectedAreaId === "neck" ? "#0d9488" : "#94a3b8"} 
                    className="transition-colors duration-200"
                    opacity={selectedAreaId === "neck" ? "0.9" : "0.5"}
                  />
                  <circle 
                    cx="60" 
                    cy="40" 
                    r="14" 
                    fill="none" 
                    stroke="#0d9488" 
                    strokeWidth="1.5"
                    className={`transition-all ${selectedAreaId === "neck" ? "animate-ping" : "opacity-0 group-hover:opacity-40"}`}
                  />
                  <text x="60" y="42" textAnchor="middle" fontSize="6" fill="white" className="font-mono font-bold select-none pointer-events-none">N</text>
                </g>

                {/* Spine / Lower Back Area Hotspot */}
                <g 
                  onClick={() => { setSelectedAreaId("back"); setGeneratedReport(null); }} 
                  className="cursor-pointer group"
                >
                  <circle 
                    cx="60" 
                    cy="85" 
                    r="10" 
                    fill={selectedAreaId === "back" ? "#0d9488" : "#94a3b8"} 
                    className="transition-colors duration-200"
                    opacity={selectedAreaId === "back" ? "0.9" : "0.5"}
                  />
                  <circle 
                    cx="60" 
                    cy="85" 
                    r="18" 
                    fill="none" 
                    stroke="#0d9488" 
                    strokeWidth="1.5"
                    className={`transition-all ${selectedAreaId === "back" ? "animate-ping" : "opacity-0 group-hover:opacity-40"}`}
                  />
                  <text x="60" y="87" textAnchor="middle" fontSize="7" fill="white" className="font-mono font-bold select-none pointer-events-none">B</text>
                </g>

                {/* Knee Joint Hotspot */}
                <g 
                  onClick={() => { setSelectedAreaId("knee"); setGeneratedReport(null); }} 
                  className="cursor-pointer group"
                >
                  <circle 
                    cx="60" 
                    cy="165" 
                    r="9" 
                    fill={selectedAreaId === "knee" ? "#0d9488" : "#94a3b8"} 
                    className="transition-colors duration-200"
                    opacity={selectedAreaId === "knee" ? "0.9" : "0.5"}
                  />
                  <circle 
                    cx="60" 
                    cy="165" 
                    r="16" 
                    fill="none" 
                    stroke="#0d9488" 
                    strokeWidth="1.5"
                    className={`transition-all ${selectedAreaId === "knee" ? "animate-ping" : "opacity-0 group-hover:opacity-40"}`}
                  />
                  <text x="60" y="167" textAnchor="middle" fontSize="7" fill="white" className="font-mono font-bold select-none pointer-events-none">K</text>
                </g>
              </svg>
            </div>

            {/* Quick selectors switcher */}
            <div className="flex justify-center flex-wrap gap-2.5 mt-6 w-full">
              {mockPainAreas.map((area) => (
                <button
                  key={area.id}
                  onClick={() => { setSelectedAreaId(area.id); setGeneratedReport(null); }}
                  className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold border cursor-pointer transition-all duration-200 ${
                    selectedAreaId === area.id
                      ? "bg-brand-600 text-white border-transparent shadow-md shadow-brand-500/20 scale-105"
                      : "bg-white text-slate-650 border-slate-100 hover:bg-slate-100"
                  }`}
                >
                  {t(area.nameAr, area.nameEn)}
                </button>
              ))}
            </div>
          </div>

          {/* Left Col (Width 7/12): Interactive Pain Questionnaire & Results */}
          <div className="lg:col-span-7 space-y-8 text-right">
            
            {/* 1. Questionnaire Container or Diagnostic Report display */}
            {!generatedReport ? (
              <div className="bg-slate-50 border border-slate-100 p-6 sm:p-8 rounded-3xl space-y-6">
                <div>
                  <h3 className="font-display font-black text-slate-900 text-xl flex justify-start items-center gap-2">
                    <Clipboard className="w-5 h-5 text-brand-550" />
                    <span>{t("استبيان تفاصيل الألم الحركي لـ:", "Kinetic Intake Details for:")} {t(selectedArea.nameAr, selectedArea.nameEn)}</span>
                  </h3>
                  <p className="text-slate-500 text-xs mt-1 font-semibold">{t("تساعدنا هذه المعطيات في صياغة الجرعة الرياضية وتفادي الحركات ذات الخطورة البالغة.", "These parameters guide our customized motion dosages and lock high-injury behaviors.")}</p>
                </div>

                <div className="space-y-5">
                  {/* Slider: Pain Severity Index */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span className={`px-2.5 py-0.5 rounded-full font-black ${getPainLevelColor(painLevel)}`}>
                        {painLevel}/10 - {getPainLevelDescriptor(painLevel)}
                      </span>
                      <span>{t("مستوى الألم والجهد الحالي:", "Current pain & exertion level:")}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={painLevel}
                      onChange={(e) => setPainLevel(parseInt(e.target.value))}
                      className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 font-semibold px-1">
                      <span>{t("ألم حاد لا يطاق (١٠)", "Severe Instability (10)")}</span>
                      <span>{t("ألم معتدل (٥)", "Moderate Pain (5)")}</span>
                      <span>{t("بسيط جداً (١)", "Very Minor (1)")}</span>
                    </div>
                  </div>

                  {/* Selector: Pain Duration */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-bold text-slate-700">{t("مدة تكرار أو بقاء الألم:", "Pain duration / Frequency:")}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {DURATION_OPTIONS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setPainDurationKey(item.key)}
                          className={`p-3 ${isRtl ? "text-right" : "text-left"} rounded-xl border text-xs font-bold cursor-pointer transition ${
                            painDurationKey === item.key
                              ? "bg-brand-50 border-brand-500 text-brand-950 scale-[1.01]"
                              : "bg-white border-slate-150 text-slate-650 hover:bg-slate-100"
                          }`}
                        >
                          {bt(item)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Selector: Pain Triggers */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-bold text-slate-700">{t("مثيرات ومسببات الشعور بالشد العضلي والمفصلي:", "Symptom Triggers:")}</label>
                    <div className="grid grid-cols-2 gap-3">
                      {TRIGGER_OPTIONS.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setPainTriggersKey(item.key)}
                          className={`p-3 ${isRtl ? "text-right" : "text-left"} rounded-xl border text-xs font-bold cursor-pointer transition ${
                            painTriggersKey === item.key
                              ? "bg-brand-50 border-brand-500 text-brand-950 scale-[1.01]"
                              : "bg-white border-slate-150 text-slate-650 hover:bg-slate-100"
                          }`}
                        >
                          {bt(item)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input: Injury or History text */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">{t("وصف الإصابة، عمليات سابقة، أو توصية طبيبك (إن وجد):", "Describe injury history, past surgeries, or physician instructions (optional):")}</label>
                    <textarea
                      rows={2}
                      value={historyText}
                      onChange={(e) => setHistoryText(e.target.value)}
                      placeholder={t("امثلة: انزلاق غضروفي بالفقرتين الرابعة والخامسة، كسر ناتج عن هبوط، خشونة ركبة بسيطة تم إسعافها...", "Examples: Disc herniation L4-L5, knee osteoarthritis, previous collarbone fracture surgery...")}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden leading-relaxed"
                    />
                  </div>
                </div>

                {/* Submitting triage survey or loader */}
                {isAnalyzing ? (
                  <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-850 flex flex-col items-center gap-4 text-center">
                    <div className="w-10 h-10 border-4 border-brand-400 border-t-transparent rounded-full animate-spin"></div>
                    <p className="font-display font-bold text-sm tracking-wide text-brand-400">
                      {analyzingStepKey ? bt(ANALYZING_STEPS[analyzingStepKey]) : ""}
                    </p>
                    <span className="text-[10px] text-slate-450 leading-normal max-w-sm">{t("بروتوكولات الفحص الذكي مطابقة للائحة التقنين السريري لوزارة الصحة.", "Smart assessment protocols comply with clinical guidelines.")}</span>
                  </div>
                ) : (
                  <button
                    onClick={handleGenerateReport}
                    className="w-full py-4 bg-slate-950 hover:bg-slate-850 text-white font-display font-black text-sm rounded-xl cursor-pointer transition shadow-md flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4.5 h-4.5 text-brand-400" />
                    <span>{t("توليد وإصدار تقرير الفرز الطبي الحركي الأول 📄", "Generate Kinetic Triage Assessment Report 📄")}</span>
                  </button>
                )}
              </div>
            ) : (
              /* Beautiful Certified Triage Report Card Display */
              <div className={`bg-slate-900 text-white border-2 border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 relative overflow-hidden transition-all duration-350 ${isRtl ? "text-right" : "text-left"}`} dir={isRtl ? "rtl" : "ltr"}>
                
                {/* Visual medical seal design overlay */}
                <div className="absolute top-6 left-6 opacity-10 rotate-12 flex flex-col items-center select-none pointer-events-none">
                  <Clipboard className="w-24 h-24 text-white" />
                  <span className="font-mono text-[10px] font-black">FAQARATI MEDICAL</span>
                </div>

                {/* Header structure */}
                <div className={`flex justify-between items-start border-b border-slate-800 pb-5 ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                  <div className={`font-mono text-[10px] text-slate-500 font-semibold space-y-0.5 ${isRtl ? "text-left" : "text-right"}`}>
                    <div>DATE: {generatedReport.timestamp}</div>
                    <div className="text-cyan-400 font-bold">SERIAL: FQR-{Date.now().toString().slice(-6)}</div>
                  </div>
                  <div>
                    <h3 className="font-display font-black text-slate-100 text-lg sm:text-xl">
                      {t("تقرير الكشف والتصنيف الحركي المفاصل", "Kinetic Joint Triage & Classification Report")}
                    </h3>
                    <span className="text-[10.5px] text-brand-400 font-semibold block mt-1">
                      {t("تأهيل رقمي موجه من عيادة فقراتي الطبية عن بعد", "Remote digital rehab guided by Faqarati clinic")}
                    </span>
                  </div>
                </div>

                {/* Patient Summary Details */}
                <div className="grid grid-cols-2 gap-4 bg-slate-950/70 p-4 rounded-2xl border border-slate-850">
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold block">
                      {t("حجم ومستوى الألم المسجل", "Recorded pain severity")}
                    </span>
                    <span className={`inline-block font-bold text-xs px-2.5 py-0.5 rounded-md ${getPainLevelColor(generatedReport.painLevel)}`}>
                      {generatedReport.painLevel} / 10
                    </span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-500 font-bold block">
                      {t("منطقة الشكوى الرئيسية", "Primary complaint region")}
                    </span>
                    <span className="block font-bold text-slate-100 text-sm">{bt(generatedReport.bodyPart)}</span>
                  </div>
                </div>

                {/* Risk classification flag banner */}
                <div className="space-y-2">
                  <h4 className="font-display font-bold text-sm text-slate-300">
                    {t("التصنيف والتوجيه العيادي الموصى به:", "Clinical classification & recommended guidance:")}
                  </h4>
                  {generatedReport.riskCategory === "red" && (
                    <div className={`bg-rose-950/60 border border-rose-500/30 p-4.5 rounded-2xl text-rose-350 text-xs sm:text-sm flex gap-3.5 items-start ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                      <ShieldAlert className="w-10 h-10 text-rose-500 flex-shrink-0" />
                      <div className="space-y-1 leading-relaxed">
                        <strong className="block text-sm font-black text-rose-450">
                          {t("⚠️ إشارة حذرة حمراء (قد يستلزم تدخل عيادي فوري)", "⚠️ Red alert (may require urgent clinical intervention)")}
                        </strong>
                        <span>
                          {t(
                            "سجلت استجابتك مستوى ألم حاد جداً مسبباً لتقييد النشاط. ينصح بالبقاء ثابتاً وحجز جلسة عاجلة لتقييم فقرات العمود الفقري ومقارنتها عبر الكاميرا والـ Web-consultation.",
                            "You reported severe pain limiting activity. Remain stable and book an urgent spine assessment via camera-guided telehealth."
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {generatedReport.riskCategory === "amber" && (
                    <div className={`bg-amber-950/60 border border-amber-500/30 p-4.5 rounded-2xl text-amber-300 text-xs sm:text-sm flex gap-3.5 items-start ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                      <AlertTriangle className="w-8 h-8 text-amber-500 flex-shrink-0" />
                      <div className="space-y-1 leading-relaxed">
                        <strong className="block text-sm font-black text-amber-400">
                          {t("⚠️ إشارة وقائية برتقالية (ألم متوسط بحاجة لإشراف حركي مخصص)", "⚠️ Amber caution (moderate pain — supervised movement plan advised)")}
                        </strong>
                        <span>
                          {t(
                            "تشخيص مستقر، يوصى بالالتزام مع طبيب العلاج الطبيعي وبدء الجرعة بمصحح الحركة الذكي عبر تمكين زوايا ريادية متوازنة لتجنب الشد الإطرافي.",
                            "Stable presentation — work with your PT and start AI motion correction with balanced joint angles to avoid peripheral strain."
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {generatedReport.riskCategory === "green" && (
                    <div className={`bg-emerald-950/60 border border-emerald-500/30 p-4.5 rounded-2xl text-emerald-300 text-xs sm:text-sm flex gap-3.5 items-start ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                      <ShieldCheck className="w-8 h-8 text-emerald-500 flex-shrink-0" />
                      <div className="space-y-1 leading-relaxed">
                        <strong className="block text-sm font-black text-emerald-400 text-right">
                          {t("✓ إشارة خضراء آمنة (ملائم تماماً للتأهيل الفوري المنزلي)", "✓ Green Light (Safe for Immediate Home Rehabilitation)")}
                        </strong>
                        <span>
                          {t(
                            "أدلت إجاباتك بدرجات تشنج عابر أو طبيعي. برامج المراقبة الذاتية للمفاصل مثالية لتعزيز مرونة فقراتك ومكافحة ضغوط الجلوس الطويل والمكتبي فورا.",
                            "Your symptoms report transient tension or mild muscle fatigue. Home rehabilitation programs with active joint alignment are perfect for building mobility and back resistance right now."
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Specific exercise recipes guidelines */}
                <div className="space-y-2">
                  <h4 className="font-display font-semibold text-xs text-slate-400">
                    {t("الإجراءات الطبية الموصوفة للعلاج:", "Clinically Prescribed Interventions:")}
                  </h4>
                  <ul className={`space-y-2 text-xs sm:text-sm leading-relaxed text-slate-300 ${isRtl ? "text-right" : "text-left"}`}>
                    {generatedReport.recommendations.map((rec, i) => (
                      <li key={i} className={`flex gap-1.5 font-medium ${isRtl ? "justify-end" : "justify-start"}`}>
                        <span>• {bt(rec)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Actions button list */}
                <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-3 justify-between items-center text-xs">
                  <div className="flex gap-2 w-full sm:w-auto">
                    <button
                      onClick={() => setGeneratedReport(null)}
                      className="bg-slate-800 hover:bg-slate-755 text-slate-300 font-bold px-4 py-2.5 rounded-xl transition cursor-pointer w-full text-center"
                    >
                      {t("إعادة الفرز واستبيان آخر", "Reset and Search Again")}
                    </button>
                    <button
                      onClick={() => openAuth("patient")}
                      className="bg-brand-500 hover:bg-brand-600 text-slate-950 font-black px-5 py-2.5 rounded-xl transition cursor-pointer w-full text-center flex items-center justify-center gap-1.5"
                    >
                      <span>{t("تثبيت الخطة في ملفي", "Save Plan to Profile")}</span>
                    </button>
                  </div>

                  <span className="text-[10px] text-slate-500 font-semibold max-w-sm text-center sm:text-right font-mono">
                    {t("تقرير تأهيلي رقمي مشفر ومرتبط بـ MOH Standards", "Encrypted digital triage report aligned with MOH Standards")}
                  </span>
                </div>

              </div>
            )}

            {/* Area Details Card - Always visible below for secondary specifications context */}
            <div className={`bg-brand-5/70 p-6 sm:p-8 rounded-3xl border border-brand-100/50 space-y-4 ${isRtl ? "text-right" : "text-left"}`}>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h3 className="font-display font-black text-slate-900 text-2xl sm:text-3xl">
                  {t(selectedArea.nameAr, selectedArea.nameEn)}
                </h3>
                <div className="bg-brand-100/85 text-brand-900 px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-black">
                  {t("معدل التكرار المسجل:", "Recorded Prevalence:")} {selectedArea.prevalencePercentage}% {t("من الحالات في المملكة", "of clinical cases in KSA")}
                </div>
              </div>
              <p className="text-slate-650 leading-relaxed text-sm font-semibold">
                {lang === "en" ? (selectedArea.descriptionEn || selectedArea.descriptionAr) : selectedArea.descriptionAr}
              </p>
            </div>

            {/* Matched Exercises subsection */}
            <div className="space-y-4 w-full">
              <h4 className="font-display font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                <Dumbbell className="w-5 h-5 text-brand-500" />
                <span>{t("تمارين المراقبة والتحقق الذاتي الموصى بها ميكانيكياً (", "Recommended Mechanical Self-Check Exercises (")} {matchedExercisesList.length} ):</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {matchedExercisesList.map((ex) => (
                  <div key={ex.id} className={`bg-slate-50 border border-slate-100 hover:border-brand-200 p-5 rounded-2xl transition hover:shadow-xs space-y-3 ${isRtl ? "text-right" : "text-left"}`}>
                    <div className="flex justify-between items-center bg-white p-2 rounded-xl border border-slate-100 gap-2">
                      <h5 className="font-semibold text-slate-900 text-sm">{t(ex.nameAr, ex.nameEn)}</h5>
                      <span className="text-[11px] font-mono text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md font-bold flex-shrink-0">
                        {ex.idealAngleRange.min}° - {ex.idealAngleRange.max}° {t("تماثل هدف", "Target Sim")}
                      </span>
                    </div>
                    
                    <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 font-semibold">
                      {lang === "en" ? (ex.descriptionEn || ex.descriptionAr) : ex.descriptionAr}
                    </p>

                    <div className="pt-2 text-xs font-bold text-brand-650 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      <span>{t("الجدول:", "Schedule:")} {lang === "en" ? (ex.recommendedDurationEn || ex.recommendedDuration) : ex.recommendedDuration}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Matched Physiotherapists recommended */}
            <div className="space-y-4 w-full">
              <h4 className="font-display font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand-500" />
                <span>{t("أخصائيو علاج طبيعي مرشحون ومسجلون لهذه المنطقة (", "Certified PT Specialists Recommended (")} {matchedTherapistsList.length} ):</span>
              </h4>

              <div className="space-y-3">
                {matchedTherapistsList.map((pt) => {
                  const hasEnName = lang === "en" && pt.nameEn;
                  const hasEnSpecialty = lang === "en" && pt.specialtyEn;

                  return (
                    <div 
                      key={pt.id} 
                      className={`bg-white border border-slate-100 hover:border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 justify-between items-center transition ${isRtl ? "text-right" : "text-left"}`}
                    >
                      {/* Therapist Profile Info */}
                      <div className="flex items-center gap-3.5 w-full sm:w-auto">
                        <img
                          src={pt.avatarUrl}
                          alt={pt.name}
                          referrerPolicy="no-referrer"
                          className="w-13 h-13 rounded-full object-cover border-2 border-brand-100 flex-shrink-0"
                        />
                        <div>
                          <h5 className="font-bold text-slate-900 text-base">{hasEnName ? pt.nameEn : pt.name}</h5>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 flex-shrink-0" />
                            <span className="text-amber-500 font-bold">{pt.rating}</span>
                            <span className="font-bold text-slate-700">({pt.reviewCount} {t("مراجعة", "reviews")})</span>
                            <span className="text-slate-300">|</span>
                            <span>{t("ترخيص:", "Lic:")} <strong className="font-mono text-slate-650">{pt.licenseNumber}</strong></span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {pt.specialty.map((s, idx) => (
                              <span key={idx} className="bg-slate-100 text-slate-755 text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-md shadow-3xs">
                                {hasEnSpecialty && pt.specialtyEn ? pt.specialtyEn[idx] : s}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        onClick={() => onSelectDoctor(pt.id)}
                        className="bg-brand-50 hover:bg-brand-100 text-brand-800 font-bold text-xs px-4 py-2.5 rounded-xl transition cursor-pointer w-full sm:w-auto text-center border-0"
                      >
                        {t("أظهر المواعيد المتاحة والتفاصيل", "Show Available Slots & Info")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
