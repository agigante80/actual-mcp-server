import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool.d.js';
import adapter from '../lib/actual-adapter.js';

const InputSchema = z.object({}).strict();

const tool: ToolDefinition = {
  name: 'actual_server_get_version',
  description: `Get the version of the Actual Budget server.

Returns the version string of the connected Actual Budget server instance.
This is the self-hosted Actual Budget server version, not the MCP server version.

Use 'actual_server_info' for MCP server details (Node.js, tool count, uptime).
Use this tool to check the Actual Budget server version for compatibility or diagnostics.

Returns:
- { version: string } on success
- { error: string } if the version cannot be retrieved`,
  inputSchema: InputSchema,
  call: async (_args: unknown) => {
    return await adapter.getServerVersion();
  },
};

export default tool;
