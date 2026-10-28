import "dotenv/config";
import { spawnSync } from "node:child_process";
import { postgresEnvironment, postgresRole } from "./postgres-connection.mjs";
if (!process.env.DIRECT_URL || !process.env.DATABASE_URL)
  throw new Error("DIRECT_URL and DATABASE_URL required.");
const result = spawnSync(
  "psql",
  [
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `runtime_role=${postgresRole(process.env.DATABASE_URL)}`,
    "-f",
    "infra/runtime-grants.sql",
  ],
  {
    encoding: "utf8",
    env: postgresEnvironment(process.env.DIRECT_URL),
  },
);
if (result.status !== 0) {
  console.error("Runtime grants failed. Verify psql and database ownership.");
  process.exitCode = 1;
} else
  console.log(
    "Scoped runtime grants applied: audited registry/access administration, imports, versioned work-order actions and immutable history/audit append permitted.",
  );
