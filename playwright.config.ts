import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,  // Increased for Docker environment
  retries: 2,      // Retry failed tests up to 2 times
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mcp-tests',
      testMatch: /mcp-client\.playwright\.spec\.ts/,
    },
  ],
});