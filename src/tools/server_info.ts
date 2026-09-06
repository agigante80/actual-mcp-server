import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import actualToolsManager from '../actualToolsManager.js';
import { INSTALLED_API_VERSION, resolveInstalledVersion } from '../lib/installed-api-version.js';

/** Resolved once at module load, not per call: the walk does blocking file reads
 *  and this tool can be called in a loop. The SDK exports no root path, so the
 *  resolvable subpath is passed explicitly (#445). */
const MCP_SDK_RESOLVED = resolveInstalledVersion('@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/server/index.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from environment variable (set during Docker build) or package.json
let packageInfo: { version: string; name: string; description: string; dependencies?: Record<string, string> };
try {
  const packagePath = join(__dirname, '../../../package.json');
  const packageJson = readFileSync(packagePath, 'utf-8');
  packageInfo = JSON.parse(packageJson);
  
  // Use VERSION environment variable if available (set by Docker build or CI/CD)
  // This includes development metadata like: 0.2.4-dev-abc1234
  if (process.env.VERSION && process.env.VERSION !== 'unknown') {
    packageInfo.version = process.env.VERSION;
  } else {
    // Fallback: Try to append git commit hash for local development builds
    try {
      const { execSync } = require('child_process');
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: join(__dirname, '../../..') }).trim();
      const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: join(__dirname, '../../..') }).trim();
      if (branch === 'develop' || branch === 'development' || branch !== 'main') {
        packageInfo.version = `${packageInfo.version}-dev-${commitHash}`;
      }
    } catch (gitErr) {
      // Git not available or not in a git repo, use package.json version as-is
    }
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
        transport: process.env.MCP_STDIO_MODE === 'true' ? 'stdio' : 'http',
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      // #445: report BOTH the declared range and what is actually installed. They
      // answer different questions ("what does this build allow" versus "what is it
      // running"), and #427 needed the second: a caret range reports identically for
      // every version inside it, which is exactly the ambiguity that made a server
      // and api version skew hard to diagnose.
      //
      // The resolved fields are OMITTED when they cannot be determined, never set to
      // a sentinel: absence means "could not resolve" and no consumer has to
      // special-case a magic string. The declared fields keep their existing
      // behaviour and value, so nothing that reads them today breaks.
      dependencies: {
        mcpSdk: packageInfo.dependencies?.['@modelcontextprotocol/sdk'] ?? 'unknown',
        actualApi: packageInfo.dependencies?.['@actual-app/api'] ?? 'unknown',
        ...(MCP_SDK_RESOLVED ? { mcpSdkResolved: MCP_SDK_RESOLVED } : {}),
        ...(INSTALLED_API_VERSION ? { actualApiResolved: INSTALLED_API_VERSION } : {}),
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
