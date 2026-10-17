// Client fixtures only. Trusted grants and actual state changes are checked in PostgreSQL tests.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId } from "./helpers";
import { Role } from "@prisma/client";
const roles = Object.values(Role);
async function google(
  page: Page,
  mode:
    | "ok"
    | "denied"
    | "missing-verifier"
    | "expired"
    | "no-membership"
    | "api-unavailable" = "ok",
) {
  await setup(page, "ADMINISTRATOR");
  await page.route("**/auth/v1/settings", (r) =>
    r.fulfill({ json: { external: { email: true, google: true } } }),
  );
  let exchangeCount = 0,
    workspaceUnavailable = mode === "api-unavailable";
  const requests: any[] = [];
  await page.route("**/auth/v1/authorize?**", async (r) => {
    const u = new URL(r.request().url());
    requests.push(u);
    expect(u.searchParams.get("provider")).toBe("google");
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("access_type")).toBeNull();
    const callback = new URL(u.searchParams.get("redirect_to")!);
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.origin).toBe("http://127.0.0.1:3100");
    // A controlled provider redirect, not a real Google authentication claim.
    callback.searchParams.set(
      mode === "denied" ? "error" : "code",
      mode === "denied" ? "access_denied" : "fixture-auth-code",
    );
    await r.fulfill({
      status: 302,
      headers: { location: callback.href },
      body: "",
    });
  });
  await page.route("**/auth/v1/token?grant_type=pkce", async (r) => {
    exchangeCount++;
    expect(r.request().postDataJSON().auth_code).toBe("fixture-auth-code");
    expect(r.request().postDataJSON().code_verifier.length).toBeGreaterThan(40);
    if (mode === "expired") {
      await r.fulfill({
        status: 400,
        json: { error_code: "flow_state_expired", msg: "Expired code" },
      });
      return;
    }
    await r.fallback();
  });
  if (["no-membership", "api-unavailable"].includes(mode))
    await page.route("**/api/me", async (r) => {
      if (mode === "no-membership") {
        await r.fulfill({ status: 403, json: { message: "No membership" } });
        return;
      }
      if (workspaceUnavailable) {
        await r.fulfill({ status: 503, json: { message: "Unavailable" } });
        return;
      }
      await r.fallback();
    });
  return {
    requests,
    exchanges: () => exchangeCount,
    recover: () => {
      workspaceUnavailable = false;
    },
  };
}
test("Google sign-in uses PKCE, checks trusted access and scrubs callback credentials", async ({
  page,
}) => {
  const state = await google(page);
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(page).toHaveURL(/\/machines$/);
  await expect(
    page.getByRole("link", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.exchanges()).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("link", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
for (const mode of ["denied", "missing-verifier", "expired"] as const)
  test(`Google ${mode} fails closed and permits fresh sign-in`, async ({
    page,
  }) => {
    const state = await google(page, mode);
    if (mode === "missing-verifier")
      await page.goto("/auth/callback?code=fixture-auth-code");
    else {
      await page.goto("/login");
      await page
        .getByRole("button", { name: "Sign in with Google", exact: true })
        .click();
    }
    await expect(
      page.getByRole("heading", {
        name: "Sign-in could not finish",
        exact: true,
      }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    expect(state.exchanges()).toBe(mode === "expired" ? 1 : 0);
    await page
      .getByRole("button", { name: "Return to sign in", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
  });
test("Google authentication cannot provision membership or roles", async ({
  page,
}) => {
  await google(page, "no-membership");
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace access needed", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Asset registry/ })).toHaveCount(
    0,
  );
  expect(new URL(page.url()).search).toBe("");
  await page
    .getByRole("button", { name: "Return to sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
});
test("workspace recovery never consumes a Google code a second time", async ({
  page,
}) => {
  const state = await google(page, "api-unavailable");
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Sign in with Google", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Workspace check unavailable",
      exact: true,
    }),
  ).toBeVisible();
  state.recover();
  await page
    .getByRole("button", { name: "Retry workspace check", exact: true })
    .click();
  await expect(page).toHaveURL(/\/machines$/);
  expect(state.exchanges()).toBe(1);
});
test("disabled or unavailable Google sign-in keeps email login usable", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "Google sign-in is being set up. Use email and password below.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.route("**/auth/v1/settings", (r) =>
    r.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry sign-in options", exact: true }),
  ).toBeVisible();
  await page.route("**/auth/v1/settings", (r) =>
    r.fulfill({ json: { external: { google: true, email: true } } }),
  );
  await page
    .getByRole("button", { name: "Retry sign-in options", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in with Google", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Work email").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/machines$/);
});
test("one account switches six server-granted views and shows role-specific work controls", async ({
  page,
}) => {
  await setup(page, "ADMINISTRATOR");
  const seen: string[] = [];
  await page.route("**/api/me", async (r) => {
    const role = r.request().headers()["x-workspace-role"] || "ADMINISTRATOR";
    seen.push(role);
    await r.fulfill({
      json: {
        userId,
        membershipId: "fixture-member",
        displayName: "TEST multi-role pilot",
        orgId: "fixture-org",
        organization: "Fixture",
        role,
        availableRoles: roles,
      },
    });
  });
  await page.route("**/api/machines/WH-C/work-orders?**", (r) =>
    r.fulfill({
      json: {
        items: [],
        counts: Object.fromEntries(
          [
            "REPORTED",
            "ASSIGNED",
            "IN_PROGRESS",
            "AWAITING_REVIEW",
            "APPROVED",
            "CLOSED",
          ].map((s) => [s, 0]),
        ),
        total: 0,
        nextCursor: null,
      },
    }),
  );
  await signIn(page);
  for (const role of roles) {
    const selector = page.getByRole("combobox", {
      name: "Active role",
      exact: true,
    });
    if ((await selector.inputValue()) !== role) {
      await selector.selectOption(role);
      await expect(page).toHaveURL(/\/machines$/);
      await expect(selector).toHaveValue(role);
    }
    await page.goto("/machines/WH-C/work-orders");
    await expect(
      page.getByRole("combobox", { name: "Active role", exact: true }),
    ).toHaveValue(role);
    await expect(
      page.getByRole("button", { name: "Report an issue", exact: true }),
    ).toHaveCount(role === "OPERATOR" ? 1 : 0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(new Set(seen).size).toBe(6);
  await page.screenshot({
    path: `test-results/team-access-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  await expect(
    page.getByRole("combobox", { name: "Active role", exact: true }),
  ).toHaveValue("ADMINISTRATOR");
});
test("a revoked view fails closed and can return to the trusted default role", async ({
  page,
}) => {
  await setup(page, "ADMINISTRATOR");
  await signIn(page);
  await page.evaluate(
    (id) =>
      sessionStorage.setItem(
        "maintenance.workspaceRole",
        JSON.stringify({ userId: id, role: "MAINTENANCE_HEAD" }),
      ),
    userId,
  );
  await page.route("**/api/me", async (r) => {
    if (r.request().headers()["x-workspace-role"])
      await r.fulfill({
        status: 403,
        json: { message: "Selected role revoked" },
      });
    else await r.fallback();
  });
  await page.reload();
  await expect(
    page.getByText("Selected role revoked", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to default role", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: /WH-C.*Blown-film line/ }),
  ).toBeVisible();
});
