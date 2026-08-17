import {
  demoEvidenceByChunkId,
  getDemoResult,
  isDemoScenarioId,
  type DemoScenarioId,
} from "../data/demo-scenarios";
import {
  healthResponseSchema,
  queryRequestSchema,
  type EvidenceDetail,
  type HealthResponse,
  type QueryRequest,
  type QueryResult,
} from "../types/api";
import type { ClinicalTransport, TransportCallOptions } from "../types/transport";
import { ClinicalApiError, validationErrorToClinicalError } from "./clinical-errors";

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ClinicalApiError("REQUEST_CANCELLED", "The request was cancelled.");
  }
}

export function createDemoTransport(scenarioId: DemoScenarioId): ClinicalTransport {
  if (!isDemoScenarioId(scenarioId)) {
    throw new TypeError(`Unknown synthetic demo scenario: ${String(scenarioId)}`);
  }
  const scenarioChunkIds = new Set(
    getDemoResult(scenarioId).evidence.map((item) => item.chunk_id),
  );

  return {
    mode: "demo",
    capabilities: Object.freeze({ streaming: false }),

    async health(options: TransportCallOptions = {}): Promise<HealthResponse> {
      assertActive(options.signal);
      return healthResponseSchema.parse({
        status: "ok",
        checks: {
          qdrant: { ok: true, points: 8 },
          chunk_store: { ok: true, chunks: 8 },
          embedding_model: { ok: true, warm: true },
          reranker: { ok: true, warm: true },
          llm: { ok: true },
        },
        versions: {
          kb: "synthetic-demo-1.0",
          embedding: "synthetic-embed-v1",
          prompts: "synthetic-rag-gen-v1",
        },
      });
    },

    async query(
      request: QueryRequest,
      options: TransportCallOptions = {},
    ): Promise<QueryResult> {
      assertActive(options.signal);
      const validated = queryRequestSchema.safeParse({
        ...request,
        options: { ...request.options, include_trace: true, stream: false },
      });
      if (!validated.success) throw validationErrorToClinicalError(validated.error);
      return getDemoResult(scenarioId);
    },

    async evidence(
      chunkId: string,
      options: TransportCallOptions = {},
    ): Promise<EvidenceDetail> {
      assertActive(options.signal);
      const normalizedChunkId = chunkId.trim();
      const detail = scenarioChunkIds.has(normalizedChunkId)
        ? demoEvidenceByChunkId.get(normalizedChunkId)
        : undefined;
      if (!detail) {
        throw new ClinicalApiError(
          "CHUNK_NOT_FOUND",
          "The requested synthetic evidence chunk was not found.",
          { status: 404 },
        );
      }
      return { ...detail, domains: [...detail.domains] };
    },
  };
}
