import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const normalizedScore = finiteNumber.min(0).max(1);

// docs/knowledge-base.md has 7 pending "TBD — record exact WHO IRIS URL..."
// source URLs (Phase 1 admin task, not yet done) — every chunk in the
// corpus carries this placeholder today (confirmed: 7381/7381). A strict
// z.string().url() would reject every real evidence citation until that
// admin task is finished, so the placeholder is accepted alongside a real
// URL rather than silently loosening validation for actual malformed data.
// Most chunks now carry a real, resolving source URL (WHO IRIS handles and
// DOIs, each derived from an identifier inside the PDF and verified to
// resolve). One document (who_dcm) is still an explicit TBD: two IRIS
// records hold the 2021 SEARO IMAI manual and neither their metadata nor
// the PDF's ISBNs identify which one is Volume 2, so a guessed link would
// resolve to the wrong book — worse than a placeholder, because it looks
// correct. The TBD branch stays until that is confirmed.
const sourceUrl = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("TBD") || z.string().url().safeParse(value).success,
    { message: "source_url must be a valid URL or the known TBD placeholder" },
  );

export const riskLevelSchema = z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const confidenceBandSchema = z.enum(["strong", "moderate", "weak"]);
export type ConfidenceBand = z.infer<typeof confidenceBandSchema>;

export const sufficiencySchema = z.enum([
  "SUFFICIENT",
  "PARTIAL",
  "INSUFFICIENT",
  "OUT_OF_SCOPE",
]);
export type Sufficiency = z.infer<typeof sufficiencySchema>;

export const evidenceGradeSchema = z.enum(["A", "B", "C", "D", "I"]);
export type EvidenceGrade = z.infer<typeof evidenceGradeSchema>;

export const patientSexSchema = z.enum([
  "female",
  "male",
  "intersex",
  "other",
  "unknown",
]);
export type PatientSex = z.infer<typeof patientSexSchema>;

export const patientContextSchema = z
  .object({
    age: z.number().int().min(0).max(120).optional(),
    sex: patientSexSchema.optional(),
    known_conditions: z.array(nonEmptyString).optional(),
    medications: z.array(nonEmptyString).optional(),
  })
  .strict();
export type PatientContext = z.infer<typeof patientContextSchema>;

export const queryRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    session_id: z.string().uuid().optional(),
    patient_context: patientContextSchema.optional(),
    options: z
      .object({
        include_trace: z.boolean().optional(),
        stream: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type QueryRequest = z.infer<typeof queryRequestSchema>;

export const healthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded", "down"]),
    checks: z
      .object({
        qdrant: z
          .object({
            ok: z.boolean(),
            points: z.number().int().nonnegative(),
          })
          .strict(),
        chunk_store: z
          .object({
            ok: z.boolean(),
            chunks: z.number().int().nonnegative(),
          })
          .strict(),
        embedding_model: z
          .object({
            ok: z.boolean(),
            warm: z.boolean(),
          })
          .strict(),
        reranker: z
          .object({
            ok: z.boolean(),
            warm: z.boolean(),
          })
          .strict(),
        llm: z.object({ ok: z.boolean() }).strict(),
      })
      .strict(),
    versions: z
      .object({
        kb: nonEmptyString,
        embedding: nonEmptyString,
        prompts: nonEmptyString,
      })
      .strict(),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const evidenceScoresSchema = z
  .object({
    // dense/bm25/rerank are nullable in practice: multi-query fusion
    // (backend/app/services/retrieval/hybrid_search.py
    // hybrid_search_multi_query) doesn't always preserve a clean
    // per-source sub-score for a chunk found only via one variant, and no
    // cross-encoder reranker is active (NullReranker, PROJECT-STATE.md
    // R12), so rerank_score is None on every chunk today. rrf is always
    // present since it's the fusion mechanism itself.
    dense: finiteNumber.nullable(),
    bm25: finiteNumber.nullable(),
    rrf: finiteNumber,
    rerank: finiteNumber.nullable(),
  })
  .strict();
export type EvidenceScores = z.infer<typeof evidenceScoresSchema>;

export const evidenceItemSchema = z
  .object({
    index: z.number().int().positive(),
    chunk_id: nonEmptyString,
    document_title: nonEmptyString,
    organization: nonEmptyString,
    section_path: nonEmptyString,
    page_start: z.number().int().positive(),
    page_end: z.number().int().positive(),
    evidence_grade: evidenceGradeSchema.nullable(),
    // Only chunks actually cited by a generated statement get a verbatim
    // excerpt (backend/app/main.py _build_evidence_out) — the rest of
    // the retrieved-but-unused candidates have none.
    excerpt: nonEmptyString.nullable(),
    source_url: sourceUrl,
    scores: evidenceScoresSchema,
    selected: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.page_end < value.page_start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "page_end must be greater than or equal to page_start",
        path: ["page_end"],
      });
    }
  });
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

const rawEvidenceDetailSchema = z
  .object({
    chunk_id: nonEmptyString,
    document_id: nonEmptyString,
    document_title: nonEmptyString,
    organization: nonEmptyString,
    publication_year: z.number().int().min(1800).max(2200),
    source_url: sourceUrl,
    license: nonEmptyString,
    // section is genuinely null for 15 real chunks in the corpus — the
    // Phase 4 section detector's fallback pages (front matter with no
    // detected heading; PROJECT-STATE.md §5). section_path always has a
    // value ("(no section detected)" in that fallback case).
    section: nonEmptyString.nullable(),
    subsection: nonEmptyString.nullable(),
    section_path: nonEmptyString,
    section_confidence: z.enum(["detected", "inherited"]),
    page_start: z.number().int().positive(),
    page_end: z.number().int().positive(),
    domains: z.array(nonEmptyString),
    chunk_type: z.enum(["recommendation", "guidance", "table", "background"]),
    evidence_grade: evidenceGradeSchema.nullable(),
    recommendation_class: z.string().trim().min(1).nullable(),
    text: nonEmptyString,
    // The backend's Chunk Store only persists canonical `text`, not the
    // contextual-header-prefixed embedded_text used at embed time — it's
    // an embedding-pipeline artifact, not stored per-chunk. Optional here
    // rather than required, since the API genuinely never sends it.
    embedded_text: nonEmptyString.optional(),
    token_count: z.number().int().positive(),
    content_hash: z.string().regex(/^sha256:[a-fA-F0-9]+$/),
    kb_version: nonEmptyString,
    chunking_version: nonEmptyString,
    embedding_version: nonEmptyString,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.page_end < value.page_start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "page_end must be greater than or equal to page_start",
        path: ["page_end"],
      });
    }
  });

/**
 * The backend record contains `embedded_text`, but the frontend deliberately
 * strips it at the validation boundary. Only canonical `text` can reach UI code.
 */
export const evidenceDetailSchema = rawEvidenceDetailSchema.transform(
  ({ embedded_text, ...canonicalRecord }) => {
    void embedded_text;
    return canonicalRecord;
  },
);
export type EvidenceDetail = z.infer<typeof evidenceDetailSchema>;
export type RawEvidenceDetail = z.input<typeof evidenceDetailSchema>;

// This is the FULL target-vision pipeline (matches SPEC.md's illustrative
// trace and src/data/demo-scenarios.ts's synthetic demo mode, which
// deliberately shows the complete system even though several stages don't
// exist in the real backend yet). The real API's trace
// (backend/app/services/rag/query_orchestrator.py run_query) only ever
// emits a subset: extraction, domain_predict, query_rewrite, retrieval,
// rerank, sufficiency, generation, validation — never red_flag_check/risk/
// decision (Phase 14 explicitly skipped, PROJECT-STATE.md decision D5;
// Phase 15 not started), and "retrieval" collapses dense_search/
// bm25_search/fusion into one real measured stage rather than three
// fabricated sub-timings hybrid_search_multi_query doesn't actually expose.
//
// domain_predict and query_rewrite are independent calls with no real
// dependency on each other (both only need the extracted patient state),
// so the real pipeline runs them in a different relative order than this
// list — they're intentionally given the SAME rank below so either
// ordering validates. "retrieval" is also given the same rank as
// dense_search/bm25_search/fusion for the same reason: it's one name for
// what those three represent, not a fourth stage with its own position.
// red_flag_check and prescribing_check are given the SAME rank as
// extraction: SPEC.md SAF-6.1 requires the red-flag precheck to run
// BEFORE the pipeline (so a possible emergency is never delayed behind
// retrieval and 4+ LLM calls), which puts it ahead of extraction in the
// real pipeline — while the original demo data placed it after. Sharing a
// rank lets both orderings validate rather than forcing the safety-
// critical ordering to change to satisfy a display contract.
const STAGE_ORDER_GROUPS: readonly (readonly string[])[] = [
  ["extraction", "red_flag_check", "prescribing_check"],
  ["domain_predict", "query_rewrite"],
  ["dense_search", "bm25_search", "fusion", "retrieval"],
  ["rerank"],
  ["sufficiency"],
  ["generation"],
  ["validation"],
  ["dose_scan"],
  ["risk"],
  ["decision"],
];

export const traceStageNameSchema = z.enum([
  "extraction",
  "red_flag_check",
  "prescribing_check",
  "query_rewrite",
  "domain_predict",
  "dense_search",
  "bm25_search",
  "fusion",
  "retrieval",
  "rerank",
  "sufficiency",
  "generation",
  "validation",
  "dose_scan",
  "risk",
  "decision",
]);
export type TraceStageName = z.infer<typeof traceStageNameSchema>;

export const traceStageSchema = z
  .object({
    // Unlike most fields in this file, stage `name` is intentionally NOT
    // constrained to traceStageNameSchema — a string big enough to hold
    // any stage the backend adds later (e.g. once Phase 14/15 exist) is
    // safer than a strict union that starts silently rejecting real
    // traces the moment the backend's stage set evolves. traceSchema's
    // ordering validation below still uses traceStageNameSchema's known
    // order for the stages it does recognize.
    name: nonEmptyString,
    latency_ms: nonNegativeNumber,
    output: z.record(z.string(), z.unknown()),
  })
  .strict();
export type TraceStage = z.infer<typeof traceStageSchema>;

// Group rank, not per-name rank: stages in the same STAGE_ORDER_GROUPS
// entry (e.g. domain_predict/query_rewrite, or dense_search/bm25_search/
// fusion/retrieval) share one position, so a real trace presenting them
// in a different relative order — or using "retrieval" where the
// illustrative demo uses three separate stages — never counts as "out of
// order" against itself.
const STAGE_GROUP_RANK = new Map<string, number>(
  STAGE_ORDER_GROUPS.flatMap((group, rank) => group.map((name) => [name, rank] as const)),
);

export const traceSchema = z
  .object({
    stages: z.array(traceStageSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    let previousKnownRank = -1;

    value.stages.forEach((stage, index) => {
      if (seen.has(stage.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Trace stage ${stage.name} must not be duplicated`,
          path: ["stages", index, "name"],
        });
      }
      seen.add(stage.name);

      // Ordering is only checked among recognized stage names — an
      // unrecognized name (e.g. a future stage this schema doesn't know
      // about yet) can't be judged "out of order" against a sequence it
      // was never part of, so it's skipped rather than treated as rank -1
      // (which would falsely flag it).
      const rank = STAGE_GROUP_RANK.get(stage.name);
      if (rank === undefined) return;
      if (rank < previousKnownRank) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Trace stage ${stage.name} is out of pipeline order`,
          path: ["stages", index, "name"],
        });
      }
      previousKnownRank = Math.max(previousKnownRank, rank);
    });
  });
export type Trace = z.infer<typeof traceSchema>;
export type PipelineTrace = Trace;

export const patientStateSchema = z
  .object({
    symptoms: z.array(nonEmptyString),
    severity: z.enum(["mild", "moderate", "severe", "unknown"]),
    onset: z.string().trim().min(1).nullable(),
    duration: z.string().trim().min(1).nullable(),
    missing_information: z.array(nonEmptyString),
  })
  .strict();
export type PatientState = z.infer<typeof patientStateSchema>;

export const assessmentStatementSchema = z
  .object({
    id: z.number().int().positive(),
    text: nonEmptyString,
    citations: z
      .array(z.number().int().positive())
      .min(1, "Every assessment statement must cite selected evidence"),
  })
  .strict();
export type AssessmentStatement = z.infer<typeof assessmentStatementSchema>;

export const assessmentSchema = z
  .object({
    statements: z.array(assessmentStatementSchema).min(1),
    limitations: z.array(nonEmptyString),
    conflicts: z.array(nonEmptyString),
    diagnosis_confirmed: z.literal(false),
  })
  .strict();
export type Assessment = z.infer<typeof assessmentSchema>;

export const riskSchema = z
  .object({
    level: riskLevelSchema,
    confidence_band: confidenceBandSchema,
    confidence_value: normalizedScore.optional(),
    reasoning_factors: z.array(nonEmptyString),
    red_flag_rules: z.array(nonEmptyString),
    evidence_ids: z.array(z.number().int().positive()).min(1),
  })
  .strict();
export type Risk = z.infer<typeof riskSchema>;

export const recommendedActionSchema = z
  .object({
    type: z.enum(["emergency", "urgent_care", "evaluation", "guidance"]),
    message: nonEmptyString,
  })
  .strict();
export type RecommendedAction = z.infer<typeof recommendedActionSchema>;

export const decisionActionsSchema = z
  .object({
    show_call_emergency: z.boolean(),
    show_find_facility: z.boolean(),
    show_alert_contacts: z.boolean(),
    show_wellness: z.boolean(),
  })
  .strict();
export type DecisionActions = z.infer<typeof decisionActionsSchema>;

export const safetySchema = z
  .object({
    sufficiency: sufficiencySchema,
    // Pydantic always serializes an Optional field's key, with `null`
    // when unset — it never omits the key the way `.optional()` alone
    // expects (that only accepts the key being ABSENT, not explicitly
    // null). No calibrated retrieval-confidence-band signal is computed
    // today (backend/app/schemas/query.py SafetyOut has no field for it
    // yet), so this is always null from the real API — nullable, not
    // just optional.
    retrieval_confidence_band: confidenceBandSchema.nullable().optional(),
    unsupported_statements_dropped: z.number().int().nonnegative().optional(),
    injection_detected: z.boolean().optional(),
    disclaimer: nonEmptyString,
  })
  .strict();
export type Safety = z.infer<typeof safetySchema>;

export const responseMetaSchema = z
  .object({
    latency_ms: nonNegativeNumber,
    kb_version: nonEmptyString,
    embedding_version: nonEmptyString,
    prompt_version: nonEmptyString,
    // No Risk Engine exists (Phase 15 not started, PROJECT-STATE.md), so
    // there is no risk policy to version — null rather than a fabricated
    // string.
    risk_policy_version: nonEmptyString.nullable(),
  })
  .strict();
export type ResponseMeta = z.infer<typeof responseMetaSchema>;

export const querySuccessSchema = z
  .object({
    request_id: z.string().uuid(),
    status: z.literal("success"),
    supported_domain: z.boolean(),
    domains: z.array(nonEmptyString),
    patient_state: patientStateSchema,
    assessment: assessmentSchema,
    risk: riskSchema.optional(),
    recommended_action: recommendedActionSchema,
    actions: decisionActionsSchema,
    evidence: z.array(evidenceItemSchema).min(1),
    safety: safetySchema,
    // Same Pydantic-null-vs-Zod-optional gap as safetySchema's
    // retrieval_confidence_band above: the real API always sends the
    // `trace` key, with `null` when include_trace was false rather than
    // omitting it.
    trace: traceSchema.nullable().optional(),
    meta: responseMetaSchema,
  })
  .strict();
export type QuerySuccess = z.infer<typeof querySuccessSchema>;

export const refusalReasonSchema = z.enum([
  "OUT_OF_SCOPE",
  "INSUFFICIENT_EVIDENCE",
  "PRESCRIBING_REQUEST",
]);
export type RefusalReason = z.infer<typeof refusalReasonSchema>;

export const queryRefusalSchema = z
  .object({
    request_id: z.string().uuid(),
    status: z.literal("refusal"),
    supported_domain: z.boolean(),
    domains: z.array(nonEmptyString),
    refusal: z
      .object({
        reason: refusalReasonSchema,
        message: nonEmptyString,
        recommend_professional_evaluation: z.boolean(),
      })
      .strict(),
    evidence: z.array(evidenceItemSchema),
    safety: safetySchema,
    // Same Pydantic-null-vs-Zod-optional gap as safetySchema's
    // retrieval_confidence_band above: the real API always sends the
    // `trace` key, with `null` when include_trace was false rather than
    // omitting it.
    trace: traceSchema.nullable().optional(),
    meta: responseMetaSchema,
  })
  .strict();
export type QueryRefusal = z.infer<typeof queryRefusalSchema>;

export const queryResultSchema = z.discriminatedUnion("status", [
  querySuccessSchema,
  queryRefusalSchema,
]).superRefine((result, context) => {
  const evidenceIndexes = new Set(result.evidence.map((item) => item.index));
  const selectedEvidenceIndexes = new Set(
    result.evidence.filter((item) => item.selected).map((item) => item.index),
  );
  if (evidenceIndexes.size !== result.evidence.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence indexes must be unique",
      path: ["evidence"],
    });
  }

  if (result.status === "success") {
    if (!result.supported_domain) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A successful assessment must be inside a supported domain",
        path: ["supported_domain"],
      });
    }

    if (result.safety.sufficiency !== "SUFFICIENT" && result.safety.sufficiency !== "PARTIAL") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A successful assessment requires sufficient or partial evidence",
        path: ["safety", "sufficiency"],
      });
    }

    if (result.safety.sufficiency === "PARTIAL" && result.assessment.limitations.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A partial-evidence assessment must state at least one limitation",
        path: ["assessment", "limitations"],
      });
    }

    result.assessment.statements.forEach((statement, statementIndex) => {
      statement.citations.forEach((citation, citationIndex) => {
        if (!selectedEvidenceIndexes.has(citation)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Citation ${citation} does not resolve to selected evidence`,
            path: ["assessment", "statements", statementIndex, "citations", citationIndex],
          });
        }
      });
    });
    result.risk?.evidence_ids.forEach((evidenceId, evidenceIdIndex) => {
      if (!selectedEvidenceIndexes.has(evidenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Risk evidence ID ${evidenceId} does not resolve to selected evidence`,
          path: ["risk", "evidence_ids", evidenceIdIndex],
        });
      }
    });
  } else {
    result.evidence.forEach((item, index) => {
      if (item.selected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Refusal candidates must not be marked as selected evidence",
          path: ["evidence", index, "selected"],
        });
      }
    });
  }
});
export type QueryResult = z.infer<typeof queryResultSchema>;

export const apiErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "CHUNK_NOT_FOUND",
  "SCHEMA_VIOLATION",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "RETRIEVAL_UNAVAILABLE",
  "LLM_UNAVAILABLE",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorDetailSchema = z
  .object({
    field: nonEmptyString,
    code: nonEmptyString,
    message: nonEmptyString,
  })
  .strict();
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export const apiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: nonEmptyString,
        request_id: z.string().uuid().optional(),
        // The machine-readable diagnostic behind `code`. The backend sends
        // this on EVERY error (main.py _error_body always sets it), and
        // omitting it here was not merely incomplete — because this object
        // is .strict(), an undeclared key made the whole envelope fail to
        // parse, so every structured error fell through to the generic
        // INVALID_RESPONSE branch. A deployed API reporting
        // RETRIEVAL_UNAVAILABLE / VECTOR_STORE_UNREACHABLE surfaced in the
        // UI only as "The service returned an unexpected response".
        //
        // It carries real diagnostic value worth keeping: RESOURCES_NOT_LOADED
        // and VECTOR_STORE_UNREACHABLE share the RETRIEVAL_UNAVAILABLE code
        // but mean different things (index never loaded vs. Qdrant
        // unreachable), and only `reason` tells them apart.
        reason: nonEmptyString.optional(),
        stage: nonEmptyString.optional(),
        details: z.array(apiErrorDetailSchema).optional(),
      })
      .strict(),
    evidence: z.array(evidenceItemSchema).optional(),
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export const fastApiValidationErrorSchema = z
  .object({
    detail: z.array(
      z
        .object({
          type: nonEmptyString,
          loc: z.array(z.union([z.string(), z.number()])),
          msg: nonEmptyString,
          input: z.unknown().optional(),
          ctx: z.record(z.string(), z.unknown()).optional(),
          url: z.string().url().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type FastApiValidationError = z.infer<typeof fastApiValidationErrorSchema>;

export function parseQueryResult(input: unknown): QueryResult {
  return queryResultSchema.parse(input);
}

export function parseHealthResponse(input: unknown): HealthResponse {
  return healthResponseSchema.parse(input);
}

export function parseEvidenceDetail(input: unknown): EvidenceDetail {
  return evidenceDetailSchema.parse(input);
}
