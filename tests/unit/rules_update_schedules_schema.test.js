// tests/unit/rules_update_schedules_schema.test.js
//
// #486: the input schemas of actual_rules_update, actual_schedules_create and
// actual_schedules_update had no dedicated unit test, and #486 rewrote their describe
// text. This pins what each still ACCEPTS and REJECTS (Zod code and path), so a trim that
// loosens a constraint is red. The sibling cases for rules_create and
// rules_create_or_update live in their own test files.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_update_schedules_schema.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const ACC = '22222222-2222-2222-2222-222222222222';
const RID = '33333333-3333-3333-3333-333333333333';

const rulesUpdate = (await import('../../dist/src/tools/rules_update.js')).default;
const schedulesCreate = (await import('../../dist/src/tools/schedules_create.js')).default;
const schedulesUpdate = (await import('../../dist/src/tools/schedules_update.js')).default;

const where = (tool, input) => {
  const r = tool.inputSchema.safeParse(input);
  return r.success ? { ok: true, data: r.data, issues: [] } : { ok: false, data: null, issues: r.error.issues.map((i) => `${i.code} at ${i.path.join('.')}`) };
};
const rejectedWith = (tool, input, issue) => {
  const r = where(tool, input);
  return !r.ok && r.issues.length === 1 && r.issues[0] === issue;
};

console.log('\n[#486] rules_update: op stays REQUIRED on every action (the shared ActionSchema defaults it)');
{
  const r = where(rulesUpdate, { id: RID, fields: { actions: [{ field: 'notes', value: 'x' }] } });
  check(!r.ok && r.issues.includes('invalid_type at fields.actions.0.op'), 'an action without op is invalid_type at fields.actions.0.op', r.issues.join(','));
  const ok = where(rulesUpdate, { id: RID, fields: { actions: [{ op: 'set', field: 'notes', value: 'x' }] } });
  check(ok.ok, 'an action with op parses', ok.issues.join(','));
  check(ok.ok && ok.data.fields.actions[0].op === 'set', 'op is carried through as given');
}

console.log('\n[#486] rules_update: other constraints');
{
  check(rejectedWith(rulesUpdate, { id: 'not-a-uuid', fields: {} }, 'invalid_format at id'), 'a non-uuid rule id is invalid_format at id');
  check(rejectedWith(rulesUpdate, { id: RID }, 'invalid_type at fields'), 'fields is required');
  check(rejectedWith(rulesUpdate, { id: RID, fields: { stage: 'default' } }, 'invalid_value at fields.stage'), 'stage "default" is invalid_value at fields.stage');
  check(rejectedWith(rulesUpdate, { id: RID, fields: { conditionsOp: 'xor' } }, 'invalid_value at fields.conditionsOp'), 'conditionsOp "xor" is invalid_value');
  const noStage = where(rulesUpdate, { id: RID, fields: { conditionsOp: 'or' } });
  check(noStage.ok && !('stage' in noStage.data.fields), 'omitting stage leaves no stage key (partial update)');
  const nul = where(rulesUpdate, { id: RID, fields: { stage: null } });
  check(nul.ok && nul.data.fields.stage === null, 'stage null is kept');
  check(rejectedWith(rulesUpdate, { id: RID, fields: { conditions: [{ field: 'notes', op: 'is' }] } }, 'invalid_union at fields.conditions.0.value'), 'a condition without value is rejected');
}

console.log('\n[#486] schedules_create: date and amount constraints');
{
  const base = { name: 'MCP-Schedule', account: ACC, amount: 100, date: '2026-01-05' };
  check(where(schedulesCreate, base).ok, 'a one-off schedule parses');
  const bad = where(schedulesCreate, { ...base, date: '2026-1-5' });
  check(!bad.ok && bad.issues.some((i) => i.startsWith('invalid_format at date')), 'date 2026-1-5 is invalid_format at date', bad.issues.join(','));
  check(rejectedWith(schedulesCreate, { ...base, amount: 12.5 }, 'invalid_type at amount'), 'amount 12.5 is invalid_type at amount');
  check(!where(schedulesCreate, { name: 'x', amount: 100 }).ok, 'date is required');
  check(!where(schedulesCreate, { ...base, amountOp: 'between' }).ok, 'an unknown amountOp is rejected');
  check(!where(schedulesCreate, { ...base, account: 'not-a-uuid' }).ok, 'a non-uuid account is rejected');
  const rec = where(schedulesCreate, { ...base, date: { frequency: 'monthly', start: '2026-01-05', endMode: 'never' } });
  check(rec.ok, 'a RecurConfig date parses');
  const badRec = where(schedulesCreate, { ...base, date: { frequency: 'hourly', start: '2026-01-05', endMode: 'never' } });
  check(!badRec.ok, 'a RecurConfig with an unknown frequency is rejected');
  const defaults = where(schedulesCreate, base);
  check(defaults.ok && defaults.data.amountOp === 'is' && defaults.data.posts_transaction === false, 'amountOp defaults to is and posts_transaction to false');
}

console.log('\n[#486] schedules_update: constraints');
{
  const SID = '44444444-4444-4444-4444-444444444444';
  check(where(schedulesUpdate, { id: SID, name: 'x' }).ok, 'a partial update parses');
  check(!where(schedulesUpdate, { name: 'x' }).ok, 'id is required');
  check(!where(schedulesUpdate, { id: SID, date: '2026-1-5' }).ok, 'date 2026-1-5 is rejected');
  check(rejectedWith(schedulesUpdate, { id: SID, amount: 12.5 }, 'invalid_type at amount'), 'amount 12.5 is invalid_type at amount');
  const nulls = where(schedulesUpdate, { id: SID, payee: null, account: null });
  check(nulls.ok && nulls.data.payee === null && nulls.data.account === null, 'payee and account accept null (clear)');
  const d = where(schedulesUpdate, { id: SID });
  check(d.ok && d.data.resetNextDate === false, 'resetNextDate defaults to false');
  check(!where(schedulesUpdate, { id: SID, amountOp: 'between' }).ok, 'an unknown amountOp is rejected');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_update / schedules schema checks passed');
process.exit(0);
