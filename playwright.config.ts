import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./validation",
  testMatch: "*.e2e.spec.ts",
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  workers: 1,
  outputDir: "validation/test-results",
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: process.env.SMOKE_ORIGIN ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
