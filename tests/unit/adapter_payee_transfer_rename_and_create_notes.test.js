// tests/unit/adapter_payee_transfer_rename_and_create_notes.test.js
// #765: adapter.updatePayee refuses a rename of a transfer payee (its name is its account's
// name, so the write changed nothing while reporting success), and adapter.createPayee stores
// the `notes` argument (upstream api/payee-create drops it) with a read-back.
//
// Run: node tests/unit/adapter_payee_transfer_rename_and_create_notes.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// A small op timeout bounds the read-back poll (half of it) so the failure rows stay fast.
process.env.ACTUAL_OP_TIMEOUT_MS = '600';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const TP = '20000000-0000-4000-8000-000000000001'; // transfer payee
const OP = '20000000-0000-4000-8000-000000000002'; // ordinary payee
const UNKNOWN = '20000000-0000-4000-8000-0000000000ff';
const ACCT = '30000000-0000-4000-8000-000000000001';
const CAT = '10000000-0000-4000-8000-000000000001';
const GROUP = '10000000-0000-4000-8000-0000000000a1';
const NEW_ID = '20000000-0000-4000-8000-0000000000aa';
const RENAME_REFUSAL =
  '"Checking" is a transfer payee: its name is its account\'s name, so it cannot be renamed here. Rename the account instead. Nothing was written.';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
let updatePayeeCalls = [];
let ruleWrites = 0;
let ruleReads = 0;
let createPayeeCalls = [];
let updateNoteCalls = [];
let getNoteCalls = 0;
let noteStore = new Map();
let noteMode = 'ok'; // ok | late | write-fails | never-visible
api.sync = async () => {};
api.getPayees = async () => [
  { id: TP, name: 'Checking', transfer_acct: ACCT },
  { id: OP, name: 'Ordinary', transfer_acct: null },
];
api.getCategories = async () => [{ id: CAT, name: 'C', group_id: GROUP }];
api.getCategoryGroups = async () => [{ id: GROUP, name: 'G', categories: [] }];
api.getAccounts = async () => [];
api.getPayeeRules = async () => { ruleReads++; return []; };
api.createRule = async () => { ruleWrites++; return 'new-rule-id'; };
api.updateRule = async () => { ruleWrites++; };
api.deleteRule = async () => { ruleWrites++; return true; };
api.updatePayee = async (id, f) => { updatePayeeCalls.push({ id, f }); };
api.createPayee = async (p) => { createPayeeCalls.push(p); return NEW_ID; };
api.updateNote = async (id, note) => {
  updateNoteCalls.push({ id, note });
  if (noteMode === 'write-fails') throw new Error('boom upstream');
  if (noteMode !== 'never-visible') noteStore.set(id, note);
};
let pollsBeforeVisible = 0;
api.getNote = async (id) => {
  getNoteCalls++;
  if (noteMode === 'late' && getNoteCalls <= pollsBeforeVisible) return null;
  if (noteMode === 'stalled') return new Promise(() => {});
  return noteStore.has(id) ? { id, note: noteStore.get(id) } : null;
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

console.log('\n[adapter-payee-transfer-rename-and-create-notes]');

function reset() {
  updatePayeeCalls = []; ruleWrites = 0; ruleReads = 0;
  createPayeeCalls = []; updateNoteCalls = []; getNoteCalls = 0; noteStore = new Map();
  noteMode = 'ok'; pollsBeforeVisible = 0;
}
async function attempt(fn) {
  reset();
  try { await fn(); } catch (e) { return e; }
  return null;
}

// --- rename guard ---
let e = await attempt(() => adapter.updatePayee(TP, { name: 'x' }));
check(e !== null, 'transfer payee rename: rejects');
check(e && isPreflightRefusal(e) && e.refusalKind === 'conflict', 'transfer payee rename: typed conflict refusal', e && String(e.refusalKind));
check(e && e.message === RENAME_REFUSAL, 'transfer payee rename: exact message', e && e.message);
check(updatePayeeCalls.length === 0 && ruleWrites === 0 && ruleReads === 0, 'transfer payee rename: nothing written, no rule touched');

e = await attempt(() => adapter.updatePayee(TP, { name: 'Checking' }));
check(e && isPreflightRefusal(e) && e.message === RENAME_REFUSAL, 'the current name is refused too');

e = await attempt(() => adapter.updatePayee(TP, { name: 'x', category: CAT }));
check(e && isPreflightRefusal(e) && e.message === RENAME_REFUSAL, 'name plus category: refused');
check(updatePayeeCalls.length === 0 && ruleWrites === 0 && ruleReads === 0, 'name plus category: neither written');

e = await attempt(() => adapter.updatePayee(TP, { category: CAT }));
check(e === null && updatePayeeCalls.length === 0 && ruleWrites === 1, 'category alone on a transfer payee still takes the rule path');

e = await attempt(() => adapter.updatePayee(OP, { name: 'renamed' }));
check(e === null && updatePayeeCalls.length === 1 && updatePayeeCalls[0].f.name === 'renamed', 'ordinary payee rename reaches the raw update once');

e = await attempt(() => adapter.updatePayee(UNKNOWN, { name: 'x' }));
check(e && isPreflightRefusal(e) && e.refusalKind === 'not-found', 'unknown id: still the not-found refusal', e && String(e.refusalKind));

// --- notes on create ---
e = await attempt(async () => {
  const id = await adapter.createPayee({ name: 'N1', notes: 'a note' });
  check(id === NEW_ID, 'create with notes returns the id');
});
check(e === null, 'create with notes: resolves', e && e.message);
check(createPayeeCalls.length === 1 && !('notes' in createPayeeCalls[0]) && createPayeeCalls[0].name === 'N1', 'rawCreatePayee receives no notes key');
check(updateNoteCalls.length === 1 && updateNoteCalls[0].id === NEW_ID && updateNoteCalls[0].note === 'a note', 'note written once for the new id');
check(getNoteCalls >= 1, 'note read back');

reset();
noteMode = 'late'; pollsBeforeVisible = 2;
try { await adapter.createPayee({ name: 'N2', notes: 'late note' }); check(getNoteCalls === 3, 'a late read-back is polled until visible', String(getNoteCalls)); }
catch (x) { check(false, 'a late read-back succeeds', x.message); }

for (const [label, arg] of [['empty notes', { name: 'N3', notes: '' }], ['absent notes', { name: 'N4' }]]) {
  e = await attempt(() => adapter.createPayee(arg));
  check(e === null && createPayeeCalls.length === 1 && updateNoteCalls.length === 0 && getNoteCalls === 0, `${label}: no note written or read`);
}

for (const mode of ['write-fails', 'never-visible', 'stalled']) {
  reset(); noteMode = mode;
  e = await attempt(() => { noteMode = mode; return adapter.createPayee({ name: 'Zed', notes: 'n' }); });
  noteMode = mode;
  check(e !== null && !isPreflightRefusal(e), `${mode}: plain error, not a refusal`);
  check(e && e.message.includes(NEW_ID) && e.message.includes('exists') && !e.message.includes('timed out'), `${mode}: names the id and says the payee exists`, e && e.message);
  // Legacy surface: the text names the legacy tool, never a compact action name.
  check(e && e.message.includes('actual_notes_update') && !e.message.includes('set_note'), `${mode}: legacy text names actual_notes_update`, e && e.message);
  // Compact surface: the dispatcher rewrites the legacy name to its compact phrase.
  const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
  const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
  const compact = buildCompactTool(COMPACT_TOOLS.find((t) => t.name === 'manage_payees'), { callOperation: async () => { throw e; } }, legacyPhrases(COMPACT_TOOLS));
  const ce = await attempt(() => compact.call({ action: 'create', name: 'Zed', notes: 'n' }));
  check(ce && !ce.message.includes('actual_notes_update') && /manage_payees with action set_note/.test(ce.message), `${mode}: compact text names the compact action`, ce && ce.message);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
