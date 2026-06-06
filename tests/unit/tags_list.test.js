// tests/unit/tags_list.test.js
// Unit tests for actual_tags_list tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  // Stub getTags to return a known list
  const STUB_TAGS = [
    { id: '00000000-0000-0000-0000-0000000000aa', tag: 'groceries', color: '#33aa33' },
    { id: '00000000-0000-0000-0000-0000000000bb', tag: 'travel' },
  ];
  apiDefault.getTags = async () => STUB_TAGS;

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/tags_list.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  // Override adapter.getTags with our stub
  const origGetTags = adapter.getTags;
  adapter.getTags = async () => STUB_TAGS;

  console.log('\n[tags_list] positive: returns array of tags');
  {
    const res = await tool.call({});
    check(res?.result !== undefined, 'result key present');
    check(Array.isArray(res?.result), 'result is an array');
    check(res?.result?.length === 2, 'returns 2 tags from stub');
    check(res?.result?.[0]?.tag === 'groceries', 'first tag is groceries');
    check(res?.result?.[0]?.id === '00000000-0000-0000-0000-0000000000aa', 'first tag has correct id');
  }

  console.log('\n[tags_list] positive: empty budget returns empty array');
  {
    adapter.getTags = async () => [];
    const res = await tool.call({});
    check(Array.isArray(res?.result), 'result is an array');
    check(res?.result?.length === 0, 'returns empty array');
    adapter.getTags = async () => STUB_TAGS;
  }

  console.log('\n[tags_list] schema: accepts empty input');
  {
    let threw = false;
    try { tool.inputSchema.parse({}); } catch (_) { threw = true; }
    check(!threw, 'empty input accepted by schema');
  }

  adapter.getTags = origGetTags;

  console.log('');
  if (failures === 0) console.log('[tags_list] All tests passed');
  else { console.error(`[tags_list] ${failures} test(s) FAILED`); process.exit(2); }
})();
