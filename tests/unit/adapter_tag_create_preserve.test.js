// tests/unit/adapter_tag_create_preserve.test.js
// #700: upstream createTag on an existing name overwrites colour and description with null
// unless they are supplied. adapter.createTag therefore lists the tags inside its own write
// cycle and fills each OMITTED field from the live row with exactly that name. Drives the
// REAL adapter.createTag with RAW api stubs (installed before the adapter import, session
// disarmed), because the fill lives in the adapter and stubbing the adapter would stub it away.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/adapter_tag_create_preserve.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import { makeCycleWitness } from './helpers/write-cycle.mjs';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const TID = '50000000-0000-4000-8000-000000000001';

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
let witness = null;
let stored = [];          // what getTags returns (live rows only, as upstream does)
let created = [];         // every payload the raw create received
let listCalls = 0;
let createFailures = 0;   // how many raw creates fail (retryable) before one succeeds
apiDefault.sync = async () => {};
apiDefault.getTags = async () => { listCalls++; witness?.noteRead(); return stored; };
apiDefault.createTag = async (payload) => {
  witness?.noteWrite();
  created.push(payload);
  if (createFailures > 0) { createFailures--; throw new Error('socket hang up'); }
  return TID;
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
witness = makeCycleWitness(adapterMod);
const adapter = adapterMod.default;

const run = async (payload) => {
  created = []; listCalls = 0; witness.reset();
  try { return { id: await adapter.createTag(payload), err: null }; } catch (err) { return { id: null, err }; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n[#700] a repeat create keeps what it does not supply');
{
  stored = [{ id: TID, tag: 'probe', color: '#33aa33', description: 'Food' }];
  let r = await run({ tag: 'probe' });
  check(!r.err && r.id === TID, '(a) a bare create on an existing name returns its id', String(r.err?.message));
  check(created.length === 1 && created[0].color === '#33aa33' && created[0].description === 'Food',
    '(a) the raw create receives the stored colour and description', JSON.stringify(created));
  check(witness.sharedOneCycle(), '(e) the listing and the create shared ONE write cycle', witness.describe());

  r = await run({ tag: 'probe', color: '#112233' });
  check(!r.err && created[0].color === '#112233' && created[0].description === 'Food',
    '(b) a supplied colour wins and the description is kept', JSON.stringify(created));

  r = await run({ tag: 'probe', description: '' });
  check(!r.err && created[0].description === '' && created[0].color === '#33aa33',
    '(c) an explicit empty description replaces the stored one, the colour is kept', JSON.stringify(created));

  r = await run({ tag: 'probe', color: '#445566', description: 'New' });
  check(!r.err && same(created[0], { tag: 'probe', color: '#445566', description: 'New' }),
    'both fields supplied: passed through unchanged', JSON.stringify(created));
}

console.log('\n[#700] names that do not match a live row are untouched');
{
  stored = [{ id: TID, tag: 'probe', color: '#33aa33', description: 'Food' }];
  let r = await run({ tag: 'other' });
  check(!r.err && same(created[0], { tag: 'other' }), '(d) an unlisted name passes through with no added keys', JSON.stringify(created));

  r = await run({ tag: 'Probe' });
  check(!r.err && same(created[0], { tag: 'Probe' }), 'the name match is exact: a different case is another tag', JSON.stringify(created));

  stored = [];
  r = await run({ tag: 'probe' });
  check(!r.err && same(created[0], { tag: 'probe' }), 'an empty listing adds no keys (a deleted name is never listed; the E2E revive test covers the real one)', JSON.stringify(created));

  stored = [{ id: TID, tag: 'bare', color: null, description: null }];
  r = await run({ tag: 'bare' });
  check(!r.err && same(created[0], { tag: 'bare' }), 'an existing row with no colour or description adds no keys', JSON.stringify(created));
}

console.log('\n[#700] the caller object and the retry');
{
  stored = [{ id: TID, tag: 'probe', color: '#33aa33', description: 'Food' }];
  const input = { tag: 'probe' };
  const r = await run(input);
  check(!r.err && same(input, { tag: 'probe' }), 'the caller\'s object is not mutated');

  createFailures = 1;
  const r2 = await run({ tag: 'probe' });
  check(!r2.err && created.length === 2 && listCalls === 1,
    'a retried raw create does not list again', `creates=${created.length} lists=${listCalls} err=${r2.err?.message}`);
  check(created.every((p) => p.color === '#33aa33' && p.description === 'Food'), 'and every attempt carries the stored values', JSON.stringify(created));
  createFailures = 0;
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll tag create preserve checks passed');
process.exit(0);
