#!/usr/bin/env node
/**
 * #840: report when the installed `@actual-app/api` no longer matches what the experimental
 * feature `budget_automations` (MCP_EXPERIMENTAL) assumed, and NEVER fail.
 *
 * The read tool actual_categories_get_automations rests on four facts about one upstream
 * bundle, none of them a public contract:
 *   1. the stored columns `template_settings`, `goal_def`, `cleanup_def` and the
 *      `cleanup_groups` table still exist;
 *   2. note directives are still `#template`, `#goal` and `#cleanup`;
 *   3. the currency table still gives 0 decimal places to exactly IRR, JPY and KRW, which is
 *      what src/lib/schemas/automations.ts ZERO_DECIMAL_CURRENCIES copies, and every other
 *      entry 2 places;
 *   4. every currency entry's `decimalPlaces` is 0 or 2 (the converter only knows those).
 * A new 0-place code or a third place count would make the tool return amounts off by 100x
 * or 10x with no error, so the canary names it.
 *
 * WHY THIS CANNOT FAIL THE BUILD, EVER. Same rule as check-write-effect-audit.mjs (#321): a
 * check whose result changes with no commit belongs in the non-blocking api-surface-drift
 * lane. Exit code is 0 in every path, including a missing bundle. Pure core `checkBundle` is
 * unit-tested with fixtures (tests/unit/experimental_surface_canary.test.js).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_PATH = join(ROOT, 'node_modules', '@actual-app', 'api', 'dist', 'index.js');

/** The 0-place codes the adapter copies (src/lib/schemas/automations.ts). */
export const EXPECTED_ZERO_DECIMAL = ['IRR', 'JPY', 'KRW'];

/** Strings the read tool depends on, each with what it is for. */
export const REQUIRED_STRINGS = [
  ['template_settings', 'the column that says whether the editor or the notes manage a category'],
  ['goal_def', 'the stored automations'],
  ['cleanup_def', 'the stored cleanup roles'],
  ['cleanup_groups', 'the cleanup group names'],
  ['#template', 'the note directive'],
  ['#goal', 'the note directive'],
  ['#cleanup', 'the note directive'],
];

/** Extract `[{ code, decimalPlaces }]` from the bundle's `var currencies = [ ... ];` table. */
export function readCurrencyTable(text) {
  const start = text.indexOf('var currencies = [');
  if (start === -1) return null;
  const end = text.indexOf('\n];', start);
  if (end === -1) return null;
  const body = text.slice(start, end);
  const out = [];
  const entry = /code:\s*"([^"]*)"[\s\S]*?decimalPlaces:\s*(\d+)/g;
  let m;
  while ((m = entry.exec(body)) !== null) out.push({ code: m[1], decimalPlaces: Number(m[2]) });
  // The pattern needs `code` before `decimalPlaces`. If the bundle ever orders an entry the other way
  // the pattern skips it, so an entry count that disagrees means the table is unreadable, not clean.
  if (out.length !== (body.match(/\bcode:\s*"/g) ?? []).length) return null;
  return out;
}

/**
 * Pure: bundle text in, findings out (an empty list means nothing drifted). Never throws.
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function checkBundle(text) {
  if (typeof text !== 'string' || text.length === 0) return ['the installed @actual-app/api bundle could not be read'];
  const findings = [];
  for (const [needle, why] of REQUIRED_STRINGS) {
    if (!text.includes(needle)) findings.push(`the bundle no longer contains "${needle}" (${why})`);
  }
  const table = readCurrencyTable(text);
  if (!table || table.length === 0) {
    findings.push('the currency table (var currencies = [...]) was not found, so the 0-place list cannot be checked');
    return findings;
  }
  const zero = table.filter((c) => c.decimalPlaces === 0).map((c) => c.code).sort();
  const expected = [...EXPECTED_ZERO_DECIMAL].sort();
  if (zero.join(',') !== expected.join(',')) {
    findings.push(
      `0-place currency codes are [${zero.join(', ')}], the adapter assumes [${expected.join(', ')}]: update ZERO_DECIMAL_CURRENCIES in src/lib/schemas/automations.ts`,
    );
  }
  const odd = table.filter((c) => c.decimalPlaces !== 0 && c.decimalPlaces !== 2);
  if (odd.length > 0) {
    findings.push(`currencies with a place count other than 0 or 2: ${odd.map((c) => `${c.code || '(none)'}=${c.decimalPlaces}`).join(', ')}`);
  }
  return findings;
}

function main() {
  let text = null;
  try {
    text = readFileSync(BUNDLE_PATH, 'utf8');
  } catch {
    console.log('experimental surface: the installed @actual-app/api bundle was not found. Nothing to check.');
    return 0;
  }
  const findings = checkBundle(text);
  if (findings.length === 0) {
    console.log('experimental surface: current. The budget_automations assumptions hold for the installed @actual-app/api.');
    return 0;
  }
  console.log('experimental surface: DRIFT. The feature budget_automations (MCP_EXPERIMENTAL) may be wrong for the installed @actual-app/api:');
  for (const f of findings) console.log(`  - ${f}`);
  console.log('');
  console.log('This is a reminder, not a gate. The run stays green.');
  return 0;
}

// Exact entry-point check through realpath (same reason as check-write-effect-audit.mjs: a
// symlinked checkout would otherwise make this a silent no-op). Degrades, never throws.
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
}

if (isDirectRun()) {
  process.exit(main());
}
