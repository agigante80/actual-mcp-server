/**
 * The single builder for a `tools/list` entry (#379).
 *
 * WHY THIS EXISTS. The `tools/list` payload was assembled in THREE near-identical places:
 * the SDK request handler in `httpServer.ts`, the no-session LobeChat compatibility path a
 * hundred lines below it, and the stdio handler in `stdioServer.ts`. Each resolved the
 * schema the same way and built the same object shape, independently.
 *
 * That went unnoticed until annotations were added: patching one site would have shipped
 * annotations to HTTP clients and silently left stdio users (Claude Desktop) without them,
 * which is the transport half this project has been bitten by before (#280). Anything that
 * belongs in the published tool surface has to be added HERE, once, or it reaches some
 * clients and not others.
 */

import { annotationsFor } from './tool-annotations.js';

/** A tool as published to clients. Deliberately minimal: what the MCP spec defines. */
export interface ToolListEntry {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: ReturnType<typeof annotationsFor>;
}

/** An empty-but-valid JSON Schema, for a tool whose schema cannot be resolved. */
const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const;

/**
 * Build the published entries for a list of tool names.
 *
 * @param toolNames    the registered tool names, in registry order
 * @param resolve      resolves a tool's description and JSON Schema (call sites differ in
 *                     where those come from, so it is injected rather than imported, which
 *                     also keeps this module free of a cycle back through the tool registry)
 */
export function buildToolListEntries(
  toolNames: string[],
  resolve: (name: string) => { description?: string; schema?: unknown },
): ToolListEntry[] {
  return toolNames.map((name) => {
    const { description, schema } = resolve(name);
    const inputSchema =
      schema && typeof schema === 'object' && Object.keys(schema).length > 0 ? schema : EMPTY_SCHEMA;
    return {
      name,
      description: description || `Tool ${name}`,
      inputSchema,
      // Advisory metadata for clients, never a guard: the MCP spec says clients must treat
      // annotations as untrusted, and nothing in src/ may branch on one.
      annotations: annotationsFor(name),
    };
  });
}
