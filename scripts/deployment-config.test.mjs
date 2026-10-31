import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionEnvironment,
  webDeploymentConfig,
} from "./deployment-config.mjs";
const publicEnv = {
  NEXT_PUBLIC_API_URL: "https://api.maintenate.com/api",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only-public-key",
};
const backend = {
  WEB_ORIGIN: "https://maintenate.vercel.app",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only-public-key",
  DATABASE_URL:
    "postgresql://runtime:fixture@aws.pooler.supabase.com:5432/postgres?schema=maintenance&sslmode=verify-full",
  TEAM_INVITATION_SECRET: "a".repeat(64),
};
test("deployment rejects localhost, URL credentials, private addresses and secret public config without leaking inputs", () => {
  for (const bad of [
    "http://localhost:4000/api",
    "https://localhost/api",
    "https://127.0.0.1/api",
    "https://user:private-token@api.maintenate.com/api",
    "https://api.maintenate.com/api?token=private-token",
    "https://api.maintenate.com/wrong",
  ])
    assert.throws(
      () => webDeploymentConfig({ ...publicEnv, NEXT_PUBLIC_API_URL: bad }),
      (e) => !String(e).includes("private-token"),
    );
  for (const secret of [
    "sb_secret_private-token",
    `a.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`,
  ])
    assert.throws(() =>
      webDeploymentConfig({
        ...publicEnv,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
      }),
    );
  assert.throws(() =>
    webDeploymentConfig({
      ...publicEnv,
      NEXT_PUBLIC_RESEND_API_KEY: "private-token",
    }),
  );
  assert.deepEqual(webDeploymentConfig(publicEnv), {
    apiOrigin: "https://api.maintenate.com",
  });
});
test("production process gets only runtime settings; owner, test and unrelated credentials are excluded", () => {
  const env = productionEnvironment({
    ...backend,
    DIRECT_URL: "postgresql://owner:private-token@db/postgres",
    TEST_DATABASE_URL: "private-token",
    VERCEL_TOKEN: "private-token",
    NEXT_PUBLIC_API_URL: "private-token",
    COMMANDCODE_API_KEY: "test-only-private-commandcode-key",
    PATH: "/usr/bin",
  });
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.HOST, "0.0.0.0");
  assert.equal(env.PORT, "4000");
  for (const k of [
    "DIRECT_URL",
    "TEST_DATABASE_URL",
    "VERCEL_TOKEN",
    "NEXT_PUBLIC_API_URL",
  ])
    assert.equal(env[k], undefined);
  assert.equal(env.COMMANDCODE_API_KEY, "test-only-private-commandcode-key");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(
    productionEnvironment({ ...backend, PORT: "8080", HOST: "127.0.0.1" }).PORT,
    "8080",
  );
});
test("production boundary requires restricted TLS runtime identity, persistent invite key and public callback origin", () => {
  for (const changes of [
    {
      DATABASE_URL:
        "postgresql://postgres:private-token@db/postgres?sslmode=require",
    },
    {
      DATABASE_URL:
        "postgresql://maintenance_owner.project:private-token@db/postgres?sslmode=require",
    },
    { DATABASE_URL: "postgresql://runtime:private-token@db/postgres" },
    { DATABASE_URL: backend.DATABASE_URL + "&sslaccept=accept_invalid_certs" },
    { TEAM_INVITATION_SECRET: "" },
    { WEB_ORIGIN: "http://localhost:3000" },
    { SUPABASE_URL: "http://localhost:54321" },
    { SUPABASE_PUBLISHABLE_KEY: "sb_secret_private-token" },
  ])
    assert.throws(
      () => productionEnvironment({ ...backend, ...changes }),
      (e) => !String(e).includes("private-token"),
    );
});
