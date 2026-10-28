// Isolated UI contracts; trusted role/email checks and persistence run against PostgreSQL separately.
import { test, expect, type Page } from "@playwright/test";
import { setup, signIn, userId, machine } from "./helpers";
const mid = "72194396-ac73-4e82-9f8e-69daa170bd56";
const inviteId = "83042cb6-660a-42dd-8832-01797589a8b9";
const techId = "145ff129-3441-4272-bd68-cb46285dd117";
const inviteToken = inviteId + "." + "x".repeat(43);
const invitation = {
  id: inviteId,
  email: "fixture@example.test",
  displayName: "TEST New technician",
  role: "TECHNICIAN",
  organization: "Supreme Industries",
  machines: [{ ...machine, id: mid, archivedAt: null }],
  status: "PENDING",
  version: 1,
  expiresAt: "2026-11-05T00:00:00Z",
  deliveryStatus: null,
  deliveryCode: null,
};
const self = {
  id: "self-member",
  userId,
  displayName: "TEST Administrator",
  email: null,
  role: "ADMINISTRATOR",
  additionalRoles: ["TECHNICIAN"],
  active: true,
  version: 1,
  machines: [],
  openWorkOrders: 0,
  activePlans: 0,
};
const technician = {
  id: techId,
  userId: techId,
  displayName: "TEST Technician",
  email: "tech@example.test",
  role: "TECHNICIAN",
  additionalRoles: [],
  active: true,
  version: 3,
  machines: [{ ...machine, id: mid, archivedAt: null }],
  openWorkOrders: 2,
  activePlans: 1,
};
async function fixture(
  page: Page,
  options: {
    role?: string;
    email?: boolean;
    smtp?: boolean;
    extraRoles?: boolean;
  } = {},
) {
  await setup(page, options.role ?? "ADMINISTRATOR");
  const writes: { path: string; body: any }[] = [];
  let stale = false,
    accepted = false;
  await page.route("http://127.0.0.1:4400/api/team/**", async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body = r.request().postData() ? r.request().postDataJSON() : null;
    if (path.endsWith("/options"))
      return r.fulfill({
        json: { passwordEmailConfigured: options.smtp ?? true },
      });
    if (path.endsWith("/preview")) return r.fulfill({ json: invitation });
    if (path.endsWith("/available"))
      return r.fulfill({
        json: {
          items: accepted ? [] : [invitation],
          total: accepted ? 0 : 1,
          page: 1,
        },
      });
    if (path.endsWith("/accept")) {
      writes.push({ path, body });
      accepted = true;
      return r.fulfill({ json: { id: techId, alreadyApplied: false } });
    }
    if (r.request().method() === "GET") {
      if (path.endsWith("/members"))
        return r.fulfill({
          json: {
            items: [
              self,
              {
                ...technician,
                additionalRoles: options.extraRoles ? ["OPERATOR"] : [],
              },
            ],
            page: 1,
            total: 2,
          },
        });
      return r.fulfill({
        json: {
          items: [invitation],
          page: 1,
          total: 1,
          invitationsConfigured: true,
          emailConfigured: options.email ?? true,
          passwordEmailConfigured: options.smtp ?? true,
        },
      });
    }
    writes.push({ path, body });
    if (stale && path.includes("/members/"))
      return r.fulfill({
        status: 409,
        json: {
          message: "This staff record changed. Refresh before trying again.",
        },
      });
    return r.fulfill({
      json: {
        id: inviteId,
        alreadyApplied: false,
        invitationUrl: "http://127.0.0.1:3100/join#invitation=" + inviteToken,
        deliveryStatus: "SENT",
      },
    });
  });
  await page.route("http://127.0.0.1:4400/api/machines?**", (r) =>
    r.fulfill({ json: { items: [{ ...machine, id: mid }], nextCursor: null } }),
  );
  return {
    writes,
    stale: () => {
      stale = true;
    },
  };
}
async function team(page: Page, options: Parameters<typeof fixture>[1] = {}) {
  const state = await fixture(page, options);
  await signIn(page);
  await page.goto("/team");
  await expect(
    page.getByRole("heading", { name: "Team", exact: true }),
  ).toBeVisible();
  return state;
}
const btn = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });

test("Administrator invites one staff role and explicit machine; popup draft survives closing", async ({
  page,
}, info) => {
  const state = await team(page);
  await expect(btn(page, "Manage TEST Administrator")).toBeDisabled();
  await btn(page, "Invite staff").click();
  const dialog = page.getByRole("dialog", {
    name: "Invite staff",
    exact: true,
  });
  await dialog
    .getByLabel("Full name", { exact: true })
    .fill("TEST New technician");
  await dialog
    .getByLabel("Staff email", { exact: true })
    .fill("person@example.test");
  await dialog
    .getByLabel("Staff role", { exact: true })
    .selectOption("TECHNICIAN");
  await expect(btn(page, "Create invitation")).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /WH-C/ }).check();
  await btn(page, "Close form").click();
  await btn(page, "Invite staff").click();
  await expect(dialog.getByLabel("Full name", { exact: true })).toHaveValue(
    "TEST New technician",
  );
  await expect(dialog.getByRole("checkbox", { name: /WH-C/ })).toBeChecked();
  await page.screenshot({
    path: ".local/team-invite-" + info.project.name + ".png",
    fullPage: true,
  });
  await btn(page, "Create invitation").click();
  await expect(
    page.getByRole("dialog", { name: "Private invitation link" }),
  ).toBeVisible();
  const url = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  expect(new URL(url).search).toBe("");
  expect(url).toContain("#invitation=");
  const payload = state.writes.find((w) =>
    w.path.endsWith("/invitations"),
  )!.body;
  expect(payload).toEqual({
    requestId: expect.any(String),
    email: "person@example.test",
    displayName: "TEST New technician",
    role: "TECHNICIAN",
    machineIds: [mid],
  });
});

test("staff edits explain retained assignments and stale changes require deliberate discard", async ({
  page,
}) => {
  const state = await team(page);
  await btn(page, "Manage TEST Technician").click();
  await expect(
    page.getByText(/Changing or deactivating access does not reassign/),
  ).toBeVisible();
  await page
    .getByLabel("Account status", { exact: true })
    .selectOption("INACTIVE");
  await page
    .getByLabel("Reason for access change", { exact: true })
    .fill("TEST person has left");
  await btn(page, "Close form").click();
  await btn(page, "Manage TEST Technician").click();
  await expect(
    page.getByLabel("Reason for access change", { exact: true }),
  ).toHaveValue("TEST person has left");
  state.stale();
  await btn(page, "Save staff access").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "staff record changed",
  );
  await expect(btn(page, "Save staff access")).toBeDisabled();
  expect(state.writes[0].body).toMatchObject({
    version: 3,
    active: false,
    expectedMachineIds: [mid],
    machineIds: [mid],
    replaceAdditionalRoles: false,
  });
  await btn(page, "Reload team and discard draft").click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("extra trusted grants need explicit replacement and a reason", async ({
  page,
}) => {
  const state = await team(page, { extraRoles: true });
  await btn(page, "Manage TEST Technician").click();
  await page
    .getByLabel("Staff role", { exact: true })
    .selectOption("SUPERVISOR");
  await page
    .getByLabel("Reason for access change", { exact: true })
    .fill("TEST promotion approved");
  await btn(page, "Save staff access").click();
  expect(state.writes).toHaveLength(0);
  await page.getByRole("checkbox", { name: /Replace this person's/ }).check();
  await btn(page, "Save staff access").click();
  expect(state.writes[0].body).toMatchObject({
    role: "SUPERVISOR",
    replaceAdditionalRoles: true,
  });
});

test("invitation email and revocation each require their own confirmation", async ({
  page,
}) => {
  const state = await team(page);
  await btn(page, "Send email").click();
  expect(state.writes).toHaveLength(0);
  await btn(page, "Send invitation email").click();
  await expect(
    page.getByRole("status").filter({ hasText: "email provider" }),
  ).toBeVisible();
  await btn(page, "Revoke invitation").click();
  await btn(page, "Confirm revocation").click();
  expect(state.writes.map((w) => w.path.split("/").at(-1))).toEqual([
    "email",
    "revoke",
  ]);
});

test("unconfigured domain disables sending and explains Google joining and password setup", async ({
  page,
}) => {
  await team(page, { email: false, smtp: false });
  await expect(btn(page, "Send email")).toBeDisabled();
  await expect(
    page.getByText(/Password signup and recovery need email setup/),
  ).toBeVisible();
  await btn(page, "Get invitation link").click();
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(
    /#invitation=/,
  );
});

for (const role of [
  "OPERATOR",
  "TECHNICIAN",
  "MAINTENANCE_HEAD",
  "SUPERVISOR",
  "MANAGEMENT",
])
  test(`${role} cannot use Team management`, async ({ page }) => {
    await fixture(page, { role });
    await signIn(page);
    await expect(
      page.getByRole("link", { name: "Team", exact: true }),
    ).toHaveCount(0);
    await page.goto("/team");
    await expect(
      page.getByText("Only an Administrator can manage staff accounts."),
    ).toBeVisible();
    await expect(btn(page, "Invite staff")).toHaveCount(0);
  });

test("private joining scrubs the token and disables new password accounts before SMTP is ready", async ({
  page,
}) => {
  await fixture(page, { smtp: false });
  await page.goto("/join#invitation=" + inviteToken);
  await expect(page.getByLabel("Invited email", { exact: true })).toHaveValue(
    "fixture@example.test",
  );
  await expect(page).toHaveURL(/\/join$/);
  await expect(btn(page, "Create password account")).toBeDisabled();
  await expect(
    page.getByText(/New password accounts require email confirmation setup/),
  ).toBeVisible();
  await expect(
    page.getByLabel("Invited email", { exact: true }),
  ).toHaveAttribute("readonly", "");
});

test("confirmed account explicitly accepts; no client email or role is submitted", async ({
  page,
}) => {
  const state = await fixture(page);
  await signIn(page);
  await page.goto("/join#invitation=" + inviteToken);
  await btn(page, "Accept invitation").click();
  await expect(page).toHaveURL(/\/machines$/);
  expect(state.writes.find((w) => w.path.endsWith("/accept"))!.body).toEqual({
    invitationId: inviteId,
  });
});

test("mismatched account cannot accept the previewed invitation", async ({
  page,
}) => {
  await fixture(page);
  await signIn(page);
  await page.route("**/api/team/onboarding/available", (r) =>
    r.fulfill({ json: { items: [], total: 0, page: 1 } }),
  );
  await page.goto("/join#invitation=" + inviteToken);
  await expect(
    page.getByText(/No pending invitation matches this confirmed account/),
  ).toBeVisible();
  await expect(btn(page, "Accept invitation")).toHaveCount(0);
});

test("password signup validates confirmation and requests provider confirmation without role metadata", async ({
  page,
}) => {
  await fixture(page);
  let body: any;
  await page.route("**/auth/v1/signup?**", (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({
      json: { id: userId, email: "fixture@example.test", identities: [] },
    });
  });
  await page.goto("/join#invitation=" + inviteToken);
  await page
    .getByLabel("Create password", { exact: true })
    .fill("a-long-test-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("different-password");
  await btn(page, "Create my account").click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "same password twice",
  );
  expect(body).toBeUndefined();
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("a-long-test-password");
  await btn(page, "Create my account").click();
  await expect(
    page.getByText(/Check your email to confirm your account/),
  ).toBeVisible();
  expect(body.email).toBe("fixture@example.test");
  expect(body.data).toEqual({});
  await expect(page.getByLabel("Create password", { exact: true })).toHaveValue(
    "",
  );
});

test("recovery stays disabled until configured, then returns a non-enumerating response", async ({
  page,
}) => {
  await fixture(page, { smtp: false });
  await page.goto("/forgot-password");
  await expect(btn(page, "Send recovery link")).toBeDisabled();
  await page.route("**/api/team/onboarding/options", (r) =>
    r.fulfill({ json: { passwordEmailConfigured: true } }),
  );
  let recover: any;
  await page.route("**/auth/v1/recover?**", (r) => {
    recover = r.request().postDataJSON();
    return r.fulfill({ json: {} });
  });
  await page.reload();
  await page
    .getByLabel("Work email", { exact: true })
    .fill("not-present@example.test");
  await btn(page, "Send recovery link").click();
  await expect(page.getByText(/If this address has an account/)).toBeVisible();
  expect(recover.email).toBe("not-present@example.test");
  expect(recover.code_challenge_method).toBe("s256");
});

test("PKCE password recovery routes to reset, verifies the user and signs out after a saved password", async ({
  page,
}) => {
  await fixture(page);
  let callback = "",
    updates = 0;
  await page.route("**/auth/v1/recover?**", (r) => {
    callback = new URL(r.request().url()).searchParams.get("redirect_to")!;
    return r.fulfill({ json: {} });
  });
  await page.goto("/forgot-password");
  await page
    .getByLabel("Work email", { exact: true })
    .fill("fixture@example.test");
  await btn(page, "Send recovery link").click();
  await expect(page.getByText(/If this address has an account/)).toBeVisible();
  await page.route("**/auth/v1/user", async (r) => {
    if (r.request().method() === "PUT") {
      updates++;
      expect(r.request().postDataJSON()).toMatchObject({
        password: "new-test-password-123",
      });
    }
    return r.fulfill({
      json: {
        id: userId,
        email: "fixture@example.test",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-10-01T00:00:00Z",
      },
    });
  });
  const url = new URL(callback);
  url.searchParams.set("code", "test-recovery-code");
  await page.goto(url.href);
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(
    page.getByText("Updating the password for fixture@example.test."),
  ).toBeVisible();
  await page
    .getByLabel("New password", { exact: true })
    .fill("new-test-password-123");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("new-test-password-123");
  await btn(page, "Save new password").click();
  await expect(page.getByText(/Your password has been updated/)).toBeVisible();
  expect(updates).toBe(1);
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("reset without a session never offers a password mutation", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/reset-password");
  await expect(
    page.getByText(/Open a valid recovery link from your email/),
  ).toBeVisible();
  await expect(btn(page, "Save new password")).toHaveCount(0);
});
