// Public-page and navigation checks use the repository's isolated Auth/API fixtures.
import { test, expect } from "@playwright/test";
import { setup, signIn } from "./helpers";

test("public landing explains the platform and uses local fonts without fetching private records", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  const externalFonts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(":4400/api/"))
      privateRequests.push(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(request.url()))
      externalFonts.push(request.url());
  });
  await setup(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Less guesswork. More forward.",
    }),
  ).toBeVisible();
  await expect(page.locator(".landing-feature")).toHaveCount(6);
  await expect(
    page.getByRole("link", { name: "Dashboard", exact: true }),
  ).toHaveAttribute("href", "/machines");
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toContain("geist");
  expect(privateRequests).toEqual([]);
  expect(externalFonts).toEqual([]);
  await page.screenshot({
    path: `test-results/landing-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("landing Dashboard entry preserves the sign-in boundary", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/login-redesign-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Back to website", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
});

test("signed-in users can visit the public page and re-enter their authorized registry", async ({
  page,
}) => {
  await setup(page);
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Less guesswork.",
  );
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(
    page.getByRole("heading", { name: "Asset registry", exact: true }),
  ).toBeVisible();
});

test("workspace navigation has a current page and an accessible collapsible mobile menu", async ({
  page,
  isMobile,
}) => {
  await setup(page, "MAINTENANCE_HEAD");
  await signIn(page);
  await page.goto("/machines/WH-C");
  await expect(
    page.getByRole("heading", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  if (isMobile) {
    await expect(navigation).toBeHidden();
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await expect(navigation).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close navigation", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await navigation
      .getByRole("link", { name: "Machine overview", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  }
  await expect(
    navigation.getByRole("link", { name: "Machine overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    navigation.getByRole("link", { name: "Email alerts", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/navigation-${test.info().project.name}.png`,
    fullPage: true,
  });
  await navigation
    .getByRole("link", { name: "Asset registry", exact: true })
    .click();
  await expect(page).toHaveURL(/\/machines$/);
  if (isMobile) await expect(navigation).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("landing keyboard skip link and reduced motion remain usable at narrow widths", async ({
  page,
}) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
