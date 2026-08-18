import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileSearch,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import type { EvidenceDetail, EvidenceItem } from "../types/api";

export interface EvidencePanelProps {
  evidence?: readonly EvidenceItem[];
  onLoadFullText: (chunkId: string, signal?: AbortSignal) => Promise<EvidenceDetail>;
  activeIndex?: number | null;
  onSelectEvidence?: (index: number) => void;
  className?: string;
  tabLabelId?: string;
  id?: string;
  /**
   * When true, renders as bare content for embedding inside another
   * container (the evidence modal) — no outer card chrome, no duplicate
   * heading, since the Modal already supplies both.
   */
  embedded?: boolean;
  /**
   * Full-text cache owned by a parent that outlives this panel's mount —
   * the modal unmounts EvidencePanel on close, so without this every
   * reopen would re-fetch passages already loaded once.
   */
  initialFullText?: Readonly<Record<string, string>>;
  onFullTextLoaded?: (chunkId: string, text: string) => void;
}

type ScoreKey = keyof EvidenceItem["scores"];

const SCORE_LABELS: ReadonlyArray<readonly [ScoreKey, string]> = [
  ["dense", "Dense"],
  ["bm25", "BM25"],
  ["rrf", "Fusion"],
  ["rerank", "Rerank"],
];

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatPageRange(start: number, end: number) {
  return start === end ? `Page ${start}` : `Pages ${start}–${end}`;
}

function formatScore(key: ScoreKey, value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (key === "dense" || key === "rrf") return value.toFixed(3);
  return value.toFixed(2);
}

function safeSourceUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function EvidencePanel({
  evidence = [],
  onLoadFullText,
  activeIndex = null,
  onSelectEvidence,
  className,
  tabLabelId,
  id,
  embedded = false,
  initialFullText,
  onFullTextLoaded,
}: EvidencePanelProps) {
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(() => new Set());
  const [fullTextByChunk, setFullTextByChunk] = useState<Record<string, string>>(
    () => ({ ...initialFullText }),
  );
  const [loadingChunks, setLoadingChunks] = useState<Set<string>>(() => new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const loadControllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const controllers = loadControllers.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const scoreRanges = useMemo(() => {
    return SCORE_LABELS.reduce<Record<ScoreKey, { min: number; max: number }>>(
      (ranges, [key]) => {
        const values = evidence
          .map((item) => item.scores[key])
          .filter((score): score is number => score != null && Number.isFinite(score));
        ranges[key] = {
          min: Math.min(0, ...values),
          max: Math.max(0, ...values),
        };
        return ranges;
      },
      {
        dense: { min: 0, max: 0 },
        bm25: { min: 0, max: 0 },
        rrf: { min: 0, max: 0 },
        rerank: { min: 0, max: 0 },
      },
    );
  }, [evidence]);

  useEffect(() => {
    if (activeIndex == null) return;

    const target = document.getElementById(`evidence-${activeIndex}`);
    if (!target) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
    target.focus({ preventScroll: true });
  }, [activeIndex]);

  async function loadFullText(chunkId: string) {
    loadControllers.current.get(chunkId)?.abort();
    const controller = new AbortController();
    loadControllers.current.set(chunkId, controller);
    setLoadingChunks((current) => new Set(current).add(chunkId));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[chunkId];
      return next;
    });

    try {
      const detail = await onLoadFullText(chunkId, controller.signal);
      if (controller.signal.aborted) return;
      setFullTextByChunk((current) => ({ ...current, [chunkId]: detail.text }));
      onFullTextLoaded?.(chunkId, detail.text);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadErrors((current) => ({
        ...current,
        [chunkId]:
          error instanceof Error
            ? error.message
            : "The complete source passage could not be loaded.",
      }));
    } finally {
      if (loadControllers.current.get(chunkId) === controller) {
        loadControllers.current.delete(chunkId);
        setLoadingChunks((current) => {
          const next = new Set(current);
          next.delete(chunkId);
          return next;
        });
      }
    }
  }

  async function toggleEvidence(item: EvidenceItem) {
    const { chunk_id: chunkId } = item;
    const isExpanded = expandedChunks.has(chunkId);

    if (isExpanded) {
      setExpandedChunks((current) => {
        const next = new Set(current);
        next.delete(chunkId);
        return next;
      });
      return;
    }

    setExpandedChunks((current) => new Set(current).add(chunkId));

    if (fullTextByChunk[chunkId] || loadingChunks.has(chunkId)) return;

    await loadFullText(chunkId);
  }

  function renderCard(item: EvidenceItem) {
    const isExpanded = expandedChunks.has(item.chunk_id);
    const isLoading = loadingChunks.has(item.chunk_id);
    const fullText = fullTextByChunk[item.chunk_id];
    const loadError = loadErrors[item.chunk_id];
    const sourceUrl = safeSourceUrl(item.source_url);
    const isActive = activeIndex === item.index;
    const detailsId = `evidence-${item.index}-full-text`;

    return (
      <article
        key={item.chunk_id}
        id={`evidence-${item.index}`}
        tabIndex={0}
        onFocus={() => onSelectEvidence?.(item.index)}
        onClick={() => onSelectEvidence?.(item.index)}
        className={joinClasses(
          "evidence-card group relative scroll-mt-28 rounded-[1.125rem] border bg-[#fbf8f2] p-4 outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-[#76551f] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-[#14224f] dark:focus-visible:ring-[#e3c58a] dark:focus-visible:ring-offset-[#16275a]",
          item.selected
            ? "selected evidence-card--selected border-[#d3ae6c] shadow-[inset_3px_0_0_#d3ae6c] dark:border-[#d3ae6c]"
            : "discarded evidence-card--discarded border-[#e5dfd0] opacity-80 dark:border-[#3c507e]",
          isActive && "highlighted evidence-card--active ring-2 ring-[#d3ae6c]/55",
        )}
        aria-label={`Evidence ${item.index}: ${item.selected ? "selected" : "discarded"}. ${item.document_title}`}
        aria-current={isActive ? "true" : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="evidence-card__index grid size-8 shrink-0 place-items-center rounded-full bg-[#0c1733] font-mono text-[0.75rem] font-bold text-[#e3c58a] dark:bg-[#f5f1ea] dark:text-[#0c1733]">
              {item.index}
            </span>
            <span
              className={joinClasses(
                "evidence-card__status inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.72rem] font-bold uppercase tracking-[0.1em]",
                item.selected
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200"
                  : "bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
              )}
            >
              {item.selected ? (
                <CheckCircle2 aria-hidden="true" size={13} />
              ) : (
                <XCircle aria-hidden="true" size={13} />
              )}
              {item.selected ? "Selected" : "Discarded"}
            </span>
          </div>

          {sourceUrl ? (
            <a
              className="evidence-card__source-link inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-mono text-[0.72rem] font-semibold uppercase tracking-wide text-[#684b1b] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76551f] dark:text-[#e3c58a]"
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Source
              <ExternalLink aria-hidden="true" size={12} />
            </a>
          ) : null}
        </div>

        <h3 className="evidence-card__title mt-3 text-[0.98rem] font-semibold leading-6 text-[#111b37] dark:text-white">
          {item.document_title}
        </h3>

        <dl className="evidence-card__metadata mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[0.8rem] leading-5">
          <dt className="font-mono uppercase tracking-wider text-[#625b50] dark:text-[#b6c0da]">
            Org
          </dt>
          <dd className="min-w-0 text-[#444b5d] dark:text-[#d6dcef]">{item.organization}</dd>
          <dt className="font-mono uppercase tracking-wider text-[#625b50] dark:text-[#b6c0da]">
            Section
          </dt>
          <dd className="min-w-0 text-[#444b5d] dark:text-[#d6dcef]">{item.section_path}</dd>
          <dt className="font-mono uppercase tracking-wider text-[#625b50] dark:text-[#b6c0da]">
            Location
          </dt>
          <dd className="text-[#444b5d] dark:text-[#d6dcef]">
            {formatPageRange(item.page_start, item.page_end)}
          </dd>
          {item.evidence_grade ? (
            <>
              <dt className="font-mono uppercase tracking-wider text-[#625b50] dark:text-[#b6c0da]">
                Grade
              </dt>
              <dd>
                <span className="rounded-md border border-[#d3ae6c] bg-[#d3ae6c]/10 px-2 py-0.5 font-mono font-semibold text-[#72572c] dark:text-[#e3c58a]">
                  {item.evidence_grade}
                </span>
              </dd>
            </>
          ) : null}
        </dl>

        {item.excerpt ? (
          <blockquote className="evidence-card__excerpt mt-4 border-l-2 border-[#d3ae6c] pl-3 text-base leading-7 text-[#414755] dark:text-[#d5dbee]">
            {item.excerpt}
          </blockquote>
        ) : (
          <p className="evidence-card__excerpt mt-4 border-l-2 border-[#e5dfd0] pl-3 text-sm italic leading-7 text-[#8a8271] dark:border-[#3c507e] dark:text-[#8492b8]">
            This candidate was retrieved but not cited in the generated answer.
          </p>
        )}

        <details className="evidence-card__technical mt-4 border-t border-[#e5dfd0] pt-3 dark:border-[#3c507e]">
          <summary className="cursor-pointer select-none font-mono text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[#625b50] outline-none hover:text-[#26304a] focus-visible:ring-2 focus-visible:ring-[#76551f] dark:text-[#b6c0da] dark:hover:text-white">
            Technical details
          </summary>
          <div className="evidence-card__scores mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            {SCORE_LABELS.map(([key, label]) => {
              const score = item.scores[key];
              const hasScore = score != null && Number.isFinite(score);
              const { min: minimum, max: maximum } = scoreRanges[key];
              const meterMaximum = maximum > minimum ? maximum : minimum + 1;
              const width =
                maximum > minimum && hasScore
                  ? Math.min(100, Math.max(0, ((score - minimum) / (maximum - minimum)) * 100))
                  : 0;

              return (
                <div className="evidence-score min-w-0" key={key}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[0.72rem]">
                    <span className="uppercase tracking-wider text-[#625b50] dark:text-[#b6c0da]">
                      {label}
                    </span>
                    <span className="font-semibold text-[#17213c] dark:text-[#f4f1e9]">
                      {formatScore(key, score)}
                    </span>
                  </div>
                  <span
                    className="evidence-score__track block h-1.5 overflow-hidden rounded-full bg-[#e5dfd0] dark:bg-[#304374]"
                    role="meter"
                    aria-label={`${label} score for evidence ${item.index}`}
                    aria-valuemin={minimum}
                    aria-valuemax={meterMaximum}
                    aria-valuenow={hasScore ? score : 0}
                  >
                    <span
                      className="evidence-score__fill block h-full rounded-full bg-[#b8914f] dark:bg-[#e3c58a]"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </details>

        <button
          type="button"
          className="evidence-card__expand mt-4 inline-flex w-full items-center justify-between rounded-xl border border-[#d8cdb4] bg-white px-3 py-3 text-left text-base font-semibold text-[#26304a] transition hover:border-[#d3ae6c] hover:bg-[#fffdf8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76551f] dark:border-[#4c619a] dark:bg-[#16275a] dark:text-[#f5f1ea] dark:hover:border-[#d3ae6c] dark:hover:bg-[#1b2e68]"
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          onClick={(event) => {
            event.stopPropagation();
            void toggleEvidence(item);
          }}
        >
          <span className="inline-flex items-center gap-2">
            {isLoading ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" size={15} />
            ) : (
              <BookOpen aria-hidden="true" size={15} />
            )}
            {isExpanded ? "Hide full passage" : "Open full passage"}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={16}
            className={joinClasses("transition-transform", isExpanded && "rotate-180")}
          />
        </button>

        {isExpanded ? (
          <div
            id={detailsId}
            className="evidence-card__full-text mt-3 rounded-xl border border-[#e5dfd0] bg-white p-3 text-base leading-7 text-[#3f4655] dark:border-[#3c507e] dark:bg-[#0f1d45] dark:text-[#dbe1f2]"
          >
            {isLoading ? (
              <p className="inline-flex items-center gap-2" role="status">
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                  size={15}
                />
                Loading the canonical source passage…
              </p>
            ) : loadError ? (
              <div className="flex items-start gap-2 text-rose-700 dark:text-rose-200" role="alert">
                <XCircle className="mt-1 shrink-0" aria-hidden="true" size={15} />
                <div>
                  <p>{loadError}</p>
                  <button
                    type="button"
                    className="mt-2 font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadFullText(item.chunk_id);
                    }}
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap">{fullText ?? item.excerpt}</p>
            )}
          </div>
        ) : null}
      </article>
    );
  }

  const citedEvidence = evidence.filter((item) => item.selected);
  const additionalEvidence = evidence.filter((item) => !item.selected);
  // A refusal is schema-enforced to have no cited candidates (no candidate on
  // a refusal is ever selected: true). With nothing cited, there is nothing
  // to group against, so everything renders open under one plain heading
  // instead of leaving an empty "Cited Evidence" section above a collapsed one.
  const hasCitedEvidence = citedEvidence.length > 0;

  const listContent = evidence.length === 0 ? (
    <div className="evidence-panel__empty flex flex-1 flex-col items-center justify-center px-7 py-16 text-center">
      <span className="mb-5 grid size-14 place-items-center rounded-2xl border border-[#d8cdb4] bg-[#fbf8f2] text-[#76551f] dark:border-[#4c619a] dark:bg-[#14224f] dark:text-[#e3c58a]">
        <BookOpen aria-hidden="true" size={25} strokeWidth={1.5} />
      </span>
      <h3 className="text-lg font-semibold text-[#0c1733] [font-family:var(--font-display)] dark:text-white">
        Evidence will appear here
      </h3>
      <p className="mt-2 max-w-xs text-base leading-7 text-[#555b69] dark:text-[#d1d8eb]">
        Submit a clinical question to see selected and discarded guideline passages, their
        provenance, and retrieval scores.
      </p>
    </div>
  ) : (
    <div className="evidence-panel__list flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
      {hasCitedEvidence ? (
        <>
          <h3 className="evidence-panel__group-heading px-1 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#625b50] dark:text-[#b6c0da]">
            Cited Evidence
          </h3>
          <div className="space-y-3">{citedEvidence.map(renderCard)}</div>
        </>
      ) : null}

      {additionalEvidence.length > 0 ? (
        hasCitedEvidence ? (
          <details className="evidence-panel__additional mt-2">
            <summary className="cursor-pointer select-none px-1 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#625b50] outline-none hover:text-[#26304a] focus-visible:ring-2 focus-visible:ring-[#76551f] dark:text-[#b6c0da] dark:hover:text-white">
              Additional Retrieved Evidence ({additionalEvidence.length})
            </summary>
            <div className="mt-3 space-y-3">{additionalEvidence.map(renderCard)}</div>
          </details>
        ) : (
          <>
            <h3 className="evidence-panel__group-heading px-1 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[#625b50] dark:text-[#b6c0da]">
              Retrieved Candidates
            </h3>
            <div className="space-y-3">{additionalEvidence.map(renderCard)}</div>
          </>
        )
      ) : null}
    </div>
  );

  if (embedded) {
    return <div className={joinClasses("evidence-panel-embedded", className)}>{listContent}</div>;
  }

  return (
    <section
      id={id}
      className={joinClasses(
        "evidence-panel flex min-h-0 flex-col overflow-hidden rounded-[1.375rem] border border-[#e5dfd0] bg-white/90 shadow-[0_24px_70px_rgba(12,23,51,0.08)] backdrop-blur-xl dark:border-[#3c507e] dark:bg-[#16275a]/90",
        className,
      )}
      role={tabLabelId ? "tabpanel" : undefined}
      aria-labelledby={tabLabelId ?? "evidence-panel-title"}
    >
      <header className="evidence-panel__header flex items-start justify-between gap-4 border-b border-[#e5dfd0] px-5 py-5 dark:border-[#3c507e]">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[#8a6e3d] dark:text-[#e3c58a]">
            <FileSearch aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>Evidence / Inspector</span>
          </div>
          <h2
            id="evidence-panel-title"
            className="text-xl font-semibold tracking-[-0.025em] text-[#0c1733] [font-family:var(--font-display)] dark:text-white"
          >
            Retrieved evidence
          </h2>
          <p className="mt-1 text-base leading-6 text-[#4f5564] dark:text-[#d1d8eb]">
            Inspect the exact guideline passages considered by the system.
          </p>
        </div>

        <span className="evidence-panel__count shrink-0 rounded-full border border-[#d8cdb4] bg-[#fbf8f2] px-3 py-1 font-mono text-xs font-semibold text-[#5b4a2f] dark:border-[#4c619a] dark:bg-[#14224f] dark:text-[#e3c58a]">
          {evidence.length} {evidence.length === 1 ? "SOURCE" : "SOURCES"}
        </span>
      </header>

      {listContent}
    </section>
  );
}
