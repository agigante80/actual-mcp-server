// src/server/httpErrorHandler.ts
//
// #543: the final Express error layer for the HTTP transport. Without it, an error falls
// through to Express's default handler, and from express 5.3.0 that handler logs the WHOLE
// error object with console.error (5.2.1 logged err.stack). body-parser 2.3.0 attaches the
// raw request text to a JSON parse error as `err.body`, and express.json runs before any
// auth, so an unauthenticated malformed POST would put its raw body in the logs. The default
// handler also renders the stack into the response under NODE_ENV=development.
//
// Contract:
//   - The response NEVER carries err.message, err.body or err.stack, whatever NODE_ENV is.
//   - The log NEVER carries request body content: not err.body, and not err.message either,
//     because the V8 JSON SyntaxError message quotes the input text. Only an allowlist of
//     fields is logged.
//   - next(err) is NEVER called: app.handle wires finalhandler with onerror: logerror, which
//     is the console.error(err) path this module exists to close.
//
// The handler also absorbs any non-MCPAuth error that mcp-auth's bearerAuth rethrows, with
// the same fixed 500 and the same allowlisted log.

import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { createModuleLogger } from '../lib/loggerFactory.js';
import { resolveRequestId } from '../logger.js';

const log = createModuleLogger('HTTP');

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_INTERNAL_ERROR = -32603;

interface HttpErrorLike {
  type?: unknown;
  expose?: unknown;
  status?: unknown;
  statusCode?: unknown;
  name?: unknown;
  code?: unknown;
}

/**
 * True when the request targets the MCP endpoint: the pathname of `originalUrl` (the query
 * string removed) equals `mcpPath` or starts with `mcpPath + '/'`. Never a bare prefix match:
 * with an MCP path of `/mcp`, `/mcp-info` is NOT the MCP endpoint and gets the plain shape.
 */
function isMcpRequestPath(originalUrl: string, mcpPath: string): boolean {
  const q = originalUrl.indexOf('?');
  const pathname = q === -1 ? originalUrl : originalUrl.slice(0, q);
  const base = mcpPath.length > 1 && mcpPath.endsWith('/') ? mcpPath.slice(0, -1) : mcpPath;
  // A root MCP path ('/') makes every request an MCP request.
  if (base === '/' || base === '') return true;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function createHttpErrorHandler({ mcpPath }: { mcpPath: string }) {
  // Four parameters: Express identifies an error handler by its arity.
  return function httpErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
    const e: HttpErrorLike = err !== null && typeof err === 'object' ? (err as HttpErrorLike) : {};
    const type = typeof e.type === 'string' ? e.type : undefined;
    // The ticket's first cut mapped everything except parse and size errors to 500. That was
    // reversed in review: body-parser raises other CLIENT errors before auth (unsupported
    // charset or encoding: 415; a corrupt gzip body or an aborted request: 400), each marked
    // expose with its own 4xx status. Reporting those as 500 and logging them at error level
    // let any caller fire 5xx alerts at will. So an exposed 4xx keeps its status; only the
    // status is taken from the error, never its message.
    let status = 500;
    if (type === 'entity.parse.failed') status = 400;
    else if (type === 'entity.too.large') status = 413;
    else {
      const s = typeof e.status === 'number' ? e.status : e.statusCode;
      if (e.expose === true && Number.isInteger(s) && (s as number) >= 400 && (s as number) <= 499) status = s as number;
    }

    const mcp = isMcpRequestPath(req.originalUrl || req.url || '', mcpPath);
    const meta: Record<string, unknown> = {
      type,
      status,
      method: req.method,
      // The pathname only: a query string can carry anything.
      path: (req.originalUrl || '').split('?')[0],
      requestId: resolveRequestId(req.get('x-correlation-id')),
    };
    if (status === 500) {
      if (typeof e.name === 'string') meta.errorName = e.name;
      if (typeof e.code === 'string' || typeof e.code === 'number') meta.errorCode = e.code;
    }

    if (res.headersSent) {
      log.warn('Request error after the response started; closing the connection', meta);
      req.socket?.destroy();
      return;
    }

    if (status === 500) log.error('Unhandled request error', undefined, meta);
    else log.warn('Rejected request body', meta);

    let message = 'Internal error';
    if (type === 'entity.parse.failed') message = mcp ? 'Parse error' : 'Invalid JSON body';
    else if (status === 413) message = 'Request body too large';
    else if (status !== 500) message = STATUS_CODES[status] ?? 'Bad Request';

    if (mcp) {
      let code = JSONRPC_INVALID_REQUEST;
      if (type === 'entity.parse.failed') code = JSONRPC_PARSE_ERROR;
      else if (status === 500) code = JSONRPC_INTERNAL_ERROR;
      res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
    } else {
      res.status(status).json({ error: message });
    }
  };
}
