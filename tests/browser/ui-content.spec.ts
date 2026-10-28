// Intercepted Auth/API fixtures only; these tests never write operational records.
import { test, expect } from "@playwright/test";
import { setup, signIn, machine } from "./helpers";

for (const role of ["ADMINISTRATOR", "MAINTENANCE_HEAD", "OPERATOR"]) {
  test(`reference empty state keeps approval limits for ${role}`, async ({
    page,
  }) => {
    await setup(page, role);
    const manager = role !== "OPERATOR";
    await page.route("**/api/machines/WH-C/documents**", async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        json: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          canManage: manager,
          canApprove: role === "MAINTENANCE_HEAD",
          maxBytes: 5 * 1024 * 1024,
          maxDocuments: 200,
          maxVersions: 100,
        },
      });
    });
    await signIn(page);
    await page.goto("/machines/WH-C/documents");
    await expect(
      page.getByText(
        manager
          ? "Upload a manual or SOP as a draft for Maintenance head review."
          : "No approved references are available for these filters. Ask the Maintenance head about the required reference.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Upload reference", exact: true }),
    ).toHaveCount(manager ? 1 : 0);
    await expect(
      page.getByText(/Approval records a human reference review/),
    ).toBeVisible();
    if (manager)
      await expect(
        page.getByText(
          /Only the active Maintenance head can approve or withdraw/,
        ),
      ).toBeVisible();
    await expect(page.getByText(/preloaded/)).toHaveCount(0);
  });

  test(`calendar empty state keeps head release authority for ${role}`, async ({
    page,
  }) => {
    await setup(page, role);
    await page.route("**/api/machines/WH-C/calendar**", async (route) => {
      expect(route.request().method()).toBe("GET");
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({
        json: path.endsWith("/plans")
          ? { items: [], canManage: role === "MAINTENANCE_HEAD" }
          : path.endsWith("/reminders")
            ? { items: [], unread: 0, nextCursor: null }
            : {
                items: [],
                counts: {},
                dayCounts: {},
                nextCursor: null,
                canManage: role === "MAINTENANCE_HEAD",
                serverTime: new Date().toISOString(),
                scheduling: {
                  failed: false,
                  catchingUp: false,
                  lastJobAt: null,
                },
              },
      });
    });
    await page.route("**/api/machines/WH-C/work-orders/technicians", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await signIn(page);
    await page.goto("/machines/WH-C/calendar");
    await expect(
      page.getByRole("heading", { name: "Maintenance calendar", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Create maintenance plan",
        exact: true,
      }),
    ).toHaveCount(role === "MAINTENANCE_HEAD" ? 1 : 0);
    await page.getByRole("tab", { name: "Plans", exact: true }).click();
    await expect(
      page.getByText("The Maintenance head can create the first plan.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/sample company schedule/)).toHaveCount(0);
    if (role === "MAINTENANCE_HEAD") {
      await page
        .getByRole("button", { name: "Create maintenance plan", exact: true })
        .click();
      await expect(
        page.getByText(
          "No eligible technicians are available. An active technician with access to this machine is required.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText(/Each task requires release by the maintenance head/),
      ).toBeVisible();
    }
  });
}

test("email handoffs identify the selected machine and preserve delivery uncertainty", async ({
  page,
}) => {
  await setup(page, "TECHNICIAN");
  await page.route("**/api/machines/PRESS-02", (route) =>
    route.fulfill({ json: { ...machine, code: "PRESS-02" } }),
  );
  await page.route(
    "**/api/machines/PRESS-02/external-notifications**",
    async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        json: {
          role: "TECHNICIAN",
          supported: true,
          configured: true,
          preference: {
            enabled: false,
            version: 0,
            destination: null,
            enabledAt: null,
            verifiedAt: null,
          },
          deliveries: [
            {
              id: "test-delivery",
              orderId: "test-order",
              action: "ASSIGN",
              attemptCount: 1,
              status: "PENDING",
              eventAt: "2026-10-27T04:30:15Z",
              updatedAt: "2026-10-27T04:30:15Z",
              code: "NETWORK_UNCERTAIN",
              attempts: [],
              nextAttemptAt: null,
            },
          ],
        },
      });
    },
  );
  await signIn(page);
  await page.goto("/machines/PRESS-02/notification-settings");
  await expect(
    page.getByText("PRESS-02 · Your active Technician role", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Email acceptance is unconfirmed; an automatic retry/),
  ).toBeVisible();
  await expect(page.getByText(/inbox delivery is not confirmed/)).toBeVisible();
});
