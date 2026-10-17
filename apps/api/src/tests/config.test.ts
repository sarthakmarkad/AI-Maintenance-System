import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../config";
test("configuration fails closed and never includes secrets in validation messages", () => {
  assert.equal(parseConfig({}).PORT, 4000);
  assert.throws(
    () => parseConfig({ NODE_ENV: "production" }),
    /Production requires/,
  );
  assert.throws(() => parseConfig({ PORT: "bad" }), /PORT/);
  assert.throws(
    () => parseConfig({ WEB_ORIGIN: "http://localhost:3000/path" }),
    /WEB_ORIGIN/,
  );
  assert.throws(
    () => parseConfig({ DATABASE_URL: "postgresql://" }),
    /DATABASE_URL/,
  );
  assert.throws(
    () => parseConfig({ DATABASE_URL: "https://example.test" }),
    /PostgreSQL/,
  );
  assert.throws(
    () => parseConfig({ SUPABASE_URL: "https://example.supabase.co" }),
    /both Supabase/,
  );
  assert.throws(
    () => parseConfig({ ENABLE_DEMO_AUTH: "true" }),
    /ENABLE_DEMO_AUTH/,
  );
  assert.throws(
    () =>
      parseConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_private",
      }),
    /not a secret/,
  );
});
