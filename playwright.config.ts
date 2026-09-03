import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // E2E validates the Formal Demo production build; run `pnpm build` first.
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    env: {
      RENTPROOF_LLM_MODE: "fixture",
      OPENAI_PROJECT_LIMITS_CONFIRMED: "false",
    },
    timeout: 120_000,
  },
});
