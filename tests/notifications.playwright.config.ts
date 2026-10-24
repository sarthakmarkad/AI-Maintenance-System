// Optional isolated browser runner for this feature; the standard suite also
// discovers notifications.spec.ts. No live API/database/auth is used.
import { defineConfig } from "@playwright/test";
import path from "node:path";
import base from "../playwright.config";
export default defineConfig({
  ...base,
  testDir: "./browser",
  testMatch: "notifications.spec.ts",
  workers: 2,
  use: { ...base.use, baseURL: "http://127.0.0.1:3214" },
  webServer: {
    ...(base.webServer as object),
    cwd: path.resolve(__dirname, ".."),
    command: "npm run dev --workspace @maintenance/web -- --port 3214",
    url: "http://127.0.0.1:3214/login",
    reuseExistingServer: false,
  },
});
