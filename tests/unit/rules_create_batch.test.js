// tests/unit/rules_create_batch.test.js
// #485: actual_rules_create_batch, driven through the REAL tool and the REAL adapter with RAW
// api stubs (installed before the adapter import, session disarmed). Never a stubbed adapter:
// that would stub the reference guard and the write cycle away.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_create_batch.test.js

import { readFileSync } from 'node:fs';
import { makeCycleWitness } from './helpers/write-cycle.mjs';

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// The cooperative deadline is 75% of this; pinned so the deadline case does not depend on the environment.
process.env.ACTUAL_OP_TIMEOUT_MS  = '30000';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const CAT   = '10000000-0000-4000-8000-000000000001';
const GHOST = '19999999-0000-4000-8000-000000000009';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
let witness = null;
let created = [];        // rules received by the raw create
let drainSamples = [];   // drain counter sampled inside every raw create
let deleteCalls = 0;
let categoryReads = 0;
let behaviour = () => null; // (callIndex, rule) => throw-or-undefined
let clockOffset = 0;
let createCostMs = 0;

apiDefault.sync = async () => {};
apiDefault.getCategories = async () => { categoryReads++; witness?.noteRead(); return [{ id: CAT, name: 'Food' }]; };
apiDefault.getPayees = async () => { witness?.noteRead(); return []; };
apiDefault.getAccounts = async () => { witness?.noteRead(); return []; };
apiDefault.deleteRule = async () => { deleteCalls++; return true; };
apiDefault.createRule = async (rule) => {
  const n = created.length;
  created.push(rule);
  drainSamples.push(adapterMod._getWriteQueueBatchCountForTests());
  witness?.noteWrite();
  clockOffset += createCostMs;
  const thrown = behaviour(n, rule);
  if (thrown) throw thrown;
  return `rule-${n}`;
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const retryMod = await import('../../dist/src/lib/retry.js');
adapterMod._setSkipApiInitForTests(true);
witness = makeCycleWitness(adapterMod);
const tool = (await import('../../dist/src/tools/rules_create_batch.js')).default;

const NOTE = (v) => ({ op: 'set', field: 'notes', value: v });
const rule = (tag = 'x', actions = [NOTE(tag)]) => ({ conditions: [{ field: 'imported_payee', op: 'contains', value: tag }], actions });
const reset = () => { created = []; drainSamples = []; deleteCalls = 0; categoryReads = 0; behaviour = () => null; createCostMs = 0; clockOffset = 0; };
const run = async (rules) => { reset(); witness.reset(); const out = await tool.call({ rules }); return out.result; };
const attempt = async (input) => { reset(); try { return { res: (await tool.call(input)).result, err: null }; } catch (err) { return { res: null, err }; } };
const zodMessages = (e) => (e?.issues ?? []).map((i) => i.message).join(' | ') || String(e?.message);

console.log('\n[#485] valid rules: one drain, one create each, ids returned');
{
  const before = adapterMod._getWriteQueueBatchCountForTests();
  const res = await run([rule('a'), rule('b'), rule('c')]);
  check(JSON.stringify(Object.keys(res).sort()) === JSON.stringify(['failed', 'failureCount', 'succeeded', 'successCount', 'total']), 'exactly the documented keys');
  check(res.total === 3 && res.successCount === 3 && res.failureCount === 0, 'total 3, successCount 3, failureCount 0');
  check(JSON.stringify(res.succeeded) === JSON.stringify([{ index: 0, id: 'rule-0' }, { index: 1, id: 'rule-1' }, { index: 2, id: 'rule-2' }]), 'succeeded carries index and id', JSON.stringify(res.succeeded));
  check(created.length === 3, 'three raw creates');
  const distinct = [...new Set(drainSamples)];
  check(distinct.length === 1 && distinct[0] === before + 1, 'every raw create ran in the SAME single drain', JSON.stringify(drainSamples));
  check(created.every((r) => r.stage === null && r.conditionsOp === 'and'), 'the post-parse item is sent (stage null, conditionsOp and)');
}

console.log('\n[#485] reference guard in the batch: [good, dangling category, good]');
{
  const res = await run([
    rule('a', [{ op: 'set', field: 'category', value: CAT }]),
    rule('b', [{ op: 'set', field: 'category', value: GHOST }]),
    rule('c', [{ op: 'set', field: 'category', value: CAT }]),
  ]);
  check(res.succeeded.map((s) => s.index).join() === '0,2', 'items 0 and 2 are created');
  check(res.failed.length === 1 && res.failed[0].index === 1 && /Category/.test(res.failed[0].error) && res.failed[0].error.includes(GHOST), 'item 1 is failed naming Category and the id', JSON.stringify(res.failed));
  check(created.length === 2, 'two raw creates');
  check(categoryReads === 1, 'getCategories reached upstream once for the whole call (the drain cache is part of the mechanism)', String(categoryReads));
  check(witness.sharedOneCycle(), 'the listing read and the creates shared ONE drain', witness.describe());
}

console.log('\n[#485] helper failure is per item: [valid, set category "not-a-uuid", valid]');
{
  const res = await run([rule('a'), rule('b', [{ op: 'set', field: 'category', value: 'not-a-uuid' }]), rule('c')]);
  check(res.failed.length === 1 && res.failed[0].index === 1 &&
    res.failed[0].error === 'Action field "category" expects a category ID (UUID), but got text value "not-a-uuid". Use the category UUID from your budget data. You can list categories to find the correct UUID.',
    'item 1 fails with the exact actual_rules_create message', JSON.stringify(res.failed));
  check(created.length === 2 && res.succeeded.map((s) => s.index).join() === '0,2', 'two raw creates, indices 0 and 2 succeed (original indices kept)');
  check(res.succeeded.length + res.failed.length === 3, 'every index appears exactly once');
}

console.log('\n[#485] no item passes: no queued op runs');
{
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  const res = (await tool.call({ rules: [rule('a', [{ op: 'set', value: 'x' }]), rule('b', [{ op: 'append-notes', value: 5 }])] })).result;
  check(res.successCount === 0 && res.failureCount === 2 && res.failed.map((f) => f.index).join() === '0,1', 'both are failed, in order');
  check(adapterMod._getWriteQueueBatchCountForTests() === before && created.length === 0, 'no drain was dispatched and nothing was created');
}

console.log('\n[#485] upstream rejection of the middle item: nothing rolled back');
{
  reset(); witness.reset();
  behaviour = (n) => (n === 1 ? { type: 'APIError', message: 'Failed creating a new rule', meta: { conditionErrors: ['internal'], actionErrors: [null] } } : null);
  const res = (await tool.call({ rules: [rule('a'), rule('b'), rule('c')] })).result;
  check(created.length === 3 && deleteCalls === 0, '3 raw creates and 0 deletes');
  check(res.succeeded.map((s) => s.index).join() === '0,2', 'indices 0 and 2 succeed');
  const e = res.failed[0]?.error ?? '';
  check(res.failed.length === 1 && res.failed[0].index === 1 && e.includes('Failed creating a new rule') && /condition 0/.test(e) && !e.includes('[object Object]'), 'the plain-object APIError is read by .message with the condition position', e);
  check(!/action 0/.test(e), 'a null action error is not listed');
}

console.log('\n[#485] a rate limit is per item and the batch continues');
{
  reset(); witness.reset();
  behaviour = (n) => (n === 1 ? new Error('Too many requests') : null);
  const res = (await tool.call({ rules: [rule('a'), rule('b'), rule('c')] })).result;
  check(retryMod.isRateLimitError(new Error('Too many requests')), 'the stub is a real rate-limit error');
  check(created.length === 3, 'item 1 was sent once and item 2 still ran (a rate limit is not transient, so this does not pin the retry count; the ECONNRESET abort case does)');
  check(res.failed.length === 1 && res.failed[0].index === 1 && /Too many requests/.test(res.failed[0].error) && res.succeeded.length === 2, 'item 1 is failed, no abort');
}

console.log('\n[#485] an infrastructure error aborts the batch');
{
  reset(); witness.reset();
  behaviour = (n) => (n === 2 ? new Error('read ECONNRESET') : null);
  let threw = null;
  try { await tool.call({ rules: [rule('a'), rule('b'), rule('c'), rule('d')] }); } catch (e) { threw = e; }
  check(threw instanceof Error, 'the call rejects (a tool error, not a result)');
  check(created.length === 3, 'exactly 3 raw creates: item 3 was never sent');
  check(threw && threw.message.startsWith('Rules batch aborted after 2 of 4 items (applied: 0, 1): read ECONNRESET.') && /actual_rules_get before retrying/.test(threw.message), 'names the count, the applied indices, the original text and the read-back advice', threw?.message);
  check(retryMod.isRetryableError(threw) && !retryMod.isRateLimitError(threw), 'still classified as infrastructure');
  check(threw?.cause instanceof Error && threw.cause.message === 'read ECONNRESET', 'the original error is the cause');

  // Index ownership: a helper failure at index 0 shifts nothing; M is the caller's rules.length.
  reset(); witness.reset();
  behaviour = (n) => (n === 1 ? new Error('read ECONNRESET') : null);
  threw = null;
  try { await tool.call({ rules: [rule('a', [{ op: 'set', value: 'x' }]), rule('b'), rule('c')] }); } catch (e) { threw = e; }
  check(threw && threw.message.startsWith('Rules batch aborted after 1 of 3 items (applied: 1):'), 'abort message uses ORIGINAL indices and M = rules.length', threw?.message);
}

console.log('\n[#485] cooperative deadline: stop sending at 75% of ACTUAL_OP_TIMEOUT_MS');
{
  const realNow = Date.now;
  Date.now = () => realNow() + clockOffset;
  try {
    reset(); witness.reset(); createCostMs = 10000;
    const res = (await tool.call({ rules: Array.from({ length: 6 }, (_, i) => rule(`r${i}`)) })).result;
    check(res.succeeded.map((s) => s.index).join() === '0,1,2', 'rules before the deadline are created');
    check(res.failed.map((f) => f.index).join() === '3,4,5' && res.failed.every((f) => f.error === 'not attempted: batch time budget exhausted'), 'the tail is reported not attempted');
    check(created.length === 3, 'and was never sent upstream');
    check(res.succeeded.length + res.failed.length === 6, 'every index exactly once on the deadline path');
  } finally { Date.now = realNow; clockOffset = 0; createCostMs = 0; }
}

console.log('\n[#485] pre-write refusals: a tool error and zero raw creates');
{
  const cases = [
    ['51 rules', { rules: Array.from({ length: 51 }, () => rule()) }, /<=50 items/],
    ['empty array', { rules: [] }, />=1 items/],
    ['stage "default"', { rules: [{ ...rule(), stage: 'default' }] }, null],
    ['conditionsOp "xor"', { rules: [{ ...rule(), conditionsOp: 'xor' }] }, null],
    ['an item missing actions', { rules: [{ conditions: rule().conditions }] }, null],
  ];
  for (const [label, input, re] of cases) {
    const { err } = await attempt(input);
    check(err && created.length === 0 && (!re || re.test(zodMessages(err))), `${label} is refused with nothing created`, zodMessages(err));
  }
  const ok50 = await attempt({ rules: Array.from({ length: 50 }, () => rule()) });
  check(ok50.res?.successCount === 50, '50 rules are accepted');
  const unknownField = await attempt({ rules: [{ conditions: [{ field: 'bogus_field', op: 'is', value: 'x' }], actions: [NOTE('n')] }] });
  check(unknownField.res?.total === 1 && unknownField.err === null, 'an unknown condition field passes the pre-write checks (upstream decides, per item)');
}

console.log('\n[#485] the description states the contract');
{
  const d = tool.description;
  check(/NOT atomic/.test(d) && /no rollback/i.test(d), 'non-atomic, no rollback');
  check(/not attempted/.test(d) && /never sent/.test(d) && /actual_rules_get/.test(d) && /BEFORE retrying ANY item/.test(d), 'not-attempted and read-back-before-retry');
  check(/50/.test(d) && !/atomic(ally)? (transaction|operation)/i.test(d.replace(/NOT atomic/g, '')), 'cap stated, no atomicity claim');
}

console.log('\n[#485] the tool file holds no raw API access and no console');
{
  const src = readFileSync(new URL('../../src/tools/rules_create_batch.ts', import.meta.url), 'utf8');
  check(!/from\s+['"]@actual-app\/api|import\(\s*['"]@actual-app\/api|require\(\s*['"]@actual-app\/api/.test(src), 'no @actual-app/api import');
  check(!/console\./.test(src), 'no console.*');
}

console.log('\n[#524] result order is sorted by index');
{
  const idx = (a) => a.map((x) => x.index).join();
  const ok = await run([rule('a'), rule('b'), rule('c')]);
  check(idx(ok.succeeded) === '0,1,2' && ok.failed.length === 0, 'U1a: all valid, succeeded 0,1,2 and no failures');

  const mixed = await run([rule('a', [{ op: 'set', field: 'category', value: GHOST }]), rule('b'), rule('c', [{ op: 'set', field: 'category', value: 'not-a-uuid' }])]);
  check(idx(mixed.failed) === '0,2' && idx(mixed.succeeded) === '1', 'U1b: tool-side failure at a high index meets an adapter refusal at a low one, failed sorted 0,2', idx(mixed.failed));
  check(/Category/.test(mixed.failed[0]?.error ?? '') && (mixed.failed[0]?.error ?? '').includes(GHOST), 'U1b: index 0 is the adapter refusal naming Category and the ghost id');

  // Direct adapter calls: going through the tool cannot detect a missing adapter sort, because the tool's own failed.sort would mask it.
  reset(); witness.reset();
  behaviour = (n) => (n === 0 ? { type: 'APIError', message: 'Failed creating a new rule' } : null);
  const f = await adapterMod.createRulesBatch([{ index: 0, rule: rule('a') }, { index: 1, rule: rule('b', [{ op: 'set', field: 'category', value: GHOST }]) }], 2);
  check(idx(f.failed) === '0,1', 'U1c: adapter failed list (guard refusal then upstream rejection) is sorted 0,1', idx(f.failed));

  reset(); witness.reset();
  const s = await adapterMod.createRulesBatch([{ index: 3, rule: rule('d') }, { index: 1, rule: rule('b') }], 4);
  check(idx(s.succeeded) === '1,3', 'U1d: adapter succeeded list is sorted 1,3', idx(s.succeeded));
}

console.log('\n[#522] batch refusal suffix and forced shutdown on abort');
{
  // U10: the single-rule "Nothing was created." would be false here, other items may be created.
  const res = await run([rule('a', [{ op: 'set', field: 'category', value: GHOST }]), rule('b', [NOTE('ok')])]);
  check(res.failed.length === 1 && res.failed[0].index === 0 && res.failed[0].error.includes('This rule was not created.') && !res.failed[0].error.includes('Nothing was created.'), 'U10: the refused item says "This rule was not created."', JSON.stringify(res.failed));
  check(res.succeeded.length === 1 && res.succeeded[0].index === 1, 'U10: the other item succeeded');

  // U9: an infrastructure abort tears the singleton down once the drain finishes (stdio). The
  // skip seam never calls api.shutdown(), so isApiInitialized() is the observable witness.
  const { isApiInitialized } = await import('../../dist/src/lib/apiState.js');
  const priorStdio = process.env.MCP_STDIO_MODE;
  process.env.MCP_STDIO_MODE = 'true';
  try {
    reset(); witness.reset();
    adapterMod._setApiInitializedForTests(true);
    behaviour = (n) => (n === 0 ? new Error('read ECONNRESET') : null);
    let threw = null;
    try { await tool.call({ rules: [rule('a'), rule('b')] }); } catch (e) { threw = e; }
    await new Promise((r) => setTimeout(r, 100));
    check(threw instanceof Error && isApiInitialized() === false, 'U9: after an ECONNRESET abort the api singleton was torn down', `threw=${!!threw} init=${isApiInitialized()}`);

    reset(); witness.reset();
    adapterMod._setApiInitializedForTests(true);
    const ok = await tool.call({ rules: [rule('a'), rule('b')] });
    await new Promise((r) => setTimeout(r, 100));
    check(ok.result.succeeded.length === 2 && isApiInitialized() === true, 'U9 control: no error leaves the singleton alive on stdio', `init=${isApiInitialized()}`);
  } finally {
    adapterMod._setApiInitializedForTests(false);
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_create_batch checks passed');
process.exit(0);
