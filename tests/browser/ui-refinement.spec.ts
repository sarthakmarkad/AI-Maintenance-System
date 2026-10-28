import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
const base = "/machines/WH-C/work-orders";
const ids = [
  "c25dfdba-fb43-47d5-8055-34d10a22834a",
  "c25dfdba-fb43-47d5-8055-34d10a22834b",
  "c25dfdba-fb43-47d5-8055-34d10a22834c",
];
function item(index: number) {
  return {
    id: ids[index],
    kind: "BREAKDOWN",
    title: [
      "TEST pressure inspection",
      "TEST heater check",
      "TEST second-page motor check",
    ][index],
    status: "REPORTED",
    version: 1,
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedAt: "2026-10-01T00:00:00Z",
    reporter: { userId, displayName: "TEST operator" },
    technician: index === 1 ? { userId, displayName: "TEST Taylor" } : null,
    allowedActions: [],
  };
}
async function open(page: Page, role = "OPERATOR") {
  await setup(page, role);
  const requests: { method: string; url: string }[] = [];
  await page.route("**/api/machines/WH-C/work-orders?**", async (route) => {
    requests.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    const after = new URL(route.request().url()).searchParams.get("after");
    await route.fulfill({
      json: {
        items: after ? [item(2)] : [item(0), item(1)],
        total: 100,
        counts: { REPORTED: 80, CLOSED: 20 },
        nextCursor: after ? null : ids[1],
      },
    });
  });
  await signIn(page);
  await page.goto(base);
  await expect(
    page.getByRole("heading", {
      name: "Breakdowns & work orders",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".work-order-card")).toHaveCount(2);
  return requests;
}
test("page finder supports keyboard selection, aliases and focus return", async ({
  page,
}) => {
  await open(page);
  await page.screenshot({
    path: `test-results/ui-work-orders-${test.info().project.name}.png`,
    fullPage: true,
  });
  const trigger = page.getByRole("button", {
    name: "Find a page",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Find a page", exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox", {
    name: "Search workspace pages",
    exact: true,
  });
  await expect(input).toBeFocused();
  await page.screenshot({
    path: `test-results/ui-page-finder-${test.info().project.name}.png`,
  });
  await input.fill("procedure");
  await expect(
    dialog.getByRole("option", { name: /Manuals & SOPs/ }),
  ).toBeVisible();
  await input.fill("zz-no-page");
  await expect(
    dialog.getByText("No pages found.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await input.fill("Asset registry");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/machines$/);
  await expect(
    page.getByRole("heading", { name: "Asset registry", exact: true }),
  ).toBeVisible();
});
test("dialog traps focus and closing never changes an unfinished issue draft", async ({
  page,
}) => {
  await open(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(":4400/api/") && request.method() !== "GET")
      writes.push(request.url());
  });
  await page
    .getByRole("button", { name: "Report an issue", exact: true })
    .click();
  const title = page.getByLabel("Issue title", { exact: true });
  await title.fill("TEST preserve this draft");
  await page.keyboard.press("Control+k");
  const formDialog = page.getByRole("dialog", {
    name: "Report a breakdown or issue",
    exact: true,
  });
  await expect(formDialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Find a page", exact: true }),
  ).toHaveCount(0);
  await expect(title).toHaveValue("TEST preserve this draft");
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  await page.getByRole("button", { name: "Find a page", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]')),
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Close page finder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Report an issue", exact: true })
    .click();
  await expect(title).toHaveValue("TEST preserve this draft");
  expect(writes).toEqual([]);
});
for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "MAINTENANCE_HEAD",
  "ADMINISTRATOR",
]) {
  test(`${role} page finder uses only the current role's navigation destinations`, async ({
    page,
  }) => {
    await open(page, role);
    await page
      .getByRole("button", { name: "Find a page", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Find a page",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Search workspace pages", exact: true })
      .fill("email");
    await expect(
      dialog.getByRole("option", { name: /Email alerts/ }),
    ).toHaveCount(["TECHNICIAN", "MAINTENANCE_HEAD"].includes(role) ? 1 : 0);
    await page.keyboard.press("Escape");
  });
}
test("work-order search matches loaded titles, references and technicians and preserves totals/paging", async ({
  page,
}) => {
  const requests = await open(page);
  const input = page.getByRole("searchbox", {
    name: "Search loaded work orders",
    exact: true,
  });
  for (const query of ["HEATER", "TEST Taylor", "WO-C25DFDBA"]) {
    await input.fill(query);
    await expect(page.locator(".work-order-card")).toHaveCount(
      query.startsWith("WO-") ? 2 : 1,
    );
  }
  await expect(
    page.getByText("100 total work orders on WH-C", { exact: true }),
  ).toBeVisible();
  await input.fill("second-page");
  await expect(
    page.getByRole("heading", {
      name: "No matching loaded work orders",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Search covers the 2 loaded orders/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more work orders", exact: true })
    .click();
  await expect(page.locator(".work-order-card")).toHaveCount(1);
  await expect(page.locator(".work-order-card")).toContainText(
    "TEST second-page motor check",
  );
  await expect(input).toHaveValue("second-page");
  await expect(
    page.getByText(/Search covers the 3 loaded orders/),
  ).toBeVisible();
  await input.fill("absent record");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".work-order-card")).toHaveCount(3);
  // Development StrictMode can issue an initial GET that is then aborted.
  expect(new Set(requests.map((request) => request.url)).size).toBe(2);
  expect(
    requests.every(
      (request) =>
        request.method === "GET" &&
        !new URL(request.url).searchParams.has("search"),
    ),
  ).toBe(true);
});
test("refined toolbar and page finder fit narrow viewports and use visible controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page, "MAINTENANCE_HEAD");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const statusBounds = await page
    .getByRole("combobox", { name: "Workflow status", exact: true })
    .boundingBox();
  const totalsBounds = await page
    .getByText("100 total work orders on WH-C", { exact: true })
    .boundingBox();
  expect(totalsBounds!.y).toBeGreaterThanOrEqual(
    statusBounds!.y + statusBounds!.height,
  );
  await page.screenshot({
    path: `test-results/refined-work-orders-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Find a page", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Find a page", exact: true });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: `test-results/page-finder-${test.info().project.name}.png`,
  });
  await page.keyboard.press("Escape");
});
