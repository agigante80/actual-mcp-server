declare module './streamable-http.js' {
  export class Server {
  constructor(meta?: unknown, options?: unknown);
  setRequestHandler(schema: unknown, handler: (req: unknown, extra?: unknown) => Promise<unknown>): void;
  connect(transport: unknown): Promise<void>;
  }

  export class StreamableHTTPServerTransport {
  constructor(opts?: unknown);
  handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
    close(): Promise<void>;
    sessionId?: string;
  }

  export const ListToolsRequestSchema: any;
  export const CallToolRequestSchema: any;
  export const ToolSchema: any;

  export type Tool = {
    name: string;
    description?: string;
    inputSchema?: any;
  };

  export default Server;
}