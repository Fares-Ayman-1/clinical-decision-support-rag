/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode } from "react";
import Sidebar, { SidebarRole } from "./Sidebar";
import { useLanguage } from "../../LanguageContext";
import { Bell, Menu, Globe } from "lucide-react";

interface AppShellProps {
  role: SidebarRole;
  activePath: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export default function AppShell({ role, activePath, onNavigate, children }: AppShellProps) {
  const { t, isRtl, lang, setLang } = useLanguage();

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]" dir={isRtl ? "rtl" : "ltr"}>
      <Sidebar role={role} activePath={activePath} onNavigate={onNavigate} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between gap-4 sticky top-0 z-30">
          <span className="text-sm font-bold text-slate-700 truncate">
            {activePath || t("لوحة التحكم", "Dashboard")}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label={t("الإشعارات", "Notifications")}
            >
              <Bell className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border border-slate-200 hover:bg-slate-50"
            >
              <Globe className="w-3.5 h-3.5" />
              {lang === "ar" ? "EN" : "AR"}
            </button>
          </div>
        </header>
        <main className="flex-1 bg-slate-50 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
