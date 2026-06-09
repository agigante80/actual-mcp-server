/**
 * Actionable Zod validation-error formatter (#206).
 *
 * Turns a ZodError into a single consistent, actionable string so callers (AI
 * assistants) learn what was wrong AND what to do: that a field is required,
 * the expected format, or the allowed values. Used by the central dispatch in
 * `actualToolsManager.callTool` so every tool shares one shape, instead of each
 * tool formatting ZodError its own way.
 *
 * Design notes:
 * - Maps Zod v4 issue codes (`invalid_type`, `invalid_value`, `invalid_format`,
 *   `too_small`, `too_big`, `unrecognized_keys`) to friendly phrasing.
 * - Surfaces the `.describe()` hint already present on most `CommonSchemas`
 *   fields by resolving the leaf schema at the issue path. If resolution fails
 *   for any reason the hint is simply omitted; this function never throws.
 * - Custom messages a schema already supplies (e.g. "Invalid date format
 *   (expected YYYY-MM-DD)", "Amount must be an integer (cents)") are passed
 *   through unchanged, since they are already actionable.
 * - Security: the output contains only field paths and curated hint/enum text,
 *   never the rejected input VALUE, a stack frame, SQL, a filesystem path, or an
 *   env value. The one piece of user input echoed is an unrecognized KEY name,
 *   which is stripped of control characters and length-capped.
 */
import type { z } from 'zod';

const MAX_KEY_LEN = 64;

/** Strip control characters and cap length so a hostile key cannot flood or inject. */
function sanitizeKey(key: unknown): string {
  let k = typeof key === 'string' ? key : String(key);
  // eslint-disable-next-line no-control-regex
  k = k.replace(/[\u0000-\u001f\u007f]/g, '');
  if (k.length > MAX_KEY_LEN) k = `${k.slice(0, MAX_KEY_LEN)}...`;
  return k;
}

// ---- leaf-schema `.describe()` hint resolution (best-effort, never throws) ----

function unwrap(schema: any): any {
  // Strip only true single-child wrappers (optional / nullable / default / readonly /
  // catch / brand), which in Zod v4 all expose their child at `_def.innerType`. We do
  // NOT use `.unwrap()`: ZodArray also has `.unwrap()` (returning its element), which
  // would descend past the array before the caller resolves the element by path index.
  let s = schema;
  let guard = 0;
  while (s && guard++ < 12) {
    const inner = s?._def?.innerType;
    if (inner && inner !== s) { s = inner; continue; }
    break;
  }
  return s;
}

function shapeOf(schema: any): Record<string, any> | undefined {
  try {
    const direct = schema?.shape;
    if (direct) return typeof direct === 'function' ? direct() : direct;
    const def = schema?._def?.shape;
    if (def) return typeof def === 'function' ? def() : def;
  } catch { /* ignore */ }
  return undefined;
}

function elementOf(schema: any): any {
  return schema?.element ?? schema?._def?.element ?? schema?._def?.type;
}

function leafAt(schema: any, path: ReadonlyArray<PropertyKey>): any {
  let cur = schema;
  for (const seg of path) {
    cur = unwrap(cur);
    if (typeof seg === 'number' || /^\d+$/.test(String(seg))) {
      cur = elementOf(cur);
    } else {
      const shape = shapeOf(cur);
      cur = shape ? shape[String(seg)] : undefined;
    }
    if (!cur) return undefined;
  }
  return unwrap(cur);
}

function hintAt(schema: unknown, path: ReadonlyArray<PropertyKey>): string | undefined {
  if (!schema) return undefined;
  try {
    const leaf = leafAt(schema, path);
    const d = leaf?.description;
    return typeof d === 'string' && d.length > 0 ? d : undefined;
  } catch { return undefined; }
}

// ---- per-issue rendering ----

function unitFor(origin: unknown, count: unknown): string {
  const plural = count === 1 ? '' : 's';
  if (origin === 'string') return ` character${plural}`;
  if (origin === 'array' || origin === 'set') return ` item${plural}`;
  return '';
}

function describeIssue(issue: any, schema: unknown): string {
  const path: PropertyKey[] = Array.isArray(issue?.path) ? issue.path : [];
  const pathStr = path.join('.');
  const hint = hintAt(schema, path);
  const withHint = (s: string) => (hint ? `${s} (${hint})` : s);
  // Pass an already-actionable message through, prefixed with the field path when there is
  // one (an empty path, e.g. a root-level issue, must not produce a leading ": ").
  const withPath = (m: string) => (pathStr ? `${pathStr}: ${m}` : m);
  const msg: string = typeof issue?.message === 'string' ? issue.message : 'invalid input';

  switch (issue?.code) {
    case 'invalid_type': {
      // Zod v4's DEFAULT message looks like "Invalid input: expected X, received Y"
      // ("received undefined" means the field was missing). We reformat only when we can
      // read that "received <word>" token: that confirms it is the default message, not a
      // custom one that merely happens to start with the same words. Anything else (a custom
      // .int()/.refine() message) passes through unchanged. NOTE: this prefix is English and
      // Zod-version-specific; the exact-string unit tests act as a canary if Zod changes it.
      const received = msg.startsWith('Invalid input: expected') ? /received (\w+)/.exec(msg)?.[1] : undefined;
      if (received === 'undefined') return withHint(`${pathStr} is required`);
      if (received) return withHint(`${pathStr}: expected ${issue.expected}, received ${received}`);
      return withPath(msg);
    }

    case 'invalid_value':
      // enum / literal: list the allowed options
      return Array.isArray(issue.values) ? withPath(`allowed values: ${issue.values.join(', ')}`) : withPath(msg);

    case 'invalid_format':
      // regex / custom string formats already carry an actionable message
      return withPath(msg);

    case 'too_big': {
      if (!msg.startsWith('Too big:')) return withPath(msg); // custom message
      const cmp = issue.inclusive === false ? 'less than' : 'at most';
      return withPath(`must be ${cmp} ${issue.maximum}${unitFor(issue.origin, issue.maximum)}`);
    }

    case 'too_small': {
      if (!msg.startsWith('Too small:')) return withPath(msg); // custom message
      const cmp = issue.inclusive === false ? 'more than' : 'at least';
      return withPath(`must be ${cmp} ${issue.minimum}${unitFor(issue.origin, issue.minimum)}`);
    }

    case 'unrecognized_keys': {
      // path is empty for this issue: do NOT emit a leading "<path>: " (the old bug).
      const keys = (Array.isArray(issue.keys) ? issue.keys : [])
        .map(sanitizeKey)
        .filter((k: string) => k.length > 0)
        .join(', ');
      // keys can be empty if every offending key sanitised away (all control chars).
      return keys ? `unexpected field(s): ${keys}` : 'unexpected field(s) present';
    }

    default:
      return withPath(msg);
  }
}

/**
 * Format a ZodError into one actionable `Validation error: ...` string.
 *
 * @param error  the ZodError (duck-typed on `.issues`, so a structurally-compatible
 *               error from any Zod build is accepted).
 * @param schema optional tool input schema, used to resolve `.describe()` hints for
 *               the failing fields. Omit it and messages still format, just without hints.
 */
export function formatZodError(error: z.ZodError | { issues?: unknown }, schema?: unknown): string {
  const issues: any[] = Array.isArray((error as any)?.issues) ? (error as any).issues : [];
  if (issues.length === 0) return 'Validation error: invalid input';
  const parts = issues.map((issue) => describeIssue(issue, schema));
  return `Validation error: ${parts.join(', ')}`;
}
