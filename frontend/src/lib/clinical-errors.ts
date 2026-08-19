import { z, type ZodError } from "zod";

import {
  apiErrorEnvelopeSchema,
  fastApiValidationErrorSchema,
  type ApiErrorCode,
  type ApiErrorDetail,
  type EvidenceItem,
} from "../types/api";

export const clientErrorCodeSchema = z.enum([
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "REQUEST_CANCELLED",
  "INVALID_RESPONSE",
  "SERVICE_UNAVAILABLE",
]);
export type ClientErrorCode = z.infer<typeof clientErrorCodeSchema>;
export type ClinicalErrorCode = ApiErrorCode | ClientErrorCode;

export interface ClinicalApiErrorOptions {
  status?: number;
  requestId?: string;
  stage?: string;
  details?: ApiErrorDetail[];
  evidence?: EvidenceItem[];
  retryAfterSeconds?: number;
  cause?: unknown;
  reason?: string;
}

export class ClinicalApiError extends Error {
  readonly code: ClinicalErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly stage?: string;
  /** Machine-readable diagnostic behind `code` (e.g. VECTOR_STORE_UNREACHABLE). */
  readonly reason?: string;
  readonly details?: ApiErrorDetail[];
  readonly evidence?: EvidenceItem[];
  readonly retryAfterSeconds?: number;
  readonly originalCause?: unknown;

  constructor(code: ClinicalErrorCode, message: string, options: ClinicalApiErrorOptions = {}) {
    super(message);
    this.name = "ClinicalApiError";
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.stage = options.stage;
    this.reason = options.reason;
    this.details = options.details;
    this.evidence = options.evidence;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.originalCause = options.cause;
    Object.setPrototypeOf(this, ClinicalApiError.prototype);
  }
}

export function isClinicalApiError(error: unknown): error is ClinicalApiError {
  return error instanceof ClinicalApiError;
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const retryDate = Date.parse(header);
  if (!Number.isFinite(retryDate)) return undefined;
  return Math.max(0, Math.ceil((retryDate - Date.now()) / 1_000));
}

function normalizedFastApiDetails(error: z.infer<typeof fastApiValidationErrorSchema>): ApiErrorDetail[] {
  return error.detail.map((item) => ({
    field: item.loc
      .filter((segment) => segment !== "body")
      .map(String)
      .join(".") || "request",
    code: item.type,
    message: item.msg,
  }));
}

export function validationErrorToClinicalError(error: ZodError): ClinicalApiError {
  return new ClinicalApiError("INVALID_INPUT", "The request contains invalid fields.", {
    status: 400,
    details: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "request",
      code: issue.code,
      message: issue.message,
    })),
    cause: error,
  });
}

export function normalizeHttpError(response: Response, payload: unknown): ClinicalApiError {
  const retryAfter = retryAfterSeconds(response);
  // FastAPI wraps whatever an HTTPException carries in a `detail` key, so a
  // handler that raises HTTPException(detail={"error": {...}}) reaches the
  // client as {"detail": {"error": {...}}} rather than {"error": {...}}.
  // Unwrap one level of that before matching, otherwise every such response
  // falls through to the generic INVALID_RESPONSE branch below and the UI
  // reports "unexpected response" for errors the API described precisely —
  // observed against a deployed API returning RETRIEVAL_UNAVAILABLE /
  // VECTOR_STORE_UNREACHABLE, which the user saw only as INVALID_RESPONSE.
  const unwrapped =
    payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : payload;
  const structured = apiErrorEnvelopeSchema.safeParse(unwrapped);
  if (structured.success) {
    const { error, evidence } = structured.data;
    return new ClinicalApiError(error.code, error.message, {
      status: response.status,
      requestId: error.request_id,
      stage: error.stage,
      reason: error.reason,
      details: error.details,
      evidence,
      retryAfterSeconds: retryAfter,
    });
  }

  const fastApiValidation = fastApiValidationErrorSchema.safeParse(payload);
  if (response.status === 422 && fastApiValidation.success) {
    return new ClinicalApiError("INVALID_INPUT", "The request contains invalid fields.", {
      status: response.status,
      details: normalizedFastApiDetails(fastApiValidation.data),
    });
  }

  if (response.status === 429) {
    return new ClinicalApiError("RATE_LIMITED", "Too many requests. Please try again shortly.", {
      status: response.status,
      retryAfterSeconds: retryAfter,
    });
  }

  if (response.status === 400 || response.status === 422) {
    return new ClinicalApiError("INVALID_INPUT", "The request could not be validated.", {
      status: response.status,
    });
  }

  if (response.status === 503) {
    return new ClinicalApiError(
      "SERVICE_UNAVAILABLE",
      "The clinical evidence service is temporarily unavailable.",
      { status: response.status },
    );
  }

  return new ClinicalApiError("INTERNAL_ERROR", "The clinical service returned an error.", {
    status: response.status,
  });
}
