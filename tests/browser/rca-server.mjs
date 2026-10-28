// Fixture-only source copy + dedicated RCA CLI server/cache. Never copies .env or company files.
// Next 16's custom-server path ignores conf, so use a separate project directory.
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = process.cwd(),
  web = resolve(root, "apps/web");
const project = resolve(root, ".local/rca-web");
await mkdir(project, { recursive: true });
for (const item of [
  "app",
  "components",
  "lib",
  "postcss.config.mjs",
  "package.json",
])
  await cp(resolve(web, item), resolve(project, item), { recursive: true });
const tsconfig = JSON.parse(
  await readFile(resolve(web, "tsconfig.json"), "utf8"),
);
tsconfig.include = [
  "next-env.d.ts",
  "**/*.ts",
  "**/*.tsx",
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts",
];
await writeFile(
  resolve(project, "tsconfig.json"),
  JSON.stringify(tsconfig, null, 2),
);
await writeFile(
  resolve(project, "next.config.mjs"),
  `export default { distDir: '.next', poweredByHeader: false, devIndicators: false, allowedDevOrigins: ['127.0.0.1'], turbopack: { root: ${JSON.stringify(root)} } };\n`,
);
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/next/dist/bin/next"),
    "dev",
    project,
    "--hostname",
    "127.0.0.1",
    "--port",
    "3122",
  ],
  { cwd: root, env: process.env, stdio: "inherit" },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
