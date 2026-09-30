import { expect, test, type Page } from "@playwright/test";

const password = process.env.SMOKE_PASSWORD;
const smokeSuffix = process.env.SMOKE_SUFFIX;
if (!password) throw new Error("SMOKE_PASSWORD is required for browser tests");

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Organization code").fill("smoke-a");
  await page.getByLabel("Work email").fill("admin-a@example.test");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Clarity for every review" }),
  ).toBeVisible();
}

test("signed-in admin can navigate workspaces and download a scoped data copy", async ({
  page,
}) => {
  await signIn(page);
  await page.screenshot({
    path: test.info().outputPath("desktop-overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open review →" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Review conflicts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review discussion" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to overview" }).click();
  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create goal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trends", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Longitudinal scores", level: 2 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Role models" }).click();
  await expect(
    page.getByRole("heading", { name: "Model evidence dossier" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reports" }).click();
  await expect(
    page.getByRole("heading", { name: "Evaluation register" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download my data" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "my-performance-data.json",
  );
});

test("binary proportion metric and counted evidence can be entered in the workspace", async ({
  page,
}) => {
  await signIn(page);
  const personResponse = await page.request.post("/api/v1/people", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: "E2E Proportion Employee",
      email: `e2e-proportion-${Date.now()}@example.test`,
      password,
      role: "EMPLOYEE",
    },
  });
  expect(personResponse.ok()).toBe(true);
  const employee = (await personResponse.json()) as { id: string };
  await page.reload();
  await page.getByRole("button", { name: "Role models" }).click();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create metric" }),
  });
  const code = `e2e-proportion-${Date.now()}`;
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Name").fill("Accepted binary units");
  await form.getByLabel("Construct measured").fill("Conformance");
  await form.getByLabel("Unit").fill("%");
  await form.getByLabel("Measurement type").selectOption("BINOMIAL_PROPORTION");
  await form
    .getByLabel("Business and measurement rationale")
    .fill("Synthetic inspection trial");
  await form
    .getByLabel("Known limitations")
    .fill("Independent trial assumption is unverified");
  await form.getByLabel("Controllability").selectOption("PARTIAL");
  await form.getByRole("button", { name: "Create metric" }).click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  const observation = page.locator("form").filter({
    has: page.getByRole("button", { name: "Submit evidence" }),
  });
  await observation.getByLabel("Employee").selectOption(employee.id);
  await observation
    .getByLabel("Metric")
    .selectOption({ label: "Accepted binary units" });
  await observation.getByLabel("Observed at").fill("2026-09-15T12:00");
  await observation.getByLabel("Value (for observed / zero)").fill("100");
  await observation.getByLabel("Numerator (optional count)").fill("3");
  await observation.getByLabel("Denominator (optional count)").fill("3");
  await observation.getByLabel("Source").fill("Synthetic inspection log");
  await observation.getByRole("button", { name: "Submit evidence" }).click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page.getByLabel("Show evidence for").selectOption(employee.id);
  await expect(page.getByText(/Count: 3.*\/3/)).toBeVisible();
});

test("dated organization unit and employee assignment can be created in the workspace", async ({
  page,
}) => {
  await signIn(page);
  const personResponse = await page.request.post("/api/v1/people", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: "E2E Organization Employee",
      email: `e2e-organization-${Date.now()}@example.test`,
      password,
      role: "EMPLOYEE",
    },
  });
  expect(personResponse.ok()).toBe(true);
  const employee = (await personResponse.json()) as { id: string };
  await page.reload();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  const unitForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create unit" }),
  });
  const code = `E2E-ORG-${Date.now()}`;
  await unitForm.getByLabel("Code").fill(code);
  await unitForm.getByLabel("Name").fill("E2E inspection team");
  await unitForm.getByLabel("Unit type").selectOption("TEAM");
  await unitForm.getByLabel("Effective from").fill("2026-01-01");
  await unitForm.getByRole("button", { name: "Create unit" }).click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  const assignmentForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create assignment" }),
  });
  await assignmentForm.getByLabel("Employee").selectOption(employee.id);
  const unitId = await assignmentForm
    .locator('select[name="unitId"] option')
    .filter({ hasText: code })
    .getAttribute("value");
  expect(unitId).not.toBeNull();
  await assignmentForm.locator('select[name="unitId"]').selectOption(unitId!);
  await assignmentForm.getByLabel("Assignment role").selectOption("PRIMARY");
  await assignmentForm.getByLabel("Effective from").fill("2026-01-01");
  await assignmentForm
    .getByLabel("Reason")
    .fill("Synthetic E2E organization assignment");
  await assignmentForm
    .getByRole("button", { name: "Create assignment" })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: "Assignment history" }) })
    .locator("select")
    .selectOption(employee.id);
  await expect(page.getByText("E2E inspection team").last()).toBeVisible();
});

test("goal creation, check-in, and prospective revision work through the UI", async ({
  page,
}) => {
  await signIn(page);
  const cycleResponse = await page.request.post("/api/v1/cycles", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: `E2E goal cycle ${Date.now()}`,
      startsOn: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      endsOn: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      purpose: "DEVELOPMENT",
    },
  });
  expect(cycleResponse.ok()).toBe(true);
  const cycle = (await cycleResponse.json()) as { id: string };
  const personResponse = await page.request.post("/api/v1/people", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      name: "E2E Goal Employee",
      email: `e2e-goal-${Date.now()}@example.test`,
      password,
      role: "EMPLOYEE",
    },
  });
  expect(personResponse.ok()).toBe(true);
  const person = (await personResponse.json()) as { id: string };
  await page.reload();
  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await page.getByLabel("Employee").selectOption(person.id);
  await page.getByLabel("Review cycle").selectOption(cycle.id);
  await page.getByLabel("Goal type").selectOption("LEARNING");
  const description = `E2E documented training goal ${Date.now()}`;
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Baseline").fill("Training has not yet begun");
  await page
    .getByLabel("Threshold")
    .fill("Attend a documented training session");
  await page
    .getByLabel("Target", { exact: true })
    .fill("Pass the documented assessment");
  await page.getByLabel("Stretch").fill("Coach a peer on one documented task");
  await page
    .getByLabel("Due date")
    .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await page
    .getByLabel("Reason for this version")
    .fill("Agreed E2E learning objective for this review cycle");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByText(description).first()).toBeVisible();
  await page
    .getByLabel("Progress")
    .fill("I completed the first documented training session");
  await page.getByLabel("Next action").fill("Take the role assessment");
  await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(
    page.getByText("I completed the first documented training session"),
  ).toBeVisible();
  const revision = page.locator("form").filter({
    has: page.getByRole("heading", {
      name: "Schedule a prospective revision",
    }),
  });
  await revision
    .getByLabel("Effective date and time")
    .fill(new Date(Date.now() + 24 * 3600000).toISOString().slice(0, 16));
  await revision
    .getByLabel("Target", { exact: true })
    .fill("Pass the revised documented assessment");
  await revision
    .getByLabel("Reason for this version")
    .fill("Training provider revised the assessment prospectively");
  await revision.getByRole("button", { name: "Schedule revision" }).click();
  await expect(page.getByText(/v2 · effective/)).toBeVisible();
  await page.getByRole("button", { name: "Development", exact: true }).click();
  await page.locator("label.filter-label select").selectOption(person.id);
  await page.getByLabel("Development cycle").selectOption(cycle.id);
  const gap = `E2E gap in documented safety procedure ${Date.now()}`;
  await page.getByLabel("Competency gap").fill(gap);
  await page.getByLabel("Current level").fill("Can describe the procedure");
  await page.getByLabel("Target level").fill("Can demonstrate independently");
  await page
    .getByLabel("Development activity")
    .fill("Practice the documented procedure with a supervisor");
  await page
    .getByLabel("Due date")
    .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create action" }).click();
  await expect(page.getByText(gap).first()).toBeVisible();
  await page
    .getByLabel("Note")
    .fill("Employee completed the first practice session");
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(
    page.getByText("Employee completed the first practice session"),
  ).toBeVisible();
  await page.getByLabel("Update type").selectOption("COMPLETED");
  await page
    .getByLabel("Note")
    .fill("Supervisor observed the target capability");
  await page
    .getByLabel("Evidence reference (required for completion)")
    .fill("E2E training record");
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(
    page.getByText("Supervisor observed the target capability"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.locator("label.filter-label select").selectOption(person.id);
  await page.getByLabel("Review cycle").selectOption(cycle.id);
  const contextDescription = `E2E temporary loss of equipment access ${Date.now()}`;
  await page.getByLabel("Factual description").fill(contextDescription);
  await page
    .getByLabel("Effect on the work")
    .fill("Reduced practice opportunity during the cycle");
  await page
    .getByLabel("Evidence reference")
    .fill("E2E equipment availability log");
  await page.getByRole("button", { name: "Submit context" }).click();
  await expect(page.getByText(contextDescription).first()).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("desktop-goal.png"),
    fullPage: true,
  });
});

test("mobile navigation and goal view fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "Goals", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create goal" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: test.info().outputPath("mobile-goals.png"),
    fullPage: true,
  });
});

test("improvement plan history is visible to the employee", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const reportResponse = await page.request.get("/api/v1/reports/evaluations");
  expect(reportResponse.ok()).toBe(true);
  const report = (await reportResponse.json()) as {
    rows: { employee_id: string; purpose: string; status: string }[];
  };
  const catalogResponse = await page.request.get("/api/v1/catalog");
  expect(catalogResponse.ok()).toBe(true);
  const catalog = (await catalogResponse.json()) as {
    users: { id: string; email: string }[];
  };
  const currentEmployeeId = smokeSuffix
    ? catalog.users.find(
        (user) => user.email === `employee-${smokeSuffix}@example.test`,
      )?.id
    : undefined;
  if (smokeSuffix) expect(currentEmployeeId).toBeTruthy();
  let employeeId = "";
  let planId = "";
  for (const row of report.rows.filter(
    (item) =>
      item.purpose === "ADMINISTRATIVE" &&
      (!currentEmployeeId || item.employee_id === currentEmployeeId) &&
      ["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(item.status),
  )) {
    const response = await page.request.get(
      `/api/v1/people/${row.employee_id}/improvement-plans`,
    );
    if (!response.ok()) continue;
    const data = (await response.json()) as {
      plans: { id: string; status: string }[];
    };
    const closed = data.plans.find((item) => item.status === "CLOSED");
    if (closed) {
      const contextResponse = await page.request.get(
        `/api/v1/people/${row.employee_id}/context`,
      );
      if (!contextResponse.ok()) continue;
      const context = (await contextResponse.json()) as {
        records: { description: string }[];
      };
      if (
        !context.records.some(
          (item) =>
            item.description ===
            "Machine availability reduced eligible production opportunities",
        )
      )
        continue;
      employeeId = row.employee_id;
      planId = closed.id;
      break;
    }
  }
  expect(
    planId,
    "Run the HTTP smoke fixture before the browser suite",
  ).not.toBe("");
  await page.getByRole("button", { name: "Improvement plans" }).click();
  await page.locator("label.filter-label select").selectOption(employeeId);
  await expect(
    page.getByRole("heading", { name: "Draft improvement plan" }),
  ).toBeVisible();
  const row = page
    .locator("tr")
    .filter({
      has: page.getByText("Documented shortfall in a role-specific task"),
    })
    .first();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(
    page.getByText("Independent review accepted the additional record"),
  ).toBeVisible();
  await expect(page.getByText("Initial decision:")).toBeVisible();
  await page.getByRole("button", { name: "Governance cases" }).click();
  await page.locator("label.filter-label select").selectOption(employeeId);
  await expect(
    page
      .getByText("Synthetic severe safety event needing independent review")
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(
    page.getByText("Independent reviewer confirmed documented remediation"),
  ).toBeVisible();
  const email = catalog.users.find((user) => user.id === employeeId)?.email;
  expect(email).toBeTruthy();
  const employeePage = await browser.newPage();
  try {
    await employeePage.goto("/login");
    await employeePage.getByLabel("Organization code").fill("smoke-a");
    await employeePage.getByLabel("Work email").fill(email!);
    await employeePage.getByLabel("Password").fill(password!);
    await employeePage.getByRole("button", { name: "Sign in" }).click();
    await employeePage
      .getByRole("button", { name: "Improvement plans" })
      .click();
    await expect(
      employeePage
        .getByText("Documented shortfall in a role-specific task")
        .first(),
    ).toBeVisible();
    await employeePage.getByRole("button", { name: "Open" }).first().click();
    await expect(
      employeePage.getByText(
        "Independent review accepted the additional record",
      ),
    ).toBeVisible();
    await employeePage
      .getByRole("button", { name: "Governance cases" })
      .click();
    await expect(
      employeePage
        .getByText("Synthetic severe safety event needing independent review")
        .first(),
    ).toBeVisible();
    await employeePage
      .getByRole("button", { name: "Context", exact: true })
      .click();
    await expect(
      employeePage
        .getByText(
          "Machine availability reduced eligible production opportunities",
        )
        .first(),
    ).toBeVisible();
    await employeePage
      .getByRole("button", { name: "Trends", exact: true })
      .click();
    await expect(
      employeePage.getByText("Insufficient comparable history").first(),
    ).toBeVisible();
  } finally {
    await employeePage.close();
  }
});

test("login form works with keyboard input", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Organization code").focus();
  await page.keyboard.type("smoke-a");
  await page.keyboard.press("Tab");
  await page.keyboard.type("admin-a@example.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type(password!);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Clarity for every review" }),
  ).toBeVisible();
});
