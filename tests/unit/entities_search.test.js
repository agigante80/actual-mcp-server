// tests/unit/entities_search.test.js  (#204)
// Extensive coverage for actual_entities_search: every matchType, multi-pattern OR,
// limit, ranking, null-name handling, the no-match contract, all three entity types,
// and Zod negatives. Stubs the adapter list methods and calls the real tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, l, d = '') => cond ? pass(l) : fail(l, d);

const FIXTURE = {
  payees: [
    { id: 'p1', name: 'Amazon.com' },
    { id: 'p2', name: 'Amazon Web Services' },
    { id: 'p3', name: 'Whole Foods Market' },
    { id: 'p4', name: 'Starbucks' },
    { id: 'p5', name: null },   // null name: must be skipped, must not crash
    { id: 'p6', name: '' },      // empty name: skipped
  ],
  categories: [
    { id: 'c1', name: 'Groceries' },
    { id: 'c2', name: 'Gas' },
    { id: 'c3', name: 'Rent' },
  ],
  accounts: [
    { id: 'a1', name: 'Checking' },
    { id: 'a2', name: 'Savings' },
  ],
};

(async () => {
  const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
  adapter.getPayees = async () => FIXTURE.payees;
  adapter.getCategories = async () => FIXTURE.categories;
  adapter.getAccounts = async () => FIXTURE.accounts;
  const tool = (await import('../../dist/src/tools/entities_search.js')).default;

  const run = async (input) => (await tool.call(input)).result;
  const names = (r) => r.matches.map((m) => m.name);

  console.log('\n[#204] contains (default), case-insensitive, partial');
  {
    const r = await run({ type: 'payees', query: 'amazon' });
    check(r.matchType === 'contains', 'matchType defaults to contains');
    check(r.count === 2, 'two payees contain "amazon"', `got ${r.count}`);
    check(names(r).includes('Amazon.com') && names(r).includes('Amazon Web Services'), 'both Amazon entities');
    const up = await run({ type: 'payees', query: 'AMAZON' });
    check(up.count === 2, 'contains is case-insensitive');
  }

  console.log('\n[#204] startsWith / endsWith / exact');
  {
    const sw = await run({ type: 'payees', query: 'whole', matchType: 'startsWith' });
    check(names(sw).join('|') === 'Whole Foods Market', 'startsWith "whole"');
    const ew = await run({ type: 'payees', query: '.com', matchType: 'endsWith' });
    check(names(ew).join('|') === 'Amazon.com', 'endsWith ".com"');
    const ex1 = await run({ type: 'payees', query: 'Starbucks', matchType: 'exact' });
    const ex2 = await run({ type: 'payees', query: 'star', matchType: 'exact' });
    check(ex1.count === 1, 'exact matches the whole name');
    check(ex2.count === 0, 'exact does NOT match a substring');
  }

  console.log('\n[#204] fuzzy (typo tolerance) + score');
  {
    const r = await run({ type: 'payees', query: 'amzon', matchType: 'fuzzy' });
    check(r.count >= 1, 'fuzzy "amzon" finds a match');
    check(names(r)[0] === 'Amazon.com', 'best fuzzy match is Amazon.com', names(r).join(','));
    check(typeof r.matches[0].score === 'number', 'fuzzy result carries a numeric score');
    const sorted = r.matches.every((m, i, a) => i === 0 || (a[i - 1].score ?? 1) <= (m.score ?? 1));
    check(sorted, 'fuzzy matches ranked by score ascending');
    const none = await run({ type: 'payees', query: 'qqqzzzxx', matchType: 'fuzzy' });
    check(none.count === 0, 'fuzzy nonsense returns empty');
  }

  console.log('\n[#204] multi-pattern OR');
  {
    const r = await run({ type: 'categories', query: ['gro', 'rent'], matchType: 'startsWith' });
    check(r.count === 2 && names(r).includes('Groceries') && names(r).includes('Rent'), 'OR over ["gro","rent"]');
  }

  console.log('\n[#204] limit + alphabetical ordering (non-fuzzy)');
  {
    const all = await run({ type: 'payees', query: 'a' }); // appears in all 4 named payees
    check(all.count === 4, 'contains "a" matches all 4 named payees', `got ${all.count}`);
    const monotonic = all.matches.every((m, i, arr) => i === 0 || arr[i - 1].name.localeCompare(m.name) <= 0);
    check(monotonic, 'non-fuzzy results sorted alphabetically');
    const capped = await run({ type: 'payees', query: 'a', limit: 1 });
    check(capped.count === 1 && capped.matches.length === 1, 'limit caps the result set');
  }

  console.log('\n[#204] null/empty names + no-match contract + all types');
  {
    const r = await run({ type: 'payees', query: 'amazon' });
    check(r.count === 2, 'null-name and empty-name payees are excluded (no crash)');
    const empty = await run({ type: 'accounts', query: 'nope' });
    check(empty.count === 0 && empty.matches.length === 0 && empty.error === undefined,
      'no-match returns { matches: [], count: 0 } with NO error field');
    const acc = await run({ type: 'accounts', query: 'check' });
    check(acc.count === 1 && names(acc)[0] === 'Checking', 'accounts type works');
    const cat = await run({ type: 'categories', query: 'gas' });
    check(cat.count === 1 && names(cat)[0] === 'Gas', 'categories type works');
  }

  console.log('\n[#204] Zod negatives (tool.call must throw)');
  {
    const throws = async (input, label) => {
      let threw = null;
      try { await tool.call(input); } catch (e) { threw = e; }
      check(threw instanceof Error, label);
    };
    await throws({ type: 'payees' }, 'missing query rejected');
    await throws({ type: 'payees', query: '' }, 'empty query rejected');
    await throws({ type: 'payees', query: [] }, 'empty query array rejected');
    await throws({ type: 'foo', query: 'x' }, 'unknown type rejected');
    await throws({ type: 'payees', query: 'x', matchType: 'regex' }, 'regex matchType rejected (out of scope)');
    await throws({ type: 'payees', query: 'x', limit: 0 }, 'limit 0 rejected');
    await throws({ type: 'payees', query: 'x', limit: 999 }, 'limit over 100 rejected');
  }

  console.log('');
  if (failures === 0) console.log('[#204] All entities_search tests passed ✓');
  else { console.error(`[#204] ${failures} test(s) FAILED`); process.exit(2); }
})();
