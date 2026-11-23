// tests/unit/prompt_budget_cleanup.test.js
//
// #664: the budget_cleanup prompt: the shared calendar-checked date argument, the exact six month
// window, the no-write sentence, the manage_ allow-set and the offer matrix.
//
// Run: node tests/unit/prompt_budget_cleanup.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[prompt-budget-cleanup]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'budget_cleanup');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
// #805: the text names no write tool, so nothing beyond the three required read tools is allowed.
const MANAGE_ALLOWED = [];
const SENTENCE = 'Do not call any manage_ tool in this turn.';

await check('budget_cleanup is registered with its title and one optional date argument', () => {
  assert.ok(def, 'budget_cleanup must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Budget cleanup');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['date', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('requiredTools is exact; every compact tool named is required or an allowed manage_ proposal', () => {
  assert.deepStrictEqual(def.requiredTools, ['list_entities', 'summarize_transactions', 'list_budget_months']);
  const text = render({ date: '2026-11-13' });
  const compact = [...manager.getCompactToolNames()];
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) {
      assert.ok(def.requiredTools.includes(t) || MANAGE_ALLOWED.includes(t), `${t} is named but neither required nor allowed`);
    }
  }
  for (const t of def.requiredTools) assert.ok(tokens.includes(t), `${t} should be named in the text`);
});

await check('the text forbids any write in the turn, and has no dash, decimal dollar or placeholder', () => {
  const text = render({ date: '2026-11-13' });
  assert.ok(text.includes(SENTENCE), 'the exact no-write sentence must be present');
  assert.match(text, /analysis only/);
  assert.match(text, /Never propose deleting a category that still holds a balance/);
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
  assert.ok(!/\{[a-z_]+\}/.test(text), 'no unfilled placeholder');
});

await check('the safeguards are pinned: removing the sentence or the funded-category rule would be caught', () => {
  const text = render({ date: '2026-11-13' });
  assert.strictEqual(text.replace(SENTENCE, '').includes(SENTENCE), false);
  const stripped = text.replace('Never propose deleting a category that still holds a balance. ', '');
  assert.ok(!/Never propose deleting a category that still holds a balance/.test(stripped));
});

await check('date: accepts real days; refuses impossible, malformed and hostile values; unknown keys', () => {
  for (const date of ['2026-11-13', '2024-02-29']) assert.deepStrictEqual(def.argsSchema.parse({ date }), { date });
  const bad = ['2026-02-29', '2026-02-31', '2026-13-01', '2026-11-1', ' 2026-11-13', '2026-11-13\n',
    'x'.repeat(10000), 20261113, 'Jan-SECRET-123'];
  for (const date of bad) assert.throws(() => def.argsSchema.parse({ date }), `must refuse ${JSON.stringify(String(date).slice(0, 12))}`);
  try {
    def.argsSchema.parse({ date: 'Jan-SECRET-123' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(Array.isArray(err.issues), 'a ZodError, never an internal error');
    assert.ok(!JSON.stringify(err.issues).includes('SECRET-123'), 'the value must not be echoed');
  }
  try {
    def.argsSchema.parse({ dryRun: 'zzSENTINELzz' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(JSON.stringify(err.issues).includes('dryRun'));
    assert.ok(!JSON.stringify(err.issues).includes('SENTINEL'));
  }
});

await check('render fills the exact six month window', () => {
  const cases = [
    ['2026-11-13', '2026-05-01', '2026-11'],
    ['2026-01-15', '2025-07-01', '2026-01'],
    ['2026-06-30', '2025-12-01', '2026-06'],
    ['2026-07-01', '2026-01-01', '2026-07'],
    ['2024-08-31', '2024-02-01', '2024-08'],
  ];
  for (const [date, start, month] of cases) {
    const text = render({ date });
    assert.ok(text.includes(`as of ${date}`), date);
    assert.ok(text.includes(`from ${start} to ${date}.`), `${date}: expected from ${start}`);
    assert.ok(text.includes(`list_budget_months with month ${month}.`), `${date}: month ${month}`);
  }
});

await check('no date: the schema default is the server local today', () => {
  const local = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const before = local();
  const text = render({});
  const after = local();
  assert.ok(text.includes(`as of ${before}`) || text.includes(`as of ${after}`), text.split('\n')[0]);
});

await check('offer matrix through the real policy: compact, all and both read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'all' })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('budget_cleanup'));
  assert.ok((await offered({ surface: 'all', readOnly: true })).includes('budget_cleanup'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('budget_cleanup'));
});

// ---------------------------------------------------------------- #772
const { formatZodError } = await import('../../dist/src/lib/zod-error-format.js');
const messageOf = (args) => {
  try { render(args); } catch (err) { return formatZodError(err, def.argsSchema); }
  throw new Error(`expected a refusal for ${JSON.stringify(args)}`);
};
const occurrences = (s, sub) => s.split(sub).length - 1;
const NOISE = /pattern|at most|\^|\$/;
await check('an empty or blank date is omitted; a bad date is one readable message (#772)', () => {
  const base = render({});
  assert.strictEqual(render({ date: '' }), base);
  assert.strictEqual(render({ date: '   ' }), base);
  for (const bad of ['2026-13-01', '2026-02-31', 'yesterday', '2026-1-1']) {
    const m = messageOf({ date: bad });
    assert.ok(m.includes('date: must be YYYY-MM-DD, a real calendar day'), m);
    assert.strictEqual(occurrences(m, 'must'), 1, m);
    assert.ok(!NOISE.test(m) && !m.includes(bad), m);
  }
  assert.throws(() => def.argsSchema.parse({ date: '' }));
});

// ---------------------------------------------------------------- #780
const { aggregateTransactions } = await import('../../dist/src/lib/financial-analysis.js');
const S1 = 'A payee, category or account counts as unused only when it has no transaction and no transfer from 2026-05-01 to 2026-11-13.';
const S5 = 'Find open accounts (closed false) with balance_current 0 that are unused: no group for the account in the step 1 account result, or both transactionCount and transferCount 0. An account with a transferCount above 0 is in use, so do not propose closing it. A null balance_current is unknown, so skip that account.';
await check('a transfer counts as use for an account, a payee and a category alike (#780)', () => {
  const text = render({ date: '2026-11-13' });
  assert.ok(text.includes(S1), text.split('\n')[0]);
  assert.ok(text.includes(S5));
  assert.ok(text.includes('Every group also has a transferCount, the number of transfers counted under it (for a category, a transfer to or from an off-budget account that carries the category); transactionCount does not include transfers, so a group with transactionCount 0 and a transferCount above 0 is in use. Anything missing from a result had no transaction and no transfer in the window.'));
  assert.ok(!text.includes('Account groups also have'), 'every group carries transferCount, not only account groups');
});
await check('step 1 names the real group fields, not a generic id and name (#780)', () => {
  const text = render({ date: '2026-11-13' });
  for (const f of ['payeeId', 'payeeName', 'categoryId', 'categoryName', 'accountId', 'accountName']) assert.ok(text.includes(f), f);
  assert.ok(!text.includes('Each group has an id, a name'));
});
await check('the field names the text claims are keys of the real aggregate groups (#780)', () => {
  const snapshot = {
    transactions: [
      { id: 'a', date: '2026-06-01', amount: -500, account: 'acc-1', category: 'cat-1', payee: 'pay-1' },
      { id: 'x', date: '2026-06-02', amount: -900, account: 'acc-1', transfer_id: 'x2' },
    ],
    accounts: [{ id: 'acc-1', name: 'Checking' }],
    categories: [{ id: 'cat-1', name: 'Food', group: 'grp-1' }],
    categoryGroups: [{ id: 'grp-1', name: 'Expenses' }],
    payees: [{ id: 'pay-1', name: 'Shop' }],
  };
  const keys = (dim) => {
    const r = aggregateTransactions(snapshot, { startDate: '2026-05-01', endDate: '2026-11-13', groupBy: [dim], includeIncome: true, excludeTransfers: false });
    return new Set(r.groups.flatMap((g) => Object.keys(g)));
  };
  for (const [dim, names] of [['payee', ['payeeId', 'payeeName']], ['category', ['categoryId', 'categoryName']], ['account', ['accountId', 'accountName', 'transactionCount', 'transferCount']]]) {
    const k = keys(dim);
    for (const n of names) assert.ok(k.has(n), `${dim} group lacks ${n}`);
  }
});

// #781: a month the budget does not cover. list_budget_months with such a month throws, so the
// text lists the budget months first and says what to skip.
await check('budget_cleanup lists the budget months first and says what to skip for a month outside them (#781)', () => {
  const text = render({ date: '2015-01-31' });
  const para = 'Before step 1, call list_budget_months with no month to get the months the budget covers. If 2015-01 is not in that list, the budget has no data for it: do not call list_budget_months with 2015-01, say that the budget does not cover 2015-01, '  + 'and say that the window from 2014-07-01 to 2015-01-31 is not fully inside the months the budget covers, so the summaries in step 1 cannot prove that something is unused. Then report duplicates only (the same-name payees in step 2, overlapping rules in step 3, near-duplicate category names in step 4) and mark nothing as unused, stale or closable: skip step 5 and the budget check in step 4.';
  assert.ok(text.includes(para), 'the paragraph is missing or changed');
  assert.ok(text.indexOf(para) < text.indexOf('\n1. '), 'the paragraph comes before step 1');
  assert.ok(!text.includes('{'), 'no unfilled placeholder');
  assert.ok(!text.includes('this month'));
  assert.strictEqual(text.split(para).length - 1, 1, 'the paragraph appears exactly once');
});
await check('budget_cleanup no longer carries the dead no-categories fallback and never proposes deleting unchecked (#781)', () => {
  for (const date of ['2026-10-15', '2015-01-31']) {
    const text = render({ date });
    assert.ok(!text.includes('returns no categories'), 'the dead fallback is gone');
    assert.ok(text.includes('do not propose deleting any category, because its balance cannot be checked'));
    assert.ok(text.includes('list_budget_months with month ' + date.slice(0, 7) + '.'), 'the step 4 call stays');
  }
});


// #774: the clock is stubbed from LOCAL components, which is what dates.ts reads, so the results
// do not depend on the day the test runs or on TZ.
const RealDate = Date;
function withClock(y, monthIndex, d, h, fn) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(y, monthIndex, d, h, 0, 0); }
    static now() { return new RealDate(y, monthIndex, d, h).getTime(); }
  };
  try { return fn(); } finally { globalThis.Date = RealDate; }
}
const countOf = (s, sub) => s.split(sub).length - 1;
const EMPTY_LINE = 'If a step returns no rows, say so plainly and carry on with what exists. Do not widen the date range on your own.';
const ZERO_LINE = 'If income is 0, say the savings rate cannot be computed instead of dividing by zero.';

await check('budget_cleanup labels a defaulted date and not a supplied one (#774)', () => {
  const text = withClock(2026, 10, 23, 12, () => render({}));
  assert.strictEqual(countOf(text, 'came from the server clock'), 1);
  assert.ok(text.includes('I did not name a date, so 2026-11-23 is today on the server clock'));
  assert.ok(!text.includes('{'));
  assert.ok(!withClock(2026, 10, 23, 12, () => render({ date: '2026-11-23' })).includes('server clock'));
});

await check('budget_cleanup carries the empty-result line once (#774)', () => {
  assert.strictEqual(countOf(render({ date: '2026-11-13' }), EMPTY_LINE), 1);
});

// ---------------------------------------------------------------- #805
// The prompt stays offered under MCP_READ_ONLY on purpose, so its text must be valid where no
// manage_ tool is published: it names each change in words and asks to apply only when it can.
await check('the text names no write tool; the only manage_ is the no-write sentence (#805)', () => {
  const text = render({ date: '2026-11-13' });
  assert.strictEqual(text.replaceAll(SENTENCE, '').includes('manage_'), false);
  assert.strictEqual(text.split('manage_').length - 1, 1);
  for (const old of ['manage_payees', 'manage_rules', 'manage_categories', 'manage_accounts', 'naming the action it needs']) {
    assert.ok(!text.includes(old), `${old} must be gone`);
  }
});

await check('step 6 names the four changes in words and step 7 is conditional (#805)', () => {
  const text = render({ date: '2026-11-13' });
  const step6 = text.slice(text.indexOf('\n6. '), text.indexOf('\n7. '));
  for (const w of ['merge or delete a payee', 'update or delete a rule', 'delete a category or an empty category group', 'close an account']) {
    assert.ok(step6.includes(w), `step 6 must contain ${w}`);
  }
  const step7 = text.slice(text.indexOf('\n7. '));
  assert.ok(step7.includes('If you have tools that can make these changes, end by asking which items I want applied; otherwise end after the findings.'));
  assert.ok(step7.includes(SENTENCE));
  assert.ok(!step7.includes('End by asking'), 'the unconditional ask is gone');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
