/**
 * Refusal messages and the typed refusals that carry them.
 *
 * #377: the WORDING helpers below came first, and two tools ended up deciding their
 * published response shape by substring-matching that wording:
 *
 *   const isCategoryRefusal = lower.includes('not found') && lower.includes('category');
 *
 * which means a copy-edit to a message in `actual-adapter.ts` silently flips a tool from
 * returning a structured refusal to throwing. The classes here make that decision a type
 * question instead, so the prose is free to change.
 *
 * THE TAXONOMY these encode (the full version, with the reasoning, lives in
 * `.claude/skills/api-design-principles/SKILL.md`):
 *
 *   - The requested end state ALREADY HOLDS (already-closed, delete-what-is-absent):
 *     SUCCESS, with a field naming the non-change. That is #347's idempotence argument,
 *     and it is not a refusal, so nothing here represents it.
 *   - The request NAMES SOMETHING THAT DOES NOT EXIST, or asks for something upstream
 *     will not do: a PreflightRefusal. It is a caller error and the caller can fix it.
 *   - Anything else is a genuine failure and must keep propagating as an ordinary Error.
 *
 * A PreflightRefusal is thrown, like any other error. What the type buys is that a tool
 * needing the structured `{ success: false }` shape can recognise one without reading the
 * message, and that a tool must NEVER swallow a non-refusal into that shape.
 */

/**
 * Cross-realm brand. `instanceof` is the primary check and is correct in normal operation,
 * where every caller resolves the same `dist/src/lib/errors.js`. The brand covers the case
 * where two copies of this module exist at once (a bundler, or a test that loads the source
 * while the runtime loaded the build). That failure is worth guarding because it is SILENT:
 * a bare `instanceof` would simply return false, and the tool would rethrow a refusal as a
 * generic failure, changing its published contract with nothing red to show for it.
 */
const REFUSAL_BRAND = Symbol.for('actual-mcp-server.PreflightRefusal');

export type RefusalKind = 'not-found' | 'out-of-range';

/**
 * A pre-flight refusal: the operation was NOT attempted, because the request named
 * something that cannot be acted on. Nothing was written.
 */
export class PreflightRefusal extends Error {
  readonly refusalKind: RefusalKind;

  constructor(message: string, refusalKind: RefusalKind) {
    super(message);
    this.name = new.target.name;
    this.refusalKind = refusalKind;
    Object.defineProperty(this, REFUSAL_BRAND, { value: true, enumerable: false });
    // Restores the prototype chain when this is compiled down for an older target, so
    // `instanceof` keeps working on a subclass.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The entity named by the request does not exist. */
export class NotFoundRefusal extends PreflightRefusal {
  readonly entity: string;
  readonly id: string;
  readonly listTool: string;

  /**
   * @param entity    Human-readable entity name, e.g. "Account", "Category"
   * @param id        The id that was not found
   * @param listTool  MCP tool name the caller should use to get valid ids
   * @param detail    Optional extra sentence, e.g. what was NOT written as a result
   */
  /**
   * `overrideMessage` is for the one case where we can say something strictly MORE useful than
   * "not found, go and list them": we already know the answer. #388 resolves a NAME passed where
   * an id belongs, so telling the caller to list the accounts buries the id we just found behind
   * an instruction they no longer need, and a model reading top to bottom will follow the
   * instruction rather than the answer. The TYPE is unchanged, because the request still names
   * something that does not exist under that identifier, and #377 is explicit that callers branch
   * on the type rather than on message prose.
   */
  constructor(entity: string, id: string, listTool: string, detail?: string, overrideMessage?: string) {
    super(overrideMessage ?? (notFoundMsg(entity, id, listTool) + (detail ? ` ${detail}` : '')), 'not-found');
    this.entity = entity;
    this.id = id;
    this.listTool = listTool;
  }
}

/** The request is well-formed but falls outside a range the budget actually has. */
export class OutOfRangeRefusal extends PreflightRefusal {
  readonly value: string;

  constructor(message: string, value: string) {
    super(message, 'out-of-range');
    this.value = value;
  }
}

/**
 * The check a tool uses to decide "structured refusal" versus "rethrow". Prefer this over
 * a bare `instanceof` so the brand fallback above applies.
 */
export function isPreflightRefusal(error: unknown): error is PreflightRefusal {
  if (error instanceof PreflightRefusal) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[REFUSAL_BRAND] === true
  );
}

/**
 * Build a "not found" message with a next-step hint.
 *
 * Prefer THROWING a `NotFoundRefusal` (which builds this string itself) over throwing a
 * bare Error carrying it: the message is for the human or model reading the response, and
 * the type is for the code deciding what to do about it.
 *
 * @param entityType  Human-readable entity name, e.g. "Account", "Category"
 * @param id          The ID that was not found
 * @param listTool    MCP tool name the caller should use to get valid IDs
 */
export function notFoundMsg(entityType: string, id: string, listTool: string): string {
  return `${entityType} "${id}" not found. Use ${listTool} to list available ${pluralize(entityType.toLowerCase())}.`;
}

/**
 * Pluralise an entity name for the message above. This used to be a bare `+ 's'`, which
 * produced "list available categorys" and, once #376 added an `Entity` refusal,
 * "list available entitys". The consonant-plus-y rule covers every entity name this
 * codebase uses (account, category, payee, category group, tag, rule, schedule, entity).
 */
function pluralize(word: string): string {
  return /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

/**
 * Build a "constraint error" message for SQLite-level failures.
 * @param entityType  Human-readable entity name
 * @param id          The ID that failed
 * @param listTool    MCP tool name for listing
 */
export function constraintErrorMsg(entityType: string, id: string, listTool: string): string {
  return `Failed to delete ${entityType.toLowerCase()} "${id}". ` +
    `It may be referenced by other records. Use ${listTool} to verify it exists.`;
}
