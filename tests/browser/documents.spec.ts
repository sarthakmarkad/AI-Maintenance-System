// Browser Auth/API fixtures only. Real scope/atomicity/bytes belong to documents.integration.ts.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
import type { Me } from "../../apps/web/lib/api";
import type {
  MachineDocument,
  DocumentLibrary,
} from "../../apps/web/components/document-library-types";
const documentId = "c25dfdba-fb43-47d5-8055-34d10a22834a",
  firstId = "e13bf676-507d-416b-bb9a-76ca8b100e6f",
  secondId = "0d598118-8049-47c3-a1cb-b42df77e4c09",
  base = "/machines/WH-C/documents";
const pdf = Buffer.from("%PDF-1.7\nTEST synthetic browser reference\n%%EOF\n");
const file = {
  id: firstId,
  number: 1,
  filename: "TEST manual.pdf",
  description: "TEST original approved reference",
  byteSize: pdf.length,
  sha256: "a".repeat(64),
  status: "CURRENT" as const,
};
function model(): MachineDocument {
  return {
    id: documentId,
    title: "TEST machine manual",
    kind: "MANUAL",
    version: 2,
    createdAt: "2026-10-01T04:00:00Z",
    currentFileId: firstId,
    files: [{ ...file }],
    events: [
      {
        id: "upload",
        fileId: firstId,
        revision: 1,
        action: "UPLOAD",
        reason: "TEST original draft",
        actorId: userId,
        actorName: "TEST administrator",
        actorRole: "ADMINISTRATOR",
        at: "2026-10-01T04:00:00Z",
      },
      {
        id: "approval",
        fileId: firstId,
        revision: 2,
        action: "APPROVE",
        reason: "TEST human approval",
        actorId: userId,
        actorName: "TEST head",
        actorRole: "MAINTENANCE_HEAD",
        at: "2026-10-02T04:00:00Z",
      },
    ],
  };
}
async function fixture(
  page: Page,
  role: Me["role"] = "MAINTENANCE_HEAD",
  failure = 0,
  empty = false,
) {
  await setup(page, role);
  const d = model(),
    requests: string[] = [],
    actionBodies: any[] = [],
    downloads: string[] = [];
  let failed = false;
  await page.route("**/api/machines/WH-C/documents**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    expect(req.headers().authorization).toMatch(/^Bearer /);
    expect(url.searchParams.has("token")).toBe(false);
    if (url.pathname.endsWith("/download")) {
      downloads.push(req.url());
      await route.fulfill(
        failure === 401
          ? { status: 401, json: { message: "TEST expired" } }
          : { body: pdf, contentType: "application/octet-stream" },
      );
      return;
    }
    if (req.method() === "POST") {
      if (url.pathname.includes("/actions/")) {
        const body = req.postDataJSON();
        actionBodies.push(body);
        if (failure && !failed) {
          failed = true;
          await route.fulfill({
            status: failure,
            json: { message: "TEST reference changed. Reload and review." },
          });
          return;
        }
        d.version++;
        const withdraw = url.pathname.endsWith("withdraw");
        d.files = d.files.map((f) => ({
          ...f,
          status:
            f.id === body.fileId
              ? withdraw
                ? "WITHDRAWN"
                : "CURRENT"
              : f.status === "CURRENT"
                ? "SUPERSEDED"
                : f.status,
        }));
        d.currentFileId = withdraw ? null : body.fileId;
        d.events.push({
          id: "action" + d.version,
          fileId: body.fileId,
          revision: d.version,
          action: withdraw ? "WITHDRAW" : "APPROVE",
          reason: body.reason,
          actorId: userId,
          actorName: "TEST head",
          actorRole: "MAINTENANCE_HEAD",
          at: "2026-10-03T04:00:00Z",
        });
      } else {
        requests.push(req.postDataBuffer()!.toString("utf8"));
        if (failure && !failed) {
          failed = true;
          await route.fulfill({
            status: failure,
            json: {
              message:
                failure === 409
                  ? "TEST reference changed. Reload and review."
                  : "TEST service unavailable. Try again.",
            },
          });
          return;
        }
        d.version++;
        d.files.unshift({
          ...file,
          id: secondId,
          number: 2,
          status: "DRAFT",
          filename: "revision.pdf",
          description: "TEST revised instructions",
        });
        d.events.push({
          id: "revision",
          fileId: secondId,
          revision: d.version,
          action: "UPLOAD",
          reason: "TEST revised instructions",
          actorId: userId,
          actorName: "TEST uploader",
          actorRole: role,
          at: "2026-10-03T03:00:00Z",
        });
      }
      await route.fulfill({
        status: req.url().includes("actions") ? 200 : 201,
        json: {
          documentId: d.id,
          fileId: secondId,
          revision: d.version,
          alreadyApplied: false,
        },
      });
      return;
    }
    if (url.pathname.endsWith(documentId)) {
      await route.fulfill({ json: d });
      return;
    }
    const manager = ["MAINTENANCE_HEAD", "ADMINISTRATOR"].includes(role);
    const view = {
      ...d,
      files: d.files.filter((f) => manager || f.id === d.currentFileId),
      events: d.events.filter((e) => manager || e.fileId === d.currentFileId),
    };
    const match =
      (!url.searchParams.get("q") ||
        d.title
          .toLowerCase()
          .includes(url.searchParams.get("q")!.toLowerCase())) &&
      ["ALL", null, d.kind].includes(url.searchParams.get("kind"));
    const library: DocumentLibrary = {
      items: empty || !match ? [] : [view],
      total: empty || !match ? 0 : 1,
      page: 1,
      pageSize: 20,
      canManage: manager,
      canApprove: role === "MAINTENANCE_HEAD",
      maxBytes: 5 * 1024 * 1024,
      maxDocuments: 200,
      maxVersions: 100,
    };
    await route.fulfill({ json: library });
  });
  await signIn(page);
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "Machine manuals & SOPs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh library" }),
  ).toBeVisible();
  return { d, requests, actionBodies, downloads };
}
async function revision(page: Page) {
  await page.getByRole("button", { name: "Upload revision" }).click();
  await page
    .getByLabel("Revision description")
    .fill("TEST revised instructions");
  await page.getByLabel("PDF file", { exact: true }).setInputFiles({
    name: "revision.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
}

test("head uploads revision, reviews immutable evidence, approves replacement and withdraws with reason", async ({
  page,
}) => {
  const state = await fixture(page);
  await revision(page);
  await page.getByRole("button", { name: "Save unapproved draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download approved PDF" }),
  ).toBeVisible();
  expect(state.d.currentFileId).toBe(firstId);
  await page.getByRole("button", { name: "Details & history" }).click();
  await expect(page.getByText("Draft · unapproved · v2")).toBeVisible();
  await expect(page.getByText("TEST human approval")).toBeVisible();
  await expect(page.getByText(/SHA-256/)).toHaveCount(2);
  await page.getByRole("button", { name: "Review approval v2" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm approval" }),
  ).toBeDisabled();
  await page
    .getByLabel("Approval review reason")
    .fill("TEST reviewed revised instructions");
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(
    page.getByText("Reference approved.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Obsolete · superseded · v1")).toBeVisible();
  expect(state.actionBodies[0].version).toBe(3);
  expect(state.d.currentFileId).toBe(secondId);
  if (process.env.DOCUMENTS_SCREENSHOTS)
    await page.screenshot({
      path: `.local/documents-${test.info().project.name}.png`,
      fullPage: true,
    });
  await page.getByRole("button", { name: "Withdraw approval v2" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm withdrawal" }),
  ).toBeDisabled();
  await page
    .getByLabel("Withdrawal reason")
    .fill("TEST instructions require correction");
  await page.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(
    page.getByText("Approval withdrawn.", { exact: false }),
  ).toBeVisible();
  expect(state.d.currentFileId).toBe(null);
  await expect(page.getByText("Obsolete · withdrawn · v2")).toBeVisible();
});

for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "SUPERVISOR",
  "MANAGEMENT",
  "ADMINISTRATOR",
] as const) {
  test(`${role} has approved browse/download with isolated engineering controls`, async ({
    page,
  }) => {
    const state = await fixture(page, role);
    await expect(
      page.getByRole("button", { name: "Upload revision" }),
    ).toHaveCount(role === "ADMINISTRATOR" ? 1 : 0);
    await page.getByRole("button", { name: "Details & history" }).click();
    await expect(
      page.getByRole("button", { name: /Review approval|Withdraw approval/ }),
    ).toHaveCount(0);
    const saved = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download approved PDF" }).click();
    expect((await saved).suggestedFilename()).toBe("TEST manual.pdf");
    expect(state.downloads.length).toBe(1);
    expect(new URL(state.downloads[0]).searchParams.get("version")).toBe("2");
    await expect(page.getByLabel("Upload reference draft")).toHaveCount(
      role === "ADMINISTRATOR" ? 1 : 0,
    );
  });
}

test("transient upload failure retains fields/file and reuses exact request key without changing current approval", async ({
  page,
}) => {
  const state = await fixture(page, "ADMINISTRATOR", 503);
  await revision(page);
  await page.getByRole("button", { name: "Save unapproved draft" }).click();
  await expect(
    page.getByRole("alert", { name: "Document request error" }),
  ).toContainText("TEST service unavailable");
  await expect(page.getByLabel("Revision description")).toHaveValue(
    "TEST revised instructions",
  );
  await page.getByRole("button", { name: "Save unapproved draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: false })).toBeVisible();
  expect(state.requests.length).toBe(2);
  const key = (body: string) =>
    body.match(/name="requestId"\r\n\r\n([^\r]+)/)![1];
  expect(key(state.requests[0])).toBe(key(state.requests[1]));
  expect(state.d.currentFileId).toBe(firstId);
});

test("stale revision blocks retry until explicit reload and keeps the same logical reference", async ({
  page,
}) => {
  const state = await fixture(page, "ADMINISTRATOR", 409);
  await revision(page);
  await page.getByRole("button", { name: "Save unapproved draft" }).click();
  await expect(
    page.getByRole("alert", { name: "Document request error" }),
  ).toContainText("Reload the library");
  await expect(
    page.getByRole("button", { name: "Save unapproved draft" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Revision description")).toHaveValue(
    "TEST revised instructions",
  );
  state.d.version = 7;
  await page.getByRole("button", { name: "Reload library" }).click();
  await expect(
    page.getByRole("heading", { name: "Upload revision: TEST machine manual" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save unapproved draft" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save unapproved draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: false })).toBeVisible();
  expect(state.requests[1]).toMatch(/name="version"\r\n\r\n7/);
  expect(state.d.currentFileId).toBe(firstId);
});

test("stale head decision requires reload and never silently retries approval", async ({
  page,
}) => {
  const state = await fixture(page, "MAINTENANCE_HEAD", 409);
  await page.getByRole("button", { name: "Details & history" }).click();
  await page.getByRole("button", { name: "Withdraw approval v1" }).click();
  await page
    .getByLabel("Withdrawal reason")
    .fill("TEST approval review changed");
  await page.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(
    page.getByRole("alert", { name: "Document request error" }),
  ).toContainText("Reload the library");
  await expect(
    page.getByRole("button", { name: "Confirm withdrawal" }),
  ).toBeDisabled();
  expect(state.actionBodies.length).toBe(1);
  expect(state.d.currentFileId).toBe(firstId);
  await page.getByRole("button", { name: "Reload library" }).click();
  await expect(page.getByLabel("Head reference review")).toHaveCount(0);
});

test("filters apply explicitly, empty state has no invented references, mobile has no horizontal overflow", async ({
  page,
}) => {
  await fixture(page, "OPERATOR");
  await page.getByLabel("Search title").fill("missing reference");
  await expect(
    page.getByRole("heading", { name: "TEST machine manual" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No references match" }),
  ).toBeVisible();
  await expect(
    page.getByText("No approved references are available", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("expired private download follows existing sign-in flow", async ({
  page,
}) => {
  await fixture(page, "OPERATOR", 401);
  await page.getByRole("button", { name: "Download approved PDF" }).click();
  await expect(page).toHaveURL(/\/login\?reason=expired/);
});

test("revoked document access clears cached references and management drafts until a successful reload", async ({
  page,
}) => {
  await fixture(page, "ADMINISTRATOR");
  await revision(page);
  await page.route("**/documents/**/download?*", (route) =>
    route.fulfill({
      status: 403,
      json: { message: "TEST document access revoked" },
    }),
  );
  await page.getByRole("button", { name: "Download approved PDF" }).click();
  await expect(
    page.getByRole("alert", { name: "Document request error" }),
  ).toContainText("access revoked");
  await expect(
    page.getByRole("region", { name: "Document library", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Revision description")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save unapproved draft" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reload library" }).click();
  await expect(
    page.getByRole("heading", { name: "TEST machine manual", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Revision description")).toHaveValue("");
});
