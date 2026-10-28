import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, machine } from "./helpers";
const pump = {
  ...machine,
  id: "7cd287df-e54b-43a9-b8ba-48d6259696bb",
  code: "PUMP-01",
  name: "TEST coolant pump",
  manufacturer: null,
  version: 1,
};
const person = {
  membershipId: "af528d25-2130-40f7-8814-48d6259696bb",
  displayName: "TEST technician",
  roles: ["TECHNICIAN"],
  active: true,
  granted: false,
};
async function registry(page: Page, role = "ADMINISTRATOR") {
  await setup(page, role);
  await page.route("**/api/machines**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/machines/PUMP-01")
      return route.fulfill({ json: pump });
    if (url.pathname.endsWith("/work-order-notifications"))
      return route.fulfill({
        json: { items: [], unread: 0, nextCursor: null },
      });
    if (url.pathname === "/api/machines")
      return route.fulfill({
        json: { items: [machine, pump], nextCursor: null },
      });
    return route.fallback();
  });
}
test("administrator archives and restores a machine through the archived registry", async ({
  page,
}) => {
  await registry(page);
  let archived = false;
  let version = 1;
  await page.route("**/api/machines**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/lifecycle")) {
      const body = route.request().postDataJSON();
      expect(body.version).toBe(version);
      expect(body.reason).toContain("TEST");
      archived = body.archived;
      version++;
      return route.fulfill({
        status: 201,
        json: { version, alreadySaved: false },
      });
    }
    if (url.pathname === "/api/machines")
      return route.fulfill({
        json: {
          items:
            (url.searchParams.get("archived") === "true") === archived
              ? [
                  {
                    ...pump,
                    version,
                    archivedAt: archived ? "2026-10-28T08:00:00Z" : null,
                    archiveReason: archived ? "TEST retirement" : null,
                  },
                ]
              : [],
          nextCursor: null,
        },
      });
    return route.fallback();
  });
  await signIn(page);
  await page
    .getByRole("button", { name: "Archive machine", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Archive machine",
    exact: true,
  });
  await dialog.getByLabel("Reason").fill("TEST retirement");
  await page.screenshot({
    path: `.local/removal-machine-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Archive machine", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Show archived machines").check();
  await page
    .getByRole("button", { name: "Restore machine", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Restore machine", exact: true });
  await dialog.getByLabel("Reason").fill("TEST return to service");
  await dialog
    .getByRole("button", { name: "Confirm restore", exact: true })
    .click();
  await page.getByLabel("Show archived machines").uncheck();
  await expect(
    page.getByRole("button", { name: "Archive machine", exact: true }),
  ).toBeVisible();
  expect(archived).toBe(false);
});
test("administrator adds any supported code in a popup, retaining a closed draft and opening its machine", async ({
  page,
}) => {
  await registry(page);
  let body: any;
  await page.route("**/api/machines", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: { ...pump, code: body.code, name: body.name },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add machine", exact: true });
  await expect(dialog.getByLabel("Machine code")).toBeFocused();
  await dialog.getByLabel("Machine code").fill("pump-01");
  await dialog.getByLabel("Machine name").fill(pump.name);
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add machine", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  await expect(dialog.getByLabel("Machine code")).toHaveValue("pump-01");
  await page.screenshot({
    path: `.local/multi-machine/add-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Create machine workspace", exact: true })
    .click();
  await expect(page).toHaveURL(/\/machines\/PUMP-01$/);
  expect(body.code).toBe("PUMP-01");
  expect(body.manufacturer).toBeNull();
  expect(body.orgId).toBeUndefined();
  expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(
    page.getByRole("heading", { name: /PUMP-01.*TEST coolant pump/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Manage machine access" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "MAINTENANCE_HEAD",
  "SUPERVISOR",
  "MANAGEMENT",
])
  test(`${role} reads authorized machines without registry mutation controls`, async ({
    page,
  }) => {
    await registry(page, role);
    await signIn(page);
    await expect(
      page.getByRole("button", { name: "Add machine", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: /PUMP-01.*TEST coolant pump/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Manage machine access" }),
    ).toHaveCount(0);
  });
test("registry searches on the server, follows pagination and recovers from query errors", async ({
  page,
}) => {
  await registry(page);
  let fail = false;
  await page.route("**/api/machines*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/machines") return route.fallback();
    if (fail)
      return route.fulfill({
        status: 503,
        json: { message: "TEST registry unavailable" },
      });
    return route.fulfill({
      json:
        url.searchParams.get("q") === "pump" || url.searchParams.has("after")
          ? { items: [pump], nextCursor: null }
          : { items: [machine], nextCursor: machine.code },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Load more machines" }).click();
  await expect(
    page.getByRole("link", { name: /PUMP-01.*TEST coolant pump/ }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search machines" }).fill("pump");
  await expect(
    page.getByRole("link", { name: /WH-C.*Blown-film/ }),
  ).toHaveCount(0);
  await expect(page.getByText("1 machine shown")).toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "Refresh machines" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "TEST registry unavailable" }),
  ).toContainText("TEST registry unavailable");
  fail = false;
  await page.getByRole("button", { name: "Refresh machines" }).click();
  await expect(
    page.getByRole("link", { name: /PUMP-01.*TEST coolant pump/ }),
  ).toBeVisible();
});
test("machine access popup retains choices, saves exact grants and recovers from a stale version", async ({
  page,
}) => {
  await registry(page);
  let fail = true,
    version = 1;
  const bodies: any[] = [];
  await page.route("**/api/machines/PUMP-01/access*", async (route) => {
    if (route.request().method() === "PUT") {
      bodies.push(route.request().postDataJSON());
      if (fail)
        return route.fulfill({
          status: 409,
          json: {
            message:
              "Machine access changed. Reload the access list before saving.",
          },
        });
      return route.fulfill({
        json: { version: ++version, alreadySaved: false },
      });
    }
    return route.fulfill({
      json: { version, items: [person], nextCursor: null },
    });
  });
  await signIn(page);
  await page.getByRole("link", { name: /PUMP-01.*TEST coolant pump/ }).click();
  await expect(
    page.getByRole("heading", { name: /PUMP-01.*TEST coolant pump/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Manage machine access" }).click();
  const dialog = page.getByRole("dialog", { name: /Machine access/ });
  await dialog.getByRole("checkbox", { name: /TEST technician/ }).check();
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await page.getByRole("button", { name: "Manage machine access" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: /TEST technician/ }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Save access (1)", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Machine access changed",
  );
  await dialog
    .getByRole("button", { name: "Save access (1)", exact: true })
    .click();
  expect(bodies[0]).toEqual(bodies[1]);
  await dialog.getByRole("button", { name: "Reload access list" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: /TEST technician/ }),
  ).not.toBeChecked();
  fail = false;
  await dialog.getByRole("checkbox", { name: /TEST technician/ }).check();
  await page.screenshot({
    path: `.local/multi-machine/access-${test.info().project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save access (1)", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Machine access saved" }),
  ).toBeVisible();
  expect(bodies.at(-1).changes).toEqual([
    { membershipId: person.membershipId, granted: true },
  ]);
});
test("new machines show generic profile and both machine-specific data tabs", async ({
  page,
  isMobile,
}) => {
  await registry(page, "MAINTENANCE_HEAD");
  await signIn(page);
  await page.getByRole("link", { name: /PUMP-01.*TEST coolant pump/ }).click();
  await expect(
    page.getByRole("heading", { name: /PUMP-01.*TEST coolant pump/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Manufacturer not recorded").first(),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: /blown-film/ })).toHaveCount(0);
  if (isMobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("link", { name: "Production", exact: true }),
  ).toHaveAttribute("href", "/machines/PUMP-01/production");
  await expect(
    page.getByRole("link", { name: "Process trends", exact: true }),
  ).toHaveAttribute("href", "/machines/PUMP-01/readings");
  await expect(
    page.getByRole("link", { name: "Work orders", exact: true }),
  ).toHaveAttribute("href", "/machines/PUMP-01/work-orders");
});
test("failed registration preserves fields and retries one request without losing context", async ({
  page,
}) => {
  await registry(page);
  const bodies: any[] = [];
  await page.route("**/api/machines", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      json: { message: "TEST registration unavailable" },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Add machine", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add machine", exact: true });
  await dialog.getByLabel("Machine code").fill("PUMP-01");
  await dialog.getByLabel("Machine name").fill(pump.name);
  await dialog
    .getByRole("button", { name: "Create machine workspace", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "TEST registration unavailable",
  );
  await dialog
    .getByRole("button", { name: "Create machine workspace", exact: true })
    .click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).toEqual(bodies[1]);
  await expect(dialog.getByLabel("Machine name")).toHaveValue(pump.name);
});
