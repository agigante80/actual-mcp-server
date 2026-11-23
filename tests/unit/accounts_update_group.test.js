// tests/unit/accounts_update_group.test.js
// #816: account update accepts account_group_id (a group id, or null to ungroup). The guard that
// refuses an unknown group lives in the adapter, in the same write cycle as the update, so this
// test runs the REAL adapter.updateAccount with raw api stubs installed before the adapter import
// (it destructures them at module load).

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'dummy';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = apiMod.default || apiMod;
  const ACCOUNT = '123e4567-e89b-42d3-a456-426614174000';
  const GROUP = '123e4567-e89b-42d3-a456-4266141740bb';
  const GHOST = '00000000-0000-4000-8000-0000000000ff';
  let groupReads = 0;
  let writes = [];
  api.sync = async () => {};
  api.getAccounts = async () => [{ id: ACCOUNT, name: 'Checking', closed: false }];
  api.getAccountGroups = async () => { groupReads++; return [{ id: GROUP, name: 'G' }]; };
  api.updateAccount = async (id, fields) => { writes.push({ id, fields }); };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  adapterMod._setSkipApiInitForTests(true);
  const adapter = adapterMod.default;
  const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
  const tool = (await import('../../dist/src/tools/accounts_update.js')).default;

  console.log('\n[#816] adapter guard');
  {
    groupReads = 0; writes = [];
    await adapter.updateAccount(ACCOUNT, { account_group_id: GROUP });
    check(writes.length === 1 && writes[0].fields.account_group_id === GROUP, 'a known group reaches the raw write');
    check(groupReads === 1, 'the groups listing was read once');
  }
  {
    groupReads = 0; writes = [];
    await adapter.updateAccount(ACCOUNT, { account_group_id: null });
    check(writes.length === 1 && writes[0].fields.account_group_id === null, 'null ungroups and reaches the raw write');
    check(groupReads === 0, 'null makes no groups read');
  }
  {
    groupReads = 0; writes = [];
    let e;
    try { await adapter.updateAccount(ACCOUNT, { account_group_id: GHOST }); } catch (x) { e = x; }
    check(!!e && isPreflightRefusal(e), 'an unknown group is a typed refusal');
    check(!!e && /Account group/.test(e.message) && /not found/i.test(e.message) && e.message.includes(GHOST), 'message names the group and the id', e?.message);
    check(!!e && e.message.includes('actual_account_groups_list'), 'message names the listing tool');
    check(writes.length === 0, 'nothing was written');
  }
  {
    groupReads = 0; writes = [];
    await adapter.updateAccount(ACCOUNT, { name: 'Renamed' });
    check(groupReads === 0, 'an update without account_group_id makes no groups read');
  }

  console.log('\n[#816] legacy tool');
  {
    writes = [];
    const res = await tool.call({ id: ACCOUNT, fields: { account_group_id: GROUP } });
    check(res?.success === true && res.updatedFields.includes('account_group_id'), 'account_group_id alone is not a "No fields provided" refusal');
    writes = [];
    const res2 = await tool.call({ id: ACCOUNT, fields: { account_group_id: null } });
    check(res2?.success === true && writes[0]?.fields?.account_group_id === null, 'null alone is a provided field');
  }
  {
    writes = [];
    let e;
    try { await tool.call({ id: ACCOUNT, fields: { account_group_id: 'not-a-uuid' } }); } catch (x) { e = x; }
    check(!!e && /account_group_id/.test(String(e.message)), 'a malformed group id is refused naming the field', e?.message);
    check(writes.length === 0, 'and nothing was written');
    let e2;
    try { await tool.call({ id: ACCOUNT, fields: {} }); } catch (x) { e2 = x; }
    check(!!e2 && /account_group_id/.test(e2.message), 'the empty-update message lists account_group_id', e2?.message);
  }

  console.log('');
  if (failures === 0) console.log('[accounts-update-group] All tests passed');
  else { console.error(`[accounts-update-group] ${failures} test(s) FAILED`); process.exit(2); }
})();
