// UI fixtures only; PostgreSQL tests exercise actual schedule/work-order transactions.
import { test, expect, type Page } from "@playwright/test";
import { Role } from "@prisma/client";
import { setup, signIn, userId } from "./helpers";
import { transition, type Issue } from "../../apps/api/src/domain/workflow";
import type { Principal } from "../../apps/api/src/repository";
const base = "/machines/WH-C/calendar",
  planId = "932a243c-054e-4c48-a5e5-74bb2d9a5974",
  orderId = "0457fd8c-808b-4ad8-a8bb-b8d836831c17";
const local = (d: Date) =>
    new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 19),
  today = local(new Date()).slice(0, 10),
  day = (offset: number) =>
    local(new Date(Date.now() + offset * 86400000)).slice(0, 10);
const plan = () => ({
  id: planId,
  requestId: "2625b575-df3e-4dd7-9dcf-70bc886f6f4f",
  title: "TEST weekly inspection",
  instructions: "TEST maintenance fixture, not an actual company plan.",
  frequency: "WEEKLY",
  interval: 1,
  firstDueAt: new Date(today + "T09:00:00+05:30").toISOString(),
  technicianId: userId,
  technicianName: "TEST technician",
  priority: "NORMAL",
  remindDays: 3,
  active: true,
  version: 1,
  pauseReason: null,
  nextSequence: 6,
  nextDueAt: new Date(Date.now() + 36 * 86400000).toISOString(),
  catchingUp: false,
  lastGeneratedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const task = (offset: number, status: string, index: number) => ({
  id: `cdb08f90-2380-498a-90b2-4b6049e7f00${index}`,
  planId,
  sequence: index,
  title: "TEST task " + index,
  instructions: "TEST inspect equipment according to the approved plan.",
  dueAt: new Date(day(offset) + "T23:00:00+05:30").toISOString(),
  priority: "NORMAL",
  version: 1,
  technician: { userId, displayName: "TEST technician" },
  workOrderId: null as string | null,
  workOrderStatus: null as string | null,
  status,
  skippedAt: null as string | null,
  skipReason: null as string | null,
  planActive: true,
});
async function mocks(
  page: Page,
  {
    role = "MAINTENANCE_HEAD",
    empty = false,
    retry = false,
    conflict = false,
    expired = false,
    plannedStatus = "ASSIGNED",
  }: {
    role?: string;
    empty?: boolean;
    retry?: boolean;
    conflict?: boolean;
    expired?: boolean;
    plannedStatus?: string;
  } = {},
) {
  await setup(page, role);
  let p = empty ? null : plan(),
    tasks = empty
      ? []
      : [task(-2, "OVERDUE", 1), task(0, "DUE", 2), task(1, "UPCOMING", 3)],
    failed = false,
    read = false;
  const bodies: any[] = [],
    actions: any[] = [];
  await page.route("**/api/machines/WH-C/work-orders/technicians", (r) =>
    r.fulfill({
      json: { items: [{ userId, displayName: "TEST technician" }] },
    }),
  );
  let order: any = {
    id: orderId,
    orgId: "fixture-org",
    kind: "PLANNED",
    status: plannedStatus,
    version: plannedStatus === "IN_PROGRESS" ? 2 : 1,
    title: "TEST planned maintenance",
    description: "TEST routine instructions.",
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedAt: new Date(Date.now() - 3600000).toISOString(),
    observedAt: null,
    reporter: { userId, displayName: "TEST head" },
    technician: { userId, displayName: "TEST technician" },
    technicianId: userId,
    startedAt:
      plannedStatus === "IN_PROGRESS"
        ? new Date(Date.now() - 1800000).toISOString()
        : null,
    findings: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    restoredAt: null,
    performedAt: null,
    submittedAt: null,
    returnReason: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewer: null,
    closedAt: null,
    closedBy: null,
    closer: null,
    updatedAt: new Date().toISOString(),
    maintenanceOccurrence: {
      id: task(0, "DUE", 2).id,
      planId,
      dueAt: new Date(today + "T23:00:00+05:30").toISOString(),
    },
    events: [],
    historyNextVersion: null,
  };
  const view = () => ({
    ...order,
    allowedActions:
      role === "TECHNICIAN"
        ? order.status === "ASSIGNED"
          ? ["start"]
          : order.status === "IN_PROGRESS"
            ? ["submit"]
            : []
        : role === "MAINTENANCE_HEAD"
          ? ["assign"]
          : [],
  });
  await page.route(
    "**/api/machines/WH-C/work-orders/" + orderId + "**",
    async (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.includes("/actions/")) {
        const action = path.split("/").at(-1)!,
          b = r.request().postDataJSON();
        actions.push({ action, ...b });
        const principal: Principal = {
          userId,
          membershipId: "fixture-member",
          orgId: "fixture-org",
          organization: "Fixture",
          displayName: "TEST technician",
          role: role as Role,
        };
        const next = transition(
          order as Issue,
          principal,
          action as "start" | "submit",
          b,
          [],
          new Date(),
        );
        order = {
          ...order,
          ...next,
          startedAt:
            action === "start" ? new Date().toISOString() : order.startedAt,
          submittedAt: action === "submit" ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        };
      }
      await r.fulfill({ json: view() });
    },
  );
  await page.route("**/api/machines/WH-C/calendar**", async (r) => {
    const u = new URL(r.request().url()),
      path = u.pathname,
      method = r.request().method();
    if (expired) {
      await r.fulfill({ status: 401, json: { message: "Session expired" } });
      return;
    }
    if (path.endsWith("/plans") && method === "POST") {
      const b = r.request().postDataJSON();
      bodies.push(b);
      p = { ...plan(), ...b };
      if (retry && !failed) {
        failed = true;
        await r.fulfill({
          status: 503,
          json: { message: "Connection lost after save. Retry the same plan." },
        });
        return;
      }
      await r.fulfill({ status: 201, json: p });
      return;
    }
    if (path.endsWith("/plans")) {
      await r.fulfill({
        json: { items: p ? [p] : [], canManage: role === "MAINTENANCE_HEAD" },
      });
      return;
    }
    if (path.endsWith("/state")) {
      const b = r.request().postDataJSON();
      p = {
        ...p!,
        active: b.active,
        version: p!.version + 1,
        pauseReason: b.active ? null : b.reason,
      };
      await r.fulfill({ json: p });
      return;
    }
    if (path.endsWith("/read")) {
      read = true;
      await r.fulfill({ json: { read: true } });
      return;
    }
    if (path.endsWith("/reminders")) {
      const enabled =
        ["MAINTENANCE_HEAD", "SUPERVISOR", "TECHNICIAN"].includes(role) &&
        !!tasks.length;
      await r.fulfill({
        json: {
          items: enabled
            ? [
                {
                  id: "ba6237f9-51a0-4551-8d7c-249d47c748f1",
                  kind: "OVERDUE",
                  occurrenceId: tasks[0].id,
                  title: tasks[0].title,
                  dueAt: tasks[0].dueAt,
                  orderId: null,
                  read,
                  createdAt: new Date().toISOString(),
                },
              ]
            : [],
          unread: enabled && !read ? 1 : 0,
          nextCursor: null,
        },
      });
      return;
    }
    if (path.endsWith("/release") || path.endsWith("/skip")) {
      const b = r.request().postDataJSON(),
        t = tasks.find((t) => path.includes(t.id))!;
      actions.push({ action: path.split("/").at(-1), ...b });
      if (conflict && !failed) {
        failed = true;
        t.version++;
        await r.fulfill({
          status: 409,
          json: {
            message: "The scheduled task changed. Reload before trying again.",
          },
        });
        return;
      }
      if (path.endsWith("/release")) {
        t.workOrderId = orderId;
        t.workOrderStatus = "ASSIGNED";
        t.version++;
        await r.fulfill({ json: { orderId, alreadyReleased: false } });
      } else {
        t.status = "SKIPPED";
        t.skipReason = b.reason;
        t.skippedAt = new Date().toISOString();
        t.version++;
        await r.fulfill({ json: { skipped: true } });
      }
      return;
    }
    const from = u.searchParams.get("from")!,
      to = u.searchParams.get("to")!,
      status = u.searchParams.get("status");
    const all = tasks.filter(
      (t) =>
        local(new Date(t.dueAt)).slice(0, 10) >= from &&
        local(new Date(t.dueAt)).slice(0, 10) <= to,
    );
    const counts = Object.fromEntries(
      ["UPCOMING", "DUE", "OVERDUE", "COMPLETED", "SKIPPED"].map((s) => [
        s,
        all.filter((t) => t.status === s).length,
      ]),
    );
    const dayCounts: Record<string, number> = {};
    for (const t of all) {
      const d = local(new Date(t.dueAt)).slice(0, 10);
      dayCounts[d] = (dayCounts[d] ?? 0) + 1;
    }
    await r.fulfill({
      json: {
        items: all.filter((t) => !status || t.status === status),
        counts,
        dayCounts,
        canManage: role === "MAINTENANCE_HEAD",
        nextCursor: null,
        serverTime: new Date().toISOString(),
        scheduling: {
          lastJobAt: new Date().toISOString(),
          failed: false,
          catchingUp: false,
        },
      },
    });
  });
  return { bodies, actions, plan: () => p };
}
async function open(page: Page) {
  await signIn(page);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Maintenance calendar", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scheduled tasks", exact: true }),
  ).toBeVisible();
}
test("calendar shows IST due stages, day/status filters and responsive month layout", async ({
  page,
}) => {
  await mocks(page);
  await open(page);
  await expect(
    page.getByRole("heading", { name: "TEST task 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Show maintenance on ${today}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "TEST task 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TEST task 1", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Task status", exact: true })
    .selectOption("OVERDUE");
  await expect(
    page.getByRole("heading", {
      name: "No scheduled tasks in this view",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Task status", exact: true })
    .selectOption("");
  await page
    .getByRole("button", { name: "Show the whole calendar range", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/calendar-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("head creates a fixed-date plan with retry-safe draft and explicit IST input", async ({
  page,
}) => {
  const state = await mocks(page, { empty: true, retry: true });
  await open(page);
  await page
    .getByRole("button", { name: "Create maintenance plan", exact: true })
    .click();
  await page
    .getByLabel("Plan title", { exact: true })
    .fill("TEST monthly inspection");
  await page
    .getByLabel("Maintenance instructions", { exact: true })
    .fill("TEST inspect equipment and record findings.");
  await page
    .getByRole("combobox", { name: "Repeat frequency", exact: true })
    .selectOption("MONTHLY");
  await page
    .getByLabel("First due (IST)", { exact: true })
    .fill(today + "T10:00:01");
  await page
    .getByRole("combobox", { name: "Assigned technician", exact: true })
    .selectOption(userId);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/calendar-plan-form-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save maintenance plan", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Connection lost after save" }),
  ).toBeVisible();
  await expect(page.getByLabel("Plan title", { exact: true })).toHaveValue(
    "TEST monthly inspection",
  );
  await page
    .getByRole("button", { name: "Save maintenance plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "TEST monthly inspection", exact: true }),
  ).toBeVisible();
  expect(state.bodies).toHaveLength(2);
  expect(state.bodies[0].requestId).toBe(state.bodies[1].requestId);
  expect(state.bodies[0].firstDueAt).toBe(
    new Date(today + "T10:00:01+05:30").toISOString(),
  );
});
test("head pauses and resumes plans with reasons and skips one unreleased occurrence", async ({
  page,
}) => {
  await mocks(page);
  await open(page);
  await page.getByRole("tab", { name: "Plans", exact: true }).click();
  await page.getByRole("button", { name: "Pause plan", exact: true }).click();
  await page
    .getByLabel("Reason for schedule change", { exact: true })
    .fill("TEST approved shutdown window");
  await page
    .getByRole("button", { name: "Confirm pause", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume plan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume plan", exact: true }).click();
  await page
    .getByLabel("Reason for schedule change", { exact: true })
    .fill("TEST resume fixed dates");
  await page
    .getByRole("button", { name: "Confirm resume", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause plan", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  const card = page
    .locator(".calendar-task")
    .filter({ hasText: "TEST task 1" });
  await card
    .getByRole("button", { name: "Manage scheduled task", exact: true })
    .click();
  await card
    .getByRole("combobox", { name: "Task action", exact: true })
    .selectOption("skip");
  await card
    .getByLabel("Reason for skipping", { exact: true })
    .fill("TEST task explicitly deferred");
  await card.getByRole("button", { name: "Confirm skip", exact: true }).click();
  await expect(card).toContainText(
    "Skip reason: TEST task explicitly deferred",
  );
});
test("head releases one assigned planned work order through the calendar", async ({
  page,
}) => {
  const state = await mocks(page);
  await open(page);
  const card = page
    .locator(".calendar-task")
    .filter({ hasText: "TEST task 2" });
  await card
    .getByRole("button", { name: "Manage scheduled task", exact: true })
    .click();
  await card
    .getByRole("combobox", { name: "Release to technician", exact: true })
    .selectOption(userId);
  await card
    .getByRole("button", { name: "Create work order", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/work-orders/" + orderId + "$"));
  await expect(
    page.getByRole("heading", {
      name: "Maintenance completion evidence",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.actions[0].version).toBe(1);
  await expect(
    page.getByText("Planned maintenance", { exact: true }),
  ).toBeVisible();
});
test("planned technician submission uses performed work/time without invented breakdown RCA", async ({
  page,
}) => {
  const state = await mocks(page, {
    role: "TECHNICIAN",
    plannedStatus: "IN_PROGRESS",
  });
  await signIn(page);
  await page.goto("/machines/WH-C/work-orders/" + orderId);
  await page
    .getByRole("button", { name: "Submit maintenance", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Human root-cause analysis",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Service restored (IST)", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Inspection findings", { exact: true })
    .fill("TEST routine inspection complete");
  await page
    .getByLabel("Work performed", { exact: true })
    .fill("TEST planned checks completed");
  await page
    .getByLabel("Maintenance performed (IST)", { exact: true })
    .fill(local(new Date()));
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(page.locator(".work-status")).toHaveText("Awaiting review");
  expect(state.actions[0].rootCause).toBeUndefined();
  expect(state.actions[0].restoredAt).toBeUndefined();
  expect(state.actions[0].performedAt).toBeTruthy();
});
test("reminder read state persists and administrator cannot manage plans", async ({
  page,
}) => {
  await mocks(page, { role: "SUPERVISOR" });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Create maintenance plan", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Manage scheduled task", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: /Reminders/ }).click();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(
    page.getByText("Read in this role", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Reminders/ }).click();
  await expect(
    page.getByText("Read in this role", { exact: true }),
  ).toBeVisible();
  const other = await page.context().newPage();
  await mocks(other, { role: "ADMINISTRATOR" });
  await other.goto(base);
  await expect(
    other.getByRole("heading", { name: "Maintenance calendar", exact: true }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Create maintenance plan", exact: true }),
  ).toHaveCount(0);
  await other.getByRole("tab", { name: /Reminders/ }).click();
  await expect(
    other.getByRole("heading", {
      name: "No current reminders for this role",
      exact: true,
    }),
  ).toBeVisible();
  await other.close();
});
test("stale schedule actions block until explicit reload and expired access returns to login", async ({
  page,
}) => {
  const state = await mocks(page, { conflict: true });
  await open(page);
  const card = page
    .locator(".calendar-task")
    .filter({ hasText: "TEST task 1" });
  await card
    .getByRole("button", { name: "Manage scheduled task", exact: true })
    .click();
  await card
    .getByRole("combobox", { name: "Release to technician", exact: true })
    .selectOption(userId);
  await card
    .getByRole("button", { name: "Create work order", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "scheduled task changed" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Create work order", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reload latest schedule", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create work order", exact: true }),
  ).toHaveCount(0);
  expect(state.actions).toHaveLength(1);
  const other = await page.context().newPage();
  await mocks(other, { expired: true });
  await other.goto(base);
  await expect(other).toHaveURL(/\/login\?reason=expired$/);
  await other.close();
});
