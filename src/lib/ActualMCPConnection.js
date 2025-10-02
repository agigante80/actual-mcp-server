// lib/ActualMCPConnection.ts
import { EventEmitter } from 'events';
import * as actual from '@actual-app/api';
/**
 * MCPConnection for Actual Finance
 */
export class ActualMCPConnection extends EventEmitter {
    constructor() {
        super();
        this.name = 'actual';
        // Default capabilities; tools list is sent separately
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
        return {
            tools: {
                listChanged: true,
                list: [
                    {
                        name: 'search.docs',
                        title: 'Search Documents',
                        description: 'Search a small demo document store',
                        inputSchema: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                        },
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
                    },
                ],
            },
            resources: false,
            prompts: false,
            models: false,
            logging: false,
        };
    }
    /** Executes a tool requested by the client */
    async executeTool(toolName, params) {
        switch (toolName) {
            case 'search.docs':
                // Example: bridge to Actual API
                return { result: await actual.searchDocuments(params.query) };
            case 'math.add':
                return { result: params.a + params.b };
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
    /** Optional shutdown logic */
    close() {
        this.removeAllListeners();
    }
}
