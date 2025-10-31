declare module 'streamable-http' {
  export class Server {
    constructor(meta?: Record<string, unknown>, options?: Record<string, unknown>);
    setRequestHandler(schema: unknown, handler: (req: unknown, extra?: unknown) => Promise<unknown>): void;
    connect(transport: unknown): Promise<void>;
    notification(payload: unknown, opts?: unknown): Promise<void>;
    onclose?: () => Promise<void> | void;
  }

  export class StreamableHTTPServerTransport {
    constructor(opts?: Record<string, unknown>);
    handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
    close(): Promise<void>;
    sessionId?: string;
  }

  export const ListToolsRequestSchema: unknown;
  export const CallToolRequestSchema: unknown;
  export type Tool = { name: string; description?: string; inputSchema?: unknown };
  export const ToolSchema: unknown;

  export default Server;
}