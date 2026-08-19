/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Express } from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs/promises";
import { readGraph, writeGraph, getExerciseNodes } from "./graphHelpers";

dotenv.config();

// Einstein runs on the SAME LLM provider as the clinical backend — Ollama
// cloud (gpt-oss:20b), not Gemini: one provider, one key (OLLAMA_API_KEY),
// one bill. gpt-oss follows JSON-shape instructions reliably; the schema is
// stated in the prompt and the reply is fence-stripped before parsing.
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "https://ollama.com/v1";
const OLLAMA_MODEL = process.env.LLM_MODEL || "gpt-oss:20b";

async function ollamaJson(prompt: string, shapeHint: string): Promise<unknown> {
  const apiKey = process.env.OLLAMA_API_KEY || process.env.LLM_API_KEY || "";
  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Respond with ONLY valid JSON exactly matching the requested shape. " +
            "No prose, no markdown fences, no comments.",
        },
        { role: "user", content: `${prompt}

Required JSON shape:
${shapeHint}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM provider error ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  let text = (data.choices?.[0]?.message?.content ?? "").trim();
  // Fence-strip + slice to the outermost JSON value: models occasionally
  // wrap JSON despite instructions, and failing on that is a needless 500.
  text = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = Math.min(...[text.indexOf("["), text.indexOf("{")].filter((i) => i >= 0));
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  return JSON.parse(text.slice(start, end + 1));
}

export type AppMode = "development" | "production" | "serverless";

export function createApp(mode: AppMode = "production"): Express {
  const app = express();
  app.use(express.json());

  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const emptySchedule = () =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, []])) as Record<string, unknown[]>;

  const patientSchedules: Record<string, any> = {
    p1: {
      Monday: [
        {
          id: "sch-1",
          exerciseId: "ext_spine_01",
          nameAr: "تمديد العمود الفقري للقطنية",
          nameEn: "Lumbar Extension Stretch",
          sets: 3,
          reps: 10,
          holdTime: 5,
          clinicalPrecaution: "حافظ على ثبات الرقبة أثناء الدفع",
          notes: "",
          targetMuscle: "Lower Back",
          kimoreMin: 145,
          kimoreMax: 175,
        },
      ],
      Tuesday: [],
      Wednesday: [
        {
          id: "sch-2",
          exerciseId: "knee_squat_01",
          nameAr: "تمرين القرفصاء التأهيلي للركبة",
          nameEn: "Rehab Squats for Knees",
          sets: 3,
          reps: 8,
          holdTime: 0,
          clinicalPrecaution: "النزول عند زاوية 90 درجة",
          notes: "",
          targetMuscle: "Quadriceps",
          kimoreMin: 85,
          kimoreMax: 105,
        },
      ],
      Thursday: [],
      Friday: [],
      Saturday: [],
      Sunday: [],
    },
  };

  const sessionLogs: Record<string, any[]> = {
    p1: [
      {
        id: "log-demo-1",
        patientId: "p1",
        exerciseId: "ext_spine_01",
        exerciseNameAr: "تمديد العمود الفقري للقطنية",
        exerciseNameEn: "Lumbar Extension Stretch",
        date: "2026-06-23",
        durationSeconds: 360,
        completionRate: 100,
        completedReps: 10,
        targetReps: 10,
        accuracyScore: 94.8,
      },
    ],
    p2: [
      {
        id: "log-demo-2",
        patientId: "p2",
        exerciseId: "knee_squat_01",
        exerciseNameAr: "القرفصاء لتأهيل خشونة الركبة",
        exerciseNameEn: "Rehab Squats for Knees",
        date: "2026-06-22",
        durationSeconds: 240,
        completionRate: 88,
        completedReps: 8,
        targetReps: 8,
        accuracyScore: 88.5,
      },
    ],
    p3: [],
  };
  const painJournal: Record<string, any[]> = { p1: [] };
  const triageReports: Record<string, any> = {};
  const exerciseRatings: any[] = [];

  app.get("/api/schedule/:patientId", (req, res) => {
    const { patientId } = req.params;
    const schedule = patientSchedules[patientId] || emptySchedule();
    res.json({ patientId, schedule });
  });

  app.post("/api/schedule/publish", (req, res) => {
    const { patientId, schedule } = req.body;
    if (!patientId) {
      return res.status(400).json({ error: "معرّف المريض (patientId) مطلوب." });
    }
    patientSchedules[patientId] = schedule;
    res.json({ success: true, message: "تم نشر وتزامن جدول التأهيل للمستفيد بنجاح!" });
  });

  app.post("/api/sessions/log", (req, res) => {
    const body = req.body;
    if (!body.patientId || !body.exerciseId) {
      return res.status(400).json({ error: "patientId and exerciseId are required." });
    }
    const log = {
      id: `log-${Date.now()}`,
      ...body,
      date: body.completedAt?.split("T")[0] || new Date().toISOString().split("T")[0],
    };
    if (!sessionLogs[body.patientId]) sessionLogs[body.patientId] = [];
    sessionLogs[body.patientId].unshift(log);
    res.json({ success: true, sessionLogId: log.id, log });
  });

  app.get("/api/sessions/:patientId", (req, res) => {
    const { patientId } = req.params;
    res.json({ patientId, logs: sessionLogs[patientId] || [] });
  });

  app.get("/api/sessions/:patientId/summary", (req, res) => {
    const { patientId } = req.params;
    const logs = sessionLogs[patientId] || [];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = logs.filter((l: any) => {
      const t = new Date(l.completedAt || l.date).getTime();
      return !isNaN(t) && t >= weekAgo;
    });
    const avgAccuracy =
      recent.length > 0
        ? recent.reduce((s: number, l: any) => s + (l.accuracyScore || 0), 0) / recent.length
        : 0;
    res.json({
      patientId,
      weeklyAdherence: recent.length > 0 ? Math.min(100, recent.length * 25) : 0,
      avgAccuracy: Math.round(avgAccuracy * 10) / 10,
      sessionsThisWeek: recent.length,
      dailyCompletion: [],
    });
  });

  app.post("/api/ratings", (req, res) => {
    const { sessionLogId, patientId, difficulty, painDuring, note } = req.body;
    if (!sessionLogId || !patientId) {
      return res.status(400).json({ error: "sessionLogId and patientId are required." });
    }
    const rating = {
      id: `rat-${Date.now()}`,
      sessionLogId,
      patientId,
      difficulty,
      painDuring,
      note,
      createdAt: new Date().toISOString(),
    };
    exerciseRatings.push(rating);
    const logs = sessionLogs[patientId] || [];
    const idx = logs.findIndex((l: any) => l.id === sessionLogId);
    if (idx !== -1) {
      logs[idx].difficultyRating = difficulty;
      logs[idx].patientPainRating = painDuring;
      if (note) logs[idx].feedbackNotes = note;
    }
    res.json({ success: true, ratingId: rating.id });
  });

  app.post("/api/triage", (req, res) => {
    const body = req.body;
    const id = `tri-${Date.now()}`;
    const report = {
      id,
      ...body,
      recommendedExerciseIds: body.recommendedExerciseIds || ["ext_spine_01"],
      matchedTherapistIds: body.matchedTherapistIds || ["t1"],
      createdAt: new Date().toISOString(),
    };
    if (body.patientId) triageReports[body.patientId] = report;
    res.json(report);
  });

  app.get("/api/triage/:patientId", (req, res) => {
    const report = triageReports[req.params.patientId];
    if (!report) return res.status(404).json({ error: "No triage report found." });
    res.json(report);
  });

  app.post("/api/pain-journal", (req, res) => {
    const { patientId, date, region, painLevel, stiffness, sleepImpact, notes } = req.body;
    if (!patientId || painLevel == null) {
      return res.status(400).json({ error: "patientId and painLevel are required." });
    }
    const entry = {
      id: `pj-${Date.now()}`,
      patientId,
      date: date || new Date().toISOString().split("T")[0],
      region,
      painLevel,
      stiffness,
      sleepImpact,
      notes,
    };
    if (!painJournal[patientId]) painJournal[patientId] = [];
    painJournal[patientId].unshift(entry);
    res.json({ success: true, ...entry });
  });

  app.get("/api/pain-journal/:patientId", (req, res) => {
    const { patientId } = req.params;
    const entries = painJournal[patientId] || [];
    res.json({ patientId, entries });
  });

  app.get("/api/exercises", async (_req, res) => {
    try {
      const graph = await readGraph();
      res.json({ exercises: getExerciseNodes(graph), graph });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load exercises" });
    }
  });

  app.get("/api/admin/exercises", async (_req, res) => {
    try {
      const graph = await readGraph();
      res.json(graph);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load graph" });
    }
  });

  app.post("/api/admin/graph/sync", async (req, res) => {
    try {
      const body = req.body;
      if (!body?.nodes || !body?.edges) {
        return res.status(400).json({ error: "nodes and edges are required" });
      }
      await writeGraph(body);
      res.json({ success: true, message: "FitKG graph synced", nodeCount: body.nodes.length });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Sync failed" });
    }
  });

  app.post("/api/einstein/suggest", async (req, res) => {
    const { patient_id, pain_regions, custom_prompt } = req.body;

    let graphData: any = { nodes: [], edges: [] };
    let searchIndex: any = { keywords: {} };
    try {
      graphData = await readGraph();
      const searchStr = await fs.readFile(path.join(process.cwd(), "search_index.json"), "utf8");
      searchIndex = JSON.parse(searchStr);
    } catch (err) {
      console.warn("Failed to load local FitKG files, using fallback context:", err);
    }

    let matchedExerciseNodes: any[] = [];
    if (pain_regions && Array.isArray(pain_regions)) {
      pain_regions.forEach((region: string) => {
        const matches = searchIndex.keywords[region] || searchIndex.keywords[region.toLowerCase()] || [];
        matches.forEach((nodeId: string) => {
          const node = graphData.nodes.find((n: any) => n.id === nodeId);
          if (node && node.type === "Exercise") {
            if (!matchedExerciseNodes.some((x) => x.id === node.id)) {
              matchedExerciseNodes.push(node);
            }
          }
        });
      });
    }

    if (matchedExerciseNodes.length === 0) {
      matchedExerciseNodes = graphData.nodes.filter((n: any) => n.type === "Exercise");
    }

    try {
      const prompt = `أنت المساعد الذكي السريري المتقدم "أينشتاين (Einstein)"، الخبير في العلاج الطبيعي والتأهيل الحركي لمنصة "فقراتي (.Faqarati)".
      مهمتك هي مراجعة بيانات المريض واستعلام "مخطط المعرفة الحيوية (FitKG)" المرفقة أدناه لتصميم واقتراح التمارين المتناسقة مع حالته.

      طلب الأخصائي المعالج المخصص لـ "أينشتاين":
      - معرّف المريض المستعلم: ${patient_id || "غير محدد"}
      - مناطق الألم المحددة: ${JSON.stringify(pain_regions || [])}
      - توجيه الأخصائي المخصص (إن وجد): "${custom_prompt || "لا يوجد توجيه خاص، قم بوضع الخطة الافتراضية"}"

      مخطط المعرفة السلوكي الساكن لتمارين (FitKG Exercises):
      ${JSON.stringify(matchedExerciseNodes)}

      الروابط والعلاقات الميكانيكية للشبكة الطبية:
      ${JSON.stringify(graphData.edges)}

      بناءً على التوجيه المخصص (مثل "تقليل الجيل الحركي"، "مريض كبير في السن"، "صيانة تشنجات مفرطة"):
      1. قم بتحديث نسبة ملاءمة التمرين "confidence_score" (من 50 إلى 99).
      2. عدل التكرارات والمجموعات المقترحة "suggested_sets" و "suggested_reps" لتلائم طلب الأخصائي المخصص.
      3. قم بصياغة شرح سريري باللغة العربية "reasoning_ar" يشرح للأخصائي سبب اختيار وتعديل هذا التمرين بناءً على ترابط العضلات والمفاصل في المخطط (RAG Reasoning).

      الرجاء العودة بمصفوفة JSON تحتوي قائمة التمارين المرشحة للجرعة العلاجية.`;

      const generatedData = await ollamaJson(
        prompt,
        `[{"id": string, "name_ar": string, "name_en": string, "suggested_sets": number, "suggested_reps": number, "confidence_score": number between 50 and 99, "target_muscle": string, "reasoning_ar": string (Arabic clinical reasoning), "kimore_thresholds": {"min": number, "max": number}}] — an array covering the candidate exercises`,
      );
      res.json(generatedData);
    } catch (error: any) {
      console.error("Einstein Suggestion Error:", error);
      res.status(500).json({
        error: "فشل استدعاء المساعد الذكي أينشتاين.",
        details: error?.message || String(error),
      });
    }
  });

  app.post("/api/copilot/suggest-treatment", async (req, res) => {
    const { patientName, age, painAreaName, severity, patientHistory } = req.body;

    if (!painAreaName) {
      return res.status(400).json({ error: "معلم منطقة الألم مطلوب ومفقود." });
    }

    const medicalRAGDocuments = {
      "Neck & Upper Shoulders": [
        "المستند السريري للفقرات العنقية ٢٠٢٥: ينصح بتقليل التدوير الحاد واستخدام تمرين تمدد الأذن الخفيف مع المحافظة على زاوية ثنائية بين الكتف والمرفق بمعدل ٦٥ إلى ٨٥ درجة.",
        "إجراءات تخفيف تشنج الأكتاف: تمديد الكتف بمستوى موازٍ للأرض يعزز من مرونة العضلات الدالية دون التسبب بضغط حركي على غضروف الأكتاف.",
      ],
      "Spine & Lower Back": [
        "بروتوكول تمدد أسفل الظهر التفاعلي للقطنية: يطالب بالثبات من ٥ إلى ١٠ ثوانٍ كحد أقصى وزاوية العمود الفقري (استقامة الجذع والرقبة) بمستوى تماثل بين ١٤٥° إلى ١٧٥° لتوسيع الفضاءات البينية للفقرات.",
        "دليل تأهيل آلام الديسك والانزلاق الغضروفي: التدرج في رفع الجسم مع الحفاظ على استقامة الجزء العلوي من الظهر والتحكم الزاوي بالركبتين لتجنب الضغط الزائد.",
      ],
      "Knee & Leg Joints": [
        "بروتوكول القرفصاء التأهيلي لخشونة الركبة ٢٠٢٦: يجب تقييد حركة النزول عند زاوية ٨٥° إلى ١٠٥° درجة لضمان تقوية الكواد وعضلات الفخذ دون تجاوز مشط القدم وتثبيت عظمة الرضفة.",
        "كراسات التأهيل الوظيفي لخشونة المفاصل: ممارسة القرفصاء بزاوية تحرك مسندة للوقاية من تآكل الغضروف الهلالي للركبتين.",
      ],
    };

    let customRAGContext = "";
    if (painAreaName.includes("ظهر") || painAreaName.includes("Spine") || painAreaName.includes("Back")) {
      customRAGContext = medicalRAGDocuments["Spine & Lower Back"].join("\n");
    } else if (painAreaName.includes("رقبة") || painAreaName.includes("Neck") || painAreaName.includes("Shoulders")) {
      customRAGContext = medicalRAGDocuments["Neck & Upper Shoulders"].join("\n");
    } else {
      customRAGContext = medicalRAGDocuments["Knee & Leg Joints"].join("\n");
    }

    try {
      const prompt = `أنت أخصائي علاج طبيعي ومستشار حركي ذكي خبير تعمل لدى منصة "فقراتي (.Faqarati)" للتأهيل الطبي.
      بناءً على معلومات المريض والمنطقة المصابة وتفاصيل التشخيص أدناه، بالإضافة لـ مستندات المعرفة الطبية المرجعية المرفقة (RAG Context)، صمم خطة تمرين حركي مخصصة ودقيقة وقابلة للتتبع بالكاميرا عبر MediaPipe.
      
      معلومات الحالة:
      - اسم المستفيد: ${patientName || "غير محدد"}
      - العمر: ${age || "غير محدد"} عاماً
      - منطقة الألم: ${painAreaName}
      - شدة الألم: ${severity || "متوسطة"}
      - تاريخ الإصابات والتشخيص: ${patientHistory || "لا يوجد عمليات تذكر"}

      مستندات المرجع الطبي السريري المقيدة (RAG Context):
      ${customRAGContext}

      يرجى توفير استجابة مبنية تماماً على هذه الإرشادات السريرية وملتزمة بالسلامة المريضية والترجمات العربية الدقيقة والمصطلحات الرياضية والفيزيولوجية الملائمة.`;

      const generatedData = await ollamaJson(
        prompt,
        `{"exerciseId": one of "ex-spine"|"ex-neck"|"ex-squat"|"ex-shoulder", "sets": string, "reps": string, "holdTime": string (seconds), "idealJoints": string (Arabic), "recommendedAngleRange": string like "145-175", "clinicalPrecautionAr": string (Arabic), "reasoningAr": string (Arabic, grounded in the RAG documents), "citations": string[] (titles of the referenced RAG documents)}`,
      );
      res.json(generatedData);
    } catch (error: any) {
      console.error("Copilot LLM Error:", error);
      res.status(500).json({
        error: "فشل استدعاء مستشار الخطة الذكي الرشيق.",
        details: error?.message || String(error),
      });
    }
  });

  if (mode === "production") {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return app;
}
