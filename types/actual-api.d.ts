declare module '@actual-app/api' {
  export interface InitOptions {
    dataDir: string;
    serverURL: string;
    password: string;
  }

  export function init(options: InitOptions): Promise<void>;
  export function downloadBudget(syncId: string): Promise<void>;

  // TODO: Replace 'any' with proper types when available
  export function searchDocuments(query: string): Promise<unknown>;

  // Exported resource objects with explicit empty object types
  export const resources: Record<string, unknown>;
  export const prompts: Record<string, unknown>;
  export const models: Record<string, unknown>;
  export const logging: Record<string, unknown>;
}
