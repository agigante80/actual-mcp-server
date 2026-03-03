// Patch: Fix missing or incorrect types in dependencies used by Actual Finance bridge

// Extend @actual-app/api ImportTransactionsOpts interface with optional preventSync flag
declare module '@actual-app/api' {
  export interface ImportTransactionsOpts {
    preventSync?: boolean;
  }
}
