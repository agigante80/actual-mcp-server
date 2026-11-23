/**
 * Structured tool results (#642): an optional MCP `outputSchema` plus `structuredContent`.
 *
 * WHY THIS EXISTS. Every result used to go out as one JSON-stringified text block, and no
 * tool published an `outputSchema`. A tool that declares one lets clients (and the Glama
 * TDQS scorer) see the result shape, and lets clients that read `structuredContent` skip
 * parsing text. The mechanism is built once here and applied to a tool by setting
 * `outputSchema` on its definition.
 *
 * RULES, each with the reason it is not negotiable:
 *   - The schema must be a top-level `z.object` (published root `type: "object"`). The SDK
 *     rejects a root `anyOf` (a union) in `tools/list`, and a result that is an array cannot
 *     be structured at all. Alternative result shapes are optional or nullable properties of
 *     one object. Enforced by tests/unit/tool_output_schema.test.js.
 *   - Use `.loose()`: a plain `z.object` publishes `additionalProperties: false`, which would
 *     make any unlisted upstream field fail client validation.
 *   - No `z.record`: a mismatch log carries Zod issue paths, and a record's paths would carry
 *     keys such as account ids or names (budget data, never logged, #556).
 *   - `structuredContent` is the raw JSON-safe value, never the Zod-parsed one, so it equals
 *     `JSON.parse(content[0].text)` exactly and unlisted fields survive.
 *   - On a runtime mismatch the result is the text block plus `isError: true` and NO
 *     `structuredContent`. Text without either makes the SDK `Client.callTool` throw
 *     InvalidRequest for a tool that declares an outputSchema; `isError` is exempt.
 *
 * `types/tool.d.ts` is in the do-not-modify tier, so the optional field lives on this
 * src-side extension of `ToolDefinition`.
 */

import { z, type ZodTypeAny } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { UnknownToolError } from './errors.js';
import { sanitizeKey } from './zod-error-format.js';
import type { ToolDefinition } from '../../types/tool.d.js';

export type ToolDefinitionWithOutput = ToolDefinition & { outputSchema?: ZodTypeAny };

/** The verdict of checking a JSON-safe result against a tool's outputSchema. */
export type OutputCheck = 'valid' | 'mismatch';

export interface CheckedToolResult {
  /** The JSON-safe value, exactly what `callTool` returns. */
  value: unknown;
  /** Absent when the tool declares no outputSchema. */
  check?: OutputCheck;
  /** Zod issue paths when `check` is `mismatch`. Paths only, never values. */
  issuePaths?: string[];
}

export interface FramedToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
}

export function hasOutputSchema(tool: ToolDefinitionWithOutput | undefined): tool is ToolDefinitionWithOutput & { outputSchema: ZodTypeAny } {
  return !!tool && !!tool.outputSchema;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a JSON-safe result against the tool's outputSchema. Returns undefined for a tool
 * without one, so an uncovered tool is untouched. A covered tool whose value is not a plain
 * object is a mismatch: it cannot be structured.
 */
export function checkToolOutput(tool: ToolDefinitionWithOutput, safe: unknown): { check: OutputCheck; issuePaths?: string[] } | undefined {
  if (!hasOutputSchema(tool)) return undefined;
  if (!isPlainObject(safe)) return { check: 'mismatch', issuePaths: [''] };
  const parsed = tool.outputSchema.safeParse(safe);
  if (parsed.success) return { check: 'valid' };
  return { check: 'mismatch', issuePaths: parsed.error.issues.map((i) => i.path.join('.')) };
}

/** The published JSON Schema for a tool's outputSchema, or undefined when it has none. */
export function outputJsonSchema(tool: ToolDefinitionWithOutput | undefined): unknown {
  return hasOutputSchema(tool) ? z.toJSONSchema(tool.outputSchema, { io: 'output' }) : undefined;
}

/**
 * The one framing of a call result for both transports. Without a `check` it is exactly
 * today's framing, byte for byte.
 */
export function frameToolResult(result: unknown, check?: OutputCheck): FramedToolResult {
  const framed: FramedToolResult = {
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
  };
  if (check === 'valid' && isPlainObject(result)) {
    framed.structuredContent = result;
  } else if (check === 'mismatch') {
    framed.isError = true;
  }
  return framed;
}

type Executor = {
  executeTool?: (name: string, args?: unknown) => Promise<unknown>;
  executeToolChecked?: (name: string, args?: unknown) => Promise<CheckedToolResult>;
};

/**
 * Run a tool through the connection and frame the result. Both transports call this, so the
 * verdict cannot be dropped on one of them. A connection without `executeToolChecked` (a
 * test double) gets the plain framing.
 */
export async function executeAndFrame(mcp: unknown, name: string, args: unknown): Promise<FramedToolResult> {
  const exec = mcp as Executor;
  if (typeof exec.executeToolChecked === 'function') {
    const { value, check } = await exec.executeToolChecked(name, args);
    return frameToolResult(value, check);
  }
  if (typeof exec.executeTool !== 'function') {
    throw new Error(`Tool executor not available for ${name}`);
  }
  return frameToolResult(await exec.executeTool(name, args));
}

// ---- tools/call error model (#769) ----------------------------------------------------------
//
// MCP 2025-11-25 (Tools, Error Handling): a tool EXECUTION error (invalid input data, a refusal,
// an upstream API failure) is a result with `isError: true`, which a model can read and retry
// from, while a PROTOCOL error (JSON-RPC) is for an unknown tool, a malformed request or a server
// fault. Many clients hide a protocol error from the model entirely, so everything that is the
// caller's or the budget's problem is a result, and only the three protocol faults below throw.

/**
 * A `-32602` protocol error for a tools/call. Deliberately NOT an McpError: the SDK builds the
 * JSON-RPC error from `code` and `message` as they are, and McpError's own message already
 * starts "MCP error -32602: " which the client's McpError then prefixes a second time. A plain
 * Error with a numeric `code` reaches the wire as exactly `-32602` plus this text.
 */
export class InvalidToolCallError extends Error {
  readonly code = ErrorCode.InvalidParams;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidToolCallError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The two fixed `-32602` envelope texts. Never built from a received value. */
const ENVELOPE_NAME_MESSAGE = 'Invalid tools/call params: "name" must be a string';
const ENVELOPE_ARGUMENTS_MESSAGE = 'Invalid tools/call params: "arguments" must be an object';

/**
 * Validate the transport-level `tools/call` envelope and split it. `arguments` omitted is `{}`
 * (#510). Whatever a model got wrong about a TOOL's arguments is the tool's own Zod validation,
 * reported as an isError result; this only checks the JSON-RPC shape. The thrown InvalidToolCallError carries
 * a fixed text: no received value and no Zod dump, so a hostile argument cannot be reflected
 * into an error message.
 */
export function parseToolCallEnvelope(params: unknown): { name: string; args: unknown } {
  if (!isPlainObject(params) || typeof params.name !== 'string') {
    throw new InvalidToolCallError(ENVELOPE_NAME_MESSAGE);
  }
  const args = params.arguments;
  if (args === undefined) return { name: params.name, args: {} };
  if (!isPlainObject(args)) {
    throw new InvalidToolCallError(ENVELOPE_ARGUMENTS_MESSAGE);
  }
  return { name: params.name, args };
}

/** The most characters of an unknown tool's name echoed back; a name is a lookup key, not content. */
const MAX_UNKNOWN_TOOL_NAME = 64;

function unknownToolError(name: string): InvalidToolCallError {
  // sanitizeKey strips control characters; its own cap adds an ellipsis, so cut hard here.
  const shown = sanitizeKey(name).slice(0, MAX_UNKNOWN_TOOL_NAME);
  return new InvalidToolCallError(`Unknown tool: ${shown}`);
}

/** What `executeToolCall` needs to know about the transport it serves. */
export interface ToolCallOptions {
  /**
   * stdio only (#452, #438). Present: a BRANDED init failure is answered with the fixed sentence
   * instead of the upstream text, and this is called with the cause so the caller can log it.
   * Absent: such an error is forwarded like any other. Both transports pass it since #769.
   */
  onInitFailure?: (cause: string) => void;
}

/**
 * The one place a failed tool call becomes the right wire shape, for BOTH transports.
 * `executeAndFrame` stays the success path.
 *
 *   - unknown tool                    -> InvalidToolCallError (-32602) "Unknown tool: <name>"
 *   - executor missing (wiring fault) -> thrown as before, so -32603: not a tool outcome
 *   - an McpError already             -> rethrown unchanged
 *   - everything else                 -> `{ isError: true, content: [{ type: 'text', text }] }`
 *
 * The text is `error.message` and NOTHING else: never `stack`, `cause`, `data` or the error
 * object, so no frame, path or env value can ride along. A thrown value without a string
 * `message` becomes "Tool call failed". Decisions are by class or brand, never by message text.
 * Deliberately no log call here: the content-free logging rule (#556, #559) already logs the
 * failure upstream with the tool name and error class only.
 */
export async function executeToolCall(
  mcp: unknown,
  name: string,
  args: unknown,
  options: ToolCallOptions = {},
): Promise<FramedToolResult> {
  const exec = mcp as Executor;
  if (typeof exec.executeToolChecked !== 'function' && typeof exec.executeTool !== 'function') {
    // A server wiring fault, so a protocol error. Checked up front, not recognised afterwards
    // by its message.
    throw new Error(`Tool executor not available for ${name}`);
  }
  try {
    return await executeAndFrame(mcp, name, args);
  } catch (err) {
    if (err instanceof McpError || err instanceof InvalidToolCallError) throw err;
    if (err instanceof UnknownToolError) throw unknownToolError(err.tool);
    if (options.onInitFailure) {
      // Loaded lazily and only for stdio: init-failure.ts reaches the logger through retry.ts, and
      // src/index.ts imports THIS module statically before the logger may load (a logger loaded
      // that early patches console and breaks `--version` and the #502 stdout guard).
      const { classifyInitFailure, isInitFailure } = await import('./init-failure.js');
      if (isInitFailure(err)) {
        const { cause, sentence } = classifyInitFailure(err);
        if (cause !== 'unknown') {
          options.onInitFailure(cause);
          return { isError: true, content: [{ type: 'text', text: sentence }] };
        }
      }
    }
    const message = (err as { message?: unknown } | null | undefined)?.message;
    return {
      isError: true,
      content: [{ type: 'text', text: typeof message === 'string' && message.length > 0 ? message : 'Tool call failed' }],
    };
  }
}
