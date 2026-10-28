// Documented intercepted Auth/API fixtures only; no operational writes.
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { setup, signIn, machine } from "./helpers";
async function fixture(page: Page, role = "ADMINISTRATOR") {
  await setup(page, role);
  let current = { ...machine, version: 1 },
    photo: any = null,
    conflict = false,
    unavailable = false,
    saveCount = 0;
  const png = await sharp({
    create: { width: 40, height: 25, channels: 3, background: "yellow" },
  })
    .webp()
    .toBuffer();
  await page.route("**/api/machines/WH-C/details", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          machine: {
            ...current,
            photo: photo ? { id: photo.id, width: 40, height: 25 } : null,
          },
          photo,
          canManage: role === "ADMINISTRATOR",
        },
      });
    saveCount++;
    if (unavailable)
      return route.fulfill({
        status: 503,
        json: { message: "TEST save unavailable" },
      });
    if (conflict)
      return route.fulfill({
        status: 409,
        json: { message: "Machine changed. Refresh before saving." },
      });
    const body = route.request().postDataJSON();
    expect(body.code).toBeUndefined();
    expect(body.orgId).toBeUndefined();
    expect(body.version).toBe(current.version);
    current = { ...current, ...body, version: current.version + 1 };
    return route.fulfill({
      json: { version: current.version, alreadySaved: false },
    });
  });
  await page.route("**/api/machines/WH-C/photo", async (route) => {
    const body = route.request().postData()!;
    expect(body).toContain('name="requestId"');
    expect(body).toContain('name="version"');
    photo = {
      id: "5b4e026f-341b-4527-adfe-b6b9bc45912c",
      uploaderName: "TEST administrator",
      createdAt: "2026-10-28T10:00:00Z",
      source: {
        filename: "TEST.png",
        mediaType: "image/png",
        byteSize: png.length,
      },
    };
    current = { ...current, version: current.version + 1 };
    return route.fulfill({
      status: 201,
      json: { version: current.version, alreadySaved: false },
    });
  });
  await page.route("**/api/machines/WH-C/photo/remove", async (route) => {
    photo = null;
    current = { ...current, version: current.version + 1 };
    return route.fulfill({
      status: 201,
      json: { version: current.version, alreadySaved: false },
    });
  });
  await page.route("**/api/machines/WH-C/photo/*", (route) =>
    route.request().method() !== "GET"
      ? route.fallback()
      : route.fulfill({
          contentType: "image/webp",
          body: png,
          headers: { "cache-control": "private, no-store" },
        }),
  );
  return {
    png,
    setConflict: (v: boolean) => {
      conflict = v;
    },
    setUnavailable: (v: boolean) => {
      unavailable = v;
    },
    count: () => saveCount,
  };
}
async function editor(page: Page) {
  await page.getByRole("button", { name: "Edit machine", exact: true }).click();
  return page.getByRole("dialog", { name: "Edit machine · WH-C" });
}
test("registry photo summaries load the picture without a details request per card", async ({
  page,
}) => {
  await fixture(page);
  const metadataRequests: string[] = [];
  page.on("request", (req) => {
    if (/\/details$/.test(new URL(req.url()).pathname))
      metadataRequests.push(req.url());
  });
  await page.route("**/api/machines", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...machine,
            version: 1,
            photo: {
              id: "5b4e026f-341b-4527-adfe-b6b9bc45912c",
              width: 40,
              height: 25,
            },
          },
          {
            ...machine,
            id: "TEST-second",
            code: "PUMP-02",
            name: "TEST spare pump",
            version: 1,
            photo: null,
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await signIn(page);
  const picture = page.getByRole("img", {
    name: "WH-C machine photograph",
    exact: true,
  });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  await expect(
    page.getByText("No machine photo recorded", { exact: true }),
  ).toHaveCount(1);
  expect(metadataRequests).toEqual([]);
});
test("registry edit popup preserves draft, readonly code, saves null unknown metadata and refreshes card", async ({
  page,
}) => {
  await fixture(page);
  await signIn(page);
  let dialog = await editor(page);
  await expect(dialog.getByLabel("Machine code")).toHaveAttribute(
    "readonly",
    "",
  );
  await dialog
    .getByLabel("Machine name", { exact: true })
    .fill("TEST updated machine");
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit machine", exact: true }),
  ).toBeFocused();
  dialog = await editor(page);
  await expect(dialog.getByLabel("Machine name", { exact: true })).toHaveValue(
    "TEST updated machine",
  );
  await dialog.getByLabel("Manufacturer", { exact: true }).fill("");
  await dialog
    .getByRole("button", { name: "Save machine details", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Machine details saved.");
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "TEST updated machine" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("retry refreshes a registry photo replaced after the machine list was loaded", async ({
  page,
}) => {
  await fixture(page);
  const oldId = "5b4e026f-341b-4527-adfe-b6b9bc45912c";
  const newId = "8fbd2092-e7d7-4c7f-8b81-eae5f072de19";
  let refreshes = 0;
  await page.route("**/api/machines", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...machine,
            version: 1,
            photo: { id: oldId, width: 40, height: 25 },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await page.route(`**/api/machines/WH-C/photo/${oldId}`, (route) =>
    route.fulfill({
      status: 404,
      json: { message: "Photo changed. Refresh the machine." },
    }),
  );
  await page.route("**/api/machines/WH-C/details", (route) => {
    refreshes++;
    return route.fulfill({
      json: {
        machine: {
          ...machine,
          version: 2,
          photo: { id: newId, width: 40, height: 25 },
        },
        photo: { id: newId, width: 40, height: 25 },
        canManage: true,
      },
    });
  });
  await signIn(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Photo changed." }),
  ).toBeVisible();
  expect(refreshes).toBe(0);
  await page.getByRole("button", { name: "Retry photo", exact: true }).click();
  const picture = page.getByRole("img", {
    name: "WH-C machine photograph",
    exact: true,
  });
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBe(40);
  expect(refreshes).toBe(1);
});
test("stale save retains draft and requires deliberate refresh; dependency failure is visible", async ({
  page,
}) => {
  const state = await fixture(page);
  await signIn(page);
  const dialog = await editor(page);
  await dialog.getByLabel("Machine name", { exact: true }).fill("TEST unsaved");
  state.setConflict(true);
  await dialog
    .getByRole("button", { name: "Save machine details", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Save machine details", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Machine name", { exact: true })).toHaveValue(
    "TEST unsaved",
  );
  await dialog
    .getByRole("button", { name: "Refresh machine and discard draft" })
    .click();
  await expect(dialog.getByLabel("Machine name", { exact: true })).toHaveValue(
    machine.name,
  );
  state.setConflict(false);
  state.setUnavailable(true);
  await dialog
    .getByRole("button", { name: "Save machine details", exact: true })
    .click();
  await expect(dialog.getByText("TEST save unavailable")).toBeVisible();
  expect(state.count()).toBe(2);
});
test("photo file survives closing, uploads privately, displays in registry and overview, then removes", async ({
  page,
}) => {
  const state = await fixture(page);
  await signIn(page);
  let dialog = await editor(page);
  // setInputFiles can target disabled controls; wait for the real user-editable state.
  await expect(dialog.getByLabel("Choose machine photo")).toBeEnabled();
  await dialog.getByLabel("Choose machine photo").setInputFiles({
    name: "TEST.png",
    mimeType: "image/png",
    buffer: state.png,
  });
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  dialog = await editor(page);
  await expect(
    dialog.getByRole("button", { name: "Upload machine photo", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Upload machine photo", exact: true })
    .click();
  await expect(
    dialog.getByText("Machine photo saved.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "WH-C machine photograph" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /WH-C.*Blown-film line/ }).click();
  await expect(page).toHaveURL(/\/machines\/WH-C$/);
  await expect(
    page.getByRole("img", { name: "WH-C machine photograph" }),
  ).toBeVisible();
  await page.screenshot({
    path: `.local/machine-editing/overview-${test.info().project.name}.png`,
    fullPage: true,
  });
  dialog = await editor(page);
  await expect(
    dialog.getByText(/Uploaded by TEST administrator/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Remove machine photo", exact: true })
    .click();
  await expect(
    dialog.getByText("Machine photo removed.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close form", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "WH-C machine photograph" }),
  ).toHaveCount(0);
});
for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "MAINTENANCE_HEAD",
  "SUPERVISOR",
  "MANAGEMENT",
])
  test(`${role} has no machine metadata/photo controls`, async ({ page }) => {
    await fixture(page, role);
    await signIn(page);
    await expect(
      page.getByRole("button", { name: "Edit machine", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: /WH-C.*Blown-film line/ }).click();
    await expect(
      page.getByRole("button", { name: "Edit machine", exact: true }),
    ).toHaveCount(0);
  });

test("registry cards remain filled panels with separate navigation and retry for multiple missing-photo assets", async ({
  page,
}) => {
  await fixture(page);
  const pump = {
    ...machine,
    id: "TEST-pump",
    code: "PUMP-02",
    name: "TEST spare pump",
    manufacturer: null,
    version: 1,
  };
  await page.route("**/api/machines", (route) =>
    route.fulfill({
      json: { items: [{ ...machine, version: 1 }, pump], nextCursor: null },
    }),
  );
  await page.route("**/api/machines/PUMP-02/details", (route) =>
    route.fulfill({ json: { machine: pump, photo: null, canManage: true } }),
  );
  let fail = true;
  await page.route("**/api/machines/WH-C/details", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { message: "TEST photo temporarily unavailable" },
        })
      : route.fulfill({
          json: {
            machine: { ...machine, version: 1 },
            photo: null,
            canManage: true,
          },
        }),
  );
  await signIn(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(
    page.getByText("No machine photo recorded", { exact: true }),
  ).toHaveCount(1);
  const retry = page.getByRole("button", { name: "Retry photo", exact: true });
  await expect(retry).toBeVisible();
  expect(await retry.evaluate((node) => node.closest("a"))).toBeNull();
  fail = false;
  await retry.click();
  await expect(
    page.getByText("No machine photo recorded", { exact: true }),
  ).toHaveCount(2);
  for (const card of await page.getByRole("article").all()) {
    const style = await card.evaluate((node) => ({
      display: getComputedStyle(node).display,
      background: getComputedStyle(node).backgroundColor,
      width: node.getBoundingClientRect().width,
    }));
    expect(style.display).toBe("flex");
    expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.width).toBeGreaterThan(250);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.local/machine-editing/registry-missing-two-${test.info().project.name}.png`,
    fullPage: true,
  });
});
