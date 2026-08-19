/**
 * Maps sidebar paths to App view + optional portal tab.
 */
export type PortalView = "patient-portal" | "pt-portal" | "admin-portal" | "landing";

export interface PortalRoute {
  view: PortalView;
  tab?: string;
  activePath: string;
  scrollTo?: string;
}

const ROUTE_MAP: Record<string, PortalRoute> = {
  "/patient/dashboard": { view: "patient-portal", tab: "dashboard", activePath: "/patient/dashboard" },
  "/patient/plan": { view: "patient-portal", tab: "routines", activePath: "/patient/plan" },
  "/patient/exercise-room": { view: "landing", activePath: "/patient/exercise-room", scrollTo: "ai-demo" },
  "/patient/messages": { view: "patient-portal", tab: "chat", activePath: "/patient/messages" },
  "/patient/appointments": { view: "patient-portal", tab: "dashboard", activePath: "/patient/appointments" },
  "/pt/dashboard": { view: "pt-portal", tab: "dashboard", activePath: "/pt/dashboard" },
  "/pt/patients": { view: "pt-portal", tab: "dashboard", activePath: "/pt/patients" },
  "/pt/plan-builder": { view: "pt-portal", tab: "copilot_workspace", activePath: "/pt/plan-builder" },
  "/pt/compliance": { view: "pt-portal", tab: "reports", activePath: "/pt/compliance" },
  "/pt/schedule": { view: "pt-portal", tab: "schedule", activePath: "/pt/schedule" },
  "/pt/messages": { view: "pt-portal", tab: "messages", activePath: "/pt/messages" },
  "/pt/wallet": { view: "pt-portal", tab: "wallet", activePath: "/pt/wallet" },
  "/pt/settings": { view: "pt-portal", tab: "settings", activePath: "/pt/settings" },
  "/admin/dashboard": { view: "admin-portal", activePath: "/admin/dashboard" },
  "/admin/verifications": { view: "admin-portal", activePath: "/admin/verifications" },
  "/admin/users": { view: "admin-portal", activePath: "/admin/users" },
  "/admin/exercise-library": { view: "admin-portal", activePath: "/admin/exercise-library" },
  "/admin/clinics": { view: "admin-portal", activePath: "/admin/clinics" },
  "/admin/audit": { view: "admin-portal", activePath: "/admin/audit" },
  "/admin/settings": { view: "admin-portal", activePath: "/admin/settings" },
};

export function resolvePortalRoute(path: string): PortalRoute | null {
  return ROUTE_MAP[path] || null;
}

export function viewToDefaultPath(view: string): string {
  if (view === "patient-portal") return "/patient/dashboard";
  if (view === "pt-portal") return "/pt/plan-builder";
  if (view === "admin-portal") return "/admin/dashboard";
  return "/";
}
