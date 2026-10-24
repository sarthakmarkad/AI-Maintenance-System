// Browser-only synthetic fixtures. Real authorization, scope, transactions and
// concurrency belong to notifications.integration.ts in the isolated *_test DB.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
import type { WorkOrderNotification } from "../../apps/web/components/work-order-notifications-types";
const orderId = "c25dfdba-fb43-47d5-8055-34d10a22834a";
const eventId = "a25dfdba-fb43-47d5-8055-34d10a22834a";
const item = (
  extra: Partial<WorkOrderNotification> = {},
): WorkOrderNotification => ({
  id: eventId,
  orderId,
  title: "TEST assigned inspection",
  kind: "BREAKDOWN",
  action: "ASSIGN",
  eventVersion: 2,
  actorName: "TEST maintenance head",
  message: "Assigned to you. Open the work order to start work.",
  createdAt: "2026-10-24T04:30:15.000Z",
  readAt: null,
  ...extra,
});
const order = {
  id: orderId,
  kind: "BREAKDOWN",
  title: "TEST assigned inspection",
  description: "Synthetic browser fixture, not a company incident.",
  status: "IN_PROGRESS",
  version: 3,
  priority: "NORMAL",
  impact: "OBSERVATION",
  reportedAt: "2026-10-24T02:30:00Z",
  observedAt: null,
  reporter: { userId, displayName: "TEST operator" },
  technician: { userId, displayName: "TEST technician" },
  startedAt: "2026-10-24T03:30:00Z",
  findings: null,
  rootCause: null,
  correctiveAction: null,
  preventiveAction: null,
  restoredAt: null,
  performedAt: null,
  investigationOutcome: null,
  submittedAt: null,
  returnReason: null,
  reviewedAt: null,
  reviewer: null,
  closedAt: null,
  closer: null,
  updatedAt: "2026-10-24T03:30:00Z",
  allowedActions: ["submit"],
  events: [],
  historyNextVersion: null,
  attachments: [],
  canUploadAttachment: false,
  attachmentLimit: 20,
  attachmentMaxBytes: 5242880,
};
async function fixture(page: Page, role = "TECHNICIAN") {
  await setup(page, role);
  const state = {
    items: [item()],
    older: [] as WorkOrderNotification[],
    nextCursor: null as string | null,
    listStatus: 200,
    readStatus: 200,
    listCalls: 0,
    readBodies: [] as unknown[],
    orderCalls: 0,
  };
  await page.route(
    "**/api/machines/WH-C/work-order-notifications**",
    async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (req.method() === "POST") {
        state.readBodies.push(req.postDataJSON());
        if (state.readStatus !== 200) {
          await route.fulfill({
            status: state.readStatus,
            json: {
              message:
                state.readStatus === 404
                  ? "Notification no longer actionable."
                  : "Read receipt could not be saved.",
            },
          });
          return;
        }
        const target = state.items.find((n) => url.pathname.includes(n.id));
        if (target) target.readAt = "2026-10-24T05:00:00.000Z";
        await route.fulfill({
          json: { read: true, readAt: "2026-10-24T05:00:00.000Z" },
        });
        return;
      }
      state.listCalls++;
      if (state.listStatus !== 200) {
        await route.fulfill({
          status: state.listStatus,
          json: { message: "Notification service temporarily unavailable." },
        });
        return;
      }
      await route.fulfill({
        json: {
          items: url.searchParams.has("after") ? state.older : state.items,
          unread: state.items.filter((n) => !n.readAt).length,
          nextCursor: url.searchParams.has("after") ? null : state.nextCursor,
        },
      });
    },
  );
  await page.route("**/api/machines/WH-C/work-orders/**", async (route) => {
    state.orderCalls++;
    await route.fulfill({ json: order });
  });
  await signIn(page);
  return state;
}
const inbox = (page: Page) =>
  page.getByRole("region", { name: "Work-order notifications", exact: true });
const expand = async (page: Page) => {
  await inbox(page)
    .getByRole("button", { name: /Work-order notifications \(/ })
    .click();
};

test("inbox has count, IST handoff messages and explicit read without auto-reading on expansion", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto("/machines/WH-C");
  await expect(
    inbox(page).getByRole("button", {
      name: "Work-order notifications (1 unread)",
    }),
  ).toBeVisible();
  await expand(page);
  await expect(
    inbox(page).getByText("TEST assigned inspection", { exact: true }),
  ).toBeVisible();
  await expect(inbox(page).getByText(/10:00:15 am IST/)).toBeVisible();
  await expect(
    inbox(page).getByText(/Calendar due-date reminders are separate/),
  ).toBeVisible();
  expect(state.readBodies).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("notification-inbox.png"),
    fullPage: true,
  });
  await inbox(page)
    .getByRole("button", { name: "Mark TEST assigned inspection as read" })
    .click();
  await expect(
    inbox(page).getByRole("button", {
      name: "Work-order notifications (0 unread)",
    }),
  ).toBeVisible();
  await expect(inbox(page).getByText("Read", { exact: true })).toBeVisible();
  expect(state.readBodies).toEqual([{}]);
  await expect(page).toHaveURL(/\/machines\/WH-C$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("opening saves receipt before navigation and failed receipts expose retry without navigating", async ({
  page,
}) => {
  const state = await fixture(page);
  state.readStatus = 503;
  await page.goto("/machines/WH-C");
  await expand(page);
  await inbox(page).getByRole("link", { name: "Open work order" }).click();
  await expect(inbox(page).getByRole("alert")).toContainText(
    "Read receipt could not be saved",
  );
  await expect(page).toHaveURL(/\/machines\/WH-C$/);
  await expect(
    inbox(page).getByRole("button", {
      name: "Work-order notifications (1 unread)",
    }),
  ).toBeVisible();
  state.readStatus = 200;
  await inbox(page)
    .getByRole("button", { name: "Refresh work-order notifications" })
    .click();
  await expect(inbox(page).getByRole("alert")).toHaveCount(0);
  await inbox(page).getByRole("link", { name: "Open work order" }).click();
  await expect(page).toHaveURL(new RegExp(`/work-orders/${orderId}$`));
  expect(state.readBodies).toEqual([{}, {}]);
});

test("stale stage or revoked scope clears actionable items and refresh offers current empty state", async ({
  page,
}) => {
  const state = await fixture(page);
  state.readStatus = 404;
  await page.goto("/machines/WH-C");
  await expand(page);
  await inbox(page)
    .getByRole("button", { name: "Mark TEST assigned inspection as read" })
    .click();
  await expect(inbox(page).getByRole("alert")).toContainText(
    "no longer actionable",
  );
  await expect(
    inbox(page).getByRole("link", { name: "Open work order" }),
  ).toHaveCount(0);
  state.items = [];
  await inbox(page)
    .getByRole("button", { name: "Refresh work-order notifications" })
    .click();
  await expect(inbox(page).getByRole("status")).toHaveText(
    "No actionable work-order notifications.",
  );
});

test("loading, unavailable service, recovery and independent older paging are accessible", async ({
  page,
}) => {
  const state = await fixture(page);
  state.listStatus = 503;
  await page.goto("/machines/WH-C");
  await expect(inbox(page).getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  state.listStatus = 200;
  state.nextCursor = eventId;
  state.older = [
    item({
      id: "b25dfdba-fb43-47d5-8055-34d10a22834a",
      title: "TEST returned investigation",
      action: "RETURN",
      kind: "INVESTIGATION",
      message:
        "Returned by the maintenance head. Read the return reason and submit updated findings.",
    }),
  ];
  await inbox(page)
    .getByRole("button", { name: "Refresh work-order notifications" })
    .click();
  await expand(page);
  await inbox(page)
    .getByRole("button", { name: "Load older notifications" })
    .click();
  await expect(
    inbox(page).getByText("TEST returned investigation", { exact: true }),
  ).toBeVisible();
  await expect(
    inbox(page).getByText("TEST assigned inspection", { exact: true }),
  ).toBeVisible();
  await expect(
    inbox(page).getByRole("button", { name: "Load older notifications" }),
  ).toHaveCount(0);
});

test("compact inbox polling preserves the technician's open repair draft and does not reload work order", async ({
  page,
}) => {
  await page.clock.install();
  const state = await fixture(page);
  await page.goto(`/machines/WH-C/work-orders/${orderId}`);
  await page
    .getByRole("button", { name: "Submit repair", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Inspection findings", exact: true })
    .fill("TEST retain this unsaved technician draft");
  const before = state.listCalls,
    orderCalls = state.orderCalls;
  await page.clock.runFor(31000);
  await expect.poll(() => state.listCalls).toBeGreaterThan(before);
  await expect(
    page.getByRole("textbox", { name: "Inspection findings", exact: true }),
  ).toHaveValue("TEST retain this unsaved technician draft");
  expect(state.orderCalls).toBe(orderCalls);
  await expand(page);
  const expandedCalls = state.listCalls;
  await page.clock.runFor(31000);
  expect(state.listCalls).toBe(expandedCalls);
});

test("maintenance-head view displays submission message; read-only roles have no personal engineering inbox", async ({
  page,
}) => {
  const state = await fixture(page, "MAINTENANCE_HEAD");
  state.items = [
    item({
      action: "SUBMIT",
      title: "TEST submitted maintenance",
      kind: "PLANNED",
      message:
        "Submitted for maintenance-head review. Review the technician’s findings.",
    }),
  ];
  await page.goto("/machines/WH-C");
  await expand(page);
  await expect(
    inbox(page).getByText(/active Maintenance head view/),
  ).toBeVisible();
  await expect(
    inbox(page).getByText(/Submitted for maintenance-head review/),
  ).toBeVisible();
});
for (const role of ["ADMINISTRATOR", "SUPERVISOR", "MANAGEMENT", "OPERATOR"])
  test(`${role} does not expose personal work-order notification actions`, async ({
    page,
  }) => {
    const state = await fixture(page, role);
    await page.goto("/machines/WH-C");
    await expect(
      page.getByRole("heading", { name: "WH-C/Blown-film line", exact: true }),
    ).toBeVisible();
    await expect(inbox(page)).toHaveCount(0);
    expect(state.listCalls).toBe(0);
  });

test("notification 401 expires session and redirects to login", async ({
  page,
}) => {
  const state = await fixture(page);
  state.listStatus = 401;
  await page.goto("/machines/WH-C");
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
});

test("initial loading is announced and keyboard expansion reaches the empty inbox", async ({
  page,
}) => {
  const state = await fixture(page);
  state.items = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/machines/WH-C/work-order-notifications",
    async (route) => {
      await gate;
      await route.fallback();
    },
  );
  await page.goto("/machines/WH-C");
  await expect(inbox(page).getByRole("status")).toHaveText(
    "Loading notifications…",
  );
  release();
  const toggle = inbox(page).getByRole("button", {
    name: "Work-order notifications (0 unread)",
  });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(inbox(page).getByRole("status")).toHaveText(
    "No actionable work-order notifications.",
  );
});
