import { expect, test, type Page } from "@playwright/test";

async function enterSyntheticDemo(page: Page) {
  await page.getByRole("button", { name: "Synthetic demo" }).click();

  await expect(page.getByRole("button", { name: "Synthetic demo" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status", { name: "System status: DEMO" })).toBeVisible();
  await expect(page.getByText("Synthetic demonstration", { exact: true })).toBeVisible();
}

async function submitCurrentQuestion(page: Page) {
  await page.getByRole("button", { name: "Submit clinical question" }).click();
}

test.describe("clinical workspace", () => {
  test("runs the explicitly labeled critical synthetic assessment end to end", async ({ page }) => {
    await page.goto("/");
    await enterSyntheticDemo(page);

    const question = page.getByRole("textbox", { name: "Clinical question" });
    await expect(question).toHaveValue(
      "I have crushing chest pressure, I am sweating, and I cannot breathe normally.",
    );

    await submitCurrentQuestion(page);

    const riskAssessment = page.getByRole("region", { name: "CRITICAL risk assessment" });
    await expect(riskAssessment).toContainText("CRITICAL risk signal");
    await expect(riskAssessment).toContainText("Seek emergency medical care immediately");
    await expect(page.getByText("Evidence-grounded assessment", { exact: true })).toBeVisible();

    // Evidence and the pipeline are no longer permanent panels -- the main
    // page stays on the assessment.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Evidence (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decision Pipeline" })).toBeVisible();

    // A citation click opens the Evidence popup directly on that source,
    // without navigating away from the assessment.
    await page.getByRole("button", { name: "Open evidence 1" }).first().click();
    const evidenceDialog = page.getByRole("dialog", { name: "Retrieved Evidence" });
    await expect(evidenceDialog).toBeVisible();
    await expect(evidenceDialog.getByText("2 SOURCES", { exact: true })).toBeVisible();
    const firstArticle = evidenceDialog.getByRole("article", {
      name: /Evidence 1: selected\. WHO Framework for the Care of Acute Coronary Syndrome and Stroke/,
    });
    await expect(firstArticle).toHaveAttribute("aria-current", "true");

    await evidenceDialog.getByRole("button", { name: "Open full passage" }).first().click();
    await expect(evidenceDialog.getByText(/provided only to exercise the evidence inspector/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(evidenceDialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/); // no route change; still on "/"

    // Reopening collapses the card again (expansion state is not preserved,
    // only the fetched text is), but expanding it a second time is instant --
    // no loading state -- because the passage is cached from the first fetch
    // rather than re-requested.
    await page.getByRole("button", { name: "Evidence (2)" }).click();
    await expect(evidenceDialog).toBeVisible();
    await expect(evidenceDialog.getByText(/provided only to exercise the evidence inspector/)).toHaveCount(0);
    await evidenceDialog.getByRole("button", { name: "Open full passage" }).first().click();
    await expect(evidenceDialog.getByText(/Loading the canonical source passage/)).toHaveCount(0);
    await expect(evidenceDialog.getByText(/provided only to exercise the evidence inspector/)).toBeVisible();
    await page.getByRole("button", { name: "Close Retrieved Evidence" }).click();
    await expect(evidenceDialog).toBeHidden();

    await page.getByRole("button", { name: "Decision Pipeline" }).click();
    const pipelineDialog = page.getByRole("dialog", { name: "Decision Pipeline" });
    await expect(pipelineDialog).toBeVisible();
    await expect(pipelineDialog.getByText(/13\/13 stages/)).toBeVisible();
    await expect(pipelineDialog.getByText(/^Total:/)).toBeVisible();
    await expect(
      pipelineDialog.getByRole("list", { name: "Ordered decision pipeline stages" }).getByRole("listitem"),
    ).toHaveCount(13);
    await page.getByRole("button", { name: "Close Decision Pipeline" }).click();
    await expect(pipelineDialog).toBeHidden();

    await expect(page.getByRole("button", { name: "Local number not configured" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Find nearby care" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Alert a trusted contact" })).toBeVisible();
  });

  test("shows a deliberate refusal without fabricating an answer", async ({ page }) => {
    await page.goto("/");
    await enterSyntheticDemo(page);

    await page.getByLabel("Demo scenario").selectOption("refusal");
    await expect(page.getByRole("textbox", { name: "Clinical question" })).toHaveValue(
      "Can you diagnose the rash in this photo and prescribe a cream?",
    );

    await submitCurrentQuestion(page);

    await expect(
      page.getByRole("heading", { name: "This request cannot be answered safely" }),
    ).toBeVisible();
    await expect(page.getByText("Safe refusal / prescribing request", { exact: true })).toBeVisible();
    await expect(page.getByText(/cannot diagnose a skin condition or prescribe treatment/)).toBeVisible();
    await expect(page.getByRole("region", { name: /risk assessment/i })).toHaveCount(0);
    await expect(page.getByText("Evidence-grounded assessment", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Evidence (1)" }).click();
    const evidenceDialog = page.getByRole("dialog", { name: "Retrieved Evidence" });
    await expect(evidenceDialog.getByText("1 SOURCE", { exact: true })).toBeVisible();
    await expect(
      evidenceDialog.getByRole("article", { name: /Evidence 1: discarded\./ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Decision Pipeline" }).click();
    await expect(
      page.getByRole("dialog", { name: "Decision Pipeline" }).getByText(/13\/13 stages/),
    ).toBeVisible();
  });

  test("persists only the selected theme across reloads", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (globalThis as unknown as {
            localStorage: { getItem: (key: string) => string | null };
          }).localStorage.getItem("clinical-theme"),
        ),
      )
      .toBe("dark");

    await page.reload();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(
            (globalThis as unknown as { localStorage: Record<string, string> }).localStorage,
          ),
        ),
      )
      .toEqual(["clinical-theme"]);
  });

  test("keeps modal popups accessible: Escape, backdrop click, and focus return", async ({ page }) => {
    await page.goto("/");
    await enterSyntheticDemo(page);
    await submitCurrentQuestion(page);
    await expect(page.getByRole("region", { name: "CRITICAL risk assessment" })).toBeVisible();

    const evidenceButton = page.getByRole("button", { name: "Evidence (2)" });
    await evidenceButton.click();
    const evidenceDialog = page.getByRole("dialog", { name: "Retrieved Evidence" });
    await expect(evidenceDialog).toBeVisible();

    // Esc closes it and returns focus to the button that opened it.
    await page.keyboard.press("Escape");
    await expect(evidenceDialog).toBeHidden();
    await expect(evidenceButton).toBeFocused();

    // Clicking outside the panel (the backdrop) also closes it.
    const pipelineButton = page.getByRole("button", { name: "Decision Pipeline" });
    await pipelineButton.click();
    const pipelineDialog = page.getByRole("dialog", { name: "Decision Pipeline" });
    await expect(pipelineDialog).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(pipelineDialog).toBeHidden();
    await expect(pipelineButton).toBeFocused();

    // The assessment underneath was never touched by any of this.
    await expect(page.getByRole("region", { name: "CRITICAL risk assessment" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("sizes the Evidence popup as a compact desktop panel, an inset tablet panel, and a full-screen mobile panel", async ({ page }) => {
    await page.goto("/");
    await enterSyntheticDemo(page);
    await submitCurrentQuestion(page);

    const viewport = page.viewportSize();
    if (!viewport) throw new Error("Expected a configured viewport for the desktop case");
    await page.getByRole("button", { name: "Evidence (2)" }).click();
    let box = await page.getByRole("dialog", { name: "Retrieved Evidence" }).boundingBox();
    if (!box) throw new Error("Evidence dialog must have a layout box");
    expect(box.width).toBeLessThanOrEqual(1_000);
    expect(box.width).toBeLessThan(viewport.width);
    expect(box.height).toBeLessThan(viewport.height);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 820, height: 1_180 });
    await page.getByRole("button", { name: "Evidence (2)" }).click();
    box = await page.getByRole("dialog", { name: "Retrieved Evidence" }).boundingBox();
    if (!box) throw new Error("Evidence dialog must have a layout box at tablet width");
    expect(box.width).toBeCloseTo(820 - 32, 0);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Evidence (2)" }).click();
    box = await page.getByRole("dialog", { name: "Retrieved Evidence" }).boundingBox();
    if (!box) throw new Error("Evidence dialog must have a layout box at mobile width");
    expect(box.width).toBeCloseTo(390, 0);
    expect(box.height).toBeCloseTo(844, 0);
  });

  test("exposes landmarks and supports a keyboard-only path into demo mode", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Clinical decisions/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clinical assessment" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Medical disclaimer" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Clinical question" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "New assessment" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Real API" })).toBeFocused();
    await page.keyboard.press("Tab");
    const demoButton = page.getByRole("button", { name: "Synthetic demo" });
    await expect(demoButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(demoButton).toHaveAttribute("aria-pressed", "true");

    const question = page.getByRole("textbox", { name: "Clinical question" });
    await question.focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("region", { name: "CRITICAL risk assessment" })).toBeVisible();
  });
});
