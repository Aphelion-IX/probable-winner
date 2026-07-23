import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// Some dev/agent sandboxes pre-install a fixed-path Chromium build that can
// trail the @playwright/test version this repo pins, so the plain default
// resolution 404s looking for a newer revision. Use that fixed path only
// when it's actually present and we're not in real CI — GitHub Actions has
// no such path and always installs a version-matched browser itself (see
// the "Install Playwright browsers" step in .github/workflows/ci.yml), so
// forcing this path there breaks CI outright.
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const sandboxLaunchOptions =
  !process.env.CI && existsSync(SANDBOX_CHROMIUM_PATH)
    ? { executablePath: SANDBOX_CHROMIUM_PATH }
    : undefined;

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
  // webkit/firefox projects once those browsers are provisioned.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: sandboxLaunchOptions },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], launchOptions: sandboxLaunchOptions },
    },
  ],
});
