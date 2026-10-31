import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

test("actual production config import does not reload a local developer .env", () => {
  const cwd = mkdtempSync(join(tmpdir(), "maintenate-production-env-"));
  try {
    writeFileSync(
      join(cwd, ".env"),
      "MAINTENATE_ENV_SENTINEL=must-not-load\nDIRECT_URL=fixture-owner-secret\n",
    );
    const module = resolve("apps/api/dist/config.js");
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(module)}); if (process.env.MAINTENATE_ENV_SENTINEL || process.env.DIRECT_URL) process.exit(9);`,
      ],
      {
        cwd,
        env: { NODE_ENV: "production" },
        encoding: "utf8",
      },
    );
    assert.equal(
      result.status,
      0,
      "Production must ignore local environment files",
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("production launcher isolates actual child environment and propagates child failure", () => {
  const cwd = mkdtempSync(join(tmpdir(), "maintenate-launcher-"));
  try {
    mkdirSync(join(cwd, "apps/api/dist"), { recursive: true });
    // Test-only child; never replaces or changes application identity handling.
    writeFileSync(
      join(cwd, "apps/api/dist/main.js"),
      `
      if (process.env.DIRECT_URL || process.env.TEST_DATABASE_URL || process.env.VERCEL_TOKEN) process.exit(91);
      if (process.env.NODE_ENV !== 'production' || process.env.HOST !== '0.0.0.0' || process.env.PORT !== '4000') process.exit(92);
      process.exit(17);
    `,
    );
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/start-production.mjs")],
      {
        cwd,
        env: {
          WEB_ORIGIN: "https://maintenate.vercel.app",
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only-public-key",
          DATABASE_URL:
            "postgresql://runtime:fixture@db.supabase.co/postgres?sslmode=verify-full",
          TEAM_INVITATION_SECRET: "a".repeat(64),
          DIRECT_URL: "fixture-owner-secret",
          TEST_DATABASE_URL: "fixture-test-secret",
          VERCEL_TOKEN: "fixture-deploy-secret",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 17);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
