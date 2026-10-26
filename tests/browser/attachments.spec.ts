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
  await expect(
    page.getByRole("button", { name: "View inspection.png" }),
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

async function samplePhoto(
  page: Page,
  mediaType: "image/png" | "image/jpeg" = "image/png",
) {
  const data = await page.evaluate((type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#dcece3";
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#176b52";
    context.fillRect(100, 190, 1000, 480);
    context.fillStyle = "#142a2c";
    context.font = "42px Arial";
    context.fillText("SYNTHETIC PHOTO PREVIEW TEST", 110, 110);
    return canvas.toDataURL(type).split(",")[1];
  }, mediaType);
  return Buffer.from(data, "base64");
}
async function trackPhotoUrls(page: Page) {
  await page.addInitScript(() => {
    const record = { created: [] as string[], revoked: [] as string[] };
    (window as any).__photoUrls = record;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      record.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      record.revoked.push(url);
      revoke(url);
    };
  });
}
for (const mediaType of ["image/png", "image/jpeg"] as const) {
  test(`${mediaType} evidence opens privately without a download and releases its URL on Escape`, async ({
    page,
  }, info) => {
    await trackPhotoUrls(page);
    const state = await fixture(page, {
      existing: true,
      role: "MANAGEMENT",
      status: "CLOSED",
    });
    const filename =
      mediaType === "image/png" ? "inspection.png" : "inspection.jpg";
    state.o.attachments[0] = { ...state.o.attachments[0], filename, mediaType };
    await page.reload();
    const bytes = await samplePhoto(page, mediaType);
    await page.route("**/attachments/*/download", async (route) => {
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      expect(route.request().url()).not.toContain("token=");
      await route.fulfill({
        body: bytes,
        contentType: "application/octet-stream",
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    });
    let downloads = 0;
    page.on("download", () => {
      downloads++;
    });
    const view = page.getByRole("button", {
      name: `View ${filename}`,
      exact: true,
    });
    await view.click();
    const dialog = page.getByRole("dialog", { name: filename, exact: true });
    await expect(dialog).toBeVisible();
    const photo = dialog.getByRole("img", {
      name: "TEST inspection photo",
      exact: true,
    });
    await expect(photo).toBeVisible();
    expect(
      await photo.evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(1200);
    const url = await photo.getAttribute("src");
    expect(url).toMatch(/^blob:/);
    expect(downloads).toBe(0);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    if (mediaType === "image/png")
      await page.screenshot({
        path: info.outputPath("photo-preview.png"),
        fullPage: true,
      });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(view).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => (window as any).__photoUrls.revoked))
      .toContain(url);
    await view.click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("img", { name: "TEST inspection photo", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close photo preview" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(downloads).toBe(0);
  });
}

test("photo preview retries a failed request and preserves an unrelated evidence draft", async ({
  page,
}) => {
  const state = await fixture(page, { existing: true });
  await page
    .getByLabel("What does this attachment show?")
    .fill("TEST preserve my unsaved evidence description");
  const bytes = await samplePhoto(page);
  let calls = 0,
    failing = true;
  await page.route("**/attachments/*/download", (route) =>
    (calls++, failing)
      ? route.fulfill({
          status: 503,
          json: { message: "TEST preview temporarily unavailable" },
        })
      : route.fulfill({ body: bytes, contentType: "application/octet-stream" }),
  );
  await page.getByRole("button", { name: "View inspection.png" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  const beforeRetry = calls;
  failing = false;
  await dialog.getByRole("button", { name: "Retry photo" }).click();
  await expect(dialog.getByRole("img")).toBeVisible();
  expect(calls).toBeGreaterThan(beforeRetry);
  await dialog.getByRole("button", { name: "Close photo preview" }).click();
  await expect(page.getByLabel("What does this attachment show?")).toHaveValue(
    "TEST preserve my unsaved evidence description",
  );
  expect(state.requests).toHaveLength(0);
});

test("closing a loading preview cancels it without creating a late photo URL", async ({
  page,
}) => {
  await trackPhotoUrls(page);
  await fixture(page, { existing: true });
  let release!: () => void,
    completed = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/attachments/*/download", async (route) => {
    await gate;
    try {
      await route.fulfill({
        body: png,
        contentType: "application/octet-stream",
      });
    } catch {
      /* request was aborted on close */
    } finally {
      completed = true;
    }
  });
  await page.getByRole("button", { name: "View inspection.png" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Loading photo…",
  );
  await page.getByRole("button", { name: "Close photo preview" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release();
  await expect.poll(() => completed).toBe(true);
  expect(
    await page.evaluate(() => (window as any).__photoUrls.created),
  ).toHaveLength(0);
});

test("a malformed photo shows a recoverable preview error", async ({
  page,
}) => {
  await fixture(page, { existing: true });
  await page.route("**/attachments/*/download", (route) =>
    route.fulfill({
      body: Buffer.from("TEST invalid raster bytes"),
      contentType: "application/octet-stream",
    }),
  );
  await page.getByRole("button", { name: "View inspection.png" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "photo could not be displayed",
  );
  await expect(
    dialog.getByRole("button", { name: "Retry photo" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Close photo preview" }).click();
  await expect(
    page.getByRole("button", { name: "Download inspection.png" }),
  ).toBeEnabled();
});

for (const status of [401, 403]) {
  test(`photo preview honors ${status} access denial without rendering bytes or downloading`, async ({
    page,
  }) => {
    await trackPhotoUrls(page);
    await fixture(page, { existing: true, downloadFail: status });
    let downloads = 0;
    page.on("download", () => {
      downloads++;
    });
    await page.getByRole("button", { name: "View inspection.png" }).click();
    if (status === 401) await expect(page).toHaveURL(/\/login\?reason=expired/);
    else
      await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
        "denied",
      );
    expect(
      await page.evaluate(() => (window as any).__photoUrls.created),
    ).toHaveLength(0);
    expect(downloads).toBe(0);
  });
}

test("PDF evidence keeps its download action without a raster preview", async ({
  page,
}) => {
  const state = await fixture(page, { existing: true });
  state.o.attachments[0] = {
    ...state.o.attachments[0],
    filename: "inspection.pdf",
    mediaType: "application/pdf",
  };
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Download inspection.pdf" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View inspection.pdf" }),
  ).toHaveCount(0);
});
