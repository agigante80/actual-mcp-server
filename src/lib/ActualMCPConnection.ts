// lib/ActualMCPConnection.ts
import { EventEmitter } from 'events';
import * as actual from '@actual-app/api';
import actualToolsManager from '../actualToolsManager.js';
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
  }

  /** Called by the MCP client to fetch current capabilities */
  async fetchCapabilities() {
    const toolNames = actualToolsManager.getToolNames();
    const tools = toolNames.map((name) => {
      const tool = actualToolsManager.getTool(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return {
        name: tool.name,
        title: tool.name, // optionally replace with prettier name
        description: tool.description,
        inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema) : { type: 'object' },
      };
    });

    return {
      tools: {
        listChanged: true,
        list: tools,
      },
      resources: {},
      prompts: {},
      models: {},
      logging: {},
    };
  }

  /** Executes a tool requested by the client */
  async executeTool(toolName: string, params: any) {
    return await actualToolsManager.callTool(toolName, params);
  }

  /** Optional shutdown logic */
  close() {
    this.removeAllListeners();
  }
}
