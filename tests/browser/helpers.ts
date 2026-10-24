import { expect, type Page } from "@playwright/test";
export const userId = "f03eb9af-73c3-4a1b-abda-753c169265b2";
export const machine = {
  id: "machine-fixture",
  code: "WH-C",
  name: "Blown-film line",
  manufacturer: "Windmöller & Hölscher",
  model: null,
  operationalStatus: "NOT_MONITORED",
  department: null,
  location: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
const me = {
  userId,
  membershipId: "membership-fixture",
  displayName: "Fixture operator",
  orgId: "fixture-org",
  organization: "Supreme Industries",
  role: "OPERATOR",
};
const b64 = (x: unknown) =>
  Buffer.from(JSON.stringify(x)).toString("base64url");
const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.browser-test-signature`;
export async function setup(page: Page, role = "OPERATOR") {
  await page.route("http://127.0.0.1:54399/auth/v1/**", async (route) => {
    if (route.request().url().includes("/settings"))
      await route.fulfill({
        json: { external: { google: false, email: true } },
      });
    else if (route.request().url().includes("/token"))
      await route.fulfill({
        json: {
          access_token: token,
          refresh_token: "fixture-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "fixture@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-09-01T00:00:00Z",
          },
        },
      });
    else await route.fulfill({ json: { id: userId } });
  });
  await page.route("http://127.0.0.1:4400/api/**", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/me")
        ? { ...me, role, availableRoles: [role] }
        : path.endsWith("/work-order-notifications")
          ? { items: [], unread: 0, nextCursor: null }
          : path.endsWith("/WH-C")
            ? machine
            : { items: [machine], nextCursor: null },
    });
  });
}
export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
}
