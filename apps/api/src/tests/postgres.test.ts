import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postgresOptions } from "../postgres";

test("hosted PostgreSQL uses verified TLS with an explicit CA and bounded pool", () => {
  const dir = mkdtempSync(join(tmpdir(), "maintenance-ca-"));
  try {
    const path = join(dir, "test.crt");
    writeFileSync(path, "TEST public certificate");
    const url = new URL(
      "postgresql://runtime.project:TEST%40password@pool.example.test:5432/postgres?schema=maintenance&connection_limit=3&connect_timeout=12&sslmode=require&sslaccept=strict",
    );
    url.searchParams.set("sslcert", path);
    const { pool, schema } = postgresOptions(url.toString());
    assert.equal(schema, "maintenance");
    assert.deepEqual(pool.ssl, {
      rejectUnauthorized: true,
      ca: "TEST public certificate",
    });
    assert.equal(pool.password, "TEST@password");
    assert.equal(pool.max, 3);
    assert.equal(pool.connectionTimeoutMillis, 12000);
    assert.equal(pool.options, "-c timezone=UTC");
    assert(!("connectionString" in pool));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted PostgreSQL cannot downgrade certificate or TLS verification", () => {
  for (const query of [
    "sslmode=disable",
    "sslmode=prefer",
    "sslaccept=accept_invalid_certs",
  ])
    assert.throws(
      () =>
        postgresOptions(
          "postgresql://runtime:TEST@pool.example.test/postgres?" + query,
        ),
      /TLS|verification/,
    );
  assert.deepEqual(
    postgresOptions("postgresql://runtime:TEST@pool.example.test/postgres").pool
      .ssl,
    { rejectUnauthorized: true },
  );
});

test("local PostgreSQL keeps loopback access and rejects unsafe pool/schema configuration", () => {
  const { pool } = postgresOptions(
    "postgresql://runtime:TEST@[::1]:55432/maintenance?schema=maintenance",
  );
  assert.equal(pool.host, "::1");
  assert.equal(pool.ssl, false);
  for (const query of [
    "connection_limit=0",
    "connect_timeout=0",
    "schema=maintenance%3BDROP",
  ])
    assert.throws(() =>
      postgresOptions(
        "postgresql://runtime:TEST@127.0.0.1/maintenance?" + query,
      ),
    );
  assert.throws(
    () => postgresOptions("private-invalid-url"),
    (error) => !String(error).includes("private-invalid-url"),
  );
});
