// tests/unit/experimental_surface_canary.test.js
//
// #840: scripts/check-experimental-surface.mjs reports when the installed @actual-app/api no
// longer matches what the experimental feature budget_automations assumed, and never fails.
// The pure core checkBundle is fed fixture bundles, because the REAL bundle is clean today and a
// check that only ever sees the clean case cannot fail. Fixtures cover a removed column, a fourth
// 0-place currency code and a third place count (the three drifts that make the tool return wrong
// money or wrong rows). One case reads the installed bundle (must be clean) and one runs the
// script as a process (exit 0 whatever it finds).
//
// Run via: npm run test:unit-js
// Or: node tests/unit/experimental_surface_canary.test.js

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkBundle, readCurrencyTable, EXPECTED_ZERO_DECIMAL, REQUIRED_STRINGS } from '../../scripts/check-experimental-surface.mjs';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const currencyTable = (rows) =>
  'var currencies = [\n' +
  rows.map(([code, places]) => `\t{\n\t\tcode: "${code}",\n\t\tname: "x",\n\t\tsymbol: "",\n\t\tdecimalPlaces: ${places},\n\t\tnumberFormat: "comma-dot",\n\t\tsymbolFirst: true\n\t}`).join(',\n') +
  '\n];\n';
const CLEAN_ROWS = [['', 2], ['USD', 2], ['HUF', 2], ['IRR', 0], ['JPY', 0], ['KRW', 0]];
const strings = (omit) => REQUIRED_STRINGS.map(([s]) => s).filter((s) => s !== omit).join('\n') + '\n';
const bundle = (rows = CLEAN_ROWS, omit = null) => strings(omit) + currencyTable(rows);

console.log('\n[#840] the pure core');
check(checkBundle(bundle()).length === 0, 'a clean bundle gives no findings', JSON.stringify(checkBundle(bundle())));
check(JSON.stringify(readCurrencyTable(bundle())) === JSON.stringify(CLEAN_ROWS.map(([code, decimalPlaces]) => ({ code, decimalPlaces }))), 'the currency table is read back as written');

{
  const f = checkBundle(bundle(CLEAN_ROWS, 'goal_def'));
  check(f.length === 1 && f[0].includes('"goal_def"'), 'NEGATIVE: a removed column is reported, naming it', JSON.stringify(f));
}
{
  const f = checkBundle(bundle(CLEAN_ROWS, '#cleanup'));
  check(f.length === 1 && f[0].includes('"#cleanup"'), 'NEGATIVE: a removed note directive is reported, naming it', JSON.stringify(f));
}
{
  const f = checkBundle(bundle([...CLEAN_ROWS, ['CLP', 0]]));
  check(f.length === 1 && f[0].includes('CLP') && f[0].includes('IRR, JPY, KRW'), 'NEGATIVE: a fourth 0-place code is reported, naming both lists', JSON.stringify(f));
}
{
  const f = checkBundle(bundle(CLEAN_ROWS.filter(([c]) => c !== 'KRW')));
  check(f.length === 1 && f[0].includes('[IRR, JPY]'), 'NEGATIVE: a 0-place code that became 2 places is reported too', JSON.stringify(f));
}
{
  const f = checkBundle(bundle([...CLEAN_ROWS, ['BHD', 3]]));
  check(f.length === 1 && f[0].includes('BHD=3'), 'NEGATIVE: a currency with 3 places is reported', JSON.stringify(f));
}
{
  const f = checkBundle(strings(null));
  check(f.length === 1 && f[0].includes('currency table'), 'NEGATIVE: a missing currency table is reported', JSON.stringify(f));
}
check(checkBundle('').length === 1 && checkBundle(null).length === 1 && checkBundle(undefined).length === 1, 'NEGATIVE: an unreadable bundle is reported once and never throws');
check(JSON.stringify(EXPECTED_ZERO_DECIMAL) === JSON.stringify(['IRR', 'JPY', 'KRW']), 'the expected list is the one the adapter copies');

console.log('\n[#840] the adapter and the canary agree on the 0-place list');
{
  const { ZERO_DECIMAL_CURRENCIES } = await import('../../dist/src/lib/schemas/automations.js');
  check(JSON.stringify([...ZERO_DECIMAL_CURRENCIES].sort()) === JSON.stringify([...EXPECTED_ZERO_DECIMAL].sort()), 'ZERO_DECIMAL_CURRENCIES equals the canary list');
}

console.log('\n[#840] the installed bundle and the script');
{
  const path = fileURLToPath(new URL('../../node_modules/@actual-app/api/dist/index.js', import.meta.url));
  let text = null;
  try { text = readFileSync(path, 'utf8'); } catch { /* absent: skip loudly below */ }
  if (text === null) console.log('  skip: the installed @actual-app/api bundle is absent');
  else {
    // Informational only: a real-bundle finding must never turn the unit suite red (#321).
    // The report-only lane (api-surface-drift) is where drift is surfaced.
    const f = checkBundle(text);
    console.log(`  info: installed bundle findings: ${f.length === 0 ? 'none' : f.join('; ')}`);
    const table = readCurrencyTable(text);
    check(table === null || Array.isArray(table), 'the table reader returns a list or null, never throws');
  }
  const script = fileURLToPath(new URL('../../scripts/check-experimental-surface.mjs', import.meta.url));
  let out = '';
  let code = 0;
  try { out = execFileSync(process.execPath, [script], { encoding: 'utf8' }); } catch (e) { code = e.status ?? 1; out = String(e.stdout ?? ''); }
  check(code === 0, 'the script exits 0', `exit ${code}`);
  check(out.startsWith('experimental surface:'), 'the script prints its status line', out.slice(0, 80));
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
