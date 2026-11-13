/**
 * MCP prompt registry (#660): the definition type, the pure offer/render functions and the
 * registry validators. No logger and no I/O here, so the unit tests can feed every function a
 * bad fixture. The handlers that serve these over the wire live in src/lib/promptHandlers.ts.
 */
import { z } from 'zod';

export type PromptArgument = { name: string; description: string; required: boolean };

export type PromptDefinition = {
  /** snake_case, unique in the registry (assertPromptNames). */
  name: string;
  title: string;
  description: string;
  /** What prompts/list advertises; the wire format is strings, argsSchema does the real work. */
  arguments: PromptArgument[];
  /** Every name here must be in the PUBLISHED tool list for the prompt to be offered. */
  requiredTools: string[];
  /** Strict (z.strictObject): an unknown argument key is refused rather than dropped. */
  argsSchema: z.ZodObject<z.ZodRawShape>;
  render(args: Record<string, unknown>): string;
};

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The definitions whose every required tool is published, in registry order. `offered` is
 * exactly actualToolsManager.getPublishedToolNames(): this does not re-implement tool policy.
 */
export function resolveOfferedPrompts(
  definitions: readonly PromptDefinition[],
  offeredToolNames: ReadonlySet<string>,
): PromptDefinition[] {
  return definitions.filter((d) => d.requiredTools.every((t) => offeredToolNames.has(t)));
}

/** Validate the raw (string) arguments and render. Throws a ZodError on a bad or missing value. */
export function renderPrompt(definition: PromptDefinition, rawArgs: unknown): string {
  const parsed = definition.argsSchema.parse(rawArgs ?? {});
  return definition.render(parsed);
}

export function assertPromptNames(definitions: readonly PromptDefinition[]): void {
  const seen = new Set<string>();
  for (const d of definitions) {
    if (!NAME_RE.test(d.name)) {
      throw new Error(`Prompt name "${d.name}" must match ${NAME_RE} (snake_case)`);
    }
    if (seen.has(d.name)) throw new Error(`Duplicate prompt name "${d.name}"`);
    seen.add(d.name);
  }
}

export function assertRequiredToolsKnown(
  definitions: readonly PromptDefinition[],
  knownToolNames: ReadonlySet<string>,
): void {
  for (const d of definitions) {
    for (const t of d.requiredTools) {
      if (!knownToolNames.has(t)) {
        throw new Error(`Prompt "${d.name}" requires unknown tool "${t}"`);
      }
    }
  }
}

type ZodNode = { _zod?: { def?: Record<string, any> }; maxLength?: number | null };

/** True when a string schema carries a length cap or a regex check. */
function isBoundedString(node: ZodNode): boolean {
  if (typeof node.maxLength === 'number') return true;
  const checks: any[] = node._zod?.def?.checks ?? [];
  return checks.some((c) => {
    const d = c?._zod?.def;
    return d?.check === 'max_length' || (d?.check === 'string_format' && d?.format === 'regex');
  });
}

/** Node types that can never carry a string: safe leaves for the walk. */
const STRING_FREE = new Set(['number', 'int', 'boolean', 'bigint', 'literal', 'enum', 'null', 'undefined', 'date', 'nan']);

/**
 * Walk through wrappers to every string leaf; true when one is unbounded. FAILS CLOSED: a node
 * type this walk does not understand (any, unknown, custom, a deeper nesting than the depth cap)
 * counts as unbounded, so a new schema shape cannot slip past the guard silently.
 */
function hasUnboundedString(node: ZodNode | undefined, depth = 0): boolean {
  const def = node?._zod?.def;
  if (!def || depth > 12) return true;
  if (STRING_FREE.has(def.type)) return false;
  switch (def.type) {
    case 'string': return !isBoundedString(node as ZodNode);
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly': case 'catch':
    case 'nonoptional': case 'success':
      return hasUnboundedString(def.innerType, depth + 1);
    case 'pipe': return hasUnboundedString(def.in, depth + 1);
    case 'array': return hasUnboundedString(def.element, depth + 1);
    case 'union': return (def.options as ZodNode[]).some((o) => hasUnboundedString(o, depth + 1));
    case 'lazy': return hasUnboundedString(def.getter?.(), depth + 1);
    default: return true;
  }
}

/** Every string argument needs a .max() or a regex; an enum or a non-string is fine. */
export function assertArgsBounded(definitions: readonly PromptDefinition[]): void {
  for (const d of definitions) {
    for (const [key, field] of Object.entries(d.argsSchema.shape)) {
      if (hasUnboundedString(field as ZodNode)) {
        throw new Error(`Prompt "${d.name}" argument "${key}" is an unbounded string (add .max() or a regex)`);
      }
    }
  }
}
