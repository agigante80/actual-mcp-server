import os from 'os';

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// new: transport logging helpers (enabled when --debug or DEBUG/MCP_BRIDGE_DEBUG_TRANSPORT set)
export function shouldDebugTransport(): boolean {
  const argvDebug = process.argv.slice(2).includes('--debug');
  const envDebug = Boolean(process.env.DEBUG) || process.env.MCP_BRIDGE_DEBUG_TRANSPORT === 'true' || process.env.LOG_LEVEL === 'debug';
  return argvDebug || envDebug;
}

/**
 * Log transport-level request/response objects when debug is enabled.
 * - prefix: short label like "HTTP REQ" / "HTTP RES" / "SSE OUT"
 * - obj: any serializable data (headers, body, meta)
 *
 * This uses console.debug (falls through to console if no structured logger available).
 */
export function logTransport(prefix: string, obj: unknown): void {
  if (!shouldDebugTransport()) return;
  const ts = new Date().toISOString();
  let payload: string;
  try {
    payload = JSON.stringify(obj, replacer, 2);
  } catch {
    try {
      payload = String(obj);
    } catch {
      payload = '[unserializable payload]';
    }
  }
  // prefer console.debug so existing debug tooling (DEBUG env) can capture it
  // format similar to other logs: "<iso> debug: [TRANSPORT] prefix: <json>"
  // eslint-disable-next-line no-console
  console.debug(`${ts} debug: [TRANSPORT] ${prefix}: ${payload}`);
}

// Helper replacer to avoid throwing on circular refs and to truncate very large buffers
function replacer(_key: string, value: unknown) {
  // Limit Buffer/Uint8Array printing
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && value instanceof Buffer)) {
    const buf = value as Uint8Array | Buffer;
    const len = (buf as { length?: number }).length ?? 0;
    const preview = Array.prototype.slice.call(buf, 0, 64);
    return { _type: 'Buffer', length: len, preview };
  }
  if (value instanceof Uint8Array) {
    const buf = value as Uint8Array;
    const len = buf.length;
    const preview = Array.prototype.slice.call(buf, 0, 64);
    return { _type: 'Uint8Array', length: len, preview };
  }
  return value;
}