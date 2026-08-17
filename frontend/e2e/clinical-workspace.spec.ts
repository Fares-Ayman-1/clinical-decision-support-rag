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
    await expect(page.getByRole("button", { name: "Open evidence 1" }).first()).toBeVisible();

    const evidencePanel = page.getByRole("tabpanel", { name: "Evidence" });
    await expect(evidencePanel.getByText("2 SOURCES", { exact: true })).toBeVisible();
    await expect(
      evidencePanel.getByRole("article", {
        name: /Evidence 1: selected\. WHO Framework for the Care of Acute Coronary Syndrome and Stroke/,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open evidence 1" }).first().click();
    await expect(
      evidencePanel.getByRole("article", { name: /Evidence 1: selected\./ }),
    ).toHaveAttribute("aria-current", "true");

    await evidencePanel.getByRole("button", { name: "Open full passage" }).first().click();
    await expect(evidencePanel.getByText(/provided only to exercise the evidence inspector/)).toBeVisible();

    const tracePanel = page.getByRole("tabpanel", { name: "Trace" });
    await expect(tracePanel.getByText("13/13 stages /", { exact: false })).toBeVisible();
    await expect(
      tracePanel.getByRole("list", { name: "Ordered decision pipeline stages" }).getByRole("listitem"),
    ).toHaveCount(13);

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

    const evidencePanel = page.getByRole("tabpanel", { name: "Evidence" });
    await expect(evidencePanel.getByText("1 SOURCE", { exact: true })).toBeVisible();
    await expect(
      evidencePanel.getByRole("article", { name: /Evidence 1: discarded\./ }),
    ).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Trace" })).toContainText(
      "13/13 stages /",
    );
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

  test("switches between the mobile Chat, Evidence, and Trace panels", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tabs = page.getByRole("tablist", { name: "Clinical workspace panels" });
    const chatTab = tabs.getByRole("tab", { name: "Chat" });
    const evidenceTab = tabs.getByRole("tab", { name: "Evidence" });
    const traceTab = tabs.getByRole("tab", { name: "Trace" });
    const chatPanel = page.getByRole("tabpanel", { name: "Chat" });
    const evidencePanel = page.getByRole("tabpanel", { name: "Evidence", includeHidden: true });
    const tracePanel = page.getByRole("tabpanel", { name: "Trace", includeHidden: true });

    await expect(chatTab).toHaveAttribute("aria-selected", "true");
    await expect(chatPanel).toBeVisible();
    await expect(evidencePanel).toBeHidden();
    await expect(tracePanel).toBeHidden();

    await chatTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
    await expect(evidenceTab).toBeFocused();
    await expect(evidencePanel).toBeVisible();
    await expect(evidencePanel.getByRole("heading", { name: "Evidence will appear here" })).toBeVisible();
    await expect(chatPanel).toBeHidden();

    await traceTab.click();
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await expect(tracePanel).toBeVisible();
    await expect(tracePanel.getByRole("heading", { name: "Trace unavailable" })).toBeVisible();
    await expect(evidencePanel).toBeHidden();

    await chatTab.click();
    await expect(chatPanel).toBeVisible();
  });

  test("keeps the approved two-row tablet workspace at 820px", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/");

    await expect(page.getByRole("tablist", { name: "Clinical workspace panels" })).toBeHidden();
    const chatPanel = page.getByRole("tabpanel", { name: "Chat" });
    const evidencePanel = page.getByRole("tabpanel", { name: "Evidence" });
    const tracePanel = page.getByRole("tabpanel", { name: "Trace" });
    await expect(chatPanel).toBeVisible();
    await expect(evidencePanel).toBeVisible();
    await expect(tracePanel).toBeVisible();

    const [chatBox, evidenceBox, traceBox] = await Promise.all([
      chatPanel.boundingBox(),
      evidencePanel.boundingBox(),
      tracePanel.boundingBox(),
    ]);
    expect(chatBox).not.toBeNull();
    expect(evidenceBox).not.toBeNull();
    expect(traceBox).not.toBeNull();
    if (!chatBox || !evidenceBox || !traceBox) throw new Error("Tablet panels must have layout boxes");
    expect(chatBox.width).toBeGreaterThan(760);
    expect(evidenceBox.y).toBeGreaterThan(chatBox.y + chatBox.height - 2);
    expect(Math.abs(evidenceBox.y - traceBox.y)).toBeLessThan(2);
    expect(evidenceBox.x).toBeLessThan(traceBox.x);
  });

  test("exposes landmarks and supports a keyboard-only path into demo mode", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Clinical decisions/ })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Evidence" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "Trace" })).toBeVisible();
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
