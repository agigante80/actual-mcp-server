// Minimal TypeScript shim for the absent `streamable-http` package.
// Implements only the surface used by src/server/httpServer.ts.

import crypto from 'crypto';

export const ListToolsRequestSchema = Symbol('ListToolsRequestSchema');
export const CallToolRequestSchema = Symbol('CallToolRequestSchema');
export const ToolSchema: unknown = {};

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export class Server {
  meta: any;
  options: any;
  handlers: Map<any, (req: any, extra?: any) => Promise<any>>;
  transports: Set<any>;
  constructor(meta: any = {}, options: any = {}) {
    this.meta = meta;
    this.options = options;
    this.handlers = new Map();
    this.transports = new Set();
  }

  setRequestHandler(schema: any, handler: (req: any, extra?: any) => Promise<any>) {
    this.handlers.set(schema, handler);
  }

  async connect(transport: any) {
    this.transports.add(transport);
    transport.server = this;
  }

  async notification(payload: any, opts?: any) {
    for (const t of this.transports) {
      if (typeof t.pushNotification === 'function') {
        try {
          await t.pushNotification(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  // allow handlers to be invoked by transports (shim convenience)
  async invokeHandler(schema: any, req: any, extra?: any) {
    const handler = this.handlers.get(schema);
    if (!handler) throw new Error('Handler not registered');
    return handler(req, extra);
  }
}

export class StreamableHTTPServerTransport {
  opts: any;
  sessionId: string | null;
  server: Server | null;
  closed = false;
  constructor(opts: any = {}) {
    this.opts = opts;
    this.sessionId = null;
    this.server = null;
  }

  async pushNotification(_payload: any) {
    // noop
  }

  async handleRequest(req: any, res: any, bodyFromCaller?: any) {
    const payload = bodyFromCaller && Object.keys(bodyFromCaller).length ? bodyFromCaller : req.body ?? {};
    const method = payload.method;

    if (method === 'initialize') {
      this.sessionId =
        typeof this.opts.sessionIdGenerator === 'function'
          ? this.opts.sessionIdGenerator()
          : crypto.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2, 10)}`;
      if (typeof this.opts.onsessioninitialized === 'function') {
        try {
          this.opts.onsessioninitialized(this.sessionId);
        } catch {}
      }
      // Provide a robust initialize result with safe defaults so MCP clients
      // that validate serverInstructions / capabilities / tools won't error.
      const result = {
        protocolVersion: '2025-06-18',
        // capabilities expected to be an object like { tools: { ... } }
        capabilities: this.server?.options?.capabilities ?? { tools: {} },
        // some clients expect serverInstructions to exist (object or string)
        serverInstructions: this.server?.options?.serverInstructions ?? '',
        // advertise known tools when available
        tools: this.server?.options?.implementedTools ?? [],
      };
      res.json({ jsonrpc: '2.0', id: payload.id ?? null, result });
      return;
    }

    if (method === 'tools/list') {
      if (!this.server) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: 'Server not connected' } });
        return;
      }
      try {
        const r = await this.server.invokeHandler(ListToolsRequestSchema, { params: {} });
        res.json({ jsonrpc: '2.0', id: payload.id ?? null, result: r });
        return;
      } catch (e: any) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: String(e) } });
        return;
      }
    }

    if (method === 'tools/call' && payload.params && payload.params.name) {
      if (!this.server) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: 'Server not connected' } });
        return;
      }
      try {
        const r = await this.server.invokeHandler(CallToolRequestSchema, { params: { name: payload.params.name, arguments: payload.params.arguments ?? {} } }, {});
        res.json({ jsonrpc: '2.0', id: payload.id ?? null, result: r });
        return;
      } catch (e: any) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: String(e) } });
        return;
      }
    }

    if (method === 'ping') {
      if (payload.id !== undefined) res.json({ jsonrpc: '2.0', id: payload.id, result: {} });
      else res.status(200).end();
      return;
    }

    if (typeof method === 'string' && method.startsWith('notifications/')) {
      res.status(200).end();
      return;
    }

    res.status(404).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { code: -32601, message: 'Method not found' } });
  }

  async close() {
    this.closed = true;
    if (this.server && typeof (this.server as any).removeTransport === 'function') {
      // call removeTransport if available (some Server implementations provide it)
      try {
        (this.server as unknown as { removeTransport?: (t: any) => void }).removeTransport?.(this);
      } catch {}
    }
  }
}

// Provide a typed helper implementation for Server.removeTransport callers in case
// the runtime Server wants to call it. This keeps compatibility with earlier code
// that called removeTransport on the server instance.
export interface ServerWithRemove extends Server {
  removeTransport?(t: StreamableHTTPServerTransport): void;
}