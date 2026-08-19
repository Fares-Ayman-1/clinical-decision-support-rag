/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useLanguage } from "../../LanguageContext";

const THREADS = [
  {
    id: "p1",
    name: { ar: "فاطمة محمد الأحمد", en: "Fatemah Al-Ahmad" },
    last: {
      ar: "هل أستمر بنفس عدد المجموعات إذا تراجع الألم؟",
      en: "Should I keep the same sets if pain drops to 3/10?",
    },
    unread: 1,
  },
  {
    id: "p2",
    name: { ar: "ياسر الحربي", en: "Yaser Al-Harbi" },
    last: { ar: "شكراً دكتور، الركبة أفضل بعد القرفصاء.", en: "Thanks doc, knee feels better after squats." },
    unread: 0,
  },
];

const MESSAGES: Record<string, { from: "pt" | "patient"; ar: string; en: string; time: string }[]> = {
  p1: [
    { from: "patient", ar: "دكتور، هل أستمر بنفس عدد المجموعات؟", en: "Doctor, should I keep the same number of sets?", time: "09:12" },
    { from: "pt", ar: "نعم فاطمة، استمري لتثبيت دعم الفقرات.", en: "Yes Fatemah, continue to stabilize spinal support.", time: "10:15" },
  ],
  p2: [
    { from: "pt", ar: "ركز على زاوية ٩٠° في القرفصاء اليوم.", en: "Focus on 90° squat angle today.", time: "08:00" },
    { from: "patient", ar: "تم، شعرت بتحسن.", en: "Done, felt improvement.", time: "08:45" },
  ],
};

export default function PTMessagesTab() {
  const { t, isRtl, lang } = useLanguage();
  const bt = (b: { ar: string; en: string }) => t(b.ar, b.en);
  const [activeId, setActiveId] = useState("p1");
  const [draft, setDraft] = useState("");
  const [extra, setExtra] = useState<typeof MESSAGES.p1>([]);

  const thread = THREADS.find((th) => th.id === activeId)!;
  const msgs = [...(MESSAGES[activeId] || []), ...extra];

  const send = () => {
    if (!draft.trim()) return;
    setExtra((prev) => [
      ...prev,
      { from: "pt", ar: draft, en: draft, time: new Date().toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" }) },
    ]);
    setDraft("");
  };

  return (
    <div className={`grid grid-cols-1 md:grid-cols-12 gap-4 min-h-[420px] ${isRtl ? "text-right" : "text-left"}`} dir={isRtl ? "rtl" : "ltr"}>
      <div className="md:col-span-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-3 border-b font-bold text-sm text-slate-800 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-brand-600" />
          {t("مرضى نشطون", "Active patients")}
        </div>
        {THREADS.map((th) => (
          <button
            key={th.id}
            type="button"
            onClick={() => { setActiveId(th.id); setExtra([]); }}
            className={`w-full p-3 border-b text-left hover:bg-slate-50 ${activeId === th.id ? "bg-brand-50" : ""}`}
          >
            <div className="flex justify-between">
              <span className="font-bold text-sm">{bt(th.name)}</span>
              {th.unread > 0 && (
                <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 rounded-full">{th.unread}</span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 truncate mt-0.5">{bt(th.last)}</p>
          </button>
        ))}
      </div>

      <div className="md:col-span-8 bg-white border border-slate-200 rounded-2xl flex flex-col">
        <div className="p-3 border-b font-bold text-sm">{bt(thread.name)}</div>
        <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[320px]">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.from === "pt" ? (isRtl ? "justify-start" : "justify-end") : isRtl ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs ${
                  m.from === "pt" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"
                }`}
              >
                {bt(m)}
                <span className="block text-[9px] opacity-70 mt-1">{m.time}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t("رسالة للمريض...", "Message patient...")}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          />
          <button type="button" onClick={send} className="bg-brand-600 text-white p-2.5 rounded-xl">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
