import "dotenv/config";
import { spawnSync } from "node:child_process";
if (!process.env.DIRECT_URL || !process.env.DATABASE_URL)
  throw new Error("DIRECT_URL and DATABASE_URL required.");
const owner = new URL(process.env.DIRECT_URL),
  runtime = new URL(process.env.DATABASE_URL);
owner.search = "";
const result = spawnSync(
  "psql",
  [
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `runtime_role=${decodeURIComponent(runtime.username)}`,
    "-f",
    "infra/runtime-grants.sql",
  ],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: owner.hostname,
      PGPORT: owner.port || "5432",
      PGDATABASE: owner.pathname.slice(1),
      PGUSER: decodeURIComponent(owner.username),
      PGPASSWORD: decodeURIComponent(owner.password),
    },
  },
);
if (result.status !== 0) {
  console.error("Runtime grants failed. Verify psql and database ownership.");
  process.exitCode = 1;
} else
  console.log(
    "Scoped runtime grants applied: registry read-only; imports, versioned work-order actions and immutable history/audit append permitted.",
  );
