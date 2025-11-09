# Development Guide

This guide covers local development workflows, debugging techniques, and best practices for working on the Actual MCP Server.

## Table of Contents

- [Development Environment](#development-environment)
- [Running Locally](#running-locally)
- [Development Modes](#development-modes)
- [Debugging](#debugging)
- [Testing](#testing)
- [Code Generation](#code-generation)
- [Common Tasks](#common-tasks)
- [Troubleshooting](#troubleshooting)

## Development Environment

### Prerequisites

- **Node.js**: Version 20.x LTS (required)
- **npm**: Version 9+ (comes with Node.js)
- **Git**: For version control
- **VS Code** (recommended): With TypeScript and ESLint extensions
- **Docker** (optional): For running Actual Budget locally

### Recommended VS Code Extensions

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-next",
    "ms-playwright.playwright"
  ]
}
```

### Setting Up Local Actual Budget Server

If you don't have an Actual Budget server, run one locally with Docker:

```bash
# Run Actual Budget server
docker run -d \
  --name actual-server \
  -p 5006:5006 \
  -v actual-data:/data \
  actualbudget/actual-server:latest

# Access at http://localhost:5006
# Create a budget and note the Sync ID from Settings
```

## Running Locally

### Initial Setup

```bash
# Clone repository
git clone https://github.com/agigante80/actual-mcp-server.git
cd actual-mcp-server

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Actual Budget credentials
# Required: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, ACTUAL_BUDGET_SYNC_ID
```

### Build and Run

```bash
# Build TypeScript
npm run build

# Run in development mode with debug logging
npm run dev -- --debug

# Run in production mode
npm start
```

## Development Modes

### Standard Development

```bash
# Build and run with hot-reload (using nodemon)
npm run dev -- --debug --http
```

### Test Connection Only

```bash
# Test connection to Actual Budget and exit
npm run dev -- --test-actual-connection
```

Output example:
```
✅ Successfully connected to Actual Budget
📊 Budget Name: My Family Budget
📅 Sync ID: abc123
✅ Connection test passed
```

### Test All Tools

```bash
# Run all 37 tools with test data and exit
npm run dev -- --test-actual-tools
```

This validates:
- All tools can be loaded
- Input schemas are valid
- Adapter functions exist
- No import errors

### Specific Transport Mode

```bash
# HTTP server (default)
npm run dev -- --http

# WebSocket server
npm run dev -- --ws

# Server-Sent Events
npm run dev -- --sse
```

### Test MCP Client

```bash
# Run test MCP client to verify protocol
npm run test:mcp-client
```

## Debugging

### VS Code Launch Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug MCP Server",
      "program": "${workspaceFolder}/dist/src/index.js",
      "preLaunchTask": "npm: build",
      "args": ["--debug", "--http"],
      "env": {
        "NODE_ENV": "development"
      },
      "envFile": "${workspaceFolder}/.env",
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Test Connection",
      "program": "${workspaceFolder}/dist/src/index.js",
      "preLaunchTask": "npm: build",
      "args": ["--test-actual-connection"],
      "envFile": "${workspaceFolder}/.env",
      "console": "integratedTerminal"
    }
  ]
}
```

### Logging Levels

Control verbosity with `MCP_BRIDGE_LOG_LEVEL`:

```bash
# Minimal output (errors only)
export MCP_BRIDGE_LOG_LEVEL=error

# Production (errors + warnings)
export MCP_BRIDGE_LOG_LEVEL=warn

# Default (errors + warnings + info)
export MCP_BRIDGE_LOG_LEVEL=info

# Verbose (all logs including debug)
export MCP_BRIDGE_LOG_LEVEL=debug
```

### Inspecting Requests

Enable request/response logging:

```typescript
// In src/lib/ActualMCPConnection.ts
logger.debug('MCP Request:', JSON.stringify(request, null, 2));
logger.debug('MCP Response:', JSON.stringify(response, null, 2));
```

### Using Chrome DevTools

```bash
# Run with Node inspector
node --inspect dist/src/index.js --debug

# Open chrome://inspect in Chrome
# Click "Inspect" on your Node process
```

## Testing

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test file
node test/unit/accounts_list.test.js

# Run generated tools smoke test
node test/unit/generated_tools.smoke.test.js
```

### Integration Tests

```bash
# Run adapter tests
npm run test:adapter
```

### End-to-End Tests

```bash
# Run Playwright tests
npm run test:e2e

# Run specific E2E test
npx playwright test test/e2e/mcp-client.playwright.spec.ts

# Run with UI
npx playwright test --ui

# Debug mode
npx playwright test --debug
```

### Writing Tests

Example unit test:

```typescript
// test/unit/accounts_list.test.js
import { expect } from '@playwright/test';
import toolsManager from '../../src/actualToolsManager.js';

async function testAccountsList() {
  try {
    const result = await toolsManager.callTool('actual_accounts_list', {});
    
    expect(result).toBeDefined();
    expect(result.result).toBeDefined();
    expect(Array.isArray(result.result)).toBe(true);
    
    console.log('✅ accounts_list test passed');
    return true;
  } catch (error) {
    console.error('❌ accounts_list test failed:', error);
    return false;
  }
}

testAccountsList();
```

## Code Generation

### Generate Tools from OpenAPI

The project includes code generation for tools:

```bash
# Generate TypeScript types from OpenAPI spec
npm run generate-tools

# This creates:
# - generated/actual-client/types.ts (TypeScript types)
# - Updates tool schemas
```

### Manual Tool Creation

1. Create tool file:

```typescript
// src/tools/my_new_tool.ts
import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({
  id: z.string().describe('Resource ID'),
  name: z.string().optional().describe('Name'),
});

const tool: ToolDefinition = {
  name: 'actual_my_new_tool',
  description: 'Description of what this tool does',
  inputSchema: InputSchema,
  call: async (args: unknown) => {
    const validated = InputSchema.parse(args);
    const result = await adapter.myNewFunction(validated);
    return { result };
  },
};

export default tool;
```

2. Export from index:

```typescript
// src/tools/index.ts
export { default as my_new_tool } from './my_new_tool.js';
```

3. Add adapter function:

```typescript
// src/lib/actual-adapter.ts
export async function myNewFunction(args: MyArgs): Promise<MyResult> {
  return withRetry(async () => {
    return limitConcurrency(async () => {
      const result = await api.myActualMethod(args);
      return result;
    });
  });
}
```

4. Add tests:

```typescript
// test/unit/my_new_tool.test.js
import toolsManager from '../../src/actualToolsManager.js';

async function testMyNewTool() {
  const result = await toolsManager.callTool('actual_my_new_tool', {
    id: 'test-id',
    name: 'test-name'
  });
  
  console.log('Result:', result);
}

testMyNewTool();
```

## Common Tasks

### Add New Dependency

```bash
# Production dependency
npm install package-name

# Development dependency
npm install -D package-name

# Rebuild after adding deps
npm run build
```

### Update Dependencies

```bash
# Check for updates
npm outdated

# Update all to latest (carefully!)
npm update

# Update specific package
npm update package-name
```

### Format Code

```bash
# If Prettier is configured
npm run format

# Or manually with Prettier
npx prettier --write "src/**/*.ts"
```

### Lint Code

```bash
# If ESLint is configured
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

### Check TypeScript Types

```bash
# Type check without emitting files
npx tsc --noEmit
```

### Clean Build

```bash
# Remove dist directory
rm -rf dist

# Rebuild
npm run build
```

### View API Coverage

```bash
# Check which Actual APIs are covered
npm run check:coverage
```

## Troubleshooting

### TypeScript Build Errors

```bash
# Clear TypeScript cache
rm -rf dist node_modules/.cache

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### Import Path Issues

The project uses ES modules with `.js` extensions in imports:

```typescript
// ✅ Correct
import { foo } from './module.js';

// ❌ Wrong
import { foo } from './module';
import { foo } from './module.ts';
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or use different port
export MCP_BRIDGE_PORT=3001
npm run dev
```

### Connection to Actual Budget Fails

```bash
# Test connection manually
curl http://localhost:5006

# Check Actual Budget logs
docker logs actual-server

# Verify credentials
npm run dev -- --test-actual-connection

# Common issues:
# - Wrong ACTUAL_SERVER_URL
# - Incorrect password
# - Invalid sync ID
# - Actual Budget server not running
```

### Tool Not Found

```bash
# Verify tool is exported
grep "your_tool_name" src/tools/index.ts

# Rebuild
npm run build

# Test tool loading
npm run dev -- --test-actual-tools
```

### Memory Issues

```bash
# Increase Node memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run dev
```

### Docker Development

```bash
# Build development image
docker build -t actual-mcp-dev .

# Run with live code mounting
docker run -it --rm \
  -v $(pwd)/src:/app/src:ro \
  -v $(pwd)/dist:/app/dist \
  --env-file .env \
  -p 3000:3000 \
  actual-mcp-dev
```

## Performance Profiling

### Node.js Profiler

```bash
# Run with profiler
node --prof dist/src/index.js

# Process profile output
node --prof-process isolate-*.log > profile.txt
```

### Memory Profiling

```bash
# Run with heap snapshot
node --inspect --expose-gc dist/src/index.js

# Take heap snapshot via Chrome DevTools
# Memory → Take snapshot
```

### Load Testing

```bash
# Install autocannon
npm install -g autocannon

# Load test HTTP endpoint
autocannon -c 10 -d 30 http://localhost:3000/health
```

## Git Workflow

### Feature Branch

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push to remote
git push origin feature/my-feature

# Open PR on GitHub
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
feat: add support for scheduled transactions
fix: handle null values in transaction import
docs: update API coverage documentation
test: add E2E tests for account creation
refactor: simplify error handling in adapter
chore: update dependencies
```

## Resources

- **TypeScript Docs**: https://www.typescriptlang.org/docs/
- **Zod Documentation**: https://zod.dev/
- **Actual Budget API**: https://actualbudget.org/docs/api/
- **MCP Specification**: https://modelcontextprotocol.io/
- **Playwright Docs**: https://playwright.dev/

## Getting Help

- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions or share ideas
- **Documentation**: Check `/docs` for detailed guides
