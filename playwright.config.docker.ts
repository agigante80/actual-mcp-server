import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Docker-based E2E tests.
 *
 * Used exclusively by the `e2e-test-runner` service in docker-compose.test.yaml.
 * Tests run inside a container against the full Actual Budget + MCP server stack.
 *
 * Note: Both docker spec files read process.env.MCP_SERVER_URL directly for the
 * MCP server URL. They are API-only tests (no browser), so browser-oriented
 * settings (baseURL, screenshot, video, navigationTimeout, actionTimeout) are
 * intentionally absent here.
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Longer timeout for Docker-based tests (service startup, network latency)
  timeout: 120000,

  // No retries: catch real failures, don't mask flakiness in CI
  retries: 0,

  // Single worker for deterministic test execution
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/docker-e2e-report', open: 'never' }],
    ['json', { outputFile: 'test-results/docker-e2e-results.json' }],
  ],

  use: {
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'docker-e2e-smoke',
      testMatch: /docker\.e2e\.spec\.ts$/,
    },
    {
      name: 'docker-e2e-full',
      testMatch: /docker-all-tools\.e2e\.spec\.ts$/,
    },
    /**
     * #383: the SAME spec file over stdio. Not a copy: the suite drives everything through one
     * fixture (#375), so the transport is a fixture implementation rather than a second file.
     *
     * It runs on the HOST rather than inside `e2e-test-runner`, because that container has
     * neither the server's `dist/` nor a docker socket and so has no route to a stdio server.
     * `tests/e2e/run-docker-e2e.sh` invokes this project directly after the containerised HTTP
     * run, while the stack is still up. Selected by MCP_TEST_TRANSPORT=stdio, which is the same
     * env var the manual runner uses (#280).
     */
    {
      name: 'docker-e2e-full-stdio',
      testMatch: /docker-all-tools\.e2e\.spec\.ts$/,
    },
  ],
});
