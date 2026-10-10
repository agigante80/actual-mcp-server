import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import actualToolsManager from '../actualToolsManager.js';
import { INSTALLED_API_VERSION, resolveInstalledVersion } from '../lib/installed-api-version.js';
import { getMcpServerVersion } from '../lib/mcp-version.js';

/** Resolved once at module load, not per call: the walk does blocking file reads
 *  and this tool can be called in a loop. The SDK exports no root path, so the
 *  resolvable subpath is passed explicitly (#445). */
const MCP_SDK_RESOLVED = resolveInstalledVersion('@modelcontextprotocol/sdk', '@modelcontextprotocol/sdk/server/index.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Name, description and declared dependencies come from package.json. The version does
// NOT: it comes from getMcpServerVersion() at call time (#541), so it matches the MCP
// initialize version and importing the tool registry never spawns git.
let packageInfo: { name: string; description: string; dependencies?: Record<string, string> };
try {
  const packagePath = join(__dirname, '../../../package.json');
  packageInfo = JSON.parse(readFileSync(packagePath, 'utf-8'));
} catch (error) {
  packageInfo = { name: 'actual-mcp-server', description: 'MCP server for Actual Budget' };
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
        version: getMcpServerVersion(),
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
        // total is what this process PUBLISHES; registered is what exists. They differ
        // when MCP_TOOLSETS, MCP_TOOLS or MCP_READ_ONLY narrows the surface (#483).
        total: actualToolsManager.getPublishedToolNames().length,
        registered: actualToolsManager.getToolNames().length,
        policy: actualToolsManager.getToolPolicy(),
      },
    };
  },
};

export default tool;
