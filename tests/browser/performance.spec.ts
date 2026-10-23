import { test, expect, type Page } from "@playwright/test";
import { setup, signIn } from "./helpers";
const orderId = "c25dfdba-fb43-47d5-8055-34d10a22834a";
const counts = (keys: string[], values: number[]) =>
  keys.map((key, i) => ({ key, count: values[i] ?? 0 }));
const statuses = [
  "REPORTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_REVIEW",
  "APPROVED",
  "CLOSED",
];
function fixture(role: string, kind: string | null = null) {
  const selected = kind === "INVESTIGATION";
  return {
    policyVersion: "maintenance-workflow-v1",
    timezone: "Asia/Kolkata",
    from: "2026-09-01",
    to: "2026-09-02",
    kind,
    generatedAt: "2026-10-22T08:00:00Z",
    cohort: {
      total: selected ? 1 : 3,
      statuses: counts(
        statuses,
        selected ? [0, 0, 0, 1, 0, 0] : [0, 1, 0, 1, 0, 1],
      ),
      kinds: counts(
        ["BREAKDOWN", "PLANNED", "INVESTIGATION"],
        selected ? [0, 0, 1] : [2, 0, 1],
      ),
    },
    closedInRange: selected ? 0 : 2,
    current: {
      total: selected ? 1 : 5,
      statuses: counts(statuses.slice(0, 5), [1, 1, 1, 1, 1]),
      oldestAgeHours: 300,
      myOpen: role === "TECHNICIAN" ? 2 : null,
      overduePlanned: selected ? null : 3,
      items: [
        {
          id: orderId,
          title: "TEST older inspection",
          kind: "BREAKDOWN",
          status: "ASSIGNED",
          reportedAt: "2026-08-01T00:00:00Z",
          ageHours: 300,
          technicianName: "TEST technician",
        },
      ],
    },
    activity: [
      { date: "2026-09-01", created: 2, closed: 2 },
      { date: "2026-09-02", created: 1, closed: 0 },
    ],
    planned: {
      applicable: !selected,
      due: 3,
      skipped: 1,
      eligible: 2,
      completed: 1,
      onTime: 0,
      late: 1,
      open: 1,
      completionPercent: 50,
      onTimePercent: 0,
      scheduling: {
        lastJobAt: "2026-10-22T07:59:00Z",
        failed: false,
        catchingUp: false,
      },
    },
    investigations: {
      total: 1,
      unsubmitted: 0,
      legacyUnrecorded: 0,
      outcomes: [
        { key: "INCONCLUSIVE", count: 1, approvedOrClosed: 0 },
        { key: "SENSOR_CHECK_REQUIRED", count: 0, approvedOrClosed: 0 },
      ],
    },
  };
}
async function mocks(
  page: Page,
  options: {
    role?: string;
    outage?: boolean;
    expired?: boolean;
    forbidden?: boolean;
    scheduling?: boolean;
  } = {},
) {
  const role = options.role ?? "MANAGEMENT";
  await setup(page, role);
  let outage = !!options.outage,
    open = 5;
  const queries: URL[] = [];
  await page.route("**/api/machines/WH-C/performance**", async (route) => {
    const url = new URL(route.request().url());
    queries.push(url);
    expect(route.request().method()).toBe("GET");
    if (options.expired) {
      await route.fulfill({
        status: 401,
        json: { message: "Session expired" },
      });
      return;
    }
    if (options.forbidden) {
      await route.fulfill({
        status: 403,
        json: { message: "Your selected role is unavailable" },
      });
      return;
    }
    if (outage) {
      await route.fulfill({
        status: 503,
        json: { message: "TEST performance service temporarily unavailable" },
      });
      return;
    }
    const data = fixture(role, url.searchParams.get("kind"));
    if (url.searchParams.has("from")) {
      data.from = url.searchParams.get("from")!;
      data.to = url.searchParams.get("to")!;
    }
    if (!data.kind) data.current.total = open;
    if (options.scheduling) {
      data.planned.scheduling.catchingUp = true;
      Object.assign(data.planned, {
        completionPercent: null,
        onTimePercent: null,
      });
    }
    await route.fulfill({ json: data });
  });
  return {
    queries,
    recover: () => {
      outage = false;
    },
    changeOpen: (n: number) => {
      open = n;
    },
  };
}
async function openPage(page: Page) {
  await signIn(page);
  await page.goto("/machines/WH-C/performance");
  await expect(
    page.getByRole("heading", { name: "Maintenance performance", exact: true }),
  ).toBeVisible();
}
test("performance separates date cohort, current backlog, remaining metrics without removed sections", async ({
  page,
}) => {
  const state = await mocks(page);
  await openPage(page);
  const summary = page.locator(".performance-summary");
  await expect(
    summary.getByText("Orders created in range", { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText("Includes orders created before the selected dates", {
      exact: true,
    }),
  ).toBeVisible();
  const backlog = page.getByRole("region", {
    name: "Current maintenance backlog",
    exact: true,
  });
  await expect(
    backlog.getByText("TEST older inspection", { exact: true }),
  ).toBeVisible();
  await expect(
    backlog.getByRole("link", { name: "TEST older inspection", exact: true }),
  ).toHaveAttribute("href", new RegExp(orderId));
  await expect(
    page.getByRole("region", { name: "Workflow timing", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: "Equipment reliability data requirements",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByText("View daily activity table", { exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "2026-09-01", exact: true }),
  ).toBeVisible();
  await page.getByText("View daily activity table", { exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/performance-${test.info().project.name}.png`,
    fullPage: true,
  });
  state.changeOpen(3);
  await page
    .getByRole("button", { name: "Refresh performance", exact: true })
    .click();
  await expect(
    summary
      .locator("article")
      .filter({ hasText: "Current open work orders" })
      .locator("strong"),
  ).toHaveText("3");
});
test("date and type filters use server results and preserve older backlog visibility", async ({
  page,
}) => {
  const state = await mocks(page);
  await openPage(page);
  await page
    .getByLabel("Performance from date", { exact: true })
    .fill("2026-08-01");
  await page
    .getByLabel("Performance to date", { exact: true })
    .fill("2026-08-02");
  await page
    .getByLabel("Performance work type", { exact: true })
    .selectOption("INVESTIGATION");
  await page
    .getByRole("button", { name: "Apply performance filters", exact: true })
    .click();
  await expect(
    page.getByText("Planned maintenance is outside the selected work type.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.queries.at(-1)?.searchParams.get("kind")).toBe("INVESTIGATION");
  expect(state.queries.at(-1)?.searchParams.get("from")).toBe("2026-08-01");
  await page
    .getByLabel("Performance from date", { exact: true })
    .fill("2026-09-03");
  await page
    .getByLabel("Performance to date", { exact: true })
    .fill("2026-09-01");
  await page
    .getByRole("button", { name: "Apply performance filters", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose both IST dates" }),
  ).toBeVisible();
});
for (const [role, note] of [
  ["OPERATOR", "Report new observations"],
  ["TECHNICIAN", "Check your assigned open work"],
  ["MAINTENANCE_HEAD", "Identify unassigned work"],
  ["SUPERVISOR", "approved work awaiting closure"],
  ["MANAGEMENT", "Review workload"],
  ["ADMINISTRATOR", "Administrator view has no assignment"],
]) {
  test(`${role} receives scoped read-only performance guidance and existing-workflow links`, async ({
    page,
  }) => {
    await mocks(page, { role });
    await openPage(page);
    await expect(page.locator(".performance-role")).toContainText(note);
    await expect(
      page.getByRole("button", {
        name: /Assign technician|Approve repair|Submit investigation|Close work order/,
      }),
    ).toHaveCount(0);
    if (role === "TECHNICIAN")
      await expect(
        page.getByText("Assigned to you:", { exact: false }),
      ).toContainText("2");
    else
      await expect(
        page.getByText("Assigned to you:", { exact: false }),
      ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open work orders", exact: true }),
    ).toHaveAttribute("href", "/machines/WH-C/work-orders");
  });
}
test("service outage is explicit, retry recovers and incomplete scheduling suppresses percentages", async ({
  page,
}) => {
  const state = await mocks(page, { outage: true, scheduling: true });
  await openPage(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.locator(".performance-summary")).toHaveCount(0);
  state.recover();
  await page
    .getByRole("button", { name: "Retry performance", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Schedule coverage is incomplete" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Planned maintenance performance",
      exact: true,
    }),
  ).not.toContainText("50%");
});
test("revoked role hides metrics and expired authentication returns to sign-in", async ({
  page,
}) => {
  await mocks(page, { forbidden: true });
  await openPage(page);
  await expect(page.locator(".performance-error[role=alert]")).toContainText(
    "Your selected role is unavailable",
  );
  await expect(page.locator(".performance-summary")).toHaveCount(0);
  const other = await page.context().newPage();
  await mocks(other, { expired: true });
  await other.goto("/machines/WH-C/performance");
  await expect(other).toHaveURL(/\/login\?reason=expired$/);
  await other.close();
});
