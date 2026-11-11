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
