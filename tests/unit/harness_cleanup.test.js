// tests/unit/harness_cleanup.test.js
//
// #576: pins scripts/lib/harness-cleanup.mjs, the per-run cleanup the step 9 harness
// scripts (regression-270-stall.mjs, diag-270-http.mjs) call before exiting.
//
// Contract: delete only THIS run's `<PREFIX>-<label>-<runId>` objects, categories before
// groups, every call bounded, stop at the first timeout, never throw.
//
// Run: node tests/unit/harness_cleanup.test.js

import assert from 'assert';
import { deleteOwnObjects, ownNameRe } from '../../scripts/lib/harness-cleanup.mjs';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const text = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

// A stub MCP server: categories come back as { result: [...] }, groups as { groups },
// the two shapes the real tools return.
function stubServer({ cats = [], groups = [], hang = new Set(), fail = new Set() } = {}) {
  const calls = [];
  const callTool = async (name, args) => {
    // #680: the compact calls. `list:<type>` for a listing, `delete:<entity>:<id>` for a delete.
    const key = name === 'list_entities' ? `list:${args.type}` : `${args.action}:${args.entity}:${args.id}`;
    assert.ok(name === 'list_entities' || name === 'manage_categories', `unexpected tool ${name}`);
    calls.push(key);
    if (hang.has(key) || hang.has(args?.id)) return new Promise(() => {});
    if (fail.has(args?.id)) return { isError: true, content: [{ type: 'text', text: 'nope' }] };
    if (key === 'list:category') return text({ result: cats });
    if (key === 'list:category_group') return text({ groups });
    return text({ ok: true });
  };
  return { calls, callTool };
}
const quiet = () => {};
// The bound's timer is unref'd (it must never hold a harness process open), so a stub
// call that never settles would let the event loop drain mid-test; a real MCP client's
// socket keeps it alive. Stand in for that socket.
const keepAlive = setInterval(() => {}, 1000);

console.log('\n[harness-cleanup]');

await check('ownNameRe matches only this run id, a letters label, anchored', () => {
  const re = ownNameRe('MCP-REG270', 4242);
  assert.ok(re.test('MCP-REG270-baseline-4242'));
  for (const n of ['MCP-REG270-baseline-42420', 'MCP-REG270-baseline-424', 'MCP-REG270-baseline-4243', 'MCP-REG270-4242', 'REG270-baseline-4242', 'xMCP-REG270-baseline-4242', 'MCP-DIAG270-mid-4242', 'MCPxREG270-baseline-4242']) {
    assert.ok(!re.test(n), `must NOT match: ${n}`);
  }
});

await check('deletes exactly this run\'s categories, then its groups, in that order', async () => {
  const s = stubServer({
    cats: [
      { id: 'c1', name: 'MCP-REG270-baseline-4242' },
      { id: 'c2', name: 'MCP-REG270-stalled-4242' },
      { id: 'c3', name: 'MCP-REG270-baseline-9999' },  // another run: left to the sweep
      { id: 'c4', name: 'REG270 budget' },         // human name: never touched
      { id: 'c5', name: 'Groceries' },
    ],
    groups: [{ id: 'g1', name: 'MCP-REG270-grp-4242' }, { id: 'g2', name: 'Bills' }],
  });
  const r = await deleteOwnObjects(s.callTool, { prefix: 'MCP-REG270', runId: 4242, log: quiet });
  assert.deepStrictEqual(s.calls, [
    'list:category', 'delete:category:c1', 'delete:category:c2',
    'list:category_group', 'delete:category_group:g1',
  ]);
  assert.deepStrictEqual(r, { deleted: 3, failed: 0, timedOut: false });
});

await check('NEGATIVE: nothing of ours present means no delete call at all', async () => {
  const s = stubServer({ cats: [{ id: 'c3', name: 'MCP-REG270-baseline-9999' }], groups: [{ id: 'g2', name: 'Bills' }] });
  const r = await deleteOwnObjects(s.callTool, { prefix: 'MCP-REG270', runId: 4242, log: quiet });
  assert.ok(!s.calls.some((c) => c.startsWith('delete:')), `unexpected delete: ${s.calls}`);
  assert.strictEqual(r.deleted, 0);
});

await check('a timed-out call stops the cleanup instead of queueing every later call behind it', async () => {
  const s = stubServer({
    cats: [{ id: 'c1', name: 'MCP-REG270-a-1' }, { id: 'c2', name: 'MCP-REG270-b-1' }],
    groups: [{ id: 'g1', name: 'MCP-REG270-grp-1' }],
    hang: new Set(['c1']),
  });
  const t0 = Date.now();
  const r = await deleteOwnObjects(s.callTool, { prefix: 'MCP-REG270', runId: 1, boundMs: 50, log: quiet });
  assert.ok(Date.now() - t0 < 1000, 'cleanup must be bounded');
  assert.strictEqual(r.timedOut, true);
  assert.deepStrictEqual(s.calls, ['list:category', 'delete:category:c1']);
});

await check('a hung listing is bounded too', async () => {
  const s = stubServer({ hang: new Set(['list:category']) });
  const r = await deleteOwnObjects(s.callTool, { prefix: 'MCP-REG270', runId: 1, boundMs: 50, log: quiet });
  assert.strictEqual(r.timedOut, true);
  assert.deepStrictEqual(s.calls, ['list:category']);
});

await check('a failed delete is counted and the cleanup continues; a throwing callTool never throws out', async () => {
  const s = stubServer({ cats: [{ id: 'c1', name: 'MCP-REG270-a-1' }, { id: 'c2', name: 'MCP-REG270-b-1' }], fail: new Set(['c1']) });
  const r = await deleteOwnObjects(s.callTool, { prefix: 'MCP-REG270', runId: 1, log: quiet });
  assert.deepStrictEqual(r, { deleted: 1, failed: 1, timedOut: false });
  const r2 = await deleteOwnObjects(async () => { throw new Error('transport closed'); }, { prefix: 'MCP-REG270', runId: 1, log: quiet });
  // Both listings fail, and each failure is counted rather than reported as "deleted 0".
  assert.deepStrictEqual(r2, { deleted: 0, failed: 2, timedOut: false });
});

await check('NEGATIVE: an error listing is a failure, never a clean "deleted 0"', async () => {
  const lines = [];
  const callTool = async (_name, args) => (args.type === 'category'
    ? { isError: true, content: [{ type: 'text', text: 'Actual API operation timed out' }] }
    : text({ groups: [] }));
  const r = await deleteOwnObjects(callTool, { prefix: 'MCP-REG270', runId: 1, log: (l) => lines.push(l) });
  assert.deepStrictEqual(r, { deleted: 0, failed: 1, timedOut: false });
  assert.ok(lines.some((l) => l.includes('list_entities type category failed') && l.includes('timed out')), lines.join('\n'));
});

clearInterval(keepAlive);
console.log(`\n[harness-cleanup] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
