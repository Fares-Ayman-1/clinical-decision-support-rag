/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Sparkles, Play, ShieldAlert, CheckCircle2, ChevronLeft, ArrowLeft } from "lucide-react";
import { useLanguage } from "../LanguageContext";

interface HeroProps {
  onStartRecovery: () => void;
  onExploreAI: () => void;
}

export default function Hero({ onStartRecovery, onExploreAI }: HeroProps) {
  const { lang, t, isRtl } = useLanguage();

  // Simulator states for interactive posture demo in the hero card
  const [simulationStep, setSimulationStep] = useState(0); // 0: Idle, 1: Bending, 2: Perfect Squat, 3: Bad Back Angle
  const [kneeAngle, setKneeAngle] = useState(180);
  const [backAngle, setBackAngle] = useState(180);
  const [statusText, setStatusText] = useState("");
  const [statusCode, setStatusCode] = useState<"idle" | "good" | "bad">("idle");

  useEffect(() => {
    // Sync initial status text to avoid hydration mismatch
    setStatusText(t("جاهز للمراقبة (ابدأ الثني)", "Calibrated • Ready (Begin Bending)"));
  }, [lang]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSimulationStep((prev) => {
        const next = (prev + 1) % 4;
        if (next === 0) {
          setKneeAngle(180);
          setBackAngle(175);
          setStatusText(t("جاهز للمراقبة (ابدأ الثني)", "Calibrated • Ready (Begin Bending)"));
          setStatusCode("idle");
        } else if (next === 1) {
          setKneeAngle(135);
          setBackAngle(160);
          setStatusText(t("نزول تدريجي.. حافظ على الظهر مستقيماً", "Descending.. Keep spinal column straight"));
          setStatusCode("good");
        } else if (next === 2) {
          setKneeAngle(92);
          setBackAngle(155);
          setStatusText(t("زاوية ممتازة للركبة (92°)! تمرين صحيح ✅", "Excellent Knee Angle (92°)! Perfect Rep ✅"));
          setStatusCode("good");
        } else if (next === 3) {
          setKneeAngle(85);
          setBackAngle(120);
          setStatusText(t("تنبيه: قم بفرد ظهرك لتفادي الضغط! ❌", "Alert: Straighten your lower back! ❌"));
          setStatusCode("bad");
        }
        return next;
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [lang]);

  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-brand-50/75 via-white to-slate-50 pt-10 pb-20">
      {/* Absolute Decorative Blobs */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-brand-200/30 rounded-full blur-3xl -z-10 animate-pulse duration-[6000ms]"></div>
      <div className="absolute bottom-10 left-10 w-80 h-80 bg-clinical-100/40 rounded-full blur-3xl -z-10"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          {/* Right Side: Marketing Headline & CTAs (dynamic layout alignment) */}
          <div className={`lg:col-span-7 space-y-8 ${isRtl ? "text-right" : "text-left"}`}>
            <div className="inline-flex items-center gap-2 bg-brand-100/80 text-brand-900 font-bold px-4 py-2 rounded-full text-xs sm:text-sm shadow-xs border border-brand-200/50">
              <Sparkles className="w-4 h-4 text-brand-600 animate-spin" />
              <span>{t("مستقبل التأهيل الحركي: ذكاء اصطناعي وأخصائيون مرخصون", "Future of Physical Therapy: AI Posture & MOH Chiropractors")}</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-black text-slate-900 tracking-tight leading-tight">
              {t("علاجك الطبيعي في", "Your Physical Therapy at")} <span className="text-brand-600 underline decoration-brand-400 decoration-wavy">{t("منزلك", "Home")}</span> {t("بدقة العيادة!", "with Clinic Precision!")}
            </h1>

            <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
              {t(
                "افتح الكاميرا ودع محرك رؤية الكمبيوتر من مُعَالِجِي يوجه مفاصلك ويزن زواياك في الوقت الحقيقي. تدرّب بإرشاد مباشر من أخصائيين معتمدين من وزارة الصحة وبسرية وأمان تامين.",
                "Activate your camera stream and allow MyPhysio's real-time computer vision engine to calibrate your skeletal symmetry, track joint flex, and prevent pain. Exercise securely under direct remote care from certified therapists."
              )}
            </p>

            {/* Quick trust highlights */}
            <div className="grid grid-cols-2 gap-4 pb-4">
              <div className={`flex items-center gap-2.5 bg-white p-3.5 rounded-xl border border-slate-100 shadow-sm ${isRtl ? "text-right" : "text-left"}`}>
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0"></div>
                <div>
                  <h4 className="text-xs text-slate-400 font-bold">{t("حسابات الزوايا الحركية", "Kinematic Angle Tracking")}</h4>
                  <p className="text-sm font-semibold text-slate-800">{t("مباشر على المتصفح", "Native browser pipeline")}</p>
                </div>
              </div>

              <div className={`flex items-center gap-2.5 bg-white p-3.5 rounded-xl border border-slate-100 shadow-sm ${isRtl ? "text-right" : "text-left"}`}>
                <div className="w-2.5 h-2.5 rounded-full bg-brand-500 flex-shrink-0"></div>
                <div>
                  <h4 className="text-xs text-slate-400 font-bold">{t("الخصوصية والأمان", "Privacy & HIPAA Guard")}</h4>
                  <p className="text-sm font-semibold text-slate-800">{t("تشفير وحماية تامة للأجهزة", "No video saved, zero footprint")}</p>
                </div>
              </div>
            </div>

            {/* Interactive CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
              <button
                onClick={onStartRecovery}
                className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-base px-8 py-4 rounded-xl shadow-lg shadow-brand-500/20 hover:shadow-brand-600/30 transition-all transform hover:-translate-y-0.5 duration-200 cursor-pointer flex items-center justify-center gap-2 group"
              >
                <span>{t("ابدأ رحلة التعافي مجاناً", "Start Recovery Free")}</span>
                <ArrowLeft className={`w-5 h-5 transition-transform ${isRtl ? "group-hover:-translate-x-1" : "rotate-180 group-hover:translate-x-1"}`} />
              </button>

              <button
                onClick={onExploreAI}
                className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-base px-8 py-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-brand-600 text-brand-600" />
                <span>{t("جرّب المصحح الذكي (مباشر)", "Try AI Motion Corrector")}</span>
              </button>
            </div>

            {/* Regulatory Accreditation */}
            <div className="pt-2 flex items-center gap-3 text-slate-400">
              <span className="text-xs font-semibold">{t("بإشراف وتراخيص معتمدة من:", "Accredited and compliant with:")}</span>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-1 bg-emerald-50 border border-emerald-100/50 px-2.5 py-1 rounded text-emerald-800 font-mono text-[10px] font-bold">
                  <span>MOH CERTIFIED</span>
                </div>
                <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded text-blue-800 font-mono text-[10px] font-bold">
                  <span>HIPAA SECURE</span>
                </div>
              </div>
            </div>
          </div>

          {/* Left Side: Stunning Live Posture/Joint Simulation Mockup */}
          <div className="lg:col-span-5 relative">
            <div className="relative bg-slate-900 rounded-3xl p-4 shadow-2xl border-4 border-slate-800 overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60"></div>
              
              {/* Header inside simulated screen */}
              <div className="flex justify-between items-center bg-slate-950/80 px-3.5 py-2 rounded-xl text-neutral-300 text-xs mb-3 font-mono font-bold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping text-right"></span>
                  <span className="text-slate-400">{t("كاميرا الذاكرة العشوائية السريرية", "High-Speed AI Camera Feed")}</span>
                </div>
                <div className="bg-brand-500/20 text-brand-400 py-0.5 px-2 rounded border border-brand-500/30 text-[10px]">
                  {t("مصحح الذكاء الاصطناعي: مفعل", "AI CORRECTOR: ON")}
                </div>
              </div>

              {/* Graphical Skeleton Visualization Area */}
              <div className="relative h-72 sm:h-80 bg-slate-950 rounded-2xl flex items-center justify-center overflow-hidden">
                {/* Grid pattern background to render high-tech vibe */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-25"></div>

                {/* Patient silhouette and joints SVG drawing */}
                <svg viewBox="0 0 200 200" className="w-56 h-56 transition-all duration-700">
                  {/* Spine connection */}
                  <line x1="100" y1="45" x2="100" y2="105" stroke="#94a3b8" strokeWidth="2.5" />
                  
                  {/* Shoulder girdle */}
                  <line x1="75" y1="58" x2="125" y2="58" stroke="#06b6d4" strokeWidth="2.5" />

                  {/* Left arm */}
                  <line x1="75" y1="58" x2="60" y2="85" stroke="#06b6d4" strokeWidth="2" />
                  <line x1="60" y1="85" x2="55" y2="115" stroke="#06b6d4" strokeWidth="2" />

                  {/* Right arm */}
                  <line x1="125" y1="58" x2="140" y2="85" stroke="#06b6d4" strokeWidth="2" />
                  <line x1="140" y1="85" x2="145" y2="115" stroke="#06b6d4" strokeWidth="2" />

                  {/* Back Hips */}
                  <line x1="85" y1="105" x2="115" y2="105" stroke="#0f766e" strokeWidth="2.5" />

                  {/* Left Leg Hip-Knee-Ankle (Simulating squat flexion step) */}
                  <line 
                    x1="85" 
                    y1="105" 
                    x2={simulationStep >= 2 ? "62" : simulationStep === 1 ? "70" : "85"} 
                    y2={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    stroke={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    strokeWidth="3.5" 
                    className="transition-all duration-300"
                  />
                  <line 
                    x2={simulationStep >= 2 ? "62" : simulationStep === 1 ? "70" : "85"} 
                    y2={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    x1={simulationStep >= 2 ? "85" : "85"} 
                    y1="175" 
                    stroke={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    strokeWidth="3.5"
                    className="transition-all duration-300"
                  />

                  {/* Right Leg Hip-Knee-Ankle */}
                  <line 
                    x1="115" 
                    y1="105" 
                    x2={simulationStep >= 2 ? "138" : simulationStep === 1 ? "130" : "115"} 
                    y2={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    stroke={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    strokeWidth="3.5"
                    className="transition-all duration-300"
                  />
                  <line 
                    x2={simulationStep >= 2 ? "138" : simulationStep === 1 ? "130" : "115"} 
                    y2={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    x1={simulationStep >= 2 ? "115" : "115"} 
                    y1="175" 
                    stroke={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    strokeWidth="3.5"
                    className="transition-all duration-300"
                  />

                  {/* Joint node circles */}
                  <circle cx="100" cy="32" r="11" fill="#cbd5e1" stroke="#0d9488" strokeWidth="2.5" />
                  
                  <circle cx="75" cy="58" r="4.5" fill="#38bdf8" />
                  <circle cx="125" cy="58" r="4.5" fill="#38bdf8" />

                  {/* Left Knee tracking node with glowing ring */}
                  <circle 
                    cx={simulationStep >= 2 ? "62" : simulationStep === 1 ? "70" : "85"} 
                    cy={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    r="6" 
                    fill={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    className="transition-all duration-300"
                  />
                  <circle 
                    cx={simulationStep >= 2 ? "62" : simulationStep === 1 ? "70" : "85"} 
                    cy={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    r="12" 
                    fill="none" 
                    stroke={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    strokeWidth="1.5" 
                    className="animate-pulse-ring transition-all duration-300" 
                  />

                  {/* Right Knee tracking node */}
                  <circle 
                    cx={simulationStep >= 2 ? "138" : simulationStep === 1 ? "130" : "115"} 
                    cy={simulationStep >= 2 ? "125" : simulationStep === 1 ? "120" : "135"} 
                    r="6" 
                    fill={statusCode === "bad" ? "#ef4444" : "#14b8a6"} 
                    className="transition-all duration-300"
                  />
                </svg>

                {/* Animated real-time metrics box overlay inside stream */}
                <div className="absolute top-4 right-4 bg-slate-900/95 border border-slate-800 p-2.5 rounded-xl font-mono text-[10px] space-y-1 text-slate-350 shadow-md">
                  <div className="flex justify-between gap-4">
                    <span className="font-semibold text-brand-400">KNEE_R_ANG:</span>
                    <span className="text-slate-100 font-bold">{kneeAngle}°</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="font-semibold text-clinical-400">SPINE_ALIGN:</span>
                    <span className={`font-bold ${statusStepColor(statusCode)}`}>{backAngle}°</span>
                  </div>
                </div>

                <div className="absolute bottom-4 left-4 right-4 text-center">
                  <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-semibold shadow-xs border ${statusBadgeBg(statusCode)} transition-all duration-300`}>
                    {statusText}
                  </span>
                </div>
              </div>

              {/* Overlay simulation parameters controller */}
              <div className="mt-3.5 pt-3.5 border-t border-slate-800 flex justify-between items-center text-right">
                <span className="text-[11px] text-slate-400 font-bold">{t("مؤشر الدقة المسجل:", "Joint Calibration Score:")}</span>
                <div className="flex items-center gap-1.5">
                  <div className="text-right">
                    <div className="text-sm font-black text-emerald-400 font-mono">94.8%</div>
                  </div>
                  <div className="w-1.5 h-6 rounded-xs bg-slate-800">
                    <div className="w-full h-5/6 bg-emerald-400 rounded-xs"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Glowing feedback badge adjacent to simulation */}
            <div className="absolute -bottom-6 -right-6 bg-white p-4 rounded-2xl border border-slate-100 shadow-xl max-w-xs animate-bounce duration-[4000ms] hidden sm:block text-right">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100/70 text-emerald-700 rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-400">{t("تقييم الأسبوع الحالي", "Current Weekly Grade")}</h4>
                  <p className="text-sm font-bold text-slate-800">{t("امتثال حركي ممتاز (92%)", "Excellent Motor Compliance (92%)")}</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Helpers for simulation classes
function statusStepColor(code: "idle" | "good" | "bad") {
  if (code === "idle") return "text-slate-300";
  if (code === "good") return "text-emerald-400";
  return "text-red-400";
}

function statusBadgeBg(code: "idle" | "good" | "bad") {
  if (code === "idle") return "bg-slate-900 border-slate-800 text-slate-300";
  if (code === "good") return "bg-emerald-950/80 border-emerald-500/20 text-emerald-400";
  return "bg-red-950/80 border-red-500/30 text-red-400";
}
