/**
 * SQL Query Validator
 * 
 * Validates SQL queries against the Actual Budget schema before execution
 * to prevent server crashes from invalid table/field references.
 */

import {
  getTableFields,
  getTableNames,
  isValidTable,
  isValidField,
  isValidJoinPath,
} from './actual-schema.js';

export interface ValidationError {
  type: 'invalid_table' | 'invalid_field' | 'invalid_join';
  message: string;
  table?: string;
  field?: string;
  suggestions?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Blank the CONTENTS of quoted literals, keeping the quotes.
 *
 * #450 round 2: every extractor below scans for keywords (`FROM`, `JOIN`, `GROUP BY`,
 * `ORDER BY`, `LIMIT`) and must not see one that lives inside a string value. Word boundaries
 * fixed the column-name instance of that; they cannot fix the literal instance, which is both
 * the same defect and far more reachable. Measured on v0.21.0, before this:
 *
 *   WHERE notes LIKE '%limit%' AND catgeory = 'groceries'   ACCEPTED, typo never validated
 *   WHERE notes = 'order by z' AND made_up_col = 'x'        ACCEPTED
 *   SELECT 'a from b', made_up_col FROM transactions        rejected as Table "b" does not exist
 *   WHERE notes = 'join secrets'                            rejected as Table "secrets" does not exist
 *
 * The last two are FALSE REJECTIONS of legitimate queries, so this is not only a bypass fix.
 *
 * `validateQueryShape` has done exactly this since #162 for the same reason; extracting it
 * here means the shape gate and the schema validator can never disagree about what is a
 * literal. Lengths change, so never map an index from the blanked copy back onto the raw SQL.
 * Nothing here does: the extractors read identifiers, which never live inside a literal.
 */
function blankStringLiterals(sql: string): string {
  // ONE left-to-right pass. The two obvious shortcuts are both wrong, and both were shipped
  // and caught in review of the first attempt at this:
  //
  //   1. TWO INDEPENDENT REGEX PASSES (single quotes, then double quotes) let one pass match
  //      ACROSS the other's literals. `WHERE notes = "it's" AND made_up_col = "don't"` had its
  //      middle blanked by the single-quote pass, deleting `made_up_col` before the extractor
  //      could see it. An apostrophe in a note search is ordinary input, not an edge case.
  //   2. TREATING `\` AS AN ESCAPE. SQL escapes a quote by DOUBLING it, not with a backslash,
  //      so in `'a\'` the literal ENDS at the second quote. Reading it as escaped swallowed the
  //      rest of the clause, which both hid an unknown column from this validator and let
  //      `'a\' ; DELETE FROM accounts; --'` past the #162 stacked-statement gate.
  //
  // So: whichever quote opens first wins, and it closes on the next matching quote unless that
  // quote is doubled. Quotes are kept, contents are dropped.
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'" && ch !== '"') {
      out += ch;
      i++;
      continue;
    }
    const quote = ch;
    const quoteStart = i;
    out += quote;
    i++;
    while (i < sql.length) {
      if (sql[i] === quote) {
        if (sql[i + 1] === quote) {
          i += 2;      // a doubled quote is an escaped quote: still inside the literal
          continue;
        }
        break;         // closing quote
      }
      i++;             // literal content: dropped
    }
    if (i < sql.length) {
      out += quote;
      i++;
    } else {
      // UNTERMINATED literal (no closing quote). The tail must stay VISIBLE, and this branch is
      // the one that matters most: dropping it made `validateQueryShape` fail OPEN. Verified on
      // the built module while it did:
      //   WHERE notes = 'x ; DROP TABLE accounts     was rejected, became ACCEPTED
      //   WHERE notes = 'x AND DELETE FROM accounts  was rejected, became ACCEPTED
      // The regex this scanner replaced never matched an unterminated literal, so the tail
      // stayed visible and the #162 gate still saw the stacked statement and the write keyword.
      // Moving a security gate in the fail-open direction to tidy up a scanner is a bad trade,
      // so the remainder is emitted RAW, exactly as the old behaviour left it.
      out += sql.slice(quoteStart + 1);
    }
  }
  return out;
}

/**
 * Extract table name from SQL query
 * Handles: FROM table, FROM table1, table2, JOIN table
 */
function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();
  // #450: literals blanked first, so `WHERE notes = 'join secrets'` no longer reports
  // `Table "secrets" does not exist` for a perfectly legitimate query.
  sql = blankStringLiterals(sql);
  const normalized = sql.toUpperCase();
  
  // Extract FROM clause tables - handle queries without WHERE/ORDER/LIMIT
  const fromMatch = normalized.match(/FROM\s+(\w+)/i);
  if (fromMatch) {
    tables.add(fromMatch[1].toLowerCase());
  }
  
  // Extract JOIN clause tables
  const joinMatches = sql.matchAll(/JOIN\s+(\w+)/gi);
  for (const match of joinMatches) {
    tables.add(match[1].toLowerCase());
  }
  
  return Array.from(tables);
}

/**
 * Extract field references from SELECT clause
 * Handles: *, field, table.field, field AS alias, payee.name
 */
function extractSelectFields(sql: string): Array<{ field: string; table?: string }> {
  const fields: Array<{ field: string; table?: string }> = [];
  
  // Handle SELECT *
  // #450: see blankStringLiterals. A literal beginning with `from` truncated the clause and
  // reported the literal's own words as a missing table.
  sql = blankStringLiterals(sql);

  if (/SELECT\s+\*/i.test(sql)) {
    return [{ field: '*' }];
  }
  
  // Extract SELECT clause.
  // #450: `FROM` carries a trailing word boundary. Without it the lazy match terminates at the
  // letters `from` inside any identifier, so `SELECT made_up_col AS from_x FROM accounts`
  // truncated the clause to `made_up_col AS`, which fails the `^\w+$` test below and therefore
  // extracted ZERO fields, skipping the allowlist loop entirely. Same defect class as the WHERE
  // terminator below, reachable through an alias rather than a column name.
  const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM\b/is);
  if (!selectMatch) return fields;
  
  const selectClause = selectMatch[1];
  
  // Split by commas (but not inside functions)
  const fieldParts = selectClause.split(/,(?![^()]*\))/);
  
  for (let part of fieldParts) {
    part = part.trim();
    
    // Remove AS alias
    part = part.replace(/\s+AS\s+.+$/i, '');
    
    // Check for table.field or field
    const dotMatch = part.match(/^(\w+)\.(\w+)$/);
    if (dotMatch) {
      fields.push({ table: dotMatch[1], field: dotMatch[2] });
    } else if (/^\w+$/.test(part)) {
      // Simple field name
      fields.push({ field: part });
    }
    // Ignore functions like COUNT(*), SUM(amount), etc.
  }
  
  return fields;
}

/**
 * Extract field references from WHERE clause
 */
function extractWhereFields(sql: string): Array<{ field: string; table?: string }> {
  const fields: Array<{ field: string; table?: string }> = [];
  
  // #450: every keyword terminator carries word boundaries. Without them the lazy match cuts the
  // clause at the first occurrence of the LETTERS `GROUP`, `ORDER` or `LIMIT` anywhere, including
  // inside a column name, and every field after that point escaped schema validation silently.
  // Reachable with columns this project's own schema defines: `sort_order` and `balance_limit`
  // (accounts), `account_group_id` (accounts), and `group` (categories), which IS the keyword.
  // The terminator anchors on the FULL two-word clause (`GROUP BY`, `ORDER BY`) rather than the bare
  // keyword, because `group` is itself a column on `categories`: with word boundaries alone,
  // `WHERE group = "x" AND bogus = "y"` still truncated to the empty string, since the column name
  // and the keyword are the same token. `LIMIT` stays a single word because it is one in SQL too,
  // and it is safe: no schema column is named exactly `limit`, and `balance_limit` has no word
  // boundary before its `limit` (the preceding `_` is a word character).
  // #450: literals blanked BEFORE the terminator match. Word boundaries alone left the whole
  // bypass reachable through a string value, which is the likelier route by far: a search for
  // notes containing the word "limit" truncated the clause and let every later field through.
  sql = blankStringLiterals(sql);

  const whereMatch = sql.match(/WHERE\s+(.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|;|$)/is);
  if (!whereMatch) return fields;
  
  const whereClause = whereMatch[1];
  
  // Find field references (table.field or field).
  // #421: a bare column must be extracted (and therefore schema-validated) not only before a
  // comparison operator, but also before IN / LIKE / IS / BETWEEN (with their NOT forms). Before
  // this, `bogus_col IN ('a')`, `bogus_col LIKE '%a%'` and `bogus_col IS NULL` extracted no field
  // and so skipped the allowlist check entirely, while `bogus_col = 'a'` was correctly rejected.
  const fieldMatches = whereClause.matchAll(
    /(\w+)\.(\w+)|(?:^|\s)(\w+)\s*[=<>!]|(?:^|\s)(\w+)\s+(?:NOT\s+)?(?:IN|LIKE|BETWEEN)\b|(?:^|\s)(\w+)\s+IS\b/gi,
  );
  for (const match of fieldMatches) {
    if (match[1] && match[2]) {
      // table.field
      fields.push({ table: match[1], field: match[2] });
    } else if (match[3]) {
      // simple field before a comparison operator
      fields.push({ field: match[3] });
    } else if (match[4]) {
      // simple field before IN / LIKE / BETWEEN (optionally negated)
      fields.push({ field: match[4] });
    } else if (match[5]) {
      // simple field before IS (NULL / NOT NULL)
      fields.push({ field: match[5] });
    }
  }
  
  return fields;
}

/**
 * Validate a SQL query against the Actual Budget schema
 */
export function validateQuery(sql: string): ValidationResult {
  const errors: ValidationError[] = [];
  
  try {
    // Normalize SQL
    sql = sql.trim();
    if (!sql) {
      return { valid: false, errors: [{ type: 'invalid_field', message: 'Empty query' }] };
    }
    
    // Extract tables
    const tables = extractTableNames(sql);
    if (tables.length === 0) {
      return { valid: false, errors: [{ type: 'invalid_table', message: 'No table found in query' }] };
    }
    
    // Validate tables exist
    for (const table of tables) {
      if (!isValidTable(table)) {
        errors.push({
          type: 'invalid_table',
          message: `Table "${table}" does not exist`,
          table,
          suggestions: getTableNames(),
        });
      }
    }
    
    // If table is invalid, stop here
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    
    const primaryTable = tables[0]; // First table is primary
    
    // Extract and validate SELECT fields
    const selectFields = extractSelectFields(sql);
    for (const { field, table } of selectFields) {
      if (field === '*') continue; // SELECT * is always valid
      
      // Check for join paths (e.g., payee.name)
      const fullPath = table ? `${table}.${field}` : field;
      if (table && field) {
        // If it's a dot notation, check if it's a valid join path
        if (isValidJoinPath(fullPath)) {
          continue; // Valid join path
        }
      }
      
      // Check if field exists in primary table or specified table
      const targetTable = table || primaryTable;
      if (!isValidField(targetTable, field)) {
        const availableFields = getTableFields(targetTable);
        
        // If table doesn't exist, suggest valid tables instead of empty field list
        if (availableFields === null) {
          errors.push({
            type: 'invalid_table',
            message: `Table "${targetTable}" does not exist (referenced in "${table ? table + '.' + field : field}")`,
            table: targetTable,
            field,
            suggestions: getTableNames(),
          });
        } else {
          errors.push({
            type: 'invalid_field',
            message: `Field "${field}" does not exist in table "${targetTable}"`,
            table: targetTable,
            field,
            suggestions: availableFields,
          });
        }
      }
    }
    
    // Extract and validate WHERE fields
    const whereFields = extractWhereFields(sql);
    for (const { field, table } of whereFields) {
      const fullPath = table ? `${table}.${field}` : field;
      
      // Check for join paths
      if (table && field && isValidJoinPath(fullPath)) {
        continue;
      }
      
      // Check if field exists
      const targetTable = table || primaryTable;
      if (!isValidField(targetTable, field)) {
        const availableFields = getTableFields(targetTable);
        
        // If table doesn't exist, suggest valid tables instead of empty field list
        if (availableFields === null) {
          errors.push({
            type: 'invalid_table',
            message: `Table "${targetTable}" does not exist (referenced in "${table ? table + '.' + field : field}")`,
            table: targetTable,
            field,
            suggestions: getTableNames(),
          });
        } else {
          errors.push({
            type: 'invalid_field',
            message: `Field "${field}" does not exist in table "${targetTable}"`,
            table: targetTable,
            field,
            suggestions: availableFields,
          });
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [{
        type: 'invalid_field',
        message: `Query parsing error: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
}

/**
 * Format validation errors into a user-friendly message
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return '';
  
  const messages: string[] = [];
  
  for (const error of result.errors) {
    messages.push(`❌ ${error.message}`);
    
    if (error.suggestions && error.suggestions.length > 0) {
      if (error.type === 'invalid_table') {
        messages.push(`   Available tables: ${error.suggestions.join(', ')}`);
      } else if (error.type === 'invalid_field') {
        messages.push(`   Available fields: ${error.suggestions.join(', ')}`);
      }
    }
  }
  
  return messages.join('\n');
}

/**
 * Read-only shape gate for actual_query_run (#162, CWE-89/CWE-20 defense in
 * depth). The tool is SELECT-only, but the SQL surface is exactly what prompt
 * injection targets, so reject data/schema-modification keywords and stacked
 * statements before anything reaches the q() builder.
 *
 * The checks run on a copy with string literals blanked out, so a keyword or
 * semicolon smuggled inside a quoted value cannot trip the gate, and a
 * legitimate `WHERE notes LIKE '%update%'` is not a false positive. The #178
 * WHERE operators (LIKE / NOT LIKE / IS NULL) are plain SELECT queries and pass
 * unchanged.
 *
 * Throws on violation; returns void when the query is an allowed read.
 */
export function validateQueryShape(query: string): void {
  // Blank out single- and double-quoted literals (keep the quotes so positions
  // are roughly preserved, but drop their contents).
  const stripped = blankStringLiterals(query);

  // Stacked statements: a semicolon followed by more non-whitespace.
  if (/;\s*\S/.test(stripped)) {
    throw new Error('actual_query_run does not allow stacked statements (multiple statements separated by ";").');
  }

  // #421: SQL comments. Checked on the literal-blanked `stripped`, so a `--` or `/*` INSIDE a
  // string literal is already gone and cannot false-trigger. A comment left in the query is a
  // trailing-SQL smuggling vector (it comments out the tombstone filter this server relies on),
  // and a read tool has no legitimate use for one, so it is rejected outright.
  if (/--/.test(stripped) || /\/\*/.test(stripped)) {
    throw new Error('actual_query_run does not allow SQL comments ("--" or "/* */").');
  }

  // #421: compound-query set operators. parseWhereClause translates a SINGLE WHERE clause, so a
  // UNION/EXCEPT/INTERSECT can never be handled correctly, and left unrejected it lets a crafted
  // IN-list value append a second SELECT past the validated clause. Rejected on the blanked string
  // so the word inside a literal (e.g. notes = 'union dues') stays allowed.
  const COMPOUND = /\b(UNION|EXCEPT|INTERSECT)\b/i;
  if (COMPOUND.test(stripped)) {
    throw new Error('actual_query_run does not allow compound queries (UNION, EXCEPT, INTERSECT).');
  }

  // Data- and schema-modification keywords.
  const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|PRAGMA|CREATE|REPLACE|EXEC|EXECUTE|VACUUM|TRUNCATE|GRANT|REVOKE|MERGE|INTO)\b/i;
  if (FORBIDDEN.test(stripped)) {
    throw new Error('actual_query_run is read-only: data- and schema-modification keywords (INSERT, UPDATE, DELETE, DROP, etc.) are not allowed.');
  }

  // Must be a SELECT, or the bare-table-name fallthrough (a single identifier
  // the adapter passes straight to q(<table>)).
  const trimmed = stripped.trim();
  const isSelect = /^SELECT\s+/i.test(trimmed);
  const isBareTable = /^\w+$/.test(trimmed);
  if (!isSelect && !isBareTable) {
    throw new Error('actual_query_run only supports SELECT queries or a bare table name.');
  }
}
