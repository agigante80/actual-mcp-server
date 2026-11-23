// tests/unit/schedules_dead_conditions.test.js
//
// #547: upstream stores an OMITTED schedule payee or account as the rule condition
// `{ op: 'is', field, value: "undefined" }` (create) and a CLEARED one as `"null"` (update).
// Neither literal can equal an id, so the schedule never links a transaction. The adapter
// drops the dead condition from the schedule's rule inside the SAME write-queue drain as the
// schedule write. The raw api is stubbed, so the real adapter code runs.
//
// Mutation check (done by hand when this test was written): removing the
// `stripDeadScheduleConditions` call from createSchedule turns the first block red
// (rawUpdateRule is never called), so the test can fail.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/schedules_dead_conditions.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const SID = '00000000-0000-0000-0000-000000000547';
const RULE_ID = '00000000-0000-0000-0000-00000000r547';
const PAYEE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-10-13';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);

let rules = [];
let calls = [];
let witness;
apiDefault.createSchedule = async (s) => { calls.push(['createSchedule', s]); return SID; };
apiDefault.updateSchedule = async (id, fields, reset) => { calls.push(['updateSchedule', { id, fields, reset }]); };
apiDefault.getSchedules = async () => [{ id: SID, amountOp: 'is', amount: -7500 }];
let rulesProvider = () => rules; // the adapter binds api.getRules at import, so the stub stays and only its body varies
apiDefault.getRules = async () => { witness?.noteRead(); calls.push(['getRules']); return rulesProvider(); };
let updateRuleProvider = async (_rule) => {}; // same reason: the body varies, the stub stays
apiDefault.updateRule = async (rule) => { witness?.noteWrite(); calls.push(['updateRule', rule]); await updateRuleProvider(rule); };
apiDefault.sync = async () => {};
// #785: the adapter refuses an account or payee id that no listing carries, so these ids exist.
apiDefault.getAccounts = async () => [{ id: ACCOUNT, name: 'Checking' }];
apiDefault.getPayees = async () => [{ id: PAYEE, name: 'Shop' }];

const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
const { isRetryableError } = await import('../../dist/src/lib/retry.js');
const [createTool, updateTool, adapterMod] = await Promise.all([
  import('../../dist/src/tools/schedules_create.js').then((m) => m.default),
  import('../../dist/src/tools/schedules_update.js').then((m) => m.default),
  import('../../dist/src/lib/actual-adapter.js'),
]);
adapterMod._setSkipApiInitForTests(true);
witness = makeCycleWitness(adapterMod);

/** The rule upstream stores for a schedule: one `is` per field, the value stringified. */
const storedRule = (payeeValue, accountValue) => ({
  id: RULE_ID,
  stage: null,
  conditionsOp: 'and',
  conditions: [
    ...(payeeValue === undefined ? [] : [{ op: 'is', field: 'payee', value: payeeValue, type: 'id' }]),
    ...(accountValue === undefined ? [] : [{ op: 'is', field: 'account', value: accountValue, type: 'id' }]),
    { op: 'isapprox', field: 'date', value: DATE, type: 'date' },
    { op: 'is', field: 'amount', value: -7500, type: 'number' },
  ],
  actions: [{ op: 'link-schedule', value: SID }],
});
const fieldsOf = (rule) => rule.conditions.map((c) => c.field);
const names = () => calls.map((c) => c[0]);
const updateRuleCalls = () => calls.filter((c) => c[0] === 'updateRule').map((c) => c[1]);

const run = async (tool, stored, input) => {
  rules = stored === null ? [] : [stored];
  calls = []; witness.reset();
  try { return { err: null, out: await tool.call(input) }; } catch (e) { return { err: e, out: null }; }
};
const baseCreate = { date: DATE, amount: -7500, amountOp: 'is' };

console.log('\n[#547] create without a payee: the dead payee condition is dropped, in the same drain');
{
  const { err, out } = await run(createTool, storedRule('undefined', ACCOUNT), { ...baseCreate, account: ACCOUNT });
  check(err === null && out?.id === SID, 'create returns the id', String(err?.message ?? err));
  const ups = updateRuleCalls();
  check(ups.length === 1, 'rawUpdateRule called exactly once', `calls=${names().join(',')}`);
  check(ups[0]?.id === RULE_ID && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['account', 'date', 'amount']), 'account, date and amount conditions kept, payee dropped', JSON.stringify(ups[0]?.conditions));
  check(JSON.stringify(ups[0]?.actions) === JSON.stringify([{ op: 'link-schedule', value: SID }]), 'the link-schedule action is untouched');
  check(names().indexOf('createSchedule') < names().indexOf('getRules'), 'the rule is read AFTER the schedule write');
  check(witness.sharedOneCycle(), 'the rule read and the rule write shared the drain of the create', witness.describe());
}

console.log('\n[#547] create without an account: the dead account condition is dropped');
{
  const { err } = await run(createTool, storedRule(PAYEE, 'undefined'), { ...baseCreate, payee: PAYEE });
  const ups = updateRuleCalls();
  check(err === null && ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['payee', 'date', 'amount']), 'payee, date and amount kept, account dropped', JSON.stringify(ups[0]?.conditions ?? err?.message));
  check(ups[0]?.conditions?.[0]?.value === PAYEE, 'the real payee id is kept as is');
}

console.log('\n[#547] create with neither: both dropped, date and amount remain');
{
  const { err } = await run(createTool, storedRule('undefined', 'undefined'), { ...baseCreate });
  const ups = updateRuleCalls();
  check(err === null && ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['date', 'amount']), 'only date and amount remain', JSON.stringify(ups[0]?.conditions ?? err?.message));
}

console.log('\n[#547] create with both fields: no rule read, no rule write');
{
  const { err } = await run(createTool, storedRule(PAYEE, ACCOUNT), { ...baseCreate, payee: PAYEE, account: ACCOUNT });
  check(err === null, 'accepted', String(err?.message ?? err));
  check(JSON.stringify(names()) === JSON.stringify(['createSchedule']), 'exactly one raw call: createSchedule', names().join(','));
}

console.log('\n[#547] tolerant of an upstream that already omits or nulls the condition');
{
  let r = await run(createTool, storedRule(undefined, ACCOUNT), { ...baseCreate, account: ACCOUNT });
  check(r.err === null && updateRuleCalls().length === 0, 'payee condition absent: nothing to strip, no rule write', String(r.err?.message ?? names()));
  r = await run(createTool, storedRule(null, ACCOUNT), { ...baseCreate, account: ACCOUNT });
  check(r.err === null && updateRuleCalls().length === 1 && JSON.stringify(fieldsOf(updateRuleCalls()[0])) === JSON.stringify(['account', 'date', 'amount']), 'payee condition null: treated as dead and dropped', String(r.err?.message ?? names()));
  r = await run(createTool, storedRule('null', ACCOUNT), { ...baseCreate, account: ACCOUNT });
  check(r.err === null && updateRuleCalls().length === 1, 'the literal string "null" is dead too');
  // A real id is never dropped, even when the input omitted the field (an upstream default, say).
  r = await run(createTool, storedRule(PAYEE, ACCOUNT), { ...baseCreate, account: ACCOUNT });
  check(r.err === null && updateRuleCalls().length === 0, 'a stored real payee id is kept even though the input omitted payee');
}

console.log('\n[#547] rule not visible after create: a clear error, polled within the bound');
{
  const started = Date.now();
  const { err } = await run(createTool, null, { ...baseCreate, account: ACCOUNT });
  const msg = String(err?.message ?? '');
  check(err !== null && msg.includes(SID) && msg.includes('actual_schedules_delete'), 'throws, names the schedule and the delete tool', msg);
  check(msg.includes('do not create it again') && msg.includes('actual_schedules_update { payee: null }'), 'says the schedule exists and names the repair', msg);
  check(err !== null && isRetryableError(err) === false, 'not classed transient, so the pooled connection is kept', msg);
  check(names().filter((n) => n === 'getRules').length > 1, 'the read was polled, not tried once', names().join(','));
  check(Date.now() - started < 10000, 'the poll is bounded');
  check(updateRuleCalls().length === 0, 'no rule write');
}

console.log('\n[#547] the rule becomes visible only on the second read (#493 late raw write): the strip still happens');
{
  rules = []; calls = []; witness.reset();
  const stored = storedRule('undefined', ACCOUNT);
  let reads = 0;
  rulesProvider = () => { reads++; return reads >= 2 ? [stored] : []; };
  let err = null;
  try { await createTool.call({ ...baseCreate, account: ACCOUNT }); } catch (e) { err = e; }
  rulesProvider = () => rules;
  check(err === null, 'create succeeds', String(err?.message ?? ''));
  check(reads === 2, 'the second read found the rule', `reads=${reads}`);
  check(updateRuleCalls().length === 1 && JSON.stringify(fieldsOf(updateRuleCalls()[0])) === JSON.stringify(['account', 'date', 'amount']), 'payee dropped after the late read', JSON.stringify(updateRuleCalls()[0]?.conditions));
}

console.log('\n[#547] rule not visible after update: the error says a retry is safe');
{
  const { err } = await run(updateTool, null, { id: SID, account: null });
  const msg = String(err?.message ?? '');
  check(err !== null && msg.includes(SID) && msg.includes('retrying actual_schedules_update { account: null } is safe'), 'throws with the update wording', msg);
  check(err !== null && isRetryableError(err) === false, 'not classed transient', msg);
}

console.log('\n[#547] update { payee: null }: the literal "null" is dropped after the schedule write');
{
  const { err, out } = await run(updateTool, storedRule('null', ACCOUNT), { id: SID, payee: null });
  check(err === null && out?.success === true, 'update succeeds', String(err?.message ?? err));
  const ups = updateRuleCalls();
  check(ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['account', 'date', 'amount']), 'payee dropped, the rest kept', JSON.stringify(ups[0]?.conditions));
  check(names().indexOf('updateSchedule') < names().indexOf('getRules'), 'the rule is read AFTER rawUpdateSchedule');
  check(witness.sharedOneCycle(), 'the rule read and write shared the drain of the update', witness.describe());
}

console.log('\n[#547] update { payee: null } on an ALREADY stripped schedule: upstream pushes a fresh "null" condition, dropped again');
{
  // Upstream api/schedule-update: an existing condition takes the raw value, a MISSING one is
  // pushed as String(value). After one strip there is no payee condition, so a second clear
  // re-adds the literal "null". The strip must run on every clear, not only the first.
  const { err } = await run(updateTool, storedRule('null', ACCOUNT), { id: SID, payee: null });
  const ups = updateRuleCalls();
  check(err === null && ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['account', 'date', 'amount']), 'the re-added "null" payee condition is dropped', JSON.stringify(ups[0]?.conditions ?? err?.message));
  const r2 = await run(updateTool, storedRule(null, ACCOUNT), { id: SID, payee: null });
  check(r2.err === null && updateRuleCalls().length === 1, 'a raw null stored by upstream (existing condition path) is dropped too');
}

console.log('\n[#547] update { account: null }: the account condition is dropped');
{
  const { err } = await run(updateTool, storedRule(PAYEE, 'null'), { id: SID, account: null });
  const ups = updateRuleCalls();
  check(err === null && ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['payee', 'date', 'amount']), 'account dropped', JSON.stringify(ups[0]?.conditions ?? err?.message));
}

console.log('\n[#547] legacy repair: update { payee: null } also drops a dead ACCOUNT condition left by an older create');
{
  // Review round 1 LOW 1: a schedule created before the fix with a payee and no account carries
  // `account is "undefined"`. The prescribed repair sends only payee; both dead conditions go.
  const { err } = await run(updateTool, storedRule('null', 'undefined'), { id: SID, payee: null });
  const ups = updateRuleCalls();
  check(err === null && ups.length === 1 && JSON.stringify(fieldsOf(ups[0])) === JSON.stringify(['date', 'amount']), 'both dead link conditions dropped in one rule write', JSON.stringify(ups[0]?.conditions ?? err?.message));
  // The stub does not emulate upstream's own payee rewrite, so a real payee id stays stored:
  // it must survive (a real id is never dead) while the dead account condition still goes.
  const r2 = await run(updateTool, storedRule(PAYEE, 'undefined'), { id: SID, payee: null });
  check(r2.err === null && JSON.stringify(fieldsOf(updateRuleCalls()[0] ?? { conditions: [] })) === JSON.stringify(['payee', 'date', 'amount']), 'a stored real payee id is kept while the dead account condition is dropped', JSON.stringify(updateRuleCalls()[0]?.conditions));
}

console.log('\n[#547] the rule rewrite fails: the error still says the schedule exists and is not transient');
{
  // Review round 1 LOW 2: a client that sees a bare upstream error retries the create and makes
  // a duplicate. The strip wraps both raw calls with the same contract as the poll expiry.
  updateRuleProvider = async () => { throw new Error('ECONNRESET'); };
  const { err } = await run(createTool, storedRule('undefined', ACCOUNT), { ...baseCreate, account: ACCOUNT });
  updateRuleProvider = async () => {};
  const msg = String(err?.message ?? '');
  check(err !== null && msg.includes(SID) && msg.includes('do not create it again'), 'throws with the EXISTS contract', msg);
  check(err !== null && isRetryableError(err) === false && !msg.includes('ECONNRESET'), 'the upstream text stays out of the message, so the pooled connection is kept', msg);
  check(err?.cause?.message === 'ECONNRESET', 'the upstream error is the cause');
  rulesProvider = () => { throw new Error('socket hang up'); };
  const r2 = await run(updateTool, storedRule('null', ACCOUNT), { id: SID, payee: null });
  rulesProvider = () => rules;
  const m2 = String(r2.err?.message ?? '');
  check(r2.err !== null && m2.includes('retrying actual_schedules_update { payee: null } is safe') && isRetryableError(r2.err) === false, 'a failed read-back gets the update wording and is not transient', m2);
}

console.log('\n[#547] update with a real payee id, or without payee: no rule read, no rule write');
{
  let r = await run(updateTool, storedRule(PAYEE, ACCOUNT), { id: SID, payee: PAYEE });
  check(r.err === null && JSON.stringify(names()) === JSON.stringify(['updateSchedule']), 'payee set to an id: only updateSchedule', names().join(','));
  r = await run(updateTool, storedRule(PAYEE, ACCOUNT), { id: SID, name: 'renamed' });
  check(r.err === null && JSON.stringify(names()) === JSON.stringify(['updateSchedule']), 'payee not supplied: only updateSchedule', names().join(','));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll schedules dead-condition checks passed');
process.exit(0);
