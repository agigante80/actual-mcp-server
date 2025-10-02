declare module '@jlongster/sql.js' {
  export type BindParams = unknown[] | Record<string, unknown> | undefined;
  export type ParamsCallback = (row: Record<string, unknown>) => void;
  export type SqlValue = string | number | null | Uint8Array;
  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }
  export type ParamsObject = Record<string, unknown>;

  export class Database {
    constructor(data?: ArrayBuffer | Uint8Array);
    each(
      sql: string,
      params?: BindParams,
      callback?: ParamsCallback,
      done?: () => void
    ): void;
    exec(sql: string, params?: BindParams): QueryExecResult[];
    prepare(sql: string, params?: BindParams): Statement;
  }

  export class Statement {
    bind(params?: BindParams): boolean;
    step(): boolean;
    get(): SqlValue[];
    getColumnNames(): string[];
    free(): void;
  }
}
