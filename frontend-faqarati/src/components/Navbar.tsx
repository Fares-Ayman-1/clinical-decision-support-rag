/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Activity, Menu, X, User, Heart, Shield, Settings, Globe } from "lucide-react";
import { useLanguage } from "../LanguageContext";

interface NavbarProps {
  currentView: string;
  setView: (view: string) => void;
  openAuth: (role?: "patient" | "therapist" | "admin") => void;
  currentUser: { name: string; role: string } | null;
  logout: () => void;
}

export default function Navbar({
  currentView,
  setView,
  openAuth,
  currentUser,
  logout,
}: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { lang, setLang, t, isRtl } = useLanguage();

  const getNavItems = () => {
    if (!currentUser) {
      return [
        { id: "landing", label: t("الرئيسية", "Home") },
        { id: "pain-map", label: t("خريطة الألم", "Pain Map") },
        { id: "clinics", label: t("المعالجون المعتمدون", "Our Therapists") },
        { id: "ai-demo", label: t("مختبر الذكاء الاصطناعي", "AI Motion Lab") },
      ];
    }
    if (currentUser.role === "patient") {
      return [
        { id: "landing", label: t("الرئيسية", "Home") },
        { id: "patient-portal", label: t("جناح المريض", "Patient Suite") },
        { id: "pain-map", label: t("خريطة الألم", "Pain Map") },
        { id: "clinics", label: t("المعالجون المعتمدون", "Our Therapists") },
        { id: "ai-demo", label: t("مختبر الذكاء الاصطناعي", "AI Motion Lab") },
      ];
    }
    if (currentUser.role === "therapist") {
      return [
        { id: "landing", label: t("الرئيسية", "Home") },
        { id: "pt-portal", label: t("جناح الطبيب", "Therapist Suite") },
      ];
    }
    if (currentUser.role === "admin") {
      return [
        { id: "landing", label: t("الرئيسية", "Home") },
        { id: "admin-portal", label: t("جناح المشرف", "Admin Suite") },
      ];
    }
    return [];
  };

  const navItems = getNavItems();

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20">
          {/* Logo Section */}
          <div className="flex items-center">
            <button
              onClick={() => {
                setView("landing");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-2.5 cursor-pointer select-none group"
            >
              <div className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-brand-500 text-white shadow-md shadow-brand-500/20 group-hover:scale-105 transition-transform">
                <Activity id="nav-logo-icon" className="w-6 h-6 animate-pulse" />
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white animate-ping"></span>
              </div>
              <div className={isRtl ? "text-right" : "text-left"}>
                <span className="block font-display text-xl font-black text-brand-950 tracking-tight leading-none">
                  {t("مُعَالِجِي", "MyPhysio")}
                </span>
                <span className="block text-[10px] font-mono tracking-widest text-brand-600 font-bold leading-normal">
                  {t("MUALAJI . AI", "MYPHYSIO . AI")}
                </span>
              </div>
            </button>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-8">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "landing") {
                    setView("landing");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  } else if (item.id === "patient-portal" || item.id === "pt-portal" || item.id === "admin-portal") {
                    setView(item.id);
                  } else {
                    setView("landing");
                    setTimeout(() => {
                      const el = document.getElementById(item.id);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                  }
                }}
                className={`font-display text-sm md:text-base font-semibold px-1 py-1 relative cursor-pointer transition-colors duration-200 ${
                  currentView === item.id || (currentView === "landing" && item.id === "landing")
                    ? "text-brand-600"
                    : "text-slate-600 hover:text-brand-500"
                }`}
              >
                {item.label}
                {(currentView === item.id || (currentView === "landing" && item.id === "landing")) && (
                  <span className="absolute bottom-0 right-0 left-0 h-0.5 bg-brand-500 rounded-full"></span>
                )}
              </button>
            ))}
          </div>

          {/* Portal Switcher & Auth Triggers */}
          <div className="hidden md:flex items-center gap-4">
            {/* Language Toggle Button */}
            <button
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-700 cursor-pointer transition uppercase"
            >
              <Globe className="w-3.5 h-3.5 text-brand-600" />
              <span>{lang === "ar" ? "English" : "العربية"}</span>
            </button>

            {currentUser ? (
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold bg-brand-50 text-brand-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                  <User className="w-4 h-4 text-brand-600" />
                  {currentUser.name} ({currentUser.role === "patient" ? t("مريض", "Patient") : currentUser.role === "therapist" ? t("أخصائي", "Therapist") : t("مشرف", "Admin")})
                </span>
                <button
                  onClick={() => setView(currentUser.role === "patient" ? "patient-portal" : currentUser.role === "therapist" ? "pt-portal" : "admin-portal")}
                  className="bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm px-4 py-2 rounded-xl transition duration-200 shadow-sm shadow-brand-500/10 cursor-pointer"
                >
                  {t("لوحة التحكم", "Dashboard")}
                </button>
                <button
                  onClick={logout}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition duration-200 cursor-pointer"
                >
                  {t("خروج", "Logout")}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => openAuth("patient")}
                  className="text-slate-600 hover:text-brand-600 font-semibold text-sm px-4 py-2 hover:bg-slate-50 rounded-xl transition cursor-pointer"
                >
                  {t("دخول المرضى", "Patient Login")}
                </button>
                <button
                  onClick={() => openAuth("therapist")}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition shadow-xs cursor-pointer flex items-center gap-2"
                >
                  <Heart className="w-4 h-4 text-brand-400" />
                  {t("بوابة الأطباء", "Therapists Portal")}
                </button>
              </div>
            )}
          </div>

          {/* Mobile Menu Action Button */}
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-slate-100 shadow-lg py-4 px-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Mobile Language Switcher */}
          <button
            onClick={() => {
              setLang(lang === "ar" ? "en" : "ar");
              setMobileMenuOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-sm"
          >
            <Globe className="w-4 h-4 text-brand-600" />
            <span>{lang === "ar" ? "English (English)" : "العربية (Arabic)"}</span>
          </button>

          <div className="flex flex-col gap-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (item.id === "landing") {
                    setView("landing");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  } else if (item.id === "patient-portal" || item.id === "pt-portal" || item.id === "admin-portal") {
                    setView(item.id);
                  } else {
                    setView("landing");
                    setTimeout(() => {
                      const el = document.getElementById(item.id);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 100);
                  }
                }}
                className={`text-right py-2 px-3 rounded-lg font-semibold text-base transition-colors ${
                  currentView === item.id || (currentView === "landing" && item.id === "landing") ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-slate-100 my-2"></div>

          {currentUser ? (
            <div className="space-y-3 pt-1">
              <div className="text-right text-xs text-slate-500 font-medium px-3">
                {t("مرحباً وعليكم السلام،", "Welcome,")} <span className="text-slate-800 font-bold">{currentUser.name}</span>
              </div>
              <button
                onClick={() => {
                  setView(currentUser.role === "patient" ? "patient-portal" : "pt-portal");
                  setMobileMenuOpen(false);
                }}
                className="w-full text-center block bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-xl transition duration-200"
              >
                {t("لوحة التحكم الافتراضية", "My Dashboard")}
              </button>
              <button
                onClick={() => {
                  logout();
                  setMobileMenuOpen(false);
                }}
                className="w-full text-center block bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold py-2 rounded-xl transition"
              >
                {t("تسجيل الخروج", "Logout")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  openAuth("patient");
                  setMobileMenuOpen(false);
                }}
                className="w-full text-center py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold"
              >
                {t("بوابة المرضى", "Patient Portal")}
              </button>
              <button
                onClick={() => {
                  openAuth("therapist");
                  setMobileMenuOpen(false);
                }}
                className="w-full text-center py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 font-semibold flex items-center justify-center gap-2"
              >
                <Heart className="w-4 h-4 text-brand-400" />
                {t("بوابة الأطباء", "Therapists Portal")}
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
