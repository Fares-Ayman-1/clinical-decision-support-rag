/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Calendar, Video, Clock, User } from "lucide-react";
import { useLanguage } from "../../LanguageContext";

const DEMO_APPOINTMENTS = [
  { id: "a1", patient: { ar: "فاطمة محمد الأحمد", en: "Fatemah Al-Ahmad" }, date: "2026-06-25", time: "10:30", status: "upcoming" as const },
  { id: "a2", patient: { ar: "ياسر الحربي", en: "Yaser Al-Harbi" }, date: "2026-06-26", time: "14:00", status: "upcoming" as const },
  { id: "a3", patient: { ar: "خلود العتيبي", en: "Kholoud Al-Otaibi" }, date: "2026-06-24", time: "16:00", status: "completed" as const },
];

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function PTScheduleTab() {
  const { t, isRtl } = useLanguage();
  const bt = (b: { ar: string; en: string }) => t(b.ar, b.en);

  return (
    <div className={`space-y-6 ${isRtl ? "text-right" : "text-left"}`} dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex justify-between items-center">
        <h3 className="font-display font-black text-slate-900 text-xl flex items-center gap-2">
          <Calendar className="w-5 h-5 text-brand-600" />
          {t("جدول العيادة والجلسات المرئية", "Clinic & Telehealth Schedule")}
        </h3>
        <span className="text-xs font-bold text-slate-500">{t("أسبوع ٢٣–٢٩ يونيو ٢٠٢٦", "Week 23–29 Jun 2026")}</span>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {WEEKDAYS.map((day, i) => {
          const appts = DEMO_APPOINTMENTS.filter((_, idx) => idx % 7 === i);
          return (
            <div key={day} className="bg-slate-50 border border-slate-200 rounded-xl p-2 min-h-[100px]">
              <span className="text-[10px] font-black text-slate-500 block mb-2">
                {t(
                  ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"][i],
                  day.slice(0, 3)
                )}
              </span>
              {appts.map((a) => (
                <div
                  key={a.id}
                  className={`text-[9px] p-1.5 rounded-lg mb-1 ${
                    a.status === "completed" ? "bg-slate-200 text-slate-600" : "bg-brand-100 text-brand-900"
                  }`}
                >
                  <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                  {a.time}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <h4 className="font-bold text-sm text-slate-700">{t("المواعيد القادمة", "Upcoming sessions")}</h4>
        {DEMO_APPOINTMENTS.map((a) => (
          <div
            key={a.id}
            className="bg-white border border-slate-150 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
                <User className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-sm">{bt(a.patient)}</p>
                <p className="text-xs text-slate-500">
                  {a.date} · {a.time}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 bg-slate-950 text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              <Video className="w-3.5 h-3.5" />
              {a.status === "completed" ? t("مكتملة", "Completed") : t("بدء الجلسة المرئية", "Start video session")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
