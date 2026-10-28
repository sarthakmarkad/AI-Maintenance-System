// Writes only an ignored temporary Playwright config. Isolated fixture copy/cache/port.
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const root = process.cwd();
await mkdir(".local", { recursive: true });
const config = resolve(root, ".local/landing-video.playwright.config.ts");
await writeFile(
  config,
  `import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir: '../tests/browser', testMatch: 'landing-video.spec.ts', workers: 2,
 outputDir: './landing-video-browser-results', reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:3123',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 webServer:{cwd:${JSON.stringify(root)},command:'node scripts/landing-video/test-server.mjs',url:'http://127.0.0.1:3123',reuseExistingServer:false,timeout:90000,
 env:{MAINTENANCE_BROWSER_TEST:'1',NEXT_PUBLIC_API_URL:'http://127.0.0.1:4400/api',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54399',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'browser-test-public-key'}}
});\n`,
);
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    config,
  ],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
