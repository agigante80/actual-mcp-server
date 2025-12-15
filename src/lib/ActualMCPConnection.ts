// lib/ActualMCPConnection.ts
import { EventEmitter } from 'events';
import * as actual from '@actual-app/api';
import actualToolsManager from '../actualToolsManager.js';
import adapter from './actual-adapter.js';
import { zodToJsonSchema } from 'zod-to-json-schema';


/**
 * MCPConnection implementation for Actual Finance bridge.
 */
export class ActualMCPConnection extends EventEmitter {
  name: string;
  capabilities: object;

  constructor() {
    super();
    this.name = 'actual';
    this.capabilities = {
      tools: { listChanged: true },
      resources: { listChanged: false },
      prompts: { listChanged: false },
      models: { listChanged: false },
      logging: { listChanged: false },
    };

    // Re-emit adapter notifications as connection-level 'progress' events
    try {
      adapter.notifications.on('progress', (token: string, payload: unknown) => {
        this.emit('progress', { token, payload });
      });
    } catch (e) {
      // ignore if adapter doesn't expose notifications yet
    }
  }

  /** Called by the MCP client to fetch current capabilities */
  async fetchCapabilities() {
    // If actualToolsManager is not ready, return demo tools
    let tools;
    try {
      const toolNames = actualToolsManager.getToolNames();
      tools = toolNames.map((name) => {
        const tool = actualToolsManager.getTool(name);
        if (!tool) {
          throw new Error(`Tool not found: ${name}`);
        }
        // Add examples if present on the tool
        return {
          name: tool.name,
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema as any) : { type: 'object' },
        };
      });
    } catch (e) {
      // fallback to demo tools
      tools = [
        {
          name: 'search.docs',
          title: 'Search Documents',
          description: 'Search a small demo document store',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
          examples: [ { query: 'budget' } ],
        },
        {
          name: 'math.add',
          title: 'Add Numbers',
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
          examples: [ { a: 2, b: 3 } ],
        },
      ];
    }
    return {
      tools: {
        listChanged: true,
        list: tools,
      },
      resources: false,
      prompts: false,
      models: false,
      logging: false,
      serverInstructions: 'This server exposes Actual Finance tools via MCP. You must provide ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_BUDGET_SYNC_ID as environment variables.'
    };
  }

  /** Executes a tool requested by the client */
  async executeTool(toolName: string, params: unknown) {
    // If actualToolsManager is not ready, support demo tools
    if (actualToolsManager && typeof actualToolsManager.callTool === 'function') {
      try {
        return await actualToolsManager.callTool(toolName, params);
      } catch (e) {
        // fallback to demo
      }
    }
    switch (toolName) {
      case 'search.docs': {
        // Example: bridge to Actual API (demo)
        if (params && typeof params === 'object' && 'query' in (params as Record<string, unknown>)) {
          const query = (params as Record<string, unknown>)['query'];
          if (typeof query === 'string') {
            return { result: await actual.searchDocuments(query) };
          }
        }
        throw new Error('Invalid params for search.docs');
      }
      case 'math.add': {
        if (params && typeof params === 'object' && 'a' in (params as Record<string, unknown>) && 'b' in (params as Record<string, unknown>)) {
          const p = params as { a: number; b: number };
          return { result: p.a + p.b };
        }
        throw new Error('Invalid params for math.add');
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /** Optional shutdown logic */
  close() {
    this.removeAllListeners();
  }
}
