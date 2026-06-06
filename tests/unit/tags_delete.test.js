// tests/unit/tags_delete.test.js
// Unit tests for actual_tags_delete tool.

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
  apiDefault.deleteTag = async () => {};
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/tags_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origDeleteTag = adapter.deleteTag;
  let deleteCalls = 0;
  adapter.deleteTag = async (id) => {
    deleteCalls++;
    if (id === NONEXISTENT_ID) {
      throw new Error(`Tag "${NONEXISTENT_ID}" not found. Use actual_tags_list to list available tags.`);
    }
  };

  const reset = () => { deleteCalls = 0; };

  console.log('\n[tags_delete] positive: valid delete returns success');
  {
    reset();
    const res = await tool.call({ id: EXISTING_ID });
    check(res?.result?.success === true, 'returns { result: { success: true } }');
    check(deleteCalls === 1, 'adapter.deleteTag called once');
  }

  console.log('\n[tags_delete] negative: non-existent id returns not-found error');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: NONEXISTENT_ID }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on non-existent id');
    check(threw?.message?.includes('not found'), 'error message contains "not found"');
    check(threw?.message?.includes('actual_tags_list'), 'error message mentions actual_tags_list');
  }

  console.log('\n[tags_delete] negative: missing id rejected by Zod');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on missing id');
    check(deleteCalls === 0, 'adapter.deleteTag NOT called');
  }

  console.log('\n[tags_delete] negative: invalid UUID format rejected by Zod schema');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: 'not-a-uuid' }); } catch (_) { threw = true; }
    check(threw, 'non-UUID id rejected by schema');
  }

  console.log('\n[tags_delete] schema: valid UUID accepted');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: EXISTING_ID }); } catch (_) { threw = true; }
    check(!threw, 'valid UUID accepted by schema');
  }

  adapter.deleteTag = origDeleteTag;

  console.log('');
  if (failures === 0) console.log('[tags_delete] All tests passed');
  else { console.error(`[tags_delete] ${failures} test(s) FAILED`); process.exit(2); }
})();
