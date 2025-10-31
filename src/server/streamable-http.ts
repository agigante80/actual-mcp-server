// Minimal TypeScript shim for the absent `streamable-http` package.
// Implements only the surface used by src/server/httpServer.ts.

import crypto from 'crypto';

export const ListToolsRequestSchema = Symbol('ListToolsRequestSchema');
export const CallToolRequestSchema = Symbol('CallToolRequestSchema');
export const ToolSchema: Record<string, unknown> = {};

export type Tool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export class Server {
  meta: Record<string, unknown>;
  options: Record<string, unknown>;
  handlers: Map<unknown, (req: unknown, extra?: unknown) => Promise<unknown>>;
  transports: Set<unknown>;
  onclose?: () => Promise<void> | undefined;
  constructor(meta: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
    this.meta = meta;
    this.options = options;
    this.handlers = new Map();
    this.transports = new Set();
  }

  setRequestHandler(schema: unknown, handler: (req: unknown, extra?: unknown) => Promise<unknown>) {
    this.handlers.set(schema, handler);
  }

  async connect(transport: unknown) {
    this.transports.add(transport);
    // Attach reference for test shims (loose typing intentionally preserved here)
    try {
      (transport as { server?: unknown }).server = this;
    } catch {}
  }

  async notification(payload: unknown, opts?: unknown) {
    for (const t of this.transports) {
      if (typeof (t as unknown as { pushNotification?: Function }).pushNotification === 'function') {
        try {
          await (t as unknown as { pushNotification?: (p: unknown) => Promise<unknown> }).pushNotification!(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  // allow handlers to be invoked by transports (shim convenience)
  async invokeHandler(schema: unknown, req: unknown, extra?: unknown) {
    const handler = this.handlers.get(schema);
    if (!handler) throw new Error('Handler not registered');
    return handler(req, extra);
  }
}

export class StreamableHTTPServerTransport {
  opts: Record<string, unknown>;
  sessionId: string | null;
  server: Server | null;
  closed = false;
  constructor(opts: Record<string, unknown> = {}) {
    this.opts = opts;
    this.sessionId = null;
    this.server = null;
  }

  async pushNotification(_payload: unknown) {
    // noop
  }

  async handleRequest(req: any, res: any, bodyFromCaller?: unknown) {
    const payload = (bodyFromCaller && Object.keys(bodyFromCaller as Record<string, unknown>).length ? bodyFromCaller : (req.body ?? {})) as Record<string, unknown>;
    const method = payload.method as string | undefined;

    if (method === 'initialize') {
      this.sessionId =
        typeof this.opts.sessionIdGenerator === 'function'
          ? (this.opts.sessionIdGenerator as () => string)()
          : crypto.randomUUID?.() ?? `local-${Math.random().toString(36).slice(2, 10)}`;
      if (typeof this.opts.onsessioninitialized === 'function') {
        try {
          (this.opts.onsessioninitialized as (id: string | null) => void)(this.sessionId);
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
      } catch (e: unknown) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: String(e) } });
        return;
      }
    }

    if (method === 'tools/call' && payload.params && (payload.params as Record<string, unknown>).name) {
      if (!this.server) {
        res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: 'Server not connected' } });
        return;
      }
      try {
        const params = payload.params as Record<string, unknown>;
        const r = await this.server.invokeHandler(CallToolRequestSchema, { params: { name: params.name, arguments: params.arguments ?? {} } }, {});
        res.json({ jsonrpc: '2.0', id: payload.id ?? null, result: r });
        return;
      } catch (e: unknown) {
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
    if (this.server && typeof (this.server as { removeTransport?: Function }).removeTransport === 'function') {
      (this.server as { removeTransport?: (t: unknown) => void }).removeTransport!(this);
    }
  }
}