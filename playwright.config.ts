import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev --workspace @maintenance/web -- --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    env: {
      MAINTENANCE_BROWSER_TEST: "1",
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:4400/api",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "browser-test-public-key",
    },
    timeout: 90000,
  },
});
