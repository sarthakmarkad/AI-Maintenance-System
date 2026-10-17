// Browser responses are intercepted fixtures; real integration evidence is separate.
import { test, expect } from "@playwright/test";
import { setup, signIn, machine } from "./helpers";
test("unauthenticated access returns to sign in", async ({ page }) => {
  await page.goto("/machines/WH-C");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
test("login, machine registry and WH-C page use the API contract and fit the viewport", async ({
  page,
}) => {
  await setup(page);
  await signIn(page);
  await page.getByRole("link", { name: /WH-C.*Blown-film line/ }).click();
  await expect(
    page.getByRole("heading", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Not yet confirmed", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Live status unavailable")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open production records" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/machine-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test("loading and empty states explain machine access", async ({ page }) => {
  await setup(page);
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/machines", async (route) => {
    await wait;
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await signIn(page);
  await expect(page.getByRole("status")).toContainText(
    "Loading your machine records",
  );
  release();
  await expect(
    page.getByRole("heading", { name: "No machines assigned yet" }),
  ).toBeVisible();
});
test("API failure exposes a useful retry and succeeds after recovery", async ({
  page,
}) => {
  await setup(page);
  let failed = true;
  await page.route("**/api/machines", async (route) => {
    if (failed)
      await route.fulfill({
        status: 503,
        json: { message: "A required service is unavailable." },
      });
    else await route.fulfill({ json: { items: [machine], nextCursor: null } });
  });
  await signIn(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "A required service is unavailable" }),
  ).toContainText("A required service is unavailable");
  failed = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("link", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
});
test("expired API authentication clears the session and prompts sign in", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { message: "Session expired." } }),
  );
  await page.goto("/login");
  await page.getByLabel("Work email").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/reason=expired/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Your session expired" }),
  ).toContainText("Your session expired");
});
test("invalid login is actionable", async ({ page }) => {
  await setup(page);
  await page.route("**/auth/v1/token?*", (route) =>
    route.fulfill({
      status: 400,
      json: {
        error: "invalid_grant",
        error_description: "Invalid login credentials",
      },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Work email").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "email or password was not accepted" }),
  ).toContainText("email or password was not accepted");
});
