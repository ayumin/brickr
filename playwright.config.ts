import { defineConfig, devices } from "@playwright/test";

const backendPort = process.env.E2E_BACKEND_PORT ?? "3000";
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5173";
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: frontendUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @brickr/backend exec tsx src/server.ts",
      url: `${backendUrl}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: backendPort,
        CORS_ORIGIN: frontendUrl,
        USE_MOCK_LLM: "true",
      },
    },
    {
      command: `pnpm --filter @brickr/frontend dev --host 127.0.0.1 --port ${frontendPort}`,
      url: frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: backendUrl,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
