import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  // the local Workers runtime on Windows drops requests with more parallel browsers
  workers: 2,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // iPhone-sized touch device on Chromium (the default iPhone profile is WebKit)
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    // Production build served by the Workers runtime, with DEV_AUTH and AI_MOCK from .dev.vars
    command: `npm run build && npx wrangler d1 migrations apply flick --local && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/me`,
    reuseExistingServer: true,
    timeout: 180_000,
    ignoreHTTPSErrors: true,
  },
});
