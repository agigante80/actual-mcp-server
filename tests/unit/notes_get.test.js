// tests/unit/notes_get.test.js
// Unit tests for actual_notes_get tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const ENTITY_ID = '00000000-0000-0000-0000-000000000001';
const BUDGET_MONTH_ID = 'budget-2026-01';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  apiDefault.getNote = async (id) => ({ id, note: 'test note' });
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/notes_get.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origGetNote = adapter.getNote;

  // createTool wraps handler return in { result: ... }
  // So tool.call() returns { result: { found, id, note, message? } }

  console.log('\n[notes_get] positive: returns note when adapter yields one');
  {
    adapter.getNote = async (id) => ({ id, note: 'reconcile monthly' });
    const res = await tool.call({ id: ENTITY_ID });
    const r = res?.result;
    check(r?.found === true, 'found is true');
    check(r?.id === ENTITY_ID, 'id matches');
    check(r?.note === 'reconcile monthly', 'note text correct');
    check(r?.message === undefined, 'no message when note found');
  }

  console.log('\n[notes_get] positive: returns clear "no note" result when adapter yields null');
  {
    adapter.getNote = async () => null;
    const res = await tool.call({ id: ENTITY_ID });
    const r = res?.result;
    check(r?.found === false, 'found is false');
    check(r?.id === ENTITY_ID, 'id echoed back');
    check(r?.note === null, 'note is null');
    check(typeof r?.message === 'string', 'message is a string');
    check(r?.message?.includes(ENTITY_ID), 'message contains the id');
  }

  console.log('\n[notes_get] positive: works with budget-YYYY-MM id');
  {
    adapter.getNote = async (id) => ({ id, note: '#template 250' });
    const res = await tool.call({ id: BUDGET_MONTH_ID });
    const r = res?.result;
    check(r?.found === true, 'found is true for budget month id');
    check(r?.note === '#template 250', 'template note returned correctly');
  }

  console.log('\n[notes_get] schema: rejects empty id');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: '' }); } catch (_) { threw = true; }
    check(threw, 'empty id rejected by schema');
  }

  console.log('\n[notes_get] schema: rejects missing id');
  {
    let threw = false;
    try { tool.inputSchema.parse({}); } catch (_) { threw = true; }
    check(threw, 'missing id rejected by schema');
  }

  console.log('\n[notes_get] schema: accepts UUID id');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: ENTITY_ID }); } catch (_) { threw = true; }
    check(!threw, 'UUID id accepted by schema');
  }

  console.log('\n[notes_get] schema: accepts budget-YYYY-MM id');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: BUDGET_MONTH_ID }); } catch (_) { threw = true; }
    check(!threw, 'budget-YYYY-MM id accepted by schema');
  }

  adapter.getNote = origGetNote;

  console.log('');
  if (failures === 0) console.log('[notes_get] All tests passed');
  else { console.error(`[notes_get] ${failures} test(s) FAILED`); process.exit(2); }
})();
