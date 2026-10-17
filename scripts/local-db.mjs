// Isolated native PostgreSQL instance. Does not use or modify the existing port 5432 server.
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parse } from "dotenv";
const local = resolve(".local"),
  data = resolve(local, "pgdata");
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (r.error || r.status !== 0)
    throw new Error(
      `${cmd} failed. ${r.error?.message || r.stderr || r.stdout}`,
    );
  return r.stdout;
}
if (process.argv[2] === "stop") {
  run("pg_ctl", ["-D", data, "stop", "-m", "fast"]);
  console.log("Project PostgreSQL stopped.");
  process.exit(0);
}
mkdirSync(local, { recursive: true, mode: 0o700 });
chmodSync(local, 0o700);
if (!existsSync(data)) {
  if (existsSync(".env"))
    throw new Error(
      "Existing .env found. Configure it manually or use Docker; local bootstrap will not overwrite it.",
    );
  const owner = randomBytes(24).toString("hex"),
    runtime = randomBytes(24).toString("hex");
  const passwordFile = resolve(local, "init-password");
  writeFileSync(passwordFile, owner, { mode: 0o600 });
  try {
    run("initdb", [
      "-D",
      data,
      "-U",
      "maintenance_owner",
      "--pwfile=" + passwordFile,
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      "--encoding=UTF8",
      "--no-locale",
    ]);
  } finally {
    unlinkSync(passwordFile);
  }
  writeFileSync(
    ".env",
    `NODE_ENV=development\nHOST=127.0.0.1\nPORT=4000\nWEB_ORIGIN=http://localhost:3000\nDATABASE_URL=postgresql://maintenance_runtime:${runtime}@127.0.0.1:55432/maintenance?schema=maintenance&connect_timeout=5\nDIRECT_URL=postgresql://maintenance_owner:${owner}@127.0.0.1:55432/maintenance?schema=maintenance&connect_timeout=5\nTEST_DATABASE_URL=postgresql://maintenance_owner:${owner}@127.0.0.1:55432/maintenance_test?schema=maintenance&connect_timeout=5\nTEST_RUNTIME_DATABASE_URL=postgresql://maintenance_runtime:${runtime}@127.0.0.1:55432/maintenance_test?schema=maintenance&connect_timeout=5\nSUPABASE_URL=\nSUPABASE_PUBLISHABLE_KEY=\n`,
    { mode: 0o600 },
  );
}
const env = parse(readFileSync(".env"));
const ownerUrl = new URL(env.DIRECT_URL);
const runtimeUrl = new URL(env.DATABASE_URL);
if (
  ownerUrl.hostname !== "127.0.0.1" ||
  ownerUrl.port !== "55432" ||
  ownerUrl.username !== "maintenance_owner"
)
  throw new Error(
    "Local bootstrap requires its own generated local configuration.",
  );
const state = spawnSync("pg_ctl", ["-D", data, "status"], { encoding: "utf8" });
if (state.status !== 0) {
  mkdirSync(resolve(local, "socket"), { recursive: true });
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    resolve(local, "postgres.log"),
    "-o",
    `-p 55432 -h 127.0.0.1 -k ${resolve(local, "socket")}`,
    "start",
    "-w",
  ]);
}
const pgEnv = {
  ...process.env,
  PGHOST: "127.0.0.1",
  PGPORT: "55432",
  PGUSER: "maintenance_owner",
  PGPASSWORD: decodeURIComponent(ownerUrl.password),
  PGDATABASE: "postgres",
};
for (const name of ["maintenance", "maintenance_test"]) {
  const found = run(
    "psql",
    ["-tAc", `SELECT 1 FROM pg_database WHERE datname='${name}'`],
    { env: pgEnv },
  ).trim();
  if (!found) run("createdb", [name], { env: pgEnv });
}
const pass = decodeURIComponent(runtimeUrl.password);
if (!/^[a-f0-9]+$/.test(pass))
  throw new Error("Unexpected generated password format.");
run("psql", ["-v", "ON_ERROR_STOP=1"], {
  env: pgEnv,
  input: `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='maintenance_runtime') THEN CREATE ROLE maintenance_runtime LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$;`,
});
console.log(
  "Project PostgreSQL ready on 127.0.0.1:55432. Private local configuration written to .env.",
);
