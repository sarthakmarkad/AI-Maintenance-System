import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: resolve(__dirname, "../../.local/system-test-results"),
  testMatch: "persistence.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3130",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node tests/system/server.mjs",
      cwd: resolve(__dirname, "../.."),
      url: "http://127.0.0.1:4301/api/health/live",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run dev --workspace @maintenance/web -- --port 3130",
      cwd: resolve(__dirname, "../.."),
      url: "http://127.0.0.1:3130/login",
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        MAINTENANCE_BROWSER_TEST: "1",
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4301/api",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "system-test-public-key",
      },
    },
  ],
});
