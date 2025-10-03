import crypto from 'crypto';

/**
 * Minimal local shim for the missing 'streamable-http' package.
 * Implements only the methods used by src/server/httpServer.ts so the app can run.
 */

export const ListToolsRequestSchema = Symbol('ListToolsRequestSchema');
export const CallToolRequestSchema = Symbol('CallToolRequestSchema');
export const ToolSchema = {};

export class Server {
  constructor(meta = {}, options = {}) {
    this.meta = meta;
    this.options = options;
    this.handlers = new Map();
    this.transports = new Set();
  }

  setRequestHandler(schema, handler) {
    this.handlers.set(schema, handler);
  }

  async connect(transport) {
    this.transports.add(transport);
    transport.server = this;
  }

  async notification(payload /* , opts */) {
    // best-effort: call pushNotification on transports if implemented
    for (const t of this.transports) {
      if (typeof t.pushNotification === 'function') {
        try {
          await t.pushNotification(payload);
        } catch {
          /* ignore */
        }
      }
    }
  }

  removeTransport(t) {
    this.transports.delete(t);
  }
}

export class StreamableHTTPServerTransport {
  constructor(opts = {}) {
    this.opts = opts;
    this.sessionId = null;
    this.server = null;
    this.closed = false;
  }

  async pushNotification(_payload) {
    // no-op for simple HTTP transport shim
  }

  // handle HTTP POST/GET bodies used by the project (initialize, tools/list, tools/call, ping, notifications/*)
  async handleRequest(req, res, body = {}) {
    const payload = body && Object.keys(body).length ? body : req.body ?? {};
    const method = payload.method;

    // initialize: assign sessionId, call onsessioninitialized, return capabilities
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
      const result = {
        protocolVersion: '2025-06-18',
        capabilities: this.server?.options?.capabilities ?? {},
      };
      res.json({ jsonrpc: '2.0', id: payload.id ?? null, result });
      return;
    }

    // tools/list -> call registered ListToolsRequestSchema handler
    if (method === 'tools/list') {
      const handler = this.server?.handlers.get(ListToolsRequestSchema);
      if (handler) {
        try {
          const r = await handler({ params: {} });
          res.json({ jsonrpc: '2.0', id: payload.id ?? null, result: r });
          return;
        } catch (e) {
          res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: String(e) } });
          return;
        }
      }
    }

    // tools/call -> call registered CallToolRequestSchema handler with params { name, arguments }
    if (method === 'tools/call' && payload.params && payload.params.name) {
      const handler = this.server?.handlers.get(CallToolRequestSchema);
      if (handler) {
        try {
          const r = await handler({ params: { name: payload.params.name, arguments: payload.params.arguments ?? {} } }, {});
          res.json({ jsonrpc: '2.0', id: payload.id ?? null, result: r });
          return;
        } catch (e) {
          res.status(500).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { message: String(e) } });
          return;
        }
      }
    }

    // ping and simple notifications
    if (method === 'ping') {
      if (payload.id !== undefined) res.json({ jsonrpc: '2.0', id: payload.id, result: {} });
      else res.status(200).end();
      return;
    }

    if (typeof method === 'string' && method.startsWith('notifications/')) {
      // No JSON-RPC id expected for notifications; just acknowledge
      res.status(200).end();
      return;
    }

    // fallback
    res.status(404).json({ jsonrpc: '2.0', id: payload.id ?? null, error: { code: -32601, message: 'Method not found' } });
  }

  async close() {
    this.closed = true;
    if (this.server && typeof this.server.removeTransport === 'function') {
      this.server.removeTransport(this);
    }
  }
}