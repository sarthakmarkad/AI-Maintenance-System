// Real UI → real Nest API → migrated isolated PostgreSQL. Only Supabase identity is doubled.
import { test, expect, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import "dotenv/config";
type Fixture = {
  orgId: string;
  machineId: string;
  users: Record<string, { id: string; role: string }>;
};
async function login(browser: Browser, key: string, f: Fixture) {
  const context = await browser.newContext(),
    page = await context.newPage(),
    u = f.users[key];
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.system-test-signature`;
  await page.route("http://127.0.0.1:54399/auth/v1/**", (route) => {
    const user = {
      id: u.id,
      aud: "authenticated",
      role: "authenticated",
      email: key + "@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-01T00:00:00Z",
    };
    return route.fulfill({
      json: route.request().url().includes("/settings")
        ? { external: { email: true, google: false } }
        : route.request().url().includes("/token")
          ? {
              access_token: token,
              refresh_token: "system-fixture-refresh",
              token_type: "bearer",
              expires_in: 3600,
              user,
            }
          : user,
    });
  });
  page.setDefaultTimeout(15000);
  await page.goto("/login");
  await page.getByLabel("Work email").fill(key + "@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
  return page;
}
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const base = "/machines/QA-01/work-orders";
test("six distinct role accounts retain a complete evidence-backed work-order handoff after reload", async ({
  browser,
}) => {
  const f: Fixture = JSON.parse(
    readFileSync(".local/system-fixture.json", "utf8"),
  );
  const pages: Page[] = [];
  const role = async (key: string) => {
    const p = await login(browser, key, f);
    pages.push(p);
    return p;
  };
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl || !new URL(dbUrl).pathname.endsWith("_test"))
    throw Error("Test database required");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const operator = await role("operator");
    await operator.goto(base);
    await button(operator, "Report an issue").click();
    await operator
      .getByLabel("Issue title", { exact: true })
      .fill("TEST real persistence acceptance");
    await operator
      .getByLabel("Observed symptoms", { exact: true })
      .fill("Synthetic acceptance observation; not a company incident.");
    await button(operator, "Save issue report").click();
    await expect(operator).toHaveURL(/work-orders\/[a-f0-9-]+$/);
    const path = new URL(operator.url()).pathname,
      id = path.split("/").at(-1)!;
    await operator.reload();
    await expect(
      operator.getByRole("heading", {
        name: "TEST real persistence acceptance",
        exact: true,
      }),
    ).toBeVisible();
    await button(operator, "Add supporting evidence").click();
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "yellow" },
    })
      .png()
      .toBuffer();
    await operator.getByLabel("Choose a photo or document").setInputFiles({
      name: "acceptance.png",
      mimeType: "image/png",
      buffer: png,
    });
    await operator
      .getByLabel("What does this attachment show?")
      .fill("TEST synthetic evidence image");
    await button(operator, "Save attachment").click();
    await expect(button(operator, "View acceptance.png")).toBeVisible();
    await operator.reload();
    await expect(button(operator, "View acceptance.png")).toBeVisible();
    const head = await role("head");
    await head.goto(path);
    await head
      .getByRole("button", { name: /Work-order notifications/ })
      .click();
    await expect(
      head
        .getByRole("region", { name: "Work-order notifications" })
        .getByText("TEST real persistence acceptance", { exact: true }),
    ).toBeVisible();
    await button(head, "Assign technician").click();
    await head
      .getByRole("combobox", { name: "Eligible technician", exact: true })
      .selectOption(f.users.technician.id);
    await button(head, "Save assignment").click();
    await expect(head.locator(".work-status")).toContainText("Assigned");
    const tech = await role("technician");
    await tech.goto(base);
    await tech
      .getByRole("button", { name: /Work-order notifications/ })
      .click();
    await expect(
      tech
        .getByRole("region", { name: "Work-order notifications" })
        .getByText("TEST real persistence acceptance", { exact: true }),
    ).toBeVisible();
    await expect(
      tech.getByRole("heading", {
        name: "TEST real persistence acceptance",
        exact: true,
      }),
    ).toBeVisible();
    await tech.goto(path);
    await button(tech, "Start repair").click();
    await button(tech, "Confirm start").click();
    await button(tech, "Submit repair").click();
    for (const [label, value] of Object.entries({
      "Inspection findings": "TEST synthetic inspection finding",
      "Human root-cause analysis":
        "TEST synthetic confirmed cause for acceptance only",
      "Corrective action": "TEST synthetic correction completed",
      "Preventive action": "TEST synthetic prevention recorded",
    }))
      await tech.getByLabel(label, { exact: true }).fill(value);
    const local = new Date(Date.now() + 330 * 60000)
      .toISOString()
      .slice(0, 19)
      .replace(/:00$/, "");
    await tech
      .getByLabel("Service restored (IST)", { exact: true })
      .fill(local);
    await button(tech, "Submit for review").click();
    await expect(tech.locator(".work-status")).toContainText("Awaiting review");
    await head.reload();
    await button(head, "Approve repair").click();
    await button(head, "Confirm approval").click();
    await expect(head.locator(".work-status")).toContainText("Approved");
    const supervisor = await role("supervisor");
    await supervisor.goto(path);
    await button(supervisor, "Close work order").click();
    await button(supervisor, "Confirm closure").click();
    await expect(supervisor.locator(".work-status")).toContainText("Closed");
    for (const key of ["admin", "management"]) {
      const p = await role(key);
      await p.goto(path);
      await expect(p.locator(".work-status")).toContainText("Closed");
      await expect(button(p, "Approve repair")).toHaveCount(0);
      await expect(button(p, "Close work order")).toHaveCount(0);
      await expect(button(p, "View acceptance.png")).toBeVisible();
    }
    await operator.reload();
    await expect(operator.locator(".work-status")).toContainText("Closed");
    const saved = await db.workOrder.findUniqueOrThrow({
      where: { id },
      include: { events: true, attachments: true },
    });
    expect(saved.orgId).toBe(f.orgId);
    expect(saved.machineId).toBe(f.machineId);
    expect(saved.status).toBe("CLOSED");
    expect(saved.reportedBy).toBe(f.users.operator.id);
    expect(saved.technicianId).toBe(f.users.technician.id);
    expect(saved.reviewedBy).toBe(f.users.head.id);
    expect(saved.closedBy).toBe(f.users.supervisor.id);
    expect(saved.events.length).toBe(saved.version);
    expect(saved.attachments).toHaveLength(1);
    expect(saved.rootCause).toContain("TEST synthetic");
    expect(
      await db.auditEvent.count({ where: { orgId: f.orgId, entityId: id } }),
    ).toBeGreaterThanOrEqual(saved.version);
    const exported = supervisor.waitForEvent("download");
    await button(supervisor, "Download work order PDF").click();
    const pdfPath = await (await exported).path();
    expect(readFileSync(pdfPath!).subarray(0, 4).toString()).toBe("%PDF");
    await supervisor.screenshot({
      path: ".local/system-closed-desktop.png",
      fullPage: true,
    });
  } finally {
    await db.$disconnect();
    await Promise.all(pages.map((p) => p.context().close()));
  }
});

test("machine metadata/photo and approved SOP bytes survive real saves and reloads", async ({
  browser,
}) => {
  const f: Fixture = JSON.parse(
    readFileSync(".local/system-fixture.json", "utf8"),
  );
  const admin = await login(browser, "admin", f),
    head = await login(browser, "head", f),
    operator = await login(browser, "operator", f);
  try {
    await admin.goto("/machines");
    await button(admin, "Edit machine").click();
    const editor = admin.getByRole("dialog", { name: "Edit machine · QA-01" });
    await expect(
      editor.getByLabel("Machine name", { exact: true }),
    ).toBeEnabled();
    await editor
      .getByLabel("Model", { exact: true })
      .fill("TEST accepted model");
    await editor
      .getByRole("button", { name: "Save machine details", exact: true })
      .click();
    await expect(
      editor.getByText("Machine details saved.", { exact: true }),
    ).toBeVisible();
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "yellow" },
    })
      .png()
      .toBuffer();
    await editor.getByLabel("Choose machine photo").setInputFiles({
      name: "machine.png",
      mimeType: "image/png",
      buffer: png,
    });
    await editor
      .getByRole("button", { name: "Upload machine photo", exact: true })
      .click();
    await expect(
      editor.getByText("Machine photo saved.", { exact: true }),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "Close form", exact: true })
      .click();
    await admin.reload();
    await expect(
      admin.getByRole("img", { name: "QA-01 machine photograph" }),
    ).toBeVisible();
    await operator.goto("/machines/QA-01");
    await expect(
      operator.getByRole("img", { name: "QA-01 machine photograph" }),
    ).toBeVisible();
    await expect(
      operator.getByText("TEST accepted model", { exact: true }),
    ).toBeVisible();
    const { textPdf } = await import("../../apps/api/src/tests/rag-fixture");
    const pdf = await textPdf([
      "TEST SYNTHETIC SOP. Not machine operating instructions. Acceptance fixture only.",
    ]);
    await head.goto("/machines/QA-01/documents");
    await button(head, "Upload reference").click();
    await head
      .getByLabel("Reference title", { exact: true })
      .fill("TEST acceptance SOP");
    await head
      .getByRole("combobox", { name: "Reference type", exact: true })
      .selectOption("SOP");
    await head
      .getByLabel("Revision description")
      .fill("TEST acceptance revision one");
    await head.getByLabel("PDF file", { exact: true }).setInputFiles({
      name: "acceptance-sop.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await button(head, "Save unapproved draft").click();
    await expect(
      head.getByText("Draft saved.", { exact: false }),
    ).toBeVisible();
    await head.reload();
    await button(head, "Details & history").click();
    await button(head, "Review approval v1").click();
    await head
      .getByLabel("Approval review reason")
      .fill("TEST reviewed acceptance PDF only");
    await button(head, "Confirm approval").click();
    await expect(
      head.getByText("Reference approved.", { exact: false }),
    ).toBeVisible();
    await operator.goto("/machines/QA-01/documents");
    await expect(
      operator.getByText("TEST acceptance SOP", { exact: true }),
    ).toBeVisible();
    const pending = operator.waitForEvent("download");
    await button(operator, "Download approved PDF").click();
    const path = await (await pending).path();
    expect(readFileSync(path!)).toEqual(pdf);
    await expect(button(operator, "Upload reference")).toHaveCount(0);
    await head.screenshot({
      path: ".local/system-library-desktop.png",
      fullPage: true,
    });
  } finally {
    await Promise.all([admin, head, operator].map((p) => p.context().close()));
  }
});

test("invitation creates a distinct trusted staff identity; deactivation and reactivation preserve it", async ({
  browser,
}) => {
  const f: Fixture = JSON.parse(
    readFileSync(".local/system-fixture.json", "utf8"),
  );
  const admin = await login(browser, "admin", f);
  let invitee: Page | undefined;
  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl || !new URL(dbUrl).pathname.endsWith("_test"))
    throw Error("Test database required");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await admin.goto("/team");
    await button(admin, "Invite staff").click();
    await admin
      .getByLabel("Full name", { exact: true })
      .fill("TEST invited technician");
    await admin
      .getByLabel("Staff email", { exact: true })
      .fill("invitee@example.test");
    await admin
      .getByLabel("Staff role", { exact: true })
      .selectOption("TECHNICIAN");
    await admin.getByRole("checkbox", { name: /QA-01/ }).check();
    await button(admin, "Create invitation").click();
    const linkDialog = admin.getByRole("dialog", {
      name: "Private invitation link",
      exact: true,
    });
    await expect(linkDialog).toBeVisible();
    const link = await linkDialog
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    await linkDialog
      .getByRole("button", { name: "Close form", exact: true })
      .click();
    invitee = await login(browser, "invitee", f);
    await invitee.goto(link);
    await button(invitee, "Accept invitation").click();
    await expect(invitee).toHaveURL(/\/machines$/);
    await expect(
      invitee.getByRole("link", { name: /QA-01.*TEST acceptance machine/ }),
    ).toBeVisible();
    const saved = await db.membership.findUniqueOrThrow({
      where: { userId: f.users.invitee.id },
      include: { machineAccess: true, roleGrants: true },
    });
    expect(saved.role).toBe("TECHNICIAN");
    expect(saved.staffEmail).toBe("invitee@example.test");
    expect(saved.machineAccess.map((m) => m.machineId)).toEqual([f.machineId]);
    expect(saved.roleGrants).toHaveLength(0);
    await admin.reload();
    await button(admin, "Manage TEST invited technician").click();
    await admin
      .getByLabel("Account status", { exact: true })
      .selectOption("INACTIVE");
    await admin
      .getByLabel("Reason for access change", { exact: true })
      .fill("TEST lifecycle deactivation");
    await button(admin, "Save staff access").click();
    await expect(
      admin.getByText(
        "Staff access saved. Existing maintenance history is retained.",
      ),
    ).toBeVisible();
    await invitee.reload();
    await expect(
      invitee.getByRole("heading", {
        name: "We couldn’t load this workspace",
        exact: true,
      }),
    ).toBeVisible();
    await button(admin, "Manage TEST invited technician").click();
    await admin
      .getByLabel("Account status", { exact: true })
      .selectOption("ACTIVE");
    await admin
      .getByLabel("Reason for access change", { exact: true })
      .fill("TEST lifecycle reactivation");
    await button(admin, "Save staff access").click();
    await expect(admin.getByRole("dialog")).not.toBeVisible();
    await invitee.reload();
    await expect(
      invitee.getByRole("link", { name: /QA-01.*TEST acceptance machine/ }),
    ).toBeVisible();
    const active = await db.membership.findUniqueOrThrow({
      where: { userId: f.users.invitee.id },
    });
    expect(active.id).toBe(saved.id);
    expect(active.active).toBe(true);
    expect(active.teamVersion).toBe(3);
    expect(
      await db.teamAction.count({
        where: { orgId: f.orgId, action: "UPDATE_MEMBER", targetId: saved.id },
      }),
    ).toBe(2);
    await admin.screenshot({
      path: ".local/system-team-desktop.png",
      fullPage: true,
    });
  } finally {
    await db.$disconnect();
    await admin.context().close();
    await invitee?.context().close();
  }
});
