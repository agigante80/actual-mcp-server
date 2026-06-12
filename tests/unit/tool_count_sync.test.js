// tests/unit/tool_count_sync.test.js  (#193)
// The CI gate for tool-count drift. Asserts scripts/tool-count.mjs finds zero drift
// (so a stale total-count literal cannot be merged), plus matcher units proving the
// TOTAL anchors match totals and never match subset "(N tools)" headers or fractions.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, l, d = '') => cond ? pass(l) : fail(l, d);

(async () => {
  const { getCanonicalCount, analyze, TOTAL_PATTERNS } = await import('../../scripts/tool-count.mjs');

  console.log('\n[#193] canonical count');
  const canon = getCanonicalCount();
  check(typeof canon === 'number' && canon > 0, `canonical count is a positive number (${canon})`);

  console.log('\n[#193] no drift (the CI gate)');
  const { drift, stale } = analyze();
  check(drift.length === 0, `no stale total-count literals`, drift.map((d) => `${d.file}:${d.line}=${d.found}`).slice(0, 8).join(', '));
  check(stale.length === 0, `no dead anchors`, stale.map((s) => s.label).join(', '));

  console.log('\n[#193] matcher: totals match, subsets/fractions do NOT');
  const matchesAny = (s) => TOTAL_PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(s); });
  const capturedFor = (s) => {
    for (const { re } of TOTAL_PATTERNS) { re.lastIndex = 0; const m = re.exec(s); if (m) return Number(m[1]); }
    return null;
  };
  // Totals SHOULD match (with the right captured number)
  check(capturedFor('all 70 tools') === 70, 'total "all 70 tools" matches with capture 70');
  check(capturedFor('70 tools, the most comprehensive') === 70, 'total "N tools, the most comprehensive" matches');
  check(capturedFor('ALL 71 TOOLS') === 71, 'total "ALL N TOOLS" matches');
  check(capturedFor('Docker E2E (70 tools)') === 70, 'total "E2E (N tools)" matches');
  check(capturedFor('70/70 tools smoke-validated') === 70, 'total "N/N tools" (equal halves) matches');
  // Forms that carry no lowercase " tools" token (the #193-review misses, now anchored)
  check(capturedFor('63-tool smoke, schema validation') === 63, 'hyphenated "N-tool smoke" matches');
  check(capturedFor('- **62 Implemented Tools** - coverage') === 62, 'docker "**N Implemented Tools**" matches');
  check(capturedFor('## Available Tools (62 Total)') === 62, 'docker "Available Tools (N Total)" matches');
  check(capturedFor('per-tool | 70 + shape checks |') === 70, 'TESTING "| N + shape checks" matches');
  check(capturedFor('| 70/70 |') === 70, 'TESTING "| N/N |" coverage cell matches');
  // Subsets and fractions must NOT match (no corruption)
  check(!matchesAny('### Transaction Management (12 tools)'), 'subset header "(12 tools)" does NOT match');
  check(!matchesAny('├── transactions_create.ts  # Transactions (13 tools)'), 'subset "(13 tools)" does NOT match');
  check(!matchesAny('Budgets (11 tools)'), 'subset "(11 tools)" does NOT match');
  check(!matchesAny('| Full (10 tools) |'), 'subset "Full (10 tools)" does NOT match');
  check(!matchesAny('6 exclusive ActualQL-powered tools'), 'subset "6 exclusive ... tools" does NOT match');
  check(!matchesAny('68/70 tools with named tests; 2 tools excluded'), 'fraction "68/70 tools" does NOT match');
  check(!matchesAny('SMOKE Level (3 tools)'), 'test-level "(3 tools)" does NOT match');
  check(!matchesAny('0 tools loaded | Wrong transport type'), 'troubleshooting "0 tools loaded" does NOT match');

  console.log('');
  if (failures === 0) console.log('[#193] All tool-count sync tests passed ✓');
  else { console.error(`[#193] ${failures} test(s) FAILED`); process.exit(2); }
})();
