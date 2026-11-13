// tests/unit/docs_tools.test.js
//
// #603: the docs:check "tools" module (scripts/docs/tools.mjs). It generates the
// README's tools-summary block (toolset table, chat preset sentence, read-only
// sentence) from dist/src/lib/toolsets.js, so those numbers are never typed by hand.
//
// renderToolsSummary cases use inline stub data and need no build. check() and
// generate() cases each run against their own temp root holding a README.md and a
// stub dist/src/lib/toolsets.js (one root per case: ESM caches a module by URL).
// One case renders from the repo's real dist/ and compares it with README.md.
//
// Run: node tests/unit/docs_tools.test.js

import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// The inertness case needs the env as it was before the module was imported.
const envBefore = JSON.parse(JSON.stringify(process.env));
const tools = await import('../../scripts/docs/tools.mjs');
const { run } = await import('../../scripts/docs/check.mjs');

const BEGIN = '<!-- BEGIN GENERATED: tools-summary -->';
const END = '<!-- END GENERATED: tools-summary -->';
const MARKER_ERR = 'README.md needs exactly one tools-summary BEGIN marker followed by one END marker';
const STALE_ERR = 'README.md tools-summary block is stale: run npm run build && npm run docs:gen';
const NO_DIST = 'dist/src/lib/toolsets.js not found (run npm run build)';

const stubInputs = () => ({
  toolsets: { a: ['t1', 't2'], b: ['t3'] },
  chat: ['t3', 't1'],
  writeCapable: new Set(['t2']),
  scopes: { a: 'Scope A', b: 'Scope B' },
});

const dirs = [];
function tempRoot({ readme, dist = true }) {
  const root = mkdtempSync(join(tmpdir(), 'docs-tools-'));
  dirs.push(root);
  writeFileSync(join(root, 'README.md'), readme);
  if (dist) {
    mkdirSync(join(root, 'dist/src/lib'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(root, 'dist/src/lib/toolsets.js'),
      "export const TOOLSETS = { a: ['t1', 't2'], b: ['t3'] };\n"
      + "export const PRESETS = { chat: ['t3', 't1'] };\n"
      + "export const WRITE_CAPABLE = new Set(['t2']);\n");
  }
  return root;
}
const stubScopes = { a: 'Scope A', b: 'Scope B' };
const wrap = (body) => `intro\n\n${BEGIN}\n${body}\n${END}\n\noutro\n`;

console.log('\n[docs tools]');

await check('renderToolsSummary matches the stub registry', () => {
  const out = tools.renderToolsSummary(stubInputs());
  const lines = out.split('\n');
  assert.strictEqual(lines[0], BEGIN);
  assert.strictEqual(lines[lines.length - 1], END);
  assert.ok(out.includes('| `a` | 2 | Scope A |'), out);
  assert.ok(out.includes('| `b` | 1 | Scope B |'), out);
  assert.ok(out.indexOf('| `a` |') < out.indexOf('| `b` |'), 'declaration order');
  assert.ok(out.includes('The `chat` preset publishes 2 tools: `t3` and `t1`.'), out);
  assert.ok(out.includes('`MCP_READ_ONLY=true` hides and refuses 1 write-capable tools and leaves 2 published.'), out);
});

await check('#680: deriveCompact lists a compact tool for chat when any operation is chat, and keeps read-only tools with no write operation', () => {
  const c = tools.deriveCompact({
    tools: [{ name: 'c1', legacy: ['t1', 't2'] }, { name: 'c2', legacy: ['t3'] }, { name: 'c3', legacy: ['t4'] }],
    chat: ['t3', 't1'], writeCapable: new Set(['t2']),
  });
  assert.deepStrictEqual(c.chat, ['c1', 'c2']);
  assert.deepStrictEqual(c.readOnly, ['c2', 'c3']);
});

await check('#680: a compact input renders the compact sentences and keeps the legacy ones; without it only legacy', () => {
  const withCompact = tools.renderToolsSummary({ ...stubInputs(), compact: { chat: ['c1'], readOnly: ['c2', 'c3'] } });
  assert.ok(withCompact.includes('| Toolset | Operations | Contents |'), withCompact);
  assert.ok(withCompact.includes('On the default compact surface the `chat` preset publishes 1 tools: `c1`.'), withCompact);
  assert.ok(withCompact.includes('With `MCP_TOOL_SURFACE=legacy` the `chat` preset publishes 2 tools: `t3` and `t1`.'), withCompact);
  assert.ok(withCompact.includes('publishes 2 compact tools (`c2` and `c3`)'), withCompact);
  const legacyOnly = tools.renderToolsSummary(stubInputs());
  assert.ok(legacyOnly.includes('| Toolset | Tools | Contents |') && !/compact/.test(legacyOnly), legacyOnly);
});

await check('NEGATIVE: a toolset with no scope entry throws', () => {
  const inp = stubInputs();
  inp.toolsets.c = ['t4'];
  assert.throws(() => tools.renderToolsSummary(inp), /TOOLSET_SCOPES has no entry for toolset c/);
});

await check('NEGATIVE: a scope for an unknown toolset throws', () => {
  const inp = stubInputs();
  inp.scopes.z = 'x';
  assert.throws(() => tools.renderToolsSummary(inp), /TOOLSET_SCOPES names unknown toolset z/);
});

await check('replaceBlock swaps the block and keeps the surrounding text', () => {
  const out = tools.replaceBlock(wrap('old'), `${BEGIN}\nnew\n${END}`);
  assert.strictEqual(out, wrap('new'));
});

await check('NEGATIVE: replaceBlock refuses a duplicate BEGIN, a missing END, a reversed pair and no markers', () => {
  for (const bad of [`${BEGIN}\n${BEGIN}\n${END}`, `${BEGIN}\nx`, `${END}\n${BEGIN}`, 'none']) {
    assert.throws(() => tools.replaceBlock(bad, 'x'), (e) => e.message === MARKER_ERR);
  }
});

await check('a CRLF README is regenerated in CRLF and then checks clean', async () => {
  const root = tempRoot({ readme: wrap('stale').replace(/\n/g, '\r\n') });
  assert.deepStrictEqual(await tools.generate({ root, scopes: stubScopes }), ['README.md']);
  const text = readFileSync(join(root, 'README.md'), 'utf8');
  assert.ok(!/[^\r]\n/.test(text), 'README has a bare LF after generate');
  assert.deepStrictEqual((await tools.check({ root, scopes: stubScopes })).problems, []);
});

await check('generate is idempotent and check is clean afterwards', async () => {
  const root = tempRoot({ readme: wrap('stale') });
  assert.deepStrictEqual(await tools.generate({ root, scopes: stubScopes }), ['README.md']);
  assert.deepStrictEqual(await tools.generate({ root, scopes: stubScopes }), []);
  const res = await tools.check({ root, scopes: stubScopes });
  assert.deepStrictEqual(res.problems, []);
});

await check('NEGATIVE: a stale block is reported', async () => {
  const root = tempRoot({ readme: wrap('| Toolset | Tools | Contents |\n|---|---|---|\n| `a` | 3 | Scope A |') });
  const res = await tools.check({ root, scopes: stubScopes });
  assert.deepStrictEqual(res.problems, [STALE_ERR]);
});

await check('NEGATIVE: generate with a missing END marker throws and leaves README unchanged', async () => {
  const readme = `intro\n${BEGIN}\nx\n`;
  const root = tempRoot({ readme });
  await assert.rejects(tools.generate({ root, scopes: stubScopes }), (e) => e.message === MARKER_ERR);
  assert.strictEqual(readFileSync(join(root, 'README.md'), 'utf8'), readme);
});

await check('NEGATIVE: check with a duplicate BEGIN marker reports the marker problem', async () => {
  const root = tempRoot({ readme: `${BEGIN}\n${BEGIN}\nx\n${END}\n` });
  const res = await tools.check({ root, scopes: stubScopes });
  assert.deepStrictEqual(res.problems, [MARKER_ERR]);
});

await check('NEGATIVE: check reports a scope mismatch as a problem', async () => {
  const root = tempRoot({ readme: wrap('x') });
  const res = await tools.check({ root, scopes: { a: 'A' } });
  assert.deepStrictEqual(res.problems, ['TOOLSET_SCOPES has no entry for toolset b']);
});

await check('NEGATIVE: no dist skips locally with the reason', async () => {
  const root = tempRoot({ readme: wrap('x'), dist: false });
  const { exitCode, lines } = await run({ root, modules: [tools], env: {} });
  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(lines, [`skip: tools: ${NO_DIST}`]);
});

await check('NEGATIVE: no dist fails under CI', async () => {
  const root = tempRoot({ readme: wrap('x'), dist: false });
  const { exitCode, lines } = await run({ root, modules: [tools], env: { CI: 'true' } });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, [`tools: dist required: ${NO_DIST}`]);
});

await check('NEGATIVE: generate without dist throws and writes nothing', async () => {
  const readme = wrap('x');
  const root = tempRoot({ readme, dist: false });
  await assert.rejects(tools.generate({ root }), (e) => e.message === NO_DIST);
  assert.strictEqual(readFileSync(join(root, 'README.md'), 'utf8'), readme);
});

await check('real registry: the rendered block equals the README block and carries no total or marker', async () => {
  const distFile = join(ROOT, 'dist/src/lib/toolsets.js');
  if (!existsSync(distFile)) {
    if (process.env.CI) throw new Error(`dist required under CI: ${NO_DIST}`);
    console.log('  skip: docs_tools real-registry case: run npm run build');
    return;
  }
  const real = await import(pathToFileURL(distFile).href);
  const { COMPACT_TOOLS } = await import(pathToFileURL(join(ROOT, 'dist/src/compact/registry.js')).href);
  const { compactLegacyNames } = await import(pathToFileURL(join(ROOT, 'dist/src/compact/dispatch.js')).href);
  const compact = tools.deriveCompact({
    tools: COMPACT_TOOLS.map((c) => ({ name: c.name, legacy: compactLegacyNames(c) })),
    chat: real.PRESETS.chat, writeCapable: real.WRITE_CAPABLE,
  });
  const block = tools.renderToolsSummary({
    toolsets: real.TOOLSETS, chat: real.PRESETS.chat, writeCapable: real.WRITE_CAPABLE, scopes: tools.TOOLSET_SCOPES, compact,
  });
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.strictEqual(tools.replaceBlock(readme, block), readme, 'README block is stale');
  const sum = Object.values(real.TOOLSETS).reduce((n, a) => n + a.length, 0);
  assert.ok(block.includes(`leaves ${sum - real.WRITE_CAPABLE.size} published`));
  const { TOTAL_PATTERNS } = await import('../../scripts/tool-count.mjs');
  for (const { re, label } of TOTAL_PATTERNS) {
    assert.strictEqual(new RegExp(re.source, re.flags).test(block), false, `block matches total pattern: ${label}`);
  }
  assert.ok(!block.includes('**Version:**') && !block.includes('**Tool Count:**'));
});

await check('loading the registry through check() leaves process.env untouched', async () => {
  await tools.check({ root: ROOT });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(process.env)), envBefore);
});

// ---- #668: the README capabilities blocks (tools by domain, prompts, measured sizes) ----

const capabilities = await import('../../scripts/docs/capabilities.mjs');
const CAP_STALE_ERR = 'README.md capabilities block is stale: run npm run build && npm run docs:gen';
const DOMAINS = ['Context and lookup', 'Changing data'];
const stubTools = () => [
  { name: 'c1', domain: 'Context and lookup', summary: 'Read the thing.', examplePrompt: 'Show me the thing.' },
  { name: 'c2', domain: 'Changing data', summary: 'Change the thing.', examplePrompt: 'Change the thing to blue.' },
];

await check('#668: renderToolsByDomain renders one headed line per tool with its example prompt, deterministically', () => {
  const out = capabilities.renderToolsByDomain({ tools: stubTools(), domains: DOMAINS });
  assert.strictEqual(out, capabilities.renderToolsByDomain({ tools: stubTools(), domains: DOMAINS }), 'two runs differ');
  const lines = out.split('\n');
  assert.strictEqual(lines[0], '<!-- BEGIN GENERATED: capabilities-tools -->');
  assert.strictEqual(lines[lines.length - 1], '<!-- END GENERATED: capabilities-tools -->');
  assert.strictEqual(lines.filter((l) => l.startsWith('- **')).length, 2, out);
  assert.ok(out.includes('- **`c1`**: Read the thing. Example prompt: "Show me the thing."'), out);
  assert.ok(out.includes('- **`c2`**: Change the thing. Example prompt: "Change the thing to blue."'), out);
  assert.ok(out.indexOf('### Context and lookup') < out.indexOf('- **`c1`**') && out.indexOf('- **`c1`**') < out.indexOf('### Changing data'), out);
});

await check('NEGATIVE: renderToolsByDomain throws naming the tool and the field for an empty summary, an empty example prompt or an unknown domain', () => {
  const bad = (patch) => stubTools().map((x, i) => (i === 1 ? { ...x, ...patch } : x));
  assert.throws(() => capabilities.renderToolsByDomain({ tools: bad({ summary: '' }), domains: DOMAINS }), /compact tool c2: summary/);
  assert.throws(() => capabilities.renderToolsByDomain({ tools: bad({ examplePrompt: '  ' }), domains: DOMAINS }), /compact tool c2: examplePrompt/);
  assert.throws(() => capabilities.renderToolsByDomain({ tools: bad({ domain: 'Nowhere' }), domains: DOMAINS }), /compact tool c2: domain "Nowhere"/);
  assert.throws(() => capabilities.renderToolsByDomain({ tools: [stubTools()[0]], domains: DOMAINS }), /domain Changing data has no compact tool/);
});

const stubPrompts = [
  { name: 'monthly_review', description: 'Review a month.', arguments: [{ name: 'month', description: 'm', required: true }], requiredTools: ['c1'] },
  { name: 'spending_check', description: 'Check spending.', arguments: [], requiredTools: ['c1'] },
  { name: 'cleanup', description: 'Fix things | safely.', arguments: [], requiredTools: ['c2'] },
];

await check('#668: renderPrompts emits one row per prompt with its parameters, and derives the read-only hidden note', () => {
  const out = capabilities.renderPrompts({ prompts: stubPrompts, offeredReadOnly: stubPrompts.slice(0, 2) });
  const rows = out.split('\n').filter((l) => l.startsWith('| `'));
  assert.strictEqual(rows.length, 3, out);
  assert.strictEqual(rows[0], '| `monthly_review` | `month` (required) | Review a month. |');
  assert.strictEqual(rows[1], '| `spending_check` | none | Check spending. |');
  assert.ok(rows[2].includes('Fix things \\| safely.'), 'a pipe in a description is escaped');
  assert.ok(out.includes('With `MCP_READ_ONLY=true`, `cleanup` is hidden'), out);
  const none = capabilities.renderPrompts({ prompts: stubPrompts, offeredReadOnly: stubPrompts });
  assert.ok(none.includes('every prompt above is still offered') && !none.includes('hidden'), none);
});

await check('NEGATIVE: renderPrompts with an empty registry holds the literal line and no table', () => {
  const out = capabilities.renderPrompts({ prompts: [], offeredReadOnly: [] });
  assert.ok(out.split('\n').includes('No prompts are registered yet.'), out);
  assert.ok(!out.includes('| Prompt |') && !out.includes('|---'), out);
});

await check('#668: renderSizes renders bytes and KiB per configuration; a malformed entry throws', () => {
  const out = capabilities.renderSizes({ sizes: { a: { label: 'A', tools: 2, bytes: 2048 }, b: { label: 'B `x`', tools: 1, bytes: 1536 } } });
  assert.ok(out.includes('| A | 2 | 2048 | 2.0 |') && out.includes('| B `x` | 1 | 1536 | 1.5 |'), out);
  assert.ok(out.includes('node scripts/measure-tools-list-size.mjs'), out);
  assert.throws(() => capabilities.renderSizes({ sizes: { a: { label: 'A', tools: 2 } } }), /entry a needs/);
  assert.throws(() => capabilities.renderSizes({ sizes: {} }), /no configuration/);
});

const CAP_IDS = ['capabilities-tools', 'capabilities-prompts', 'capabilities-sizes'];
const capBlocks = CAP_IDS.map((id) => `<!-- BEGIN GENERATED: ${id} -->\nx\n<!-- END GENERATED: ${id} -->`);

/** A root with stub dist, a stub sizes JSON and a README holding all four blocks. */
function capRoot({ prompts, readme }) {
  const root = tempRoot({ readme: readme ?? [wrap('x'), ...capBlocks].join('\n') });
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('dist/src/compact/registry.js',
    `const tools = ${JSON.stringify(stubTools())};\n`
    + "export const COMPACT_TOOLS = tools.map((c, i) => ({ ...c, actions: new Map([['a', { legacy: i === 0 ? 't1' : 't2' }]]) }));\n");
  put('dist/src/compact/dispatch.js', 'export const compactLegacyNames = (c) => [...c.actions.values()].map((r) => r.legacy);\n');
  put('dist/src/compact/types.js', `export const COMPACT_DOMAINS = ${JSON.stringify(DOMAINS)};\n`);
  put('dist/src/prompts/index.js', `export const PROMPT_DEFINITIONS = ${JSON.stringify(prompts)};\n`);
  put('dist/src/prompts/registry.js', 'export const resolveOfferedPrompts = (defs, offered) => defs.filter((d) => d.requiredTools.every((n) => offered.has(n)));\n');
  put('scripts/docs/tools-list-sizes.json', JSON.stringify({ stub: { bytes: 1000, label: 'Stub', tools: 2 } }));
  return root;
}

await check('#668: generate fills every block from the registries and check is clean; a sixth prompt added without regenerating is stale', async () => {
  const extra = (names) => names.map((name) => ({ ...stubPrompts[1], name }));
  const five = capRoot({ prompts: [...stubPrompts, ...extra(['p4', 'p5'])] });
  assert.deepStrictEqual(await tools.generate({ root: five, scopes: stubScopes }), ['README.md']);
  const text = readFileSync(join(five, 'README.md'), 'utf8');
  assert.deepStrictEqual((await tools.check({ root: five, scopes: stubScopes })).problems, []);
  assert.strictEqual(text.split('\n').filter((l) => /^\| `(monthly_review|spending_check|cleanup|p4|p5)`/.test(l)).length, 5);
  // The README as generated for five prompts, checked against a registry that now has six.
  const six = capRoot({ prompts: [...stubPrompts, ...extra(['p4', 'p5', 'p6'])], readme: text });
  assert.deepStrictEqual((await tools.check({ root: six, scopes: stubScopes })).problems, [CAP_STALE_ERR]);
  const { exitCode, lines } = await run({ root: six, modules: [{ name: 'tools', check: ({ root }) => tools.check({ root, scopes: stubScopes }) }], env: {} });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, [`tools: ${CAP_STALE_ERR}`]);
});

await check('NEGATIVE: a hand-typed size, a hand-edited block and a changed registry summary without docs:gen are all reported stale', async () => {
  const base = capRoot({ prompts: stubPrompts });
  await tools.generate({ root: base, scopes: stubScopes });
  const generated = readFileSync(join(base, 'README.md'), 'utf8');
  assert.ok(generated.includes('| Stub | 2 | 1000 | 1.0 |'), generated);
  for (const [label, edit] of [
    ['size N+1 typed by hand', (s) => s.replace('| 1000 |', '| 1001 |')],
    ['tool line edited by hand', (s) => s.replace('Read the thing.', 'Read the other thing.')],
    ['prompt row edited by hand', (s) => s.replace('Review a month.', 'Review a year.')],
  ]) {
    const edited = edit(generated);
    assert.notStrictEqual(edited, generated, `${label}: the edit changed nothing`);
    const root = capRoot({ prompts: stubPrompts, readme: edited });
    assert.deepStrictEqual((await tools.check({ root, scopes: stubScopes })).problems, [CAP_STALE_ERR], label);
  }
  const changed = capRoot({ prompts: stubPrompts, readme: generated });
  const registry = join(changed, 'dist/src/compact/registry.js');
  writeFileSync(registry, readFileSync(registry, 'utf8').replace('Read the thing.', 'Read it.'));
  assert.deepStrictEqual((await tools.check({ root: changed, scopes: stubScopes })).problems, [CAP_STALE_ERR]);
});

await check('NEGATIVE: a missing capabilities marker, a missing sizes JSON and an unbuilt prompt registry are reported by name', async () => {
  const noMarker = capRoot({ prompts: stubPrompts, readme: wrap('x') });
  assert.deepStrictEqual((await tools.check({ root: noMarker, scopes: stubScopes })).problems,
    ['README.md needs exactly one capabilities-tools BEGIN marker followed by one END marker']);
  const noJson = capRoot({ prompts: stubPrompts });
  rmSync(join(noJson, 'scripts/docs/tools-list-sizes.json'));
  assert.deepStrictEqual((await tools.check({ root: noJson, scopes: stubScopes })).problems,
    ['scripts/docs/tools-list-sizes.json not found (run node scripts/measure-tools-list-size.mjs)']);
  const noPrompts = capRoot({ prompts: stubPrompts });
  rmSync(join(noPrompts, 'dist/src/prompts'), { recursive: true });
  assert.deepStrictEqual((await tools.check({ root: noPrompts, scopes: stubScopes })).problems,
    ['dist/src/prompts/index.js not found (run npm run build)']);
});

await check('#668: real registry: the README lists all 15 compact tools and every registered prompt, and its size rows equal the committed JSON', async () => {
  const registryFile = join(ROOT, 'dist/src/compact/registry.js');
  if (!existsSync(registryFile)) {
    if (process.env.CI) throw new Error(`dist required under CI: ${NO_DIST}`);
    console.log('  skip: docs_tools real capabilities case: run npm run build');
    return;
  }
  const { COMPACT_TOOLS } = await import(pathToFileURL(registryFile).href);
  const { PROMPT_DEFINITIONS } = await import(pathToFileURL(join(ROOT, 'dist/src/prompts/index.js')).href);
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.strictEqual(COMPACT_TOOLS.length, 15);
  for (const tool of COMPACT_TOOLS) {
    assert.ok(readme.includes(`- **\`${tool.name}\`**: ${tool.summary} Example prompt: "${tool.examplePrompt}"`), `README lacks ${tool.name}`);
  }
  for (const p of PROMPT_DEFINITIONS) assert.ok(readme.includes(`| \`${p.name}\` |`), `README lacks prompt ${p.name}`);
  const sizes = JSON.parse(readFileSync(join(ROOT, 'scripts/docs/tools-list-sizes.json'), 'utf8'));
  assert.ok(Object.keys(sizes).length >= 5, 'at least five configurations');
  for (const [id, s] of Object.entries(sizes)) assert.ok(readme.includes(`| ${s.label} | ${s.tools} | ${s.bytes} |`), `README size row for ${id}`);
  assert.deepStrictEqual((await tools.check({ root: ROOT })).problems, []);
});

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`\n[docs tools] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
