// tests/unit/docs_check.test.js
//
// #602: the docs:check orchestrator (scripts/docs/check.mjs), tested through its
// `run({ root, modules, env })` seam with STUB modules. No PATH, no lychee and no
// real repo are involved, so the orchestrator rules are pinned on their own:
//   - an async module's problem is awaited and reported, not lost;
//   - a local skip is loud, and the modules after it still run;
//   - when CI is set a skip is a failure, never a silent pass.
//
// Run: node tests/unit/docs_check.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/docs/check.mjs';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const ROOT = '/nonexistent-root';

/** A stub whose check resolves on a later tick, so a missing await would lose it. */
const asyncStub = (name, result) => ({
  name,
  check: async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { name, ...result };
  },
});

const linksSkipping = asyncStub('links', {
  problems: [],
  skipped: { tool: 'lychee', reason: 'lychee not installed' },
});

console.log('\n[docs check orchestrator]');

await check('an async module problem is not lost', async () => {
  const { exitCode, lines } = await run({
    root: ROOT, modules: [asyncStub('stub', { problems: ['x'] })], env: {},
  });
  assert.strictEqual(exitCode, 1);
  assert.ok(lines.includes('stub: x'), `lines: ${JSON.stringify(lines)}`);
});

await check('a local skip is loud, the next module still runs, and exit is 0', async () => {
  // The markers stub reports nothing, so "it still ran" is observed through a flag.
  let markersRan = false;
  const markers = { name: 'markers', check: async () => { markersRan = true; return { name: 'markers', problems: [] }; } };
  const { exitCode, lines } = await run({ root: ROOT, modules: [linksSkipping, markers], env: {} });
  assert.strictEqual(exitCode, 0);
  assert.ok(lines.includes('skip: links: lychee not installed'), `lines: ${JSON.stringify(lines)}`);
  assert.ok(markersRan, 'the module after a skip must still run');
});

await check('after a local skip, the next module problem line still appears', async () => {
  // Same order as the real MODULES list (links first): a skip must not end the run.
  const markers = asyncStub('markers', { problems: ['frozen marker: docs/guides/x.md:3'] });
  const { exitCode, lines } = await run({ root: ROOT, modules: [linksSkipping, markers], env: {} });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, [
    'skip: links: lychee not installed',
    'markers: frozen marker: docs/guides/x.md:3',
  ]);
});

await check('when CI is set a skip fails with "<module>: <tool> required but not found"', async () => {
  const { exitCode, lines } = await run({ root: ROOT, modules: [linksSkipping], env: { CI: 'true' } });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, ['links: lychee required but not found']);
});

await check('CI=false is treated as unset (the skip stays local)', async () => {
  const { exitCode, lines } = await run({ root: ROOT, modules: [linksSkipping], env: { CI: 'false' } });
  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(lines, ['skip: links: lychee not installed']);
});

await check('a module that throws fails the run instead of being skipped', async () => {
  const boom = { name: 'boom', check: async () => { throw new Error('kaput'); } };
  const { exitCode, lines } = await run({ root: ROOT, modules: [boom], env: {} });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, ['boom: check threw: kaput']);
});

await check('clean modules exit 0 with no lines', async () => {
  const { exitCode, lines } = await run({ root: ROOT, modules: [asyncStub('a', { problems: [] })], env: {} });
  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(lines, []);
});

await check('in CI a too-old tool is reported with its reason, not as missing', async () => {
  const old = { name: 'links', check: async () => ({ name: 'links', problems: [], skipped: { tool: 'lychee', reason: 'lychee 0.15.1 found, 0.24.2 required' } }) };
  const { exitCode, lines } = await run({ root: ROOT, modules: [old], env: { CI: 'true' } });
  assert.strictEqual(exitCode, 1);
  assert.deepStrictEqual(lines, ['links: lychee required: lychee 0.15.1 found, 0.24.2 required']);
});

// The command-line entry, not the run() seam: if isDirectRun() stopped matching, or the
// entry stopped passing process.env, `npm run docs:check` would print nothing and exit 0.
await check('the CLI entry exits 1 in CI when lychee is not on PATH', async () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'docs', 'check.mjs');
  const r = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: dirname(process.execPath), CI: 'true' },
  });
  assert.strictEqual(r.status, 1, `stdout: ${r.stdout} stderr: ${r.stderr}`);
  assert.ok(r.stdout.split('\n').includes('links: lychee required but not found'), `stdout: ${r.stdout}`);
});

console.log(`\n[docs check orchestrator] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
