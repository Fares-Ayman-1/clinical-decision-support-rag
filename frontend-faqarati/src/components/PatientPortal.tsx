/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent, useEffect } from "react";
import { mockExercises, mockTherapists } from "../mockData";
import { Dumbbell, Calendar, MessageSquare, Plus, Activity, Star, CheckCircle, TrendingUp, Heart, Video, Clock, Info, ShieldAlert } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { Appointment, ExerciseSessionLog, ExerciseSessionContext, Weekday } from "../types";

interface PatientPortalProps {
  currentUser: { name: string; email: string } | null;
  patientId: string;
  appointments: Appointment[];
  sessionLogs: ExerciseSessionLog[];
  initialTab?: "dashboard" | "routines" | "chat";
  scheduleRefreshKey?: number;
  onStartExercise: (ctx: ExerciseSessionContext) => void;
}

export default function PatientPortal({
  currentUser,
  patientId,
  appointments,
  sessionLogs,
  initialTab = "dashboard",
  scheduleRefreshKey = 0,
  onStartExercise,
}: PatientPortalProps) {
  const { lang, t, isRtl } = useLanguage();
  const [activeTab, setActiveTab] = useState<"dashboard" | "routines" | "chat">(initialTab);
  const [chatMessage, setChatMessage] = useState("");
  const [syncedSchedule, setSyncedSchedule] = useState<any>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    fetch(`/api/schedule/${patientId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.schedule) setSyncedSchedule(data.schedule);
      })
      .catch((err) => console.warn("Could not retrieve patient program:", err));
  }, [patientId, scheduleRefreshKey]);

  const [chatLog, setChatLog] = useState<Array<{ sender: "user" | "doctor"; text: string; time: string }>>([
    { 
      sender: "doctor", 
      text: t(
        "أهلاً بك يا بطل. لقد راجعت تقرير انحناء الفقرات الخاص بك، تمرين تمدد أسفل الظهر ممتاز ولكن يرجى الهدوء أثناء النزول.", 
        "Welcome back. I have reviewed your spinal curve alignment report, your lower back stretch is excellent but please slow down during extension."
      ), 
      time: t("أمس", "Yesterday") 
    },
    { 
      sender: "user", 
      text: t(
        "أهلاً دكتور، شكراً لك. هل أقوم بزيادة زاوية مرونة الفخذ؟", 
        "Hello Doctor, thank you. Should I increase the range of hip flexion?"
      ), 
      time: t("أمس", "Yesterday") 
    },
    { 
      sender: "doctor", 
      text: t(
        "نعم، النزول حتى زاوية 90 درجة للركبة مثالي جداً في تمرين القرفصاء اليوم.", 
        "Yes, lowering down to a 90-degree knee angle is perfectly optimal for today's recovery squats."
      ), 
      time: t("اليوم 10:30 صباحاً", "Today 10:30 AM") 
    }
  ]);

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    
    const userMsg = chatMessage;
    setChatLog((prev) => [
      ...prev,
      { sender: "user", text: userMsg, time: t("الآن", "Now") }
    ]);
    setChatMessage("");
    
    // Auto-respond for amazing conversational feel
    setTimeout(() => {
      setChatLog((prev) => [
        ...prev,
        { 
          sender: "doctor", 
          text: t(
            `تلقيت استفسارك الموقر: "${userMsg}". سأقوم بمراجعة زوايا حركتك القادمة وتحديث المعايير لك مساء اليوم.`, 
            `I received your medical question: "${userMsg}". I will review your upcoming pose accuracy logs and update your training criteria tonight.`
          ), 
          time: t("الآن", "Now") 
        }
      ]);
    }, 1500);
  };

  // Patient stats calculation
  const totalRepsDone = sessionLogs.length * 24; // simulated
  const avgAccuracy = sessionLogs.length > 0 
    ? (sessionLogs.reduce((acc, log) => acc + log.accuracyScore, 0) / sessionLogs.length).toFixed(1)
    : "91.8";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10" dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Header welcome */}
      <div className={`bg-slate-900 text-white rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-xl mb-8 flex flex-col md:flex-row justify-between items-center gap-6 ${isRtl ? "text-right" : "text-left"}`}>
        <div className="space-y-2 order-last md:order-first">
          <h2 className="text-2xl sm:text-3xl font-display font-black">
            {t("مرحباً بك،", "Welcome back,")} {currentUser?.name === "فاطمة محمد الأحمد" ? t("فاطمة محمد الأحمد", "Fatemah Mohammad Al-Ahmad") : (currentUser?.name || t("فاطمة محمد الأحمد", "Fatemah Mohammad Al-Ahmad"))} 👋
          </h2>
          <p className="text-slate-400 text-sm">
            {t(
              "أهلاً بك في جناح التأهيل الرقمي الخاص بك. خطتك الحركية للأسبوع الحالي قيد التشغيل بامتياز.",
              "Welcome to your dedicated tele-recovery workspace. Your custom physical therapeutic schedule is active and loaded."
            )}
          </p>
        </div>

        <div className="flex gap-4 items-center flex-shrink-0">
          <div className="bg-slate-800 border border-slate-700/60 p-3 rounded-2xl text-center min-w-28">
            <span className="block text-[10px] text-slate-450 font-bold">{t("الامتثال الأسبوعي", "Weekly Adherence")}</span>
            <span className="text-emerald-400 font-mono text-xl font-black">94.2%</span>
          </div>
          <div className="bg-slate-800 border border-slate-700/60 p-3 rounded-2xl text-center min-w-28">
            <span className="block text-[10px] text-slate-450 font-bold">{t("التمارين المنجزة", "Sessions Completed")}</span>
            <span className="text-cyan-400 font-mono text-xl font-black">{sessionLogs.length} {t("جلسات", "Sessions")}</span>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex gap-2.5 border-b border-slate-200 pb-px mb-8">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`px-5 py-2.5 font-bold text-sm sm:text-base border-b-2 cursor-pointer transition ${
            activeTab === "dashboard"
              ? "border-brand-500 text-brand-700 font-black"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t("لوحة المتابعة والرسم البياني", "Dashboard & Progress Graphs")}
        </button>
        <button
          onClick={() => setActiveTab("routines")}
          className={`px-5 py-2.5 font-bold text-sm sm:text-base border-b-2 cursor-pointer transition ${
            activeTab === "routines"
              ? "border-brand-500 text-brand-700 font-black"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t("تماريني النشطة", "My Prescribed Programs")} ({mockExercises.length})
        </button>
        <button
          onClick={() => setActiveTab("chat")}
          className={`px-5 py-2.5 font-bold text-sm sm:text-base border-b-2 cursor-pointer transition ${
            activeTab === "chat"
              ? "border-brand-500 text-brand-700 font-black"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t("المحادثة والاستشارة الطبية 💬", "Consultations & Doctor Chat 💬")}
        </button>
      </div>

      {/* Content panes based on tab selection */}
      {activeTab === "dashboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Block (Width 8/12): Weekly progress graph & upcoming appointments */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* SVG graph mockup representing Weekly accuracy */}
            <div className={`bg-white border border-slate-100 p-6 sm:p-8 rounded-3xl space-y-6 ${isRtl ? "text-right" : "text-left"}`}>
              <div className="flex justify-between items-center flex-row-reverse">
                <span className="text-xs text-slate-450 font-bold">{t("المقارنة اليومية للامتثال الحركي", "Daily Joint Mobility Parameters")}</span>
                <h3 className="font-display font-bold text-slate-800 text-base flex items-center gap-1.5">
                  <TrendingUp className="w-4.5 h-4.5 text-brand-500" />
                  <span>{t("الرسم البياني للمرونة وسجل الدقة (%)", "Range of Motion & Coordinate Accuracy Log (%)")}</span>
                </h3>
              </div>

              {/* Responsive SVG mock Chart */}
              <div className="h-48 w-full bg-slate-50/50 rounded-2xl border border-slate-100/50 p-4 flex items-end relative overflow-hidden" dir="ltr">
                
                {/* Horizontal gridlines */}
                <div className="absolute inset-x-0 top-1/4 h-px bg-slate-100/60"></div>
                <div className="absolute inset-x-0 top-2/4 h-px bg-slate-100/60"></div>
                <div className="absolute inset-x-0 top-3/4 h-px bg-slate-100/60"></div>

                <div className="w-full flex justify-between items-end h-full z-10 px-2 sm:px-6">
                  {/* Sun */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-brand-500 rounded-t-lg transition hover:scale-105" style={{ height: "110px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الأحد", "Sun")}</span>
                  </div>
                  {/* Mon */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-brand-600 rounded-t-lg transition hover:scale-105" style={{ height: "130px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الإثنين", "Mon")}</span>
                  </div>
                  {/* Tue */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-rose-400 rounded-t-lg transition hover:scale-105" style={{ height: "70px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الثلاثاء", "Tue")}</span>
                  </div>
                  {/* Wed */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-brand-500 rounded-t-lg transition hover:scale-105" style={{ height: "120px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الأربعاء", "Wed")}</span>
                  </div>
                  {/* Thu */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-brand-600 rounded-t-lg transition hover:scale-105" style={{ height: "145px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الخميس", "Thu")}</span>
                  </div>
                  {/* Fri */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-slate-200 rounded-t-lg transition hover:scale-105 animate-pulse" style={{ height: "30px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("الجمعة", "Fri")}</span>
                  </div>
                  {/* Sat */}
                  <div className="flex flex-col items-center gap-2 w-1/7">
                    <div className="w-6 sm:w-10 bg-slate-200 rounded-t-lg transition hover:scale-105 animate-pulse" style={{ height: "30px" }}></div>
                    <span className="text-[10px] text-slate-450 font-bold">{t("السبت", "Sat")}</span>
                  </div>
                </div>
              </div>

              <div className={`flex flex-col sm:flex-row justify-between items-center text-xs text-slate-500 pt-1 font-medium bg-slate-50 p-3 rounded-xl border border-slate-100 gap-2 ${isRtl ? "text-right" : "text-left"}`}>
                <span>{t("تنبيه: انخفاض الأداء يوم الثلاثاء ناتج عن شدّ زائد في فقرات القطنية.", "Clinical marker: Accuracy dip on Tuesday was core-related to minor lumbar stiffness.")}</span>
                <div className="flex items-center gap-1.5 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 block"></span>
                  <span>{t("أداء بحاجة لتدقيق", "Needs check")}</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-brand-500 block"></span>
                  <span>{t("أداء مثالي", "Perfect hold")}</span>
                </div>
              </div>

            </div>

            {/* Upcoming Appointments */}
            <div className={`bg-white border border-slate-100 p-6 rounded-3xl space-y-4 ${isRtl ? "text-right" : "text-left"}`}>
              <h3 className="font-display font-bold text-slate-900 text-lg">{t("جلسات البث العلاجية القادمة", "Your Scheduled Telehealth Consultations")}</h3>
              
              <div className="space-y-3">
                {appointments.map((app) => (
                  <div key={app.id} className="bg-slate-50 border border-slate-150 p-4.5 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="bg-brand-500 hover:bg-brand-600 text-slate-950 text-xs font-black px-4 py-2.5 rounded-xl flex items-center gap-1.5 cursor-pointer transition">
                        <Video className="w-4 h-4" />
                        <span>{t("دخول العيادة المرئية", "Launch Teletherapy Session")}</span>
                      </div>
                    </div>

                    <div className={`flex items-center gap-4.5 w-full sm:w-auto justify-between sm:justify-end ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                      <div className="text-right">
                        <h4 className="font-bold text-slate-800 text-base">{app.therapistName}</h4>
                        <div className="flex items-center gap-3.5 justify-end text-xs text-slate-500 mt-1 font-semibold">
                          <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-brand-500" /> {app.time}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-brand-500" /> {app.date}</span>
                        </div>
                      </div>

                      <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-800 font-bold flex items-center justify-center font-display text-sm">🩺</div>
                    </div>
                  </div>
                ))}

                {appointments.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-xs font-semibold bg-slate-50 border border-dashed rounded-xl">
                    {t("لا تتوفر جلسات كشف فيديو قادمة للأسبوع الجاري.", "No diagnostic teletherapy sessions scheduled for this week.")}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Right Block (Width 4/12): Patient Profile summary, target pain area */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Active Clinical Details */}
            <div className={`bg-brand-50/50 border border-brand-100 rounded-3xl p-6.5 space-y-5 ${isRtl ? "text-right" : "text-left"}`}>
              <h4 className="font-display font-black text-brand-900 text-base flex justify-start items-center gap-2">
                <Activity className="w-4.5 h-4.5" />
                <span>{t("التشخيص الحركي النشط", "Active Landmark Diagnosis")}</span>
              </h4>

              <div className="space-y-4 pt-1">
                <div className="bg-white p-3.5 rounded-xl border border-brand-200">
                  <span className="block text-[10px] text-slate-400 font-bold">{t("منطقة التركيز الرئيسية", "Primary Affected joint")}</span>
                  <span className="block text-base font-bold text-slate-900">{t("فقرات العمود الفقري وأسفل الظهر", "Lumbar Spine / Recurrent L4-L5 Pain")}</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-brand-200">
                  <span className="block text-[10px] text-slate-400 font-bold">{t("أخصائي المتابعة الرئيسي", "Treating PT Specialist")}</span>
                  <span className="block text-base font-bold text-slate-900">{t("د. أحمد الرويلي (MOH Registered)", "Dr. Ahmad Al-Ruwaili (Licensed MOH)")}</span>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-brand-200">
                  <span className="block text-[10px] text-slate-400 font-bold">{t("هدف زاوية تمدد الظهر", "Target Extension Angle Limit")}</span>
                  <span className="block text-base font-bold text-slate-900">١٤٥° - ١٧٥° {t("درجة تماثل", "degrees")}</span>
                </div>
              </div>
            </div>

            {/* Daily Streak target */}
            <div className={`bg-slate-50 border border-slate-100 rounded-3xl p-6 transition space-y-4 ${isRtl ? "text-right" : "text-left"}`}>
              <h4 className="font-display font-bold text-slate-800 text-sm">{t("معدل التعافي والامتزام", "Recovery Milestone Adherence")}</h4>
              <div className="flex justify-between items-center gap-4">
                <div className="w-2/3 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="w-[84%] h-full bg-emerald-500 rounded-full"></div>
                </div>
                <span className="font-mono font-bold text-xs text-slate-700">84% {t("الالتزام الذاتي", "Adherence")}</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t(
                  "أنت على بعد ٣ جلسات تدريبية متتالية مع مصحح المفاصل من الحصول على تقرير تحسن الرقبة التلقائي المصدّر لمعالجك.",
                  "Complete 3 consecutive camera-tracking session streaks to automatically generate and export your recovery timeline directly to your file."
                )}
              </p>
            </div>

          </div>

        </div>
      )}

      {/* Routines View panel */}
      {activeTab === "routines" && (
        <div className="space-y-8">
          
          {/* PT Prescribed Calendar Section */}
          {syncedSchedule && (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-xl space-y-6">
              <div className={`flex justify-between items-center border-b border-slate-800/60 pb-4 flex-wrap gap-2 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                <span className="text-[10px] bg-brand-500 text-slate-950 font-black px-2.5 py-1 rounded-md">
                  {t("جدول التتبع الحركي النشط ⚡", "Prescribed Tele-Rehab Calendar ⚡")}
                </span>
                <h3 className="font-display font-black text-slate-50 text-base sm:text-lg">
                  {t("خطة الاستشفاء الأسبوعية المعينة من معالجك", "Weekly Customized Posture Exercises Assigned By Specialist")}
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
                {Object.keys(syncedSchedule).map((day) => {
                  const dayNamesAr: Record<string, string> = {
                    "Sunday": t("الأحد", "Sunday"), 
                    "Monday": t("الإثنين", "Monday"), 
                    "Tuesday": t("الثلاثاء", "Tuesday"), 
                    "Wednesday": t("الأربعاء", "Wednesday"), 
                    "Thursday": t("الخميس", "Thursday"), 
                    "Friday": t("الجمعة", "Friday"), 
                    "Saturday": t("السبت", "Saturday")
                  };
                  const dayExercises = syncedSchedule[day] || [];

                  return (
                    <div key={day} className="bg-slate-900/60 border border-slate-850 rounded-2xl p-3 space-y-2 min-h-[140px] flex flex-col justify-between">
                      <div className={`border-b border-slate-800 pb-1 flex justify-between items-center ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="text-[9px] bg-brand-500/10 text-brand-400 font-mono px-1.5 rounded-full">{dayExercises.length}</span>
                        <span className="text-xs font-bold text-slate-300">{dayNamesAr[day]}</span>
                      </div>

                      <div className="flex-1 space-y-2 pt-2">
                        {dayExercises.map((e: any, idx: number) => (
                          <div key={idx} className="bg-slate-950 p-2.5 rounded-xl border border-slate-850 space-y-1.5 text-right relative">
                            <h4 className="font-bold text-[10.5px] text-slate-100">{isRtl ? e.nameAr : e.nameEn}</h4>
                            <span className="text-[9px] text-brand-400 font-mono block">
                              {e.sets} {t("مجموعات", "sets")} × {e.reps} {t("تكرار", "reps")}
                            </span>

                            {e.notes && (
                              <p className="text-[8.5px] text-slate-500 leading-normal mt-1 block">
                                {e.notes}
                              </p>
                            )}

                            <button
                              onClick={() =>
                                onStartExercise({
                                  planExerciseId: e.id,
                                  exerciseId: e.exerciseId || e.id || "ex-spine",
                                  nameAr: e.nameAr || "",
                                  nameEn: e.nameEn,
                                  targetSets: e.sets || 3,
                                  targetReps: e.reps || 10,
                                  holdTime: e.holdTime || 0,
                                  kimoreMin: e.kimoreMin ?? 145,
                                  kimoreMax: e.kimoreMax ?? 175,
                                  clinicalPrecaution: e.notes,
                                  scheduledDay: day as Weekday,
                                })
                              }
                              className="w-full mt-2 py-1 bg-brand-500 hover:bg-brand-600 text-slate-950 font-black text-[9px] rounded-md cursor-pointer transition flex items-center justify-center gap-1 border-0"
                            >
                              <Dumbbell className="w-2.5 h-2.5 text-slate-950" />
                              <span>{t("ابدأ تتبع الكاميرا", "Calibrate Camera")}</span>
                            </button>
                          </div>
                        ))}

                        {dayExercises.length === 0 && (
                          <div className="h-full flex items-center justify-center text-center py-4">
                            <span className="text-[9px] text-slate-600 font-semibold leading-relaxed">
                              {t("راحة واستشفاء", "Rest & Recover")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className={`flex justify-between items-center pt-4 flex-row-reverse`}>
            <p className="text-xs text-slate-500">{t("تمارين التوجيه الإضافية وتدريب المفاصل بالكاميرا لزيادة الامتثال.", "Additional guidance postures with real-time feedback thresholds.")}</p>
            <h3 className="font-display font-black text-slate-900 text-lg">{t("مكتبة حركات التأهيل العام لفقراتي", "Clinic's Comprehensive Therapeutics Catalog")}</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mockExercises.map((ex) => (
              <div 
                key={ex.id} 
                className={`bg-white border border-slate-150 p-6 rounded-3xl hover:border-brand-300 transition-all flex flex-col justify-between ${isRtl ? "text-right" : "text-left"}`}
              >
                <div className="space-y-4">
                  <div className={`flex justify-between items-start ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                    <span className="bg-brand-50 text-brand-800 font-mono font-black text-xs px-2.5 py-1 rounded-xl border border-brand-200">
                      {t("الزاوية المستهدفة:", "Ideal Angle Limit:")} {ex.idealAngleRange.min}° - {ex.idealAngleRange.max}°
                    </span>
                    <h4 className="font-display font-black text-slate-950 text-base sm:text-lg">
                      {t(ex.nameAr, ex.nameEn)}
                    </h4>
                  </div>

                  <p className="text-xs text-slate-650 leading-relaxed">
                    {t(ex.descriptionAr, ex.nameEn === "Lumbar Extension Stretch" ? "Spinal stretch to release neural compression." : ex.nameEn === "Cervical Spine Flexion" ? "Gentle lateral neck neck traction to relieve fatigue." : ex.nameEn)}
                  </p>

                  <div className={`flex justify-start gap-3.5 text-xs font-bold text-slate-500`}>
                    <span className="bg-slate-100 py-1 px-2.5 rounded-lg">
                      {t("المنطقة:", "Landmark:")} {t(ex.targetArea, ex.targetArea === "الرقبة" ? "Neck" : ex.targetArea === "الركبة" ? "Knee" : ex.targetArea === "الكتف" ? "Shoulder" : "Back")}
                    </span>
                    <span className="bg-slate-100 py-1 px-2.5 rounded-lg">
                      {t("توزيع المجموعات:", "Reps:")} {t(ex.recommendedDuration, "3 sets × 10 reps")}
                    </span>
                  </div>
                </div>

                <div className={`pt-6 mt-6 border-t border-slate-100 flex justify-between items-center ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                  <button
                    onClick={() =>
                      onStartExercise({
                        exerciseId: ex.id,
                        nameAr: ex.nameAr,
                        nameEn: ex.nameEn,
                        targetSets: 3,
                        targetReps: 10,
                        holdTime: 0,
                        kimoreMin: ex.idealAngleRange.min,
                        kimoreMax: ex.idealAngleRange.max,
                      })
                    }
                    className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-1.5 border-0"
                  >
                    <Dumbbell className="w-4 h-4 text-brand-200" />
                    <span>{t("ابدأ توجيه الذكاء الاصطناعي", "Start Vision Guidance")}</span>
                  </button>

                  <span className="text-[11px] text-slate-400 font-bold">
                    {t("آخر دقة مسجلة: ٩٦,٤%", "Recent Adherence: 96.4% Accuracy")}
                  </span>
                </div>

              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat pane panel */}
      {activeTab === "chat" && (
        <div className="bg-white border border-slate-150 rounded-3xl h-[550px] overflow-hidden grid grid-cols-1 md:grid-cols-12 text-right">
          
          {/* Right Col: Doctors directory list (Width 4/12) */}
          <div className="md:col-span-4 bg-slate-50/70 border-l border-slate-150 p-4 space-y-4 hidden md:block">
            <h4 className="font-display font-bold text-slate-800 text-sm">{t("قنوات الاتصال المعتمدة", "Verified Care Channels")}</h4>
            
            <div className="bg-white p-3.5 rounded-2xl border border-brand-200 shadow-xs flex items-center gap-3 justify-end">
              <div className="text-right">
                <h5 className="font-bold text-slate-900 text-sm">{t("د. أحمد الرويلي", "Dr. Ahmad Al-Ruwaili")}</h5>
                <span className="text-[10px] text-brand-700 bg-brand-50 px-2 py-0.5 rounded font-bold mt-1 inline-block">{t("الأخصائي المعالج", "Treating Therapist")}</span>
              </div>
              <img
                src={mockTherapists[0].avatarUrl}
                alt={mockTherapists[0].name}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full object-cover border border-slate-100"
              />
            </div>
          </div>

          {/* Left Col: Chat Area (Width 8/12) */}
          <div className="md:col-span-8 flex flex-col justify-between h-full bg-white">
            
            {/* Doctor header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-150 flex justify-between items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block animate-ping"></span>
              <div className="flex items-center gap-3 text-right">
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{t("استشارة الأخصائي: د. أحمد الرويلي", "Consultant: Dr. Ahmad Al-Ruwaili")}</h4>
                  <span className="text-[10px] text-slate-450 font-bold">{t("متصل الآن بالبوابة الطبية", "Online on care node")}</span>
                </div>
                <img
                  src={mockTherapists[0].avatarUrl}
                  alt={mockTherapists[0].name}
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full object-cover"
                />
              </div>
            </div>

            {/* Bubble Messages body */}
            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              {chatLog.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.sender === "user" ? "justify-start" : "justify-end"}`}
                >
                  <div className={`max-w-md p-3.5 rounded-2xl text-sm leading-relaxed text-right ${
                    msg.sender === "user"
                      ? "bg-slate-950 text-white rounded-tr-none text-left"
                      : "bg-brand-50 text-brand-950 rounded-tl-none border border-brand-100/60"
                  }`}>
                    <p>{msg.text}</p>
                    <span className="block text-[9px] text-slate-400 mt-1 font-mono">{msg.time}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Message input */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-150 flex gap-3">
              <button
                type="submit"
                className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl transition cursor-pointer border-0"
              >
                {t("أرسل النص", "Send")}
              </button>
              <input
                type="text"
                placeholder={t("اكتب استفسارك الطبي حركياً هنا...", "Type your clinical query here...")}
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 focus:border-brand-500 bg-slate-50 text-sm text-right"
              />
            </form>

          </div>

        </div>
      )}

    </div>
  );
}
