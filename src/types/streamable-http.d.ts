declare module 'streamable-http' {
  export class Server {
    constructor(meta?: any, options?: any);
    setRequestHandler(schema: any, handler: (req: any, extra?: any) => Promise<any>): void;
    connect(transport: any): Promise<void>;
    notification(payload: any, opts?: any): Promise<void>;
    onclose?: () => Promise<void> | void;
  }

  export class StreamableHTTPServerTransport {
    constructor(opts?: any);
    handleRequest(req: any, res: any, body?: any): Promise<void>;
    close(): Promise<void>;
    sessionId?: string;
  }

  export const ListToolsRequestSchema: any;
  export const CallToolRequestSchema: any;
  export type Tool = any;
  export const ToolSchema: any;

  export default Server;
}