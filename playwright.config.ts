import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,  // Increased for comprehensive Docker tests (2 minutes)
  retries: 2,       // Retry failed tests up to 2 times
  workers: 1,
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mcp-protocol-tests',
      testMatch: /mcp-client\.playwright\.spec\.ts/,
    },
    {
      name: 'docker-smoke-tests',
      testMatch: /docker\.e2e\.spec\.ts/,
    },
    {
      name: 'docker-all-tools-tests',
      testMatch: /docker-all-tools\.e2e\.spec\.ts/,
    },
  ],
});