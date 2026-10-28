import "dotenv/config";
import { spawn } from "node:child_process";
import { postgresTlsBridge } from "./postgres-tls-bridge.mjs";

const command = process.argv.slice(2);
if (
  command.length !== 2 ||
  command[0] !== "migrate" ||
  !["status", "deploy"].includes(command[1]) ||
  !process.env.DIRECT_URL
)
  throw new Error(
    "Use prisma-admin.mjs migrate status|deploy with DIRECT_URL configured.",
  );
let owner;
try {
  owner = new URL(process.env.DIRECT_URL);
} catch {
  throw new Error("Invalid PostgreSQL administrative connection.");
}
const local = ["127.0.0.1", "localhost", "[::1]"].includes(owner.hostname);
const bridge = local ? null : await postgresTlsBridge(owner.toString());
const child = spawn(
  process.execPath,
  ["node_modules/prisma/build/index.js", ...command],
  {
    env: {
      ...process.env,
      ...(bridge ? { DATABASE_URL: bridge.url, DIRECT_URL: bridge.url } : {}),
    },
    stdio: "inherit",
  },
);
const stop = (signal) => child.kill(signal);
const interrupt = () => stop("SIGINT");
const terminate = () => stop("SIGTERM");
process.on("SIGINT", interrupt);
process.on("SIGTERM", terminate);
try {
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (bridge?.failed())
    console.error(
      "Verified PostgreSQL TLS connection failed. No insecure fallback was used.",
    );
  process.exitCode = result;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  await bridge?.close();
}
