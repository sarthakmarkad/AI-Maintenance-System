import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { invitationInput, memberInput, tokenInput } from "../team/dto";
import { staffEmailConfigured } from "../team/policy";
import { parseConfig } from "../config";
test("staff invitation input normalizes confirmed-email matching and canonical machine snapshots without accepting authority fields", () => {
  const id = randomUUID();
  const v = {
    requestId: randomUUID(),
    email: "PERSON@EXAMPLE.TEST",
    displayName: " Test Person ",
    role: "TECHNICIAN",
    machineIds: [id.toUpperCase()],
  };
  const parsed = invitationInput.parse(v);
  assert.equal(parsed.email, "person@example.test");
  assert.equal(
    invitationInput.parse({ ...v, requestId: v.requestId.toUpperCase() })
      .requestId,
    v.requestId,
  );
  assert.equal(parsed.displayName, "Test Person");
  assert.deepEqual(parsed.machineIds, [id]);
  assert(!invitationInput.safeParse({ ...v, orgId: randomUUID() }).success);
  assert(
    !invitationInput.safeParse({ ...v, machineIds: [id, id.toUpperCase()] })
      .success,
  );
  assert(
    !invitationInput.safeParse({
      ...v,
      email: "person@example.test\r\nBcc:other@example.test",
    }).success,
  );
});
test("staff edits require explicit current snapshots and reasons; omitted/null CAS values cannot validate", () => {
  const v = {
    requestId: randomUUID(),
    version: 1,
    displayName: "Test Person",
    role: "OPERATOR",
    active: true,
    machineIds: [randomUUID()],
    expectedMachineIds: [],
    reason: "Role reviewed",
  };
  assert(memberInput.safeParse(v).success);
  for (const changes of [
    { version: null },
    { version: 0 },
    { reason: "" },
    { expectedMachineIds: undefined },
    { actorId: randomUUID() },
  ])
    assert(!memberInput.safeParse({ ...v, ...changes }).success);
  assert(
    !tokenInput.safeParse({ token: "-".repeat(36) + "." + "a".repeat(43) })
      .success,
  );
});
test("the account-only Resend sender never advertises staff delivery, and SMTP readiness is explicit", () => {
  const base = {
    NODE_ENV: "test",
    EXTERNAL_NOTIFICATIONS_ENABLED: "true",
    NOTIFICATION_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "fake-provider-key-long-enough",
    NOTIFICATION_EMAIL_FROM: "onboarding@resend.dev",
  };
  assert.equal(staffEmailConfigured(parseConfig(base)), false);
  assert.equal(
    staffEmailConfigured(
      parseConfig({
        ...base,
        NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
      }),
    ),
    true,
  );
  assert.equal(
    staffEmailConfigured(
      parseConfig({
        ...base,
        EXTERNAL_NOTIFICATIONS_ENABLED: "false",
        NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
      }),
    ),
    false,
  );
  assert.equal(
    parseConfig({ NODE_ENV: "test" }).TEAM_PASSWORD_EMAIL_READY,
    undefined,
  );
  assert.throws(() =>
    parseConfig({ NODE_ENV: "test", TEAM_INVITATION_SECRET: "short" }),
  );
});
