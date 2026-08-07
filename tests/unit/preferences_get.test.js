// tests/unit/preferences_get.test.js
//
// #333: unit tests for actual_preferences_get.
//
// The upstream return type is `SyncedPrefs`, which our tsconfig resolves through
// the @actual-app/core stub to `any`. There is therefore NO compile-time contract
// on this shape, so the normalisation is the only thing standing between a weird
// upstream response and a caller that does `Object.keys(result.preferences)`.
// These tests exercise that normalisation directly.
//
// Run: node tests/unit/preferences_get.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/preferences_get.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;
  const orig = adapter.getPreferences;

  const PREFS = { dateFormat: 'yyyy-MM-dd', numberFormat: 'dot-comma', firstDayOfWeekIdx: '1' };

  console.log('\n[preferences_get] positive: returns the synced preferences');
  {
    adapter.getPreferences = async () => PREFS;
    const res = await tool.call({});
    const r = res?.result;
    check(r !== undefined, 'result key present');
    check(r?.preferences?.dateFormat === 'yyyy-MM-dd', 'dateFormat passed through');
    check(r?.preferences?.numberFormat === 'dot-comma', 'numberFormat passed through');
    check(Array.isArray(r?.keys) && r.keys.length === 3, 'keys lists all three preference names');
    check(r?.count === 3, 'count matches the number of preferences');
    check(typeof r?.message === 'string' && r.message.includes('3'), 'message reports the count');
  }

  console.log('\n[preferences_get] positive: a budget with no preferences reports emptiness explicitly');
  {
    adapter.getPreferences = async () => ({});
    const r = (await tool.call({}))?.result;
    check(r?.count === 0, 'count is 0');
    check(Array.isArray(r?.keys) && r.keys.length === 0, 'keys is an empty array, not undefined');
    check(typeof r?.message === 'string' && /no synced preferences/i.test(r.message), 'message says defaults are in use');
  }

  console.log('\n[preferences_get] negative: a null upstream response normalises to an empty object');
  {
    adapter.getPreferences = async () => null;
    const r = (await tool.call({}))?.result;
    check(r?.preferences !== null && typeof r?.preferences === 'object', 'preferences is an object, never null');
    check(r?.count === 0, 'count is 0 for a null response');
    check(Object.keys(r.preferences).length === 0, 'preferences is empty');
  }

  console.log('\n[preferences_get] negative: an undefined upstream response normalises to an empty object');
  {
    adapter.getPreferences = async () => undefined;
    const r = (await tool.call({}))?.result;
    check(typeof r?.preferences === 'object' && r.preferences !== null, 'preferences is an object');
    check(r?.count === 0, 'count is 0');
  }

  console.log('\n[preferences_get] negative: an ARRAY response is rejected as a preferences map');
  {
    // Object.keys([]) would report array INDICES as preference names, which would
    // be silently wrong rather than loudly wrong. The guard must reject arrays.
    adapter.getPreferences = async () => ['dateFormat', 'numberFormat'];
    const r = (await tool.call({}))?.result;
    check(!Array.isArray(r?.preferences), 'preferences is not an array');
    check(r?.count === 0, 'count is 0 rather than the array length');
  }

  console.log('\n[preferences_get] negative: an adapter failure propagates, it is not swallowed');
  {
    adapter.getPreferences = async () => { throw new Error('Authentication failed: invalid-password'); };
    let threw = null;
    try { await tool.call({}); } catch (err) { threw = err; }
    check(threw instanceof Error, 'the error is re-thrown');
    check(/Authentication failed/.test(threw?.message ?? ''), 'the original message is preserved');
  }

  console.log('\n[preferences_get] schema');
  {
    let ok = true;
    try { tool.inputSchema.parse({}); } catch (_) { ok = false; }
    check(ok, 'empty input is accepted');
    check(tool.name === 'actual_preferences_get', 'tool name matches the registry entry');
  }

  adapter.getPreferences = orig;

  console.log('');
  if (failures === 0) console.log('[preferences_get] All tests passed');
  else { console.error(`[preferences_get] ${failures} test(s) FAILED`); process.exit(2); }
})();
