// tests/unit/internal_send_seam.test.js
//
// #841: the internal-send seam in actual-adapter.ts. The seam is the only code that may touch
// upstream's internal handler bus, so these cases pin its three promises:
//   1. a name outside the allow-list is refused BEFORE anything is sent, even when a test double
//      has replaced the sending function (the check is not part of the replaceable part),
//   2. every allowed name does reach the sending function, with its arguments unchanged,
//   3. an abandoned operation (#800) cannot send, and the real bus is reported unavailable when
//      no budget session is open (this harness never opens one).
//
// Run via: npm run test:unit-js
// Or: node tests/unit/internal_send_seam.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const { internalSend, _setInternalSendForTests } = adapterMod;
const { runAbandonable, OperationAbandonedError } = await import('../../dist/src/lib/opTimeout.js');

const ALLOWED = [
  'budget/check-templates',
  'budget/apply-goal-template',
  'budget/overwrite-goal-template',
  'budget/apply-single-template',
  'budget/cleanup-goal-template',
  'budget/set-category-automations',
];
const rejected = (name) => `Internal handler "${name}" is not on this server's allow-list.`;

const sent = [];
_setInternalSendForTests(async (name, args) => { sent.push({ name, args }); return { message: 'ok' }; });

console.log('\n[#841] each allowed handler reaches the sending function with its arguments');
for (const name of ALLOWED) {
  sent.length = 0;
  const args = { month: '2026-11' };
  const reply = await internalSend(name, args);
  check(sent.length === 1 && sent[0].name === name && sent[0].args === args, `${name} is sent once, arguments untouched`);
  check(reply?.message === 'ok', `${name} returns what the bus replied`);
}

console.log('\n[#841] NEGATIVE: any other name is refused before the sending function runs');
for (const name of ['budget/set-budget', 'sync', 'close-budget', 'budget/apply-goal-template ', 'BUDGET/apply-goal-template', '', '__proto__', 'budget/apply-single-template/../x']) {
  sent.length = 0;
  const err = await internalSend(name, {}).then(() => null, (e) => e);
  check(err instanceof Error && err.message === rejected(name), `refused with the exact message: ${JSON.stringify(name)}`, String(err?.message));
  check(sent.length === 0, `nothing was sent for ${JSON.stringify(name)}`);
}

console.log('\n[#841] an abandoned operation cannot send (#800)');
{
  sent.length = 0;
  let late = null;
  const run = runAbandonable(async () => {
    await new Promise((r) => setTimeout(r, 120));
    late = await internalSend('budget/apply-goal-template', { month: '2026-11' }).then(() => null, (e) => e);
  }, 'seam test', 30);
  const timedOut = await run.then(() => null, (e) => e);
  await new Promise((r) => setTimeout(r, 200));
  check(timedOut instanceof Error && /timed out/.test(timedOut.message), 'the bounded operation timed out');
  check(late instanceof OperationAbandonedError, 'the late send was refused as abandoned', String(late?.message));
  check(sent.length === 0, 'and nothing reached the bus');
}

console.log('\n[#841] with no budget session the real bus is reported unavailable');
{
  _setInternalSendForTests();
  const err = await internalSend('budget/check-templates').then(() => null, (e) => e);
  check(err instanceof Error && err.message === "Actual's internal handler bus is unavailable: no budget session is open.", 'exact message', String(err?.message));
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
