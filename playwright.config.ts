import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
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