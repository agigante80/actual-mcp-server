/**
 * Type stub for @actual-app/core (all subpath exports).
 *
 * @actual-app/core ships TypeScript source files as its package exports.
 * From @actual-app/api v26.4.0, its @types/index.d.ts imports directly
 * from @actual-app/core using package specifiers. TypeScript's NodeNext
 * resolver follows those into the source files, which require
 * typescript-strict-plugin to compile and have peer deps (i18next,
 * hyperformula, google-protobuf, etc.) that aren't installed here.
 *
 * tsconfig.json paths maps ALL @actual-app/core/* imports to this file.
 * We export every symbol that @actual-app/api/@types/index.d.ts needs as
 * `any` so TypeScript can resolve @actual-app/api's public exports without
 * following into @actual-app/core source files.
 *
 * Type safety impact: minimal. @actual-app/api already types its return
 * values as Promise<any>. Input entity types (account/category IDs) flow
 * through @actual-app/api's own declarations; our Zod schemas validate
 * inputs at runtime independently.
 */

// From @actual-app/core/server/api-models
export declare type APIAccountEntity = any;
export declare type APICategoryEntity = any;
export declare type APICategoryGroupEntity = any;
export declare type APIFileEntity = any;
export declare type APIPayeeEntity = any;
export declare type APIScheduleEntity = any;
export declare type APITagEntity = any;

// From @actual-app/core/types/models
export declare type ImportTransactionEntity = any;
export declare type RuleEntity = any;
export declare type TransactionEntity = any;

// From @actual-app/core/types/api-handlers
export declare type ImportTransactionsOpts = any;

// From @actual-app/core/server/main
export declare type InitConfig = any;
export declare const lib: any;

// From @actual-app/core/shared/query
export declare type Query = any;
