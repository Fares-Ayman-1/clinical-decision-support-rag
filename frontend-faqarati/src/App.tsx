/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from "react";
import { useLanguage } from "./LanguageContext";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import InteractivePainMap from "./components/InteractivePainMap";
import HowItWorks from "./components/HowItWorks";
import AIPostureDemo from "./components/AIPostureDemo";
import DoctorListing from "./components/DoctorListing";
import Footer from "./components/Footer";
import AuthModal from "./components/AuthModal";
import PatientPortal from "./components/PatientPortal";
import PTPortal from "./components/PTPortal";
import AdminPortal from "./components/AdminPortal";
import AppShell from "./components/layout/AppShell";
import { SidebarRole } from "./components/layout/Sidebar";

import { Therapist, Appointment, ExerciseSessionLog, UserRole, ExerciseSessionContext } from "./types";
import { resolvePatientId } from "./utils/patientId";
import { resolvePortalRoute, viewToDefaultPath } from "./utils/portalRoutes";

export default function App() {
  const { isRtl } = useLanguage();

  const [currentView, setView] = useState<string>("landing");
  const [portalActivePath, setPortalActivePath] = useState("/patient/dashboard");
  const [patientTab, setPatientTab] = useState<"dashboard" | "routines" | "chat">("dashboard");
  const [ptTab, setPtTab] = useState<"dashboard" | "copilot_workspace" | "reports" | "schedule" | "messages" | "wallet" | "settings">("copilot_workspace");
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  const [authOpen, setAuthOpen] = useState<boolean>(false);
  const [authInitialRole, setAuthInitialRole] = useState<UserRole>("patient");
  const [currentUser, setCurrentUser] = useState<{ name: string; role: UserRole; email: string } | null>({
    name: "فاطمة محمد الأحمد",
    role: "patient",
    email: "fatemah.it@gmail.com",
  });

  const patientId = resolvePatientId(currentUser);

  const [appointments, setAppointments] = useState<Appointment[]>([
    {
      id: "a1",
      patientId: "p1",
      patientName: "فاطمة محمد الأحمد",
      therapistId: "t1",
      therapistName: "د. أحمد الرويلي",
      date: "2026-06-25",
      time: "10:30 ص",
      status: "upcoming",
      price: 180,
    },
  ]);

  const [sessionLogs, setSessionLogs] = useState<ExerciseSessionLog[]>([
    {
      id: "s1",
      patientId: "p1",
      exerciseId: "ext_spine_01",
      exerciseNameAr: "تمرين تمدد الظهر (بزاوية العمود الفقري)",
      date: "2026-06-23",
      durationSeconds: 360,
      completionRate: 100,
      accuracyScore: 94.8,
      metrics: [],
    },
  ]);

  const [exerciseContext, setExerciseContext] = useState<ExerciseSessionContext | null>(null);

  const handleLoginSuccess = (user: { name: string; role: UserRole; email: string }) => {
    setCurrentUser(user);
    if (user.role === "patient") {
      setView("patient-portal");
      setPortalActivePath("/patient/dashboard");
      setPatientTab("dashboard");
    } else if (user.role === "therapist") {
      setView("pt-portal");
      setPortalActivePath("/pt/plan-builder");
      setPtTab("copilot_workspace");
    } else if (user.role === "admin") {
      setView("admin-portal");
      setPortalActivePath("/admin/dashboard");
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView("landing");
  };

  const handleBookSession = (therapist: Therapist, date: string, time: string) => {
    const newAppointment: Appointment = {
      id: `a-${Date.now()}`,
      patientId,
      patientName: currentUser?.name || "فاطمة محمد الأحمد",
      therapistId: therapist.id,
      therapistName: therapist.name,
      date,
      time,
      status: "upcoming",
      price: therapist.pricePerSession,
    };
    setAppointments((prev) => [newAppointment, ...prev]);
  };

  const handleStartExercise = (ctx: ExerciseSessionContext) => {
    setExerciseContext(ctx);
    setView("landing");
    setTimeout(() => {
      const el = document.getElementById("ai-demo");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  const handleSessionLogged = (log: ExerciseSessionLog) => {
    setSessionLogs((prev) => [log, ...prev]);
    setScheduleRefreshKey((k) => k + 1);
  };

  const handleUpdatePatientPlan = useCallback((_patientId: string, _plan: unknown) => {
    setScheduleRefreshKey((k) => k + 1);
  }, []);

  const openAuthWithRole = (role: UserRole = "patient") => {
    setAuthInitialRole(role);
    setAuthOpen(true);
  };

  const triggerFocusView = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handlePortalNavigate = (path: string) => {
    const route = resolvePortalRoute(path);
    if (!route) return;
    setPortalActivePath(route.activePath);
    if (route.view === "landing") {
      setView("landing");
      if (route.scrollTo) {
        setTimeout(() => triggerFocusView(route.scrollTo!), 150);
      }
      return;
    }
    setView(route.view);
    if (route.tab) {
      if (route.view === "patient-portal") {
        setPatientTab(route.tab as typeof patientTab);
      }
      if (route.view === "pt-portal") {
        setPtTab(route.tab as typeof ptTab);
      }
    }
  };

  const setViewWithPath = (view: string) => {
    setView(view);
    setPortalActivePath(viewToDefaultPath(view));
  };

  const shellRole: SidebarRole | null =
    currentView === "patient-portal" ? "patient" : currentView === "pt-portal" ? "pt" : currentView === "admin-portal" ? "admin" : null;

  const portalContent = (
    <>
      {currentView === "patient-portal" && (
        <PatientPortal
          currentUser={currentUser}
          patientId={patientId}
          appointments={appointments}
          sessionLogs={sessionLogs}
          initialTab={patientTab}
          scheduleRefreshKey={scheduleRefreshKey}
          onStartExercise={handleStartExercise}
        />
      )}
      {currentView === "pt-portal" && (
        <PTPortal
          currentDoctor={
            currentUser
              ? {
                  id: "t1",
                  name: currentUser.name,
                  email: currentUser.email,
                  role: "therapist",
                  specialty: ["آلام العمود الفقري", "تأهيل العمود الفقري"],
                  rating: 4.9,
                  reviewCount: 142,
                  pricePerSession: 180,
                  experienceYears: 12,
                  licenseNumber: "MOH-10294-PT",
                  bioArabic: "أخصائي معالج معتمد.",
                  availabilitySlots: ["09:00", "11:30", "14:00", "16:30"],
                }
              : null
          }
          initialTab={ptTab}
          onUpdatePatientPlan={handleUpdatePatientPlan}
        />
      )}
      {currentView === "admin-portal" && <AdminPortal activePath={portalActivePath} />}
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between" dir={isRtl ? "rtl" : "ltr"}>
      <Navbar
        currentView={currentView}
        setView={setViewWithPath}
        openAuth={openAuthWithRole}
        currentUser={currentUser}
        logout={handleLogout}
      />

      <main className="flex-grow">
        {currentView === "landing" && (
          <div className="space-y-0">
            <Hero onStartRecovery={() => openAuthWithRole("patient")} onExploreAI={() => triggerFocusView("ai-demo")} />
            <HowItWorks />
            <InteractivePainMap
              onSelectDoctor={() => triggerFocusView("clinics")}
              openAuth={openAuthWithRole}
            />
            <AIPostureDemo
              exerciseContext={exerciseContext}
              patientId={patientId}
              onSessionLogged={handleSessionLogged}
            />
            <DoctorListing onBookSession={handleBookSession} openAuth={openAuthWithRole} selectedDoctorId={null} />
          </div>
        )}

        {shellRole ? (
          <AppShell role={shellRole} activePath={portalActivePath} onNavigate={handlePortalNavigate}>
            {portalContent}
          </AppShell>
        ) : (
          portalContent
        )}
      </main>

      <Footer />

      {authOpen && (
        <AuthModal onClose={() => setAuthOpen(false)} onLoginSuccess={handleLoginSuccess} initialRole={authInitialRole} />
      )}
    </div>
  );
}
