import { test, expect, type Page } from "@playwright/test";
import { setup, signIn } from "./helpers";
import {
  flag,
  emptyPatterns,
  trendFixture,
  receipt,
} from "./anomalies-fixtures";
type Options = {
  role?: string;
  retry?: boolean;
  conflict?: boolean;
  unavailable?: boolean;
  insufficient?: boolean;
  expired?: boolean;
  paging?: boolean;
  savedReview?: boolean;
  openingFailure?: boolean;
  directoryFailure?: boolean;
};
const technicianId = "11111111-1111-4111-8111-111111111111";
async function mocks(page: Page, o: Options = {}) {
  await setup(page, o.role ?? "MAINTENANCE_HEAD");
  let review: Record<string, unknown> | null = o.savedReview
      ? {
          id: "bbaf1720-4936-4e35-8d96-14f6805be423",
          key: flag.key,
          decision: "INVESTIGATE",
          reason: "TEST retained earlier review",
          reviewedBy: "TEST-head",
          reviewerName: "TEST reviewer",
          actorRole: "MAINTENANCE_HEAD",
          createdAt: receipt,
          workOrderId: null,
          workOrderStatus: null,
          technicianId: null,
        }
      : null,
    failed = false,
    unavailable = Boolean(o.unavailable),
    openingFailed = false,
    directoryFailed = false;
  await page.route(
    "**/api/machines/WH-C/work-orders/technicians",
    async (route) => {
      if (o.directoryFailure && !directoryFailed) {
        directoryFailed = true;
        await route.fulfill({
          status: 503,
          json: { message: "TEST directory temporarily unavailable" },
        });
        return;
      }
      await route.fulfill({
        json: {
          items: [{ userId: technicianId, displayName: "TEST technician" }],
        },
      });
    },
  );
  await page.route("**/api/machines/WH-C/readings/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/trends")) {
      const t = trendFixture();
      if (url.searchParams.has("from")) {
        t.from = url.searchParams.get("from")!;
        t.to = url.searchParams.get("to")!;
      }
      await route.fulfill({ json: t });
      return;
    }
    if (o.expired) {
      await route.fulfill({
        status: 401,
        json: { message: "Session expired." },
      });
      return;
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (url.pathname.endsWith("/investigation")) {
        expect(body).toEqual({ technicianId });
        if (o.openingFailure && !openingFailed) {
          openingFailed = true;
          await route.fulfill({
            status: 503,
            json: { message: "TEST opening temporarily unavailable" },
          });
          return;
        }
        review = {
          ...review,
          workOrderId: "c25dfdba-fb43-47d5-8055-34d10a22834a",
          workOrderStatus: "ASSIGNED",
          technicianId,
        };
        await route.fulfill({ status: 201, json: review });
        return;
      }
      expect(body.key).toBe(flag.key);
      expect(body.measuredAt).toBe(flag.measuredAt);
      expect(body.reason).toMatch(/^TEST /);
      if (o.retry && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: { message: "Review service unavailable. Try again." },
        });
        return;
      }
      if (o.conflict) {
        await route.fulfill({
          status: 409,
          json: { message: "This evidence has already been reviewed." },
        });
        return;
      }
      expect(body.technicianId).toBeUndefined();
      review = {
        id: "bbaf1720-4936-4e35-8d96-14f6805be423",
        key: flag.key,
        decision: body.decision,
        reason: body.reason,
        reviewedBy: "TEST-head",
        reviewerName: "TEST reviewer",
        actorRole: "MAINTENANCE_HEAD",
        createdAt: receipt,
        workOrderId: null,
        workOrderStatus: null,
        technicianId: null,
      };
      await route.fulfill({ status: 201, json: review });
      return;
    }
    if (url.pathname.endsWith("/reviews")) {
      await route.fulfill({
        json: {
          canOpenInvestigation:
            (o.role ?? "MAINTENANCE_HEAD") === "MAINTENANCE_HEAD",
          items: review ? [{ ...review, evidence: flag }] : [],
          nextCursor: null,
        },
      });
      return;
    }
    if (unavailable) {
      await route.fulfill({
        status: 503,
        json: {
          message: "Pattern analysis is temporarily unavailable. Try again.",
        },
      });
      return;
    }
    const noMatches =
      url.searchParams.get("parameter") === "pressureBar" ||
      (url.searchParams.get("status") === "PENDING" && !!review);
    const item = url.searchParams.has("after")
      ? {
          ...flag,
          key: "c".repeat(64),
          kind: "DRIFT",
          samples: flag.samples,
          slope: 2,
        }
      : flag;
    const result = {
      ...emptyPatterns(),
      canReview: (o.role ?? "MAINTENANCE_HEAD") === "MAINTENANCE_HEAD",
      observations: 48,
      eligible: { SUDDEN_CHANGE: 24, SUSTAINED_SHIFT: 22, DRIFT: 19 },
      total: o.paging ? 2 : 1,
      pending: review ? 0 : 1,
      reviewed: review ? 1 : 0,
      matching: noMatches ? 0 : o.paging ? 2 : 1,
      markers: noMatches
        ? []
        : [
            {
              parameter: flag.parameter,
              measuredAt: flag.measuredAt,
              value: 230,
            },
          ],
      items: noMatches ? [] : [{ ...item, review }],
      nextCursor: o.paging && !url.searchParams.has("after") ? flag.key : null,
    };
    if (o.insufficient)
      Object.assign(result, emptyPatterns(), {
        observations: 10,
        insufficientHistory: 10,
      });
    await route.fulfill({ json: result });
  });
  return {
    recover: () => {
      unavailable = false;
    },
  };
}

async function open(page: Page) {
  await signIn(page);
  await page.goto("/machines/WH-C/readings");
  await expect(
    page.getByRole("heading", { name: "Statistical patterns", exact: true }),
  ).toBeVisible();
}
async function reviewForm(page: Page) {
  await page
    .getByRole("button", { name: "Review sudden change", exact: true })
    .click();
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("TEST confirm the sensor and operating context.");
}
test("statistical evidence, chart dots and read-only role fit desktop and mobile", async ({
  page,
}) => {
  await mocks(page, { role: "ADMINISTRATOR" });
  await open(page);
  await expect(page.locator(".anomaly-card .pill")).toBeVisible();
  const panel = page.getByRole("region", {
    name: "Statistical pattern analysis",
  });
  await panel.getByText("View supporting readings", { exact: true }).click();
  await panel
    .getByRole("cell", { name: "Evaluated sample", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("cell", { name: "Evaluated sample", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("TEST-24 · row 26", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review sudden change", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".recharts-line-dot")).not.toHaveCount(0);
  await panel.getByText("View supporting readings", { exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: `test-results/anomalies-panel-${test.info().project.name}.png`,
  });
  await page.screenshot({
    path: `test-results/anomalies-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("head review keeps draft after a failed retry and persists a human decision and evidence history", async ({
  page,
}) => {
  await mocks(page, { retry: true });
  await open(page);
  await page
    .getByRole("button", { name: "Review sudden change", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save review", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("TEST confirm the sensor and operating context.");
  await page
    .getByLabel("Review decision", { exact: true })
    .selectOption("DISMISSED");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Review service unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue(
    "TEST confirm the sensor and operating context.",
  );
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review sudden change", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load review history", exact: true })
    .click();
  await expect(
    page.getByText("Hot temperature · Sudden change · Dismissed", {
      exact: false,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("TEST reviewer · Maintenance head", { exact: false }),
  ).toBeVisible();
});
test("saving a needs-investigation review waits for explicit assignment", async ({
  page,
}) => {
  await mocks(page);
  await open(page);
  await reviewForm(page);
  await expect(
    page.getByLabel("Investigation technician", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open investigation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "View investigation work order",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("dismissing a flag needs no technician and opens no work order", async ({
  page,
}) => {
  await mocks(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review sudden change", exact: true })
    .click();
  await page
    .getByLabel("Review decision", { exact: true })
    .selectOption("DISMISSED");
  await expect(
    page.getByLabel("Investigation technician", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("TEST sensor was rechecked and the operating mode explains it.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review saved" }),
  ).toBeVisible();
});
test("review conflicts block actions until explicit reload", async ({
  page,
}) => {
  await mocks(page, { conflict: true });
  await open(page);
  await reviewForm(page);
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Results changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save review", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Pattern type", { exact: true })).toBeDisabled();
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Close form", exact: true }).click();
  await page
    .getByRole("button", { name: "Reload analysis", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Review statistical flag" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review sudden change", exact: true }),
  ).toBeEnabled();
});
test("server filters and next-page controls clear pending forms", async ({
  page,
}) => {
  await mocks(page, { paging: true });
  await open(page);
  await reviewForm(page);
  await page.getByRole("button", { name: "Close form", exact: true }).click();
  await page.getByRole("button", { name: "Next flags", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review gradual drift", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Review statistical flag" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "First flags", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review sudden change", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Pattern parameter", { exact: true })
    .selectOption("pressureBar");
  await expect(
    page.getByText("No flags match these filters.", { exact: true }),
  ).toBeVisible();
});
test("analysis outage can retry while existing trends remain available", async ({
  page,
}) => {
  const outage = await mocks(page, { unavailable: true });
  await open(page);
  await expect(
    page.getByText("Pattern analysis is temporarily unavailable. Try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Pressure", exact: true }),
  ).toBeVisible();
  outage.recover();
  await page
    .getByRole("button", { name: "Try pattern analysis again", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review sudden change", exact: true }),
  ).toBeVisible();
});
test("insufficient data is explicit and saved review history starts empty", async ({
  page,
}) => {
  await mocks(page, { insufficient: true });
  await open(page);
  await expect(
    page.getByText("Not enough consecutive history to evaluate patterns yet.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load review history", exact: true })
    .click();
  await expect(
    page.getByText("No saved statistical reviews yet.", { exact: true }),
  ).toBeVisible();
});
test("expired statistical requests follow the existing sign-in flow", async ({
  page,
}) => {
  await mocks(page, { expired: true });
  await signIn(page);
  await page.goto("/machines/WH-C/readings");
  await expect(page).toHaveURL(/\/login\?reason=expired$/);
});

test("saved investigation review opens explicitly, retries safely and keeps a progress link after reload", async ({
  page,
}) => {
  await mocks(page, { openingFailure: true, directoryFailure: true });
  await open(page);
  await reviewForm(page);
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open investigation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open investigation", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "directory temporarily" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry technician directory", exact: true })
    .click();
  await page
    .getByLabel("Investigation technician", { exact: true })
    .selectOption(technicianId);
  await page
    .getByRole("button", {
      name: "Confirm investigation assignment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "opening temporarily" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Investigation technician", { exact: true }),
  ).toHaveValue(technicianId);
  await page
    .getByRole("button", {
      name: "Confirm investigation assignment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("link", {
      name: "View investigation work order",
      exact: true,
    }),
  ).toHaveAttribute("href", /work-orders\/c25dfdba/);
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Close form", exact: true }).click();
  await page
    .getByRole("button", { name: "Reload analysis", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "View investigation work order",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load review history", exact: true })
    .click();
  await page.locator(".anomaly-history-list > details > summary").click();
  await expect(
    page.locator(".anomaly-history-list").getByRole("link", {
      name: "View investigation work order",
      exact: true,
    }),
  ).toBeVisible();
});

test("older saved review can open an investigation from history when the analysis worker is unavailable", async ({
  page,
}) => {
  await mocks(page, { savedReview: true, unavailable: true });
  await open(page);
  await page
    .getByRole("button", { name: "Load review history", exact: true })
    .click();
  await page.locator(".anomaly-history-list > details > summary").click();
  await page
    .getByRole("button", { name: "Open investigation", exact: true })
    .click();
  await page
    .getByLabel("Investigation technician", { exact: true })
    .selectOption(technicianId);
  await page
    .getByRole("button", {
      name: "Confirm investigation assignment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("link", {
      name: "View investigation work order",
      exact: true,
    }),
  ).toBeVisible();
});
