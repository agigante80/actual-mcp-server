import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Docker-based E2E tests
 * Tests run inside a container against a real Actual Budget + MCP server stack
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /docker\.e2e\.spec\.ts/,
  
  // Longer timeout for Docker-based tests (service startup, network latency)
  timeout: 60000,
  
  // No retries - we want to catch real issues
  retries: 0,
  
  // Single worker for deterministic test execution
  workers: 1,
  
  // Reporter configuration
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/docker-e2e-report', open: 'never' }],
    ['json', { outputFile: 'test-results/docker-e2e-results.json' }],
  ],
  
  use: {
    // Base URL from environment variable
    baseURL: process.env.MCP_SERVER_URL || 'http://mcp-server-test:3600',
    
    // Capture traces on failure for debugging
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Increase action timeout for Docker environment
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  
  projects: [
    {
      name: 'docker-e2e-full-stack',
      testMatch: /docker\.e2e\.spec\.ts/,
    },
  ],
});
