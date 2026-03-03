import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for local E2E tests.
 *
 * Requires a running MCP server before executing:
 *   - docker tests use MCP_SERVER_URL (default: http://localhost:3601 — bearer instance)
 *   - mcp-client tests use the Docker stack on localhost:3602 by default,
 *     or spawn a local server when USE_DOCKER_MCP_SERVER=false
 *
 * Run: npm run test:e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120000,  // 2 minutes — covers server startup + comprehensive tool tests
  retries: 2,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/e2e-report', open: 'never' }],
  ],
  use: {
    trace: 'retain-on-failure',
    // Default MCP server URL for docker.e2e and docker-all-tools tests.
    // Override with MCP_SERVER_URL to target a different instance.
    baseURL: process.env.MCP_SERVER_URL || 'http://localhost:3601',
  },
  projects: [
    {
      name: 'mcp-protocol-tests',
      testMatch: /mcp-client\.playwright\.spec\.ts/,
    },
    {
      name: 'docker-e2e-smoke',
      testMatch: /docker\.e2e\.spec\.ts$/,
    },
    {
      name: 'docker-e2e-full',
      testMatch: /docker-all-tools\.e2e\.spec\.ts$/,
    },
  ],
});
