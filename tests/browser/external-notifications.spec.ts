// Intercepted Auth/API fixtures only. No operational persistence or provider sends.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn } from "./helpers";
import type { ExternalNotificationSettings } from "../../apps/web/components/external-notifications-types";
const orderId = "51290d81-c774-4ec4-a6eb-e428fc9c605a";
const base = "/machines/WH-C/notification-settings";
type TestRole = ExternalNotificationSettings["role"];
const initial = (
  role: TestRole = "TECHNICIAN",
): ExternalNotificationSettings => ({
  supported: ["TECHNICIAN", "MAINTENANCE_HEAD"].includes(role),
  configured: true,
  role,
  preference: {
    enabled: false,
    version: 0,
    destination: null,
    enabledAt: null,
    verifiedAt: null,
  },
  deliveries: [],
});
async function fixture(page: Page, role: TestRole = "TECHNICIAN") {
  await setup(page, role);
  const state = {
    data: initial(role),
    listStatus: 200,
    saveStatus: 200,
    gets: 0,
    bodies: [] as { enabled: boolean; version: number; requestId: string }[],
    headers: [] as string[],
  };
  await page.route(
    "**/api/machines/WH-C/external-notifications**",
    async (route) => {
      if (route.request().method() !== "PUT") {
        state.gets++;
        await route.fulfill({
          status: state.listStatus,
          json:
            state.listStatus === 200
              ? state.data
              : { message: "Email status is unavailable." },
        });
        return;
      }
      state.headers.push(route.request().headers()["content-type"] ?? "");
      const body = route.request().postDataJSON();
      state.bodies.push(body);
      if (state.saveStatus !== 200) {
        await route.fulfill({
          status: state.saveStatus,
          json: {
            message:
              state.saveStatus === 409
                ? "Email settings changed. Refresh and try again."
                : state.saveStatus === 403
                  ? "Confirm your account email before enabling."
                  : "Email settings could not be saved.",
          },
        });
        return;
      }
      state.data.preference = {
        enabled: body.enabled,
        version: body.version + 1,
        destination: body.enabled ? "confirmed@example.test" : null,
        enabledAt: body.enabled ? "2026-10-27T04:30:15Z" : null,
        verifiedAt: body.enabled ? "2026-10-27T04:30:15Z" : null,
      };
      await route.fulfill({ json: state.data });
    },
  );
  await signIn(page);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Email handoffs", exact: true }),
  ).toBeVisible();
  // Wait for the initial settings request before tests change the mock response.
  // The page heading appears before that request has completed.
  if (state.data.supported) {
    await page
      .getByRole("button", { name: "Edit email preference", exact: true })
      .click();
    await expect(checkbox(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh email status" }),
    ).toBeEnabled();
  }
  return state;
}
const checkbox = (page: Page) =>
  page.getByLabel("Email actionable handoffs in this role", { exact: true });

async function refreshSettings(page: Page, expires = false) {
  const popup = page.getByRole("dialog", {
    name: "Email handoff preference",
    exact: true,
  });
  const reopen = await popup.isVisible();
  if (reopen)
    await popup
      .getByRole("button", { name: "Close form", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Refresh email status", exact: true })
    .click();
  if (expires) return;
  await expect(
    page.getByRole("button", { name: "Refresh email status", exact: true }),
  ).toBeEnabled();
  if (
    reopen &&
    (await page
      .getByRole("button", { name: "Edit email preference", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Edit email preference", exact: true })
      .click();
}

test("email opt-in saves strict JSON and displays only server-verified own destination and IST cutoff", async ({
  page,
}, testInfo) => {
  const s = await fixture(page);
  await expect(checkbox(page)).not.toBeChecked();
  await checkbox(page).check();
  await page.getByRole("button", { name: "Save and verify email" }).click();
  await expect(
    page.getByText("Email handoffs enabled for this role.", { exact: false }),
  ).toBeVisible();
  expect(s.headers).toEqual(["application/json"]);
  expect(Object.keys(s.bodies[0]).sort()).toEqual([
    "enabled",
    "requestId",
    "version",
  ]);
  expect(s.bodies[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    page.getByText("confirmed@example.test", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/New events after:.*10:00:15 am IST/i),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("external-email-enabled.png"),
    fullPage: true,
  });
  if (
    !(await page
      .getByRole("dialog", { name: "Email handoff preference", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Edit email preference", exact: true })
      .click();
  await checkbox(page).uncheck();
  await page
    .getByRole("button", { name: "Save preference", exact: true })
    .click();
  await expect(
    page.getByText("Email handoffs disabled for this role."),
  ).toBeVisible();
  expect(s.bodies[1].enabled).toBe(false);
  expect(s.bodies[1].version).toBe(1);
});
test("missing provider setup explains disabled state without enabling email", async ({
  page,
}) => {
  const s = await fixture(page);
  s.data.configured = false;
  await refreshSettings(page);
  await expect(page.getByText(/Email sending is not configured/)).toBeVisible();
  await expect(checkbox(page)).toBeDisabled();
  expect(s.bodies).toHaveLength(0);
});
test("saved enabled preference can be disabled even when provider configuration is missing", async ({
  page,
}) => {
  const s = await fixture(page);
  s.data.configured = false;
  s.data.preference.enabled = true;
  s.data.preference.version = 1;
  s.data.preference.destination = "confirmed@example.test";
  await refreshSettings(page);
  await expect(checkbox(page)).toBeChecked();
  if (
    !(await page
      .getByRole("dialog", { name: "Email handoff preference", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "Edit email preference", exact: true })
      .click();
  await checkbox(page).uncheck();
  await page
    .getByRole("button", { name: "Save preference", exact: true })
    .click();
  await expect(
    page.getByText("Email handoffs disabled for this role."),
  ).toBeVisible();
});
for (const role of [
  "OPERATOR",
  "SUPERVISOR",
  "MANAGEMENT",
  "ADMINISTRATOR",
] as const)
  test(`${role} receives clear unsupported behavior and no engineering email controls`, async ({
    page,
  }) => {
    const s = await fixture(page, role);
    await expect(
      page.getByRole("heading", {
        name: "Email handoffs are unavailable in this role",
      }),
    ).toBeVisible();
    await expect(checkbox(page)).toHaveCount(0);
    expect(s.bodies).toHaveLength(0);
  });
test("Maintenance head can independently opt in in its trusted active view", async ({
  page,
}) => {
  const s = await fixture(page, "MAINTENANCE_HEAD");
  await checkbox(page).check();
  await page.getByRole("button", { name: "Save and verify email" }).click();
  await expect(
    page.getByText(/Email handoffs enabled for this role/),
  ).toBeVisible();
  expect(s.bodies[0].enabled).toBe(true);
});
test("failed save retries the exact request body and disables editing until resolved", async ({
  page,
}) => {
  const s = await fixture(page);
  s.saveStatus = 503;
  await checkbox(page).check();
  await page.getByRole("button", { name: "Save and verify email" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not be saved" }),
  ).toBeVisible();
  await expect(checkbox(page)).toBeDisabled();
  s.saveStatus = 200;
  await page.getByRole("button", { name: "Retry same save" }).click();
  await expect(
    page.getByText(/Email handoffs enabled for this role/),
  ).toBeVisible();
  expect(s.bodies[1]).toEqual(s.bodies[0]);
});
test("conflict requires refresh before editing and never silently resubmits stale version", async ({
  page,
}) => {
  const s = await fixture(page);
  s.saveStatus = 409;
  await checkbox(page).check();
  await page.getByRole("button", { name: "Save and verify email" }).click();
  await expect(
    page.getByText(
      "Close this form and refresh the settings before saving again.",
    ),
  ).toBeVisible();
  await expect(checkbox(page)).toBeDisabled();
  s.saveStatus = 200;
  s.data.preference.version = 2;
  await refreshSettings(page);
  await expect(checkbox(page)).toBeEnabled();
  expect(s.bodies).toHaveLength(1);
});
test("list failure retains error and explicit refresh recovers", async ({
  page,
}) => {
  const s = await fixture(page);
  s.listStatus = 503;
  await refreshSettings(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "unavailable" }),
  ).toBeVisible();
  await expect(checkbox(page)).toBeDisabled();
  s.listStatus = 200;
  await refreshSettings(page);
  await expect(checkbox(page)).toBeEnabled();
});
test("unconfirmed/revoked access clears saved destination and controls", async ({
  page,
}) => {
  const s = await fixture(page);
  s.data.preference.destination = "confirmed@example.test";
  await refreshSettings(page);
  await expect(
    page.getByText("confirmed@example.test", { exact: false }),
  ).toBeVisible();
  s.saveStatus = 403;
  await checkbox(page).check();
  await page.getByRole("button", { name: "Save and verify email" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Confirm your account email" }),
  ).toBeVisible();
  await expect(
    page.getByText("confirmed@example.test", { exact: false }),
  ).toHaveCount(0);
  await expect(checkbox(page)).toHaveCount(0);
});
test("session expiry returns to login without writing a preference", async ({
  page,
}) => {
  const s = await fixture(page);
  s.listStatus = 401;
  await refreshSettings(page, true);
  await expect(page).toHaveURL(/\/login\?reason=expired/);
  expect(s.bodies).toHaveLength(0);
});
test("delivery history distinguishes accepted, retry, terminal and late outcomes and links source", async ({
  page,
}) => {
  const s = await fixture(page);
  s.data.deliveries = ["SENT", "PENDING", "FAILED", "SUPPRESSED"].map(
    (status, i) => ({
      id: `${i}`,
      eventId: `${i}`,
      orderId,
      action: "ASSIGN",
      eventAt: "2026-10-27T04:30:15Z",
      status: status as "SENT",
      attemptCount: i + 1,
      code: [
        "ACCEPTED",
        "RATE_LIMITED",
        "ATTEMPTS_EXHAUSTED",
        "STALE_OR_DISABLED",
      ][i],
      createdAt: "2026-10-27T04:30:15Z",
      updatedAt: "2026-10-27T04:31:15Z",
      nextAttemptAt: i === 1 ? "2026-10-27T04:32:15Z" : null,
      attempts: [
        {
          id: `a${i}`,
          attempt: 1,
          status: "SENT",
          code: "ACCEPTED",
          at: "2026-10-27T04:31:15Z",
          late: i === 3,
        },
      ],
    }),
  );
  await refreshSettings(page);
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByText("Accepted by email provider", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Provider rate limit/)).toBeVisible();
  await expect(page.getByText(/Retry limit reached/)).toBeVisible();
  await expect(
    page.getByText(/Next automatic attempt:.*10:02:15 am IST/i),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Work order 51290d81/ }).first(),
  ).toHaveAttribute("href", `/machines/WH-C/work-orders/${orderId}`);
  await page.getByText("Attempt history", { exact: true }).last().click();
  await expect(
    page.getByText(/result arrived after cancellation or lease change/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /resend|retry delivery/i }),
  ).toHaveCount(0);
});
test("editing an unsaved preference never writes preferences or in-app read receipts", async ({
  page,
}) => {
  const s = await fixture(page);
  let receiptWrites = 0;
  await page.route(
    "**/api/machines/WH-C/work-order-notifications/*/read",
    async (route) => {
      receiptWrites++;
      await route.fulfill({ json: {} });
    },
  );
  await checkbox(page).check();
  await page.waitForTimeout(80);
  expect(s.bodies).toHaveLength(0);
  expect(receiptWrites).toBe(0);
  await expect(checkbox(page)).toBeChecked();
});
test("settings remain usable without horizontal overflow at narrow viewport", async ({
  page,
}, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(checkbox(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
  await checkbox(page).focus();
  await page.keyboard.press("Space");
  await expect(checkbox(page)).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath("external-email-settings.png"),
    fullPage: true,
  });
});
