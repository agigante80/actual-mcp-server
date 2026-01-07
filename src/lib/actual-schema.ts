/**
 * Actual Budget Database Schema
 * 
 * This module provides the schema definition for Actual Budget's database tables
 * and fields. Used for pre-validation of SQL queries before execution to prevent
 * server crashes from invalid field references.
 * 
 * Based on: @actual-app/api schema definition
 * Source: packages/loot-core/src/server/aql/schema/index.ts
 */

export interface SchemaField {
  type: string;
  ref?: string;
  required?: boolean;
  default?: unknown;
}

export interface TableSchema {
  [fieldName: string]: SchemaField;
}

export interface DatabaseSchema {
  [tableName: string]: TableSchema;
}

/**
 * Core Actual Budget database schema
 * Defines all available tables and their fields
 */
export const ACTUAL_SCHEMA: DatabaseSchema = {
  transactions: {
    id: { type: 'id' },
    is_parent: { type: 'boolean' },
    is_child: { type: 'boolean' },
    parent_id: { type: 'id' },
    account: { type: 'id', ref: 'accounts', required: true },
    category: { type: 'id', ref: 'categories' },
    amount: { type: 'integer', default: 0, required: true },
    payee: { type: 'id', ref: 'payees' },
    notes: { type: 'string' },
    date: { type: 'date', required: true },
    imported_id: { type: 'string' },
    imported_payee: { type: 'string' },
    error: { type: 'json' },
    cleared: { type: 'boolean' },
    pending: { type: 'boolean' },
    transfer_id: { type: 'id' },
    sort_order: { type: 'float' },
    starting_balance_flag: { type: 'boolean' },
    reconciled: { type: 'boolean' },
    schedule: { type: 'id', ref: 'schedules' },
    tombstone: { type: 'boolean' },
  },
  
  accounts: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    type: { type: 'string' },
    offbudget: { type: 'boolean' },
    closed: { type: 'boolean' },
    sort_order: { type: 'float' },
    tombstone: { type: 'boolean' },
    account_id: { type: 'string' },
    official_name: { type: 'string' },
    balance_current: { type: 'integer' },
    balance_available: { type: 'integer' },
    balance_limit: { type: 'integer' },
    mask: { type: 'string' },
    bank: { type: 'id', ref: 'banks' },
    account_sync_source: { type: 'string' },
  },
  
  categories: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    is_income: { type: 'boolean', required: true },
    group: { type: 'id', ref: 'category_groups', required: true },
    sort_order: { type: 'float' },
    tombstone: { type: 'boolean' },
    hidden: { type: 'boolean' },
    goal_def: { type: 'json' },
  },
  
  category_groups: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    is_income: { type: 'boolean', required: true },
    sort_order: { type: 'float' },
    tombstone: { type: 'boolean' },
    hidden: { type: 'boolean' },
  },
  
  payees: {
    id: { type: 'id' },
    name: { type: 'string', required: true },
    category: { type: 'id', ref: 'categories' },
    tombstone: { type: 'boolean' },
    transfer_acct: { type: 'id', ref: 'accounts' },
  },
  
  schedules: {
    id: { type: 'id' },
    name: { type: 'string' },
    rule: { type: 'id', ref: 'rules', required: true },
    next_date: { type: 'date' },
    completed: { type: 'boolean' },
    posts_transaction: { type: 'boolean' },
    tombstone: { type: 'boolean' },
    _payee: { type: 'id', ref: 'payees' },
    _account: { type: 'id', ref: 'accounts' },
    _amount: { type: 'json/fallback' },
    _amountOp: { type: 'string' },
    _date: { type: 'json/fallback' },
    _conditions: { type: 'json' },
    _actions: { type: 'json' },
  },
  
  rules: {
    id: { type: 'id' },
    stage: { type: 'string' },
    conditions_op: { type: 'string' },
    conditions: { type: 'json' },
    actions: { type: 'json' },
    tombstone: { type: 'boolean' },
  },
  
  notes: {
    id: { type: 'id' },
    note: { type: 'string' },
  },
  
  banks: {
    id: { type: 'id' },
    bank_id: { type: 'string' },
    name: { type: 'string' },
    tombstone: { type: 'boolean' },
  },
  
  preferences: {
    id: { type: 'id' },
    value: { type: 'string' },
  },
  
  transaction_filters: {
    id: { type: 'id' },
    name: { type: 'string' },
    conditions_op: { type: 'string' },
    conditions: { type: 'json' },
    tombstone: { type: 'boolean' },
  },
  
  custom_reports: {
    id: { type: 'id' },
    name: { type: 'string' },
    start_date: { type: 'string', default: '2023-06' },
    end_date: { type: 'string', default: '2023-09' },
    date_static: { type: 'integer', default: 0 },
    date_range: { type: 'string' },
    mode: { type: 'string', default: 'total' },
    group_by: { type: 'string', default: 'Category' },
    sort_by: { type: 'string', default: 'desc' },
    balance_type: { type: 'string', default: 'Expense' },
    show_empty: { type: 'integer', default: 0 },
    show_offbudget: { type: 'integer', default: 0 },
    show_hidden: { type: 'integer', default: 0 },
    show_uncategorized: { type: 'integer', default: 0 },
    trim_intervals: { type: 'integer', default: 0 },
    include_current: { type: 'integer', default: 0 },
    graph_type: { type: 'string', default: 'BarGraph' },
    conditions: { type: 'json' },
    conditions_op: { type: 'string' },
    metadata: { type: 'json' },
    interval: { type: 'string', default: 'Monthly' },
    color_scheme: { type: 'json' },
    tombstone: { type: 'boolean' },
  },
  
  dashboard: {
    id: { type: 'id' },
    type: { type: 'string', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    x: { type: 'integer', required: true },
    y: { type: 'integer', required: true },
    meta: { type: 'json' },
    tombstone: { type: 'boolean' },
  },
};

/**
 * Common join paths for transactions
 * Format: "field.joinField" maps to referenced table
 */
export const JOIN_PATHS: Record<string, { table: string; field: string }> = {
  'payee.name': { table: 'payees', field: 'name' },
  'payee.category': { table: 'payees', field: 'category' },
  'category.name': { table: 'categories', field: 'name' },
  'category.group': { table: 'categories', field: 'group' },
  'category.is_income': { table: 'categories', field: 'is_income' },
  'category.hidden': { table: 'categories', field: 'hidden' },
  'account.name': { table: 'accounts', field: 'name' },
  'account.type': { table: 'accounts', field: 'type' },
  'account.offbudget': { table: 'accounts', field: 'offbudget' },
  'account.closed': { table: 'accounts', field: 'closed' },
};

/**
 * Get all valid field names for a table
 */
export function getTableFields(tableName: string): string[] | null {
  const table = ACTUAL_SCHEMA[tableName];
  if (!table) return null;
  return Object.keys(table);
}

/**
 * Get all valid table names
 */
export function getTableNames(): string[] {
  return Object.keys(ACTUAL_SCHEMA);
}

/**
 * Check if a table exists
 */
export function isValidTable(tableName: string): boolean {
  return tableName in ACTUAL_SCHEMA;
}

/**
 * Check if a field exists in a table
 */
export function isValidField(tableName: string, fieldName: string): boolean {
  const table = ACTUAL_SCHEMA[tableName];
  if (!table) return false;
  return fieldName in table;
}

/**
 * Check if a join path is valid
 */
export function isValidJoinPath(path: string): boolean {
  return path in JOIN_PATHS;
}

/**
 * Get field type information
 */
export function getFieldType(tableName: string, fieldName: string): string | null {
  const table = ACTUAL_SCHEMA[tableName];
  if (!table || !(fieldName in table)) return null;
  return table[fieldName].type;
}
