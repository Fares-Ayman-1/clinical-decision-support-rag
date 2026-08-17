import {
  Activity,
  Braces,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Terminal,
} from "lucide-react";

import type { PipelineTrace, TraceStage } from "../types/api";

export interface TracePanelProps {
  trace?: PipelineTrace | null;
  isLoading?: boolean;
  unavailableMessage?: string;
  className?: string;
  tabLabelId?: string;
  id?: string;
}

const STAGE_LABELS: Readonly<Record<TraceStage["name"], string>> = {
  extraction: "Clinical extraction",
  red_flag_check: "Red-flag check",
  query_rewrite: "Query rewrite",
  domain_predict: "Domain prediction",
  dense_search: "Dense retrieval",
  bm25_search: "BM25 retrieval",
  fusion: "Rank fusion",
  rerank: "Cross-encoder rerank",
  sufficiency: "Sufficiency gate",
  generation: "Grounded generation",
  validation: "Citation validation",
  risk: "Risk engine",
  decision: "Decision engine",
};

const EXPECTED_STAGE_COUNT = Object.keys(STAGE_LABELS).length;

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatLatency(latencyMs: number) {
  if (!Number.isFinite(latencyMs)) return "\u2014";
  if (latencyMs >= 1_000) return `${(latencyMs / 1_000).toFixed(2)} s`;
  return `${Math.max(0, Math.round(latencyMs))} ms`;
}

function safeStringify(value: unknown) {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(
      value,
      (_key, candidate: unknown) => {
        void _key;
        if (typeof candidate === "bigint") return candidate.toString();
        if (typeof candidate === "number" && !Number.isFinite(candidate)) {
          return String(candidate);
        }
        if (candidate && typeof candidate === "object") {
          if (seen.has(candidate)) return "[Circular]";
          seen.add(candidate);
        }
        return candidate;
      },
      2,
    );

    return serialized ?? "{}";
  } catch {
    return "{\n  \"status\": \"Output could not be serialized\"\n}";
  }
}

function humanizeStageName(stage: TraceStage) {
  return STAGE_LABELS[stage.name] ?? stage.name.replaceAll("_", " ");
}

export function TracePanel({
  trace,
  isLoading = false,
  unavailableMessage = "A pipeline trace was not returned. Debug tracing may be disabled for this response.",
  className,
  tabLabelId,
  id,
}: TracePanelProps) {
  const stages = trace?.stages ?? [];
  const totalLatency = stages.reduce(
    (total, stage) => total + (Number.isFinite(stage.latency_ms) ? stage.latency_ms : 0),
    0,
  );
  const traceStatus = stages.length === 0
    ? "Standby"
    : stages.length === EXPECTED_STAGE_COUNT
      ? "Complete"
      : "Partial";

  return (
    <section
      id={id}
      className={joinClasses(
        "trace-panel relative flex min-h-0 flex-col overflow-hidden rounded-[1.375rem] border border-[#3c507e] bg-[#0c1733] text-white shadow-[0_26px_80px_rgba(4,10,27,0.24)]",
        className,
      )}
      role={tabLabelId ? "tabpanel" : undefined}
      aria-labelledby={tabLabelId ?? "trace-panel-title"}
    >
      <div
        className="trace-panel__grid pointer-events-none absolute inset-0 opacity-[0.14]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(227,197,138,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(227,197,138,.18) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
          maskImage: "linear-gradient(to bottom, black, transparent 72%)",
        }}
      />

      <header className="trace-panel__header relative border-b border-[#3c507e] bg-[#112251]/85 px-5 py-5 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-[#b7c2dc]">
          <span className="inline-flex items-center gap-2">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="size-2 rounded-full bg-[#e3c58a]" />
              <span className="size-2 rounded-full bg-[#6377aa]" />
              <span className="size-2 rounded-full bg-[#3c507e]" />
            </span>
            Command shell
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#e3c58a]">
            <Activity aria-hidden="true" size={13} />
            {isLoading ? "Processing" : traceStatus}
          </span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[0.76rem] font-semibold uppercase tracking-[0.16em] text-[#e3c58a]">
              <Terminal aria-hidden="true" size={15} strokeWidth={1.8} />
              <span>System / Trace</span>
            </div>
            <h2
              id="trace-panel-title"
              className="text-xl font-semibold tracking-[-0.025em] [font-family:var(--font-display)]"
            >
              Decision pipeline
            </h2>
          </div>

          {stages.length > 0 ? (
            <div className="trace-panel__summary shrink-0 text-right font-mono">
              <div className="text-[0.72rem] uppercase tracking-[0.13em] text-[#a9b5d3]">Pipeline</div>
              <div className="mt-1 text-base font-semibold text-[#f5f1ea]">
                {stages.length}/{EXPECTED_STAGE_COUNT} stages / {formatLatency(totalLatency)}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="trace-panel__body relative flex-1 overflow-y-auto p-4 sm:p-5">
        {isLoading ? (
          <div className="trace-panel__loading flex min-h-72 flex-col items-center justify-center text-center" role="status">
            <span className="grid size-14 place-items-center rounded-2xl border border-[#4c619a] bg-[#16275a] text-[#e3c58a]">
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" size={25} />
            </span>
            <p className="mt-5 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-[#e3c58a]">
              Pipeline active
            </p>
            <p className="mt-2 max-w-xs text-base leading-7 text-[#c9d2e8]">
              Extracting patient context and tracing each grounded decision stage.
            </p>
          </div>
        ) : stages.length === 0 ? (
          <div className="trace-panel__empty flex min-h-72 flex-col items-center justify-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl border border-[#4c619a] bg-[#16275a] text-[#e3c58a]">
              <Braces aria-hidden="true" size={25} strokeWidth={1.5} />
            </span>
            <h3 className="mt-5 text-lg font-semibold text-white [font-family:var(--font-display)]">
              Trace unavailable
            </h3>
            <p className="mt-2 max-w-xs text-base leading-7 text-[#c9d2e8]">{unavailableMessage}</p>
          </div>
        ) : (
          <ol className="trace-timeline relative space-y-3" aria-label="Ordered decision pipeline stages">
            {stages.map((stage, index) => {
              const outputId = `trace-stage-${index + 1}-output`;

              return (
                <li
                  className="trace-timeline__stage group relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
                  key={`${stage.name}-${index}`}
                >
                  <div className="trace-stage__rail flex flex-col items-center" aria-hidden="true">
                    <span className="z-10 grid size-8 place-items-center rounded-full border border-[#d3ae6c] bg-[#16275a] font-mono text-[0.72rem] font-bold text-[#e3c58a] shadow-[0_0_0_4px_#0c1733]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index < stages.length - 1 ? (
                      <span className="mt-1 h-full min-h-5 w-px bg-gradient-to-b from-[#d3ae6c]/60 to-[#3c507e]" />
                    ) : null}
                  </div>

                  <article className="trace-stage__card mb-1 min-w-0 rounded-2xl border border-[#3c507e] bg-[#14224f]/88 p-3.5 transition-colors hover:border-[#4c619a] hover:bg-[#16275a]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="shrink-0 text-emerald-300" aria-hidden="true" size={14} />
                          <h3 className="break-words font-mono text-[0.78rem] font-bold uppercase leading-5 tracking-[0.08em] text-[#f5f1ea]">
                            {humanizeStageName(stage)}
                          </h3>
                        </div>
                        <p className="mt-1 break-words font-mono text-[0.7rem] leading-4 text-[#a7b4d3]">{stage.name}</p>
                      </div>

                      <span className="trace-stage__latency inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#4c619a] bg-[#0c1733] px-2 py-1 font-mono text-[0.7rem] font-semibold text-[#e3c58a]">
                        <Clock3 aria-hidden="true" size={11} />
                        {formatLatency(stage.latency_ms)}
                      </span>
                    </div>

                    <details className="trace-stage__output mt-3" open={index === stages.length - 1}>
                      <summary className="cursor-pointer select-none rounded-lg font-mono text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[#c4cde2] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-[#e3c58a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#14224f]">
                        Structured output
                      </summary>
                      <pre
                        id={outputId}
                        className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[#304374] bg-[#09132e] p-3 font-mono text-[0.76rem] leading-5 text-[#d8def0]"
                      >
                        <code>{safeStringify(stage.output)}</code>
                      </pre>
                    </details>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
