// SQL-to-ActualQL WHERE translation for actual_query_run (#166 split out of
// actual-adapter.ts). Pure: it only transforms a query builder via .filter()
// calls and string parsing, with no module state or side effects. parseWhereClause
// is re-exported from actual-adapter.ts and is unit-tested directly. The #178
// operator support (LIKE / NOT LIKE / IS NULL, throw-on-unsupported) lives here.

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

export function parseWhereClause(query: any, whereClause: string): any {
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
      const values = valuesStr.split(',').map(_coerceWhereValue);
      query = query.filter({ [field]: { $oneof: values } });
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
      const finalValue = _coerceWhereValue(valueStr);
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
