/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Activity, ShieldAlert } from "lucide-react";
import { useLanguage } from "../LanguageContext";

export default function Footer() {
  const { t, isRtl } = useLanguage();

  return (
    <footer className="bg-slate-950 text-slate-300 pt-16 pb-8 border-t border-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className={`grid grid-cols-1 md:grid-cols-4 gap-10 pb-12 border-b border-slate-900 ${isRtl ? "text-right" : "text-left"}`}>
          
          {/* Main Logo block */}
          <div className="md:col-span-1.5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-brand-500 text-slate-950 shadow-md">
                <Activity className="w-5.5 h-5.5" />
              </div>
              <div>
                <span className="block font-display text-xl font-black text-brand-400 tracking-tight leading-none">
                  {t("فقراتي", "Faqarati")}
                </span>
                <span className="block text-[10px] font-mono tracking-widest text-slate-500 font-bold leading-normal">
                  {t("FAQARATI . AI", "FAQARATI . AI")}
                </span>
              </div>
            </div>
            
            <p className="text-xs text-slate-400 leading-relaxed">
              {t(
                "منصة علاج طبيعي تجمع قاعدة معرفة موثقة من منظمة الصحة العالمية، ومساعدًا ذكيًا ثلاثي اللغات بالصوت والنص، وشبكة معرفية تخصصية للأخصائيين، مع استشارة ومتابعة مباشرة بين المريض ومعالجه.",
                "Surgical and posture rehabilitation via a certified tele-physiotherapy workspace, blending local client-side computer vision models securely."
              )}
            </p>
          </div>

          {/* Guidelines Links */}
          <div className="space-y-4">
            <h4 className="font-display font-bold text-slate-200 text-sm">{t("خدماتنا التأهيلية", "Clinical Services")}</h4>
            <ul className="space-y-2 text-xs">
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("تخمين خريطة الألم الحركية", "Pain Area Hotspots")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("مختبر قياس زوايا المفاصل", "Live Joints Lab")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("حجز استشارات مع أطباء مرخصين", "Licensed Audio Consultations")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("تأهيل الفقرات وعلاج التصلب", "Vertebral Alignment plans")}</button></li>
            </ul>
          </div>

          {/* Legal / Medical disclaimer links */}
          <div className="space-y-4">
            <h4 className="font-display font-bold text-slate-200 text-sm">{t("القوانين والامتثال", "Compliance & Privacy")}</h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("سياسة الخصوصية وحفظ الأجهزة", "Confidentiality Policy")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("معاهدة HIPAA لأمان البيانات الصحية", "HIPAA Health Data Standards")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("إخلاء المسؤولية المعتمد طبياً", "Medical Safety Disclaimer")}</button></li>
              <li><button className="hover:text-brand-400 cursor-pointer transition">{t("شروط ترخيص وزارة الصحة", "Ministry of Health terms")}</button></li>
            </ul>
          </div>

          {/* Support and contact info */}
          <div className="space-y-4">
            <h4 className="font-display font-bold text-slate-200 text-sm">{t("شريكك المستقبلي", "Future-Forward")}</h4>
            <div className="space-y-2.5 text-xs">
              <p className="font-semibold text-brand-400">fatemah.it@gmail.com</p>
              <p className="text-slate-500">{t("مبادرة وطنية للرعاية الصحية الرقمية المتكاملة بالمملكة العربية السعودية.", "A futuristic digital health initiative designed for remote clinical mobility in Saudi Arabia.")}</p>
              <div className={`flex gap-2.5 pt-1 ${isRtl ? "justify-end" : "justify-start"}`}>
                <span className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded text-emerald-400 text-[9px] font-mono font-bold leading-none">MOH APPROVED</span>
                <span className="bg-slate-900 border border-slate-800 px-2.5 py-1 rounded text-cyan-400 text-[9px] font-mono font-bold leading-none">VITE-TS</span>
              </div>
            </div>
          </div>

        </div>

        {/* Bottom medical disclaimer and copyright */}
        <div className={`pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-400 ${isRtl ? "text-right" : "text-left"}`}>
          <p className="order-last sm:order-first">
            {t("© ٢٠٢٦ منصة فقراتي (Faqarati). كافة الحقوق محفوظة. تم التطوير كنموذج MVP طبي مبتكر.", "© 2026 Faqarati (فقراتي). All rights reserved. Created as an innovative clinical MVP.")}
          </p>

          <div className="flex items-center gap-2.5 bg-slate-900/40 p-2.5 rounded-xl border border-slate-900 max-w-lg">
            <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <p className="text-[10px] text-slate-500 leading-normal">
              <strong>{t("تنويه طبي:", "Medical disclaimer:")}</strong> {t("قياسات الذكاء الاصطناعي للمنصة تهدف للمساعدة والتحقق السريري ولا ينبغي استخدامها بمثابة المشورة الاستبدالية التامة لأخصائي جراحة العظام دون متابعته المباشرة للتقرير العلاجي.", "AI skeletal measurements serve of descriptive support and assistance. They must not bypass or substitute manual diagnosis or customized orthopaedic clinical guidance.")}
            </p>
          </div>
        </div>

      </div>
    </footer>
  );
}
