/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { 
  LayoutDashboard, 
  ClipboardList, 
  Camera, 
  CalendarDays, 
  MessageSquare, 
  Settings, 
  Activity, 
  Users, 
  Calendar, 
  BrainCircuit, 
  Wallet, 
  UserCog, 
  BarChart3, 
  ShieldCheck, 
  Dumbbell, 
  Sliders, 
  Building2, 
  ChevronLeft, 
  ChevronRight,
  Menu,
  X
} from "lucide-react";
import { useLanguage } from "../../LanguageContext";

export type SidebarRole = "patient" | "pt" | "admin";

interface SidebarProps {
  role: SidebarRole;
  activePath?: string;
  onNavigate?: (path: string) => void;
}

export default function Sidebar({ role, activePath = "", onNavigate }: SidebarProps) {
  const { t, isRtl } = useLanguage();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  // Define sidebar links recursively based on active role rules
  const getSidebarLinks = () => {
    switch (role) {
      case "patient":
        return [
          {
            path: "/patient/dashboard",
            label: t("لوحة الاستعراض العامة", "Dashboard Overview"),
            icon: LayoutDashboard,
          },
          {
            path: "/patient/plan",
            label: t("خطة التعافي الخاصة بي", "My Recovery Plan"),
            icon: ClipboardList,
          },
          {
            path: "/patient/exercise-room",
            label: t("مختبر الحركة والذكاء الاصطناعي", "AI Exercise Room"),
            icon: Camera,
          },
          {
            path: "/patient/appointments",
            label: t("المواعيد والعيادات", "Appointments"),
            icon: CalendarDays,
          },
          {
            path: "/patient/messages",
            label: t("المحادثات المفتوحة", "Messages"),
            icon: MessageSquare,
          },
          {
            path: "/patient/settings",
            label: t("الملف الشخصي والإعدادات", "Settings & Profile"),
            icon: Settings,
          },
        ];

      case "pt":
        return [
          {
            path: "/pt/dashboard",
            label: t("لوحة إحصائيات المعالج", "PT Dashboard"),
            icon: Activity,
          },
          {
            path: "/pt/patients",
            label: t("سجل وقوائم المرضى", "Patient Roster"),
            icon: Users,
          },
          {
            path: "/pt/schedule",
            label: t("منظم وجدول الجلسات", "Schedule Manager"),
            icon: Calendar,
          },
          {
            path: "/pt/plan-builder",
            label: t("منشئ خطط العلاج (الذكي)", "Plan Builder / AI Copilot"),
            icon: BrainCircuit,
          },
          {
            path: "/pt/messages",
            label: t("دردشة وسجلات المرضى", "Patient Chat"),
            icon: MessageSquare,
          },
          {
            path: "/pt/wallet",
            label: t("المحفظة الرقمية والأرباح", "Wallet / Earnings"),
            icon: Wallet,
          },
          {
            path: "/pt/settings",
            label: t("إعدادات وترخيص MOH", "Account & Verification"),
            icon: UserCog,
          },
        ];

      case "admin":
        return [
          {
            path: "/admin/dashboard",
            label: t("مركز القيادة المركزي", "Command Center"),
            icon: BarChart3,
          },
          {
            path: "/admin/verifications",
            label: t("تحقق واعتمادات التراخيص", "Verifications & PTs"),
            icon: ShieldCheck,
          },
          {
            path: "/admin/users",
            label: t("إدارة وإشراف الأعضاء", "User Management"),
            icon: Users,
          },
          {
            path: "/admin/exercise-library",
            label: t("مستودع الحركات (CMS)", "Exercise Library CMS"),
            icon: Dumbbell,
          },
          {
            path: "/admin/clinics",
            label: t("المصحات والعيادات الكبرى", "B2B Clinics"),
            icon: Building2,
          },
          {
            path: "/admin/settings",
            label: t("إعدادات المنصة الكلية", "Platform Settings"),
            icon: Sliders,
          },
        ];
      default:
        return [];
    }
  };

  const links = getSidebarLinks();

  const handleLinkClick = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    }
    setMobileOpen(false);
  };

  // Toggle Collapse
  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Icon direction helper
  const renderToggleIcon = () => {
    if (isRtl) {
      return isCollapsed ? (
        <ChevronLeft className="w-4 h-4 text-brand-600" />
      ) : (
        <ChevronRight className="w-4 h-4 text-brand-600" />
      );
    } else {
      return isCollapsed ? (
        <ChevronRight className="w-4 h-4 text-brand-600" />
      ) : (
        <ChevronLeft className="w-4 h-4 text-brand-600" />
      );
    }
  };

  return (
    <>
      {/* Mobile Drawer Header Block */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-slate-100 shadow-3xs sticky top-20 z-40">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-800 transition shadow-3xs hover:scale-102 flex items-center justify-center cursor-pointer"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <span className="font-display font-black text-brand-950 text-sm tracking-tight leading-none uppercase">
          {t(`${role === "patient" ? "جناح المريض" : role === "pt" ? "جناح المعالج" : "جناح المشرف"}`, `${role.toUpperCase()} PORTAL`)}
        </span>
      </div>

      {/* Background overlay for mobile */}
      {mobileOpen && (
        <div 
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-slate-950/45 z-40 animate-fade-in"
        ></div>
      )}

      {/* Main Sidebar Shell Container */}
      <aside
        className={`bg-white border-slate-100 shadow-xl transition-all duration-300 z-40 flex flex-col justify-between
          /* Desktop sidebar values */
          hidden md:flex flex-shrink-0 border-e h-screen sticky top-0
          ${isCollapsed ? "w-20" : "w-72"}
          /* Mobile sidebars values */
          ${mobileOpen ? "translate-x-0" : isRtl ? "translate-x-full" : "-translate-x-full"}
          md:translate-x-0 fixed md:sticky inset-y-0
          ${isRtl ? "right-0 border-l" : "left-0 border-r"}
        `}
      >
        <div className="flex flex-col flex-1 py-6">
          
          {/* Top Profile / Role Indicator Header */}
          <div className={`px-6 pb-6 border-b border-slate-50 flex items-center justify-between gap-3 ${isCollapsed ? "flex-col" : "flex-row"}`}>
            {!isCollapsed && (
              <div className={isRtl ? "text-right" : "text-left"}>
                <span className="block text-[10px] font-mono tracking-widest text-brand-600 font-bold uppercase">
                  {role === "patient" ? t("رعاية حركية ذكية", "Patient Suite") : role === "pt" ? t("عيادة مرخصة", "PT Suite") : t("إدارة المنصة", "Super Admin")}
                </span>
                <span className="block font-display text-lg font-black text-slate-900 tracking-tight leading-normal mt-0.5">
                  {role === "patient" ? t("مساعد فقراتي", "Faqarati Core") : role === "pt" ? t("دليل التشخيص", "Clinical Core") : t("لوحة التحكم", "System Admin")}
                </span>
              </div>
            )}

            {isCollapsed && (
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-mono font-black text-sm">
                {role === "patient" ? "PT" : role === "pt" ? "DR" : "AD"}
              </div>
            )}

            {/* Collapse Toggle Button (Desktop only click) */}
            <button
              onClick={toggleCollapse}
              className="hidden md:flex p-1.5 bg-brand-50 hover:bg-brand-100 rounded-lg transition-all duration-200 cursor-pointer shadow-3xs hover:scale-105 border border-brand-100/50 justify-center items-center"
            >
              {renderToggleIcon()}
            </button>
          </div>

          {/* Navigation Links List */}
          <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
            {links.map((link) => {
              const IconComp = link.icon;
              const isLinkActive = activePath === link.path;

              return (
                <button
                  key={link.path}
                  onClick={() => handleLinkClick(link.path)}
                  className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-250 cursor-pointer border
                    ${isCollapsed ? "justify-center" : isRtl ? "justify-start text-right" : "justify-start text-left"}
                    ${
                      isLinkActive
                        ? "bg-brand-500 text-slate-950 border-transparent shadow-md shadow-brand-500/10 scale-[1.01]"
                        : "bg-transparent text-slate-600 hover:text-brand-650 border-transparent hover:bg-slate-50/70"
                    }`}
                  title={isCollapsed ? link.label : ""}
                >
                  <IconComp className={`w-5 h-5 flex-shrink-0 ${isLinkActive ? "text-slate-950" : "text-slate-500"}`} />
                  
                  {!isCollapsed && (
                    <span className="truncate leading-none">
                      {link.label}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom micro branding or platform standards */}
        <div className="p-4 border-t border-slate-50">
          {!isCollapsed ? (
            <div className={`p-3 bg-slate-50 rounded-2xl ${isRtl ? "text-right" : "text-left"} space-y-1`}>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">MOH HEALTH SECURE</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-normal font-semibold">
                {t("بيانات مفرزة ومشفرة محلياً 🔐", "Biomechanics fully encrypted 🔐")}
              </p>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" title="MOH Health Secure"></div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
