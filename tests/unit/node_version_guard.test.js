// tests/unit/node_version_guard.test.js
//
// #275: the Node floor guard. Covers the pure comparator (no spawning needed), the
// fail-open behaviour on unparseable input, the message contract, the module's purity
// (it must run on the very interpreter it rejects), and the root package.json
// resolution against a deliberately desynced dist mirror.
//
// Run: node tests/unit/node_version_guard.test.js

import assert from 'assert';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Fixture trees are removed on exit so a pre-commit loop does not litter os.tmpdir().
const fixtures = [];
function tempTree(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

// Importing the guard runs enforceNodeVersion() as a side effect. This test suite runs
// on a supported Node (>= the floor), so it must be a no-op here. If it ever exits 1
// during the unit suite, the guard is broken, and that is itself a useful signal.
const { parseMajor, requiredMajor, checkNodeVersion, findRootPackageJson } = await import(
  '../../dist/src/lib/node-version-guard.js'
);

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[node-version-guard]');

check('parseMajor handles the v-prefixed and bare forms', () => {
  assert.strictEqual(parseMajor('v18.19.1'), 18);
  assert.strictEqual(parseMajor('v22.22.2'), 22);
  assert.strictEqual(parseMajor('24.1.0'), 24);
});

check('parseMajor returns NaN on garbage rather than 0', () => {
  assert.ok(Number.isNaN(parseMajor('')));
  assert.ok(Number.isNaN(parseMajor('lts/hydrogen')));
  assert.ok(Number.isNaN(parseMajor(undefined)));
});

check("requiredMajor extracts the floor from '>=22.0.0'", () => {
  assert.strictEqual(requiredMajor('>=22.0.0'), 22);
  assert.strictEqual(requiredMajor('>= 24.0.0'), 24);
});

check('checkNodeVersion truth table: below the floor is rejected', () => {
  assert.strictEqual(checkNodeVersion('v18.19.1', '>=22.0.0').ok, false);
  assert.strictEqual(checkNodeVersion('v20.11.0', '>=22.0.0').ok, false);
});

check('checkNodeVersion truth table: at or above the floor is accepted', () => {
  assert.strictEqual(checkNodeVersion('v22.0.0', '>=22.0.0').ok, true);
  assert.strictEqual(checkNodeVersion('v22.22.2', '>=22.0.0').ok, true);
  assert.strictEqual(checkNodeVersion('v24.1.0', '>=22.0.0').ok, true);
});

check('checkNodeVersion FAILS OPEN on an unparseable range or version', () => {
  // Deliberate: bricking a valid install over an engines spelling we did not
  // anticipate would be worse than the crash this guard prevents.
  assert.strictEqual(checkNodeVersion('v18.19.1', 'lts/*').ok, true);
  assert.strictEqual(checkNodeVersion('weird', '>=22.0.0').ok, true);
  assert.strictEqual(checkNodeVersion('v18.19.1', '').ok, true);
});

check('the rejection message names the range, the running version, and the PATH trap', () => {
  const { message } = checkNodeVersion('v18.19.1', '>=22.0.0');
  assert.ok(message.includes('>=22.0.0'), 'must state the required range');
  assert.ok(message.includes('v18.19.1'), 'must state the running version');
  assert.ok(message.includes('env node'), 'must explain the shebang PATH re-resolution');
  assert.ok(
    message.includes('ERR_IMPORT_ASSERTION_TYPE_MISSING'),
    'must name the error the user would otherwise have googled',
  );
});

check('PURITY: the guard source imports only node:fs, node:path, node:url', () => {
  // It has to run on the interpreter it is about to reject, so it cannot pull in
  // anything that might fail to parse or resolve there.
  const src = readFileSync(join(ROOT, 'src', 'lib', 'node-version-guard.ts'), 'utf8');
  const specifiers = [...src.matchAll(/^\s*import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const allowed = new Set(['node:fs', 'node:path', 'node:url']);
  const stray = specifiers.filter((s) => !allowed.has(s));
  assert.deepStrictEqual(stray, [], `guard must not import: ${stray.join(', ')}`);
});

check('PURITY: the guard source uses no import attributes', () => {
  // `with { type: 'json' }` is the exact construct that breaks on the Node we guard
  // against. The guard reading the floor that way would be self-defeating.
  const src = readFileSync(join(ROOT, 'src', 'lib', 'node-version-guard.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bwith\s*\{\s*type\s*:/.test(code), 'guard must not use import attributes');
  assert.ok(!/\bassert\s*\{\s*type\s*:/.test(code), 'guard must not use import assertions');
});

check('ROOT RESOLUTION: a desynced dist mirror does not shadow the root package.json', () => {
  // The regression that motivated the outermost-match walk. dist/package.json is a tsc
  // mirror carrying the same `name` and an `engines` block, so a first-match-wins walk
  // from dist/src/lib/ would read the STALE floor, reintroducing this ticket's bug.
  const tmp = tempTree('nvg-root-');
  const start = join(tmp, 'dist', 'src', 'lib');
  mkdirSync(start, { recursive: true });
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', version: '0.8.4', engines: { node: '>=22.0.0' } }),
  );
  writeFileSync(
    join(tmp, 'dist', 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', version: '0.8.3', engines: { node: '>=18.0.0' } }),
  );

  const found = findRootPackageJson(start);
  assert.ok(found, 'must find a manifest');
  assert.strictEqual(found.engines.node, '>=22.0.0', 'must read the ROOT floor, not the dist mirror');
  assert.strictEqual(found.version, '0.8.4', 'must read the ROOT manifest, not the stale mirror');
});

check('ROOT RESOLUTION: the walk stops at a node_modules boundary', () => {
  // An installed copy must resolve to its own manifest and never climb into a consuming
  // project that happens to share the package name.
  const tmp = tempTree('nvg-nm-');
  const installed = join(tmp, 'node_modules', 'actual-mcp-server');
  const start = join(installed, 'dist', 'src', 'lib');
  mkdirSync(start, { recursive: true });
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', engines: { node: '>=99.0.0' } }),
  );
  writeFileSync(
    join(installed, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', engines: { node: '>=22.0.0' } }),
  );

  const found = findRootPackageJson(start);
  assert.strictEqual(found.engines.node, '>=22.0.0', 'must stop at the installed package root');
});

check('ROOT RESOLUTION: returns null when no matching manifest is in range', () => {
  const tmp = tempTree('nvg-none-');
  const start = join(tmp, 'a', 'b');
  mkdirSync(start, { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'some-other-package' }));
  assert.strictEqual(findRootPackageJson(start), null);
});

check('ROOT RESOLUTION: a malformed package.json is skipped, not thrown on', () => {
  const tmp = tempTree('nvg-bad-');
  const start = join(tmp, 'dist');
  mkdirSync(start, { recursive: true });
  writeFileSync(join(start, 'package.json'), '{ this is not json');
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', engines: { node: '>=22.0.0' } }),
  );
  assert.strictEqual(findRootPackageJson(start).engines.node, '>=22.0.0');
});

check('ROOT RESOLUTION: the walk stops when the chain of package.json files breaks', () => {
  // A checkout nested inside another checkout of itself. Without the break the walk
  // climbs out of the inner repo and enforces the OUTER manifest's floor.
  const tmp = tempTree('nvg-nested-');
  const outer = join(tmp, 'outer');
  const inner = join(outer, 'vendor', 'actual-mcp-server');
  const start = join(inner, 'dist', 'src', 'lib');
  mkdirSync(start, { recursive: true });
  mkdirSync(join(outer, 'vendor'), { recursive: true });
  writeFileSync(
    join(outer, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', engines: { node: '>=99.0.0' } }),
  );
  writeFileSync(
    join(inner, 'package.json'),
    JSON.stringify({ name: 'actual-mcp-server', engines: { node: '>=22.0.0' } }),
  );
  // `vendor/` has no package.json, so the chain breaks there and the inner root wins.
  const found = findRootPackageJson(start);
  assert.strictEqual(found.engines.node, '>=22.0.0', 'must not climb past the inner package root');
});

check('OUTPUT: the guard writes with fs.writeSync, not process.stderr.write', () => {
  // Node's stderr is asynchronous when it is a pipe on POSIX, which is exactly how an
  // MCP client captures it. process.stderr.write() followed by process.exit() can be
  // torn down before the buffer flushes, dropping the very message the guard exists to
  // deliver. Verified empirically: a 400KB piped write lost everything past 64KB.
  const src = readFileSync(join(ROOT, 'src', 'lib', 'node-version-guard.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(/writeSync\(2,/.test(code), 'guard must write to fd 2 synchronously');
  assert.ok(!/process\.stderr\.write/.test(code), 'guard must not use the async stderr stream before exit');
});

check('OUTPUT: the guard never writes to stdout (stdio JSON-RPC framing)', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'node-version-guard.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/console\.log|process\.stdout|writeSync\(1,/.test(code), 'guard must keep stdout clean');
});

check('the REAL tree resolves to the real root floor', () => {
  const found = findRootPackageJson(join(ROOT, 'dist', 'src', 'lib'));
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(found, 'guard must resolve the root package.json from the compiled location');
  assert.strictEqual(found.engines.node, rootPkg.engines.node);
  assert.strictEqual(found.version, rootPkg.version, 'must not have read the dist mirror');
});

check('the running interpreter satisfies the floor it declares (self-consistency)', () => {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(checkNodeVersion(process.version, rootPkg.engines.node).ok, true);
});

console.log(`\n[node-version-guard] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
