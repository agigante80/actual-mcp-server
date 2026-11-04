// tests/unit/budget_registry_parse.test.js
//
// parseBudgetRegistry (src/lib/budget-registry.ts) turns the default ACTUAL_* config plus
// any BUDGET_N_* env vars into the multi-budget registry (a documented feature). Only its
// #161 security branch (encryption password over http) was tested; the CORE parsing was
// not, so a regression in the fallbacks, the default-budget entry, the lowercase keying, or
// the numbering-gap behaviour would silently misconfigure multi-budget users. This pins it.
//
// process.exit(1) is the failure signal (missing sync id / #161); we spy on it the same way
// config_insecure_upstream.test.js does, throwing a sentinel so parsing stops like a real exit.
//
// Run: node tests/unit/budget_registry_parse.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  parseBudgetRegistry, MAX_BUDGET_SCAN, formatBudgetRegistrySummary, logSafeOrigin,
} from '../../dist/src/lib/budget-registry.js';
import { stripTsComments } from './helpers/source-text.js';

const DEFAULTS = { serverUrl: 'https://actual.example.com', password: 'defpass', syncId: 'default-sync', encryptionPassword: undefined };

// Spy on process.exit: throw a sentinel so control stops (as a real exit would), and record.
class ExitSignal extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
function withExitSpy(fn) {
  const orig = process.exit;
  // Silence the expected `[CONFIG] ...` error diagnostics the exit paths print, so a reader
  // scanning CI logs does not see red-looking stderr next to passing cases. Capture
  // console.warn (#289 numbering-gap warning) so its content can be asserted.
  const origErr = console.error;
  const origWarn = console.warn;
  let exitedCode = null;
  const warns = [];
  const errors = [];
  process.exit = (code) => { exitedCode = code ?? 0; throw new ExitSignal(exitedCode); };
  console.error = (...a) => { errors.push(a.join(' ')); };
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try { const value = fn(); return { value, exitedCode, warns, errors }; }
  catch (e) { if (e instanceof ExitSignal) return { value: undefined, exitedCode, warns, errors }; throw e; }
  finally { process.exit = orig; console.error = origErr; console.warn = origWarn; }
}

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[budget-registry-parse] parseBudgetRegistry core parsing');

check('default budget only: one entry keyed by "default" (lowercased) with the default config', () => {
  const { value: reg, exitedCode } = withExitSpy(() => parseBudgetRegistry({}, DEFAULTS));
  assert.strictEqual(exitedCode, null, 'no exit on the happy path');
  assert.strictEqual(reg.size, 1);
  assert.ok(reg.has('default'), 'keyed by lowercased "Default"');
  assert.deepStrictEqual(reg.get('default'), {
    name: 'Default', serverUrl: DEFAULTS.serverUrl, password: DEFAULTS.password, syncId: DEFAULTS.syncId, encryptionPassword: undefined,
  });
});

check('BUDGET_DEFAULT_NAME renames the default entry (key is lowercased)', () => {
  const { value: reg } = withExitSpy(() => parseBudgetRegistry({ BUDGET_DEFAULT_NAME: 'Household' }, DEFAULTS));
  assert.ok(reg.has('household'), 'keyed by lowercased custom name');
  assert.strictEqual(reg.get('household').name, 'Household', 'display name preserves case');
});

check('an extra budget with all fields is registered alongside the default', () => {
  const env = {
    BUDGET_1_NAME: 'Business', BUDGET_1_SYNC_ID: 'biz-sync',
    BUDGET_1_SERVER_URL: 'https://biz.example.com', BUDGET_1_PASSWORD: 'bizpass', BUDGET_1_ENCRYPTION_PASSWORD: 'bizenc',
  };
  const { value: reg } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 2);
  assert.deepStrictEqual(reg.get('business'), {
    name: 'Business', serverUrl: 'https://biz.example.com', password: 'bizpass', syncId: 'biz-sync', encryptionPassword: 'bizenc',
  });
});

check('an extra budget falls back to the default serverUrl/password when they are omitted', () => {
  const { value: reg } = withExitSpy(() => parseBudgetRegistry({ BUDGET_1_NAME: 'Savings', BUDGET_1_SYNC_ID: 'sav-sync' }, DEFAULTS));
  const b = reg.get('savings');
  assert.strictEqual(b.serverUrl, DEFAULTS.serverUrl, 'serverUrl falls back to default');
  assert.strictEqual(b.password, DEFAULTS.password, 'password falls back to default');
  assert.strictEqual(b.syncId, 'sav-sync');
});

check('multiple sequential extra budgets are all registered', () => {
  const env = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2',
  };
  const { value: reg } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 3, 'default + two');
  assert.ok(reg.has('one') && reg.has('two'));
});

check('a gap in the numbering still drops later budgets (load UNCHANGED) but now WARNS about it (#289)', () => {
  const env = {
    BUDGET_1_NAME: 'First', BUDGET_1_SYNC_ID: 's1',
    // BUDGET_2_* deliberately absent
    BUDGET_3_NAME: 'Third', BUDGET_3_SYNC_ID: 's3', BUDGET_3_PASSWORD: 'topsecret', BUDGET_3_ENCRYPTION_PASSWORD: 'enc-secret',
  };
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  // Load behaviour is unchanged (backward compatible).
  assert.strictEqual(reg.size, 2, 'default + First only; Third is never reached');
  assert.ok(reg.has('first') && !reg.has('third'), 'Third dropped by the numbering gap');
  // #289: exactly one warning naming the missing index, the ignored index, and IGNORED.
  assert.strictEqual(warns.length, 1, 'exactly one warning');
  const w = warns[0];
  assert.ok(w.includes('BUDGET_2'), 'names the missing index');
  assert.ok(w.includes('BUDGET_3'), 'names the ignored index');
  assert.ok(w.includes('IGNORED'), 'says IGNORED');
  // Must not leak any secret value in the diagnostic.
  assert.ok(!w.includes('topsecret') && !w.includes('enc-secret'), 'no password/encryption value in the warning');
});

check('a gap at BUDGET_1 (extras start at BUDGET_2) warns without a nonsensical "BUDGET_0"', () => {
  const env = { BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2' }; // no BUDGET_1
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 1, 'only the default loads; BUDGET_2 is orphaned by the missing BUDGET_1');
  assert.strictEqual(warns.length, 1);
  assert.ok(warns[0].includes('BUDGET_1') && warns[0].includes('BUDGET_2') && warns[0].includes('IGNORED'));
  assert.ok(!warns[0].includes('BUDGET_0'), 'no nonsensical BUDGET_0 in the message');
});

check('consecutive budgets emit NO gap warning (no false positive)', () => {
  const env = { BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1', BUDGET_2_NAME: 'Two', BUDGET_2_SYNC_ID: 's2' };
  const { value: reg, warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(reg.size, 3, 'default + two loaded');
  assert.strictEqual(warns.length, 0, 'no warning when the numbering is contiguous');
});

check('multiple orphaned indices are listed in a SINGLE warning', () => {
  const env = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    // BUDGET_2 absent
    BUDGET_3_NAME: 'Three', BUDGET_3_SYNC_ID: 's3',
    BUDGET_7_NAME: 'Seven', BUDGET_7_SYNC_ID: 's7',
  };
  const { warns } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(warns.length, 1, 'one warning, not one per gap');
  assert.ok(warns[0].includes('BUDGET_3') && warns[0].includes('BUDGET_7'), 'lists both orphaned indices');
});

check('the gap scan is bounded by MAX_BUDGET_SCAN: an orphan at the ceiling warns, one just beyond does not', () => {
  const atCeiling = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    [`BUDGET_${MAX_BUDGET_SCAN}_NAME`]: 'Edge', [`BUDGET_${MAX_BUDGET_SCAN}_SYNC_ID`]: 'se',
  };
  const { warns: inRange } = withExitSpy(() => parseBudgetRegistry(atCeiling, DEFAULTS));
  assert.strictEqual(inRange.length, 1, `an orphan at BUDGET_${MAX_BUDGET_SCAN} is detected`);

  const beyond = {
    BUDGET_1_NAME: 'One', BUDGET_1_SYNC_ID: 's1',
    [`BUDGET_${MAX_BUDGET_SCAN + 1}_NAME`]: 'Over', [`BUDGET_${MAX_BUDGET_SCAN + 1}_SYNC_ID`]: 'so',
  };
  const { warns: outOfRange } = withExitSpy(() => parseBudgetRegistry(beyond, DEFAULTS));
  assert.strictEqual(outOfRange.length, 0, `the scan does not iterate past BUDGET_${MAX_BUDGET_SCAN} (bounded)`);
});

check('a BUDGET_N_NAME with no BUDGET_N_SYNC_ID exits(1)', () => {
  const { exitedCode } = withExitSpy(() => parseBudgetRegistry({ BUDGET_1_NAME: 'NoSync' }, DEFAULTS));
  assert.strictEqual(exitedCode, 1, 'missing sync id is a fatal config error');
});

check('#161: an extra budget with an encryption password over http:// exits(1) unless overridden', () => {
  const env = { BUDGET_1_NAME: 'Enc', BUDGET_1_SYNC_ID: 's1', BUDGET_1_SERVER_URL: 'http://lan.local', BUDGET_1_ENCRYPTION_PASSWORD: 'secret' };
  const { exitedCode } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(exitedCode, 1, 'refuses encryption password over plaintext upstream');
  const { exitedCode: allowed } = withExitSpy(() => parseBudgetRegistry({ ...env, ALLOW_INSECURE_UPSTREAM: 'true' }, DEFAULTS));
  assert.strictEqual(allowed, null, 'ALLOW_INSECURE_UPSTREAM=true overrides');
});

console.log('\n[budget-registry-parse] #621 log-safe server URLs');

const reg = (...entries) => new Map(entries.map(([name, serverUrl, password = 'pw']) =>
  [name.toLowerCase(), { name, serverUrl, password, syncId: `${name}-sync` }]));

check('#621: summary counts a default and a userinfo budget as two servers, https only', () => {
  const r = reg(['Default', 'https://actual.example'], ['Household', 'https://proxyuser:proxypass@actual.example']);
  const text = formatBudgetRegistrySummary(r);
  assert.strictEqual(text, 'Budget registry: 2 budget(s) across 2 server(s) (https)');
  for (const leak of ['Default', 'Household', 'actual.example', 'proxyuser', 'proxypass']) {
    assert.ok(!text.includes(leak), `summary must not contain ${leak}`);
  }
});

check('#621: summary for one budget', () => {
  assert.strictEqual(formatBudgetRegistrySummary(reg(['Default', 'https://actual.example'])),
    'Budget registry: 1 budget(s) across 1 server(s) (https)');
});

check('#621: two budgets on one server with one password count once', () => {
  assert.strictEqual(formatBudgetRegistrySummary(reg(['Default', 'http://actual:5006'], ['Office', 'http://actual:5006'])),
    'Budget registry: 2 budget(s) across 1 server(s) (http)');
});

check('#621: mixed schemes are sorted and joined', () => {
  assert.strictEqual(formatBudgetRegistrySummary(reg(['Default', 'https://a.example'], ['Office', 'http://b.example'])),
    'Budget registry: 2 budget(s) across 2 server(s) (http, https)');
});

check('#621: a malformed server URL renders as invalid and does not throw', () => {
  assert.strictEqual(formatBudgetRegistrySummary(reg(['Default', 'https://a.example'], ['Broken', 'not a url'])),
    'Budget registry: 2 budget(s) across 2 server(s) (https, invalid)');
});

check('#621: a schemeless userinfo URL renders as other, leaking nothing', () => {
  const text = formatBudgetRegistrySummary(reg(['Default', 'https://a.example'], ['Typo', 'proxyuser:proxypass@actual.example']));
  assert.strictEqual(text, 'Budget registry: 2 budget(s) across 2 server(s) (https, other)');
  for (const leak of ['proxyuser', 'proxypass', 'actual.example']) assert.ok(!text.includes(leak), leak);
});

check('#621: a schemeless host:port renders as other, leaking nothing', () => {
  const text = formatBudgetRegistrySummary(reg(['Default', 'https://a.example'], ['Typo', 'actual.example:5006']));
  assert.strictEqual(text, 'Budget registry: 2 budget(s) across 2 server(s) (https, other)');
  assert.ok(!text.includes('actual.example'));
});

check('#621: logSafeOrigin maps a null origin to the invalid marker', () => {
  assert.strictEqual(logSafeOrigin('proxyuser:proxypass@actual.example'), '<invalid url>');
});

check('#621: logSafeOrigin strips userinfo and path', () => {
  assert.strictEqual(logSafeOrigin('https://u:p@actual.example:5006/path'), 'https://actual.example:5006');
});

check('#621: logSafeOrigin drops a query-string credential', () => {
  const out = logSafeOrigin('https://actual.example/?token=abc123');
  assert.strictEqual(out, 'https://actual.example');
  assert.ok(!out.includes('abc123'));
});

check('#621: registry parsing keeps the login URL credential', () => {
  const env = { BUDGET_1_NAME: 'Household', BUDGET_1_SYNC_ID: 'b', BUDGET_1_SERVER_URL: 'https://proxyuser:proxypass@actual.example' };
  const { value } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(value.get('household').serverUrl, 'https://proxyuser:proxypass@actual.example');
});

check('#621: the http exit message prints the origin, not the userinfo', () => {
  const env = { BUDGET_1_NAME: 'Office', BUDGET_1_SYNC_ID: 'x', BUDGET_1_ENCRYPTION_PASSWORD: 'x', BUDGET_1_SERVER_URL: 'http://u:p@host:5006' };
  const { exitedCode, errors } = withExitSpy(() => parseBudgetRegistry(env, DEFAULTS));
  assert.strictEqual(exitedCode, 1);
  const text = errors.join('\n');
  assert.ok(text.includes('http://host:5006'), text);
  assert.ok(!text.includes('u:p'), text);
});

const SOURCES = ['src/lib/actual-adapter.ts', 'src/lib/budget-registry.ts'].map((f) => [f, stripTsComments(readFileSync(f, 'utf8'))]);

check('#621: every serverUrl interpolation goes through logSafeOrigin, multi-line calls included', () => {
  let total = 0;
  for (const [file, text] of SOURCES) {
    // Whole-file scan, never per line: several log calls span lines.
    for (const m of text.match(/\$\{[^}]*[sS]erverUrl[^}]*\}/g) ?? []) {
      total++;
      assert.ok(m.includes('logSafeOrigin('), `${file}: raw serverUrl interpolation ${m}`);
    }
  }
  assert.ok(total >= 5, `expected at least 5 serverUrl interpolations, found ${total}`);
});

// #628 adds two display sites outside an interpolation: the tool-result value in switchBudget
// (`const shownServerUrl = ...`) and the `serverUrl:` property in getBudgetRegistry. Both are
// allowed by their exact text; anything else (an origin fed to a login) still fails here.
const DISPLAY_SITES = ['const shownServerUrl = ', 'serverUrl: '];
check('#621: logSafeOrigin only ever appears inside an interpolation in the adapter', () => {
  const text = SOURCES[0][1];
  let count = 0;
  let display = 0;
  for (const m of text.matchAll(/logSafeOrigin\(/g)) {
    if (text.slice(Math.max(0, m.index - 80), m.index).includes('import {')) continue;
    if (DISPLAY_SITES.some((d) => text.slice(m.index - d.length, m.index) === d)) { display++; continue; }
    count++;
    const open = text.lastIndexOf('${', m.index);
    const close = text.lastIndexOf('}', m.index);
    assert.ok(open !== -1 && open > close, `logSafeOrigin( at offset ${m.index} is not inside \${...}`);
  }
  assert.ok(count >= 4, `expected at least 4 adapter call sites, found ${count}`);
  assert.strictEqual(display, 2, `expected exactly 2 #628 display sites, found ${display}`);
});

check('#628: the switch display value is only ever returned, never passed on', () => {
  const uses = [...SOURCES[0][1].matchAll(/shownServerUrl/g)].map((m) => SOURCES[0][1].slice(m.index - 11, m.index));
  assert.strictEqual(uses.length, 4, `expected 1 declaration and 3 returns, found ${uses.length}`);
  assert.strictEqual(uses.filter((u) => u === 'serverUrl: ').length, 3, uses.join(' | '));
});

console.log(`\n[budget-registry-parse] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
