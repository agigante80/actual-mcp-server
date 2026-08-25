// tests/unit/write_effect_audit_staleness.test.js
// #362: the write-effect audit staleness reminder must REPORT and never fail.
//
// The one assertion that matters here is the exit code. #321: a check whose result
// changes with no commit used to live in the unit suite, an upstream release turned it
// red, the auto-release train died for two nights and a security PR sat blocked behind a
// failure nobody had caused. This script carries the same kind of signal, so it lives in
// the non-blocking api-surface-drift lane and exits 0 in every path.

import { readAuditedVersion, buildReport } from '../../scripts/check-write-effect-audit.mjs';
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

console.log('\n[#362] write-effect audit staleness reminder');

// ── the marker the whole check hangs on ────────────────────────────────────────
{
  const doc = readFileSync(new URL('../../docs/audit/write-effect-audit.md', import.meta.url), 'utf8');
  const version = readAuditedVersion(doc);
  check(typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version),
    'docs/audit/write-effect-audit.md carries a machine-readable audited-api-version marker');
}

// ── versions equal: current, no noise ──────────────────────────────────────────
{
  const { stale, lines } = buildReport('26.8.0', '26.8.0');
  check(stale === false,                              'equal versions are not stale');
  check(lines.join('\n').includes('current'),         'says it is current');
}

// ── versions differ: reports, names what to re-read ────────────────────────────
{
  const { stale, lines } = buildReport('26.8.0', '26.9.0');
  const text = lines.join('\n');
  check(stale === true,                               'different versions are stale');
  check(text.includes('26.8.0') && text.includes('26.9.0'), 'names both versions');
  check(/upstream throwing/i.test(text),              'says which dispositions to re-read');
  check(/not a gate/i.test(text),                     'says it is not a gate');
}

// ── malformed or missing marker: still not an error ────────────────────────────
{
  const { stale, lines } = buildReport(null, '26.9.0');
  check(stale === false,                              'a missing marker is not treated as stale');
  check(lines.join('\n').includes('#321'),            'points at why it does not enforce');
}
{
  const { stale } = buildReport('26.8.0', null);
  check(stale === false, 'an unreadable installed version is not treated as stale');
}

// ── the guard that matters: the script itself ALWAYS exits 0 ───────────────────
{
  const script = new URL('../../scripts/check-write-effect-audit.mjs', import.meta.url).pathname;
  let code = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout ?? '');
  }
  check(code === 0,
    'the script exits 0 against the real tree, whether or not the audit is stale');
  // Exit code alone is not enough: if the entry-point guard stops matching, main() never
  // runs, nothing is printed, and the exit code is still 0. That is how a reminder becomes
  // a silent no-op, which is the failure mode this whole file exists to prevent.
  check(/write-effect audit:/.test(out),
    'the CLI actually produced a report line (guards against a silent no-op)');

  // And it must behave identically through a symlinked path. Node realpaths
  // import.meta.url, so a naive argv[1] comparison silently disables the script when the
  // repo is reached through a symlink, which this one is.
  const linkDir = mkdtempSync(join(tmpdir(), 'wea-link-'));
  const link = join(linkDir, 'link');
  let linkedOut = '';
  try {
    symlinkSync(new URL('../../', import.meta.url).pathname, link, 'dir');
    linkedOut = execFileSync(process.execPath, [join(link, 'scripts', 'check-write-effect-audit.mjs')], { encoding: 'utf8' });
  } catch (e) {
    linkedOut = String(e.stdout ?? '');
  } finally {
    try { rmSync(linkDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  check(/write-effect audit:/.test(linkedOut),
    'the CLI still reports when invoked through a symlinked path');
}

console.log('');
if (failures === 0) console.log('[#362] All write-effect audit staleness tests passed ✓');
else { console.error(`[#362] ${failures} test(s) FAILED`); process.exit(2); }
