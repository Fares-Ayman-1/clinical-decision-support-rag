/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Calendar, ShieldCheck, Eye } from "lucide-react";
import { useLanguage } from "../LanguageContext";

export default function HowItWorks() {
  const { t, isRtl } = useLanguage();

  const steps = [
    {
      num: t("١", "1"),
      title: t("احجز جلستك المرئية بخصوصية", "Book Your Secure Video Session"),
      description: t(
        "اختر أخصائي العلاج الطبيعي المرخص والمناسب لاحتياجاتك. احجز موعدك من التقويم التفاعلي بلمسة زر، ونسق اللقاء الأول مع معالجك المعتمد.",
        "Choose the licensed physical therapist who matches your specific clinical needs. Book a convenient slot on our interactive calendar."
      ),
      icon: Calendar,
      color: "from-blue-500 to-indigo-500",
      bg: "bg-blue-50 text-blue-600"
    },
    {
      num: t("٢", "2"),
      title: t("استلم خطتك العلاجية المخصصة", "Receive Your Customized Plan"),
      description: t(
        "يقوم طبيبك ببرمجة وبناء مجموعة الحركات العلاجية المناسبة لك (التكرار، الزوايا المستهدفة، مدة الثبات) وتصديرها مباشرة للوحتك الخاصة.",
        "Your dedicated specialist configures your precise kinetic program (repetitions, target angles, hold-times), exporting it directly to your dashboard."
      ),
      icon: ShieldCheck,
      color: "from-brand-500 to-brand-600",
      bg: "bg-teal-50 text-brand-600"
    },
    {
      num: t("٣", "3"),
      title: t("تدرّب مع المراقبة الذكية الفورية", "Train with Live AI Correcting"),
      description: t(
        "افتح الكاميرا وابدأ التمارين. يحلل المصحح الذكي حركات المفاصل وزاويا العضلات لتنبيهك فوراً بأي وضعية خاطئة قد تضر بفقراتك، مع احتساب التكرارات آلياً.",
        "Open your camera and follow your routine. The computer vision engine tracks your posture and corrects mistakes live while counting reps."
      ),
      icon: Eye,
      color: "from-emerald-500 to-teal-500",
      bg: "bg-emerald-50 text-emerald-600"
    }
  ];

  return (
    <section className="py-20 bg-slate-50 relative overflow-hidden" id="ai-demo">
      
      {/* Background aesthetics */}
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-64 h-64 bg-brand-100/30 rounded-full blur-3xl -z-10"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Title */}
        <div className="text-center max-w-2xl mx-auto mb-16 space-y-4">
          <span className="font-mono text-xs font-bold text-brand-600 tracking-widest bg-brand-100/50 px-3 py-1 rounded-full uppercase">
            {t("آلية التعافي", "Recovery Mechanism")}
          </span>
          <h2 className="text-3xl sm:text-4xl font-display font-black text-slate-900">
            {t("كيف يعمل مُعَالِجِي؟ ⏳", "How does MyPhysio work? ⏳")}
          </h2>
          <p className="text-slate-650 font-medium">
            {t(
              "٣ خطوات مبسطة تنقلك من الألم إلى الحركة الكاملة وتحت إشراف طبي معتمد من وزارة الصحة.",
              "3 seamless steps moving you from discomfort to full functional flexibility under certified healthcare guidance."
            )}
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          
          {/* Connecting Line */}
          <div className="hidden md:block absolute top-1/3 left-16 right-16 h-0.5 bg-slate-200/80 -z-5"></div>

          {steps.map((step, idx) => {
            const IconComponent = step.icon;
            return (
              <div 
                key={idx} 
                className={`bg-white rounded-3xl p-8 border border-slate-100 shadow-sm hover:shadow-md transition duration-350 relative ${isRtl ? "text-right" : "text-left"} flex flex-col justify-between group`}
              >
                
                {/* Step indicator */}
                <div className={`absolute -top-4 w-8 h-8 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 text-white font-mono text-sm font-bold flex items-center justify-center shadow-md ${isRtl ? "right-8" : "left-8"}`}>
                  {step.num}
                </div>

                <div className="space-y-6 pt-4">
                  {/* Icon wrap */}
                  <div className={`w-12 h-12 rounded-2xl ${step.bg} flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform`}>
                    <IconComponent className="w-6 h-6" />
                  </div>

                  <div className="space-y-2">
                    <h3 className="font-display font-bold text-slate-900 text-lg sm:text-xl leading-snug">
                      {step.title}
                    </h3>
                    <p className="text-slate-600 leading-relaxed text-sm">
                      {step.description}
                    </p>
                  </div>
                </div>

                {/* Lower tiny check */}
                <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center text-[11px] text-slate-400 font-bold">
                  <span>{t("المعلومات مشفرة بدقة", "Data fully encrypted")}</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-brand-400"></div>
                </div>

              </div>
            );
          })}
        </div>

        {/* Dynamic callout box */}
        <div className="mt-16 bg-slate-900 text-white rounded-3xl p-8 sm:p-12 border border-slate-800 shadow-xl relative overflow-hidden flex flex-col md:flex-row justify-between items-center gap-8">
          
          <div className="absolute top-0 right-0 w-80 h-80 bg-brand-600/10 rounded-full blur-3xl -z-5"></div>

          <div className={`${isRtl ? "text-right" : "text-left"} space-y-3.5 z-10 max-w-2xl`}>
            <h4 className="text-xl sm:text-2xl font-display font-black text-brand-400">
              {t("أنت لست مجرد مستخدم، حركتك هي صحتنا 🩺", "Your recovery is our primary mission 🩺")}
            </h4>
            <p className="text-slate-300 text-sm leading-relaxed">
              {t(
                "تلتزم منصة مُعَالِجِي بمعايير سلامة البيانات ومراجعات الحركات الطبية. محرك الذكاء الاصطناعي يقوم بحساب الزوايا والوضعية حركياً على جهازك دون إرسال دفقات الفيديو لخادمنا الخارجي للحفاظ المطلق على خصوصيتك.",
                "MyPhysio adheres to medical grade data protection values. All joint calibration and skeletal measurements happen locally on your client machine with zero video storage on external clouds, ensuring absolute secrecy."
              )}
            </p>
          </div>

          <div className="flex gap-4 items-center z-10 flex-shrink-0">
            <div className="text-center p-4 bg-slate-800/80 border border-slate-700 rounded-2xl w-28 sm:w-32">
              <div className="text-2xl sm:text-3xl font-black text-brand-400 font-mono">{t("١٠٠%", "100%")}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-1">{t("خصوصية وسرية", "Confidentiality")}</div>
            </div>

            <div className="text-center p-4 bg-slate-800/80 border border-slate-700 rounded-2xl w-28 sm:w-32">
              <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono">{t("٣,٢ألف", "3.2K")}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-1">{t("أعراس شفاء ناجحة", "Recovered Patients")}</div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
