import type { z } from 'zod';

/**
 * The compact tool layer (#671, design record docs/explanation/compact-tool-surface.md).
 *
 * Nothing under src/compact/ imports the adapter or @actual-app/api: a compact tool reaches
 * Actual only by naming a LEGACY tool and calling it through CompactOperations, so every
 * adapter rule (withActualApi, the write queue, no nested sessions) is inherited, not redone.
 */

/** What the dispatcher may ask of the tool manager. The manager implements it. */
export interface CompactOperations {
  /**
   * Run one legacy tool by its registered name on behalf of a compact action. The result is
   * the legacy tool's JSON-safe value, unchanged. `via` is only for the log record.
   */
  callOperation(legacyName: string, args: unknown, via?: { tool: string; action: string }): Promise<unknown>;
}

/** What a call is turned into: which legacy tool, which fields are allowed, how they are shaped. */
export interface CompactTarget {
  /** The registered legacy tool this target calls. Validated against the registry at startup. */
  legacy: string;
  /**
   * The target's own STRICT input schema, selector excluded. It is the validation authority:
   * a key the schema does not name is refused, so a typo is never silently dropped.
   */
  fields: z.ZodObject;
  /** Compact key to legacy key, for a field the legacy tool names differently. */
  rename?: Readonly<Record<string, string>>;
  /**
   * For a legacy tool whose payload is nested: after renaming, every key NOT listed in `top`
   * moves under `into`; the wrapper object is always present, even when empty.
   */
  wrap?: { into: string; top: readonly string[] };
  /** Compact keys the compact layer consumes itself and never forwards (a default-valued switch). */
  drop?: readonly string[];
  /**
   * A value hook (#678): runs on the VALIDATED compact arguments, before rename, drop, wrap and
   * `fixed`, and returns the arguments to shape. For a value translation a key rename cannot
   * express, such as turning `month: "2026-11"` into `id: "budget-2026-11"`. Never sees unvalidated input.
   */
  build?: (args: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  /** Legacy arguments the compact layer sets itself (a value translation such as `type: "accounts"`). Win over a caller key. */
  fixed?: Readonly<Record<string, unknown>>;
}

/**
 * A field route (#672): inside one action, the presence of a trigger field sends the call to a
 * different legacy tool than the action's default. The legacy name is a static table value,
 * never read from input. A route's `fields` are the only fields allowed once it is chosen.
 */
export interface CompactRoute extends CompactTarget {
  /** The route is chosen when ANY of these keys is present (not undefined) in the call. */
  triggers: readonly string[];
  /** Optional extra condition on the call, for a trigger that selects only by value. */
  when?: (call: Readonly<Record<string, unknown>>) => boolean;
  /** How error text names this route when the first trigger alone would mislead (`scope server`). Defaults to the first trigger. */
  phrase?: string;
}

/** One action of a compact tool: a default target, plus optional field routes. */
export interface CompactActionRow extends CompactTarget {
  /**
   * Routes in priority order. More than one matching route is refused (the fields name
   * different lookups); none matching means the row's own target is called.
   */
  routes?: readonly CompactRoute[];
}

/**
 * The README and tools reference headings a compact tool is listed under (#668), in display
 * order. scripts/docs/capabilities.mjs reads this list from dist and throws on a tool whose
 * `domain` is not one of them, or on a heading no tool uses.
 */
export const COMPACT_DOMAINS = [
  'Context and lookup',
  'Reading transactions',
  'Reports',
  'Budget months',
  'Querying',
  'Changing data',
] as const;

export type CompactDomain = (typeof COMPACT_DOMAINS)[number];

/** A compact tool: one published name, many actions. */
export interface CompactToolSpec {
  /** Published name, `actual_<domain>` style; must not collide with a legacy tool name. */
  name: string;
  /** Docs only (#668): the heading the README lists this tool under. Never published in tools/list. */
  domain: CompactDomain;
  /** Docs only (#668): one verb-led sentence for the README. Never published in tools/list. */
  summary: string;
  /** Docs only (#668): one example user prompt for the README. Fictional values only. Never published in tools/list. */
  examplePrompt: string;
  description: string;
  /**
   * The argument that picks the action. Defaults to `action`. `null` means the tool has no
   * selector (#674): one action, which must be `defaultAction`; no selector property is
   * published and a caller key of that name is refused like any unknown key.
   */
  selector?: string | null;
  /** Action used when the selector is absent. When unset the selector is required. With `selector: null` it names the one action. */
  defaultAction?: string;
  /**
   * true drops every top-level argument whose value is null before validation, so null means
   * "not sent" (#673: some clients send null for each optional field they leave out). Only for
   * a tool where null carries no meaning of its own: never a write tool that clears a field with null.
   */
  nullAsAbsent?: boolean;
  /** Action name to row. A Map, so `__proto__` or `constructor` can never name an action. */
  actions: ReadonlyMap<string, CompactActionRow>;
}
