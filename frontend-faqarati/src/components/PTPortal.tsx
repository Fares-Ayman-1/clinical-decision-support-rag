/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, FormEvent, useRef } from "react";
import { mockExercises } from "../mockData";
import { useLanguage } from "../LanguageContext";
import { Therapist, ExerciseSessionLog } from "../types";
import ExercisePosePreview from "./exercise/ExercisePosePreview";
import PTScheduleTab from "./pt/PTScheduleTab";
import PTMessagesTab from "./pt/PTMessagesTab";
import PTClinicalAssistantTab from "./pt/PTClinicalAssistantTab";
import { 
  Users, Calendar, Clock, PlayCircle, Plus, FileSpreadsheet, 
  Ruler, CheckCircle, Search, Settings, Sparkles, BookOpen, 
  ShieldAlert, Check, Trash2, ArrowLeftRight, Activity, 
  HelpCircle, Eye, RefreshCw, Send, AlertCircle, TrendingUp, Info, User, MessageSquare, Stethoscope
} from "lucide-react";

interface PTPortalProps {
  currentDoctor: Therapist | null;
  initialTab?: "dashboard" | "copilot_workspace" | "reports" | "schedule" | "messages" | "wallet" | "settings" | "clinical_assistant";
  onUpdatePatientPlan?: (patientId: string, plan: any) => void;
}

interface ComplianceLogRow {
  id: string;
  patientName: string;
  exerciseName: string;
  accuracy: number;
  repsDone: number;
  durationLabel: string;
  dateLabel: string;
}

interface EinsteinSuggestion {
  exercise_id: string;
  name_ar: string;
  name_en: string;
  suggested_sets: number;
  suggested_reps: number;
  confidence_score: number;
  target_muscle: string;
  reasoning_ar: string;
  reasoning_en?: string;
  kimore_thresholds: {
    min: number;
    max: number;
  };
}

interface ScheduledExercise {
  id: string; // unique instance ID for drag-drop purposes
  exerciseId: string; // references FitKG ID
  nameAr: string;
  nameEn: string;
  sets: number;
  reps: number;
  holdTime: number;
  clinicalPrecaution: string;
  notes: string;
  targetMuscle: string;
  kimoreMin: number;
  kimoreMax: number;
}

interface ChatMessage {
  id: string;
  sender: "pt" | "einstein";
  text: string;
  timestamp: string;
  exercises?: EinsteinSuggestion[];
}

interface PatientRecord {
  id: string;
  nameAr: string;
  nameEn: string;
  age: number;
  painAreaName: "spinal" | "neck" | "knee";
  severityAr: string;
  severityEn: string;
  joinDate: string;
  diagnosisAr: string;
  diagnosisEn: string;
  triageNotesAr: string;
  triageNotesEn: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const DAY_LABELS: Record<string, { ar: string; en: string; shortAr: string; shortEn: string }> = {
  Monday: { ar: "الإثنين", en: "Monday", shortAr: "إث", shortEn: "Mon" },
  Tuesday: { ar: "الثلاثاء", en: "Tuesday", shortAr: "ث", shortEn: "Tue" },
  Wednesday: { ar: "الأربعاء", en: "Wednesday", shortAr: "أر", shortEn: "Wed" },
  Thursday: { ar: "الخميس", en: "Thursday", shortAr: "خ", shortEn: "Thu" },
  Friday: { ar: "الجمعة", en: "Friday", shortAr: "ج", shortEn: "Fri" },
  Saturday: { ar: "السبت", en: "Saturday", shortAr: "س", shortEn: "Sat" },
  Sunday: { ar: "الأحد", en: "Sunday", shortAr: "أح", shortEn: "Sun" },
};

export default function PTPortal({ currentDoctor, initialTab = "copilot_workspace", onUpdatePatientPlan }: PTPortalProps) {
  const { lang, t, isRtl } = useLanguage();

  const timeLocale = lang === "ar" ? "ar-SA" : "en-US";
  const formatTime = () =>
    new Date().toLocaleTimeString(timeLocale, { hour: "2-digit", minute: "2-digit" });

  const dayLabel = (day: string) => {
    const d = DAY_LABELS[day];
    return d ? t(d.ar, d.en) : day;
  };

  const dayShortLabel = (day: string) => {
    const d = DAY_LABELS[day];
    return d ? t(d.shortAr, d.shortEn) : day.slice(0, 3);
  };

  const painAreaLabel = (area: PatientRecord["painAreaName"]) => {
    if (area === "spinal") return t("أسفل الظهر للقطنية", "Lumbar / lower back");
    if (area === "neck") return t("الفقرات العنقية للأكتاف", "Cervical / neck & shoulders");
    return t("مفصل الركبة", "Knee joint");
  };

  const painAreaShort = (area: PatientRecord["painAreaName"]) => {
    if (area === "spinal") return t("أسفل الظهر", "Lower back");
    if (area === "neck") return t("الرقبة", "Neck");
    return t("الركبة", "Knee");
  };

  const painHotspotLabel = (area: PatientRecord["painAreaName"]) => {
    if (area === "spinal") return t("🔴 ديسك أسفل الظهر (L4-L5)", "🔴 Lower back disc (L4-L5)");
    if (area === "neck") return t("🔴 مرونة تشنج العنق والأكتاف", "🔴 Neck & shoulder stiffness");
    return t("🔴 زاوية صلابة مفصل الركبة", "🔴 Knee joint stiffness");
  };

  const exerciseDisplayName = (item: { nameAr?: string; nameEn?: string; name_ar?: string; name_en?: string }) =>
    lang === "ar"
      ? item.nameAr || item.name_ar || item.nameEn || item.name_en || ""
      : item.nameEn || item.name_en || item.nameAr || item.name_ar || "";

  const exerciseReasoning = (item: { reasoning_ar?: string; reasoning_en?: string; name_en?: string }) =>
    lang === "ar"
      ? item.reasoning_ar || ""
      : item.reasoning_en ||
        `Recommended for ${item.name_en || "this case"}. Drag to the weekly calendar to assign.`;

  const formatHoldLabel = (hold: number) =>
    hold > 0 ? t(`ثبات: ${hold}ث`, `Hold: ${hold}s`) : t("حركة مرنة", "Dynamic motion");

  const formatSetsReps = (sets: number, reps: number) =>
    t(`${sets}م × ${reps}تكرار`, `${sets} sets × ${reps} reps`);
  const [activeTab, setActiveTab] = useState<"dashboard" | "copilot_workspace" | "reports" | "schedule" | "messages" | "wallet" | "settings" | "clinical_assistant">(initialTab);
  const [catalogExercises, setCatalogExercises] = useState<any[]>([]);
  const [complianceLogs, setComplianceLogs] = useState<ComplianceLogRow[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("p1");
  const [searchQuery, setSearchQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  
  // Weekly Schedule State from Monday to Sunday as required
  const [schedule, setSchedule] = useState<Record<string, ScheduledExercise[]>>({
    "Monday": [
      {
        id: "sch-1",
        exerciseId: "ext_spine_01",
        nameAr: "تمديد العمود الفقري للقطنية",
        nameEn: "Lumbar Extension Stretch",
        sets: 3,
        reps: 10,
        holdTime: 5,
        clinicalPrecaution: "حافظ على ثبات الرقبة أثناء الدفع",
        notes: "تمارين استرخاء خفيفة صباحية لتقوية العمود الفقري",
        targetMuscle: "العضلات القطنية أسفل الظهر",
        kimoreMin: 145,
        kimoreMax: 175
      }
    ],
    "Tuesday": [],
    "Wednesday": [
      {
        id: "sch-2",
        exerciseId: "knee_squat_01",
        nameAr: "تمرين القرفصاء التأهيلي للركبة",
        nameEn: "Rehab Squats for Knees",
        sets: 3,
        reps: 8,
        holdTime: 0,
        clinicalPrecaution: "النزول بزاوية ٩٠ درجة فقط لتفادي تآكل الغضروف",
        notes: "خذ فترات راحة ٢٠ ثانية بين المجموعات",
        targetMuscle: "العضلة رباعية الرؤوس",
        kimoreMin: 85,
        kimoreMax: 105
      }
    ],
    "Thursday": [],
    "Friday": [],
    "Saturday": [],
    "Sunday": []
  });

  // Local simulated patients (bilingual)
  const patientsList: PatientRecord[] = [
    {
      id: "p1",
      nameAr: "فاطمة محمد الأحمد",
      nameEn: "Fatemah Mohammad Al-Ahmad",
      age: 34,
      painAreaName: "spinal",
      severityAr: "متوسطة",
      severityEn: "Moderate",
      joinDate: "2026-05-12",
      diagnosisAr: "انزلاق غضروفي بالفقرتين L4-L5",
      diagnosisEn: "L4-L5 disc herniation",
      triageNotesAr: "ألم حاد بأسفل الظهر، مستوى الألم 7/10، شد عضلي عند الانحناء",
      triageNotesEn: "Acute lower back pain, pain level 7/10, muscle tightness when bending",
    },
    {
      id: "p2",
      nameAr: "ياسر الحربي",
      nameEn: "Yaser Al-Harbi",
      age: 45,
      painAreaName: "knee",
      severityAr: "شديدة",
      severityEn: "Severe",
      joinDate: "2026-06-01",
      diagnosisAr: "تمزق رباط صليبي أمامي جزئي بالركبة",
      diagnosisEn: "Partial ACL tear (knee)",
      triageNotesAr: "خشونة وتصلب بالمفصل، زاوية ثني الركبة محدودة",
      triageNotesEn: "Joint stiffness, limited knee flexion angle",
    },
    {
      id: "p3",
      nameAr: "خلود العتيبي",
      nameEn: "Kholoud Al-Otaibi",
      age: 29,
      painAreaName: "neck",
      severityAr: "خفيفة",
      severityEn: "Mild",
      joinDate: "2026-06-15",
      diagnosisAr: "تصلب الفقرات العنقية وتشنج الرقبة",
      diagnosisEn: "Cervical stiffness and neck spasm",
      triageNotesAr: "شد عضلي ناتج عن الجلوس المكتبي المتواصل، ألم جهة الكتفين",
      triageNotesEn: "Desk-related muscle tension, bilateral shoulder pain",
    },
  ];

  const currentPatientObj = patientsList.find((p) => p.id === selectedPatientId) || patientsList[0];
  const patientName = (p: PatientRecord) => t(p.nameAr, p.nameEn);
  const patientDiagnosis = (p: PatientRecord) => t(p.diagnosisAr, p.diagnosisEn);
  const patientTriageNotes = (p: PatientRecord) => t(p.triageNotesAr, p.triageNotesEn);
  const patientSeverity = (p: PatientRecord) => t(p.severityAr, p.severityEn);

  // AI Chat Messages State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isEinsteinLoading, setIsEinsteinLoading] = useState(false);
  const [einsteinError, setEinsteinError] = useState<string | null>(null);

  // Scroll ref for chat feed
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fine-tuning modal state
  const [isFineTuneOpen, setIsFineTuneOpen] = useState(false);
  const [pendingExc, setPendingExc] = useState<any | null>(null);
  const [pendingExcDay, setPendingExcDay] = useState<string>("");
  const [fineTuneSets, setFineTuneSets] = useState(3);
  const [fineTuneReps, setFineTuneReps] = useState(10);
  const [fineTuneHold, setFineTuneHold] = useState(5);
  const [fineTunePrecaution, setFineTunePrecaution] = useState("");
  const [fineTuneNotes, setFineTuneNotes] = useState("");

  // Graph Logic modal state
  const [isGraphLogicOpen, setIsGraphLogicOpen] = useState(false);
  const [selectedGraphSuggestion, setSelectedGraphSuggestion] = useState<EinsteinSuggestion | null>(null);

  // Publish state indicator
  const [publishStatus, setPublishStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  // Load chat and published plan on patient or language change
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    fetch("/api/exercises")
      .then((r) => r.json())
      .then((d) => setCatalogExercises(d.exercises || []))
      .catch(() => setCatalogExercises([]));
  }, []);

  useEffect(() => {
    loadPatientWelcomeMessage();
    loadPatientPublishedPlan();
  }, [selectedPatientId, lang]);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isEinsteinLoading]);

  const formatLogDuration = (seconds?: number) => {
    const mins = Math.max(1, Math.round((seconds || 60) / 60));
    return t(`${mins} دقائق`, `${mins} min`);
  };

  const formatLogDate = (dateStr?: string) => {
    if (!dateStr) return t("اليوم", "Today");
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(timeLocale, { month: "short", day: "numeric" });
  };

  useEffect(() => {
    if (activeTab !== "reports") return;
    setComplianceLoading(true);
    const ids = patientsList.map((p) => p.id);
    Promise.all(ids.map((id) => fetch(`/api/sessions/${id}`).then((r) => r.json())))
      .then((results) => {
        const rows: ComplianceLogRow[] = results.flatMap((res) => {
          const patient = patientsList.find((p) => p.id === res.patientId);
          return (res.logs || []).map((log: ExerciseSessionLog) => ({
            id: log.id,
            patientName: patient ? patientName(patient) : res.patientId,
            exerciseName: exerciseDisplayName({
              nameAr: log.exerciseNameAr,
              nameEn: log.exerciseNameEn,
            }),
            accuracy: log.accuracyScore ?? 0,
            repsDone: log.completedReps ?? 0,
            durationLabel: formatLogDuration(log.durationSeconds),
            dateLabel: formatLogDate(log.date),
          }));
        });
        setComplianceLogs(rows);
      })
      .catch((err) => console.error("Compliance fetch failed:", err))
      .finally(() => setComplianceLoading(false));
  }, [activeTab, lang]);

  const buildWelcomeMessage = (patient: PatientRecord) => {
    const name = patientName(patient);
    const diagnosis = patientDiagnosis(patient);
    const area = painAreaLabel(patient.painAreaName);
    return t(
      `مرحباً دكتور! أنا مساعدك السريري الذكي 'أينشتاين (Einstein)' المتصل بـ FitKG.

لقد قمت بتحميل ملف حالة المستفيد: "${name}"
• العمر: ${patient.age} عاماً
• التشخيص: ${diagnosis}
• مناطق الأعراض: ${area}

كيف ترغب بتخصيص الخطة الحركية اليوم لتلبية معاييره؟ اكتب طلبك وسأقوم باستعلام مخطط المعرفة وصنع تمارين مرنة قابلة لمراقبة الكاميرا!`,
      `Hello Doctor! I am your clinical AI assistant 'Einstein', connected to FitKG.

I have loaded the case file for: "${name}"
• Age: ${patient.age} years
• Diagnosis: ${diagnosis}
• Symptom regions: ${area}

How would you like to customize today's movement plan for this patient? Send your request and I will query the knowledge graph and generate camera-trackable exercises!`
    );
  };

  const loadPatientWelcomeMessage = () => {
    const greeting: ChatMessage = {
      id: "welcome",
      sender: "einstein",
      text: buildWelcomeMessage(currentPatientObj),
      timestamp: formatTime(),
    };
    setMessages([greeting]);
  };

  const loadPatientPublishedPlan = async () => {
    try {
      const response = await fetch(`/api/schedule/${selectedPatientId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.schedule && Object.keys(data.schedule).length > 0) {
          // Keep structure aligned with Mon-Sun keys
          const parsedSchedule: Record<string, ScheduledExercise[]> = {
            "Monday": [], "Tuesday": [], "Wednesday": [], "Thursday": [], "Friday": [], "Saturday": [], "Sunday": []
          };
          Object.keys(data.schedule).forEach(day => {
            if (parsedSchedule[day] !== undefined) {
              parsedSchedule[day] = data.schedule[day];
            }
          });
          setSchedule(parsedSchedule);
        } else {
          // Default empty schedule reset for other patients
          setSchedule({
            "Monday": [], "Tuesday": [], "Wednesday": [], "Thursday": [], "Friday": [], "Saturday": [], "Sunday": []
          });
        }
      }
    } catch (err) {
      console.warn("Could not retrieve published schedule from server:", err);
    }
  };

  // Chat message submission
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const promptText = chatInput.trim();
    if (!promptText) return;

    // Append PT doctor's message
    const ptMessage: ChatMessage = {
      id: `pt-${Date.now()}`,
      sender: "pt",
      text: promptText,
      timestamp: formatTime(),
    };

    setMessages(prev => [...prev, ptMessage]);
    setChatInput("");
    setIsEinsteinLoading(true);
    setEinsteinError(null);

    try {
      const response = await fetch("/api/einstein/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: selectedPatientId,
          pain_regions: [currentPatientObj.painAreaName],
          custom_prompt: promptText
        })
      });

      if (!response.ok) {
        throw new Error(t("تأخير في معالجة استعلام المخطط بالخادم.", "Delay processing knowledge graph query on server."));
      }

      const suggestions: EinsteinSuggestion[] = await response.json();

      const einsteinReply: ChatMessage = {
        id: `einstein-${Date.now()}`,
        sender: "einstein",
        text: t(
          `بناءً على طلبك بخصوص "${promptText}"، استعلمت عقد FitKG وصممت بطاقات التمارين الأنسب لحالة المستفيد. يمكنك سحبها مباشرة إلى جدول التقويم اليومي أدناه لإضافتها:`,
          `Based on your request "${promptText}", I queried FitKG nodes and built the best exercise cards for this patient. Drag them onto the daily calendar below to schedule them:`
        ),
        timestamp: formatTime(),
        exercises: suggestions,
      };

      setMessages(prev => [...prev, einsteinReply]);
    } catch (err: any) {
      console.error(err);
      
      // Fallback response with exercises matching the patient pain zone
      let localFallbacks: EinsteinSuggestion[] = [];
      if (currentPatientObj.painAreaName === "spinal") {
        localFallbacks = [
          {
            exercise_id: "ext_spine_01",
            name_ar: "تمديد العمود الفقري للقطنية",
            name_en: "Lumbar Extension Stretch",
            suggested_sets: 3,
            suggested_reps: 10,
            confidence_score: 95,
            target_muscle: "العضلات القطنية العميقة (Lower Back)",
            reasoning_ar: "تمرين تمدد خلفي بمقدار ١٤٥-١٧٥ يخفف ضغط الغضاريف ويعيد استوائها بالشوط السريري لفقرات أسفل الظهر L4-L5.",
            reasoning_en: "Posterior extension at 145–175° reduces disc pressure and restores alignment along the L4-L5 clinical arc.",
            kimore_thresholds: { min: 145, max: 175 }
          }
        ];
      } else if (currentPatientObj.painAreaName === "neck") {
        localFallbacks = [
          {
            exercise_id: "cerv_flex_01",
            name_ar: "إطالة فقرات الرقبة الجانبية",
            name_en: "Cervical Flexion Stretch",
            suggested_sets: 3,
            suggested_reps: 12,
            confidence_score: 93,
            target_muscle: "العضلة الرافعة لوح الترقوة (Upper Trapezius)",
            reasoning_ar: "تمديد سطحي لعضلات الرقبة بزاوية ٦٥°-٨٥° لتقليل تشنج الألياف العصبية وتخفيف تصلب فقرات الرقبة المكتبي.",
            reasoning_en: "Gentle neck stretch at 65°–85° eases nerve fiber tension and desk-related cervical stiffness.",
            kimore_thresholds: { min: 65, max: 85 }
          }
        ];
      } else {
        localFallbacks = [
          {
            exercise_id: "knee_squat_01",
            name_ar: "القرفصاء لتأهيل خشونة الركبة",
            name_en: "Rehab Squats for Knees",
            suggested_sets: 3,
            suggested_reps: 8,
            confidence_score: 96,
            target_muscle: "العضلة رباعية الرؤوس الفخذية (Quadriceps)",
            reasoning_ar: "تدعيم الرضفة بزاوية قرفصاء محددة (٩٠-١٠٥ درجة) يقوي العضلات المساندة للركبتين دون الضغط على الغضروف الهلالي.",
            reasoning_en: "Controlled squat depth (90°–105°) strengthens knee stabilizers without loading the meniscus.",
            kimore_thresholds: { min: 85, max: 105 }
          }
        ];
      }

      const einsteinReply: ChatMessage = {
        id: `einstein-${Date.now()}`,
        sender: "einstein",
        text: t(
          "أينشتاين (قناة احتياطية): استرجعت حركات الدعم المعرفية المطابقة لجزء الألم لتصميم خطتك. اسحب البطاقات أدناه للجدول لتخصيصها:",
          "Einstein (fallback channel): I retrieved knowledge-graph exercises matched to the pain region. Drag the cards below onto the schedule to customize."
        ),
        timestamp: formatTime(),
        exercises: localFallbacks
      };

      setMessages(prev => [...prev, einsteinReply]);
    } finally {
      setIsEinsteinLoading(false);
    }
  };

  // Preset chip query triggers
  const triggerPresetPrompt = (preset: string) => {
    setChatInput(preset);
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, item: any, sourceDay?: string, sourceIndex?: number) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ item, sourceDay, sourceIndex }));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetDay: string) => {
    e.preventDefault();
    try {
      const dataStr = e.dataTransfer.getData("application/json");
      if (!dataStr) return;
      const { item, sourceDay, sourceIndex } = JSON.parse(dataStr);

      if (sourceDay) {
        // Rearranging item inside the weekly grid
        if (sourceDay === targetDay) return;
        setSchedule(prev => {
          const sourceList = [...(prev[sourceDay] || [])];
          const targetList = [...(prev[targetDay] || [])];
          const [moved] = sourceList.splice(sourceIndex, 1);
          targetList.push(moved);
          return { ...prev, [sourceDay]: sourceList, [targetDay]: targetList };
        });
      } else {
        // Dropping from Einstein catalog
        setPendingExc(item);
        setPendingExcDay(targetDay);
        
        // Populate modal default variables from suggestion
        setFineTuneSets(item.suggested_sets || 3);
        setFineTuneReps(item.suggested_reps || 10);
        setFineTuneHold(5);
        setFineTunePrecaution(t("تجنب الحركات المفاجئة، وتابع المدى الحركي بالكاميرا.", "Avoid sudden movements; track range of motion with the camera."));
        setFineTuneNotes("");
        setIsFineTuneOpen(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Click on a dropped card to modify it
  const handleEditScheduledCard = (e: ScheduledExercise, day: string) => {
    setPendingExc(e);
    setPendingExcDay(day);
    setFineTuneSets(e.sets);
    setFineTuneReps(e.reps);
    setFineTuneHold(e.holdTime);
    setFineTunePrecaution(e.clinicalPrecaution);
    setFineTuneNotes(e.notes);
    setIsFineTuneOpen(true);
  };

  const handleManualAddExercise = (ex: any, day: string) => {
    setPendingExc({
      exercise_id: ex.exerciseId || ex.id,
      name_ar: ex.nameAr,
      name_en: ex.nameEn,
      suggested_sets: ex.sets || 3,
      suggested_reps: ex.reps || 10,
      target_muscle: ex.targetMuscle || ex.targetArea,
      kimore_thresholds: {
        min: ex.kimoreMin ?? ex.idealAngleRange?.min ?? 90,
        max: ex.kimoreMax ?? ex.idealAngleRange?.max ?? 120,
      },
    });
    setPendingExcDay(day);
    setFineTuneSets(3);
    setFineTuneReps(10);
    setFineTuneHold(5);
    setFineTunePrecaution(t("حافظ على تتبع مفاصل الزاوية المحددة.", "Maintain tracking of the prescribed joint angles."));
    setFineTuneNotes("");
    setIsFineTuneOpen(true);
  };

  const saveFineTuning = () => {
    if (!pendingExc) return;
    const isNewInstance = !pendingExc.id;

    const updatedEx: ScheduledExercise = {
      id: isNewInstance ? `sch-${Date.now()}` : pendingExc.id,
      exerciseId: pendingExc.exercise_id || pendingExc.exerciseId,
      nameAr: pendingExc.name_ar || pendingExc.nameAr,
      nameEn: pendingExc.name_en || pendingExc.nameEn,
      sets: fineTuneSets,
      reps: fineTuneReps,
      holdTime: fineTuneHold,
      clinicalPrecaution: fineTunePrecaution,
      notes: fineTuneNotes,
      targetMuscle: pendingExc.target_muscle || pendingExc.targetMuscle || t("عضلات مفصلية مساندة", "Supporting joint muscles"),
      kimoreMin: pendingExc.kimore_thresholds?.min || pendingExc.kimoreMin || 90,
      kimoreMax: pendingExc.kimore_thresholds?.max || pendingExc.kimoreMax || 180
    };

    setSchedule(prev => {
      const targetedDayList = [...(prev[pendingExcDay] || [])];
      if (isNewInstance) {
        targetedDayList.push(updatedEx);
      } else {
        const idx = targetedDayList.findIndex(e => e.id === pendingExc.id);
        if (idx !== -1) {
          targetedDayList[idx] = updatedEx;
        }
      }
      return { ...prev, [pendingExcDay]: targetedDayList };
    });

    setIsFineTuneOpen(false);
    setPendingExc(null);
  };

  const deleteScheduledExercise = (day: string, idx: number) => {
    setSchedule(prev => {
      const list = [...(prev[day] || [])];
      list.splice(idx, 1);
      return { ...prev, [day]: list };
    });
  };

  const publishRoadmap = async () => {
    setPublishStatus("loading");
    try {
      const response = await fetch("/api/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatientId,
          schedule: schedule
        })
      });

      if (!response.ok) {
        throw new Error(t("تعذر نشر الجدول عبر الإنترنت حالياً.", "Could not publish schedule online at this time."));
      }

      setPublishStatus("success");
      if (onUpdatePatientPlan) {
        onUpdatePatientPlan(selectedPatientId, schedule);
      }
      setTimeout(() => setPublishStatus("idle"), 3000);
    } catch (err) {
      console.error(err);
      setPublishStatus("error");
      setTimeout(() => setPublishStatus("idle"), 3000);
    }
  };

  // Exercises filtered by search — FitKG catalog first, mock fallback
  const exerciseSource =
    catalogExercises.length > 0
      ? catalogExercises.map((ex: any) => ({
          id: ex.id,
          exerciseId: ex.id,
          nameAr: ex.name_ar,
          nameEn: ex.name_en,
          sets: ex.suggested_sets || 3,
          reps: ex.suggested_reps || 10,
          holdTime: 5,
          kimoreMin: ex.kimore_thresholds?.min ?? 90,
          kimoreMax: ex.kimore_thresholds?.max ?? 120,
          targetMuscle: ex.target_muscle || "",
          clinicalPrecaution: "",
          notes: "",
        }))
      : mockExercises.map((ex) => ({
          id: ex.id,
          exerciseId: ex.id,
          nameAr: ex.nameAr,
          nameEn: ex.nameEn,
          sets: 3,
          reps: 10,
          holdTime: 0,
          kimoreMin: ex.idealAngleRange.min,
          kimoreMax: ex.idealAngleRange.max,
          targetMuscle: ex.targetArea,
          clinicalPrecaution: "",
          notes: "",
        }));

  const filteredExercises = exerciseSource.filter(
    (ex) =>
      ex.nameAr?.includes(searchQuery) ||
      ex.nameEn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ex.targetMuscle?.includes(searchQuery)
  );

  return (
    <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-sans ${isRtl ? "text-right" : "text-left"}`} dir={isRtl ? "rtl" : "ltr"}>
      
      {/* Visual Identity Title banner */}
      <div id="pt-portal-header" className="bg-slate-950 text-white rounded-3xl p-6 sm:p-8 border border-slate-850 shadow-2xl mb-8 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className={`space-y-1.5 order-last md:order-first ${isRtl ? "text-right" : "text-left"}`}>
          <div className="bg-brand-500/10 text-brand-400 font-mono text-[10px] font-bold border border-brand-500/20 px-3.5 py-1 rounded-lg w-max mb-1 inline-block">
            {t("مسجل لدى وزارة الصحة", "MOH REGISTERED PT")}
          </div>
          <h2 className="text-2xl sm:text-3xl font-display font-black text-slate-50">
            {t("جناح الطبيب المتخصص وعيادة Einstein AI 🩺", "Specialist PT Suite & Einstein AI Clinic 🩺")}
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm">
            {t(
              "لوحة إدارة المرضى، وتعيين المجموعات بذكاء RAG المترابط والامتثال المفاصل عبر الكاميرا.",
              "Patient management, RAG-linked exercise prescribing, and camera-based joint compliance."
            )}
          </p>
        </div>

        <div className="flex gap-4 items-center self-end md:self-center">
          <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center min-w-[110px]">
            <span className="block text-[9px] text-slate-500 font-bold">{t("المرضى النشطين", "Active Patients")}</span>
            <span className="text-brand-400 font-mono text-xl font-bold">{t("٣ مستفيدين", "3 patients")}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl text-center min-w-[110px]">
            <span className="block text-[9px] text-slate-500 font-bold">{t("متوسط الدقة الذاتية", "Avg. Pose Accuracy")}</span>
            <span className="text-emerald-400 font-mono text-xl font-bold">92.4%</span>
          </div>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex gap-2 border-b border-slate-205 pb-px mb-8">
        <button
          onClick={() => setActiveTab("copilot_workspace")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-2 border-b-2 -mb-px ${
            activeTab === "copilot_workspace" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <Sparkles className="w-4 h-4 text-brand-500" />
          <span>{t("منطقة تخطيط المعرفة ومركز Einstein (65% / 35%)", "Knowledge Plan Canvas & Einstein Hub (65% / 35%)")}</span>
        </button>
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-1.5 border-b-2 -mb-px ${
            activeTab === "dashboard" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>{t("سجل وقائمة المرضى النشطين", "Active Patient Registry")}</span>
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-1.5 border-b-2 -mb-px ${
            activeTab === "reports" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>{t(`تقارير تحقق مفاصل المستفيدين (${complianceLogs.length})`, `Joint Compliance Reports (${complianceLogs.length})`)}</span>
        </button>
        <button
          onClick={() => setActiveTab("schedule")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-1.5 border-b-2 -mb-px ${
            activeTab === "schedule" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>{t("جدول العيادة", "Clinic Schedule")}</span>
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-1.5 border-b-2 -mb-px ${
            activeTab === "messages" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>{t("الرسائل", "Messages")}</span>
        </button>
        <button
          onClick={() => setActiveTab("clinical_assistant")}
          className={`px-5 py-2.5 font-bold text-xs sm:text-sm cursor-pointer transition flex items-center gap-1.5 border-b-2 -mb-px ${
            activeTab === "clinical_assistant" ? "border-brand-500 text-brand-700" : "border-transparent text-slate-400"
          }`}
        >
          <Stethoscope className="w-4 h-4" />
          <span>{t("المساعد السريري", "Clinical Assistant")}</span>
        </button>
      </div>

      {/* 1. Core 2-Column Workspace Tab (65% Canvas & Left Context vs 35% Copilot) */}
      {activeTab === "copilot_workspace" && (
        <div className="space-y-6">
          
          {/* Quick Patient Switcher bar */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="text-xs font-bold text-slate-550">{t("مستمر الخطة الحالية:", "Active plan for:")}</span>
              <div className="flex gap-1.5">
                {patientsList.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPatientId(p.id)}
                    className={`px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      selectedPatientId === p.id 
                        ? "bg-slate-950 text-white shadow-md" 
                        : "bg-white border text-slate-650 hover:bg-slate-100"
                    }`}
                  >
                    {patientName(p)}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>{t("عيادة التوجيه السلوكي وعلاقات المعرفة الساكنة بالخطة نشطة", "Behavioral coaching clinic & static knowledge graph links active")}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* LEFT CANVASES PANEL: Width 65% (lg:col-span-8) */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* COMPACT PATIENT CLINICAL DIAGNOSIS & PAIN MAP ROW */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-white border border-slate-150 p-5 rounded-3xl">
                
                {/* Visual Description & Clinical Triage */}
                <div id="patient-diagnosis-details" className="md:col-span-8 space-y-4 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="bg-brand-50 text-brand-800 text-[10px] font-bold px-2 py-0.5 rounded-lg">
                        {t("شدة الأعراض:", "Symptom severity:")} {patientSeverity(currentPatientObj)}
                      </span>
                      <span className="text-xs text-slate-400 font-bold">{t("البدء:", "Started:")} {currentPatientObj.joinDate}</span>
                    </div>
                    <h3 className="font-display font-black text-slate-900 text-lg">
                      {patientName(currentPatientObj)} ({currentPatientObj.age} {t("عاماً", "yrs")})
                    </h3>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex-1 space-y-2 text-xs">
                    <div>
                      <span className="text-[9px] text-slate-450 font-bold block mb-0.5">{t("التشخيص الطبي السريري للحالة:", "Clinical diagnosis:")}</span>
                      <span className="font-bold text-slate-800 text-xs sm:text-sm block">{patientDiagnosis(currentPatientObj)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-450 font-bold block mb-0.5">{t("ملاحظات الفحص والتقييم الحركي المبدئي:", "Initial triage & movement notes:")}</span>
                      <p className="text-slate-600 text-xs leading-relaxed">{patientTriageNotes(currentPatientObj)}</p>
                    </div>
                  </div>
                </div>

                {/* Patient Interactive Pain Map Silhouette */}
                <div id="patient-pain-body-map" className="md:col-span-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center flex flex-col items-center justify-center relative">
                  <span className="block text-[10px] text-slate-500 font-bold mb-2">{t("موضع تشنج المفاصل", "Joint pain hotspot")}</span>
                  
                  <svg viewBox="0 0 120 180" className="w-16 h-28 select-none">
                    <ellipse cx="60" cy="170" rx="18" ry="3" fill="#cbd5e1" opacity="0.6"/>
                    <path
                      d="M60,15 C55,15 52,18 52,23 C52,28 55,31 60,31 C65,31 68,28 68,23 C68,18 65,15 60,15 Z 
                         M55,33 C45,36 42,48 42,60 L42,90 C42,94 45,96 47,96 L49,60 L53,60 L53,120 L48,165 L56,165 L60,130 L64,165 L72,165 L67,120 L67,60 L71,60 L73,90 C75,96 78,94 78,90 L78,60 C78,48 75,36 65,33 Z"
                      fill="#e2e8f0"
                      stroke="#cbd5e1"
                      strokeWidth="1"
                    />
                    {/* Hotspot glows based on selected patient */}
                    <circle 
                      cx="60" 
                      cy="36" 
                      r="7" 
                      fill={currentPatientObj.painAreaName === "neck" ? "#f43f5e" : "#94a3b8"} 
                      className={currentPatientObj.painAreaName === "neck" ? "animate-pulse" : ""}
                      opacity="0.9"
                    />
                    <circle 
                      cx="60" 
                      cy="75" 
                      r="8" 
                      fill={currentPatientObj.painAreaName === "spinal" ? "#f43f5e" : "#94a3b8"} 
                      className={currentPatientObj.painAreaName === "spinal" ? "animate-pulse" : ""}
                      opacity="0.9"
                    />
                    <circle 
                      cx="60" 
                      cy="142" 
                      r="7" 
                      fill={currentPatientObj.painAreaName === "knee" ? "#f43f5e" : "#94a3b8"} 
                      className={currentPatientObj.painAreaName === "knee" ? "animate-pulse" : ""}
                      opacity="0.9"
                    />
                  </svg>

                  <div className="mt-2 text-[9px] text-slate-500 font-bold leading-normal">
                    {painHotspotLabel(currentPatientObj.painAreaName)}
                  </div>
                </div>

              </div>

              {/* CALENDAR NAVIGATION & CONTROL TOP PANEL */}
              <div className={`bg-white border border-slate-150 p-4 rounded-3xl flex flex-col sm:flex-row justify-between items-center gap-4 ${isRtl ? "text-right" : "text-left"}`}>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">
                    {t("جدول المهام التأهيلية الحركية:", "Rehabilitation task schedule:")}
                  </span>
                  <strong className="text-xs sm:text-sm font-bold text-slate-800">
                    {t("الأسبوع الحالي النشط • الإثنين إلى الأحد", "Active week • Monday to Sunday")}
                  </strong>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={publishRoadmap}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 shadow-sm ${
                      publishStatus === "loading"
                        ? "bg-slate-305 text-slate-500"
                        : publishStatus === "success"
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-950 hover:bg-slate-850 text-white"
                    }`}
                  >
                    {publishStatus === "loading" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : publishStatus === "success" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-white" />
                    ) : (
                      <Check className="w-3.5 h-3.5 text-brand-400" />
                    )}
                    <span>
                      {publishStatus === "loading"
                        ? t("جاري التزامن...", "Syncing...")
                        : publishStatus === "success"
                          ? t("تم النشر والتزامن ✓", "Published & synced ✓")
                          : t("حفظ ونشر الخطة للمريض", "Save & publish plan to patient")}
                    </span>
                  </button>
                </div>
              </div>

              {/* 7-DAYS WEEKLY CALENDAR CANVAS (MON - SUN) */}
              <div id="weekly-calendar-canvas" className="grid grid-cols-1 sm:grid-cols-7 gap-3">
                {Object.keys(schedule).map((day) => {
                  const dayExercises = schedule[day] || [];

                  return (
                    <div
                      key={day}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, day)}
                      className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 min-h-[220px] space-y-2 flex flex-col transition hover:bg-slate-100/80 hover:border-slate-300 relative group"
                    >
                      {/* Day Header */}
                      <div className={`flex justify-between items-center text-xs font-black border-b border-slate-200 pb-1.5 ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
                        <span className="text-[10px] bg-slate-200 text-slate-750 px-1.5 py-0.5 rounded-lg font-bold">{dayExercises.length}</span>
                        <span className="text-slate-800">{dayLabel(day)}</span>
                      </div>

                      {/* Day Exercises Slots */}
                      <div className="flex-1 space-y-2 overflow-y-auto max-h-[300px]">
                        {dayExercises.map((e, idx) => (
                          <div
                            key={e.id}
                            draggable="true"
                            onDragStart={(evt) => handleDragStart(evt, e, day, idx)}
                            onClick={() => handleEditScheduledCard(e, day)}
                            className={`bg-white border border-slate-150 p-2.5 rounded-xl text-[11px] leading-relaxed relative hover:border-brand-350 cursor-grab active:cursor-grabbing hover:shadow-xs transition ${isRtl ? "text-right" : "text-left"}`}
                          >
                            <div className="flex justify-between items-start">
                              <button
                                onClick={(evt) => { evt.stopPropagation(); deleteScheduledExercise(day, idx); }}
                                className="text-slate-350 hover:text-rose-600 transition cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                              <strong className={`block text-slate-900 font-bold ${isRtl ? "ml-1 text-right" : "mr-1 text-left"}`}>{exerciseDisplayName(e)}</strong>
                            </div>
                            <ExercisePosePreview
                              exerciseId={e.exerciseId}
                              kimoreMin={e.kimoreMin}
                              kimoreMax={e.kimoreMax}
                              compact
                            />

                            <div className="flex justify-between items-center mt-1.5 font-bold text-[10px] text-brand-700 bg-brand-50/40 px-1.5 py-0.5 rounded-sm">
                              <span>{formatHoldLabel(e.holdTime)}</span>
                              <span>{formatSetsReps(e.sets, e.reps)}</span>
                            </div>

                            {e.notes && (
                              <p className="text-[9.5px] text-slate-450 leading-snug mt-1 bg-slate-50 p-1 rounded-sm border-r border-slate-200">
                                {e.notes}
                              </p>
                            )}

                            {e.clinicalPrecaution && (
                              <div className="text-[9px] text-amber-700 mt-1 flex items-center gap-0.5 leading-snug">
                                <ShieldAlert className="w-2.5 h-2.5 flex-shrink-0" />
                                <span className="truncate">{e.clinicalPrecaution}</span>
                              </div>
                            )}
                          </div>
                        ))}

                        {dayExercises.length === 0 && (
                          <div className="h-full flex items-center justify-center text-center py-10">
                            <span className="text-[10px] text-slate-400 font-semibold leading-relaxed">
                              {t("اسحب من أينشتاين وأسقط هنا للجدولة", "Drag from Einstein and drop here to schedule")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* MANUAL SEARCH AND ADDITION PANEL FOR COMPLETED CLINICAL PLAN */}
              <div className="bg-white border border-slate-150 p-5 rounded-3xl space-y-3">
                <h4 className={`font-display font-black text-slate-800 text-sm flex items-center gap-1.5 ${isRtl ? "justify-start" : "justify-start"}`}>
                  <span>{t("أو ابحث عن حركة تأهيلية يدوية وأضفها للجدول:", "Or search manually and add to the schedule:")}</span>
                </h4>
                
                <div className="relative">
                  <input
                    type="text"
                    placeholder={t("ابحث بالاسم أو بؤرة المفاصل المستهدفة...", "Search by name or target joint region...")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-slate-400 bg-slate-50 text-xs focus:outline-none ${isRtl ? "text-right pr-9" : "text-left pl-9"}`}
                  />
                  <Search className={`w-4 h-4 text-slate-400 absolute top-3 ${isRtl ? "right-3" : "left-3"}`} />
                </div>

                {searchQuery.trim().length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto space-y-1.5 p-2 shadow-lg z-15 relative">
                    {filteredExercises.map((ex) => (
                      <div 
                        key={ex.id}
                        className={`p-2 hover:bg-slate-50 rounded-lg flex justify-between items-center text-xs border-b border-slate-100 last:border-0 cursor-pointer ${isRtl ? "text-right" : "text-left"}`}
                      >
                        <div className="flex gap-1.2 font-mono flex-row-reverse">
                          {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => (
                            <button
                              key={d}
                              onClick={() => { handleManualAddExercise(ex, d); setSearchQuery(""); }}
                              className="bg-slate-105 hover:bg-brand-50 hover:text-brand-800 text-[9.5px] px-1.5 py-0.5 rounded font-black border border-slate-200 text-slate-650 cursor-pointer"
                            >
                              {dayShortLabel(d)}+
                            </button>
                          ))}
                        </div>
                        <div className="flex-1 min-w-0">
                          <strong className="text-slate-900 block">{exerciseDisplayName(ex)}</strong>
                          <span className="text-[10px] text-slate-400">
                            {t("العضلة المستهدفة:", "Target:")} {ex.targetMuscle || ex.targetArea}
                          </span>
                          <div className="mt-1.5">
                            <ExercisePosePreview exerciseId={ex.exerciseId || ex.id} kimoreMin={ex.kimoreMin} kimoreMax={ex.kimoreMax} compact />
                          </div>
                        </div>
                      </div>
                    ))}

                    {filteredExercises.length === 0 && (
                      <p className="text-center text-xs text-slate-400 py-3 font-semibold">
                        {t("لم نجد تمرين يطابق تشخيصك المكتوب.", "No exercise matches your search.")}
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT PANEL: EINSTEIN AI COPILOT CHAT INTERFACE: Width 35% (lg:col-span-4) */}
            <div id="einstein-copilot-pane" className="lg:col-span-4 space-y-4">
              
              <div className="bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-2xl flex flex-col h-[740px] overflow-hidden relative">
                
                {/* Chat Panel Header */}
                <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                  <div className="bg-brand-500/10 text-brand-400 font-bold text-[9px] px-2 py-0.5 rounded-lg border border-brand-500/20 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-brand-400 animate-pulse" />
                    <span>FitKG RAG ACTIVE</span>
                  </div>
                <div className={isRtl ? "text-right" : "text-left"}>
                    <h4 className="font-display font-black text-slate-50 text-sm">🤖 Einstein AI Copilot</h4>
                    <span className="text-[9.5px] text-slate-400 font-bold block">
                      {t("المساعد السريري المتقدم", "Advanced Clinical Assistant")}
                    </span>
                  </div>
                </div>

                {/* Chat Messages Feed */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 leading-normal">
                  {messages.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col ${msg.sender === "pt" ? "items-start" : "items-end"}`}
                    >
                      <div className={`flex items-center gap-1.5 mb-1 text-[10px] text-slate-400 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                        {msg.sender === "pt" ? (
                          <>
                            <span className="font-bold text-slate-300">{t("أخصائي الحركة", "Movement Specialist")}</span>
                            <span className="text-slate-600">•</span>
                          </>
                        ) : (
                          <>
                            <span className="font-bold text-brand-400">{t("أينشتاين السريري", "Clinical Einstein")}</span>
                            <span className="text-slate-600">•</span>
                          </>
                        )}
                        <span>{msg.timestamp}</span>
                      </div>

                      {/* Message bubble */}
                      <div 
                        className={`max-w-[90%] rounded-2xl p-3.5 text-xs font-medium leading-relaxed shadow-sm ${isRtl ? "text-right rounded-tl-none" : "text-left rounded-tr-none"} ${
                          msg.sender === "pt" 
                            ? "bg-slate-800 text-slate-100" 
                            : "bg-slate-950 text-slate-50 border border-slate-850"
                        }`}
                      >
                        <p className="whitespace-pre-line">{msg.text}</p>

                        {/* Inline Generated Exercice cards inside Einstein's chat response */}
                        {msg.exercises && msg.exercises.length > 0 && (
                          <div className="mt-3.5 space-y-3 pt-3.5 border-t border-slate-850">
                            <span className="text-[10px] text-brand-400/80 font-bold block mb-1.5">
                              {t("التمارين المعرفية المرشحة (اسحبها للتقويم):", "Recommended exercises (drag to calendar):")}
                            </span>
                            
                            {msg.exercises.map((item) => (
                              <div
                                key={item.exercise_id}
                                draggable="true"
                                onDragStart={(e) => handleDragStart(e, item)}
                                className={`bg-slate-900 border border-slate-800/80 p-3 rounded-2xl space-y-2 cursor-grab hover:border-slate-700 active:cursor-grabbing transition relative group shadow-md ${isRtl ? "text-right" : "text-left"}`}
                              >
                                {/* Drag badge */}
                                <div className={`absolute top-2.5 ${isRtl ? "left-2.5" : "right-2.5"} bg-brand-500 text-slate-950 font-black text-[8px] px-2 py-0.5 rounded pointer-events-none`}>
                                  {t("اسحب", "Drag")}
                                </div>

                                <div className="space-y-1">
                                  <span className="text-[9.5px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-2 py-0.5 rounded-md inline-block">
                                    {t(`ملائمة بنسبة ${item.confidence_score}%`, `${item.confidence_score}% match`)}
                                  </span>
                                  <h5 className="font-display font-bold text-slate-100 text-xs mt-1 leading-snug">{exerciseDisplayName(item)}</h5>
                                </div>

                                <div className="bg-slate-950 p-2 rounded-xl text-[9.5px] text-slate-400 leading-relaxed font-semibold">
                                  {exerciseReasoning(item)}
                                </div>

                                <div className={`flex justify-between items-center text-[9px] text-slate-500 bg-slate-950/60 px-2 py-1 rounded border border-slate-850 ${isRtl ? "flex-row-reverse" : ""}`}>
                                  <span>{t("المدى المقترح:", "Suggested range:")} {item.kimore_thresholds?.min}°-{item.kimore_thresholds?.max}°</span>
                                  <span>{t("مجموعات:", "Sets:")} {item.suggested_sets}×{item.suggested_reps}</span>
                                </div>

                                {/* Graph Relations details */}
                                <button
                                  type="button"
                                  onClick={() => { setSelectedGraphSuggestion(item); setIsGraphLogicOpen(true); }}
                                  className="w-full py-1.5 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 text-slate-400 rounded-lg text-[9px] font-bold cursor-pointer transition flex items-center justify-center gap-1"
                                >
                                  <Eye className="w-3 h-3 text-brand-400" />
                                  <span>{t("عرض روابط المعرفة", "View knowledge links")}</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Typing loader state */}
                  {isEinsteinLoading && (
                    <div className={`flex flex-col ${isRtl ? "items-end" : "items-start"}`}>
                      <div className={`flex items-center gap-1.5 mb-1 text-[10px] text-brand-400 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="font-bold">{t("أينشتاين السريري", "Clinical Einstein")}</span>
                        <span className="text-slate-600">•</span>
                        <span>{t("جاري معالجة FitKG...", "Processing FitKG...")}</span>
                      </div>
                      <div className={`bg-slate-950 text-brand-400 rounded-2xl px-4 py-3.5 text-xs font-semibold flex items-center gap-2 border border-slate-850 ${isRtl ? "rounded-tl-none" : "rounded-tr-none"}`}>
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                          <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                          <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                        </div>
                        <span>{t("يستعلم مخطط المعرفة عن", "Querying knowledge graph for")} {patientName(currentPatientObj)}...</span>
                      </div>
                    </div>
                  )}

                  {/* Ghost scroll stopper */}
                  <div ref={chatEndRef} />
                </div>

                {/* Preset Suggestions Quick Bar */}
                <div className="bg-slate-950 border-t border-slate-850 px-3 py-2 flex gap-1.5 overflow-x-auto select-none no-scrollbar">
                  <button
                    onClick={() => triggerPresetPrompt(t("اقترح روتين مبدئي لـ L4-L5 ديسك مع الحفاظ على استقامة الجذع", "Suggest an initial L4-L5 disc routine with neutral spine"))}
                    className="flex-shrink-0 bg-slate-900 hover:bg-slate-850 text-[10px] text-slate-350 px-2.5 py-1 rounded-lg border border-slate-800 font-bold cursor-pointer transition"
                  >
                    {t("💡 روتين L4-L5", "💡 L4-L5 routine")}
                  </button>
                  <button
                    onClick={() => triggerPresetPrompt(t("أعطني تمارين خفيفة المدى لخشونة مفاصل الركبة", "Give me low-range exercises for knee osteoarthritis"))}
                    className="flex-shrink-0 bg-slate-900 hover:bg-slate-850 text-[10px] text-slate-350 px-2.5 py-1 rounded-lg border border-slate-800 font-bold cursor-pointer transition"
                  >
                    {t("💡 خشونة الركبة", "💡 Knee OA")}
                  </button>
                  <button
                    onClick={() => triggerPresetPrompt(t("اقترح تمارين مرونة لتشنج عضلات الرقبة والكتفين", "Suggest flexibility drills for neck and shoulder tension"))}
                    className="flex-shrink-0 bg-slate-900 hover:bg-slate-850 text-[10px] text-slate-350 px-2.5 py-1 rounded-lg border border-slate-800 font-bold cursor-pointer transition"
                  >
                    {t("💡 شد فقرات الرقبة", "💡 Neck stiffness")}
                  </button>
                </div>

                {/* Persistent chat message form */}
                <form 
                  onSubmit={handleChatSubmit} 
                  className="p-3 bg-slate-950 border-t border-slate-850 flex gap-2"
                >
                  <button
                    type="submit"
                    disabled={isEinsteinLoading || !chatInput.trim()}
                    className="bg-brand-500 hover:bg-brand-600 disabled:bg-slate-800 disabled:opacity-40 text-slate-950 p-2.5 rounded-xl transition cursor-pointer flex-shrink-0 flex items-center justify-center"
                  >
                    <Send className="w-4 h-4 text-slate-950 transform rotate-180" />
                  </button>
                  <input
                    type="text"
                    placeholder={t("وجه أينشتاين (مثال: روتين لـ L4-L5 مريض مسن)...", "Direct Einstein (e.g. L4-L5 routine for an elderly patient)...")}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className={`flex-1 bg-slate-900 border border-slate-800 focus:border-brand-500 text-white rounded-xl py-2 px-3 text-xs focus:outline-none ${isRtl ? "text-right" : "text-left"}`}
                  />
                </form>

              </div>

            </div>

          </div>

        </div>
      )}

      {/* 2. Registered Patients Roster Detail list Tab */}
      {activeTab === "dashboard" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Patients roster directory left column */}
          <div className="lg:col-span-4 bg-white border border-slate-150 p-6 rounded-3xl space-y-4">
            <h3 className="font-display font-black text-slate-900 text-base">
              {t("سجل وقائمة المرضى المتابعين", "Active patient registry")}
            </h3>
            
            <div className="space-y-2.5">
              {patientsList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPatientId(p.id)}
                  className={`w-full p-4 rounded-2xl border transition flex flex-col gap-1 cursor-pointer ${isRtl ? "text-right" : "text-left"} ${
                    selectedPatientId === p.id
                      ? "bg-brand-50/50 border-brand-500 shadow-xs"
                      : "bg-slate-50 border-slate-100 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-black font-mono">
                      {t("شدة:", "Severity:")} {patientSeverity(p)}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{patientName(p)}</h4>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500 font-bold mt-1 w-full font-mono">
                    <span>{t("البدء:", "Started:")} {p.joinDate}</span>
                    <span>{t("الجزء:", "Area:")} {painAreaShort(p.painAreaName)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Targeted Patient file review */}
          <div className="lg:col-span-8 bg-white border border-slate-150 p-6 sm:p-8 rounded-3xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
              <span className="text-xs text-slate-450 font-bold font-mono">
                {t("العمر:", "Age:")} {currentPatientObj.age} {t("عاماً", "yrs")}
              </span>
              <h3 className="font-display font-black text-slate-950 text-xl">
                {t("ملف الحالة الطبية:", "Clinical case file:")} {patientName(currentPatientObj)}
              </h3>
            </div>

            {/* Quick indicators */}
            <div className="grid grid-cols-3 gap-4">
              <div className={`bg-slate-50 p-4 rounded-2xl border border-slate-100 ${isRtl ? "text-right" : "text-left"}`}>
                <span className="block text-[10px] text-slate-400 font-semibold">{t("الجزء العظمي المعني", "Affected region")}</span>
                <span className="text-slate-850 font-black text-xs sm:text-sm block mt-1">
                  {painAreaLabel(currentPatientObj.painAreaName)}
                </span>
              </div>
              
              <div className={`bg-slate-50 p-4 rounded-2xl border border-slate-100 ${isRtl ? "text-right" : "text-left"}`}>
                <span className="block text-[10px] text-slate-400 font-semibold">{t("مستوى الامتثال اليومي", "Daily compliance")}</span>
                <span className="text-emerald-600 font-bold text-xs sm:text-sm block mt-1">
                  {t("٩٤,٢% التتبع مبرهن", "94.2% verified tracking")}
                </span>
              </div>

              <div className={`bg-slate-50 p-4 rounded-2xl border border-slate-100 ${isRtl ? "text-right" : "text-left"}`}>
                <span className="block text-[10px] text-slate-400 font-semibold">{t("حضور الجلسات بالفيديو", "Video session attendance")}</span>
                <span className="text-slate-800 font-bold text-xs sm:text-sm block mt-1">
                  {t("٣ جلسات معتمدة", "3 approved sessions")}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-display font-bold text-slate-850 text-sm">
                {t("تاريخ الحالة والتشخيص السريري:", "Case history & clinical diagnosis:")}
              </h4>
              <p className="bg-slate-50 p-4 rounded-xl border border-slate-150 text-xs text-slate-650 leading-relaxed font-semibold">
                {patientTriageNotes(currentPatientObj)}
              </p>
            </div>

            {/* Current exercise plan active summary */}
            <div className="space-y-3">
              <h4 className="font-display font-bold text-slate-850 text-sm">
                {t("الخطة الحركية الحالية المسجلة:", "Current registered movement plan:")}
              </h4>
              <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-100 text-slate-650 space-y-2 text-xs leading-relaxed">
                <p>• <strong>{t("تمديد العمود الفقري للقطنية", "Lumbar spine extension")}</strong> (L4-L5) - {t("٣ مجموعات × ١٠ تكرار مع ثبات ٥ ثوانٍ.", "3 sets × 10 reps with 5s hold.")}</p>
                <p>• <strong>{t("تمرين القرفصاء التأهيلي للركبة", "Rehab knee squat")}</strong> - {t("٣ مجموعات × ٨ تكرار مع تماثل هدف ٩٠ درجة.", "3 sets × 8 reps targeting 90° symmetry.")}</p>
              </div>
            </div>

            <div className={`pt-4 flex ${isRtl ? "justify-end" : "justify-start"}`}>
              <button
                onClick={() => setActiveTab("copilot_workspace")}
                className="bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl transition cursor-pointer"
              >
                {t("تخصيص الخطة الحركية في عيادة أينشتاين المتقدمة 🦾", "Customize the plan in Advanced Einstein Clinic 🦾")}
              </button>
            </div>

          </div>

        </div>
      )}

      {/* 3. Compliance and Accuracy Sessions Reports Tab */}
      {activeTab === "reports" && (
        <div className="space-y-6">
          <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${isRtl ? "text-right" : "text-left"}`}>
            <h3 className="font-display font-bold text-slate-900 text-lg">
              {t("تقارير الامتثال والتحقق المتولدة بذكاء فقراتي", "Faqarati AI Compliance & Verification Reports")}
            </h3>
            <p className="text-xs text-slate-500 font-semibold">
              {t("التحليلات والمطابقات مأخوذة بناءً على تموضع المفاصل من كاميرات المستفيدين.", "Analytics derived from patient camera joint positioning.")}
            </p>
          </div>

          {complianceLoading && (
            <p className="text-xs text-slate-500">{t("جاري تحميل التقارير...", "Loading reports...")}</p>
          )}

          {!complianceLoading && complianceLogs.length === 0 && (
            <p className="text-xs text-slate-500">{t("لا توجد جلسات مسجلة بعد.", "No logged sessions yet.")}</p>
          )}

          <div className="space-y-3">
            {complianceLogs.map((log) => (
              <div key={log.id} className={`bg-white border border-slate-150 rounded-2xl p-4.5 flex flex-col md:flex-row justify-between items-center gap-4 transition hover:border-slate-350 ${isRtl ? "text-right" : "text-left"}`}>
                
                <div className="flex gap-4 items-center flex-wrap">
                  <div className="text-center p-2.5 bg-brand-50 border border-brand-100 rounded-xl min-w-[100px]">
                    <span className="block text-[8px] text-slate-400 font-bold">{t("دقة الهيكل للمفاصل", "Joint pose accuracy")}</span>
                    <span className="block font-mono font-black text-brand-750 text-sm">{log.accuracy}%</span>
                  </div>

                  <div className="text-center p-2.5 bg-slate-50 border border-slate-100 rounded-xl min-w-[100px]">
                    <span className="block text-[8px] text-slate-400 font-bold">{t("التكرارات المنجزة", "Reps completed")}</span>
                    <span className="block font-mono font-black text-slate-700 text-sm">{log.repsDone} {t("مرات", "reps")}</span>
                  </div>

                  <div className="text-center p-2.5 bg-slate-50 border border-slate-100 rounded-xl min-w-[100px]">
                    <span className="block text-[8px] text-slate-400 font-bold">{t("المدة المكتملة", "Duration")}</span>
                    <span className="block font-bold text-slate-750 text-xs sm:text-sm">{log.durationLabel}</span>
                  </div>
                </div>

                <div className={`flex items-center gap-3 w-full md:w-auto ${isRtl ? "text-right justify-between md:justify-end" : "text-left justify-between md:justify-end"}`}>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{log.patientName}</h4>
                    <p className="text-xs text-brand-750 mt-1 font-semibold">{log.exerciseName}</p>
                    <span className="text-[10px] text-slate-400 font-mono block mt-1">{log.dateLabel}</span>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-sm text-slate-700 select-none">✓</div>
                </div>

              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "schedule" && <PTScheduleTab />}

      {activeTab === "messages" && <PTMessagesTab />}

      {activeTab === "clinical_assistant" && (
        <div className="h-[calc(100vh-230px)] min-h-[560px]">
          <PTClinicalAssistantTab fullScreen />
        </div>
      )}

      {activeTab === "wallet" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
          <h3 className="font-display font-black text-slate-900">{t("محفظة العيادة (تجريبي)", "Clinic Wallet (Demo)")}</h3>
          <p className="text-3xl font-mono font-black text-brand-600">SAR 4,280</p>
          <p className="text-xs text-slate-500">{t("إيرادات الجلسات المرئية هذا الشهر", "Telehealth revenue this month")}</p>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-4 max-w-lg">
          <h3 className="font-display font-black text-slate-900 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            {t("إعدادات العيادة", "Clinic Settings")}
          </h3>
          <label className="block text-xs font-bold text-slate-600">{t("اسم العيادة", "Clinic name")}</label>
          <input className="w-full border rounded-xl px-3 py-2 text-sm" defaultValue="Faqarati PT Clinic — Jeddah" />
          <label className="block text-xs font-bold text-slate-600">{t("ترخيص وزارة الصحة", "MOH license")}</label>
          <input className="w-full border rounded-xl px-3 py-2 text-sm font-mono" defaultValue="MOH-10294-PT" />
        </div>
      )}

      {/* MODAL 1: Fine-tuning popup modal on Drop or click to edit */}
      {isFineTuneOpen && pendingExc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
          <div className={`bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl animate-scaleUp ${isRtl ? "text-right" : "text-left"}`}>
            
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <button 
                onClick={() => { setIsFineTuneOpen(false); setPendingExc(null); }}
                className="text-slate-400 hover:text-slate-650 transition cursor-pointer"
              >
                ✕
              </button>
              <h3 className="font-display font-black text-slate-950 text-lg">
              {t("ضبط وتدقيق معايير الجرعة العلاجية 🛠️", "Fine-tune therapeutic dosing 🛠️")}
              </h3>
            </div>

            <p className="text-xs text-slate-600 font-medium">
              {t("علاج مستهدف للمستفيدة:", "Targeted therapy for:")}{" "}
              <strong className="text-brand-900">{patientName(currentPatientObj)}</strong>{" "}
              {t("في يوم", "on")} <strong className="text-brand-900">{dayLabel(pendingExcDay)}</strong>.
            </p>

            <div className="space-y-4 pt-1">
              {/* Exercise meta brief */}
              <div className={`bg-slate-50 p-3.5 rounded-xl border border-slate-100 ${isRtl ? "text-right" : "text-left"}`}>
                <span className="text-[10px] text-slate-450 font-bold block mb-0.5">{t("التمرين المعين:", "Assigned exercise:")}</span>
                <strong className="text-sm text-slate-900 block">{exerciseDisplayName(pendingExc)}</strong>
              </div>
              <ExercisePosePreview
                exerciseId={pendingExc.exercise_id || pendingExc.exerciseId || "ext_spine_01"}
                kimoreMin={pendingExc.kimore_thresholds?.min ?? pendingExc.kimoreMin}
                kimoreMax={pendingExc.kimore_thresholds?.max ?? pendingExc.kimoreMax}
              />

              {/* Grid variables sets & reps */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className={`block text-[10.5px] font-bold text-slate-650 ${isRtl ? "text-right" : "text-left"}`}>{t("المجموعات:", "Sets:")}</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={fineTuneSets}
                    onChange={(e) => setFineTuneSets(parseInt(e.target.value) || 3)}
                    className="w-full border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-xl font-mono text-center font-bold text-slate-800 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className={`block text-[10.5px] font-bold text-slate-650 ${isRtl ? "text-right" : "text-left"}`}>{t("تكرارات المجموعة:", "Reps per set:")}</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={fineTuneReps}
                    onChange={(e) => setFineTuneReps(parseInt(e.target.value) || 12)}
                    className="w-full border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-xl font-mono text-center font-bold text-slate-800 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className={`block text-[10.5px] font-bold text-slate-650 ${isRtl ? "text-right" : "text-left"}`}>{t("الثبات (ثانية):", "Hold (seconds):")}</label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={fineTuneHold}
                    onChange={(e) => setFineTuneHold(parseInt(e.target.value) || 0)}
                    className="w-full border border-slate-200 bg-slate-50 px-3 py-1.5 rounded-xl font-mono text-center font-bold text-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              {/* Safety Precaution input */}
              <div className="space-y-1">
                <label className={`block text-[10.5px] font-bold text-slate-655 ${isRtl ? "text-right" : "text-left"}`}>{t("المحاذير السريرية للسلامة:", "Clinical safety precautions:")}</label>
                <input
                  type="text"
                  value={fineTunePrecaution}
                  onChange={(e) => setFineTunePrecaution(e.target.value)}
                  className={`w-full border border-slate-200 bg-slate-50 px-3.5 py-2 rounded-xl text-xs text-slate-755 focus:outline-none focus:border-slate-400 ${isRtl ? "text-right" : "text-left"}`}
                />
              </div>

              {/* Custom PT Notes instruction */}
              <div className="space-y-1">
                <label className={`block text-[10.5px] font-bold text-slate-655 ${isRtl ? "text-right" : "text-left"}`}>{t("ملاحظات توجيهية إضافية:", "Additional coaching notes:")}</label>
                <textarea
                  rows={2}
                  placeholder={t("مثال: الهدوء عند التمدد، خذ نفساً عميقاً...", "e.g. Move slowly on extension, breathe deeply...")}
                  value={fineTuneNotes}
                  onChange={(e) => setFineTuneNotes(e.target.value)}
                  className={`w-full border border-slate-200 bg-slate-50 px-3.5 py-2 rounded-xl text-xs text-slate-755 focus:outline-none focus:border-slate-400 ${isRtl ? "text-right" : "text-left"}`}
                />
              </div>
            </div>

            <div className={`flex gap-2 pt-3 border-t border-slate-100 ${isRtl ? "flex-row-reverse" : "flex-row"}`}>
              <button
                onClick={saveFineTuning}
                className="bg-brand-650 hover:bg-brand-700 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl cursor-pointer transition shadow-md"
              >
                {t("تطبيق وحفظ بالجدول", "Apply & save to schedule")}
              </button>
              <button
                onClick={() => { setIsFineTuneOpen(false); setPendingExc(null); }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-550 font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl cursor-pointer transition"
              >
                {t("إلغاء التعيين", "Cancel assignment")}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODAL 2: Immersive 3D/2D Knowledge Graph viewer (visualizing RAG logic) */}
      {isGraphLogicOpen && selectedGraphSuggestion && (
        <div className="fixed inset-0 bg-slate-950/80 flex items-center justify-center p-4 z-50 animate-fadeIn" dir={isRtl ? "rtl" : "ltr"}>
          <div className={`bg-slate-900 border border-slate-800 text-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-6 shadow-2xl animate-scaleUp relative overflow-hidden ${isRtl ? "text-right" : "text-left"}`}>
            
            <div className="absolute -top-10 -left-10 w-44 h-44 bg-brand-500/5 rounded-full select-none pointer-events-none blur-3xl"></div>

            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <button 
                onClick={() => { setIsGraphLogicOpen(false); setSelectedGraphSuggestion(null); }}
                className="text-slate-400 hover:text-white transition cursor-pointer"
              >
                ✕
              </button>
              <h3 className={`font-display font-black text-brand-405 text-base sm:text-lg flex items-center gap-1.5 ${isRtl ? "justify-end" : "justify-start"}`}>
                <span>
                  {t("مسار وروابط تأهيل المخطط لـ:", "Rehab graph path for:")}{" "}
                  {exerciseDisplayName(selectedGraphSuggestion)}
                </span>
                <Info className="w-5 h-5 text-brand-400" />
              </h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed font-semibold">
              {t(
                "يستعلم المساعد طبيعياً في شبكة المفاصل والعضلات لربط نوع التمرين بمناطق التشنج الفسيولوجي لـ",
                "The assistant queries the joint & muscle network to link exercises to physiological tension zones for"
              )}{" "}
              <strong>{patientName(currentPatientObj)}</strong>{" "}
              {t("كعناصر مترابطة:", "as linked elements:")}
            </p>

            {/* Simulated 2D diagram of nodes and edges connecting in sequence inside a beautiful box */}
            <div className="bg-slate-950 p-6 rounded-2xl border border-slate-850 space-y-6 text-center shadow-inner">
              
              <div className={`flex flex-col md:flex-row items-center justify-around gap-4 md:gap-2 relative ${isRtl ? "text-right" : "text-left"}`}>
                
                {/* Node 1: Target patient complaint area */}
                <div className="bg-rose-950/40 border border-rose-500/30 p-3 rounded-xl min-w-[110px] text-center space-y-1 relative">
                  <span className="block text-[8px] text-rose-450 font-bold">{t("بؤرة أعراض المريض:", "Patient symptom focus:")}</span>
                  <span className="block text-xs font-black text-rose-350">{patientDiagnosis(currentPatientObj)}</span>
                  <span className="block text-[8.5px] text-slate-500">{t("منطقة:", "Region:")} {painAreaShort(currentPatientObj.painAreaName)}</span>
                </div>

                <div className="text-slate-600 font-mono text-xs hidden md:block select-none flex items-center">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-brand-500" />
                </div>

                {/* Node 2: Muscle or joint region in FitKG */}
                <div className="bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl min-w-[110px] text-center space-y-1 relative">
                  <span className="block text-[8px] text-indigo-400 font-bold">{t("عقدة العضلة المستهدفة:", "Target muscle node:")}</span>
                  <span className="block text-xs font-black text-indigo-300">{selectedGraphSuggestion.target_muscle}</span>
                  <span className="block text-[8.5px] text-slate-500">FitKG Muscle Node</span>
                </div>

                <div className="text-slate-600 font-mono text-xs hidden md:block select-none">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-brand-500" />
                </div>

                {/* Node 3: Selected Recovery Action */}
                <div className="bg-emerald-950/40 border border-emerald-500/30 p-3 rounded-xl min-w-[110px] text-center space-y-1 relative">
                  <span className="block text-[8px] text-emerald-400 font-bold">{t("التمرين العلاجي المصفى:", "Filtered therapeutic exercise:")}</span>
                  <span className="block text-xs font-black text-emerald-300">{exerciseDisplayName(selectedGraphSuggestion)}</span>
                  <span className="block text-[8.5px] text-slate-500">FitKG Exercise Node</span>
                </div>

              </div>

              {/* Edge/Relation labels details */}
              <div className={`border-t border-slate-850/60 pt-4 text-xs space-y-1.5 leading-relaxed text-slate-400 ${isRtl ? "text-right" : "text-left"}`}>
                <p>
                  • <strong>{t("صلة العلاقة (Targets):", "Relation (Targets):")}</strong>{" "}
                  {t(
                    `يرتبط تمرين ${selectedGraphSuggestion.name_ar} مباشرة كـ targets/علاج لـ ${selectedGraphSuggestion.target_muscle}.`,
                    `Exercise ${exerciseDisplayName(selectedGraphSuggestion)} directly targets ${selectedGraphSuggestion.target_muscle}.`
                  )}
                </p>
                <p>
                  • <strong>{t("علاقة التثبيت السلوكي (Stabilizes):", "Stabilizes relation:")}</strong>{" "}
                  {t("تقوم هذه العضلات بتثبيت واستشفاء غلاف الفقرات والمفاصل المعنية في معرّفات تشخيص", "These muscles stabilize the joint envelope for diagnosis")}{" "}
                  <strong>{patientDiagnosis(currentPatientObj)}</strong>.
                </p>
              </div>

            </div>

            {/* Explanation box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed font-semibold">
              <strong className="text-brand-400 block mb-1">{t("الجرعة المبرهنة وأداة التتبع:", "Evidence-based dosing & tracking:")}</strong>
              {exerciseReasoning(selectedGraphSuggestion)}
              <div className="mt-2 text-[10px] text-slate-500">
                {t(
                  `معدلات تتبع استجابة مفاصل المستفيد لبرامج الكاميرا مأخوذة بناءً على عينة (Kimore database model standards) بنسبة ملاءمة ${selectedGraphSuggestion.confidence_score}%.`,
                  `Camera joint-tracking rates follow Kimore model standards with ${selectedGraphSuggestion.confidence_score}% match confidence.`
                )}
              </div>
            </div>

            <div className={`flex pt-2 ${isRtl ? "justify-end" : "justify-start"}`}>
              <button
                onClick={() => { setIsGraphLogicOpen(false); setSelectedGraphSuggestion(null); }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl cursor-pointer transition"
              >
                {t("إغلاق نافذة المعاينة", "Close preview")}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
