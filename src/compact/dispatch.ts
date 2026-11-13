import { z } from 'zod';
import type { ToolDefinitionWithOutput } from '../lib/tool-output.js';
import type { CompactActionRow, CompactOperations, CompactTarget, CompactToolSpec } from './types.js';

const selectorOf = (spec: CompactToolSpec): string => spec.selector ?? 'action';

/** A tool declared `selector: null` has one action and publishes no selector property (#674). */
const hasSelector = (spec: CompactToolSpec): boolean => spec.selector !== null;

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

/** Rename, drop, wrap and fix one already-validated payload into the legacy tool's argument shape. */
function shapeArgs(target: CompactTarget, parsed: Record<string, unknown>): Record<string, unknown> {
  const rename = target.rename ?? {};
  const drop = new Set(target.drop ?? []);
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (drop.has(key)) continue;
    renamed[Object.hasOwn(rename, key) ? rename[key]! : key] = value;
  }
  let out = renamed;
  if (target.wrap) {
    const top = new Set(target.wrap.top);
    const outer: Record<string, unknown> = {};
    const inner: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(renamed)) (top.has(key) ? outer : inner)[key] = value;
    outer[target.wrap.into] = inner;
    out = outer;
  }
  return { ...out, ...(target.fixed ?? {}) };
}

/** Every legacy tool a spec can call: each row's default and each route target, once. */
export function compactLegacyNames(spec: CompactToolSpec): string[] {
  const names = new Set<string>();
  for (const row of spec.actions.values()) {
    names.add(row.legacy);
    for (const route of row.routes ?? []) names.add(route.legacy);
  }
  return [...names];
}

/** The keys a row accepts under any of its targets. */
const rowKeys = (row: CompactActionRow): Set<string> =>
  new Set([row.fields, ...(row.routes ?? []).map((r) => r.fields)].flatMap((f) => Object.keys(f.shape)));

const customIssue = (key: string, message: string): z.core.$ZodIssue => ({ code: 'custom', path: [key], message });

/** The message for a key the chosen target does not accept, naming the actions that do. */
function notValidMessage(spec: CompactToolSpec, selector: string, chosen: string, row: CompactActionRow, key: string): string {
  if (!hasSelector(spec)) return rowKeys(row).has(key) ? 'cannot be used with the other fields given' : `not accepted by ${spec.name}`;
  const owners = [...spec.actions].filter(([, r]) => rowKeys(r).has(key)).map(([name]) => name);
  if (rowKeys(row).has(key)) return `cannot be used with the other fields given for ${selector}: ${chosen}`;
  return owners.length > 0
    ? `not valid for ${selector}: ${chosen}; valid only for ${selector}: ${owners.join(', ')}`
    : `not valid for ${selector}: ${chosen}`;
}

interface CallPlan {
  chosen: string;
  target: CompactTarget;
  parsed: Record<string, unknown>;
}

/**
 * Pick the action, pick the route, validate the target's strict schema. Throws a ZodError for a
 * bad selector, two routes at once, a key the target does not accept, or a bad value. Nothing
 * here reaches a legacy tool, so every refusal is made before any call.
 */
function planCall(spec: CompactToolSpec, input: unknown): CallPlan {
  const selector = selectorOf(spec);
  const record = input && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  const chosen = hasSelector(spec) ? (record[selector] ?? spec.defaultAction) : spec.defaultAction;
  if (hasSelector(spec)) delete record[selector];
  const row = typeof chosen === 'string' ? spec.actions.get(chosen) : undefined;
  if (!row || typeof chosen !== 'string') throw unknownActionError(selector, spec, chosen);

  const hits = (row.routes ?? []).filter(
    (r) => r.triggers.some((t) => record[t] !== undefined) && (r.when?.(record) ?? true),
  );
  if (hits.length > 1) {
    const named = hits.map((r) => r.triggers.find((t) => record[t] !== undefined)!);
    throw new z.ZodError([
      customIssue(
        named[1]!,
        `${named.join(' and ')} are mutually exclusive${hasSelector(spec) ? ` for ${selector}: ${chosen}` : ''}; send one of them`,
      ),
    ]);
  }
  const target: CompactTarget = hits[0] ?? row;

  // A required field that is absent gets one plain message naming it and what required it
  // (a union schema such as `query` would otherwise say only "Invalid input").
  const given = hits[0]?.triggers.filter((t) => record[t] !== undefined) ?? [];
  const missing = Object.entries(target.fields.shape as Record<string, z.ZodType>)
    .filter(([key, schema]) => record[key] === undefined && !schema.safeParse(undefined).success)
    .map(([key]) => key);
  const result = target.fields.strict().safeParse(record);
  if (!result.success || missing.length > 0) {
    const reason =
      given.length > 0 ? `required with ${given.join(', ')}` : hasSelector(spec) ? `required for ${selector}: ${chosen}` : 'required';
    const issues = [
      ...missing.map((key) => customIssue(key, reason)),
      ...(result.success ? [] : result.error.issues).filter((issue) => !missing.includes(String(issue.path[0]))).flatMap(
        (issue): z.core.$ZodIssue[] =>
          issue.code === 'unrecognized_keys'
            ? issue.keys.map((key) => customIssue(key, notValidMessage(spec, selector, chosen, row, key)))
            : [issue],
      ),
    ];
    throw new z.ZodError(issues);
  }
  return { chosen, target, parsed: result.data as Record<string, unknown> };
}

// ---- #670 section 4b: legacy tool names in text become compact phrases ----

const LEGACY_NAME = /\bactual_[a-z0-9_]+/g;

/**
 * Legacy tool name to the compact phrase that now reaches it, built from the registry so it
 * cannot drift: `actual_accounts_list` becomes `list_entities with type account`; a routed
 * tool names the selector AND its trigger (`list_entities with type rule and payee_id`, or
 * `list_entities with type and query` when several types carry the route), because the
 * trigger alone is not a callable shape (the selector is required). A tool reached more than one way lists
 * each phrase joined with " or ".
 */
export function legacyPhrases(specs: readonly CompactToolSpec[]): ReadonlyMap<string, string> {
  const phrases = new Map<string, string[]>();
  const add = (legacy: string, phrase: string): void => {
    const list = phrases.get(legacy) ?? [];
    if (!list.includes(phrase)) list.push(phrase);
    phrases.set(legacy, list);
  };
  for (const spec of specs) {
    const selector = selectorOf(spec);
    // legacy -> route phrase -> the selector values that carry that route
    const routed = new Map<string, Map<string, string[]>>();
    for (const [value, row] of spec.actions) {
      add(row.legacy, hasSelector(spec) ? `${spec.name} with ${selector} ${value}` : spec.name);
      for (const route of row.routes ?? []) {
        const byPhrase = routed.get(route.legacy) ?? new Map<string, string[]>();
        const key = route.phrase ?? route.triggers[0];
        byPhrase.set(key, [...(byPhrase.get(key) ?? []), value]);
        routed.set(route.legacy, byPhrase);
      }
    }
    // One value names it (`with type rule and payee_id`); several are not listed (`with type and query`).
    for (const [legacy, byPhrase] of routed) {
      for (const [key, values] of byPhrase) {
        add(
          legacy,
          hasSelector(spec)
            ? `${spec.name} with ${selector}${values.length === 1 ? ` ${values[0]}` : ''} and ${key}`
            : `${spec.name} with ${key}`,
        );
      }
    }
  }
  return new Map([...phrases].map(([legacy, list]) => [legacy, list.join(' or ')]));
}

const rewriteText = (text: string, table: ReadonlyMap<string, string>): string =>
  text.replace(LEGACY_NAME, (name) => table.get(name) ?? name);

/**
 * Rewrite legacy names inside an error IN PLACE, so a NotFoundRefusal or OutOfRangeRefusal
 * keeps its class (isPreflightRefusal and instanceof still hold) and only the text a client
 * reads changes. The stack's first line quotes the old message, so it is rewritten too.
 */
function rewriteError(err: unknown, table: ReadonlyMap<string, string>): void {
  if (!err || typeof err !== 'object') return;
  const e = err as { message?: unknown; stack?: unknown };
  if (typeof e.message === 'string') e.message = rewriteText(e.message, table);
  if (typeof e.stack === 'string') e.stack = rewriteText(e.stack, table);
}

/** The message keys a legacy result carries text for the model in. Data keys are never touched. */
const MESSAGE_KEYS = ['error', 'hint'] as const;

/**
 * Rewrite the message strings of a returned value (legacy tools return a refusal, or a
 * truncation hint, as a value). Looked for at the top level and one level down under
 * `result`, because createTool() wraps every handler value as `{ result }`. Only the
 * MESSAGE_KEYS are rewritten: a payee or note that happens to contain a tool name is data.
 */
function rewriteResult(result: unknown, table: ReadonlyMap<string, string>): unknown {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const r = value as Record<string, unknown>;
    for (const key of MESSAGE_KEYS) {
      const text = r[key];
      if (typeof text === 'string') r[key] = rewriteText(text, table);
    }
  };
  visit(result);
  if (result && typeof result === 'object' && !Array.isArray(result)) visit((result as Record<string, unknown>).result);
  return result;
}

/**
 * Route one compact call to its legacy tool. Order: plan (pick the action and the route,
 * validate that target's strict schema), shape the arguments, call the legacy tool through
 * `ops`, return its value with legacy names rewritten (4b). A bad call is a ZodError,
 * formatted like any tool's (#206). `names` is the table for ALL compact tools, so an error
 * naming a tool of a sibling compact tool is translated too; it defaults to this spec's own.
 */
export async function dispatchCompact(
  ops: CompactOperations,
  spec: CompactToolSpec,
  input: unknown,
  names: ReadonlyMap<string, string> = legacyPhrases([spec]),
): Promise<unknown> {
  const { chosen, target, parsed } = planCall(spec, input);
  try {
    const result = await ops.callOperation(target.legacy, shapeArgs(target, parsed), { tool: spec.name, action: chosen });
    return rewriteResult(result, names);
  } catch (err) {
    rewriteError(err, names);
    throw err;
  }
}

/** Every key the spec declares, with the schema of its first declaration (see compactInputSchema). */
function allFields(spec: CompactToolSpec): Iterable<[string, z.ZodType]> {
  const fields = [...spec.actions.values()].flatMap((row) => [row.fields, ...(row.routes ?? []).map((r) => r.fields)]);
  return fields.flatMap((f) => Object.entries(f.shape) as [string, z.ZodType][]);
}

/** One `ZodOptional` layer removed, so `x` and `x.optional()` are the same declaration (Zod 4: `x.optional().unwrap() === x`). */
const stripOptional = (schema: z.ZodType): z.ZodType => (schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema);

/**
 * The published input schema: one flat, strict object (a union of per-action schemas would
 * not survive every MCP client's JSON Schema handling). The selector is an enum; every other
 * key is optional here, and planCall re-runs in superRefine so the flat shape never accepts
 * what the dispatcher would refuse. A key two targets declare with different schema objects
 * is left open (z.any) in the flat shape; declare it once and share the object to keep it
 * typed. Declarations are compared after removing ONE optional layer, so `x` in one target
 * (required there) and `x.optional()` in another count as the same object and the key stays
 * typed and described (#676). The target schema still decides.
 */
function compactInputSchema(spec: CompactToolSpec): z.ZodType {
  const selector = selectorOf(spec);
  const names = [...spec.actions.keys()] as [string, ...string[]];
  const withSelector = hasSelector(spec);
  const shape: Record<string, z.ZodType> = {};
  const seen = new Map<string, z.ZodType>();
  // A tool with no selector, one action and no routes has nothing to choose between, so a
  // field its schema requires stays required in the published shape (#674 run_query.query).
  const single = !withSelector && spec.actions.size === 1 && [...spec.actions.values()].every((r) => (r.routes ?? []).length === 0);
  for (const [key, schema] of allFields(spec)) {
    if (withSelector && key === selector) continue;
    const prior = seen.get(key);
    if (prior === undefined) {
      seen.set(key, schema);
      shape[key] = single ? schema : schema.optional();
    } else if (stripOptional(prior) !== stripOptional(schema)) {
      shape[key] = z.any().optional();
    }
  }
  if (withSelector) {
    const selectorSchema = z.enum(names);
    shape[selector] = spec.defaultAction === undefined ? selectorSchema : selectorSchema.optional();
  }
  return z
    .object(shape)
    .strict()
    .superRefine((value, ctx) => {
      try {
        planCall(spec, value);
      } catch (err) {
        if (!(err instanceof z.ZodError)) throw err;
        // The flat shape already reported a field-level issue its own schema found; do not say it twice.
        // Issues already on ctx carry no message yet (it is resolved later), so match on path and code.
        // A custom issue is ours alone and is never a repeat.
        const reported = new Set((ctx.issues ?? []).map((i) => `${(i.path ?? []).join('.')}|${i.code}`));
        for (const issue of err.issues) {
          if (issue.code === 'custom' || !reported.has(`${issue.path.join('.')}|${issue.code}`)) ctx.addIssue(issue as never);
        }
      }
    });
}

/**
 * Build the registered definition for a compact tool. The plain ToolDefinition shape, not
 * createTool(): createTool wraps a handler's value in `{ result }`, and a compact tool must
 * return the legacy value unchanged.
 */
export function buildCompactTool(
  spec: CompactToolSpec,
  ops: CompactOperations,
  names?: ReadonlyMap<string, string>,
): ToolDefinitionWithOutput {
  const inputSchema = compactInputSchema(spec);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    call: async (args: unknown) => {
      const sent =
        spec.nullAsAbsent && args && typeof args === 'object' && !Array.isArray(args)
          ? Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null))
          : (args ?? {});
      return dispatchCompact(ops, spec, inputSchema.parse(sent), names);
    },
  };
}
