declare module '@modelcontextprotocol/sdk' {
  export interface MCPConnection {
    name: string;
    capabilities: Record<string, unknown>;
    fetchCapabilities(): Promise<Record<string, unknown>>;
    executeTool(toolName: string, params: unknown): Promise<unknown>;
    close(): void;
  }

  export interface ServerCapabilities {
    [key: string]: unknown;
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
    models?: Record<string, unknown>;
    logging?: Record<string, unknown>;
  }
}