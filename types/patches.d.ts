// Patch: Fix missing or incorrect types in dependencies used by Actual Finance bridge

// 1. Add missing StatementIteratorResult interface to @jlongster/sql.js
declare module '@jlongster/sql.js' {
  export interface StatementIteratorResult {
    done: boolean;
    value?: unknown; // Use unknown instead of any for better type safety
  }
}

// 2. Extend date-fns Locale interface to match Actual Finance expectations (v4 removed it)
declare module 'date-fns' {
  export interface Locale {
    code?: string;
    formatDistance?: (...args: unknown[]) => string;
    formatRelative?: (...args: unknown[]) => string;
    localize?: unknown;
    match?: unknown;
    options?: unknown;
  }
}

// 3. Extend @actual-app/api ImportTransactionsOpts interface with optional preventSync flag
declare module '@actual-app/api' {
  export interface ImportTransactionsOpts {
    preventSync?: boolean;
  }
}
