declare module './streamable-http.js' {
  export class Server {
    constructor(meta?: any, options?: any);
    setRequestHandler(schema: any, handler: (req: any, extra?: any) => Promise<any>): void;
    connect(transport: any): Promise<void>;
  }

  export class StreamableHTTPServerTransport {
    constructor(opts?: any);
    handleRequest(req: any, res: any, body?: any): Promise<void>;
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