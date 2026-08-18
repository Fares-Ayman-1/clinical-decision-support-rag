import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "../vitest.setup";
import App from "./App";
import { demoEvidenceByChunkId, getDemoResult } from "./data/demo-scenarios";

const API_ROOT = "http://localhost:8000";

const healthyResponse = {
  status: "ok",
  checks: {
    qdrant: { ok: true, points: 4_213 },
    chunk_store: { ok: true, chunks: 4_213 },
    embedding_model: { ok: true, warm: true },
    reranker: { ok: true, warm: true },
    llm: { ok: true },
  },
  versions: {
    kb: "test-kb-v1",
    embedding: "test-embedding-v1",
    prompts: "test-prompts-v1",
  },
} as const;

function mockHealthyApi() {
  server.use(
    http.get(`${API_ROOT}/api/health`, () => HttpResponse.json(healthyResponse)),
  );
}

async function renderWithHealthyApi() {
  mockHealthyApi();
  const view = render(<App />);
  await screen.findByRole("status", { name: "System status: LIVE" });
  return view;
}

async function enterDemo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Synthetic demo" }));
  await screen.findByRole("status", { name: "System status: DEMO" });
}

async function submitQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Submit clinical question" }));
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("App clinical assessment flow", () => {
  it("makes the synthetic demo explicit and resets results and queries whenever modes change", async () => {
    const user = userEvent.setup();
    let receivedMessage = "";
    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, async ({ request }) => {
        const body = await request.json() as { message: string };
        receivedMessage = body.message;
        return HttpResponse.json(getDemoResult("low"));
      }),
    );
    render(<App />);

    await screen.findByRole("status", { name: "System status: LIVE" });
    const question = screen.getByRole("textbox", { name: "Clinical question" });
    fireEvent.change(question, { target: { value: "A live API question" } });
    await submitQuestion(user);

    await screen.findByLabelText("LOW risk assessment");
    expect(receivedMessage).toBe("A live API question");

    await enterDemo(user);

    expect(screen.queryByLabelText("LOW risk assessment")).not.toBeInTheDocument();
    expect(question).toHaveValue(
      "I have crushing chest pressure, I am sweating, and I cannot breathe normally.",
    );
    expect(screen.getAllByText("SYNTHETIC").length).toBeGreaterThan(0);
    expect(screen.getByText("Start with a clinical question")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Demo scenario" }),
      "moderate",
    );
    expect(question).toHaveValue(
      "I have been getting more short of breath walking upstairs over the last week.",
    );

    await user.click(screen.getByRole("button", { name: "Real API" }));

    expect(question).toHaveValue("");
    expect(screen.queryAllByText("SYNTHETIC")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Real API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders critical risk, only backend-enabled actions, citation focus, and confirmed external navigation", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    await renderWithHealthyApi();
    await enterDemo(user);
    await submitQuestion(user);

    const risk = await screen.findByLabelText("CRITICAL risk assessment");
    expect(risk).toHaveTextContent("CRITICAL risk signal");
    expect(risk).toHaveTextContent("Seek emergency medical care immediately");
    expect(
      screen.getByText(
        "This combination of severe chest pressure, sweating, and breathlessness can signal a time-critical cardiovascular emergency.",
      ),
    ).toBeInTheDocument();

    const localCall = screen.getByRole("button", { name: "Local number not configured" });
    expect(localCall).toBeDisabled();
    expect(screen.getByRole("button", { name: "Find nearby care" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Alert a trusted contact" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Wellness guidance" })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Open evidence 1" })[0]!);
    const selectedEvidence = screen.getByRole("article", {
      name: /Evidence 1: selected\. WHO Framework/i,
    });
    await waitFor(() => expect(selectedEvidence).toHaveAttribute("aria-current", "true"));
    expect(selectedEvidence).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Find nearby care" }));
    const dialog = screen.getByRole("dialog", { name: "Find nearby emergency care?" });
    expect(within(dialog).getByText(/opens a maps search in a new tab/i)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Open maps" }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://www.google.com/maps/search/emergency+medical+care+near+me",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("presents a deliberate refusal without inventing risk or action controls", async () => {
    const user = userEvent.setup();
    await renderWithHealthyApi();
    await enterDemo(user);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Demo scenario" }),
      "refusal",
    );
    await submitQuestion(user);

    expect(
      await screen.findByRole("heading", { name: "This request cannot be answered safely" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot diagnose a skin condition or prescribe treatment/i)).toBeInTheDocument();
    expect(screen.getByText(/qualified healthcare professional/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/risk assessment/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Available actions")).not.toBeInTheDocument();

    // Evidence now lives behind the "Evidence (N)" button, not permanently on
    // the page.
    await user.click(screen.getByRole("button", { name: /^Evidence \(/ }));
    expect(
      screen.getByRole("article", { name: /Evidence 1: discarded/i }),
    ).toBeInTheDocument();
  });
});

describe("question validation", () => {
  it("blocks blank and over-limit questions before the API boundary", async () => {
    const user = userEvent.setup();
    let queryCalls = 0;
    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, () => {
        queryCalls += 1;
        return HttpResponse.json(getDemoResult("low"));
      }),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    const question = screen.getByRole("textbox", { name: "Clinical question" });
    await submitQuestion(user);
    expect(screen.getByText("Enter a clinical question before submitting.")).toBeInTheDocument();
    expect(question).toHaveFocus();

    fireEvent.change(question, { target: { value: "x".repeat(2_001) } });
    expect(screen.getByText("2,001 / 2,000")).toBeInTheDocument();
    await submitQuestion(user);

    expect(
      screen.getByText("Clinical questions must be 2,000 characters or fewer."),
    ).toBeInTheDocument();
    expect(question).toHaveAttribute("aria-invalid", "true");
    expect(queryCalls).toBe(0);
  });

  it.each([1, 2_000])("accepts a question at the %i-character boundary", async (length) => {
    const user = userEvent.setup();
    let submittedBody: unknown;
    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, async ({ request }) => {
        submittedBody = await request.json();
        return HttpResponse.json(getDemoResult("low"));
      }),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    fireEvent.change(screen.getByRole("textbox", { name: "Clinical question" }), {
      target: { value: "x".repeat(length) },
    });
    await submitQuestion(user);

    await screen.findByLabelText("LOW risk assessment");
    expect(submittedBody).toMatchObject({
      message: "x".repeat(length),
      options: { include_trace: true, stream: false },
    });
  });
});

describe("real API failures and explicit fallback", () => {
  it("keeps a network failure in real-API mode until the user explicitly enters demo mode", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_ROOT}/api/health`, () => HttpResponse.error()),
      http.post(`${API_ROOT}/api/query`, () => HttpResponse.error()),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: OFFLINE" });

    await user.type(
      screen.getByRole("textbox", { name: "Clinical question" }),
      "I am short of breath today",
    );
    await submitQuestion(user);

    expect(await screen.findByRole("heading", { name: "The clinical API is offline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Real API" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText(/risk assessment/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enter synthetic demo" }));

    expect(await screen.findByRole("status", { name: "System status: DEMO" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "The clinical API is offline" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Clinical question" })).toHaveValue(
      "I have crushing chest pressure, I am sweating, and I cannot breathe normally.",
    );
  });

  it("renders a rate-limit response with Retry-After and does not offer unrelated demo fallback", async () => {
    const user = userEvent.setup();
    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, () =>
        HttpResponse.json(
          { detail: "Too many requests" },
          { status: 429, headers: { "Retry-After": "7" } },
        ),
      ),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    await user.type(screen.getByRole("textbox", { name: "Clinical question" }), "Assess this");
    await submitQuestion(user);

    expect(await screen.findByRole("heading", { name: "Request limit reached" })).toBeInTheDocument();
    expect(screen.getByText("Please retry in about 7 seconds.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter synthetic demo" })).not.toBeInTheDocument();
  });

  it("shows native FastAPI validation details without rendering returned text as an answer", async () => {
    const user = userEvent.setup();
    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, () =>
        HttpResponse.json(
          {
            detail: [
              {
                type: "value_error",
                loc: ["body", "message"],
                msg: "Question is not valid for this endpoint",
                input: "Assess this",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    await user.type(screen.getByRole("textbox", { name: "Clinical question" }), "Assess this");
    await submitQuestion(user);

    expect(
      await screen.findByRole("heading", { name: "The question could not be processed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Question is not valid for this endpoint").closest("li"),
    ).toHaveTextContent(
      "message: Question is not valid for this endpoint",
    );
    expect(screen.queryByText("Evidence-grounded assessment")).not.toBeInTheDocument();
  });

  it("isolates evidence expansion across errors that omit request IDs", async () => {
    const user = userEvent.setup();
    const evidence = getDemoResult("refusal").evidence;
    const firstEvidence = evidence[0];
    const detail = firstEvidence
      ? demoEvidenceByChunkId.get(firstEvidence.chunk_id)
      : undefined;
    if (!firstEvidence || !detail) throw new Error("Expected a complete refusal evidence fixture");

    const firstPassage = "Canonical passage from the first failed assessment.";
    const secondPassage = "Canonical passage from the second failed assessment.";
    let queryCalls = 0;
    let evidenceCalls = 0;

    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, () => {
        queryCalls += 1;
        return HttpResponse.json(
          {
            error: {
              code: "LLM_UNAVAILABLE",
              message: "Evidence was retrieved, but grounded prose could not be generated.",
              stage: "generation",
            },
            evidence,
          },
          { status: 503 },
        );
      }),
      http.get(`${API_ROOT}/api/evidence/:chunkId`, () => {
        evidenceCalls += 1;
        const text = evidenceCalls === 1 ? firstPassage : secondPassage;
        return HttpResponse.json({
          ...detail,
          text,
          embedded_text: `Embedding-only prefix\n\n${text}`,
        });
      }),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    await user.type(screen.getByRole("textbox", { name: "Clinical question" }), "Assess this");
    await submitQuestion(user);
    await screen.findByRole("heading", { name: "Answer generation is unavailable" });

    // Evidence now lives behind the "Evidence (N)" button, not permanently on
    // the page.
    await user.click(screen.getByRole("button", { name: /^Evidence \(/ }));
    const firstArticle = screen.getByRole("article", { name: /Evidence 1: discarded/i });
    await user.click(within(firstArticle).getByRole("button", { name: "Open full passage" }));
    expect(await screen.findByText(firstPassage)).toBeInTheDocument();
    expect(evidenceCalls).toBe(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(queryCalls).toBe(2));
    expect(screen.queryByText(firstPassage)).not.toBeInTheDocument();

    // The retry closes the modal along with the rest of the assessment state,
    // so it has to be reopened to reach the fresh evidence.
    await user.click(screen.getByRole("button", { name: /^Evidence \(/ }));
    const secondArticle = screen.getByRole("article", { name: /Evidence 1: discarded/i });
    const secondExpand = within(secondArticle).getByRole("button", { name: "Open full passage" });
    await user.click(secondExpand);

    expect(await screen.findByText(secondPassage)).toBeInTheDocument();
    expect(evidenceCalls).toBe(2);
  });
});

describe("request cancellation", () => {
  it("shows a pending real assessment, aborts it on Cancel, and renders the deliberate cancelled state", async () => {
    const user = userEvent.setup();
    let markQueryStarted: (() => void) | undefined;
    let queryWasAborted = false;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });

    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, async ({ request }) => {
        markQueryStarted?.();
        return await new Promise<Response>((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              queryWasAborted = true;
              resolve(HttpResponse.error());
            },
            { once: true },
          );
        });
      }),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    await user.type(
      screen.getByRole("textbox", { name: "Clinical question" }),
      "Assess new breathlessness",
    );
    await submitQuestion(user);
    await queryStarted;

    expect(screen.getByText("CLINICAL / PIPELINE")).toBeInTheDocument();
    expect(screen.getByText("PROCESSING")).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel assessment" });
    expect(screen.getByRole("textbox", { name: "Clinical question" })).toBeDisabled();

    await user.click(cancel);

    expect(
      await screen.findByRole("heading", { name: "Assessment cancelled" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No result was created/i)).toBeInTheDocument();
    expect(queryWasAborted).toBe(true);
    expect(screen.queryByText("PROCESSING")).not.toBeInTheDocument();
  });

  it("aborts an in-flight canonical evidence request when a new assessment clears the inspector", async () => {
    const user = userEvent.setup();
    const result = getDemoResult("critical");
    const firstEvidence = result.evidence[0];
    expect(firstEvidence).toBeDefined();
    const detail = demoEvidenceByChunkId.get(firstEvidence!.chunk_id);
    expect(detail).toBeDefined();

    let markEvidenceStarted: (() => void) | undefined;
    let releaseEvidence: ((response: Response) => void) | undefined;
    let evidenceWasAborted = false;
    const evidenceStarted = new Promise<void>((resolve) => {
      markEvidenceStarted = resolve;
    });

    mockHealthyApi();
    server.use(
      http.post(`${API_ROOT}/api/query`, () => HttpResponse.json(result)),
      http.get(`${API_ROOT}/api/evidence/:chunkId`, async ({ request }) => {
        markEvidenceStarted?.();
        return await new Promise<Response>((resolve) => {
          releaseEvidence = resolve;
          request.signal.addEventListener(
            "abort",
            () => {
              evidenceWasAborted = true;
              resolve(HttpResponse.error());
            },
            { once: true },
          );
        });
      }),
    );
    render(<App />);
    await screen.findByRole("status", { name: "System status: LIVE" });

    fireEvent.change(screen.getByRole("textbox", { name: "Clinical question" }), {
      target: { value: "Assess urgent symptoms" },
    });
    await submitQuestion(user);
    await screen.findByLabelText("CRITICAL risk assessment");

    // Evidence now lives behind the "Evidence (N)" button, not permanently on
    // the page.
    await user.click(screen.getByRole("button", { name: /^Evidence \(/ }));
    await user.click(screen.getAllByRole("button", { name: "Open full passage" })[0]!);
    await evidenceStarted;
    expect(screen.getByText(/Loading the canonical source passage/i)).toBeInTheDocument();
    expect(evidenceWasAborted).toBe(false);

    await user.click(screen.getByRole("button", { name: "New assessment" }));

    try {
      await waitFor(() => expect(evidenceWasAborted).toBe(true));
    } finally {
      if (!evidenceWasAborted && detail) releaseEvidence?.(HttpResponse.json(detail));
    }
    // New assessment closes the modal along with clearing the inspector state
    // (there is no longer a permanently visible evidence panel to show an
    // empty state in) -- the entry point itself should be gone since there is
    // no evidence yet.
    expect(screen.queryByRole("button", { name: /^Evidence \(/ })).not.toBeInTheDocument();
  });
});

describe("theme preference", () => {
  it("persists the selected theme and restores it when the document is bootstrapped again", async () => {
    const user = userEvent.setup();
    const firstRender = await renderWithHealthyApi();

    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("clinical-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();

    firstRender.unmount();
    document.documentElement.dataset.theme = window.localStorage.getItem("clinical-theme") ?? "light";
    render(<App />);

    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("clinical-theme")).toBe("light");
  });
});
