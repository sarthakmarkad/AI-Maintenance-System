import { spawn } from "node:child_process";
import { productionEnvironment } from "./deployment-config.mjs";
const env = productionEnvironment(process.env);
const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
  env,
  stdio: "inherit",
});
let timer;
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    child.kill(sig);
    timer ??= setTimeout(() => child.kill("SIGKILL"), 25000);
    timer.unref();
  });
child.on("error", () => {
  console.error("Production API could not start.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  if (timer) clearTimeout(timer);
  process.exitCode = code ?? 1;
});
