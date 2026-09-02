// #402: make the "nothing in budgetLoader.ts takes withApiLock" invariant STRUCTURAL.
//
// After #396, `loadBudgetTracked` is called from inside the api lock at all six budget load
// sites, and `withApiLock` (src/lib/apiLock.ts) is a NON-REENTRANT FIFO mutex. So a future edit
// that reaches the api through `adapter.getBudgetMonths()` or `adapter.getBudgets()` instead of
// the raw `api.*` deadlocks the whole process.
//
// The symptom is the reason this deserves a guard rather than a comment: a roughly 30 second
// stall followed by `Actual API operation timed out after 30000ms`, which reads as a slow
// upstream server rather than as the nesting bug it is.
//
// #396 states the invariant in prose and its gate accepted that. This file is the structural
// version, because this project has paid for the difference four times: #371, #376, #390 and
// #393 each found a guard missed at a call site, four rounds running in #390's case.
//
// DELIBERATE LIMITATION, recorded so nobody mistakes this for more than it is: this catches a new
// STATIC import. It does NOT catch a dynamic `await import(...)` inside a function body, which is
// a real shape in this codebase (transactions_summary_by_payee.ts uses it to reach the query
// builder). The file has none today, so the absence is asserted too, which closes that gap for as
// long as it stays absent.
//
// Run: node tests/unit/budget_loader_import_allowlist.test.js

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const TARGET = 'src/lib/budgetLoader.ts';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#402-loader-imports] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

// Every entry is lock free, and that is the ONLY criterion for being here. Adding a module to
// this list is a deliberate one line commit that says "this does not take the api lock", which is
// exactly the review moment the invariant needs.
const ALLOWED_IMPORTS = new Set([
  '@actual-app/api',   // the raw singleton: takes no lock of its own
  './opTimeout.js',    // a timer race, no lock
  './apiState.js',     // module-level flags, no lock
  './loggerFactory.js' // winston, no lock
]);

// NOT allowed, and named explicitly so the failure message can explain itself rather than just
// pointing at a diff.
const KNOWN_LOCK_TAKERS = new Map([
  ['./actual-adapter.js', 'every adapter.* method wraps its operation in withApiLock'],
  ['./ActualConnectionPool.js', 'getConnection and getSharedConnection both take withApiLock'],
  ['./apiLock.js', 'this IS the mutex; the loader must never acquire it, its callers do'],
]);

const source = readFileSync(path.join(REPO, TARGET), 'utf8');

describe(`${TARGET} imports only from the lock-free allowlist`);
{
  const found = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  check(found.length > 0, `found ${found.length} static import(s) to check`);

  const offenders = found.filter((spec) => !ALLOWED_IMPORTS.has(spec));
  const explain = offenders
    .map((o) => `${o}${KNOWN_LOCK_TAKERS.has(o) ? ` (${KNOWN_LOCK_TAKERS.get(o)})` : ''}`)
    .join(', ');
  check(
    offenders.length === 0,
    offenders.length === 0
      ? 'no import outside the allowlist'
      : `import(s) outside the allowlist: ${explain}. ` +
        'Anything reached from this file runs INSIDE the api mutex at all six load sites, and ' +
        'withApiLock is not reentrant, so a lock-taking import deadlocks the process. If the new ' +
        'import is genuinely lock free, add it to ALLOWED_IMPORTS in this test with a one line ' +
        'reason. If it is not, reach the api through the raw api.* instead.',
  );
}

describe('and gains no dynamic import, which the static check above cannot see');
{
  check(
    !/await\s+import\s*\(/.test(source) && !/\bimport\s*\(\s*['"]/.test(source),
    'no dynamic import() in the file (the static allowlist would not catch one)',
  );
}

describe('the allowlist itself stays honest');
{
  for (const [spec, why] of KNOWN_LOCK_TAKERS) {
    check(!ALLOWED_IMPORTS.has(spec), `${spec} is not allowlisted: ${why}`);
  }
}

log(`\n[#402-loader-imports] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
