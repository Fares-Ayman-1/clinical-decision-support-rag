/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, FormEvent } from "react";
import { X, ShieldAlert, Key, Heart, Shield, Check, Lock, Smartphone } from "lucide-react";
import { useLanguage } from "../LanguageContext";
import { UserRole } from "../types";

interface AuthModalProps {
  onClose: () => void;
  onLoginSuccess: (user: { name: string; role: UserRole; email: string }) => void;
  initialRole?: UserRole;
}

export default function AuthModal({ onClose, onLoginSuccess, initialRole = "patient" }: AuthModalProps) {
  const { lang, t, isRtl } = useLanguage();
  const [role, setRole] = useState<UserRole>(initialRole);
  const [isSignUp, setIsSignUp] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [license, setLicense] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  
  // OTP simulation states
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [otpCode, setOtpCode] = useState<string>("");
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Auto preset fills for quicker demo evaluation
  const handlePresetTrigger = (presetRole: UserRole) => {
    setRole(presetRole);
    if (presetRole === "patient") {
      setEmail("fatemah.it@gmail.com");
      setName(t("فاطمة محمد الأحمد", "Fatemah Mohammad Al-Ahmad"));
      setPhone("0501234567");
    } else if (presetRole === "therapist") {
      setEmail("ruwaili@faqarati.com");
      setName(t("د. أحمد الرويلي", "Dr. Ahmad Al-Ruwaili"));
      setPhone("0554917382");
      setLicense("MOH-10294-PT");
    } else {
      setEmail("admin@faqarati.com");
      setName(t("مشرف المنصة المعتمد", "Authorized Platform Administrator"));
      setPhone("0561112223");
    }
  };

  const handleSendOtp = (e: FormEvent) => {
    e.preventDefault();
    if (!email || (isSignUp && !name) || (role === "therapist" && isSignUp && !license)) {
      alert(t("الرجاء ملء الخانات الإلزامية لتأمين إرسال رمز التحقق الرقمي!", "Please fill in all mandatory fields to secure OTP transmission!"));
      return;
    }
    setOtpSent(true);
  };

  const handleVerifyOtp = (e: FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 4) {
      alert(t("رمز التحقق OTP يتكون من ٤ أرقام مرسلة إلى هاتفك!", "OTP code must be 4 digits sent to your phone!"));
      return;
    }
    setIsVerifying(true);
    setTimeout(() => {
      onLoginSuccess({
        name: name || (role === "patient" ? t("مستخدم تجريبي", "Demo Patient") : role === "therapist" ? t("د. أحمد الرويلي", "Dr. Ahmad Al-Ruwaili") : t("مدير الجلسات", "Platform Director")),
        role,
        email: email || "user@faqarati.com"
      });
      setIsVerifying(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border border-slate-100 shadow-2xl relative ${isRtl ? "text-right" : "text-left"} space-y-6 animate-in zoom-in-95 duration-200`}>
        
        {/* Head */}
        <div className={`flex justify-between items-start border-b border-slate-100 pb-3 ${isRtl ? "flex-row" : "flex-row-reverse"}`}>
          <button
            onClick={onClose}
            className="p-1 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition"
          >
            {t("إغلاق", "Close")}
          </button>
          <div className={isRtl ? "text-right" : "text-left"}>
            <h3 className="font-display font-black text-slate-900 text-lg sm:text-xl">
              {otpSent 
                ? t("حقوق التحقق الثنائي OTP", "Two-Factor Authentication") 
                : isSignUp 
                  ? t("إنشاء حساب صحي حركي جديد", "Create New Account") 
                  : t("تسجيل الدخول الآمن", "Secure Gateway Sign-In")}
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {t("بوابة الرعاية السريرية المدعمة برؤية الكمبيوتر", "Computer Vision Supported Recovery Portal")}
            </p>
          </div>
        </div>

        {/* Preset accounts helper for demo purposes */}
        {!otpSent && (
          <div className="bg-brand-50/70 border border-brand-100 p-3.5 rounded-xl space-y-1.5 text-xs text-brand-900">
            <div className="font-bold">{t("💡 تجربة سريعة (اضغط للتعبئة التلقائية للبيانات):", "💡 Quick Demo (Click to autofill mock credentials):")}</div>
            <div className={`flex gap-2 ${isRtl ? "justify-end" : "justify-start"}`}>
              <button
                onClick={() => handlePresetTrigger("admin")}
                className="bg-purple-150 text-purple-900 font-bold px-2 py-1 rounded hover:bg-purple-200 cursor-pointer text-[10px]"
              >
                {t("حساب المشرف", "Platform Admin")}
              </button>
              <button
                onClick={() => handlePresetTrigger("therapist")}
                className="bg-indigo-150 text-indigo-900 font-bold px-2 py-1 rounded hover:bg-indigo-200 cursor-pointer text-[10px]"
              >
                {t("أخصائي (PT)", "PT Specialist")}
              </button>
              <button
                onClick={() => handlePresetTrigger("patient")}
                className="bg-teal-150 text-teal-900 font-bold px-2 py-1 rounded hover:bg-teal-200 cursor-pointer text-[10px]"
              >
                {t("مريض (Patient)", "Patient Account")}
              </button>
            </div>
          </div>
        )}

        {/* Tab switch for roles if not otp screen */}
        {!otpSent && (
          <div className="space-y-2">
            <span className="block text-xs font-bold text-slate-400">{t("اختر صلاحية الحساب الطبي:", "Choose Account Role:")}</span>
            <div className="grid grid-cols-3 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button
                onClick={() => handlePresetTrigger("admin")}
                className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  role === "admin" ? "bg-slate-950 text-white shadow-xs" : "text-slate-650 hover:bg-white"
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{t("مشرف", "Admin")}</span>
              </button>
              
              <button
                onClick={() => handlePresetTrigger("therapist")}
                className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  role === "therapist" ? "bg-brand-600 text-white shadow-xs" : "text-slate-650 hover:bg-white"
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                <span>{t("أخصائي PT", "PT Specialist")}</span>
              </button>

              <button
                onClick={() => handlePresetTrigger("patient")}
                className={`py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  role === "patient" ? "bg-brand-600 text-white shadow-xs" : "text-slate-650 hover:bg-white"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{t("مريض", "Patient")}</span>
              </button>
            </div>
          </div>
        )}

        {/* Actual Form */}
        {!otpSent ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            
            {isSignUp && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-650">{t("الاسم الثلاثي بالكامل (كما في الهوية الوطنية):", "Full Medical Name (As on ID):")}</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("مثال: فاطمة محمد الأحمد", "e.g. Fatemah Al-Ahmad")}
                  className={`w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-brand-500 bg-slate-50 ${isRtl ? "text-right" : "text-left"} font-semibold`}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-650">{t("البريد الإلكتروني:", "Email Address:")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="fatemah.it@gmail.com"
                className={`w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-brand-500 bg-slate-50 ${isRtl ? "text-right" : "text-left"} font-semibold`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-650">{t("رقم الهاتف (لتلقي الـ OTP الرقمي):", "Mobile Phone (For verification OTP pin):")}</label>
              <div className="relative">
                <Smartphone className="absolute top-2.5 left-3 w-4.5 h-4.5 text-slate-400" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0501234567"
                  className={`w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:border-brand-500 bg-slate-50 ${isRtl ? "text-right" : "text-left"} font-mono`}
                />
              </div>
            </div>

            {role === "therapist" && isSignUp && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-650">{t("رقم ترخيص مزاولة المهنة للهيئة الطبية (MOH):", "Certified Healthcare License (MOH ID):")}</label>
                <input
                  type="text"
                  required
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  placeholder="مثال: MOH-10294-PT"
                  className={`w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:border-brand-500 bg-slate-50 ${isRtl ? "text-right" : "text-left"} font-mono`}
                />
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm cursor-pointer transition shadow-md shadow-brand-500/10 flex items-center justify-center gap-2"
            >
              <span>{t("أرسل رمز التحقق المؤقت", "Get Verification Code")}</span>
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-slate-500 hover:text-brand-600 font-bold hover:underline"
              >
                {isSignUp 
                  ? t("لديك حساب بالفعل؟ سجل الدخول", "Already have an account? Sign In") 
                  : t("ليس لديك حساب؟ سجل كمستفيد جديد", "New beneficiary? Create Account")}
              </button>
            </div>

          </form>
        ) : (
          /* OTP Screen */
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="text-center bg-slate-50 p-4 rounded-xl border border-slate-150 space-y-1">
              <span className="block text-[11px] text-slate-400 font-bold">{t("تم إرسال الرمز لطلب الحساب على رقم:", "Verification pin was sent to:")}</span>
              <span className="block font-mono font-bold text-brand-850 text-sm">{phone || "الهاتف النشط"}</span>
            </div>

            <div className="space-y-2 text-center">
              <label className={`block text-xs font-bold text-slate-650 ${isRtl ? "text-right" : "text-left"}`}>{t("أدخل رمز التحقق (OTP) المتكون من ٤ أرقام:", "Enter 4-Digit Verification PIN:")}</label>
              
              <div className="flex gap-2 justify-center py-2" dir="ltr">
                <input
                  type="text"
                  maxLength={4}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="----"
                  className="w-32 py-3 rounded-xl border-2 border-brand-300 focus:border-brand-500 text-center text-xl font-bold font-mono tracking-widest bg-slate-50 outline-hidden"
                />
              </div>

              <div className="text-xs text-slate-400 font-medium">
                {t("اكتب أي ٤ أرقام لتسهيل المراجعة والمضي قدماً", "Type any 4 numbers to easily bypass and test the mock validation")}
              </div>
            </div>

            <button
              type="submit"
              disabled={isVerifying}
              className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-350 text-white font-bold text-sm cursor-pointer transition shadow-md flex items-center justify-center gap-2"
            >
              <Key className="w-4 h-4 text-brand-400" />
              <span>{isVerifying ? t("قيد التدقيق الطبي...", "Validating Credentials...") : t("تحقق وتأكيد الدخول", "Confirm & Register Entrance")}</span>
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode("");
                }}
                className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
              >
                {t("تعديل رقم الهاتف أو صلاحية الحساب", "Modify phone number or role selection")}
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
}
