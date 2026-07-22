import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --filter web dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  // Only Chromium is guaranteed pre-installed in CI/dev sandboxes; add
  // webkit/firefox projects once those browsers are provisioned. Pin
  // executablePath to the pre-installed binary rather than the version this
  // @playwright/test release expects, in case they've drifted apart.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
      },
    },
  ],
});
