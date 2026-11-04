// #626: startup names the real HTTP auth mode instead of a hardcoded
// "OAuth Required: false". Pure table over describeAuthMode plus source guards on
// src/index.ts and, since #623, the sys_startup builder in src/lib/startupRecord.ts. Imports from dist/, so `npm run build` must run first.
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { stripTsComments } from './helpers/source-text.js';

const { describeAuthMode } = await import('../../dist/src/lib/authPosture.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

console.log('[auth-mode] describeAuthMode');
const rows = [
  ['OIDC wins over any token', { oidcEnabled: true, hasStaticTokens: false, hasSseAuthorization: true }, 'oidc'],
  ['static tokens are named', { oidcEnabled: false, hasStaticTokens: true, hasSseAuthorization: true }, 'static'],
  ['a single bearer token is named', { oidcEnabled: false, hasStaticTokens: false, hasSseAuthorization: true }, 'bearer'],
  ['nothing configured is none', { oidcEnabled: false, hasStaticTokens: false, hasSseAuthorization: false }, 'none'],
];
for (const [label, input, want] of rows) {
  check(label, () => assert.strictEqual(describeAuthMode(input), want));
}

console.log('\n[auth-mode] wiring in src/index.ts and src/lib/startupRecord.ts');
const index = stripTsComments(readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8'));
// #623: the banner became the sys_startup record, so the mode is computed in the record builder.
const record = stripTsComments(readFileSync(new URL('../../src/lib/startupRecord.ts', import.meta.url), 'utf8'));

check('the hardcoded OAuth Required literal is gone', () => {
  assert.ok(!index.includes('OAuth Required'), 'src/index.ts still contains "OAuth Required"');
});

check('the startup record reports describeAuthMode', () => {
  assert.match(record, /mode: describeAuthMode\(/);
});

check('inputs use the blank-means-off rules (static trimmed, bearer untrimmed)', () => {
  assert.match(record, /hasStaticTokens: staticTokensConfigured\(env\.MCP_STATIC_TOKENS\)/);
  // A whitespace-only MCP_SSE_AUTHORIZATION is a live credential, so it reports bearer.
  assert.match(record, /hasSseAuthorization: !!env\.MCP_SSE_AUTHORIZATION,/);
  assert.match(record, /oidcEnabled: env\.AUTH_PROVIDER === 'oidc',\n\s*hasStaticTokens/);
});

console.log(`\n[auth-mode] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
