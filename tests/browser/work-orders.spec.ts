// Isolated browser fixtures. Actual authorization, transactions and concurrency
// are exercised against PostgreSQL in work-orders.integration.ts.
import { test, expect, type Page } from "@playwright/test";
import { Role } from "@prisma/client";
import {
  transition,
  type Action,
  type Issue,
} from "../../apps/api/src/domain/workflow";
import type { Principal } from "../../apps/api/src/repository";
import { setup, signIn, userId } from "./helpers";
const id = "c25dfdba-fb43-47d5-8055-34d10a22834a",
  otherTech = "b85ea48d-309b-4f2b-89b7-910c357acb03";
const base = "/machines/WH-C/work-orders";
const person = { userId, displayName: "TEST technician" };
const principal = (role: Role): Principal => ({
  userId,
  membershipId: "fixture-member",
  displayName: "TEST " + role.toLowerCase(),
  role,
  orgId: "fixture-org",
  organization: "Fixture",
});
type Model = Issue & Record<string, any>;
function initial(): Model {
  return {
    id,
    orgId: "fixture-org",
    status: "REPORTED",
    version: 1,
    title: "TEST bearing inspection",
    description: "Synthetic browser fixture, not an actual company incident.",
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedAt: "2026-09-01T02:30:00.000Z",
    observedAt: null,
    reporter: { userId, displayName: "TEST operator" },
    technician: null,
    technicianId: null,
    startedAt: null,
    findings: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    restoredAt: null,
    submittedAt: null,
    returnReason: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewer: null,
    closedAt: null,
    closedBy: null,
    closer: null,
    updatedAt: "2026-09-01T02:30:00.000Z",
    events: [
      {
        id: "event-1",
        version: 1,
        action: "REPORT",
        fromStatus: null,
        toStatus: "REPORTED",
        actor: { userId, displayName: "TEST operator" },
        actorRole: "OPERATOR",
        at: "2026-09-01T02:30:00Z",
        detail: { impact: "OBSERVATION" },
      },
    ],
    historyNextVersion: null,
  };
}
function advance(
  o: Model,
  action: Action,
  role: Role,
  input: Record<string, unknown> = {},
) {
  const now = new Date(Date.parse("2026-09-01T04:00:00Z") + o.version * 60000),
    before = o.status;
  const t = transition(
    o,
    principal(role),
    action,
    { version: o.version, ...input },
    [
      { ...principal(Role.TECHNICIAN), userId: person.userId },
      { ...principal(Role.TECHNICIAN), userId: otherTech },
    ],
    now,
  );
  const next: Model = { ...o, ...t, updatedAt: now.toISOString() };
  if (action === "assign") {
    next.technician = {
      userId: t.technicianId,
      displayName:
        t.technicianId === otherTech
          ? "TEST second technician"
          : person.displayName,
    };
    next.startedAt = null;
    next.submittedAt = null;
    next.returnReason = null;
  }
  if (action === "start") next.startedAt = now.toISOString();
  if (action === "submit") {
    next.submittedAt = now.toISOString();
    next.returnReason = null;
  }
  if (action === "return") next.returnReason = input.reason;
  if (action === "approve")
    next.reviewer = { userId, displayName: "TEST maintenance head" };
  if (action === "close")
    next.closer = {
      userId,
      displayName:
        role === Role.SUPERVISOR ? "TEST supervisor" : "TEST maintenance head",
    };
  next.events = [
    {
      id: "event-" + next.version,
      version: next.version,
      action: action.toUpperCase(),
      fromStatus: before,
      toStatus: next.status,
      actor: { userId, displayName: principal(role).displayName },
      actorRole: role,
      at: now.toISOString(),
      detail: input,
    },
    ...o.events,
  ];
  return next;
}
const repair = {
  findings: "TEST inspected bearing",
  rootCause: "TEST inspection finding",
  correctiveAction: "TEST bearing replaced",
  preventiveAction: "TEST inspection scheduled",
  restoredAt: "2026-09-01T03:30:00Z",
};
function fixture(status: Issue["status"]) {
  let o = initial();
  if (status === "REPORTED") return o;
  o = advance(o, "assign", Role.MAINTENANCE_HEAD, { technicianId: userId });
  if (status === "ASSIGNED") return o;
  o = advance(o, "start", Role.TECHNICIAN);
  if (status === "IN_PROGRESS") return o;
  o = advance(o, "submit", Role.TECHNICIAN, repair);
  if (status === "AWAITING_REVIEW") return o;
  o = advance(o, "approve", Role.MAINTENANCE_HEAD);
  if (status === "APPROVED") return o;
  return advance(o, "close", Role.SUPERVISOR);
}
function view(o: Model, role: Role) {
  const allowedActions: string[] = [];
  if (
    role === Role.MAINTENANCE_HEAD &&
    ["REPORTED", "ASSIGNED", "IN_PROGRESS"].includes(o.status)
  )
    allowedActions.push("assign");
  if (role === Role.TECHNICIAN && o.technicianId === userId) {
    if (o.status === "ASSIGNED") allowedActions.push("start");
    if (o.status === "IN_PROGRESS") allowedActions.push("submit");
  }
  if (role === Role.MAINTENANCE_HEAD && o.status === "AWAITING_REVIEW")
    allowedActions.push("approve", "return");
  if (
    [Role.MAINTENANCE_HEAD, Role.SUPERVISOR].includes(
      role as "MAINTENANCE_HEAD" | "SUPERVISOR",
    ) &&
    o.status === "APPROVED"
  )
    allowedActions.push("close");
  return { ...o, allowedActions };
}
async function mocks(
  page: Page,
  options: {
    role?: Role;
    status?: Issue["status"];
    empty?: boolean;
    reportRetry?: boolean;
    conflict?: boolean;
    expired?: boolean;
  } = {},
) {
  const role = options.role ?? Role.MAINTENANCE_HEAD;
  await setup(page, role);
  let o: Model | null = options.empty
    ? null
    : fixture(options.status ?? "REPORTED");
  const reportBodies: any[] = [],
    actions: string[] = [];
  let failed = false;
  await page.route("**/api/machines/WH-C/work-orders**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    if (options.expired) {
      await route.fulfill({
        status: 401,
        json: { message: "Session expired." },
      });
      return;
    }
    if (path.endsWith("/technicians")) {
      await route.fulfill({
        json: {
          items: [
            person,
            { userId: otherTech, displayName: "TEST second technician" },
          ],
        },
      });
      return;
    }
    const actionMatch = path.match(/\/actions\/(\w+)$/);
    if (actionMatch) {
      const action = actionMatch[1] as Action,
        body = route.request().postDataJSON();
      actions.push(action);
      if (options.conflict && !failed) {
        failed = true;
        o = advance(o!, "start", Role.TECHNICIAN);
        await route.fulfill({
          status: 409,
          json: {
            message: "This work order changed. Reload before trying again.",
          },
        });
        return;
      }
      try {
        o = advance(o!, action, role, body);
        await route.fulfill({ json: view(o, role) });
      } catch (e) {
        await route.fulfill({
          status: 400,
          json: {
            message: e instanceof Error ? e.message : "Invalid fixture action",
          },
        });
      }
      return;
    }
    if (path.endsWith("/work-orders") && method === "POST") {
      const body = route.request().postDataJSON();
      reportBodies.push(body);
      const existed = !!o;
      if (!o) o = { ...initial(), ...body };
      if (options.reportRetry && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: {
            message: "Connection lost after save. Retry the same report.",
          },
        });
        return;
      }
      await route.fulfill({
        status: 201,
        json: { ...view(o!, role), alreadyReported: existed },
      });
      return;
    }
    if (path.endsWith("/work-orders")) {
      const counts = Object.fromEntries(
        [
          "REPORTED",
          "ASSIGNED",
          "IN_PROGRESS",
          "AWAITING_REVIEW",
          "APPROVED",
          "CLOSED",
        ].map((s) => [s, o?.status === s ? 1 : 0]),
      );
      await route.fulfill({
        json: {
          items:
            o &&
            (!url.searchParams.get("status") ||
              url.searchParams.get("status") === o.status)
              ? [view(o, role)]
              : [],
          counts,
          total: o ? 1 : 0,
          nextCursor: null,
        },
      });
      return;
    }
    if (!o || !path.endsWith("/" + o.id)) {
      await route.fulfill({
        status: 404,
        json: { message: "Work order not found." },
      });
      return;
    }
    await route.fulfill({ json: view(o, role) });
  });
  return {
    reportBodies,
    actions,
    order: () => o!,
    resubmit: () => {
      o = advance(o!, "submit", Role.TECHNICIAN, {
        ...repair,
        rootCause: "TEST revised human finding",
      });
    },
  };
}
async function open(page: Page, detail = true) {
  await signIn(page);
  await page.goto(base + (detail ? "/" + id : ""));
  await expect(
    page.getByRole("heading", {
      name: detail ? "Work order" : "Breakdowns & work orders",
      exact: true,
    }),
  ).toBeVisible();
}
test("operator retries keep the same report key and reach one persisted report", async ({
  page,
}) => {
  const state = await mocks(page, {
    role: Role.OPERATOR,
    empty: true,
    reportRetry: true,
  });
  await open(page, false);
  await page
    .getByRole("button", { name: "Report an issue", exact: true })
    .click();
  await page
    .getByLabel("Issue title", { exact: true })
    .fill("TEST operator vibration report");
  await page
    .getByLabel("Observed symptoms", { exact: true })
    .fill("TEST observed vibration; synthetic browser fixture");
  await page
    .getByLabel("First observed (IST, optional)", { exact: true })
    .fill("2026-09-01T08:00:01");
  await page
    .getByRole("button", { name: "Save issue report", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Connection lost after save" }),
  ).toBeVisible();
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    "TEST operator vibration report",
  );
  await page
    .getByRole("button", { name: "Save issue report", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/work-orders/" + id + "$"));
  await expect(
    page.getByRole("heading", {
      name: "TEST operator vibration report",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.reportBodies).toHaveLength(2);
  expect(state.reportBodies[0].requestId).toBe(state.reportBodies[1].requestId);
  expect(state.reportBodies[0].observedAt).toBe("2026-09-01T02:30:01.000Z");
  await expect(
    page.getByRole("button", { name: "Assign technician", exact: true }),
  ).toHaveCount(0);
});
test("head selects an eligible technician and saves assignment history", async ({
  page,
}) => {
  const state = await mocks(page);
  await open(page);
  await page
    .getByRole("button", { name: "Assign technician", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Eligible technician", exact: true })
    .selectOption(userId);
  await page
    .getByLabel("Assignment reason (optional)", { exact: true })
    .fill("TEST available for inspection");
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Work order updated" }),
  ).toBeVisible();
  expect(state.order().status).toBe("ASSIGNED");
  await expect(
    page.getByRole("heading", { name: "Assign · v2", exact: true }),
  ).toBeVisible();
});
test("assigned technician starts and submits complete human repair evidence with an explicit IST timestamp", async ({
  page,
}) => {
  const state = await mocks(page, {
    role: Role.TECHNICIAN,
    status: "ASSIGNED",
  });
  await open(page);
  await page.getByRole("button", { name: "Start repair", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm start", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit repair", exact: true })
    .click();
  for (const [field, value] of Object.entries({
    "Inspection findings": repair.findings,
    "Human root-cause analysis": repair.rootCause,
    "Corrective action": repair.correctiveAction,
    "Preventive action": repair.preventiveAction,
  }))
    await page.getByLabel(field, { exact: true }).fill(value);
  await page
    .getByLabel("Service restored (IST)", { exact: true })
    .fill("2026-09-01T09:00:01");
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.locator(".work-status").filter({ hasText: "Awaiting review" }),
  ).toBeVisible();
  expect(state.order().restoredAt).toBe("2026-09-01T03:30:01.000Z");
  await expect(
    page.getByRole("button", { name: "Approve repair", exact: true }),
  ).toHaveCount(0);
});
test("head return, resubmission, approval and closure retain human RCA and distinct times", async ({
  page,
}) => {
  const state = await mocks(page, { status: "AWAITING_REVIEW" });
  await open(page);
  await page
    .getByRole("button", { name: "Return for more work", exact: true })
    .click();
  await page
    .getByLabel("Reason for return", { exact: true })
    .fill("TEST add inspection evidence");
  await page
    .getByRole("button", { name: "Send back to technician", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Work returned for", exact: true }),
  ).toBeVisible();
  state.resubmit();
  await page.reload();
  await page
    .getByRole("button", { name: "Approve repair", exact: true })
    .click();
  await page
    .getByLabel("Engineering review note (optional)", { exact: true })
    .fill("TEST reviewed repair and human findings");
  await page
    .getByRole("button", { name: "Confirm approval", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close work order", exact: true })
    .click();
  await page
    .getByLabel("Closure note (optional)", { exact: true })
    .fill("TEST closure recorded");
  await page
    .getByRole("button", { name: "Confirm closure", exact: true })
    .click();
  await expect(
    page.locator(".work-status").filter({ hasText: "Closed" }),
  ).toBeVisible();
  await expect(page.locator(".work-evidence")).toContainText(
    "TEST revised human finding",
  );
  await expect(page.locator(".work-timeline")).toContainText(
    "TEST add inspection evidence",
  );
  expect(state.order().restoredAt).not.toBe(state.order().reviewedAt);
  expect(state.order().reviewedAt).not.toBe(state.order().closedAt);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/work-order-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("supervisor closes approved work while administrator has no engineering actions", async ({
  page,
}) => {
  await mocks(page, { role: Role.SUPERVISOR, status: "APPROVED" });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Approve repair", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close work order", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm closure", exact: true })
    .click();
  await expect(
    page.locator(".work-status").filter({ hasText: "Closed" }),
  ).toBeVisible();
  const other = await page.context().newPage();
  await mocks(other, { role: Role.ADMINISTRATOR, status: "APPROVED" });
  await other.goto(base + "/" + id);
  await expect(
    other.getByRole("heading", { name: "Work order", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Approve repair",
    "Close work order",
    "Assign technician",
  ])
    await expect(other.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await other.close();
});
test("stale repair update requires reload and never retries automatically against a newer version", async ({
  page,
}) => {
  const state = await mocks(page, {
    role: Role.TECHNICIAN,
    status: "ASSIGNED",
    conflict: true,
  });
  await open(page);
  await page.getByRole("button", { name: "Start repair", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm start", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm start", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reload work order", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submit repair", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start repair", exact: true }),
  ).toHaveCount(0);
  expect(state.actions).toEqual(["start"]);
});
test("work-order expiry returns to sign-in and status filters expose empty results", async ({
  page,
}) => {
  await mocks(page, { role: Role.ADMINISTRATOR });
  await open(page, false);
  await page
    .getByRole("combobox", { name: "Workflow status", exact: true })
    .selectOption("CLOSED");
  await expect(
    page.getByRole("heading", {
      name: "No work orders in this stage",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report an issue", exact: true }),
  ).toHaveCount(0);
  const other = await page.context().newPage();
  await mocks(other, { expired: true });
  await other.goto(base);
  await expect(other).toHaveURL(/\/login\?reason=expired$/);
  await other.close();
});
