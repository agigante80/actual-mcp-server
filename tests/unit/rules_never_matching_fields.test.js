// tests/unit/rules_never_matching_fields.test.js
// #766: a rule condition on `transfer` or `parent` is refused by every rule writer, on both
// surfaces. Upstream's rule engine never sets those two fields on the transaction it evaluates,
// so Condition.eval is false under every operator and the rule is stored but inert. One check in
// assertConditionOperator covers actual_rules_create, _update, _create_or_update, _create_batch
// (through validateRuleInput) and the compact manage_rules tool (which forwards to them).
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_never_matching_fields.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const ID = '123e4567-e89b-42d3-a456-426614174000';
const ACT = { op: 'set', field: 'notes', value: 'x' };
const OK = { field: 'cleared', op: 'is', value: true };
const msg = (field) => `Condition field "${field}" never matches in a rule: Actual's rule engine does not set it on the transaction. To find such transactions, query transfer_id or is_parent instead. On an update, omit conditions to keep the stored ones. This rule was not written.`;

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
let writes = [];
adapter.createRule = async (r) => { writes.push(['createRule', r]); return 'rule-id'; };
adapter.updateRule = async (id, f) => { writes.push(['updateRule', id, f]); return null; };
adapter.upsertRule = async (r) => { writes.push(['upsertRule', r]); return { id: 'rule-id', created: true }; };
adapter.createRulesBatch = async (pass, total) => {
  writes.push(['createRulesBatch', pass]);
  return { succeeded: pass.map((p) => ({ index: p.index, id: `rule-${p.index}` })), failed: [], total };
};

const create = (await import('../../dist/src/tools/rules_create.js')).default;
const update = (await import('../../dist/src/tools/rules_update.js')).default;
const upsert = (await import('../../dist/src/tools/rules_create_or_update.js')).default;
const batch = (await import('../../dist/src/tools/rules_create_batch.js')).default;
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_rules');
const legacy = { actual_rules_create: create, actual_rules_update: update, actual_rules_create_or_update: upsert, actual_rules_create_batch: batch };
const compact = buildCompactTool(spec, { callOperation: async (name, args) => legacy[name].call(args) }, legacyPhrases(COMPACT_TOOLS));

const run = async (fn) => {
  writes = [];
  try { return { out: await fn(), message: '' }; } catch (e) { return { out: null, message: String(e?.message ?? e) }; }
};

const CASES = [];
for (const field of ['transfer', 'parent']) {
  for (const [op, value] of [['is', true], ['is', false], ['isNot', true], ['isNot', false]]) CASES.push({ field, op, value });
}

const surfaces = {
  'actual_rules_create': (c) => create.call({ conditions: [c], actions: [ACT] }),
  'actual_rules_update': (c) => update.call({ id: ID, fields: { conditions: [c] } }),
  'actual_rules_create_or_update': (c) => upsert.call({ conditions: [c], actions: [ACT] }),
  'manage_rules create': (c) => compact.call({ action: 'create', conditions: [c], actions: [ACT] }),
  'manage_rules upsert': (c) => compact.call({ action: 'upsert', conditions: [c], actions: [ACT] }),
  'manage_rules update': (c) => compact.call({ action: 'update', id: ID, conditions: [c] }),
};

for (const [name, fn] of Object.entries(surfaces)) {
  console.log(`\n[#766] ${name}: transfer and parent conditions are refused`);
  for (const c of CASES) {
    const r = await run(() => fn(c));
    check(r.message === msg(c.field) && writes.length === 0, `NEGATIVE: ${c.field} ${c.op} ${c.value} is refused with the exact message and nothing is written`, r.message);
  }
  const ok = await run(() => fn(OK));
  check(ok.message === '' && writes.length === 1, 'cleared is true still passes and is written once', ok.message);
}

console.log('\n[#766] actual_rules_create_batch: a bad item goes to failed, the good one is written');
for (const [name, call] of [
  ['legacy', (rules) => batch.call({ rules })],
  ['manage_rules create_batch', (rules) => compact.call({ action: 'create_batch', rules })],
]) {
  for (const field of ['transfer', 'parent']) {
    writes = [];
    const res0 = await call([
      { conditions: [OK], actions: [ACT] },
      { conditions: [{ field, op: 'is', value: true }], actions: [ACT] },
    ]);
    const res = res0.result ?? res0;
    check(res.successCount === 1 && res.failureCount === 1 && res.failed[0].index === 1 && res.failed[0].error === msg(field),
      `${name}: ${field} item is reported in failed with the exact message`, JSON.stringify(res));
    check(writes.length === 1 && writes[0][1].length === 1 && writes[0][1][0].index === 0, '  and only the good item reaches the adapter');
  }
}

console.log('\n[#766] the unknown-field message no longer lists them');
{
  const r = await run(() => create.call({ conditions: [{ field: 'bogus', op: 'is', value: 'x' }], actions: [ACT] }));
  check(r.message === 'Unknown condition field "bogus". Valid fields: imported_payee, payee, payee_name, account, category, category_group, notes, amount, date, cleared, reconciled.',
    'NEGATIVE: the valid-field list holds neither transfer nor parent', r.message);
}

console.log('\n[#766] the descriptions no longer offer them');
{
  check(!/transfer|parent/.test(spec.description.split('\n').find((l) => l.startsWith('cleared, reconciled')) ?? ''), 'manage_rules line names only cleared, reconciled');
  check(spec.description.includes('cleared, reconciled take is with true or false'), 'manage_rules description keeps the boolean line');
  check(create.description.includes('cleared, reconciled: is true or false.') && !/transfer, parent/.test(create.description), 'actual_rules_create help line is trimmed');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
