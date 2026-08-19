import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getDemoResult } from "../data/demo-scenarios";
import { EvidencePanel } from "./EvidencePanel";
import { TracePanel } from "./TracePanel";

describe("technical inspector accessibility", () => {
  it("reports an ordered subset of trace stages as partial", () => {
    render(
      <TracePanel
        trace={{
          stages: [
            { name: "extraction", latency_ms: 12, output: { symptoms: ["breathlessness"] } },
          ],
        }}
      />,
    );

    expect(screen.getByText("Partial")).toBeVisible();
    expect(screen.getByText(/1\/13 stages/)).toBeVisible();
  });

  it("uses a valid meter range for negative reranker scores", () => {
    const refusal = getDemoResult("refusal");
    const evidence = refusal.evidence;
    const rerankScore = evidence[0]!.scores.rerank;
    expect(rerankScore).toBeLessThan(0);

    render(
      <EvidencePanel
        evidence={evidence}
        onLoadFullText={vi.fn(() => Promise.reject(new Error("not expanded")))}
      />,
    );

    // The scores now sit inside a collapsed "Technical details" <details>
    // element -- expand it before looking for the meter.
    fireEvent.click(screen.getByText("Technical details"));

    const meter = screen.getByRole("meter", {
      name: `Rerank score for evidence ${evidence[0]!.index}`,
    });
    expect(meter).toHaveAttribute("aria-valuemin", String(rerankScore));
    expect(meter).toHaveAttribute("aria-valuemax", "0");
    expect(meter).toHaveAttribute("aria-valuenow", String(rerankScore));
  });
});
