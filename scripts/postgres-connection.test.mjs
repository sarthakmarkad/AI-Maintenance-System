import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nativeDatabaseConfig,
  postgresEnvironment,
  postgresRole,
} from "./postgres-connection.mjs";

test("local PostgreSQL settings retain encoded credentials without emitting a URI argument", () => {
  const env = postgresEnvironment(
    "postgresql://maintenance_runtime:TEST%3A%40password@127.0.0.1:55432/maintenance?schema=maintenance",
    {},
  );
  assert.equal(env.PGPASSWORD, "TEST:@password");
  assert.equal(env.PGPORT, "55432");
  assert.equal(env.PGDATABASE, "maintenance");
  assert.equal(env.PGSSLMODE, "prefer");
});
test("Supabase administrative connections retain TLS mode and certificate settings", () => {
  const env = postgresEnvironment(
    "postgresql://postgres:TEST@db.example.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=%2Fprivate%2Fproject.crt",
    {},
  );
  assert.equal(env.PGSSLMODE, "verify-full");
  assert.equal(env.PGSSLROOTCERT, "/private/project.crt");
  assert.equal(env.PGUSER, "postgres");
  assert.equal(
    postgresEnvironment(
      "postgresql://postgres:TEST@db.example.supabase.co/postgres?sslmode=require&sslaccept=strict",
      {},
    ).PGSSLMODE,
    "verify-full",
  );
  assert.equal(
    postgresEnvironment(
      "postgresql://postgres:TEST@db.example.supabase.co/postgres",
      {},
    ).PGSSLMODE,
    "verify-full",
  );
});
test("unsafe remote plaintext or opportunistic TLS settings are rejected", () => {
  for (const mode of ["disable", "allow", "prefer"])
    assert.throws(
      () =>
        postgresEnvironment(
          "postgresql://postgres:TEST@db.example.supabase.co/postgres?sslmode=" +
            mode,
          {},
        ),
      /requires TLS/,
    );
});
test("Supabase session-pooler login keeps the project suffix for connection but removes it for SQL grants", () => {
  const url =
    "postgresql://maintenance_runtime.atfjdjliclqzzapetnrr:TEST@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require";
  assert.equal(
    postgresEnvironment(url, {}).PGUSER,
    "maintenance_runtime.atfjdjliclqzzapetnrr",
  );
  assert.equal(postgresRole(url), "maintenance_runtime");
  assert.throws(
    () => postgresRole(url.replace(".atfjdjliclqzzapetnrr", "")),
    /project suffix/,
  );
});
test("ordinary SQL role names are preserved for local and direct connections", () => {
  assert.equal(
    postgresRole(
      "postgresql://maintenance_runtime:TEST@127.0.0.1:55432/maintenance",
    ),
    "maintenance_runtime",
  );
  assert.equal(
    postgresRole(
      "postgresql://example.name:TEST@db.example.supabase.co/postgres",
    ),
    "example.name",
  );
});

test("invalid configuration errors do not expose secrets and IPv6 remains local", () => {
  for (const parse of [postgresEnvironment, postgresRole])
    assert.throws(
      () => parse("TEST-secret-invalid-uri"),
      (error) => {
        assert(!error.message.includes("TEST-secret"));
        assert(!("input" in error));
        return true;
      },
    );
  const env = postgresEnvironment(
    "postgresql://runtime:TEST@[::1]:55432/maintenance",
    {},
  );
  assert.equal(env.PGHOST, "::1");
  assert.equal(env.PGSSLMODE, "prefer");
});

test("native bootstrap isolates local tests from hosted operational credentials", () => {
  const owner =
    "postgresql://maintenance_owner:TEST@127.0.0.1:55432/maintenance";
  const runtime =
    "postgresql://maintenance_runtime:abcd@127.0.0.1:55432/maintenance";
  const env = {
    DIRECT_URL: "postgresql://postgres.project:TEST@pool.example.test/postgres",
    DATABASE_URL:
      "postgresql://runtime.project:TEST@pool.example.test/postgres",
    TEST_DATABASE_URL: owner + "_test",
    TEST_RUNTIME_DATABASE_URL: runtime + "_test",
  };
  const config = nativeDatabaseConfig(env);
  assert.equal(config.owner.hostname, "127.0.0.1");
  assert.equal(config.runtime.username, "maintenance_runtime");
  assert.deepEqual(config.databases, ["maintenance_test"]);
  assert.equal(config.testOnly, true);
  for (const change of [
    { TEST_DATABASE_URL: owner },
    { TEST_RUNTIME_DATABASE_URL: runtime + "_other_test" },
    { TEST_DATABASE_URL: env.DIRECT_URL },
    { TEST_RUNTIME_DATABASE_URL: undefined },
  ])
    assert.throws(() => nativeDatabaseConfig({ ...env, ...change }));
  const local = nativeDatabaseConfig({
    DIRECT_URL: owner,
    DATABASE_URL: runtime,
  });
  assert.equal(local.testOnly, false);
  assert.deepEqual(local.databases, ["maintenance", "maintenance_test"]);
});
