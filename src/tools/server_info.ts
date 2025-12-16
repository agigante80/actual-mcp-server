import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import actualToolsManager from '../actualToolsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json and append git commit hash for dev builds
let packageInfo: { version: string; name: string; description: string };
try {
  const packagePath = join(__dirname, '../../../package.json');
  const packageJson = readFileSync(packagePath, 'utf-8');
  packageInfo = JSON.parse(packageJson);
  
  // Append git commit hash for development builds
  try {
    const { execSync } = require('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: join(__dirname, '../../..') }).trim();
    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: join(__dirname, '../../..') }).trim();
    if (branch === 'develop' || branch !== 'main') {
      packageInfo.version = `${packageInfo.version}-dev-${commitHash}`;
    }
  } catch (gitErr) {
    // Git not available or not in a git repo, use version as-is
  }
} catch (error) {
  packageInfo = { version: 'unknown', name: 'actual-mcp-server', description: 'MCP server for Actual Budget' };
}

const InputSchema = z.object({}).strict();

const tool: ToolDefinition = {
  name: 'actual_server_info',
  description: `Get MCP server version and system information.

Returns:
- Server version
- Server name
- Node.js version
- MCP SDK version
- Actual Budget API version
- Total tools available
- Uptime

Use this to check server status, verify version compatibility, or debug issues.`,
  inputSchema: InputSchema,
  call: async (_args: unknown, _meta?: unknown) => {
    const uptime = process.uptime();
    const uptimeFormatted = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
    
    return {
      server: {
        name: packageInfo.name,
        version: packageInfo.version,
        description: packageInfo.description,
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      dependencies: {
        mcpSdk: '^1.18.2',
        actualApi: '^25.11.0',
      },
      status: {
        uptime: uptimeFormatted,
        uptimeSeconds: Math.floor(uptime),
        memoryUsage: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
        },
      },
      tools: {
        total: actualToolsManager.getToolNames().length,
      },
    };
  },
};

export default tool;
