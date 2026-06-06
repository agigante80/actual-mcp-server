// tests/unit/tags_create.test.js
// Unit tests for actual_tags_create tool.

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

  const EXISTING_ID = '00000000-0000-0000-0000-0000000000aa';
  let createCallCount = 0;
  // Simulate upsert: always return the same id for the same tag name
  apiDefault.createTag = async (_tag) => {
    createCallCount++;
    return EXISTING_ID;
  };
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/tags_create.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origCreateTag = adapter.createTag;
  adapter.createTag = async (tag) => {
    createCallCount++;
    return EXISTING_ID;
  };

  const reset = () => { createCallCount = 0; };

  console.log('\n[tags_create] positive: valid input returns id string');
  {
    reset();
    const res = await tool.call({ tag: 'groceries', color: '#33aa33', description: 'Food' });
    check(res?.result !== undefined, 'result key present');
    check(typeof res?.result === 'string', 'result is a string id');
    check(res?.result === EXISTING_ID, 'returned expected id');
    check(createCallCount === 1, 'adapter.createTag called once');
  }

  console.log('\n[tags_create] positive upsert: creating same tag name twice returns same id');
  {
    reset();
    const res1 = await tool.call({ tag: 'groceries' });
    const res2 = await tool.call({ tag: 'groceries', color: '#0000ff' });
    check(res1?.result === EXISTING_ID, 'first call returns EXISTING_ID');
    check(res2?.result === EXISTING_ID, 'second call returns same EXISTING_ID (upsert)');
    check(createCallCount === 2, 'adapter.createTag called twice (both calls reached adapter)');
  }

  console.log('\n[tags_create] negative: empty tag rejected by Zod');
  {
    reset();
    let threw = null;
    try { await tool.call({ tag: '' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on empty tag');
    check(createCallCount === 0, 'adapter.createTag NOT called');
  }

  console.log('\n[tags_create] negative: missing tag rejected by Zod');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on missing tag field');
    check(createCallCount === 0, 'adapter.createTag NOT called');
  }

  console.log('\n[tags_create] schema: accepts minimal valid input');
  {
    let threw = false;
    try { tool.inputSchema.parse({ tag: 'travel' }); } catch (_) { threw = true; }
    check(!threw, 'minimal input accepted by schema');
  }

  console.log('\n[tags_create] schema: rejects empty tag string');
  {
    let threw = false;
    try { tool.inputSchema.parse({ tag: '' }); } catch (_) { threw = true; }
    check(threw, 'empty tag string rejected by schema');
  }

  adapter.createTag = origCreateTag;

  console.log('');
  if (failures === 0) console.log('[tags_create] All tests passed');
  else { console.error(`[tags_create] ${failures} test(s) FAILED`); process.exit(2); }
})();
