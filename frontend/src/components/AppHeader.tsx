import { Activity, Moon, RotateCcw, Sparkles, Sun } from "lucide-react";

export type ConnectionStatus = "live" | "degraded" | "offline" | "demo";

interface AppHeaderProps {
  connectionStatus: ConnectionStatus;
  theme: "light" | "dark";
  onThemeToggle: () => void;
  onNewAssessment: () => void;
}

const statusLabels: Record<ConnectionStatus, string> = {
  live: "LIVE",
  degraded: "DEGRADED",
  offline: "OFFLINE",
  demo: "DEMO",
};

export function AppHeader({
  connectionStatus,
  theme,
  onThemeToggle,
  onNewAssessment,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="brand" aria-label="Evidence-Grounded AI Clinical Decision Support">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={20} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <p className="brand-title">Evidence-Grounded AI</p>
            <p className="brand-kicker">Clinical / Core</p>
          </div>
        </div>

        <div className="header-spacer" />

        <div className="header-actions">
          <div
            className={`status-pill status-${connectionStatus}`}
            role="status"
            aria-live="polite"
            aria-label={`System status: ${statusLabels[connectionStatus]}`}
          >
            <i className="status-dot" aria-hidden="true" />
            <span>{statusLabels[connectionStatus]}</span>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onThemeToggle}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          <button
            className="pill-button secondary"
            type="button"
            onClick={onNewAssessment}
          >
            <RotateCcw size={16} aria-hidden="true" />
            New assessment
          </button>

          <Activity className="sr-only" aria-hidden="true" />
        </div>
      </div>
    </header>
  );
}

