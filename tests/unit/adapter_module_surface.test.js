// tests/unit/adapter_module_surface.test.js
//
// #166: actual-adapter.ts is being split into cohesive modules under
// src/lib/actual-adapter/. The split MUST preserve the public surface: every
// symbol that importers (tools, tests) pull from '../lib/actual-adapter.js' must
// still be exported by the barrel, and the extracted modules must be importable
// on their own. This is the regression guard for the refactor.
//
// Run: node tests/unit/adapter_module_surface.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const adapter = await import('../../dist/src/lib/actual-adapter.js');

let passed = 0, failed = 0;
function check(label, cond) { if (cond) { console.log(`  ok: ${label}`); passed++; } else { console.error(`  FAIL: ${label}`); failed++; } }

console.log('\n[adapter-module-surface] barrel re-exports preserved');
// Symbols that were defined in actual-adapter.ts before the #166 split and are
// imported elsewhere. They must remain exported from the barrel.
const REQUIRED = [
  'normalizeToTransactionArray', 'normalizeToId', 'normalizeImportResult', // normalize.ts
  'parseWhereClause',                                                       // query.ts
  'isRetryableAuthError', 'withAuthRetry', '_resetAuthRetryCountersForTests',// auth-retry.ts
  'setMaxConcurrency', 'getConcurrencyState',                               // concurrency.ts + barrel
  'withActualApi', 'withActualApiWrite', 'withWriteSession',               // core (stayed)
  'runQuery', 'getAccounts', 'addTransactions', 'deleteTransaction',       // methods (stayed)
];
for (const name of REQUIRED) {
  check(`barrel exports ${name} (${typeof adapter[name]})`, typeof adapter[name] === 'function');
}
check('barrel exports a default aggregate object', adapter.default && typeof adapter.default === 'object');

console.log('\n[adapter-module-surface] extracted modules import independently');
const normalize = await import('../../dist/src/lib/actual-adapter/normalize.js');
const query = await import('../../dist/src/lib/actual-adapter/query.js');
const authRetry = await import('../../dist/src/lib/actual-adapter/auth-retry.js');
const concurrency = await import('../../dist/src/lib/actual-adapter/concurrency.js');
check('normalize.ts exports normalizeToId', typeof normalize.normalizeToId === 'function');
check('query.ts exports parseWhereClause', typeof query.parseWhereClause === 'function');
check('auth-retry.ts exports withAuthRetry + getAuthRetryCounts', typeof authRetry.withAuthRetry === 'function' && typeof authRetry.getAuthRetryCounts === 'function');
check('concurrency.ts exports withConcurrency + getConcurrencySnapshot', typeof concurrency.withConcurrency === 'function' && typeof concurrency.getConcurrencySnapshot === 'function');

console.log('\n[adapter-module-surface] composed observability shape intact');
const state = adapter.getConcurrencyState();
for (const key of ['running', 'queueLength', 'maxConcurrency', 'authRetries', 'authRetryFailures', 'connectionReuses', 'writeConnectionReuses']) {
  check(`getConcurrencyState has "${key}"`, key in state && typeof state[key] === 'number');
}

console.log('\n[adapter-module-surface] barrel identity equals the module (single instance, no duplicate state)');
check('adapter.setMaxConcurrency is concurrency.setMaxConcurrency (same binding)', adapter.setMaxConcurrency === concurrency.setMaxConcurrency);
check('adapter.parseWhereClause is query.parseWhereClause (same binding)', adapter.parseWhereClause === query.parseWhereClause);

console.log(`\n[adapter-module-surface] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
