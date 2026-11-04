// tests/unit/server_no_console.test.js
//
// #625: server code never calls console.*. Under stdio, stdout is the JSON-RPC channel, and a
// console call also skips the module logger's structured metadata. The listen callback in
// httpServer.ts was the last offender (three console.info lines); it now writes one
// createModuleLogger('HTTP') record. This guard scans every comment-stripped src/server/*.ts.
// A console. inside a string literal also counts: no server string needs one.
//
// Run: node tests/unit/server_no_console.test.js

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripTsComments } from './helpers/source-text.js';

const SERVER_DIR = 'src/server';

/** The lines of already comment-stripped text that reference console. */
function consoleViolations(text) {
  return text.split('\n').filter((line) => /\bconsole\./.test(line)).map((line) => line.trim());
}

const serverFiles = readdirSync(SERVER_DIR).filter((f) => f.endsWith('.ts'));
const stripped = new Map(serverFiles.map((f) => [f, stripTsComments(readFileSync(join(SERVER_DIR, f), 'utf8'))]));

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[server-no-console] #625 server code logs through the logger');

check('no src/server/*.ts file calls console (comments stripped)', () => {
  assert.ok(serverFiles.includes('httpServer.ts'), 'the scan must cover httpServer.ts');
  const violations = [];
  for (const [file, text] of stripped) {
    for (const line of consoleViolations(text)) violations.push(`${file}: ${line}`);
  }
  assert.deepStrictEqual(violations, []);
});

check('a console call appended to httpServer.ts is caught exactly once', () => {
  const text = stripTsComments(`${readFileSync(join(SERVER_DIR, 'httpServer.ts'), 'utf8')}\nconsole.info('x');\n`);
  assert.strictEqual(consoleViolations(text).length, 1);
});

check('a lone console call is one violation, independent of the current tree', () => {
  assert.deepStrictEqual(consoleViolations(stripTsComments("const a = 1;\nconsole.info('x');\n")), ["console.info('x');"]);
});

check('a comment that mentions console is not a violation', () => {
  assert.deepStrictEqual(consoleViolations(stripTsComments('// the console.error(err) path\n')), []);
});

check('the listen record goes through the HTTP module logger with port, endpoint and health', () => {
  const text = stripped.get('httpServer.ts');
  assert.ok(text.includes("createModuleLogger('HTTP')"), 'httpServer.ts must create the HTTP module logger');
  assert.match(text, /httpLog\.info\([^\n]*listening on[^\n]*\{ port, endpoint: advertised, health \}\)/);
});

console.log(`\n[server-no-console] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
