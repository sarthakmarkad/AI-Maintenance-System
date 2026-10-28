import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../config";

test("external delivery requires an explicit supported configuration and secrets stay out of errors", () => {
  assert.equal(parseConfig({}).EXTERNAL_NOTIFICATIONS_ENABLED, undefined);
  const valid = parseConfig({
    EXTERNAL_NOTIFICATIONS_ENABLED: "false",
    NOTIFICATION_EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "TEST-private-resend-key-value",
    NOTIFICATION_EMAIL_FROM: "maintenance@example.test",
  });
  assert.equal(valid.EXTERNAL_NOTIFICATIONS_ENABLED, "false");
  assert.equal(valid.NOTIFICATION_EMAIL_PROVIDER, "resend");
  for (const input of [
    { EXTERNAL_NOTIFICATIONS_ENABLED: "1" },
    { NOTIFICATION_EMAIL_PROVIDER: "arbitrary-endpoint" },
    { RESEND_API_KEY: "TEST-private" },
    { NOTIFICATION_EMAIL_FROM: "TEST-private-invalid-address" },
  ])
    assert.throws(
      () => parseConfig(input),
      (error) => !String(error).includes("TEST-private"),
    );
});

test("AI RCA can be independently disabled without changing document assistant settings", () => {
  const config = parseConfig({
    RCA_AI_ENABLED: "false",
    DOCUMENT_AI_ENABLED: "true",
  });
  assert.equal(config.RCA_AI_ENABLED, "false");
  assert.equal(config.DOCUMENT_AI_ENABLED, "true");
  assert.throws(() => parseConfig({ RCA_AI_ENABLED: "yes" }), /RCA_AI_ENABLED/);
});
