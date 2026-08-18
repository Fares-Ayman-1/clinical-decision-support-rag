import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  BellRing,
  Bot,
  BookOpen,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  FileWarning,
  HeartPulse,
  Info,
  MapPin,
  MessageSquareText,
  PhoneCall,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { ActionConfirmDialog, type ClinicalAction } from "./components/ActionConfirmDialog";
import { AppHeader, type ConnectionStatus } from "./components/AppHeader";
import { EvidencePanel } from "./components/EvidencePanel";
import { LoadingState } from "./components/LoadingState";
import { Modal } from "./components/Modal";
import { TracePanel } from "./components/TracePanel";
import { demoScenarios, type DemoScenarioId } from "./data/demo-scenarios";
import {
  ClinicalApiError,
  createApiTransport,
  createDemoTransport,
  isClinicalApiError,
} from "./lib/api";
import type {
  ClinicalTransport,
  EvidenceItem,
  QueryRefusal,
  QueryResult,
  QuerySuccess,
  RiskLevel,
} from "./types";

type Theme = "light" | "dark";
type AppMode = "api" | "demo";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";
const DEMO_ENABLED = import.meta.env.VITE_ENABLE_DEMO_MODE !== "false";
const EMERGENCY_NUMBER = import.meta.env.VITE_EMERGENCY_NUMBER?.trim() || "";
const FALLBACK_DISCLAIMER =
  "This system provides information from published medical guidelines. It is not a diagnosis and does not replace professional medical evaluation.";

const QUICK_PROMPTS = [
  "I am more short of breath than usual when walking upstairs.",
  "My ankles are swelling and I gained weight quickly this week.",
  "What warning signs mean I should seek urgent care?",
] as const;

const riskIcons: Record<RiskLevel, typeof ShieldCheck> = {
  LOW: CircleCheck,
  MODERATE: TriangleAlert,
  HIGH: FileWarning,
  CRITICAL: ShieldAlert,
};

function initialTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function errorPresentation(error: ClinicalApiError) {
  switch (error.code) {
    case "REQUEST_CANCELLED":
      return { title: "Assessment cancelled", detail: "No result was created. You can edit the question and try again." };
    case "REQUEST_TIMEOUT":
      return { title: "The assessment timed out", detail: "The service took too long to respond. Please try again." };
    case "RATE_LIMITED":
      return {
        title: "Request limit reached",
        detail: error.retryAfterSeconds
          ? `Please retry in about ${error.retryAfterSeconds} seconds.`
          : "Please wait briefly before trying again.",
      };
    case "RETRIEVAL_UNAVAILABLE":
      return { title: "Evidence retrieval is unavailable", detail: "A safe assessment cannot be generated without verified evidence." };
    case "LLM_UNAVAILABLE":
      return {
        title: "Answer generation is unavailable",
        detail: error.evidence?.length
          ? "Available evidence is shown, but no clinical prose was generated."
          : "No clinical prose was generated. Please retry when the service is available.",
      };
    case "INVALID_INPUT":
    case "SCHEMA_VIOLATION":
      return { title: "The question could not be processed", detail: error.message };
    case "INVALID_RESPONSE":
      return { title: "The service returned an unexpected response", detail: "The response was rejected before any clinical content was displayed." };
    case "NETWORK_ERROR":
    case "SERVICE_UNAVAILABLE":
      return { title: "The clinical API is offline", detail: "Check the backend connection, or enter the clearly labeled synthetic demo." };
    default:
      return { title: "The assessment could not be completed", detail: error.message };
  }
}

function normalizeUnknownError(error: unknown): ClinicalApiError {
  if (isClinicalApiError(error)) return error;
  return new ClinicalApiError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : "An unexpected error occurred.",
  );
}

function ResultMeta({ result }: { result: QueryResult }) {
  return (
    <div className="content-card" aria-label="Assessment metadata">
      <div className="card-label">
        <RadioTower size={14} aria-hidden="true" />
        System record
      </div>
      <dl className="response-meta">
        <div><dt>Request</dt><dd>{result.request_id.slice(0, 8)}</dd></div>
        <div><dt>Latency</dt><dd>{Math.round(result.meta.latency_ms)} ms</dd></div>
        <div><dt>Evidence</dt><dd>{result.safety.sufficiency}</dd></div>
        <div><dt>Knowledge</dt><dd>{result.meta.kb_version}</dd></div>
      </dl>
    </div>
  );
}

function PatientStateCard({ result }: { result: QuerySuccess }) {
  const state = result.patient_state;
  return (
    <div className="content-card">
      <div className="card-label">
        <ClipboardCheck size={14} aria-hidden="true" />
        Extracted context
      </div>
      <div className="context-grid">
        <div><span>Severity</span><strong>{state.severity}</strong></div>
        <div><span>Onset</span><strong>{state.onset ?? "Not stated"}</strong></div>
        <div><span>Duration</span><strong>{state.duration ?? "Not stated"}</strong></div>
      </div>
      {state.symptoms.length > 0 ? (
        <p className="context-symptoms"><strong>Symptoms:</strong> {state.symptoms.join(", ")}</p>
      ) : null}
      {state.missing_information.length > 0 ? (
        <p className="context-missing"><Info size={14} aria-hidden="true" /> Missing: {state.missing_information.join(", ")}</p>
      ) : null}
    </div>
  );
}

interface SuccessResultProps {
  result: QuerySuccess;
  onCitation: (index: number) => void;
  onAction: (action: ClinicalAction) => void;
}

function SuccessResult({ result, onCitation, onAction }: SuccessResultProps) {
  const risk = result.risk;
  const RiskIcon = risk ? riskIcons[risk.level] : ShieldCheck;
  const actions = result.actions;
  const hasActions = Object.values(actions).some(Boolean);

  return (
    <div className="result-stack" aria-live="polite">
      {risk ? (
        <section className={`risk-banner risk-${risk.level.toLowerCase()}`} aria-label={`${risk.level} risk assessment`}>
          <div className="risk-head">
            <RiskIcon size={19} aria-hidden="true" />
            <strong>{risk.level} risk signal</strong>
            <span className="risk-band">{risk.confidence_band} confidence</span>
          </div>
          <p>{result.recommended_action.message}</p>
        </section>
      ) : (
        <section className="content-card">
          <div className="card-label"><RiskIcon size={14} aria-hidden="true" /> Recommended action</div>
          <p className="card-copy">{result.recommended_action.message}</p>
        </section>
      )}

      <PatientStateCard result={result} />

      <section className="content-card">
        <div className="card-label">
          <Sparkles size={14} aria-hidden="true" />
          Evidence-grounded assessment
        </div>
        <ol className="statement-list">
          {result.assessment.statements.map((statement) => (
            <li className="statement" key={statement.id}>
              <p>{statement.text}</p>
              {statement.citations.length > 0 ? (
                <span className="citations" aria-label={`Citations for statement ${statement.id}`}>
                  {statement.citations.map((citation) => (
                    <button
                      className="citation-button"
                      type="button"
                      key={citation}
                      onClick={() => onCitation(citation)}
                      aria-label={`Open evidence ${citation}`}
                    >
                      [{citation}]
                    </button>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {result.assessment.limitations.length > 0 || result.assessment.conflicts.length > 0 ? (
        <section className="content-card">
          <div className="card-label"><Info size={14} aria-hidden="true" /> Boundaries and conflicts</div>
          <ul className="plain-list">
            {result.assessment.limitations.map((item) => <li key={`limitation-${item}`}>{item}</li>)}
            {result.assessment.conflicts.map((item) => <li key={`conflict-${item}`}><strong>Evidence conflict:</strong> {item}</li>)}
          </ul>
        </section>
      ) : null}

      {hasActions ? (
        <section className="content-card">
          <div className="card-label"><HeartPulse size={14} aria-hidden="true" /> Available actions</div>
          <div className="action-grid">
            {actions.show_call_emergency ? (
              <button
                className="action-button"
                type="button"
                disabled={!EMERGENCY_NUMBER}
                title={!EMERGENCY_NUMBER ? "No local emergency number has been configured" : undefined}
                onClick={() => onAction("call")}
              >
                <PhoneCall size={16} aria-hidden="true" />
                {EMERGENCY_NUMBER ? "Call emergency services" : "Local number not configured"}
              </button>
            ) : null}
            {actions.show_find_facility ? (
              <button className="action-button secondary" type="button" onClick={() => onAction("facility")}>
                <MapPin size={16} aria-hidden="true" /> Find nearby care
              </button>
            ) : null}
            {actions.show_alert_contacts ? (
              <button className="action-button secondary" type="button" onClick={() => onAction("contacts")}>
                <BellRing size={16} aria-hidden="true" /> Alert a trusted contact
              </button>
            ) : null}
            {actions.show_wellness ? (
              <button className="action-button secondary" type="button" onClick={() => onAction("wellness")}>
                <HeartPulse size={16} aria-hidden="true" /> Wellness guidance
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <ResultMeta result={result} />
    </div>
  );
}

function RefusalResult({ result }: { result: QueryRefusal }) {
  const reason = result.refusal.reason.replaceAll("_", " ").toLowerCase();
  return (
    <div className="result-stack" aria-live="polite">
      <section className="refusal-card">
        <div className="refusal-icon" aria-hidden="true"><ShieldCheck size={22} /></div>
        <p className="mono-label">Safe refusal / {reason}</p>
        <h3>This request cannot be answered safely</h3>
        <p>{result.refusal.message}</p>
        {result.refusal.recommend_professional_evaluation ? (
          <p className="refusal-followup">A qualified healthcare professional can evaluate this request with the appropriate context.</p>
        ) : null}
      </section>
      <ResultMeta result={result} />
    </div>
  );
}

interface ErrorResultProps {
  error: ClinicalApiError;
  canUseDemo: boolean;
  onUseDemo: () => void;
  onRetry: () => void;
}

function ErrorResult({ error, canUseDemo, onUseDemo, onRetry }: ErrorResultProps) {
  const copy = errorPresentation(error);
  return (
    <div className="result-stack" aria-live="assertive">
      <section className="error-card" role="alert">
        <div className="error-icon" aria-hidden="true"><CircleX size={22} /></div>
        <p className="mono-label">{error.code}</p>
        <h3>{copy.title}</h3>
        <p>{copy.detail}</p>
        {error.details?.length ? (
          <ul className="plain-list error-details">
            {error.details.map((detail, index) => (
              <li key={`${detail.field}-${index}`}><strong>{detail.field}:</strong> {detail.message}</li>
            ))}
          </ul>
        ) : null}
        <div className="error-actions">
          {error.code !== "REQUEST_CANCELLED" ? (
            <button className="pill-button secondary" type="button" onClick={onRetry}>Try again</button>
          ) : null}
          {canUseDemo && ["NETWORK_ERROR", "SERVICE_UNAVAILABLE", "REQUEST_TIMEOUT"].includes(error.code) ? (
            <button className="pill-button" type="button" onClick={onUseDemo}>Enter synthetic demo</button>
          ) : null}
        </div>
        {error.requestId ? <p className="error-meta">Request {error.requestId}{error.stage ? ` / ${error.stage}` : ""}</p> : null}
      </section>
    </div>
  );
}

function ChatEmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="empty-state">
      <div>
        <div className="empty-orbit" aria-hidden="true"><Bot size={31} strokeWidth={1.5} /></div>
        <h3>Start with a clinical question</h3>
        <p>Describe symptoms, timing, severity, and relevant history. The system will answer only from validated evidence.</p>
        <div className="quick-prompts" aria-label="Example clinical questions">
          {QUICK_PROMPTS.map((prompt) => (
            <button className="prompt-chip" type="button" key={prompt} onClick={() => onPrompt(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface InspectorActionsProps {
  evidenceCount: number;
  hasResult: boolean;
  onOpenEvidence: () => void;
  onOpenPipeline: () => void;
}

function InspectorActions({ evidenceCount, hasResult, onOpenEvidence, onOpenPipeline }: InspectorActionsProps) {
  if (evidenceCount === 0 && !hasResult) return null;

  return (
    <div className="inspector-actions">
      {evidenceCount > 0 ? (
        <button className="inspector-button" type="button" onClick={onOpenEvidence}>
          <BookOpen size={16} aria-hidden="true" />
          Evidence ({evidenceCount})
        </button>
      ) : null}
      {hasResult ? (
        <button className="inspector-button" type="button" onClick={onOpenPipeline}>
          <Workflow size={16} aria-hidden="true" />
          Decision Pipeline
        </button>
      ) : null}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [mode, setMode] = useState<AppMode>("api");
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>("critical");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("offline");
  const [message, setMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<ClinicalApiError | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [assessmentEpoch, setAssessmentEpoch] = useState(0);
  const [activeEvidence, setActiveEvidence] = useState<number | null>(null);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  const [isPipelineOpen, setIsPipelineOpen] = useState(false);
  // Owned here, not inside EvidencePanel, because the modal unmounts the panel
  // on close — without lifting the cache, every reopen would re-fetch a
  // passage that was already loaded once this assessment.
  const [fullTextByChunk, setFullTextByChunk] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<ClinicalAction | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scenario = useMemo(
    () => demoScenarios.find((candidate) => candidate.id === scenarioId) ?? demoScenarios[0],
    [scenarioId],
  );

  const transport = useMemo<ClinicalTransport>(
    () => mode === "api" ? createApiTransport(API_BASE_URL) : createDemoTransport(scenarioId),
    [mode, scenarioId],
  );

  const evidence: readonly EvidenceItem[] = result?.evidence ?? error?.evidence ?? [];
  const trace = result?.trace;
  const disclaimer = result?.safety.disclaimer ?? FALLBACK_DISCLAIMER;

  useEffect(() => {
    const controller = new AbortController();
    if (mode === "demo") {
      setConnectionStatus("demo");
      return () => controller.abort();
    }

    setConnectionStatus("offline");
    void transport.health({ signal: controller.signal }).then((health) => {
      setConnectionStatus(health.status === "ok" ? "live" : health.status === "degraded" ? "degraded" : "offline");
    }).catch(() => {
      if (!controller.signal.aborted) setConnectionStatus("offline");
    });
    return () => controller.abort();
  }, [mode, transport]);

  useEffect(() => () => requestController.current?.abort(), []);

  const resetAssessment = useCallback((nextMessage = "") => {
    requestController.current?.abort();
    requestController.current = null;
    setAssessmentEpoch((current) => current + 1);
    setIsLoading(false);
    setResult(null);
    setError(null);
    setActiveEvidence(null);
    setIsEvidenceOpen(false);
    setIsPipelineOpen(false);
    setFullTextByChunk({});
    setValidationMessage("");
    setMessage(nextMessage);
  }, []);

  const switchMode = useCallback((nextMode: AppMode) => {
    if (nextMode === mode || (nextMode === "demo" && !DEMO_ENABLED)) return;
    setMode(nextMode);
    resetAssessment(nextMode === "demo" ? scenario.examplePrompt : "");
  }, [mode, resetAssessment, scenario.examplePrompt]);

  const switchScenario = useCallback((nextScenario: DemoScenarioId) => {
    setScenarioId(nextScenario);
    const next = demoScenarios.find((candidate) => candidate.id === nextScenario);
    resetAssessment(next?.examplePrompt ?? "");
  }, [resetAssessment]);

  const submitAssessment = useCallback(async () => {
    const normalized = message.trim();
    if (!normalized) {
      setValidationMessage("Enter a clinical question before submitting.");
      textareaRef.current?.focus();
      return;
    }
    if (normalized.length > 2_000) {
      setValidationMessage("Clinical questions must be 2,000 characters or fewer.");
      textareaRef.current?.focus();
      return;
    }

    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setAssessmentEpoch((current) => current + 1);
    setValidationMessage("");
    setResult(null);
    setError(null);
    setActiveEvidence(null);
    setIsEvidenceOpen(false);
    setIsPipelineOpen(false);
    setFullTextByChunk({});
    setIsLoading(true);

    try {
      const response = await transport.query(
        { message: normalized, options: { include_trace: true, stream: false } },
        { signal: controller.signal },
      );
      if (requestController.current !== controller) return;
      setResult(response);
      if (mode === "api") setConnectionStatus("live");
    } catch (caught) {
      if (requestController.current !== controller) return;
      const normalizedError = normalizeUnknownError(caught);
      setError(normalizedError);
      if (mode === "api") {
        if (["NETWORK_ERROR", "SERVICE_UNAVAILABLE"].includes(normalizedError.code)) {
          setConnectionStatus("offline");
        } else if (["REQUEST_TIMEOUT", "RETRIEVAL_UNAVAILABLE", "LLM_UNAVAILABLE", "INTERNAL_ERROR", "INVALID_RESPONSE"].includes(normalizedError.code)) {
          setConnectionStatus("degraded");
        }
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setIsLoading(false);
      }
    }
  }, [message, mode, transport]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitAssessment();
  }

  function cancelAssessment() {
    requestController.current?.abort();
  }

  function openCitation(index: number) {
    setActiveEvidence(index);
    setIsEvidenceOpen(true);
  }

  function confirmAction(action: ClinicalAction) {
    setPendingAction(null);
    if (action === "call" && EMERGENCY_NUMBER) {
      window.location.assign(`tel:${EMERGENCY_NUMBER.replace(/[^+\d]/g, "")}`);
    }
    if (action === "facility") {
      window.open("https://www.google.com/maps/search/emergency+medical+care+near+me", "_blank", "noopener,noreferrer");
    }
  }

  function recordFullText(chunkId: string, text: string) {
    setFullTextByChunk((current) => ({ ...current, [chunkId]: text }));
  }

  return (
    <div className="app-shell">
      <div className="noise" aria-hidden="true" />
      <AppHeader
        connectionStatus={connectionStatus}
        theme={theme}
        onThemeToggle={() => {
          const next: Theme = theme === "light" ? "dark" : "light";
          setTheme(next);
          document.documentElement.dataset.theme = next;
          window.localStorage.setItem("clinical-theme", next);
        }}
        onNewAssessment={() => resetAssessment(mode === "demo" ? scenario.examplePrompt : "")}
      />

      <main className="app-main">
        <section className="intro" aria-labelledby="workspace-title">
          <div>
            <div className="eyebrow">Evidence-grounded intelligence</div>
            <h1 id="workspace-title">Clinical decisions, <span>traced to evidence.</span></h1>
            <p className="intro-copy">A transparent heart-failure workspace that separates source evidence, model reasoning, and safety decisions at every step.</p>
          </div>
          <div className="system-facts" aria-label="System principles">
            <div className="system-fact"><span>MODE</span><strong>{mode === "api" ? "REAL API" : "SYNTHETIC"}</strong></div>
            <div className="system-fact"><span>CITATIONS</span><strong>STRUCTURED</strong></div>
            <div className="system-fact"><span>DIAGNOSIS</span><strong>NEVER CLAIMED</strong></div>
          </div>
        </section>

        <section className="mode-bar" aria-label="Data source mode">
          <div className="mode-copy">
            <strong>{mode === "api" ? "Connected clinical service" : "Synthetic demonstration"}</strong>
            <span> — {mode === "api" ? API_BASE_URL : scenario.description}</span>
          </div>
          <div className="mode-controls">
            {mode === "demo" ? (
              <label className="scenario-select">
                <span className="sr-only">Demo scenario</span>
                <select value={scenarioId} onChange={(event) => switchScenario(event.target.value as DemoScenarioId)}>
                  {demoScenarios.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
            ) : null}
            <div className="mode-switch">
              <button className={`mode-button ${mode === "api" ? "active" : ""}`} type="button" onClick={() => switchMode("api")} aria-pressed={mode === "api"}>Real API</button>
              {DEMO_ENABLED ? (
                <button className={`mode-button ${mode === "demo" ? "active" : ""}`} type="button" onClick={() => switchMode("demo")} aria-pressed={mode === "demo"}>Synthetic demo</button>
              ) : null}
            </div>
          </div>
        </section>

        <div className="workspace">
          <section className="panel panel-chat">
            <header className="panel-header">
              <div className="panel-icon" aria-hidden="true"><MessageSquareText size={20} /></div>
              <div className="panel-heading">
                <h2 id="chat-panel-title">Clinical assessment</h2>
                <p>Question / grounded answer</p>
              </div>
              <span className="panel-count">{isLoading ? "RUNNING" : result ? "COMPLETE" : "READY"}</span>
            </header>

            <div className="panel-body chat-body">
              {!result && !error && !isLoading ? <ChatEmptyState onPrompt={(prompt) => { setMessage(prompt); textareaRef.current?.focus(); }} /> : null}
              {isLoading ? <LoadingState onCancel={cancelAssessment} /> : null}
              {result?.status === "success" ? <SuccessResult result={result} onCitation={openCitation} onAction={setPendingAction} /> : null}
              {result?.status === "refusal" ? <RefusalResult result={result} /> : null}
              {error ? (
                <ErrorResult
                  error={error}
                  canUseDemo={mode === "api" && DEMO_ENABLED}
                  onUseDemo={() => switchMode("demo")}
                  onRetry={() => void submitAssessment()}
                />
              ) : null}

              {!isLoading ? (
                <InspectorActions
                  evidenceCount={evidence.length}
                  hasResult={Boolean(result)}
                  onOpenEvidence={() => setIsEvidenceOpen(true)}
                  onOpenPipeline={() => setIsPipelineOpen(true)}
                />
              ) : null}
            </div>

            <form className="composer-wrap" onSubmit={handleSubmit} noValidate>
              <div className="composer">
                <label className="sr-only" htmlFor="clinical-question">Clinical question</label>
                <textarea
                  id="clinical-question"
                  ref={textareaRef}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (validationMessage) setValidationMessage("");
                  }}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void submitAssessment();
                    }
                  }}
                  placeholder="Describe symptoms, onset, severity, and relevant history…"
                  aria-invalid={Boolean(validationMessage)}
                  aria-describedby="question-help question-error"
                  disabled={isLoading}
                />
                <div className="composer-footer">
                  <div className="composer-meta" id="question-help">
                    <span>{message.length.toLocaleString()} / 2,000</span>
                    <span>CTRL + ENTER</span>
                    {mode === "demo" ? <strong>SYNTHETIC</strong> : null}
                  </div>
                  <button className="submit-button" type="submit" disabled={isLoading} aria-label="Submit clinical question">
                    <ArrowUp size={19} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="validation-message" id="question-error" role="alert">{validationMessage}</p>
            </form>
          </section>
        </div>

        <aside className="disclaimer" aria-label="Medical disclaimer">
          <Info size={17} aria-hidden="true" />
          <span>{disclaimer} If symptoms are severe or rapidly worsening, seek immediate professional help using the appropriate service for your location.</span>
        </aside>
      </main>

      <Modal
        open={isEvidenceOpen}
        onClose={() => setIsEvidenceOpen(false)}
        title="Retrieved Evidence"
        variant="evidence"
        headerExtra={
          <span className="modal-header-count">
            {evidence.length} {evidence.length === 1 ? "SOURCE" : "SOURCES"}
          </span>
        }
      >
        <EvidencePanel
          key={`assessment-${assessmentEpoch}`}
          embedded
          evidence={evidence}
          onLoadFullText={(chunkId, signal) => transport.evidence(chunkId, { signal })}
          activeIndex={activeEvidence}
          onSelectEvidence={setActiveEvidence}
          initialFullText={fullTextByChunk}
          onFullTextLoaded={recordFullText}
        />
      </Modal>

      <Modal
        open={isPipelineOpen}
        onClose={() => setIsPipelineOpen(false)}
        title="Decision Pipeline"
        variant="pipeline"
      >
        <TracePanel
          embedded
          trace={trace}
          isLoading={isLoading}
          unavailableMessage={result ? "This response did not include a trace. Backend debug tracing may be disabled." : "Submit a question to inspect each decision stage."}
        />
      </Modal>

      <ActionConfirmDialog action={pendingAction} onCancel={() => setPendingAction(null)} onConfirm={confirmAction} />
    </div>
  );
}
