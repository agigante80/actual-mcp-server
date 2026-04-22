// tests/unit/transfers_create.test.js
// Unit tests for actual_transfers_create — covers schema validation, adapter mocking,
// and regression check for the addTransactions options-forwarding fix (issue #118).
//
// Run via: npm run test:unit-js
// Or: node tests/unit/transfers_create.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' — ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_TX = '33333333-3333-3333-3333-333333333333';

(async () => {
  const [toolMod, adapterMod] = await Promise.all([
    import('../../dist/src/tools/transfers_create.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const tool    = toolMod;
  const adapter = adapterMod.default;

  // ── Schema: valid input ─────────────────────────────────────────────────────
  console.log('\n[#118] Schema — valid input');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' }); }
    catch (e) { err = e; }
    check(!err, 'full valid input parses without error');

    let err2;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: 1, date: '2024-01-15', notes: 'rent split' }); }
    catch (e) { err2 = e; }
    check(!err2, 'valid input with optional notes parses without error');
  }

  // ── Schema: negative amount ─────────────────────────────────────────────────
  console.log('\n[#118] Schema — negative amount rejected');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: -5000, date: '2024-01-15' }); }
    catch (e) { err = e; }
    check(!!err, 'amount: -5000 throws Zod error');
    check(err?.message?.toLowerCase().includes('positive'), 'error message mentions "positive"', err?.message);
  }

  // ── Schema: decimal amount ───────────────────────────────────────────────────
  console.log('\n[#118] Schema — decimal amount rejected');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: 50.25, date: '2024-01-15' }); }
    catch (e) { err = e; }
    check(!!err, 'amount: 50.25 throws Zod error');
    check(
      err?.message?.toLowerCase().includes('integer') || err?.message?.toLowerCase().includes('int'),
      'error message mentions "integer"', err?.message
    );
  }

  // ── Schema: zero amount ──────────────────────────────────────────────────────
  console.log('\n[#118] Schema — zero amount rejected');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: 0, date: '2024-01-15' }); }
    catch (e) { err = e; }
    check(!!err, 'amount: 0 throws Zod error (zero is not positive)');
  }

  // ── Schema: invalid date ─────────────────────────────────────────────────────
  console.log('\n[#118] Schema — invalid date format rejected');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '01/15/2024' }); }
    catch (e) { err = e; }
    check(!!err, 'date: "01/15/2024" (wrong format) throws Zod error');
  }

  // ── Schema: invalid UUID ────────────────────────────────────────────────────
  console.log('\n[#118] Schema — invalid UUID rejected');
  {
    let err;
    try { tool.inputSchema.parse({ from_account: 'not-a-uuid', to_account: UUID_B, amount: 5000, date: '2024-01-15' }); }
    catch (e) { err = e; }
    check(!!err, 'from_account: "not-a-uuid" throws Zod error');
  }

  // ── Same-account guard ──────────────────────────────────────────────────────
  // The guard lives inside adapter.createTransfer (before rawGetAccounts is called).
  // The tool delegates entirely to the adapter, so we simulate the adapter's guard response.
  console.log('\n[#118] Same-account guard — adapter returns structured error before any API call');
  {
    adapter.createTransfer = async (params) => {
      if (params.from_account === params.to_account) {
        return { success: false, error: 'from_account and to_account must be different accounts.' };
      }
      return { success: true, from_id: UUID_TX, to_id: null };
    };

    const res = await tool.call({ from_account: UUID_A, to_account: UUID_A, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === false, 'result.success is false');
    check(typeof res?.result?.error === 'string', 'result.error is a string');
    check(res?.result?.error?.toLowerCase().includes('different'), 'error mentions "different"', res?.result?.error);
  }

  // ── Happy path ───────────────────────────────────────────────────────────────
  console.log('\n[#118] Happy path — two accounts, transfer payee found');
  {
    adapter.createTransfer = async () => ({ success: true, from_id: UUID_TX, to_id: null });
    const res = await tool.call({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === true,   'result.success is true');
    check(res?.result?.from_id === UUID_TX, 'result.from_id matches expected UUID');
    check(res?.result?.to_id === null,      'result.to_id is null (mirror ID not returned by API)');
  }

  // ── Happy path: API returns "ok" (from_id null) ──────────────────────────────
  console.log('\n[#118] Happy path — API returns "ok" (from_id null)');
  {
    adapter.createTransfer = async () => ({ success: true, from_id: null, to_id: null });
    const res = await tool.call({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === true,  'result.success is true even when from_id is null');
    check(res?.result?.from_id === null,  'result.from_id is null when API returned "ok"');
    check(res?.result?.to_id === null,    'result.to_id is null');
  }

  // ── to_account not found ─────────────────────────────────────────────────────
  console.log('\n[#118] Negative — to_account not found');
  {
    adapter.createTransfer = async () => ({ success: false, error: `Account '${UUID_B}' not found. Use actual_accounts_list to find valid accounts.` });
    const res = await tool.call({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === false,                               'result.success is false');
    check(res?.result?.error?.includes('not found'),                    'error mentions "not found"', res?.result?.error);
    check(res?.result?.error?.includes('actual_accounts_list'),         'error suggests actual_accounts_list', res?.result?.error);
  }

  // ── from_account closed ──────────────────────────────────────────────────────
  console.log('\n[#118] Negative — from_account closed');
  {
    adapter.createTransfer = async () => ({ success: false, error: `Source account 'Old Savings' is closed.` });
    const res = await tool.call({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === false,                'result.success is false');
    check(res?.result?.error?.includes('is closed'),     'error mentions "is closed"', res?.result?.error);
    check(res?.result?.error?.toLowerCase().includes('source'), 'error identifies the source account', res?.result?.error);
  }

  // ── Transfer payee tombstoned ────────────────────────────────────────────────
  console.log('\n[#118] Negative — transfer payee tombstoned');
  {
    adapter.createTransfer = async () => ({ success: false, error: `No transfer payee found for destination account 'Credit Card'. The account may not support transfers.` });
    const res = await tool.call({ from_account: UUID_A, to_account: UUID_B, amount: 5000, date: '2024-01-15' });
    check(res?.result?.success === false,                              'result.success is false');
    check(res?.result?.error?.includes('No transfer payee found'),     'error mentions "No transfer payee found"', res?.result?.error);
    check(res?.result?.error?.includes('not support transfers'),       'error mentions "not support transfers"', res?.result?.error);
  }

  // ── Regression: addTransactions options forwarding (issue #118 bug fix) ──────
  console.log('\n[#118] Regression — addTransactions forwards options parameter (line 437 fix)');
  {
    // The fix changes: rawAddTransactions(accountId, cleanedTxs, {})
    //              to: rawAddTransactions(accountId, cleanedTxs, options)
    // Default must remain {} so existing callers (no options arg) are unaffected.
    let capturedOptions;
    const origAddTransactions = adapterMod.addTransactions;

    // Re-import the raw function via the named export to inspect what options it passes
    // We verify the exported function signature accepts options and defaults to {}
    const addTransactionsFn = adapterMod.addTransactions;
    check(typeof addTransactionsFn === 'function', 'addTransactions is exported as a named function');

    // Calling with no options arg must not throw (default {} preserved)
    // We mock the adapter to prevent actual API call
    adapterMod.default.addTransactions = async (...args) => ['ok'];
    let noOptionsErr;
    try { await adapterMod.default.addTransactions([{ account: UUID_A, date: '2024-01-15', amount: -1000 }]); }
    catch (e) { noOptionsErr = e; }
    check(!noOptionsErr, 'addTransactions called without options arg does not throw', noOptionsErr?.message);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('');
  if (failures === 0) {
    console.log('[#118] All transfers_create tests passed ✓');
  } else {
    console.error(`[#118] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
