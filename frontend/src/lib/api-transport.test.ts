import { describe, expect, it, vi } from "vitest";

import { demoScenarios, getDemoResult } from "../data/demo-scenarios";
import { queryResultSchema, traceSchema } from "../types/api";
import { createApiTransport } from "./api-transport";
import { ClinicalApiError } from "./clinical-errors";
import { createDemoTransport } from "./demo-transport";

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

async function expectRejectedSuccessPayload(payload: unknown): Promise<void> {
  expect(queryResultSchema.safeParse(payload).success).toBe(false);

  const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload));
  const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

  await expect(transport.query({ message: "Assess this" })).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
}

describe("createApiTransport", () => {
  it("forces trace on and streaming off without mutating the caller request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(getDemoResult("low")));
    const transport = createApiTransport("http://localhost:8000/", { fetch: fetchMock });
    const request = {
      message: "What habits support heart health?",
      options: { include_trace: false, stream: true },
    } as const;

    await transport.query(request);

    expect(request.options).toEqual({ include_trace: false, stream: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:8000/api/query");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      options: { include_trace: true, stream: false },
    });
  });

  it("normalizes native FastAPI 422 validation errors", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          detail: [
            {
              type: "string_too_short",
              loc: ["body", "message"],
              msg: "String should have at least 1 character",
              input: "",
            },
          ],
        },
        422,
      ),
    );
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.query({ message: "valid client-side message" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 422,
      details: [expect.objectContaining({ field: "message", code: "string_too_short" })],
    });
  });

  it("unwraps FastAPI's `detail` envelope around a structured error", async () => {
    // Verbatim body from the deployed API when Qdrant was unreachable.
    // FastAPI wraps HTTPException(detail={"error": {...}}) in `detail`, so
    // this arrives nested one level deeper than the schema expects. Before
    // the unwrap in normalizeHttpError, the parse failed and the UI showed
    // a generic INVALID_RESPONSE / "unexpected response" instead of the
    // precise reason the API had actually reported.
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          detail: {
            error: {
              code: "RETRIEVAL_UNAVAILABLE",
              message:
                "The evidence index is currently unavailable. No answer can be generated without it.",
              request_id: "bfd6e89a-9115-4398-a5bd-49290929874e",
              reason: "VECTOR_STORE_UNREACHABLE",
              stage: "retrieval",
            },
          },
        },
        503,
      ),
    );
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.query({ message: "valid client-side message" })).rejects.toMatchObject({
      code: "RETRIEVAL_UNAVAILABLE",
      status: 503,
      stage: "retrieval",
      // `reason` is what separates VECTOR_STORE_UNREACHABLE from
      // RESOURCES_NOT_LOADED — both arrive as RETRIEVAL_UNAVAILABLE.
      reason: "VECTOR_STORE_UNREACHABLE",
      requestId: "bfd6e89a-9115-4398-a5bd-49290929874e",
    });
  });

  it("preserves structured outage codes, stage, request ID, and evidence", async () => {
    const candidate = getDemoResult("refusal").evidence;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "LLM_UNAVAILABLE",
            message: "Evidence was retrieved, but grounded prose could not be generated.",
            request_id: "00000000-0000-4000-8000-000000000099",
            stage: "generation",
          },
          evidence: candidate,
        },
        503,
      ),
    );
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.query({ message: "Assess this" })).rejects.toMatchObject({
      code: "LLM_UNAVAILABLE",
      status: 503,
      stage: "generation",
      requestId: "00000000-0000-4000-8000-000000000099",
      evidence: candidate,
    });
  });

  it("accepts a documented down health payload returned with HTTP 503", async () => {
    const payload = {
      status: "down",
      checks: {
        qdrant: { ok: false, points: 0 },
        chunk_store: { ok: true, chunks: 4_213 },
        embedding_model: { ok: true, warm: true },
        reranker: { ok: false, warm: false },
        llm: { ok: false },
      },
      versions: { kb: "1.0", embedding: "embed-v1", prompts: "rag-gen-v1" },
    };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload, 503));
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.health()).resolves.toEqual(payload);
  });

  it("does not retry network failures", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("connection refused");
    });
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.health()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("converts a transport timeout into a typed error", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const transport = createApiTransport("http://localhost:8000", {
      fetch: fetchMock,
      timeoutMs: 5,
    });

    await expect(transport.health()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps caller cancellation distinct from a timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const transport = createApiTransport("http://localhost:8000", {
      fetch: fetchMock,
      timeoutMs: 10_000,
    });

    const pending = transport.health({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  });

  it("rejects a malformed success payload at the runtime boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "success", assessment: "unvalidated model output" }),
    );
    const transport = createApiTransport("http://localhost:8000", { fetch: fetchMock });

    await expect(transport.query({ message: "Assess this" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("createDemoTransport", () => {
  it.each(demoScenarios)("returns a validated $label result", async ({ id }) => {
    const transport = createDemoTransport(id);
    const result = await transport.query({ message: "Run the selected synthetic scenario" });

    expect(transport.mode).toBe("demo");
    expect(result.status).toBe(id === "refusal" ? "refusal" : "success");
  });

  it("returns canonical text and never exposes embedded_text", async () => {
    const transport = createDemoTransport("critical");
    const result = await transport.query({ message: "Run critical scenario" });
    const firstEvidence = result.evidence[0];
    expect(firstEvidence).toBeDefined();

    const detail = await transport.evidence(firstEvidence!.chunk_id);
    expect(detail.text).toContain("synthetic demonstration record");
    expect("embedded_text" in detail).toBe(false);
  });

  it("uses the documented chunk-not-found error", async () => {
    const transport = createDemoTransport("low");

    await expect(transport.evidence("missing-demo-chunk")).rejects.toBeInstanceOf(
      ClinicalApiError,
    );
    await expect(transport.evidence("missing-demo-chunk")).rejects.toMatchObject({
      code: "CHUNK_NOT_FOUND",
      status: 404,
    });
  });
});

describe("clinical response invariants", () => {
  it("rejects a success payload for an unsupported domain", async () => {
    const response = getDemoResult("low");
    expect(response.status).toBe("success");
    if (response.status !== "success") return;

    response.supported_domain = false;

    await expectRejectedSuccessPayload(response);
  });

  it.each(["INSUFFICIENT", "OUT_OF_SCOPE"] as const)(
    "rejects a success payload with %s evidence sufficiency",
    async (sufficiency) => {
      const response = getDemoResult("low");
      expect(response.status).toBe("success");
      if (response.status !== "success") return;

      response.safety.sufficiency = sufficiency;

      await expectRejectedSuccessPayload(response);
    },
  );

  it("rejects a partial-evidence success payload without an explicit limitation", async () => {
    const response = getDemoResult("low");
    expect(response.status).toBe("success");
    if (response.status !== "success") return;

    response.safety.sufficiency = "PARTIAL";
    response.assessment.limitations = [];

    await expectRejectedSuccessPayload(response);
  });

  it("rejects uncited statements and citations to discarded candidates", () => {
    const uncited = getDemoResult("low");
    expect(uncited.status).toBe("success");
    if (uncited.status !== "success") return;
    uncited.assessment.statements[0]!.citations = [];
    expect(queryResultSchema.safeParse(uncited).success).toBe(false);

    const discardedTarget = getDemoResult("low");
    expect(discardedTarget.status).toBe("success");
    if (discardedTarget.status !== "success") return;
    const citedIndex = discardedTarget.assessment.statements[0]!.citations[0]!;
    const citedEvidence = discardedTarget.evidence.find((item) => item.index === citedIndex);
    expect(citedEvidence).toBeDefined();
    citedEvidence!.selected = false;

    const parsed = queryResultSchema.safeParse(discardedTarget);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("selected evidence"))).toBe(
        true,
      );
    }
  });

  it("rejects citation indexes that do not resolve to returned evidence", () => {
    const response = getDemoResult("low");
    expect(response.status).toBe("success");
    if (response.status !== "success") return;

    response.assessment.statements[0]!.citations = [999];
    const parsed = queryResultSchema.safeParse(response);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("does not resolve"))).toBe(
        true,
      );
    }
  });

  it("rejects duplicated or out-of-order trace stages", () => {
    const parsed = traceSchema.safeParse({
      stages: [
        { name: "rerank", latency_ms: 2, output: {} },
        { name: "dense_search", latency_ms: 1, output: {} },
        { name: "dense_search", latency_ms: 1, output: {} },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});
