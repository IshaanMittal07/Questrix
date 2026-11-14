import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;
// Locally, reuse the installed Chrome (no browser download). CI installs Chromium.
const channel = process.env.CI ? undefined : "chrome";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel },
    },
    {
      name: "iphone-13",
      // iPhone 13 viewport/UA/touch on Chromium (WebKit isn't needed for flows).
      use: { ...devices["iPhone 13"], browserName: "chromium", channel },
    },
  ],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
