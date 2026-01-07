/**
 * SQL Query Validator
 * 
 * Validates SQL queries against the Actual Budget schema before execution
 * to prevent server crashes from invalid table/field references.
 */

import {
  ACTUAL_SCHEMA,
  JOIN_PATHS,
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
 * Extract table name from SQL query
 * Handles: FROM table, FROM table1, table2, JOIN table
 */
function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();
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
  if (/SELECT\s+\*/i.test(sql)) {
    return [{ field: '*' }];
  }
  
  // Extract SELECT clause
  const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/is);
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
  
  const whereMatch = sql.match(/WHERE\s+(.*?)(?:GROUP|ORDER|LIMIT|;|$)/is);
  if (!whereMatch) return fields;
  
  const whereClause = whereMatch[1];
  
  // Find field references (table.field or field)
  const fieldMatches = whereClause.matchAll(/(\w+)\.(\w+)|(?:^|\s)(\w+)\s*[=<>!]/g);
  for (const match of fieldMatches) {
    if (match[1] && match[2]) {
      // table.field
      fields.push({ table: match[1], field: match[2] });
    } else if (match[3]) {
      // simple field
      fields.push({ field: match[3] });
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
        errors.push({
          type: 'invalid_field',
          message: `Field "${field}" does not exist in table "${targetTable}"`,
          table: targetTable,
          field,
          suggestions: availableFields || [],
        });
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
        errors.push({
          type: 'invalid_field',
          message: `Field "${field}" does not exist in table "${targetTable}"`,
          table: targetTable,
          field,
          suggestions: availableFields || [],
        });
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
