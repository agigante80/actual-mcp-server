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
  const block = tools.renderToolsSummary({
    toolsets: real.TOOLSETS, chat: real.PRESETS.chat, writeCapable: real.WRITE_CAPABLE, scopes: tools.TOOLSET_SCOPES,
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

for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`\n[docs tools] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
