// tests/unit/tags_update.test.js
// Unit tests for actual_tags_update tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const EXISTING_ID = '00000000-0000-0000-0000-0000000000aa';
const NONEXISTENT_ID = '11111111-1111-1111-1111-111111111111';

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  apiDefault.getTags = async () => [{ id: EXISTING_ID, tag: 'groceries' }];
  apiDefault.updateTag = async () => {};
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/tags_update.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origUpdateTag = adapter.updateTag;
  let updateCalls = 0;
  adapter.updateTag = async (id, fields) => {
    updateCalls++;
    if (id === NONEXISTENT_ID) {
      throw new Error(`Tag "${NONEXISTENT_ID}" not found. Use actual_tags_list to list available tags.`);
    }
  };

  const reset = () => { updateCalls = 0; };

  console.log('\n[tags_update] positive: valid update returns success');
  {
    reset();
    const res = await tool.call({ id: EXISTING_ID, tag: 'food', color: '#112233' });
    check(res?.result?.success === true, 'returns { result: { success: true } }');
    check(updateCalls === 1, 'adapter.updateTag called once');
  }

  console.log('\n[tags_update] positive: update only description');
  {
    reset();
    const res = await tool.call({ id: EXISTING_ID, description: 'New description' });
    check(res?.result?.success === true, 'returns success');
    check(updateCalls === 1, 'adapter.updateTag called once');
  }

  console.log('\n[tags_update] negative: non-existent id returns not-found error');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: NONEXISTENT_ID, tag: 'something' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on non-existent id');
    check(threw?.message?.includes('not found'), 'error message contains "not found"');
    check(threw?.message?.includes('actual_tags_list'), 'error message mentions actual_tags_list');
  }

  console.log('\n[tags_update] negative: no mutable fields provided (refine rejects)');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: EXISTING_ID }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws when no fields provided');
    check(updateCalls === 0, 'adapter.updateTag NOT called');
  }

  console.log('\n[tags_update] negative: empty tag string rejected by Zod');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: EXISTING_ID, tag: '' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on empty tag string');
    check(updateCalls === 0, 'adapter.updateTag NOT called');
  }

  console.log('\n[tags_update] negative: invalid id format rejected by Zod');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: 'not-a-uuid', tag: 'food' }); } catch (_) { threw = true; }
    check(threw, 'non-UUID id rejected by schema');
  }

  console.log('\n[tags_update] schema: valid minimal update accepted');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: EXISTING_ID, tag: 'food' }); } catch (_) { threw = true; }
    check(!threw, 'valid input accepted by schema');
  }

  adapter.updateTag = origUpdateTag;

  console.log('');
  if (failures === 0) console.log('[tags_update] All tests passed');
  else { console.error(`[tags_update] ${failures} test(s) FAILED`); process.exit(2); }
})();
