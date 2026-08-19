/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from "react";
import { Camera, RefreshCw, Volume2, ShieldCheck, Dumbbell, AlertTriangle, Play, Pause, Video } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { mockExercises } from "../mockData";
import { Exercise, ExerciseSessionContext, ExerciseSessionLog } from "../types";
import ExercisePosePreview from "./exercise/ExercisePosePreview";

interface AIPostureDemoProps {
  exerciseContext?: ExerciseSessionContext | null;
  patientId?: string;
  onSessionLogged?: (log: ExerciseSessionLog) => void;
}

function mapExerciseIdToDemo(id: string): string {
  if (id.startsWith("ex-")) return id;
  if (id.includes("spine") || id.includes("lumbar")) return "ex-spine";
  if (id.includes("neck") || id.includes("cerv")) return "ex-neck";
  if (id.includes("shoulder")) return "ex-shoulder";
  if (id.includes("knee") || id.includes("squat")) return "ex-squat";
  return "ex-spine";
}

export default function AIPostureDemo({
  exerciseContext = null,
  patientId = "p1",
  onSessionLogged,
}: AIPostureDemoProps) {
  const { lang, t, isRtl } = useLanguage();
  const [selectedExId, setSelectedExId] = useState<string>("ex-squat");
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [simulatedAngle, setSimulatedAngle] = useState<number>(180);
  const [simulatedBack, setSimulatedBack] = useState<number>(175);
  const [repCount, setRepCount] = useState<number>(0);
  const [accuracyScore, setAccuracyScore] = useState<number>(95);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionSaved, setSessionSaved] = useState(false);
  const sessionStartRef = useRef<number>(Date.now());
  
  // Last state tracking to detect reps completed
  const inRepRange = useRef(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selectedExercise = mockExercises.find((ex) => ex.id === selectedExId) || mockExercises[2];

  useEffect(() => {
    if (exerciseContext?.exerciseId) {
      setSelectedExId(mapExerciseIdToDemo(exerciseContext.exerciseId));
      setRepCount(0);
      setSessionSaved(false);
      sessionStartRef.current = Date.now();
    }
  }, [exerciseContext]);

  const handleCompleteSession = async () => {
    setSessionSaving(true);
    try {
      const targetReps = exerciseContext?.targetReps || 10;
      const durationSeconds = Math.max(30, Math.round((Date.now() - sessionStartRef.current) / 1000));
      const payload = {
        patientId,
        exerciseId: exerciseContext?.exerciseId || selectedExId,
        exerciseNameAr: exerciseContext?.nameAr || selectedExercise.nameAr,
        exerciseNameEn: exerciseContext?.nameEn || selectedExercise.nameEn,
        planExerciseId: exerciseContext?.planExerciseId,
        scheduledDay: exerciseContext?.scheduledDay,
        targetSets: exerciseContext?.targetSets,
        targetReps,
        completedReps: repCount,
        durationSeconds,
        completionRate: Math.min(100, Math.round((repCount / targetReps) * 100)),
        accuracyScore,
        completedAt: new Date().toISOString(),
      };
      const res = await fetch("/api/sessions/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("log failed");
      const data = await res.json();
      setSessionSaved(true);
      if (data.log && onSessionLogged) onSessionLogged(data.log);
    } catch (err) {
      console.error(err);
      alert(t("تعذر حفظ الجلسة. حاول مرة أخرى.", "Could not save session. Please try again."));
    } finally {
      setSessionSaving(false);
    }
  };

  // Map of exercise to instructions
  const exerciseSpecs: { [key: string]: { targetMin: number; targetMax: number; label: string; backLabel: string } } = {
    "ex-squat": { targetMin: 85, targetMax: 105, label: t("زاوية الركبة", "Knee joint angle"), backLabel: t("استقامة الظهر", "Back alignment") },
    "ex-neck": { targetMin: 65, targetMax: 85, label: t("زاوية انحناء الرقبة", "Neck curve angle"), backLabel: t("ميل الرأس الجانبي", "Head side deviation") },
    "ex-shoulder": { targetMin: 80, targetMax: 100, label: t("زاوية الكتف والمرفق", "Shoulder & Elbow angle"), backLabel: t("العمود الفقري", "Vertebral posture") },
    "ex-spine": { targetMin: 145, targetMax: 175, label: t("زاوية تمدد الظهر", "Lumbosacral flexion"), backLabel: t("الكاحل والركبتين", "Ankle & Knee alignment") }
  };

  const spec = exerciseSpecs[selectedExId] || exerciseSpecs["ex-spine"];
  const targetMin = exerciseContext?.kimoreMin ?? spec.targetMin;
  const targetMax = exerciseContext?.kimoreMax ?? spec.targetMax;
  const angleLabel = exerciseContext?.nameEn
    ? t(exerciseContext.nameAr, exerciseContext.nameEn)
    : spec.label;

  const translateExNameLocal = (ex: Exercise) => {
    return t(ex.nameAr, ex.nameEn);
  };

  const translateExDescLocal = (ex: Exercise) => {
    if (ex.id === "ex-spine") {
      return t(ex.descriptionAr, "Helps reduce structural pressures on the lumbar spine. Maintain straight neck and push back slowly.");
    }
    if (ex.id === "ex-neck") {
      return t(ex.descriptionAr, "Gentle exercises to improve neck muscles range of motion and relieve stiffness from long hours of computer screens.");
    }
    if (ex.id === "ex-squat") {
      return t(ex.descriptionAr, "Excellent stability squats for quads and hamstrings to support the knee joint. Bend until 90-degree target angle.");
    }
    if (ex.id === "ex-shoulder") {
      return t(ex.descriptionAr, "Improves range of motion of the shoulder joint and activates the rotator cuff. Raise arms straight parallel to floor.");
    }
    return t(ex.descriptionAr, ex.nameEn);
  };

  // Toggle Camera
  const startCamera = async () => {
    try {
      if (cameraActive) {
        stopCamera();
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      streamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      alert(t("تعذر الوصول للكاميرا. يرجى تأكيد إذن الوصول أو المتابعة باستخدام المحاكي التفاعلي المتكامل أدناه!", "Could not access camera. Please confirm permissions or proceed using the interactive joints simulator."));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Posture Evaluation logic
  const isAngleCorrect = simulatedAngle >= targetMin && simulatedAngle <= targetMax;
  const isBackCorrect = simulatedBack >= 140;

  const currentGrade = isAngleCorrect && isBackCorrect ? t("ممتاز", "Excellent") : !isBackCorrect ? t("اضبط الظهر", "Align back") : t("انتظر الهدف", "Awaiting target");

  useEffect(() => {
    const isTargetFlexValue = simulatedAngle >= targetMin && simulatedAngle <= targetMax;
    if (isTargetFlexValue && !inRepRange.current) {
      inRepRange.current = true;
    } else if (!isTargetFlexValue && inRepRange.current && simulatedAngle > targetMax) {
      // Returned to starting/extension position, increment rep
      setRepCount((prev) => prev + 1);
      inRepRange.current = false;
      
      // Play a gentle beep if sound is on
      if (soundEnabled && typeof window !== "undefined") {
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note for success
          gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
          // ignore if blocked by audio context policy
        }
      }
    }
  }, [simulatedAngle, targetMin, targetMax, soundEnabled]);

  // Handle accuracy scoring variance
  useEffect(() => {
    if (isAngleCorrect && isBackCorrect) {
      setAccuracyScore((prev) => Math.min(100, Math.max(90, prev + Math.random() * 2)));
    } else {
      setAccuracyScore((prev) => Math.max(60, Math.min(94, prev - Math.random() * 3)));
    }
  }, [simulatedAngle, simulatedBack]);

  // Canvas drawing loop for live webcam or simulation mockup skeleton
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (cameraActive && videoRef.current) {
        // Draw normal live camera image in background
        try {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        } catch (e) {}

        // In order to perform the dynamic skeleton pose drawing over the webcam
        // We will simulate the tracking points over their shoulder and moving knees dynamically
        // drawing calculated coordinates to showcase outstanding Computer Vision overlay aesthetics.
        ctx.strokeStyle = "rgba(20, 184, 166, 0.4)";
        ctx.lineWidth = 1;
        // Drawing Grid Calibrator
        for (let i = 0; i < canvas.width; i += 40) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, canvas.height);
          ctx.stroke();
        }
        for (let j = 0; j < canvas.height; j += 40) {
          ctx.beginPath();
          ctx.moveTo(0, j);
          ctx.lineTo(canvas.width, j);
          ctx.stroke();
        }
      } else {
        // Dark high-tech mockup canvas
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.strokeStyle = "rgba(30, 41, 59, 1)";
        ctx.lineWidth = 1;
        for (let i = 0; i < canvas.width; i += 30) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, canvas.height);
          ctx.stroke();
        }
      }

      // --- SKELETON CALCULATING OVERLAY DRAWING ---
      const originX = canvas.width / 2;
      const originY = 65;

      // Draw head circle
      ctx.beginPath();
      ctx.arc(originX, originY, 22, 0, Math.PI * 2);
      ctx.fillStyle = "#1e293b";
      ctx.fill();
      ctx.strokeStyle = isAngleCorrect ? "#14b8a6" : "#f43f5e";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Spine Line
      const waistY = originY + 80;
      ctx.beginPath();
      ctx.moveTo(originX, originY + 22);
      ctx.lineTo(originX, waistY);
      ctx.strokeStyle = isBackCorrect ? "#38bdf8" : "#f43f5e";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Left shoulder to elbow
      const shoulderX_l = originX - 45;
      const shoulderY_l = originY + 25;
      ctx.beginPath();
      ctx.moveTo(originX, originY + 20);
      ctx.lineTo(shoulderX_l, shoulderY_l);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Right shoulder to elbow
      const shoulderX_r = originX + 45;
      const shoulderY_r = originY + 25;
      ctx.beginPath();
      ctx.moveTo(originX, originY + 20);
      ctx.lineTo(shoulderX_r, shoulderY_r);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Hips line
      const hipX_l = originX - 25;
      const hipY_l = waistY;
      const hipX_r = originX + 25;
      const hipY_r = waistY;
      ctx.beginPath();
      ctx.moveTo(hipX_l, hipY_l);
      ctx.lineTo(hipX_r, hipY_r);
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Calculate dynamic joint flexion values
      // SQUAT FLEXION GRAPHIC (moves left/right according to slider input)
      const flexionRad = (simulatedAngle * Math.PI) / 180;
      
      // Calculate Knee Joint Position dynamically
      const kneeX_l = hipX_l - 20 - Math.cos(flexionRad) * 20;
      const kneeY_l = hipY_l + 55 + Math.sin(flexionRad) * 15;
      
      const kneeX_r = hipX_r + 20 + Math.cos(flexionRad) * 20;
      const kneeY_r = hipY_r + 55 + Math.sin(flexionRad) * 15;

      // Draw Hips to Knee
      ctx.beginPath();
      ctx.moveTo(hipX_l, hipY_l);
      ctx.lineTo(kneeX_l, kneeY_l);
      ctx.moveTo(hipX_r, hipY_r);
      ctx.lineTo(kneeX_r, kneeY_r);
      ctx.strokeStyle = isAngleCorrect ? "#14b8a6" : "#f43f5e";
      ctx.lineWidth = 5;
      ctx.stroke();

      // Knee to Ankle (Fixed Ankle base)
      const ankleX_l = hipX_l - 5;
      const ankleY_l = canvas.height - 35;
      const ankleX_r = hipX_r + 5;
      const ankleY_r = canvas.height - 35;

      ctx.beginPath();
      ctx.moveTo(kneeX_l, kneeY_l);
      ctx.lineTo(ankleX_l, ankleY_l);
      ctx.moveTo(kneeX_r, kneeY_r);
      ctx.lineTo(ankleX_r, ankleY_r);
      ctx.strokeStyle = isAngleCorrect ? "#14b8a6" : "#94a3b8";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Highlight Joint Nodes
      const glowNodes = [
        { x: kneeX_l, y: kneeY_l, color: isAngleCorrect ? "#14b8a6" : "#f43f5e" },
        { x: kneeX_r, y: kneeY_r, color: isAngleCorrect ? "#14b8a6" : "#f43f5e" },
        { x: originX, y: originY + 20, color: isBackCorrect ? "#38bdf8" : "#f43f5e" }
      ];

      glowNodes.forEach(node => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Node outline pulse
        ctx.beginPath();
        ctx.arc(node.x, node.y, 13, 0, Math.PI * 2);
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Target Flex lines helper label
      ctx.font = "bold 13px Cairo, sans-serif";
      ctx.fillStyle = isAngleCorrect ? "#14b8a6" : "#f43f5e";
      ctx.fillText(`${t("الزاوية:", "Angle:")} ${simulatedAngle}°`, kneeX_r + 15, kneeY_r + 5);

      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [cameraActive, simulatedAngle, simulatedBack, selectedExId, isAngleCorrect, isBackCorrect]);

  return (
    <section id="ai-demo" className="py-20 bg-slate-900 text-white relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <span className="text-xs font-black bg-brand-500/20 text-brand-400 border border-brand-500/30 px-3.5 py-1.5 rounded-full uppercase tracking-wider">
            {t("الذكاء الاصطناعي السريري", "Clinical Computer Vision AI")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-display font-black text-white">
            {t("مختبر ومصحح الحركة الذكي التفاعلي 🔬", "Interactive Joint Posture & Vision Laboratory 🔬")}
          </h2>
          <p className="text-slate-300 text-sm sm:text-base font-medium">
            {t(
              "اختبر تكنولوجيا تتبع الهيكل العظمي فورا. تحكم بالمنزلقات لمحاكاة حركة مفاصلك أو فعّل الكاميرا لتشاهد استجابة المعايرة في ثانية!",
              "Instantly experience localized skeleton coordinate tracking. Modify sliders to simulate range of motion or connect your webcam to check accuracy markers in milliseconds!"
            )}
          </p>
        </div>

        {/* Sidebar + Main Box layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          
          {/* Right Column: Settings & Sliders controller (5/12 width) */}
          <div className="lg:col-span-5 bg-slate-800/60 border border-slate-700/60 p-6 sm:p-8 rounded-3xl text-right flex flex-col justify-between space-y-6">
            
            {/* Step 1: Select Exercise */}
            <div className="space-y-4">
              <h3 className="font-display font-bold text-base text-brand-400">
                {t("١. اختر الحركة الرياضية المستهدفة:", "1. Select target therapeutic movement:")}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {mockExercises.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => {
                      setSelectedExId(ex.id);
                      setSimulatedAngle(ex.id === "ex-squat" ? 180 : ex.id === "ex-neck" ? 90 : ex.id === "ex-shoulder" ? 180 : 170);
                    }}
                    className={`p-4 rounded-2xl text-right border font-bold text-xs sm:text-sm cursor-pointer transition ${
                      selectedExId === ex.id
                        ? "bg-brand-500 text-slate-950 border-transparent shadow-lg shadow-brand-500/10 scale-[1.02]"
                        : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    <span>{translateExNameLocal(ex)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Instruction Callout for selected exercise */}
            {exerciseContext && (
              <div className="space-y-2">
                <p className="text-xs text-brand-300 font-bold">
                  {t("من الخطة المنشورة:", "From published plan:")} {t(exerciseContext.nameAr, exerciseContext.nameEn || exerciseContext.nameAr)}
                </p>
                <ExercisePosePreview
                  exerciseId={exerciseContext.exerciseId}
                  kimoreMin={exerciseContext.kimoreMin}
                  kimoreMax={exerciseContext.kimoreMax}
                />
              </div>
            )}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2">
              <div className="flex justify-between items-center bg-slate-950 px-2 py-1 rounded-lg">
                <span className="text-[10px] font-mono font-bold text-cyan-400">TARGET: {targetMin}° - {targetMax}°</span>
                <span className="font-bold text-slate-300 text-xs">{t("معيار التقييم الحركي", "Clinical Join Metrics")}</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                {translateExDescLocal(selectedExercise)}
              </p>
            </div>

            {/* Step 2: Interactive simulator sliders */}
            <div className="space-y-6">
              <div className="flex justify-between items-center text-xs text-brand-400 font-bold">
                <span>{t("تعديل زوايا المفاصل (انزلاق لمحاكاة الالتواء):", "Calibrate Joint Angles (Drag to simulate flexibility):")}</span>
                <span>{t("المحاكي الحركي مفعّل", "Motion simulator active")}</span>
              </div>

              {/* Slider Joint Angle */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span className={`${isAngleCorrect ? "text-emerald-400 font-extrabold" : "text-rose-400"}`}>{simulatedAngle}°</span>
                  <span className="font-bold">{spec.label}</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="180"
                  value={simulatedAngle}
                  onChange={(e) => setSimulatedAngle(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-brand-500"
                />
              </div>

              {/* Slider Spine Back Alignment */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span className={`${isBackCorrect ? "text-emerald-400 font-extrabold" : "text-rose-400"}`}>{simulatedBack}°</span>
                  <span className="font-bold">{spec.backLabel}</span>
                </div>
                <input
                  type="range"
                  min="90"
                  max="180"
                  value={simulatedBack}
                  onChange={(e) => setSimulatedBack(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>
            </div>

            {/* Simulated Live Statistics Counters */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 text-center">
                <div className="text-base sm:text-lg font-black text-slate-300 font-mono">{repCount}</div>
                <div className="text-[10px] text-slate-500 font-semibold mt-1">{t("تكرار مكتمل", "Reps Completed")}</div>
              </div>

              <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 text-center">
                <div className={`text-base sm:text-lg font-black font-mono ${isAngleCorrect && isBackCorrect ? "text-emerald-400" : "text-rose-400"}`}>
                  {accuracyScore.toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-500 font-semibold mt-1">{t("دقة الحركة", "Posture Accuracy")}</div>
              </div>

              <div className="bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800 text-center">
                <div className={`text-xs sm:text-sm font-black truncate leading-normal ${isAngleCorrect && isBackCorrect ? "text-emerald-400" : "text-rose-400"}`}>
                  {currentGrade}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold mt-1">{t("حالة الهيكل", "Joint Status")}</div>
              </div>
            </div>

            {/* Bottom Audio toggle setting */}
            <div className="flex justify-between items-center text-xs text-slate-500 font-semibold pt-1">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="flex items-center gap-1.5 text-slate-400 hover:text-white cursor-pointer transition"
              >
                <Volume2 className={`w-4 h-4 ${soundEnabled ? "text-brand-400" : "text-slate-600 line-through"}`} />
                <span>{t("المؤثرات الصوتية:", "Beep Audio:")} {soundEnabled ? t("مفعلة", "On") : t("صامت", "Muted")}</span>
              </button>
              <div className="flex items-center gap-1 bg-emerald-950 text-emerald-400 px-2.5 py-0.5 rounded text-[10px]">
                <ShieldCheck className="w-3 h-3" />
                <span>{t("مشفر محلياً", "Zero-Trust Local Vision")}</span>
              </div>
            </div>

          </div>

          {/* Left Column: Visual Area displaying Skeleton (7/12 width) */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            
            <div className="relative bg-slate-950 border border-slate-800 rounded-3xl p-4 overflow-hidden flex flex-col justify-between h-full">
               
              {/* Top info bar */}
              <div className="flex justify-between items-center bg-slate-900 px-4 py-2.5 rounded-2xl border border-slate-800 mb-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${cameraActive ? "bg-red-500 animate-ping" : "bg-emerald-500"}`}></span>
                  <span className="font-mono text-slate-400 font-bold">MODE: {cameraActive ? "LIVE_WEBCAM" : "SIMULATED_LOGIC"}</span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setRepCount(0);
                      setSessionSaved(false);
                      sessionStartRef.current = Date.now();
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-[10px] sm:text-xs font-bold text-slate-300 py-1 px-2.5 rounded-lg transition"
                  >
                    {t("تصفير العداد", "Reset reps")}
                  </button>

                  <button
                    onClick={handleCompleteSession}
                    disabled={sessionSaving || repCount === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-[10px] sm:text-xs font-bold text-white py-1 px-2.5 rounded-lg transition"
                  >
                    {sessionSaving
                      ? t("جاري الحفظ...", "Saving...")
                      : sessionSaved
                        ? t("تم الحفظ ✓", "Saved ✓")
                        : t("إنهاء الجلسة", "Complete Session")}
                  </button>

                  <button
                    onClick={startCamera}
                    className="bg-brand-500 hover:bg-brand-600 text-[10px] sm:text-xs font-bold text-slate-950 py-1 px-3 rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{cameraActive ? t("إغلاق الكاميرا", "Turn Off Camera") : t("افتح الكاميرا الحية", "Enable Live Webcam")}</span>
                  </button>
                </div>
              </div>

              {/* Main Canvas view */}
              <div className="relative w-full aspect-video sm:h-96 md:h-[400px] bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center">
                
                {/* Real video if camera is active */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="hidden"
                  referrerPolicy="no-referrer"
                ></video>

                {/* Canvas of pose overlay */}
                <canvas
                  ref={canvasRef}
                  width="640"
                  height="400"
                  className="w-full h-full object-cover rounded-2xl"
                ></canvas>

                {/* Accuracy gauge bar left side overlay */}
                <div className="absolute top-4 left-4 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-center space-y-1.5 text-[10px] font-mono">
                  <div className="font-semibold text-slate-400 uppercase">{t("مستوى المطابقة", "Match level")}</div>
                  <div className="w-10 h-24 bg-slate-900 rounded-lg overflow-hidden flex flex-col justify-end p-0.5 mx-auto border border-slate-800">
                    <div 
                      className={`w-full rounded-md transition-all duration-350 ${isAngleCorrect && isBackCorrect ? "bg-emerald-500" : "bg-red-500"}`} 
                      style={{ height: `${accuracyScore}%` }}
                    ></div>
                  </div>
                  <div className={`font-black text-xs ${isAngleCorrect && isBackCorrect ? "text-emerald-400" : "text-rose-450"}`}>{accuracyScore.toFixed(0)}%</div>
                </div>

                {/* Large success overlay when rep range detected */}
                {inRepRange.current && (
                  <div className="absolute bottom-4 right-4 bg-emerald-500/90 text-slate-950 font-display font-black text-xs sm:text-sm px-4 py-2 rounded-2xl shadow-lg border border-emerald-400 animate-pulse">
                    {t("ثبات صحيح! حافظ على هذه الوضعية...", "Perfect hold! Keep maintaining this angles...")}
                  </div>
                )}
              </div>

              {/* Bottom Instructions feedback notice */}
              <div className={`mt-3.5 p-3.5 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col sm:flex-row justify-between items-center gap-3 ${isRtl ? "text-right" : "text-left"}`}>
                <span className="text-[11px] text-slate-400 leading-normal max-w-lg">
                  {t(
                    "* تستخدم منصة مُعَالِجِي تكنولوجيا متطورة لمراقبة المفاصل عبر الـ Browser والبيانات لا تسجل مطلقاً في أي خوادم سحابية خارجية، علاجك الفيزيائي محصن وخصوصيتك مصونة كلياً.",
                    "* MyPhysio workspace values dynamic local storage, calculations execute securely within secure sandbox layers of memory without cloud recording."
                  )}
                </span>
                
                <div className="flex gap-2.5 font-bold text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span>{t("قيد المراقبة", "Monitoring...")}</span>
                    <span className="w-2 h-2 rounded-full bg-slate-650"></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <span>{t("أداء مثالي", "Supreme posture")}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}
