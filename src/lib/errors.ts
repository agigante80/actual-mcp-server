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

/** The server setting that can hide a registered tool (#483, #671). MCP_TOOLS only adds tools. */
export type ToolUnavailableSetting = 'MCP_TOOLSETS' | 'MCP_READ_ONLY' | 'MCP_TOOL_SURFACE';

/**
 * A registered tool exists but this process does not publish it (#483), so the call is
 * refused before dispatch. Deliberately NOT a PreflightRefusal: a refusal is "the request
 * named something that cannot be acted on, fix the request" and is treated as benign by
 * rejection-allowlist.ts, whereas this is an operator policy decision the caller cannot
 * fix. Decide on the type and `setting`, never on the message text.
 */
export class ToolUnavailableError extends Error {
  readonly tool: string;
  readonly setting: ToolUnavailableSetting;

  /** @param surface the MCP_TOOL_SURFACE value, named in the message for that setting only. */
  constructor(tool: string, setting: ToolUnavailableSetting, surface?: string) {
    super(
      setting === 'MCP_READ_ONLY'
        ? `Tool "${tool}" is not available: it can change state and this server runs with MCP_READ_ONLY=true.`
        : setting === 'MCP_TOOL_SURFACE'
          ? `Tool "${tool}" is not available: this server publishes the ${surface ?? 'configured'} tool surface (MCP_TOOL_SURFACE).${
            surface === 'compact'
              ? ' The legacy tools are published only with MCP_TOOL_SURFACE=legacy.'
              : surface === 'legacy'
                ? ' The compact tools are published only with MCP_TOOL_SURFACE=compact.'
                : ''
          }`
          : `Tool "${tool}" is not available: it is not published by this server's MCP_TOOLSETS configuration.`,
    );
    this.name = 'ToolUnavailableError';
    this.tool = tool;
    this.setting = setting;
    Object.setPrototypeOf(this, new.target.prototype);
  }
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

/**
 * Log-safe error text (#559). An error's MESSAGE is for the client and may quote what the
 * caller sent: a category name, a query, a rule value, or upstream text we do not control.
 * The server never logs it. `withLogMessage` attaches a separate, content-free sentence
 * that the `[TOOL ERROR]` record may log instead; set it where the error is thrown, and
 * keep anything the caller supplied out of it.
 */
const LOG_MESSAGE = Symbol.for('actual-mcp-server.logMessage');

export function withLogMessage<E extends Error>(error: E, logMessage: string): E {
  Object.defineProperty(error, LOG_MESSAGE, { value: logMessage, enumerable: false });
  return error;
}

/**
 * The fields a failure record may carry about an error, and nothing else: its class, a
 * refusal's kind, a Node system error code such as ECONNRESET, and the throw site's
 * log-safe text when it set one. Fails closed: an error with no log-safe text is logged
 * by class alone. The class is read from the PROTOTYPE, because an own `constructor`
 * property could carry anything; the code only when it has the all-caps system shape.
 */
type ErrorLogFields = { errorClass: string; refusalKind?: RefusalKind; code?: string; logMessage?: string };

export function errorLogFields(error: unknown): ErrorLogFields {
  const errorClass =
    error instanceof Error ? (Object.getPrototypeOf(error)?.constructor?.name || 'Error') : error === null ? 'null' : typeof error;
  const fields: ErrorLogFields = { errorClass };
  if (isPreflightRefusal(error)) fields.refusalKind = error.refusalKind;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && /^E[A-Z0-9_]{1,40}$/.test(code)) fields.code = code;
  const logMessage = typeof error === 'object' && error !== null ? (error as Record<symbol, unknown>)[LOG_MESSAGE] : undefined;
  if (typeof logMessage === 'string') fields.logMessage = logMessage;
  return fields;
}
