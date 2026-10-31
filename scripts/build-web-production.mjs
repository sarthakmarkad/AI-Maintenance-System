import { spawnSync } from "node:child_process";
import { webDeploymentConfig } from "./deployment-config.mjs";
webDeploymentConfig(process.env);
const result = spawnSync("npm", ["run", "build:web"], {
  env: process.env,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
