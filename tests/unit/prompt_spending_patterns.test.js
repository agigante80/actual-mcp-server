// tests/unit/prompt_spending_patterns.test.js
//
// #663: the spending_patterns prompt: the months and end_month schemas (string in, number out),
// exact ranges (year rollover, leap year, 24 months), the default range and the offer matrix.
//
// Run: node tests/unit/prompt_spending_patterns.test.js   (needs `npm run build` first)

import assert from 'assert';
import { z } from 'zod';

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
console.log('\n[prompt-spending-patterns]');

const {
  resolveOfferedPrompts, renderPrompt, assertPromptNames, assertRequiredToolsKnown, assertArgsBounded,
} = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const def = PROMPT_DEFINITIONS.find((d) => d.name === 'spending_patterns');
const render = (args) => renderPrompt(def, args);
const EM_EN = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const pad2 = (n) => String(n).padStart(2, '0');

await check('spending_patterns is registered with its title and two optional arguments', () => {
  assert.ok(def, 'spending_patterns must be in PROMPT_DEFINITIONS');
  assert.strictEqual(def.title, 'Spending patterns');
  assert.deepStrictEqual(def.arguments.map((a) => [a.name, a.required]), [['months', false], ['end_month', false]]);
});

await check('the real PROMPT_DEFINITIONS pass every registry validator (assertArgsBounded sees transform and default)', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'all' }, COMPACT_TOOLS);
  const known = new Set([...manager.getToolNames(), ...manager.getCompactToolNames()]);
  assertPromptNames(PROMPT_DEFINITIONS);
  assertRequiredToolsKnown(PROMPT_DEFINITIONS, known);
  assertArgsBounded(PROMPT_DEFINITIONS);
});

await check('assertArgsBounded still refuses an unbounded string behind transform and default', () => {
  const unbounded = { ...def, argsSchema: z.strictObject({ months: z.string().transform(Number).default(6) }) };
  assert.throws(() => assertArgsBounded([unbounded]), /months/);
  const bounded = { ...def, argsSchema: z.strictObject({ months: z.string().max(2).transform(Number).default(6) }) };
  assertArgsBounded([bounded]);
});

await check('requiredTools is exactly the two read tools; the text names only required compact tools', () => {
  assert.deepStrictEqual(def.requiredTools, ['summarize_transactions', 'list_budget_months']);
  const text = render({ months: '6', end_month: '2026-10' });
  const compact = [...manager.getCompactToolNames()];
  const tokens = text.match(/[a-z_]+/g);
  for (const t of tokens) {
    if (compact.includes(t)) assert.ok(def.requiredTools.includes(t), `${t} is named but not required`);
  }
  for (const t of def.requiredTools) assert.ok(tokens.includes(t), `${t} should be named in the text`);
});

await check('the text is read-only, has no dash and no leftover placeholder', () => {
  const text = render({});
  assert.ok(!text.includes('manage_'), 'the prompt must stay read-only');
  assert.match(text, /stay read-only/i);
  assert.ok(!EM_EN.test(text), 'no em or en dash');
  assert.ok(!/\$\d/.test(text), 'no decimal-dollar example');
  assert.ok(!/\{[a-z_]+\}/.test(text), 'no unfilled placeholder');
});

await check('months: accepts 1, 6, 24 as numbers; refuses everything else', () => {
  for (const [s, n] of [['1', 1], ['6', 6], ['24', 24]]) {
    assert.strictEqual(def.argsSchema.parse({ months: s }).months, n);
  }
  for (const months of ['0', '25', 'abc', '2.5', '', '06', '007', ' 6', '6\n', 6]) {
    assert.throws(() => def.argsSchema.parse({ months }), `must refuse ${JSON.stringify(months)}`);
  }
  try {
    def.argsSchema.parse({ months: 'zzSENTINELzz' });
    assert.fail('must refuse');
  } catch (err) {
    assert.ok(Array.isArray(err.issues), 'a ZodError');
    assert.ok(JSON.stringify(err.issues).includes('months'));
    assert.ok(!JSON.stringify(err.issues).includes('SENTINEL'), 'the value must not be echoed');
  }
});

await check('end_month: accepts YYYY-MM; refuses malformed values and unknown keys', () => {
  assert.strictEqual(def.argsSchema.parse({ end_month: '2026-10' }).end_month, '2026-10');
  for (const end_month of ['October', '2026-00', '2026-13', ' 2026-10', '2026-10\n', 'x'.repeat(10000)]) {
    assert.throws(() => def.argsSchema.parse({ end_month }), `must refuse ${JSON.stringify(end_month.slice(0, 12))}`);
  }
  assert.throws(() => def.argsSchema.parse({ months: '6', extra: 'x' }), /extra/);
  assert.throws(() => def.argsSchema.parse({ month: '2026-10' }), /month/);
});

await check('render fills the exact ranges', () => {
  const cases = [
    ['2026-10', '6', '2026-05-01', '2026-10-31'],
    ['2026-01', '3', '2025-11-01', '2026-01-31'],
    ['2024-02', '1', '2024-02-01', '2024-02-29'],
    ['2026-02', '1', '2026-02-01', '2026-02-28'],
    ['2026-12', '24', '2025-01-01', '2026-12-31'],
    ['2024-12', '12', '2024-01-01', '2024-12-31'],
  ];
  for (const [end, months, start, last] of cases) {
    const text = render({ end_month: end, months });
    assert.ok(text.includes(`last ${months} full months, from ${start} to ${last}.`), `${end}/${months}: ${text.split('\n')[0]}`);
    assert.ok(text.includes(`start_date ${start}, end_date ${last}, group_by month`));
    assert.ok(text.includes(`month ${end} to compare`));
  }
});

await check('no arguments: 6 full months ending with the local previous month', () => {
  const prev = () => {
    const d = new Date();
    const m = d.getMonth();
    return m === 0 ? `${d.getFullYear() - 1}-12` : `${d.getFullYear()}-${pad2(m)}`;
  };
  const before = prev();
  const text = render({});
  const after = prev();
  const ok = (end) => {
    const [y, m] = end.split('-').map(Number);
    const idx = y * 12 + (m - 1) - 5;
    const start = `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}-01`;
    return text.includes(`month ${end} to compare`) && text.includes(`from ${start} to ${end}-`);
  };
  assert.ok(ok(before) || ok(after), text.split('\n')[0]);
  assert.ok(text.includes('last 6 full months'));
});

await check('the default end month rolls back across New Year and never overflows on a 31st (faked clock)', () => {
  const RealDate = globalThis.Date;
  const fake = (iso) => {
    const fixed = new RealDate(iso).getTime();
    return class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
    };
  };
  try {
    globalThis.Date = fake('2026-01-15T12:00:00');
    assert.strictEqual(def.argsSchema.parse({}).end_month, '2025-12');
    globalThis.Date = fake('2026-03-31T12:00:00');
    assert.strictEqual(def.argsSchema.parse({}).end_month, '2026-02');
    globalThis.Date = fake('2026-12-31T12:00:00');
    assert.strictEqual(def.argsSchema.parse({}).end_month, '2026-11');
  } finally {
    globalThis.Date = RealDate;
  }
});

await check('offer matrix through the real policy: compact, all and compact read-only offer it; legacy does not', async () => {
  const offered = async (settings) => {
    await manager.initialize({ toolsets: 'all', tools: '', readOnly: false, ...settings }, COMPACT_TOOLS);
    return resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(manager.getPublishedToolNames())).map((d) => d.name);
  };
  assert.ok((await offered({ surface: 'compact' })).includes('spending_patterns'));
  assert.ok((await offered({ surface: 'all' })).includes('spending_patterns'));
  assert.ok((await offered({ surface: 'compact', readOnly: true })).includes('spending_patterns'));
  assert.ok(!(await offered({ surface: 'legacy' })).includes('spending_patterns'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
