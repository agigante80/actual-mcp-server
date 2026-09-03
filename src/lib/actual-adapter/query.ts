// SQL-to-ActualQL WHERE translation for actual_query_run (#166 split out of
// actual-adapter.ts). Pure: it only transforms a query builder via .filter()
// calls and string parsing, with no module state or side effects. parseWhereClause
// is re-exported from actual-adapter.ts and is unit-tested directly. The #178
// operator support (LIKE / NOT LIKE / IS NULL, throw-on-unsupported) lives here.

import { getFieldType } from '../actual-schema.js';

// Strip a single pair of surrounding quotes from a SQL value literal.
function _stripWhereQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

// Coerce a SQL value literal to a number when it looks numeric, else keep the
// (unquoted) string. Used for IN lists and comparison operands. Empty stays a
// string so an empty literal is not silently turned into 0.
function _coerceWhereValue(s: string): string | number {
  const v = _stripWhereQuotes(s);
  if (v === '') return v;
  const n = Number(v);
  return isNaN(n) ? v : n;
}

// #420: coerce a SQL literal to a real JavaScript boolean, for a column the schema types as
// boolean. ActualQL requires a genuine JS boolean here: its compiler only tags a value as
// `boolean` from `typeof value === 'boolean'`, and `castInput` has no string-to-boolean or
// integer-to-boolean branch, so `"true"` and `1` are both rejected with the exact errors #420
// reports.
//
// Accepts `true`/`false` case-insensitively AND `1`/`0`. The integer form is accepted on purpose:
// the tool advertises SQL, and every mainstream engine (SQLite, which is Actual's own store, plus
// MySQL/MariaDB/SQL Server/Postgres) treats `1`/`0` as booleans. Refusing it would make this tool
// stricter than the database it models. A value that is neither throws, naming the column and the
// value, because a bad boolean literal is a caller mistake we can describe precisely.
function _coerceBoolean(field: string, s: string): boolean {
  const v = _stripWhereQuotes(s).toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(
    `Invalid boolean value for column "${field}": ${JSON.stringify(_stripWhereQuotes(s))}. ` +
    `Use true or false (1 or 0 are also accepted).`,
  );
}

// Whether the schema types `field` (a plain or joined column) as boolean, given the base table.
// An unknown field is NOT boolean, so its value is left untouched: this is what keeps a string
// comparison like `notes = 'true'` a string, and the query validator handles the unknown-field
// case separately.
function _isBooleanField(tableName: string | undefined, field: string): boolean {
  return tableName !== undefined && getFieldType(tableName, field) === 'boolean';
}

// `tableName` is the FROM table, used to look up column types so boolean literals can be coerced
// (#420). It is optional only so the many existing unit tests that assert non-boolean behaviour
// need not all pass it; the production call site in actual-adapter.ts always does. When it is
// absent, no field resolves as boolean and the pre-#420 behaviour is exactly preserved.
export function parseWhereClause(query: any, whereClause: string, tableName?: string): any {
  // OR is not supported. Detect it up front and fail loudly. Without this guard
  // a clause like `amount = 100 OR amount < 0` is left as a single fragment by
  // the AND-splitter, and the comparison regex's greedy value capture swallows
  // `100 OR amount < 0` into the operand, running a silently-wrong filter rather
  // than erroring. That silent mishandling is exactly what #178 set out to stop.
  // This shares the AND-splitter's quote-naive simplicity: an " OR " inside a
  // quoted value is a known limitation, the same as " AND ".
  if (/\sOR\s/i.test(whereClause)) {
    throw new Error(
      `Unsupported WHERE condition: OR is not supported. ` +
      `Supported operators: =, !=, >, >=, <, <=, IN (...), LIKE, NOT LIKE, IS NULL, IS NOT NULL. ` +
      `Combine conditions with AND only.`,
    );
  }

  // Split by AND. This is a simple parser: it does not handle OR or nested /
  // parenthesised conditions (see the unsupported-operator throw below).
  const conditions = whereClause.split(/\s+AND\s+/i);

  for (const condition of conditions) {
    const trimmedCondition = condition.trim();
    if (!trimmedCondition) continue;

    // IS NULL / IS NOT NULL: lets callers find unmerged rows (e.g. imported_payee
    // IS NULL). ActualQL treats `field: null` as IS NULL and `$ne: null` as IS NOT NULL.
    const nullMatch = trimmedCondition.match(/^([\w.]+)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      const [, field, not] = nullMatch;
      query = not
        ? query.filter({ [field]: { $ne: null } })
        : query.filter({ [field]: null });
      continue;
    }

    // NOT LIKE (checked before LIKE so the longer keyword wins).
    const notLikeMatch = trimmedCondition.match(/^([\w.]+)\s+NOT\s+LIKE\s+(.+)$/i);
    if (notLikeMatch) {
      const [, field, valueStr] = notLikeMatch;
      query = query.filter({ [field]: { $notlike: _stripWhereQuotes(valueStr) } });
      continue;
    }

    // LIKE: pattern match. ActualQL's $like runs through NORMALISE + UNICODE_LIKE,
    // so it is case-insensitive and accent-insensitive. Use % as the wildcard,
    // e.g. imported_payee LIKE '%amazon%'.
    const likeMatch = trimmedCondition.match(/^([\w.]+)\s+LIKE\s+(.+)$/i);
    if (likeMatch) {
      const [, field, valueStr] = likeMatch;
      query = query.filter({ [field]: { $like: _stripWhereQuotes(valueStr) } });
      continue;
    }

    // IN clause: field IN (value1, value2, ...)
    // [\w.]+ matches both simple fields (amount) and joined fields (category.name)
    const inMatch = trimmedCondition.match(/^([\w.]+)\s+IN\s+\((.+)\)$/i);
    if (inMatch) {
      const [, field, valuesStr] = inMatch;
      const rawValues = valuesStr.split(',');
      if (_isBooleanField(tableName, field)) {
        // #420: `$oneof` STRINGIFIES every element (upstream `compiler.ts` emits
        // `'${String(id)}'`), so `is_parent IN (true, false)` would compile to
        // `IN ('true','false')` against a 0/1 column and silently match nothing, which is worse
        // than the loud error we produce today. Expand to `$or` of equalities instead: each inner
        // equality then routes through `castInput(..., 'boolean')` and works. `$or` is a real
        // ActualQL condition key (compiler.ts handles `field === '$or'` via `compileOr`).
        const orConditions = rawValues.map((v) => ({ [field]: _coerceBoolean(field, v) }));
        query = query.filter({ $or: orConditions });
      } else {
        query = query.filter({ [field]: { $oneof: rawValues.map(_coerceWhereValue) } });
      }
      continue;
    }

    // Comparison operators: field >= value, field = value, etc.
    // [\w.]+ matches both simple fields (amount) and joined fields (category.name, payee.name)
    const compMatch = trimmedCondition.match(/^([\w.]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
    if (compMatch) {
      const [, field, operator, valueStr] = compMatch;
      const operatorMap: { [key: string]: string } = {
        '>=': '$gte',
        '<=': '$lte',
        '>': '$gt',
        '<': '$lt',
        '=': '$eq',
        '!=': '$ne',
      };
      const actualOp = operatorMap[operator];
      // #420: on a boolean column the literal must reach ActualQL as a real JS boolean, not the
      // string "true" or the number 1. Only = and != are meaningful for a boolean; the ordering
      // operators are left to their normal path, where ActualQL will reject them for a boolean as
      // it does today, rather than us inventing an ordering the column does not have.
      const isBool = _isBooleanField(tableName, field) && (actualOp === '$eq' || actualOp === '$ne');
      const finalValue = isBool ? _coerceBoolean(field, valueStr) : _coerceWhereValue(valueStr);
      if (actualOp === '$eq') {
        // Simple equality can use the direct field: value shorthand.
        query = query.filter({ [field]: finalValue });
      } else {
        query = query.filter({ [field]: { [actualOp]: finalValue } });
      }
      continue;
    }

    // Nothing matched. Refuse to silently drop the condition: dropping it would
    // run the query UNFILTERED and hand back misleading "matches everything"
    // results. Fail loudly with an actionable error instead. See #178.
    throw new Error(
      `Unsupported WHERE condition: "${trimmedCondition}". ` +
      `Supported operators: =, !=, >, >=, <, <=, IN (...), LIKE, NOT LIKE, IS NULL, IS NOT NULL. ` +
      `OR, REGEXP, NOT IN, and parenthesised groups are not yet supported.`,
    );
  }

  return query;
}
