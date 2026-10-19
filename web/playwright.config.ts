import { defineConfig } from '@playwright/test';

// The design-bridge fixture spec (e2e/bridge-fixture.spec.ts) runs against
// the Vite dev server (`pnpm dev`); baseURL is overridable for CI:
//   PLAYWRIGHT_BASE_URL=http://localhost:4173 pnpm test:e2e
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
