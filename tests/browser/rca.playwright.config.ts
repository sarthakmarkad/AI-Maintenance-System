import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "rca.spec.ts",
  fullyParallel: true,
  workers: 2,
  outputDir: "../../.local/rca-browser-results",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3122", trace: "retain-on-failure" },
  projects: [
    { name: "rca-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "rca-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    cwd: resolve(__dirname, "../.."),
    command: "node tests/browser/rca-server.mjs",
    url: "http://127.0.0.1:3122/login",
    reuseExistingServer: false,
    timeout: 90000,
    env: {
      MAINTENANCE_BROWSER_TEST: "1",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:4400/api",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "browser-test-public-key",
    },
  },
});
