// #763: actual_categories_create must let the adapter's typed not-found refusal through
// unchanged (class and text), not wrap it in "Failed to create category: ...".
//
// Run: node tests/unit/categories_create.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

import assert from 'node:assert';

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[#763] actual_categories_create');

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const tool = (await import('../../dist/src/tools/categories_create.js')).default;

const original = adapter.createCategory;
try {
  await check('NEGATIVE: an unknown group refusal keeps its class and exact legacy text', async () => {
    adapter.createCategory = async () => { throw new NotFoundRefusal('Category group', UNKNOWN, 'actual_category_groups_get'); };
    let e;
    try { await tool.call({ name: 'X', group_id: UNKNOWN }); } catch (x) { e = x; }
    assert.ok(e && isPreflightRefusal(e), String(e));
    assert.strictEqual(e.message, `Category group "${UNKNOWN}" not found. Use actual_category_groups_get to list available category groups.`);
  });
  await check('a plain failure is still wrapped', async () => {
    adapter.createCategory = async () => { throw new Error('boom'); };
    let e;
    try { await tool.call({ name: 'X', group_id: UNKNOWN }); } catch (x) { e = x; }
    assert.strictEqual(e && e.message, 'Failed to create category: boom');
  });
} finally { adapter.createCategory = original; }

console.log(`\n[#763] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
