// Browser fixtures check client behavior; real authorization, bytes, audit and
// concurrency run through PostgreSQL HTTP tests in attachments.integration.ts.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
const id = "c25dfdba-fb43-47d5-8055-34d10a22834a",
  attachmentId = "e13bf676-507d-416b-bb9a-76ca8b100e6f",
  base = "/machines/WH-C/work-orders";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const person = { userId, displayName: "TEST technician" };
const attachment = {
  id: attachmentId,
  orderVersion: 4,
  filename: "inspection.png",
  description: "TEST inspection photo",
  mediaType: "image/png",
  byteSize: png.length,
  sha256: "a".repeat(64),
  uploader: person,
  actorRole: "TECHNICIAN",
  status: "IN_PROGRESS",
  createdAt: "2026-09-01T04:00:00Z",
};
function model(status = "IN_PROGRESS", role = "TECHNICIAN", existing = false) {
  return {
    id,
    title: "TEST attachment inspection",
    description: "Synthetic browser fixture only.",
    kind: "BREAKDOWN",
    status,
    version: 3,
    priority: "NORMAL",
    impact: "OBSERVATION",
    reportedAt: "2026-09-01T02:30:00Z",
    observedAt: null,
    reporter: person,
    technician: person,
    startedAt: "2026-09-01T03:00:00Z",
    findings: null,
    rootCause: null,
    correctiveAction: null,
    preventiveAction: null,
    restoredAt: null,
    submittedAt: null,
    returnReason: null,
    reviewedAt: null,
    reviewer: null,
    closer: null,
    closedAt: null,
    updatedAt: "2026-09-01T03:00:00Z",
    performedAt: null,
    investigationOutcome: null,
    investigationReview: null,
    maintenanceOccurrence: null,
    events: [] as any[],
    historyNextVersion: null,
    allowedActions:
      status === "IN_PROGRESS" && role === "TECHNICIAN"
        ? ["submit"]
        : status === "AWAITING_REVIEW" && role === "MAINTENANCE_HEAD"
          ? ["approve", "return"]
          : [],
    attachments: existing ? [attachment] : [],
    canUploadAttachment:
      (role === "TECHNICIAN" && status === "IN_PROGRESS") ||
      (role === "OPERATOR" && status === "REPORTED"),
    attachmentLimit: 20,
    attachmentMaxBytes: 5 * 1024 * 1024,
  };
}
async function fixture(
  page: Page,
  {
    role = "TECHNICIAN",
    status = "IN_PROGRESS",
    existing = false,
    fail = "",
    downloadFail = 0,
  }: {
    role?: string;
    status?: string;
    existing?: boolean;
    fail?: string;
    downloadFail?: number;
  } = {},
) {
  await setup(page, role);
  const o = model(status, role, existing),
    requests: string[] = [],
    headers: Record<string, string>[] = [];
  let attempted = false;
  await page.route("**/api/machines/WH-C/work-orders**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/download")) {
      headers.push(route.request().headers());
      await route.fulfill(
        downloadFail
          ? { status: downloadFail, json: { message: "TEST download denied" } }
          : {
              body: png,
              contentType: "application/octet-stream",
              headers: {
                "Content-Disposition": 'attachment; filename="inspection.png"',
              },
            },
      );
      return;
    }
    if (path.endsWith("/attachments") && route.request().method() === "POST") {
      requests.push(route.request().postDataBuffer()!.toString("utf8"));
      if (fail && !attempted) {
        attempted = true;
        await route.fulfill({
          status: Number(fail),
          json: {
            message:
              fail === "409"
                ? "TEST work order changed. Reload before uploading."
                : "TEST upload failed. Try again.",
          },
        });
        return;
      }
      o.version++;
      const a = {
        ...attachment,
        orderVersion: o.version,
        actorRole: role,
        status: o.status,
      };
      o.attachments.push(a);
      o.events.unshift({
        id: "attachment-event",
        version: o.version,
        action: "ATTACH",
        fromStatus: o.status,
        toStatus: o.status,
        actor: person,
        actorRole: role,
        at: a.createdAt,
        detail: {
          attachmentId: a.id,
          filename: a.filename,
          description: a.description,
          byteSize: a.byteSize,
          sha256: a.sha256,
        },
      });
      await route.fulfill({
        status: 201,
        json: { attachment: a, alreadyUploaded: false },
      });
      return;
    }
    await route.fulfill({ json: o });
  });
  await signIn(page);
  await page.goto(`${base}/${id}`);
  await expect(
    page.getByRole("heading", { name: "Photos & documents" }),
  ).toBeVisible();
  return { o, requests, headers };
}
async function select(page: Page, name = "inspection.png", buffer = png) {
  await page.getByLabel("Choose a photo or document").setInputFiles({
    name,
    mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png",
    buffer,
  });
  await page
    .getByLabel("What does this attachment show?")
    .fill("TEST inspection photo");
}

test("assigned technician saves evidence, reloads versioned history and downloads authenticated bytes", async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  await expect(
    page.getByText("No attachments yet.", { exact: true }),
  ).toBeVisible();
  await select(page);
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page.getByText("1 of 20 attachments", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Attachment added · v4" }),
  ).toBeVisible();
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]).toContain('name="version"\r\n\r\n3');
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Download inspection.png" }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download inspection.png" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("inspection.png");
  expect(f.headers[0].authorization).toMatch(/^Bearer /);
  const panel = page.getByRole("region", { name: "Work order attachments" });
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({
    path: `test-results/attachments-${testInfo.project.name}.png`,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("operator adds evidence after saving a report; no repair authority is introduced", async ({
  page,
}) => {
  await fixture(page, { role: "OPERATOR", status: "REPORTED" });
  await select(page);
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page.getByText("1 of 20 attachments", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit repair", exact: true }),
  ).toHaveCount(0);
});

test("failed upload keeps file, description and retry key until successfully saved", async ({
  page,
}) => {
  const f = await fixture(page, { fail: "503" });
  await select(page);
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Work order attachments" })
      .getByRole("alert"),
  ).toContainText("TEST upload failed");
  await expect(page.getByLabel("What does this attachment show?")).toHaveValue(
    "TEST inspection photo",
  );
  expect(
    await page
      .getByLabel("Choose a photo or document")
      .evaluate((e: HTMLInputElement) => e.files?.[0]?.name),
  ).toBe("inspection.png");
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page.getByText("1 of 20 attachments", { exact: false }),
  ).toBeVisible();
  const key = (s: string) => s.match(/name="requestId"\r\n\r\n([^\r]+)/)?.[1];
  expect(key(f.requests[0])).toBeTruthy();
  expect(key(f.requests[0])).toBe(key(f.requests[1]));
});

test("stale upload blocks further actions until explicit reload", async ({
  page,
}) => {
  const f = await fixture(page, { fail: "409" });
  await select(page);
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save attachment", exact: true }),
  ).toBeDisabled();
  expect(f.requests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Reload work order", exact: true })
    .click();
  await expect(page.getByLabel("Choose a photo or document")).toBeEnabled();
});

test("client rejects unsupported and oversized files without an upload request", async ({
  page,
}) => {
  const f = await fixture(page);
  await select(page, "unsafe.svg", Buffer.from("<svg/>"));
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Work order attachments" })
      .getByRole("alert"),
  ).toContainText("Choose a JPEG, PNG or PDF");
  await select(page, "large.png", Buffer.alloc(5 * 1024 * 1024 + 1));
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Work order attachments" })
      .getByRole("alert"),
  ).toContainText("5 MB or smaller");
  expect(f.requests).toHaveLength(0);
});

test("submitted evidence stays readable and explains return-before-upload workflow", async ({
  page,
}) => {
  await fixture(page, {
    role: "TECHNICIAN",
    status: "AWAITING_REVIEW",
    existing: true,
  });
  await expect(page.getByLabel("Choose a photo or document")).toHaveCount(0);
  await expect(
    page.getByText("Evidence is frozen for review.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download inspection.png" }),
  ).toBeVisible();
});

test("head reviews retained files without an upload control", async ({
  page,
}) => {
  await fixture(page, {
    role: "MAINTENANCE_HEAD",
    status: "AWAITING_REVIEW",
    existing: true,
  });
  await expect(page.getByLabel("Choose a photo or document")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download inspection.png" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve repair", exact: true }),
  ).toBeVisible();
});

test("management reads closed evidence without mutation controls", async ({
  page,
}) => {
  await fixture(page, { role: "MANAGEMENT", status: "CLOSED", existing: true });
  await expect(
    page.getByRole("button", { name: "Download inspection.png" }),
  ).toBeVisible();
  await expect(page.getByLabel("Choose a photo or document")).toHaveCount(0);
  await expect(
    page.getByText("Uploads are closed for this stage.", { exact: false }),
  ).toBeVisible();
});

test("upload expiry returns to login without a successful-save message", async ({
  page,
}) => {
  await fixture(page, { fail: "401" });
  await select(page);
  await page
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?reason=expired/);
});

test("expired download returns to login and never starts a download", async ({
  page,
}) => {
  await fixture(page, { existing: true, downloadFail: 401 });
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await page.getByRole("button", { name: "Download inspection.png" }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired/);
  expect(downloaded).toBe(false);
});
