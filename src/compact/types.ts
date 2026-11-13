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

/** One action of a compact tool: which legacy tool it calls and how the arguments are shaped. */
export interface CompactActionRow {
  /** The registered legacy tool this action calls. Validated against the registry at startup. */
  legacy: string;
  /**
   * The action's own STRICT input schema, selector excluded. It is the validation authority:
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
}

/** A compact tool: one published name, many actions. */
export interface CompactToolSpec {
  /** Published name, `actual_<domain>` style; must not collide with a legacy tool name. */
  name: string;
  description: string;
  /** The argument that picks the action. Defaults to `action`. */
  selector?: string;
  /** Action used when the selector is absent. When unset the selector is required. */
  defaultAction?: string;
  /** Action name to row. A Map, so `__proto__` or `constructor` can never name an action. */
  actions: ReadonlyMap<string, CompactActionRow>;
}
