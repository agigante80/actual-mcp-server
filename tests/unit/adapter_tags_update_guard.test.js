// tests/unit/adapter_tags_update_guard.test.js
// #701: a rename onto a name another tag already has used to surface the raw upstream
// `SyncError: invalid-schema`. adapter.updateTag now refuses it with a typed ConflictRefusal:
// before the write when a LIVE tag has the name (the listing shows it), and by recognising the
// UNIQUE failure of the raw update when a DELETED tag has it (getTags never lists those).
// Drives the REAL adapter.updateTag with RAW api stubs (installed before the adapter import,
// session disarmed), because the guard lives in the adapter.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/adapter_tags_update_guard.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const A = '50000000-0000-4000-8000-00000000000a';
const B = '50000000-0000-4000-8000-00000000000b';
const UNKNOWN = '50000000-0000-4000-8000-0000000000ff';

// The shape upstream throws for any failed local write (probed on @actual-app/api 26.11.0).
const syncError = (message) => Object.assign(new Error('SyncError: invalid-schema'), { reason: 'invalid-schema', meta: { error: { message, stack: '' }, query: {} } });

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
const stored = [{ id: A, tag: 'alpha', color: null, description: null }, { id: B, tag: 'beta', color: null, description: null }];
let updates = [];        // every (id, fields) the raw update received
let rawRejection = null; // what the raw update throws, when set
apiDefault.sync = async () => {};
apiDefault.getTags = async () => stored;
apiDefault.updateTag = async (id, fields) => { updates.push({ id, fields }); if (rawRejection) throw rawRejection; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const errors = await import('../../dist/src/lib/errors.js');
const { isPreflightRefusal, NotFoundRefusal, ConflictRefusal } = errors;

const run = async (id, fields, rejection = null) => {
  updates = []; rawRejection = rejection;
  try { await adapter.updateTag(id, fields); return null; } catch (err) { return err; } finally { rawRejection = null; }
};
const isConflict = (err) => typeof ConflictRefusal === 'function' && err instanceof ConflictRefusal;

console.log('\n[#701] a rename onto a live tag name is refused before the write');
{
  const err = await run(B, { tag: 'alpha' });
  check(isConflict(err), 'rejects with ConflictRefusal', String(err?.constructor?.name) + ': ' + String(err?.message));
  check(err?.refusalKind === 'conflict' && isPreflightRefusal(err), 'refusalKind is conflict and isPreflightRefusal is true', String(err?.refusalKind));
  check(/already exists/i.test(err?.message ?? '') && err.message.includes('alpha') && err.message.includes(A),
    'the message names the existing tag and its id', String(err?.message));
  check(!/SyncError/.test(err?.message ?? ''), 'no raw SyncError text', String(err?.message));
  check(updates.length === 0, 'the raw update was never called', JSON.stringify(updates));

  const err2 = await run(B, { tag: 'alpha' }, syncError('UNIQUE constraint failed: tags.tag'));
  check(isConflict(err2) && /already exists/i.test(err2.message) && updates.length === 0,
    'the listing check wins over a raw update that would also fail', String(err2?.message));
}

console.log('\n[#701] renames that are not a conflict pass through');
{
  let err = await run(B, { tag: 'beta', color: '#112233' });
  check(!err && updates.length === 1 && updates[0].id === B, 'a rename to its own name (with a new colour) writes once', String(err?.message));

  err = await run(B, { tag: 'Alpha' });
  check(!err && updates.length === 1, 'the name match is exact: a different case is not a conflict', String(err?.message));

  err = await run(B, { tag: 'delta' });
  check(!err && updates.length === 1 && updates[0].fields.tag === 'delta', 'a rename to a free name writes once', String(err?.message));

  err = await run(B, { color: '#112233' });
  check(!err && updates.length === 1, 'an update without a name is not name-checked', String(err?.message));
}

console.log('\n[#701] a rename onto a DELETED tag name: the upstream UNIQUE failure becomes a refusal');
{
  const err = await run(B, { tag: 'gamma' }, syncError('UNIQUE constraint failed: tags.tag'));
  check(isConflict(err) && err.refusalKind === 'conflict', 'rejects with ConflictRefusal', String(err?.constructor?.name) + ': ' + String(err?.message));
  check(/deleted tag/i.test(err?.message ?? '') && err.message.includes('gamma') && !/SyncError/.test(err.message),
    'the message says the name belongs to a deleted tag, with no SyncError text', String(err?.message));
  check(updates.length === 1, 'the raw update ran once (no retry)', JSON.stringify(updates));
}

console.log('\n[#701] every other rejection propagates untouched');
{
  const unique = syncError('UNIQUE constraint failed: tags.tag');
  let err = await run(B, { color: '#112233' }, unique);
  check(err === unique, 'a UNIQUE failure on an update that names no tag is not converted', String(err?.constructor?.name));

  const other = syncError('no such column: tags.colour');
  err = await run(B, { tag: 'gamma' }, other);
  check(err === other, 'an invalid-schema failure that is not UNIQUE is not converted', String(err?.constructor?.name));

  const noMeta = Object.assign(new Error('SyncError: invalid-schema'), { reason: 'invalid-schema' });
  err = await run(B, { tag: 'gamma' }, noMeta);
  check(err === noMeta, 'an invalid-schema failure with no meta is not converted', String(err?.constructor?.name));

  const plain = new Error('boom');
  err = await run(B, { tag: 'gamma' }, plain);
  check(err === plain, 'an unrelated error is not converted', String(err?.constructor?.name));

  err = await run(UNKNOWN, { tag: 'alpha' });
  check(err instanceof NotFoundRefusal && updates.length === 0, 'an unknown id is still a NotFoundRefusal, checked before the name', String(err?.constructor?.name));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll tag update guard checks passed');
process.exit(0);
