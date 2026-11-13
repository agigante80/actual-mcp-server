import { z } from 'zod';
import type { ToolDefinitionWithOutput } from '../lib/tool-output.js';
import type { CompactActionRow, CompactOperations, CompactToolSpec } from './types.js';

const selectorOf = (spec: CompactToolSpec): string => spec.selector ?? 'action';

function unknownActionError(selector: string, spec: CompactToolSpec, got: unknown): z.ZodError {
  return new z.ZodError([
    {
      code: 'invalid_value',
      values: [...spec.actions.keys()],
      path: [selector],
      message: `Invalid option: expected one of ${[...spec.actions.keys()].map((a) => `"${a}"`).join('|')}${
        typeof got === 'string' ? `, got "${got}"` : ''
      }`,
    },
  ]);
}

/** Rename and wrap one already-validated payload into the legacy tool's argument shape. */
function shapeArgs(row: CompactActionRow, parsed: Record<string, unknown>): Record<string, unknown> {
  const rename = row.rename ?? {};
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    renamed[Object.hasOwn(rename, key) ? rename[key]! : key] = value;
  }
  if (!row.wrap) return renamed;
  const top = new Set(row.wrap.top);
  const out: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(renamed)) (top.has(key) ? out : inner)[key] = value;
  out[row.wrap.into] = inner;
  return out;
}

/**
 * Route one compact call to its legacy tool. Order: pick the action, validate that action's
 * strict schema, shape the arguments, call the legacy tool through `ops`, return its value
 * unchanged. A bad selector or bad field is a ZodError, formatted like any tool's (#206).
 */
export async function dispatchCompact(ops: CompactOperations, spec: CompactToolSpec, input: unknown): Promise<unknown> {
  const selector = selectorOf(spec);
  const record = input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  const chosen = record[selector] ?? spec.defaultAction;
  delete record[selector];
  const row = typeof chosen === 'string' ? spec.actions.get(chosen) : undefined;
  if (!row || typeof chosen !== 'string') throw unknownActionError(selector, spec, chosen);
  const parsed = row.fields.strict().parse(record) as Record<string, unknown>;
  return ops.callOperation(row.legacy, shapeArgs(row, parsed), { tool: spec.name, action: chosen });
}

/**
 * The published input schema: one flat, strict object (a union of per-action schemas would
 * not survive every MCP client's JSON Schema handling). The selector is an enum; every other
 * key is optional here, and the chosen action's own schema is re-run in superRefine so the
 * flat shape never accepts what the action would refuse. A key two actions declare with
 * different schemas is left open (z.any) in the flat shape; the action schema still decides.
 */
function compactInputSchema(spec: CompactToolSpec): z.ZodType {
  const selector = selectorOf(spec);
  const names = [...spec.actions.keys()] as [string, ...string[]];
  const shape: Record<string, z.ZodType> = {};
  const seen = new Map<string, z.ZodType>();
  for (const row of spec.actions.values()) {
    for (const [key, schema] of Object.entries(row.fields.shape) as [string, z.ZodType][]) {
      if (key === selector) continue;
      const prior = seen.get(key);
      if (prior === undefined) {
        seen.set(key, schema);
        shape[key] = schema.optional();
      } else if (prior !== schema) {
        shape[key] = z.any().optional();
      }
    }
  }
  const selectorSchema = z.enum(names);
  shape[selector] = spec.defaultAction === undefined ? selectorSchema : selectorSchema.optional();
  return z
    .object(shape)
    .strict()
    .superRefine((value, ctx) => {
      const rest = { ...(value as Record<string, unknown>) };
      const chosen = rest[selector] ?? spec.defaultAction;
      delete rest[selector];
      const row = typeof chosen === 'string' ? spec.actions.get(chosen) : undefined;
      if (!row) return;
      const result = row.fields.strict().safeParse(rest);
      if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue as never);
    });
}

/**
 * Build the registered definition for a compact tool. The plain ToolDefinition shape, not
 * createTool(): createTool wraps a handler's value in `{ result }`, and a compact tool must
 * return the legacy value unchanged.
 */
export function buildCompactTool(spec: CompactToolSpec, ops: CompactOperations): ToolDefinitionWithOutput {
  const inputSchema = compactInputSchema(spec);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    call: async (args: unknown) => dispatchCompact(ops, spec, inputSchema.parse(args ?? {})),
  };
}
