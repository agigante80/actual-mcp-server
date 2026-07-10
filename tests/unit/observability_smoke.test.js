// tests/unit/observability_smoke.test.js
//
// #279: resurrected from src/tests/observability.smoke.test.ts, which was dead code.
//
// It was imported by nothing, referenced by no npm script, and was not a knip.json
// entry, yet `project: ["src/**/*.ts"]` meant tsc compiled it into dist/ and
// `files: ["dist/"]` meant it SHIPPED to users in the npm tarball. knip 6.17.1 missed
// it; 6.25.0 flagged it, correctly. Rather than silence the finding with an ignore, the
// test moves here, runs in the test:unit-js chain, and stops shipping.
//
// What it guards: `prom-client` is an OPTIONAL dependency (package.json
// optionalDependencies). src/observability.ts dynamically imports it and degrades to a
// no-op when it is absent. So both observability entry points must be safe to call in an
// install that has no prom-client, and getMetricsText() must return null there rather
// than throwing. Asserting `typeof === 'string'` unconditionally would pass here and
// fail on a --no-optional install, which is precisely the environment this protects.
//
// Run: node tests/unit/observability_smoke.test.js

import assert from 'assert';

const { incrementToolCall, getMetricsText } = await import('../../dist/src/observability.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
async function checkAsync(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[observability-smoke]');

let promClientPresent;
try { await import('prom-client'); promClientPresent = true; }
catch { promClientPresent = false; }
console.log(`  (prom-client ${promClientPresent ? 'present' : 'ABSENT'}: an optional dependency)`);

await checkAsync('incrementToolCall does not throw, with or without prom-client', async () => {
  await incrementToolCall('test.tool');
});

await checkAsync('incrementToolCall is safe to call repeatedly', async () => {
  await incrementToolCall('test.tool');
  await incrementToolCall('test.tool');
});

let metrics;
await checkAsync('getMetricsText does not throw', async () => {
  metrics = await getMetricsText();
});

check('getMetricsText returns null or a string (null when prom-client is absent)', () => {
  assert.ok(
    metrics === null || typeof metrics === 'string',
    `expected null or string, got ${typeof metrics}`,
  );
});

check('the return type matches whether prom-client is installed', () => {
  if (promClientPresent) assert.strictEqual(typeof metrics, 'string', 'prom-client present: expected a metrics string');
  else assert.strictEqual(metrics, null, 'prom-client absent: expected null, not a throw');
});

check('when present, the metrics text carries the counter we just incremented', () => {
  if (!promClientPresent) return; // nothing to assert on a no-optional install
  assert.ok(metrics.includes('test'), 'expected the incremented tool counter to appear in the metrics text');
});

console.log(`\n[observability-smoke] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
