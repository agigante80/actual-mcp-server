// tests/unit/budget_preference_store.test.js
//
// #189 Phase 1: per-principal active-budget preference store. Verifies:
//   * set/get round-trip
//   * SECURITY: the on-disk file contains only sha256(principal), never the raw
//     principal (email/sub)
//   * graceful no-op on a missing / corrupt / unwritable store (never throws)
//   * pickAllowedPreferredBudget enforces the live ACL on restore (the security
//     boundary: a stale preference can never widen access)
//
// Run: node tests/unit/budget_preference_store.test.js

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// config validates these at import; set before importing the store.
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'pref-'));
process.env.MCP_BRIDGE_DATA_DIR = DATA_DIR;
const STORE_FILE = join(DATA_DIR, 'budget-preferences.json');

const store = await import('../../dist/src/lib/budget-preference-store.js');

let passed = 0, failed = 0;
function ok(m) { console.log(`  PASS: ${m}`); passed++; }
function bad(m) { console.error(`  FAIL: ${m}`); failed++; }
function assert(c, m) { c ? ok(m) : bad(m); }

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

console.log('Running #189 budget-preference-store tests');

console.log('\n[set/get round-trip]');
{
  const principal = 'user@example.com';
  store.setPreferredBudgetSyncId(principal, 'sync-aaa');
  assert(store.getPreferredBudgetSyncId(principal) === 'sync-aaa', 'set then get returns the stored syncId');
  store.setPreferredBudgetSyncId(principal, 'sync-bbb');
  assert(store.getPreferredBudgetSyncId(principal) === 'sync-bbb', 'set overwrites the prior value');
  assert(store.getPreferredBudgetSyncId('someone-else') === undefined, 'unknown principal returns undefined');
  assert(store.getPreferredBudgetSyncId(undefined) === undefined, 'undefined principal returns undefined');
}

console.log('\n[SECURITY: only sha256 at rest, never the raw principal]');
{
  const principal = 'secret-user@example.com';
  store.setPreferredBudgetSyncId(principal, 'sync-ccc');
  const raw = readFileSync(STORE_FILE, 'utf8');
  assert(!raw.includes(principal), 'on-disk file does NOT contain the raw principal');
  assert(raw.includes(sha256(principal)), 'on-disk file DOES contain sha256(principal)');
  assert(JSON.parse(raw)[sha256(principal)] === 'sync-ccc', 'hash maps to the syncId');
}

console.log('\n[graceful no-op: corrupt file]');
{
  writeFileSync(STORE_FILE, 'this is not json {{{', 'utf8');
  let threw = false;
  let val;
  try { val = store.getPreferredBudgetSyncId('user@example.com'); } catch { threw = true; }
  assert(!threw, 'getPreferredBudgetSyncId does not throw on a corrupt file');
  assert(val === undefined, 'corrupt file reads as empty (undefined)');
  // set should recover by overwriting
  let setThrew = false;
  try { store.setPreferredBudgetSyncId('user@example.com', 'sync-ddd'); } catch { setThrew = true; }
  assert(!setThrew, 'setPreferredBudgetSyncId does not throw after a corrupt file');
}

console.log('\n[graceful no-op: unwritable store path]');
{
  // Truly exercise the failure path: replace the store FILE with a DIRECTORY at
  // the same path, so the atomic rename target and the read both fail. The store
  // must swallow both and never throw into the request path.
  rmSync(STORE_FILE, { force: true });
  mkdirSync(STORE_FILE); // the store path is now a directory => write+read fail

  let setThrew = false;
  try { store.setPreferredBudgetSyncId('x@example.com', 'sync-zzz'); } catch { setThrew = true; }
  assert(!setThrew, 'set does not throw when the store path is unwritable (a directory)');

  let getThrew = false, v;
  try { v = store.getPreferredBudgetSyncId('x@example.com'); } catch { getThrew = true; }
  assert(!getThrew && v === undefined, 'get returns undefined (no throw) when the store path is unreadable');
}

console.log('\n[pickAllowedPreferredBudget: ACL is the restore boundary]');
{
  const reg = [
    { name: 'Alpha', syncId: 's1', serverUrl: 'u' },
    { name: 'Beta', syncId: 's2', serverUrl: 'u' },
  ];
  // Positive: ACL includes the stored budget.
  assert(store.pickAllowedPreferredBudget('s1', ['s1'], reg)?.syncId === 's1', 'returns the budget when ACL includes its syncId');
  // Positive: wildcard ACL.
  assert(store.pickAllowedPreferredBudget('s2', ['*'], reg)?.syncId === 's2', 'returns the budget when ACL is unrestricted (*)');
  // Positive: no ACL in context (non-OIDC) means unrestricted.
  assert(store.pickAllowedPreferredBudget('s1', undefined, reg)?.syncId === 's1', 'returns the budget when allowedBudgets is undefined (non-OIDC)');
  // Negative: ACL does NOT include the stored budget (stale preference).
  assert(store.pickAllowedPreferredBudget('s1', ['s2'], reg) === undefined, 'rejects a stored budget the live ACL no longer permits');
  // Negative: no stored preference.
  assert(store.pickAllowedPreferredBudget(undefined, ['*'], reg) === undefined, 'undefined stored syncId returns undefined');
  // Negative: stored budget not in the registry.
  assert(store.pickAllowedPreferredBudget('s-gone', ['*'], reg) === undefined, 'a stored syncId absent from the registry returns undefined');
}

console.log(`\n[budget-preference-store] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
