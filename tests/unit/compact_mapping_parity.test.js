// tests/unit/compact_mapping_parity.test.js
//
// #671: every legacy tool must be accounted for by the compact layer, so the day the compact
// surface becomes the default no capability has silently disappeared. A legacy tool is, in
// exactly one place, one of:
//   - MAPPED: some compact row's `legacy`, or one of its routes' `legacy`, names it;
//   - OUT_OF_SCOPE: deliberately never exposed through a compact tool (the session tools
//     manage the pool itself, see CLAUDE.md "Session tools are the only exception");
//   - PENDING: waiting for its compact tool (#673 onward). Each ticket that maps a tool MUST
//     delete it from PENDING in the same commit; a name both mapped and pending fails.
//
// #672 loosened "mapped exactly once" to "belongs to exactly one compact tool": a legacy tool
// may be the target of several rows or routes of the SAME compact tool (actual_entities_search
// and actual_get_id_by_name serve every list_entities type) but never of two compact tools.
//
// The check is defined here, then run twice: on the real registry, and on fixtures that
// prove it can fail (it must name the missing tool).
//
// Run: node tests/unit/compact_mapping_parity.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[compact-mapping-parity]');

const OUT_OF_SCOPE = ['actual_session_list', 'actual_session_close'];

const PENDING = [
  'actual_account_groups_create',
  'actual_account_groups_delete',
  'actual_account_groups_update',
  'actual_accounts_close',
  'actual_accounts_create',
  'actual_accounts_delete',
  'actual_accounts_reopen',
  'actual_accounts_update',
  'actual_bank_sync',
  'actual_budget_updates_batch',
  'actual_budgets_export',
  'actual_budgets_hold_for_next_month',
  'actual_budgets_import',
  'actual_budgets_reset_hold',
  'actual_budgets_set_amount',
  'actual_budgets_set_carryover',
  'actual_budgets_switch',
  'actual_budgets_transfer',
  'actual_categories_create',
  'actual_categories_delete',
  'actual_categories_update',
  'actual_category_groups_create',
  'actual_category_groups_delete',
  'actual_category_groups_update',
  'actual_notes_update',
  'actual_payees_create',
  'actual_payees_delete',
  'actual_payees_merge',
  'actual_payees_update',
  'actual_rules_create',
  'actual_rules_create_batch',
  'actual_rules_create_or_update',
  'actual_rules_delete',
  'actual_rules_update',
  'actual_schedules_create',
  'actual_schedules_delete',
  'actual_schedules_update',
  'actual_tags_create',
  'actual_tags_delete',
  'actual_tags_update',
];

/** Returns the list of problems (empty means parity holds). */
function parityProblems({ legacyNames, compactTools, outOfScope, pending }) {
  const problems = [];
  const legacy = new Set(legacyNames);
  const mapped = new Map(); // legacy name -> the one compact tool that owns it
  for (const spec of compactTools) {
    for (const [action, row] of spec.actions) {
      const targets = [row, ...(row.routes ?? [])];
      for (const t of targets) {
        const where = `${spec.name}.${action}`;
        if (!legacy.has(t.legacy)) problems.push(`${where} maps to unregistered tool ${t.legacy}`);
        const owner = mapped.get(t.legacy);
        if (owner !== undefined && owner !== spec.name) problems.push(`${t.legacy} is mapped twice: ${owner} and ${spec.name}`);
        mapped.set(t.legacy, owner ?? spec.name);
      }
    }
  }
  const out = new Set(outOfScope);
  const pend = new Set(pending);
  for (const n of legacyNames) {
    const places = [mapped.has(n) && 'mapped', out.has(n) && 'out of scope', pend.has(n) && 'pending'].filter(Boolean);
    if (places.length === 0) problems.push(`${n} is not mapped, out of scope or pending`);
    if (places.length > 1) problems.push(`${n} is in more than one place: ${places.join(' and ')}`);
  }
  for (const n of [...out, ...pend]) if (!legacy.has(n)) problems.push(`${n} is listed but is not a registered tool`);
  return problems;
}

const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
await manager.initialize();
const legacyNames = manager.getToolNames();
const { z } = await import('zod');

await check('the real registry accounts for every legacy tool exactly once', () => {
  const problems = parityProblems({ legacyNames, compactTools: COMPACT_TOOLS, outOfScope: OUT_OF_SCOPE, pending: PENDING });
  assert.deepStrictEqual(problems, []);
});

// Fixture runs replace the shipped registry, so the tools it maps are pending again.
const SHIPPED_MAPPED = COMPACT_TOOLS.flatMap((t) => [...t.actions.values()].flatMap((r) => [r.legacy, ...(r.routes ?? []).map((x) => x.legacy)]));
const FX_PENDING = [...new Set([...PENDING, ...SHIPPED_MAPPED])];

const row = (legacy) => ({ legacy, fields: z.object({}) });
const fixture = (legacy) => [{ name: 'actual_fx', actions: new Map(legacy.map((l, i) => [`a${i}`, row(l)])) }];
const without = (list, n) => list.filter((x) => x !== n);

await check('NEGATIVE: a legacy tool that is nowhere is reported by name', () => {
  const problems = parityProblems({ legacyNames, compactTools: [], outOfScope: OUT_OF_SCOPE, pending: without(FX_PENDING, 'actual_accounts_list') });
  assert.deepStrictEqual(problems, ['actual_accounts_list is not mapped, out of scope or pending']);
});

await check('NEGATIVE: a tool both mapped and still pending is reported', () => {
  const problems = parityProblems({ legacyNames, compactTools: fixture(['actual_accounts_list']), outOfScope: OUT_OF_SCOPE, pending: FX_PENDING });
  assert.deepStrictEqual(problems, ['actual_accounts_list is in more than one place: mapped and pending']);
});

await check('NEGATIVE: a tool mapped by two different compact tools is reported', () => {
  const specs = [
    { name: 'actual_fx', actions: new Map([['a', row('actual_accounts_list')]]) },
    { name: 'actual_fy', actions: new Map([['a', row('actual_accounts_list')]]) },
  ];
  const problems = parityProblems({ legacyNames, compactTools: specs, outOfScope: OUT_OF_SCOPE, pending: without(FX_PENDING, 'actual_accounts_list') });
  assert.ok(problems.some((p) => /actual_accounts_list is mapped twice: actual_fx and actual_fy/.test(p)), problems.join('; '));
});

await check('one compact tool may map a legacy tool from several rows and routes (counted once)', () => {
  const specs = [{
    name: 'actual_fx',
    actions: new Map([
      ['a', { ...row('actual_accounts_list'), routes: [{ ...row('actual_entities_search'), triggers: ['q'] }] }],
      ['b', { ...row('actual_tags_list'), routes: [{ ...row('actual_entities_search'), triggers: ['q'] }] }],
    ]),
  }];
  const pending = FX_PENDING.filter((n) => !['actual_accounts_list', 'actual_tags_list', 'actual_entities_search'].includes(n));
  assert.deepStrictEqual(parityProblems({ legacyNames, compactTools: specs, outOfScope: OUT_OF_SCOPE, pending }), []);
});

await check('NEGATIVE: a route naming an unregistered tool is reported', () => {
  const specs = [{ name: 'actual_fx', actions: new Map([['a', { ...row('actual_accounts_list'), routes: [{ ...row('actual_nope_nothing'), triggers: ['q'] }] }]]) }];
  const problems = parityProblems({ legacyNames, compactTools: specs, outOfScope: OUT_OF_SCOPE, pending: without(FX_PENDING, 'actual_accounts_list') });
  assert.ok(problems.some((p) => /actual_nope_nothing/.test(p)), problems.join('; '));
});

await check('shipped: entities_search and get_id_by_name are counted once, under list_entities', () => {
  const owners = (name) => COMPACT_TOOLS.filter((t) => [...t.actions.values()].some((r) => r.legacy === name || (r.routes ?? []).some((x) => x.legacy === name))).map((t) => t.name);
  assert.deepStrictEqual(owners('actual_entities_search'), ['list_entities']);
  assert.deepStrictEqual(owners('actual_get_id_by_name'), ['list_entities']);
  assert.ok(!PENDING.includes('actual_entities_search') && !PENDING.includes('actual_get_id_by_name'));
});

await check('NEGATIVE: an action naming a tool that is not registered is reported', () => {
  const problems = parityProblems({ legacyNames, compactTools: fixture(['actual_nope_nothing']), outOfScope: OUT_OF_SCOPE, pending: FX_PENDING });
  assert.ok(problems.some((p) => /actual_nope_nothing/.test(p)), problems.join('; '));
});

await check('NEGATIVE: a stale pending entry for a tool that no longer exists is reported', () => {
  const problems = parityProblems({ legacyNames, compactTools: [], outOfScope: OUT_OF_SCOPE, pending: [...FX_PENDING, 'actual_gone_tool'] });
  assert.deepStrictEqual(problems, ['actual_gone_tool is listed but is not a registered tool']);
});

console.log(`\n[compact-mapping-parity] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
