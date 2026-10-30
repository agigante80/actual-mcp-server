// tests/unit/unraid_template_alignment.test.js
//
// #227: the committed Unraid CA template (unraid/actual-mcp-server.xml) must not
// drift from the app's canonical values, and must keep its security posture. A
// wrong port or data path in the template is the top end-user support issue, and
// an unmasked secret leaks in the Unraid UI. This guard pins, by text-parsing:
//   - the template port Config to the canonical MCP_BRIDGE_PORT (src/config.ts)
//   - the Data Config target to the Dockerfile in-image data dir
//   - the image to the published ghcr.io repository
//   - Mask="true" on the secret vars, and Required="true" on the auth token
// Mirrors tests/unit/port_alignment.test.js (text parse, no build needed).
//
// Run: node tests/unit/unraid_template_alignment.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Canonical sources of truth.
const canonPort = read('src/config.ts').match(/MCP_BRIDGE_PORT:\s*z\.string\(\)\.default\(['"](\d+)['"]\)/);
assert(canonPort, 'could not parse MCP_BRIDGE_PORT default from src/config.ts');
const CANON_PORT = canonPort[1];
const canonData = read('Dockerfile').match(/ENV\s+MCP_BRIDGE_DATA_DIR=(\S+)/);
assert(canonData, 'could not parse ENV MCP_BRIDGE_DATA_DIR from Dockerfile');
const CANON_DATA = canonData[1];

const TPL = read('unraid/actual-mcp-server.xml');

// Return the single <Config ...> element line whose Target attribute equals `target`.
function configLine(tpl, target) {
  const line = tpl.split('\n').find((l) => l.includes(`Target="${target}"`));
  assert(line, `no <Config> with Target="${target}" in the template`);
  return line;
}

console.log('\n[unraid-template-alignment]');
console.log(`  canonical port=${CANON_PORT} data dir=${CANON_DATA}`);

check('template port Config matches the canonical MCP_BRIDGE_PORT', () => {
  const m = configLine(TPL, CANON_PORT).match(/Type="Port"/);
  assert(m, `the port Config Target is not ${CANON_PORT}`);
  // and the WebUI advertises the same port
  const webui = TPL.match(/\[PORT:(\d+)\]/);
  assert(webui && webui[1] === CANON_PORT, `WebUI [PORT:${webui && webui[1]}] != ${CANON_PORT}`);
});

check('template Data Config target matches the Dockerfile data dir', () => {
  const line = configLine(TPL, CANON_DATA);
  assert(/Name="Data"/.test(line), `the Config with Target="${CANON_DATA}" is not the Data mount`);
});

check('template Repository is the published ghcr.io image', () => {
  assert(/<Repository>ghcr\.io\/agigante80\/actual-mcp-server:latest<\/Repository>/.test(TPL),
    'Repository is not ghcr.io/agigante80/actual-mcp-server:latest');
});

check('secret vars carry Mask="true"', () => {
  for (const target of ['MCP_SSE_AUTHORIZATION', 'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_SYNC_ID']) {
    assert(/Mask="true"/.test(configLine(TPL, target)), `${target} is not Mask="true" (would render in plaintext)`);
  }
});

check('the auth token is Required="true" (no silent open-by-default)', () => {
  assert(/Required="true"/.test(configLine(TPL, 'MCP_SSE_AUTHORIZATION')),
    'MCP_SSE_AUTHORIZATION must be Required="true"');
});

// #601: since #242 a non-loopback bind with no token and no OIDC refuses to start, so the old
// "a blank token disables all HTTP authentication" warning is false. Matched case-insensitively
// because the live copies used both "ALL" and "all". The guard now pins the accurate posture.
check('the Description states the refuse-to-start posture, not the stale blank-token warning', () => {
  assert(!/blank (token|value) disables|disables all HTTP auth/i.test(TPL), 'stale blank-token warning');
  assert(/openssl rand -hex 32/.test(TPL), 'missing openssl rand -hex 32');
  assert(/refuses to start/i.test(TPL), 'missing refuses to start');
  assert(/does not replace the token/i.test(TPL), 'missing does not replace the token');
  assert(/MCP_ALLOW_UNAUTHENTICATED/.test(TPL), 'missing MCP_ALLOW_UNAUTHENTICATED');
});

check('the Description lists every unauthenticated endpoint', () => {
  for (const ep of ['/health', '/metrics', '/mcp-info', '/mcp-info/http', '/.well-known/']) {
    assert(TPL.includes(ep), `missing unauthenticated endpoint ${ep}`);
  }
});

check('the port Config does not list /http as unauthenticated', () => {
  const line = configLine(TPL, CANON_PORT);
  assert(!/unauthenticated[^.]*\(\/http,/.test(line), '/http needs the token and is not an unauthenticated endpoint');
  assert(/\/mcp-info\/http/.test(line), 'port Config must name /mcp-info and /mcp-info/http');
});

// NEGATIVE: the comparators flag the stale phrases and a dropped command (case-insensitive).
const STALE = /blank (token|value) disables|disables all HTTP auth/i;
check('NEGATIVE: the stale blank-token phrase is flagged in either case', () => {
  assert(STALE.test('a BLANK value disables ALL HTTP authentication'));
  assert(STALE.test('A blank token disables all HTTP authentication'));
  assert(!STALE.test('the server refuses to start on a non-loopback bind'));
});

// NEGATIVE: a drifted port in a synthetic template line is detected by the same comparator.
check('NEGATIVE: a drifted port Config is flagged', () => {
  const fixture = '<Config Name="WebUI / Health Port" Target="9999" Type="Port">9999</Config>';
  let flagged = false;
  try { assert(fixture.includes(`Target="${CANON_PORT}"`), 'drift'); } catch { flagged = true; }
  assert(flagged, 'comparator must flag a port that is not canonical');
});

console.log(`\n[unraid-template-alignment] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
