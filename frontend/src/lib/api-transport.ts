import type { ZodType } from "zod";

import {
  evidenceDetailSchema,
  healthResponseSchema,
  queryRequestSchema,
  queryResultSchema,
  type EvidenceDetail,
  type HealthResponse,
  type QueryRequest,
  type QueryResult,
} from "../types/api";
import type { ClinicalTransport, TransportCallOptions } from "../types/transport";
import {
  ClinicalApiError,
  isClinicalApiError,
  normalizeHttpError,
  validationErrorToClinicalError,
} from "./clinical-errors";

type EndpointName = "health" | "query" | "evidence";

export interface ApiTransportConfig {
  fetch?: typeof fetch;
  timeoutMs?: number | Partial<Record<EndpointName, number>>;
}

const DEFAULT_TIMEOUTS: Readonly<Record<EndpointName, number>> = {
  health: 5_000,
  query: 30_000,
  evidence: 10_000,
};

interface CombinedSignal {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
}

function combineSignal(externalSignal: AbortSignal | undefined, timeoutMs: number): CombinedSignal {
  const controller = new AbortController();
  let timeoutTriggered = false;

  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  const timeout = globalThis.setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timeoutTriggered,
    cleanup: () => {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function timeoutFor(config: ApiTransportConfig, endpoint: EndpointName): number {
  const configured = config.timeoutMs;
  const value = typeof configured === "number" ? configured : configured?.[endpoint];
  const resolved = value ?? DEFAULT_TIMEOUTS[endpoint];
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError(`timeoutMs for ${endpoint} must be a positive finite number`);
  }
  return resolved;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new TypeError("baseUrl must not be empty");
  return trimmed;
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new ClinicalApiError("INVALID_RESPONSE", "The clinical service returned invalid JSON.", {
      status: response.status,
      cause: error,
    });
  }
}

function parseResponse<T>(schema: ZodType<T>, payload: unknown, status: number): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new ClinicalApiError(
    "INVALID_RESPONSE",
    "The clinical service returned data that does not match its documented contract.",
    {
      status,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "response",
        code: issue.code,
        message: issue.message,
      })),
      cause: parsed.error,
    },
  );
}

interface RequestJsonOptions<T> {
  endpoint: EndpointName;
  path: string;
  schema: ZodType<T>;
  init?: RequestInit;
  signal?: AbortSignal;
  acceptStatus?: (status: number, payload: unknown) => boolean;
}

export function createApiTransport(
  baseUrl: string,
  config: ApiTransportConfig = {},
): ClinicalTransport {
  const root = normalizeBaseUrl(baseUrl);
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("A Fetch API implementation is required");
  }

  async function requestJson<T>({
    endpoint,
    path,
    schema,
    init,
    signal: externalSignal,
    acceptStatus,
  }: RequestJsonOptions<T>): Promise<T> {
    const combined = combineSignal(externalSignal, timeoutFor(config, endpoint));
    try {
      const headers = new Headers(init?.headers);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      const response = await fetchImplementation(`${root}${path}`, {
        ...init,
        headers,
        signal: combined.signal,
      });
      const payload = await readJson(response);

      if (!response.ok && !acceptStatus?.(response.status, payload)) {
        throw normalizeHttpError(response, payload);
      }
      return parseResponse(schema, payload, response.status);
    } catch (error) {
      if (isClinicalApiError(error)) throw error;
      if (combined.didTimeout()) {
        throw new ClinicalApiError(
          "REQUEST_TIMEOUT",
          "The clinical service took too long to respond.",
          { cause: error },
        );
      }
      if (externalSignal?.aborted) {
        throw new ClinicalApiError("REQUEST_CANCELLED", "The request was cancelled.", {
          cause: error,
        });
      }
      throw new ClinicalApiError(
        "NETWORK_ERROR",
        "The clinical service could not be reached. Check the connection and try again.",
        { cause: error },
      );
    } finally {
      combined.cleanup();
    }
  }

  return {
    mode: "api",
    capabilities: Object.freeze({ streaming: false }),

    health(options: TransportCallOptions = {}): Promise<HealthResponse> {
      return requestJson({
        endpoint: "health",
        path: "/api/health",
        schema: healthResponseSchema,
        signal: options.signal,
        // `down` is a typed health state and is documented with HTTP 503.
        acceptStatus: (status, payload) =>
          status === 503 && healthResponseSchema.safeParse(payload).success,
      });
    },

    query(request: QueryRequest, options: TransportCallOptions = {}): Promise<QueryResult> {
      const validatedRequest = queryRequestSchema.safeParse({
        ...request,
        options: {
          ...request.options,
          include_trace: true,
          stream: false,
        },
      });
      if (!validatedRequest.success) {
        return Promise.reject(validationErrorToClinicalError(validatedRequest.error));
      }

      return requestJson({
        endpoint: "query",
        path: "/api/query",
        schema: queryResultSchema,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validatedRequest.data),
        },
        signal: options.signal,
      });
    },

    evidence(chunkId: string, options: TransportCallOptions = {}): Promise<EvidenceDetail> {
      const normalizedChunkId = chunkId.trim();
      if (!normalizedChunkId) {
        return Promise.reject(
          new ClinicalApiError("INVALID_INPUT", "An evidence chunk ID is required.", {
            status: 400,
            details: [{ field: "chunk_id", code: "too_small", message: "Required" }],
          }),
        );
      }

      return requestJson({
        endpoint: "evidence",
        path: `/api/evidence/${encodeURIComponent(normalizedChunkId)}`,
        schema: evidenceDetailSchema,
        signal: options.signal,
      });
    },
  };
}
