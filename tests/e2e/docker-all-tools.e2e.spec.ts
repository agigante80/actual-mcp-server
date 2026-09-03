/**
 * Comprehensive Docker E2E Tests - ALL 74 TOOLS
 *
 * Tests every tool with success and error scenarios.
 *
 * #375: every test is SELF-PROVISIONING. It asks the fixtures in `./fixtures.js`
 * for what it needs, and everything it creates is removed in fixture teardown even
 * when the test fails. There is no shared mutable context and no
 * `if (!testContext.x) test.skip()` guard, so any test can be run alone with
 * `--grep` and passes rather than skipping, and no test can be made to pass or fail
 * by what an earlier test left behind. See the header of `fixtures.ts` for the three
 * green-but-wrong tests that coupling produced.
 */

import { test, expect, today, currentMonth, uniqueSuffix, CLEANUP_ORDER } from './fixtures.js';

test.describe('Docker E2E - ALL 74 TOOLS', () => {
  // ==================== SERVER INFO ====================
  test('actual_server_info - should return server info', async ({ mcp }) => {
    const data = await mcp.call('actual_server_info');
    expect(data).toBeTruthy();
  });

  test('actual_server_get_version - should return version string', async ({ mcp }) => {
    const data = await mcp.call('actual_server_get_version');
    expect(data).toBeTruthy();
  });

  // ==================== TOOL ANNOTATIONS (#379) ====================
  test('tools/list - every tool publishes MCP annotations that match its nature', async ({ mcp }) => {
    // Asserted OVER THE WIRE, not against the in-process table: the point of #379 is that
    // clients can see this, and a table that never reaches `tools/list` would be useless
    // while looking complete.
    const res = await mcp.post({ jsonrpc: '2.0', id: 4242, method: 'tools/list', params: {} });
    const body = await res.json();
    const tools: any[] = body?.result?.tools ?? [];
    expect(tools.length).toBeGreaterThan(70);

    const byName = new Map(tools.map((t: any) => [t.name, t]));
    const ann = (n: string) => byName.get(n)?.annotations;

    // Every tool carries all four hints. Silence and "declared false" look identical to a
    // client, but only one of them means somebody classified the tool.
    const missing = tools.filter(
      (t: any) =>
        !t.annotations ||
        ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].some(
          (k) => typeof t.annotations[k] !== 'boolean',
        ),
    );
    expect(missing.map((t: any) => t.name)).toEqual([]);

    // A read-only tool, a destructive one, and the single open-world one.
    expect(ann('actual_accounts_list')?.readOnlyHint).toBe(true);
    expect(ann('actual_accounts_delete')?.readOnlyHint).toBe(false);
    expect(ann('actual_accounts_delete')?.destructiveHint).toBe(true);

    // The default this server corrects 73 times out of 74: the spec defaults openWorldHint
    // to TRUE, and this server's domain is one Actual instance. Only bank sync reaches a
    // third party.
    const open = tools.filter((t: any) => t.annotations?.openWorldHint).map((t: any) => t.name);
    expect(open).toEqual(['actual_bank_sync']);

    // Idempotence matches what the write-effect audit established, rather than being guessed:
    // upstream ADDS to the hold buffer, so repeating the call holds twice (#355).
    expect(ann('actual_budgets_holdForNextMonth')?.idempotentHint).toBe(false);
    expect(ann('actual_rules_create_or_update')?.idempotentHint).toBe(true);
  });

  // ==================== SESSION MANAGEMENT ====================
  test('actual_session_list - should list active sessions', async ({ mcp }) => {
    const data = await mcp.call('actual_session_list');
    const sessions = Array.isArray(data) ? data : (data?.sessions || []);
    expect(sessions).toBeTruthy();
  });

  test('actual_session_close - should handle close request gracefully', async ({ mcp }) => {
    // Called with no sessionId: the tool closes the oldest IDLE session other than the
    // current one. In a single-session run both "closed one" and "nothing idle to close"
    // are correct, so what is asserted is that it answers with a structured response
    // rather than throwing.
    const data = await mcp.call('actual_session_close', {});
    expect(data).toBeTruthy();
    expect(typeof data).toBe('object');
  });

  // ==================== ACCOUNTS (7 tools) ====================
  test('actual_accounts_list - should list all accounts', async ({ mcp }) => {
    const accounts = await mcp.call('actual_accounts_list');
    expect(Array.isArray(accounts)).toBeTruthy();
  });

  test('actual_accounts_create - should create account', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    // Assert the STATE, not just the returned id: the account must actually be listed.
    const accounts = (await mcp.call('actual_accounts_list')) as any[];
    const found = accounts.find((a: any) => a?.id === account.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe(account.name);
  });

  test('actual_accounts_create - ERROR: should fail without name', async ({ mcp }) => {
    const res = await mcp.post({
      jsonrpc: '2.0',
      id: 9999,
      method: 'tools/call',
      params: { name: 'actual_accounts_create', arguments: { balance: 0 } }, // no 'name'
    });
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.error.message).toMatch(/name|required/i);
  });

  test('actual_accounts_get_balance - should get account balance', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    const data = await mcp.call('actual_accounts_get_balance', { id: account.id });
    const balance = typeof data === 'number' ? data : data?.balance;
    expect(typeof balance).toBe('number');
  });

  test('actual_accounts_update - should update account', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    await mcp.call('actual_accounts_update', {
      id: account.id,
      fields: { name: account.name + '-Updated', offbudget: true },
    });
    const accounts = (await mcp.call('actual_accounts_list')) as any[];
    const found = accounts.find((a: any) => a?.id === account.id);
    expect(found?.name).toBe(account.name + '-Updated');
    expect(found?.offbudget).toBeTruthy();
  });

  // #206: prove the central error-formatter change does not regress the happy path over the wire.
  test('actual_accounts_update - POSITIVE: valid update succeeds with no error', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    // mcp.call throws on any tool error (including a validation error), so reaching the
    // assertion already proves the happy path was not regressed. extractResult unwraps
    // accounts_update's { success, accountId, updatedFields } envelope to the accountId.
    const data = await mcp.call('actual_accounts_update', {
      id: account.id,
      fields: { name: account.name + '-Updated2' },
    });
    expect(data).toBe(account.id);
  });

  test('actual_accounts_update - ERROR: should reject invalid fields', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    // #206: unrecognized keys render as "unexpected field(s): X" via the central formatter.
    await expect(
      mcp.call('actual_accounts_update', { id: account.id, fields: { invalidField: 'should fail' } }),
    ).rejects.toThrow(/unexpected field/i);
  });

  test('actual_accounts_close - should close account', async ({ mcp, makeAccount }) => {
    // seedTransaction is load bearing. Actual TOMBSTONES an account that has no
    // transactions when you close it (closeAccount: `if (numTransactions === 0) await
    // db.deleteAccount({ id })`), and getAccounts filters `tombstone = 0`. Before #375
    // the shared fixture account was created with balance 0 and closed before any
    // transaction existed, so this test DELETED it and every later test reusing its id
    // silently operated on an account that no longer existed.
    const account = await makeAccount({ seedTransaction: true });

    const closeResult = await mcp.call('actual_accounts_close', { id: account.id });
    const accounts = (await mcp.call('actual_accounts_list')) as any[];
    const found = accounts.find((a: any) => a?.id === account.id);

    // With the seed transaction the closed branch is the expected one, and it is now
    // asserted unconditionally: a regression to the tombstone path fails here.
    expect(closeResult?.removed).toBeFalsy();
    expect(found).toBeTruthy();
    expect(found.closed).toBeTruthy();
  });

  test('actual_accounts_close - already closed reports no change', async ({ mcp, makeAccount }) => {
    // #357: a second close must not claim to have closed anything. It is still a success
    // (the requested state holds) but it says nothing changed.
    const account = await makeAccount({ seedTransaction: true });
    await mcp.call('actual_accounts_close', { id: account.id });

    const payload = await mcp.call('actual_accounts_close', { id: account.id });
    expect(payload?.alreadyClosed).toBeTruthy();
  });

  test('actual_accounts_reopen - should reopen account', async ({ mcp, makeAccount }) => {
    const account = await makeAccount({ seedTransaction: true });
    await mcp.call('actual_accounts_close', { id: account.id });

    const first = await mcp.call('actual_accounts_reopen', { id: account.id });
    expect(first?.reopened).toBeTruthy();
    // #358: assert the resulting STATE. This test used to call the tool and log a
    // checkmark, so it passed whether or not the reopen did anything at all.
    const accounts = (await mcp.call('actual_accounts_list')) as any[];
    const reopened = accounts.find((a: any) => a?.id === account.id);
    expect(reopened).toBeTruthy();
    expect(reopened.closed).toBeFalsy();

    // #369 item 5: a second reopen must report the non-change rather than claiming it
    // reopened anything, and must issue NO write. Upstream's reopen is a db.update, which
    // in Actual is a CRDT message that syncs to every client, so a no-op write is real
    // sync traffic. This mirrors what accounts_close already does for already-closed.
    const second = await mcp.call('actual_accounts_reopen', { id: account.id });
    expect(second?.alreadyOpen).toBeTruthy();
    expect(second?.reopened).toBeFalsy();
  });

  test('actual_accounts_reopen - unknown id is refused and creates nothing', async ({ mcp }) => {
    // #358 regression. Upstream reopenAccount is a bare db.update, and db.update INSERTs
    // when the row is absent, so an unknown id used to create a nameless account that
    // appeared in listings and synced to other clients. The second assertion is the one
    // that matters: nothing was created.
    const ghostId = '00000000-0000-4000-8000-000000000358';
    await expect(mcp.call('actual_accounts_reopen', { id: ghostId })).rejects.toThrow(/not found/i);

    const accounts = (await mcp.call('actual_accounts_list')) as any[];
    expect(accounts.map((a: any) => a?.id)).not.toContain(ghostId);
  });

  // ==================== CATEGORY GROUPS (4 tools) ====================
  // actual_category_groups_get returns { groups: [...] }, and extractResult has no
  // special case for a `groups` key, so it hands back the whole envelope. Every
  // assertion in this file goes through this helper rather than assuming an array:
  // three tests here used to call `.find()` on the envelope, get undefined or throw
  // nothing at all, and pass without ever looking at a group.
  const listGroups = async (mcp: { call: (t: string, a?: any) => Promise<any> }): Promise<any[]> => {
    const data = await mcp.call('actual_category_groups_get');
    return (Array.isArray(data) ? data : (data?.groups ?? [])) as any[];
  };

  test('actual_category_groups_get - should list category groups', async ({ mcp }) => {
    const groups = await listGroups(mcp);
    expect(Array.isArray(groups)).toBeTruthy();
  });

  test('actual_category_groups_create - should create category group', async ({ mcp, makeCategoryGroup }) => {
    const group = await makeCategoryGroup();
    const groups = await listGroups(mcp);
    expect(groups.find((g: any) => g?.id === group.id)).toBeTruthy();
  });

  test('actual_category_groups_update - should update category group', async ({ mcp, makeCategoryGroup }) => {
    const group = await makeCategoryGroup();
    const newName = `E2E-Group-Updated-${uniqueSuffix()}`;
    await mcp.call('actual_category_groups_update', { id: group.id, fields: { name: newName } });

    const groups = await listGroups(mcp);
    expect(groups.find((g: any) => g?.id === group.id)?.name).toBe(newName);
  });

  // ==================== CATEGORIES (4 tools) ====================
  test('actual_categories_get - should list categories', async ({ mcp }) => {
    const categories = await mcp.call('actual_categories_get');
    expect(categories).toBeTruthy();
  });

  test('actual_categories_create - should create category', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();
    const data = await mcp.call('actual_categories_get');
    const categories = (Array.isArray(data) ? data : data?.categories ?? []) as any[];
    expect(categories.find((c: any) => c?.id === category.id)).toBeTruthy();
  });

  test('actual_categories_create - ERROR: should fail without group_id', async ({ mcp }) => {
    await expect(
      mcp.call('actual_categories_create', { name: 'Test-No-Group' }),
    ).rejects.toThrow(/group_id|required/i);
  });

  test('actual_categories_update - should update category', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();
    const newName = `E2E-Category-Updated-${uniqueSuffix()}`;
    await mcp.call('actual_categories_update', { id: category.id, fields: { name: newName } });

    const data = await mcp.call('actual_categories_get');
    const categories = (Array.isArray(data) ? data : data?.categories ?? []) as any[];
    expect(categories.find((c: any) => c?.id === category.id)?.name).toBe(newName);
  });

  // ==================== PAYEES (6 tools) ====================
  test('actual_payees_get - should list payees', async ({ mcp }) => {
    const payees = await mcp.call('actual_payees_get');
    expect(Array.isArray(payees)).toBeTruthy();
  });

  test('actual_payees_common_list - should return recent frequent payees or empty array', async ({ mcp }) => {
    const payees = (await mcp.call('actual_payees_common_list')) as any[];

    // Empty list is a valid success result (no recent activity); both cases must pass.
    expect(Array.isArray(payees)).toBeTruthy();
    expect(payees.length).toBeGreaterThanOrEqual(0);
    expect(payees.length).toBeLessThanOrEqual(10);

    for (const p of payees) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      if ('transfer_acct' in p && p.transfer_acct !== undefined) {
        expect(typeof p.transfer_acct).toBe('string');
      }
    }
  });

  test('actual_payees_create - should create payee', async ({ mcp, makePayee }) => {
    const payee = await makePayee();
    const payees = (await mcp.call('actual_payees_get')) as any[];
    expect(payees.find((p: any) => p?.id === payee.id)).toBeTruthy();
  });

  test('actual_payees_create - should create second payee for merge test', async ({ mcp, makePayee }) => {
    // Kept as its own case because two distinct payees created back to back is the
    // precondition the merge test needs, and a collision in the unique suffix would
    // show up here rather than inside the merge.
    const first = await makePayee();
    const second = await makePayee();
    expect(second.id).not.toBe(first.id);
    const payees = (await mcp.call('actual_payees_get')) as any[];
    expect(payees.find((p: any) => p?.id === second.id)).toBeTruthy();
  });

  test('actual_payees_update - should update payee name and set default category via rule', async ({ mcp, makePayee, makeCategory }) => {
    const payee = await makePayee();
    const category = await makeCategory();

    const newName = `E2E-Payee-Updated-${uniqueSuffix()}`;
    await mcp.call('actual_payees_update', { id: payee.id, fields: { name: newName } });
    const payees = (await mcp.call('actual_payees_get')) as any[];
    expect(payees.find((p: any) => p?.id === payee.id)?.name).toBe(newName);

    // Setting a default category is stored as a "payee is X -> set category" RULE, not as
    // a column: `category` does not exist on the payees table in @actual-app/api v26+.
    await mcp.call('actual_payees_update', { id: payee.id, fields: { category: category.id } });

    const rulesData = await mcp.call('actual_payee_rules_get', { payeeId: payee.id });
    const rules = (Array.isArray(rulesData) ? rulesData : rulesData?.rules || []) as any[];
    const setCatRule = rules.find(
      (r: any) =>
        Array.isArray(r.actions) &&
        r.actions.some((a: any) => a.op === 'set' && a.field === 'category'),
    );
    // Asserted unconditionally. The previous version logged a warning and passed when no
    // rule was found, which made the whole point of the test optional.
    expect(setCatRule, 'setting fields.category must create a set-category rule').toBeTruthy();
    const action = setCatRule.actions.find((a: any) => a.op === 'set' && a.field === 'category');
    expect(action.value).toBe(category.id);

    // Remove the rule this test created, since it belongs to the payee rather than to
    // any factory. Clearing it is also the documented way to drop the default.
    await mcp.call('actual_payees_update', { id: payee.id, fields: { category: null } });
  });

  test('actual_payees_update - should clear default category (null removes rule)', async ({ mcp, makePayee, makeCategory }) => {
    const payee = await makePayee();
    const category = await makeCategory();
    await mcp.call('actual_payees_update', { id: payee.id, fields: { category: category.id } });

    await mcp.call('actual_payees_update', { id: payee.id, fields: { category: null } });

    const rulesData = await mcp.call('actual_payee_rules_get', { payeeId: payee.id });
    const rules = (Array.isArray(rulesData) ? rulesData : rulesData?.rules || []) as any[];
    const remaining = rules.filter(
      (r: any) =>
        Array.isArray(r.actions) &&
        r.actions.some((a: any) => a.op === 'set' && a.field === 'category'),
    );
    expect(remaining.length).toBe(0);
  });

  test('actual_payees_update - ERROR: should reject invalid fields', async ({ mcp, makePayee }) => {
    const payee = await makePayee();
    // #206: unrecognized keys render as "unexpected field(s): X" via the central formatter.
    await expect(
      mcp.call('actual_payees_update', { id: payee.id, fields: { invalidField: 'should fail' } }),
    ).rejects.toThrow(/unexpected field/i);
  });

  test('actual_payees_merge - should merge payees', async ({ mcp, makePayee }) => {
    const target = await makePayee();
    const doomed = await makePayee();

    await mcp.call('actual_payees_merge', { targetId: target.id, mergeIds: [doomed.id] });

    // Assert the STATE: the merged-away payee is gone and the target survives. The old
    // version called the tool and logged a checkmark, so it passed even if nothing merged.
    const payees = (await mcp.call('actual_payees_get')) as any[];
    expect(payees.find((p: any) => p?.id === doomed.id)).toBeFalsy();
    expect(payees.find((p: any) => p?.id === target.id)).toBeTruthy();
  });

  // ==================== ENTITY SEARCH (1 tool) ====================
  test('actual_entities_search - should find payees by partial name and confirm no-match contract', async ({ mcp, makePayee }) => {
    // Seed a payee with a known name rather than depending on whatever the budget
    // happens to contain, so the positive half cannot silently become a no-op on an
    // empty budget the way it could before.
    const token = `Xq${uniqueSuffix().replace(/-/g, '')}`;
    const payee = await makePayee({ name: `E2E-Search-${token}` });

    const data = await mcp.call('actual_entities_search', {
      type: 'payees',
      query: token.toLowerCase(),
      matchType: 'contains',
      limit: 50,
    });

    expect(Array.isArray(data?.matches)).toBeTruthy();
    expect(typeof data?.count).toBe('number');
    expect(data?.type).toBe('payees');
    expect(data?.matchType).toBe('contains');
    expect((data.matches as any[]).some((m: any) => m.id === payee.id)).toBeTruthy();

    // No-match contract: a clearly-nonexistent query must return count:0, matches:[], no error.
    const noMatch = await mcp.call('actual_entities_search', {
      type: 'payees',
      query: 'zzz-definitely-nonexistent-payee-xqz-9999',
      matchType: 'contains',
      limit: 10,
    });
    expect(Array.isArray(noMatch?.matches)).toBeTruthy();
    expect(noMatch?.matches).toHaveLength(0);
    expect(noMatch?.count).toBe(0);
  });

  // ==================== PAYEE RULES (1 tool) ====================
  test('actual_payee_rules_get - should get payee rules', async ({ mcp, makePayee }) => {
    const payee = await makePayee();
    const data = await mcp.call('actual_payee_rules_get', { payeeId: payee.id });
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(Array.isArray(rules)).toBeTruthy();
  });

  // ==================== TRANSACTIONS (10 tools) ====================
  test('actual_transactions_create - should create transaction', async ({ mcp, makeAccount, makePayee, makeCategory }) => {
    const account = await makeAccount();
    const payee = await makePayee();
    const category = await makeCategory();

    const notes = `E2E-Create-${uniqueSuffix()}`;
    await mcp.call('actual_transactions_create', {
      account: account.id,
      date: today(),
      amount: -5000, // -$50.00
      payee: payee.id,
      category: category.id,
      notes,
    });

    // Assert the transaction is actually on the account. The old version accepted "id not
    // available" and logged success either way.
    const rows = ((await mcp.call('actual_transactions_filter', { accountId: account.id })) ??
      []) as any[];
    const created = rows.find((t: any) => t?.notes === notes);
    expect(created).toBeTruthy();
    expect(created.amount).toBe(-5000);
  });

  test('actual_transactions_create - ERROR: should fail with invalid amount format', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();

    // WHAT CAN AND CANNOT BE CAUGHT HERE. The classic mistake is passing dollars
    // (-50.00) where cents are required. That one is UNDETECTABLE: JavaScript has no
    // separate float type, so -50.00 IS the integer -50, and the schema correctly reads
    // it as -50 cents. The old version of this test sent -50.00, accepted either
    // outcome, and logged "amount validation might need improvement" either way, so it
    // asserted nothing at all.
    //
    // What the schema genuinely rejects is a non-integer, which is the only form of
    // "not cents" that survives into the request. That is what is asserted.
    await expect(
      mcp.call('actual_transactions_create', { account: account.id, date: today(), amount: -50.5 }),
    ).rejects.toThrow(/amount|integer|invalid/i);

    // And the dollars-shaped value is accepted as the cents value it is identical to,
    // which is the behaviour a caller has to know about.
    const notes = `E2E-Amount-${uniqueSuffix()}`;
    await mcp.call('actual_transactions_create', {
      account: account.id,
      date: today(),
      amount: -50.0,
      notes,
    });
    const rows = ((await mcp.call('actual_transactions_filter', { accountId: account.id })) ??
      []) as any[];
    expect(rows.find((t: any) => t?.notes === notes)?.amount).toBe(-50);
  });

  test('actual_transactions_create - ERROR: should fail with invalid date', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    await expect(
      mcp.call('actual_transactions_create', {
        account: account.id,
        date: 'invalid-date',
        amount: -5000,
      }),
    ).rejects.toThrow(/date|invalid/i);
  });

  test('actual_transactions_get - should get transaction by ID', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account, amount: -5000 });

    // The schema is { accountId, startDate, endDate }: there is no `id` field. This test
    // used to pass `{ id: txn.id }`, which Zod stripped, leaving the call UNSCOPED so it
    // returned every transaction in the budget. `expect(found).toBeTruthy()` on an array
    // is true even for [], so the tool could have returned a hard-coded empty array and
    // this stayed green.
    const d = await mcp.call('actual_transactions_get', { accountId: account.id });
    const rows = (Array.isArray(d) ? d : (d?.result ?? [])) as any[];
    expect(rows.find((t: any) => t?.id === txn.id)?.amount).toBe(-5000);
  });

  test('actual_transactions_update - should update transaction', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account, amount: -5000 });

    await mcp.call('actual_transactions_update', { id: txn.id, fields: { amount: -7500 } });

    const rows = ((await mcp.call('actual_transactions_filter', { accountId: account.id })) ??
      []) as any[];
    expect(rows.find((t: any) => t?.id === txn.id)?.amount).toBe(-7500);
  });

  test('actual_transactions_filter - should filter transactions', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account });

    const txns = (await mcp.call('actual_transactions_filter', { accountId: account.id })) as any[];
    expect(Array.isArray(txns)).toBeTruthy();
    expect(txns.find((t: any) => t?.id === txn.id)).toBeTruthy();
    // The scoping is the tool's whole job, so assert it. Every call here used to pass
    // `account_id`, which is the raw DB column name and not a schema key: Zod stripped it,
    // the filter ran unscoped over the whole budget, and the id was still "found". The
    // tool could have ignored the account entirely and this test would not have noticed.
    expect(txns.every((t: any) => t.account === account.id)).toBe(true);
  });

  test('actual_transactions_import - imports a real transaction (typed, non-empty)', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();
    // #217: import a REAL transaction. The old `txs: []` succeeded vacuously and never
    // exercised the schema/handler; a typed, non-empty `txs` array is now required, and the
    // import must add exactly one transaction (proves the typed payload reaches the handler
    // instead of being silently dropped as it was with `z.unknown()`).
    // Note: de-dup by imported_id is reconciliation behaviour tied to bank sync, not a
    // guarantee for separate manual importTransactions calls, so it is not asserted here.
    const tx = {
      date: today(),
      amount: -4321,
      payee_name: 'E2E-Import',
      imported_id: `e2e-import-${uniqueSuffix()}`,
    };

    const first = await mcp.call('actual_transactions_import', {
      accountId: account.id,
      txs: [tx],
    });
    expect(Array.isArray(first?.added)).toBeTruthy();
    expect(first.added.length).toBe(1);
  });

  test('actual_transactions_uncategorized - should list uncategorized transactions', async ({ mcp, makeAccount }) => {
    // This tool DELIBERATELY excludes off-budget and closed accounts. The account this
    // test owns is on budget by default, which is the precondition the positive half
    // needs. Before #375 the shared fixture had been set `offbudget: true` by an earlier
    // test, and this only passed because a still earlier defect had deleted the account
    // outright so it never entered the exclusion set at all.
    const account = await makeAccount();

    const uncatNote = `E2E-Uncat-${uniqueSuffix()}`;
    await mcp.call('actual_transactions_create', {
      account: account.id,
      date: today(),
      amount: -1111,
      notes: uncatNote,
      // deliberately no category
    });

    const data = await mcp.call('actual_transactions_uncategorized', {
      includeTransactions: true,
      limit: 1000,
    });
    const txns: any[] = data?.transactions ?? data?.result?.transactions ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(txns)).toBeTruthy();
    expect(txns.find((t: any) => t?.notes === uncatNote)).toBeTruthy();

    // Negative half, and it is the tool's actual contract: an off-budget account's
    // transactions must NOT appear.
    await mcp.call('actual_accounts_update', { id: account.id, fields: { offbudget: true } });
    const afterData = await mcp.call('actual_transactions_uncategorized', {
      includeTransactions: true,
      limit: 1000,
    });
    const afterTxns: any[] =
      afterData?.transactions ?? afterData?.result?.transactions ?? (Array.isArray(afterData) ? afterData : []);
    expect(afterTxns.find((t: any) => t?.notes === uncatNote)).toBeFalsy();

    // Edge: far-future date range must return an empty summary.
    const empty = await mcp.call('actual_transactions_uncategorized', {
      startDate: '2099-01-01',
      endDate: '2099-01-31',
    });
    expect(typeof empty?.totalCount).toBe('number');
    expect(empty?.totalCount).toBe(0);
  });

  test('actual_transactions_update_batch - should batch update transactions', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account });

    const batchNote = `E2E-Batch-${uniqueSuffix()}`;
    const data = await mcp.call('actual_transactions_update_batch', {
      updates: [{ id: txn.id, fields: { notes: batchNote } }],
    });
    const batchData = data?.total !== undefined ? data : (data?.result ?? data);
    const succeededCount =
      batchData?.successCount ?? batchData?.succeeded?.length ?? (batchData?.total === 1 ? 1 : null);
    expect(succeededCount).toBe(1);

    // And the write actually landed.
    const rows = ((await mcp.call('actual_transactions_filter', { accountId: account.id })) ??
      []) as any[];
    expect(rows.find((t: any) => t?.id === txn.id)?.notes).toBe(batchNote);

    // NEGATIVE: a non-existent id must not throw, and must not be counted as a success.
    const negData = await mcp.call('actual_transactions_update_batch', {
      updates: [{ id: '00000000-dead-beef-0000-000000000000', fields: { notes: 'should-fail' } }],
    });
    const negBatch = negData?.total !== undefined ? negData : (negData?.result ?? negData);
    const negSucceeded =
      negBatch?.successCount ?? negBatch?.succeeded?.length ?? (negBatch?.total === 1 ? 1 : 0);
    expect(negSucceeded).toBe(0);
  });

  test('actual_transactions_search_by_amount - should search by amount', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account, amount: -5000 });

    // The schema takes minAmount/maxAmount or absoluteAmount, NOT `amount`, and it
    // REFUSES an unscoped search (no accountId and no date range) to avoid a
    // full-database scan. The old version passed `{ amount: -5000 }`: Zod stripped the
    // unknown key, the tool returned its unbounded-query error payload, and the test
    // asserted `expect([]).toBeTruthy()` on the empty transactions array, so it passed
    // without ever running a search.
    const data = await mcp.call('actual_transactions_search_by_amount', {
      accountId: account.id,
      absoluteAmount: 5000,
    });
    expect(data?.error, 'the search must be accepted, not refused as unbounded').toBeFalsy();
    const txns = (Array.isArray(data) ? data : data?.transactions || []) as any[];
    expect(txns.find((t: any) => t?.id === txn.id)).toBeTruthy();
  });

  test('actual_transactions_search_by_category - should search by category', async ({ mcp, makeAccount, makeCategory, makeTransaction }) => {
    const account = await makeAccount();
    const category = await makeCategory();
    const txn = await makeTransaction({ account, category: category.id });

    const data = await mcp.call('actual_transactions_search_by_category', { categoryId: category.id });
    const txns = (Array.isArray(data) ? data : data?.transactions || []) as any[];
    expect(Array.isArray(txns)).toBeTruthy();
    expect(txns.find((t: any) => t?.id === txn.id)).toBeTruthy();
  });

  test('actual_transactions_search_by_month - should search by month', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account, date: today() });

    const data = await mcp.call('actual_transactions_search_by_month', { month: currentMonth() });
    const txns = (Array.isArray(data) ? data : data?.transactions || []) as any[];
    expect(Array.isArray(txns)).toBeTruthy();
    expect(txns.find((t: any) => t?.id === txn.id)).toBeTruthy();
  });

  test('actual_transactions_search_by_payee - should search by payee', async ({ mcp, makeAccount, makePayee, makeTransaction }) => {
    const account = await makeAccount();
    const payee = await makePayee();
    const txn = await makeTransaction({ account, payee: payee.id });

    const data = await mcp.call('actual_transactions_search_by_payee', { payeeId: payee.id });
    const txns = (Array.isArray(data) ? data : data?.transactions || []) as any[];
    expect(Array.isArray(txns)).toBeTruthy();
    expect(txns.find((t: any) => t?.id === txn.id)).toBeTruthy();
  });

  test('actual_transactions_summary_by_category - should summarize by category', async ({ mcp }) => {
    const summary = await mcp.call('actual_transactions_summary_by_category', { month: currentMonth() });
    expect(summary).toBeTruthy();
  });

  test('actual_transactions_summary_by_payee - should summarize by payee', async ({ mcp }) => {
    const summary = await mcp.call('actual_transactions_summary_by_payee', { month: currentMonth() });
    expect(summary).toBeTruthy();
  });

  // ==================== TRANSFERS (1 tool) ====================
  // #366: actual_transfers_create had unit coverage and nothing at integration level.
  // The only E2E reference lived in tests/e2e/suites/transactions.ts, which never ran,
  // and it passed `fromAccount`/`toAccount` where the schema requires
  // `from_account`/`to_account`, so it would have failed on its first execution.
  test('actual_transfers_create - creates a paired transfer and links both legs', async ({ mcp, makeAccount }) => {
    const src = await makeAccount({ name: `E2E-Xfer-Src-${uniqueSuffix()}` });
    const dst = await makeAccount({ name: `E2E-Xfer-Dst-${uniqueSuffix()}` });

    const amount = 1234;
    const created = await mcp.call('actual_transfers_create', {
      from_account: src.id,
      to_account: dst.id,
      amount,
      date: today(),
    });
    expect(created?.success).toBeTruthy();

    // Both legs, opposite signs, on their own accounts.
    const legs = async (acct: string) => {
      const d = await mcp.call('actual_transactions_get', { accountId: acct });
      return (Array.isArray(d) ? d : (d?.result ?? [])) as any[];
    };
    const debit = (await legs(src.id)).find((t: any) => t?.amount === -amount);
    const credit = (await legs(dst.id)).find((t: any) => t?.amount === amount);
    expect(debit).toBeTruthy();
    expect(credit).toBeTruthy();

    // Paired, not two unrelated transactions. This is what makes it a transfer.
    expect(debit.transfer_id).toBe(credit.id);
    expect(credit.transfer_id).toBe(debit.id);
  });

  test('actual_transfers_create - ERROR: refuses same account, unknown account and a non-positive amount', async ({ mcp, makeAccount }) => {
    const account = await makeAccount({ name: `E2E-Xfer-Neg-${uniqueSuffix()}` });
    const ghost = '00000000-0000-4000-8000-000000000366';

    // NOTE THE CONTRACT: adapter.createTransfer returns a structured
    // { success: false, error } for these refusals; it does NOT throw, unlike the #350
    // tools. Accept either, but require an actual refusal. Asserting only a throw would
    // fail against correct code. The divergence is tracked in #377.
    const refuses = async (args: Record<string, unknown>, label: string) => {
      let refused = false;
      try {
        refused = (await mcp.call('actual_transfers_create', args))?.success === false;
      } catch {
        refused = true;
      }
      expect(refused, label).toBe(true);
    };

    await refuses(
      { from_account: account.id, to_account: account.id, amount: 100, date: today() },
      'same account on both sides must be refused',
    );
    await refuses(
      { from_account: account.id, to_account: ghost, amount: 100, date: today() },
      'an account that does not exist must be refused',
    );
    await refuses(
      { from_account: account.id, to_account: ghost, amount: 0, date: today() },
      'a zero amount must be refused by the schema',
    );

    // Nothing may have been written by any of the three.
    const d = await mcp.call('actual_transactions_get', { accountId: account.id });
    const txns = (Array.isArray(d) ? d : (d?.result ?? [])) as any[];
    expect(txns.length).toBe(0);
  });

  // ==================== BUDGETS (9 tools) ====================
  test('actual_budgets_get_all - should get all budgets', async ({ mcp }) => {
    expect(await mcp.call('actual_budgets_get_all')).toBeTruthy();
  });

  test('actual_budgets_getMonth - should get month budget', async ({ mcp }) => {
    expect(await mcp.call('actual_budgets_getMonth', { month: currentMonth() })).toBeTruthy();
  });

  test('actual_budgets_getMonths - should get multiple months', async ({ mcp }) => {
    const data = await mcp.call('actual_budgets_getMonths', {
      start: currentMonth(),
      end: currentMonth(),
    });
    const months = Array.isArray(data) ? data : (data?.months || []);
    expect(months).toBeTruthy();
  });

  test('actual_budgets_setAmount - should set budget amount', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();
    await mcp.call('actual_budgets_setAmount', {
      month: currentMonth(),
      categoryId: category.id,
      amount: 50000,
    });

    // Assert the amount actually landed rather than that the call returned.
    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    const groups = (month?.categoryGroups ?? month?.categoryGroups ?? []) as any[];
    const budgeted = groups
      .flatMap((g: any) => g?.categories ?? [])
      .find((c: any) => c?.id === category.id)?.budgeted;
    expect(budgeted).toBe(50000);
  });

  test('actual_budgets_setCarryover - should set carryover', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();
    await mcp.call('actual_budgets_setCarryover', {
      month: currentMonth(),
      categoryId: category.id,
      flag: true,
    });

    // Read the flag back. Calling a write tool and asserting nothing is the failure mode
    // #350 exists to remove: it passes whether or not the write had any effect.
    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    const cats = ((month?.categoryGroups ?? []) as any[]).flatMap((g: any) => g?.categories ?? []);
    expect(cats.find((c: any) => c?.id === category.id)?.carryover).toBe(true);
  });

  test('actual_budgets_holdForNextMonth - should hold for next month', async ({ mcp, makeAccount, cleanup }) => {
    // #369 item 1. This test used to pass on success OR on a /nothing was held/ refusal,
    // because the fixture's To Budget was unknown. That made it a test that CANNOT FAIL: a
    // regression to always-refusing stayed green, and the only executing proof of the
    // success path was a unit fake.
    //
    // The fixture is controllable. An on-budget account created with a positive starting
    // balance books that balance as INCOME for the current month, and To Budget is computed
    // from income minus what is already allocated. Establishing it here makes the success
    // branch assertable outright.
    const month = currentMonth();
    const requested = 10000;

    // Registered before the write, and before the account exists, so a failed assertion
    // still clears the hold. It runs ahead of the account delete (CLEANUP_ORDER), while
    // the income it was computed from is still there.
    cleanup.add(CLEANUP_ORDER.budgetHold, `reset hold for ${month}`, async () => {
      await mcp.call('actual_budgets_resetHold', { month });
    });
    await makeAccount({ balance: 500_000 });

    const before = await mcp.call('actual_budgets_getMonth', { month });
    expect(
      before?.toBudget,
      'the seeded income must leave more to budget than the hold asks for',
    ).toBeGreaterThan(requested);
    const heldBefore = Number(before?.forNextMonth ?? 0);

    const res = await mcp.call('actual_budgets_holdForNextMonth', { month, amount: requested });
    // Note there is no categoryId: the tool holds against the MONTH as a whole. The old
    // version passed one, which the schema silently stripped.
    expect(res?.held).toBe(requested);
    expect(res?.partial, 'a hold well inside To Budget must not be clamped').toBeFalsy();

    // And the money actually moved. #355 exists because upstream can hold LESS than asked
    // (it clamps to what is left) or nothing at all, while reporting plain success.
    const after = await mcp.call('actual_budgets_getMonth', { month });
    expect(Number(after?.forNextMonth ?? 0) - heldBefore).toBe(requested);
  });

  test('actual_budgets_resetHold - should reset hold', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();
    // resetHold clears the month's held-for-next-month buffer, which is a property of the
    // MONTH rather than of the category, so what is asserted is that the call is accepted
    // and the month remains readable and consistent afterwards. Asserting a specific
    // buffer value would require the fixture to first produce a positive To Budget, which
    // is #369 item 1 and needs a live budget to establish.
    await mcp.call('actual_budgets_resetHold', { month: currentMonth(), categoryId: category.id });

    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    expect(month?.month ?? month?.categoryGroups).toBeTruthy();
    expect(typeof month?.forNextMonth === 'number' || month?.forNextMonth === undefined).toBe(true);
  });

  test('actual_budget_updates_batch - should batch update budgets', async ({ mcp, makeCategory }) => {
    test.setTimeout(60000); // Batch operations can take longer
    const category = await makeCategory();

    const result = await mcp.call('actual_budget_updates_batch', {
      operations: [{ month: currentMonth(), categoryId: category.id, amount: 60000 }],
    });
    expect(result).toBeTruthy();

    // The batch must have LANDED, not merely returned. This is one extra call and it is
    // the difference between testing the tool and testing that it did not throw.
    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    const cats = ((month?.categoryGroups ?? []) as any[]).flatMap((g: any) => g?.categories ?? []);
    expect(cats.find((c: any) => c?.id === category.id)?.budgeted).toBe(60000);
  });

  test('actual_budget_updates_batch - should handle large batch (35 ops)', async ({ mcp, makeCategory }) => {
    // #278: back to 60s. This test was never slow, it was DEADLOCKED, and it was a
    // correct canary. #273 raised the timeout to 120s on the theory that the request
    // queued behind others on the api mutex "under the full parallel load". That cannot
    // be: playwright.config.docker.ts sets `workers: 1` and `retries: 0`, so these tests
    // run serially and nothing contends for the mutex.
    //
    // The real cause was a lost wakeup in the adapter's write queue: this test fires its
    // write ~11ms after the previous test's response, landing while that batch was still
    // draining (the response is sent from inside Promise.allSettled, before api.sync()
    // and before the lock releases). The enqueued op was never dispatched, so it hung
    // until an unrelated later write drained the queue. No timeout value can fix a hang.
    // Fixed in src/lib/actual-adapter.ts; regression pinned by
    // tests/unit/adapter_write_queue_wakeup.test.js.
    test.setTimeout(60000);
    const category = await makeCategory();

    const operations = [];
    for (let i = 0; i < 35; i++) {
      operations.push({ month: currentMonth(), categoryId: category.id, amount: 10000 + i * 100 });
    }

    expect(await mcp.call('actual_budget_updates_batch', { operations })).toBeTruthy();

    // All 35 operations target the same category, so the LAST one wins. Asserting its
    // amount proves the whole batch drained rather than stalling partway, which is the
    // #278 lost-wakeup failure this test was originally the canary for.
    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    const cats = ((month?.categoryGroups ?? []) as any[]).flatMap((g: any) => g?.categories ?? []);
    expect(cats.find((c: any) => c?.id === category.id)?.budgeted).toBe(10000 + 34 * 100);
  });

  test('actual_budgets_transfer - should transfer between categories', async ({ mcp, makeCategory }) => {
    const source = await makeCategory();
    // Same group, which is what the original did, and it keeps the teardown cheap.
    const target = await makeCategory({ group: { id: source.groupId, name: 'reused' } });

    // Fund the source so the transfer has something to move. Without this the test
    // depended on whatever an earlier test had budgeted.
    await mcp.call('actual_budgets_setAmount', {
      month: currentMonth(),
      categoryId: source.id,
      amount: 20000,
    });

    await mcp.call('actual_budgets_transfer', {
      month: currentMonth(),
      amount: 5000,
      fromCategoryId: source.id,
      toCategoryId: target.id,
    });

    const month = await mcp.call('actual_budgets_getMonth', { month: currentMonth() });
    const cats = ((month?.categoryGroups ?? []) as any[]).flatMap((g: any) => g?.categories ?? []);
    expect(cats.find((c: any) => c?.id === target.id)?.budgeted).toBe(5000);
    expect(cats.find((c: any) => c?.id === source.id)?.budgeted).toBe(15000);
  });

  test('actual_budgets_transfer - should reject insufficient funds', async ({ mcp, makeCategory }) => {
    const target = await makeCategory();
    // A sink category with zero budgeted. Insufficient funds is the rejection we want,
    // regardless of anything else in the month.
    const sink = await makeCategory({ group: { id: target.groupId, name: 'reused' } });

    const result = await mcp
      .call('actual_budgets_transfer', {
        month: currentMonth(),
        amount: 99_999_999,
        fromCategoryId: sink.id,
        toCategoryId: target.id,
      })
      .catch((err: Error) => ({ __error: err.message }) as any);

    const errMsg = (result as any)?.__error ?? (result as any)?.error?.message ?? '';
    expect(errMsg).toContain('Insufficient budget');
  });

  // ==================== RULES (4 tools) ====================
  test('actual_rules_get - should list rules', async ({ mcp }) => {
    const data = await mcp.call('actual_rules_get');
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(rules).toBeTruthy();
  });

  test('actual_rules_create - should create rule without op field', async ({ mcp, makeCategory, makeRule }) => {
    const category = await makeCategory();
    const rule = await makeRule({ categoryId: category.id, withoutOp: true });

    const data = await mcp.call('actual_rules_get');
    const rules = (Array.isArray(data) ? data : (data?.rules ?? [])) as any[];
    expect(rules.find((r: any) => r?.id === rule.id)).toBeTruthy();
  });

  test('actual_rules_create - should create rule with op field', async ({ mcp, makeCategory, makeRule }) => {
    const category = await makeCategory();
    const rule = await makeRule({ categoryId: category.id });

    const data = await mcp.call('actual_rules_get');
    const rules = (Array.isArray(data) ? data : (data?.rules ?? [])) as any[];
    expect(rules.find((r: any) => r?.id === rule.id)).toBeTruthy();
  });

  test('actual_rules_update - should update rule', async ({ mcp, makeCategory, makeRule }) => {
    const category = await makeCategory();
    const rule = await makeRule({ categoryId: category.id });

    const marker = `updated-marker-${uniqueSuffix()}`;
    await mcp.call('actual_rules_update', {
      id: rule.id,
      fields: {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'notes', op: 'contains', value: marker }],
        actions: [{ op: 'set', field: 'category', value: category.id }],
      },
    });

    const data = await mcp.call('actual_rules_get');
    const rules = (Array.isArray(data) ? data : (data?.rules ?? [])) as any[];
    const updated = rules.find((r: any) => r?.id === rule.id);
    expect(updated).toBeTruthy();
    expect(JSON.stringify(updated.conditions)).toContain(marker);
  });

  test('actual_rules_create_or_update - should upsert rule idempotently', async ({ mcp, makeCategory, cleanup }) => {
    const category = await makeCategory();
    const marker = `E2E-Upsert-${uniqueSuffix()}`;
    const conditions = [{ field: 'notes', op: 'contains', value: marker }];
    const actions = [{ op: 'set', field: 'category', value: category.id }];

    // Parse the raw MCP envelope directly to preserve the { id, created } shape.
    // extractResult() reduces objects with an 'id' field down to just the id string,
    // which would make `created` undefined.
    const parseUpsert = (raw: any): { id: string; created: boolean } =>
      raw?.content?.[0]?.text ? JSON.parse(raw.content[0].text) : raw;

    // First call: must create (created=true)
    const firstData = parseUpsert(
      await mcp.raw('actual_rules_create_or_update', { stage: 'pre', conditionsOp: 'and', conditions, actions }),
    );
    expect(typeof firstData.id).toBe('string');
    expect(firstData.created).toBe(true);
    cleanup.add(CLEANUP_ORDER.rule, `upsert rule ${marker}`, async () => {
      await mcp.call('actual_rules_delete', { id: firstData.id });
    });

    // Second call with identical conditions: must update (created=false, same id)
    const secondData = parseUpsert(
      await mcp.raw('actual_rules_create_or_update', { stage: 'pre', conditionsOp: 'and', conditions, actions }),
    );
    expect(secondData.id).toBe(firstData.id);
    expect(secondData.created).toBe(false);
  });

  // ==================== ADVANCED (2 tools) ====================
  test('actual_bank_sync - should return actionable error when no accounts are bank-linked', async ({ mcp }) => {
    // The test budget has no bank-linked accounts, so this must throw immediately with an
    // actionable message. A real bank-linked account in the budget would need this updated.
    let threw = false;
    let errorMessage = '';
    try {
      await mcp.call('actual_bank_sync');
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }
    expect(threw).toBe(true);
    expect(/not configured|no accounts|local account|not found/i.test(errorMessage)).toBe(true);
  });

  test('actual_bank_sync - should return actionable error for local account', async ({ mcp, makeAccount }) => {
    const account = await makeAccount({ name: `BankSync-LocalTest-${uniqueSuffix()}` });

    let threw = false;
    let errorMessage = '';
    try {
      await mcp.call('actual_bank_sync', { accountId: account.id });
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }

    // This account is local (created without bank sync), so it must reject immediately.
    expect(threw).toBe(true);
    expect(/local account|not configured/i.test(errorMessage)).toBe(true);
  });

  test('actual_bank_sync - should return actionable error for non-existent accountId', async ({ mcp }) => {
    let threw = false;
    let errorMessage = '';
    try {
      await mcp.call('actual_bank_sync', { accountId: '00000000-0000-0000-0000-000000000000' });
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }
    expect(threw).toBe(true);
    expect(/not found|not configured|local account/i.test(errorMessage)).toBe(true);
  });

  test('actual_query_run - should execute SELECT * query', async ({ mcp }) => {
    expect(await mcp.call('actual_query_run', { query: 'SELECT * FROM transactions LIMIT 10' })).toBeTruthy();
  });

  test('actual_query_run - should execute query with specific fields', async ({ mcp }) => {
    expect(
      await mcp.call('actual_query_run', { query: 'SELECT id, date, amount, account FROM transactions LIMIT 10' }),
    ).toBeTruthy();
  });

  test('actual_query_run - should execute query with join path (payee.name)', async ({ mcp }) => {
    expect(
      await mcp.call('actual_query_run', { query: 'SELECT id, date, amount, payee.name FROM transactions LIMIT 10' }),
    ).toBeTruthy();
  });

  test('actual_query_run - should execute query with join path (category.name)', async ({ mcp }) => {
    expect(
      await mcp.call('actual_query_run', {
        query: 'SELECT id, amount, category.name FROM transactions WHERE amount < 0 LIMIT 10',
      }),
    ).toBeTruthy();
  });

  test('actual_query_run - should execute query with WHERE and ORDER BY', async ({ mcp }) => {
    expect(
      await mcp.call('actual_query_run', {
        query: 'SELECT id, date, amount FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 20',
      }),
    ).toBeTruthy();
  });

  test('actual_query_run - #420 boolean WHERE: the value actually PARTITIONS the rows', async ({ mcp }) => {
    // Two things this proves that a `toBeTruthy()` on the result could not:
    //   1. The query EXECUTES. Before #420 it threw "Can't convert string/integer to boolean".
    //   2. The boolean value is HONOURED. `cleared = true` and `cleared = false` must sum to the
    //      unfiltered count, which can only hold if each side filters correctly. `cleared` is used
    //      deliberately rather than `is_parent`: upstream's default `splits: 'inline'` executor
    //      appends `AND is_parent = 0` to every transactions query, so `is_parent = true` can never
    //      return a row and would be a vacuous test. `cleared` has no such special-casing.
    const rows = (r: any): number => {
      const d = Array.isArray(r) ? r : (r?.data ?? r?.result?.data ?? []);
      return Array.isArray(d) ? d.length : 0;
    };
    const total = rows(await mcp.call('actual_query_run', { query: 'SELECT id FROM transactions' }));
    const cleared = rows(await mcp.call('actual_query_run', { query: 'SELECT id FROM transactions WHERE cleared = true' }));
    const uncleared = rows(await mcp.call('actual_query_run', { query: 'SELECT id FROM transactions WHERE cleared = false' }));
    expect(cleared + uncleared).toBe(total);

    // The integer form must behave identically to the boolean form (SQL convention, #420).
    const clearedInt = rows(await mcp.call('actual_query_run', { query: 'SELECT id FROM transactions WHERE cleared = 1' }));
    expect(clearedInt).toBe(cleared);

    // IN on a boolean column, which #420 routes through $or rather than the stringifying $oneof.
    // (true, false) is the whole set, so it must return every row.
    const both = rows(await mcp.call('actual_query_run', { query: 'SELECT id FROM transactions WHERE cleared IN (true, false)' }));
    expect(both).toBe(total);
  });

  test('actual_query_run - #420 boolean WHERE: an invalid boolean literal is refused, naming the column', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT id FROM transactions WHERE is_parent = maybe LIMIT 5' }),
    ).rejects.toThrow(/is_parent|boolean/i);
  });

  test('actual_query_run - ERROR: should reject invalid field (payee_name)', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT id, payee_name FROM transactions LIMIT 5' }),
    ).rejects.toThrow(/payee_name|Available fields|invalid/i);
  });

  test('actual_query_run - ERROR: should reject invalid field (category_name)', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT id, category_name FROM transactions LIMIT 5' }),
    ).rejects.toThrow(/category_name|Available fields|invalid/i);
  });

  test('actual_query_run - ERROR: should reject invalid table name', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT * FROM transaction LIMIT 10' }),
    ).rejects.toThrow(/transaction|table|Available tables|invalid/i);
  });

  test('actual_query_run - ERROR: should reject invalid field in WHERE clause', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT id, amount FROM transactions WHERE payee_name = "Test"' }),
    ).rejects.toThrow(/payee_name|Available fields|invalid/i);
  });

  test('actual_query_run - ERROR: should reject multiple invalid fields', async ({ mcp }) => {
    await expect(
      mcp.call('actual_query_run', { query: 'SELECT id, payee_name, category_name FROM transactions' }),
    ).rejects.toThrow(/payee_name|category_name|Available fields|invalid/i);
  });

  test('actual_query_run - ERROR: should reject invalid join path (account.id)', async ({ mcp }) => {
    // account is a field, not a join path.
    await expect(
      mcp.call('actual_query_run', {
        query: "SELECT * FROM transactions WHERE account.id = 'bff82978-3f20-4956-860b-fa2cb069a144' ORDER BY date DESC LIMIT 5",
      }),
    ).rejects.toThrow(/account|Available fields|invalid/i);
  });

  // ==================== SCHEDULES (4 tools) ====================
  test('actual_schedules_get - should list schedules', async ({ mcp }) => {
    const data = await mcp.call('actual_schedules_get');
    const schedules: any[] = data?.schedules ?? data?.result?.schedules ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(schedules)).toBeTruthy();
  });

  test('actual_schedules_create - should create one-off schedule', async ({ mcp, makeSchedule }) => {
    const schedule = await makeSchedule();

    const data = await mcp.call('actual_schedules_get');
    const schedules: any[] = data?.schedules ?? data?.result?.schedules ?? (Array.isArray(data) ? data : []);
    expect(schedules.find((s: any) => s?.id === schedule.id)).toBeTruthy();
  });

  test('actual_schedules_update - should update schedule name', async ({ mcp, makeSchedule }) => {
    const schedule = await makeSchedule();
    const updatedName = `E2E-Schedule-Updated-${uniqueSuffix()}`;

    const data = await mcp.call('actual_schedules_update', { id: schedule.id, name: updatedName });
    expect(data?.success ?? data?.result?.success).toBe(true);

    const listData = await mcp.call('actual_schedules_get');
    const schedules: any[] =
      listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    expect(schedules.find((s: any) => s.id === schedule.id)?.name).toBe(updatedName);
  });

  test('actual_schedules_delete - should delete schedule and verify gone', async ({ mcp, makeSchedule }) => {
    const schedule = await makeSchedule();

    const data = await mcp.call('actual_schedules_delete', { id: schedule.id });
    expect(data?.success ?? data?.result?.success).toBe(true);

    const listData = await mcp.call('actual_schedules_get');
    const schedules: any[] =
      listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    expect(schedules.find((s: any) => s.id === schedule.id)).toBeFalsy();
  });

  // ==================== GET ID BY NAME ====================
  test('actual_get_id_by_name - should resolve account name to id', async ({ mcp, makeAccount }) => {
    // Resolve an account this test created, so the lookup is deterministic instead of
    // depending on whatever happens to be first in the budget's account list.
    const account = await makeAccount();

    const data = await mcp.call('actual_get_id_by_name', { type: 'accounts', name: account.name });
    const resolvedId = data?.id ?? (typeof data === 'string' ? data : null);
    expect(resolvedId).toBe(account.id);
  });

  // ==================== DELETE OPERATIONS (6 tools) ====================
  // Each test creates the object it deletes, then asserts it is absent from the
  // corresponding list. The factories' teardown re-attempts the delete and finds
  // nothing to do, which is why every cleanup step swallows its own error.

  test('actual_transactions_delete - should delete transaction and verify gone', async ({ mcp, makeAccount, makeTransaction }) => {
    const account = await makeAccount();
    const txn = await makeTransaction({ account });

    await mcp.call('actual_transactions_delete', { id: txn.id });

    const txns = ((await mcp.call('actual_transactions_filter', { accountId: account.id })) ?? []) as any[];
    expect(txns.find((t: any) => t.id === txn.id)).toBeFalsy();
  });

  test('actual_rules_delete - should delete rules and verify gone', async ({ mcp, makeCategory, makeRule }) => {
    const category = await makeCategory();
    const rules = [
      await makeRule({ categoryId: category.id, withoutOp: true }),
      await makeRule({ categoryId: category.id }),
    ];

    for (const rule of rules) {
      await mcp.call('actual_rules_delete', { id: rule.id });
    }

    const data = await mcp.call('actual_rules_get');
    const remaining: any[] = Array.isArray(data) ? data : (data?.rules ?? []);
    const ids = rules.map((r) => r.id);
    expect(remaining.filter((r: any) => ids.includes(r.id))).toHaveLength(0);
  });

  test('actual_payees_delete - should delete payee and verify gone', async ({ mcp, makePayee }) => {
    const payee = await makePayee();

    await mcp.call('actual_payees_delete', { id: payee.id });

    const payees = ((await mcp.call('actual_payees_get')) ?? []) as any[];
    expect(payees.find((p: any) => p.id === payee.id)).toBeFalsy();
  });

  test('actual_categories_delete - should delete category and verify gone', async ({ mcp, makeCategory }) => {
    const category = await makeCategory();

    await mcp.call('actual_categories_delete', { id: category.id });

    const data = await mcp.call('actual_categories_get');
    const categories: any[] = Array.isArray(data) ? data : (data?.categories ?? []);
    expect(categories.find((c: any) => c.id === category.id)).toBeFalsy();
  });

  test('actual_category_groups_delete - should delete category group and verify gone', async ({ mcp, makeCategoryGroup }) => {
    const group = await makeCategoryGroup();

    await mcp.call('actual_category_groups_delete', { id: group.id });

    const groups = await listGroups(mcp);
    expect(groups.find((g: any) => g.id === group.id)).toBeFalsy();
  });

  test('actual_accounts_delete - should delete account and verify gone', async ({ mcp, makeAccount }) => {
    const account = await makeAccount();

    await mcp.call('actual_accounts_delete', { id: account.id });

    const accounts = ((await mcp.call('actual_accounts_list')) ?? []) as any[];
    expect(accounts.find((a: any) => a.id === account.id)).toBeFalsy();
  });

  // ==================== TAGS ====================
  // Tags have no factory: they are a small, flat surface and each test below owns the
  // whole lifecycle of the tag it makes. They DO register cleanup, which the previous
  // version did not, so a tag no longer survives the run as residue.
  test('actual_tags_list - should list tags', async ({ mcp }) => {
    const data = await mcp.call('actual_tags_list');
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('actual_tags_create - should create a tag', async ({ mcp, cleanup }) => {
    const tag = `mcp-e2e-test-tag-${uniqueSuffix()}`;
    const data = await mcp.call('actual_tags_create', {
      tag,
      color: '#33aa33',
      description: 'Created by E2E test',
    });
    const id = typeof data === 'string' ? data : data?.id;
    expect(typeof id).toBe('string');
    cleanup.add(CLEANUP_ORDER.tag, `tag ${tag}`, async () => {
      await mcp.call('actual_tags_delete', { id });
    });

    const tags = ((await mcp.call('actual_tags_list')) ?? []) as any[];
    expect(tags.find((t: any) => t?.id === id || t?.tag === tag)).toBeTruthy();
  });

  test('actual_tags_create - upsert same name returns same id', async ({ mcp, cleanup }) => {
    const tag = `mcp-e2e-upsert-tag-${uniqueSuffix()}`;
    const id1 = await mcp.call('actual_tags_create', { tag });
    const id2 = await mcp.call('actual_tags_create', { tag, color: '#0000ff' });
    expect(id1).toEqual(id2);
    cleanup.add(CLEANUP_ORDER.tag, `tag ${tag}`, async () => {
      await mcp.call('actual_tags_delete', { id: id1 });
    });
  });

  test('actual_tags_update - should update a tag', async ({ mcp, cleanup }) => {
    const tag = `mcp-e2e-update-tag-${uniqueSuffix()}`;
    const tagId = await mcp.call('actual_tags_create', { tag });
    expect(typeof tagId).toBe('string');
    cleanup.add(CLEANUP_ORDER.tag, `tag ${tag}`, async () => {
      await mcp.call('actual_tags_delete', { id: tagId });
    });

    const data = await mcp.call('actual_tags_update', {
      id: tagId,
      tag: `${tag}-renamed`,
      color: '#112233',
    });
    expect(data?.success).toBeTruthy();
  });

  // ==================== NOTES ====================
  test('actual_notes_get - should return clear result for id with no note', async ({ mcp }) => {
    // A budget month far in the past, which will not have a note set.
    const data = await mcp.call('actual_notes_get', { id: 'budget-1970-01' });
    // Either a note object (found=true) or a no-note object (found=false) is valid.
    expect(typeof data?.found === 'boolean').toBeTruthy();
    expect(typeof data?.id === 'string').toBeTruthy();
  });

  test('actual_notes_update + actual_notes_get - round-trip note on budget month', async ({ mcp, cleanup }) => {
    const testId = 'budget-2026-01';
    const testNote = `E2E-notes-test-${uniqueSuffix()}`;
    // Registered up front so an assertion failure mid-test still clears the note.
    cleanup.add(CLEANUP_ORDER.note, `note on ${testId}`, async () => {
      await mcp.call('actual_notes_update', { id: testId, note: '' });
    });

    const setData = await mcp.call('actual_notes_update', { id: testId, note: testNote });
    expect(setData?.success).toBe(true);
    expect(setData?.id).toBe(testId);

    const getData = await mcp.call('actual_notes_get', { id: testId });
    expect(getData?.found).toBe(true);
    expect(getData?.note).toBe(testNote);

    const clearData = await mcp.call('actual_notes_update', { id: testId, note: '' });
    expect(clearData?.success).toBe(true);
    expect(clearData?.cleared).toBe(true);
  });

  test('actual_notes_update - orphan id returns error without writing', async ({ mcp }) => {
    const data = await mcp.call('actual_notes_update', {
      id: 'not-a-real-entity-id',
      note: 'should not be written',
    });
    // The tool returns { error: '...' } and does NOT write.
    expect(typeof data?.error === 'string').toBeTruthy();

    const readBack = await mcp.call('actual_notes_get', { id: 'not-a-real-entity-id' });
    expect(readBack?.found).toBe(false);
  });

  test('actual_tags_delete - should delete a tag', async ({ mcp }) => {
    const tag = `mcp-e2e-delete-tag-${uniqueSuffix()}`;
    const tagId = await mcp.call('actual_tags_create', { tag });
    expect(typeof tagId).toBe('string');

    const data = await mcp.call('actual_tags_delete', { id: tagId });
    expect(data?.success).toBeTruthy();

    const tags = ((await mcp.call('actual_tags_list')) ?? []) as any[];
    expect(tags.find((t: any) => t?.id === tagId)).toBeFalsy();
  });

  // ==================== PREFERENCES (1 tool) ====================
  test('actual_preferences_get - should read synced preferences', async ({ mcp }) => {
    const data = await mcp.call('actual_preferences_get');
    expect(data).toBeTruthy();
    // The normalisation contract: `preferences` is ALWAYS a non-array object and
    // `count` always matches its key count, whatever upstream returned.
    expect(typeof data?.preferences).toBe('object');
    expect(Array.isArray(data?.preferences)).toBe(false);
    expect(Array.isArray(data?.keys)).toBe(true);
    expect(data?.count).toBe(Object.keys(data.preferences).length);
  });

  // ==================== EXPORT / IMPORT ROUND TRIP (2 tools) ====================
  //
  // Deliberately the LAST tests in this file. actual_budgets_import LOADS the imported
  // budget, so the session's active budget changes and any test running after it would
  // silently run against the imported copy. The import test switches back at the end,
  // but ordering is the primary defence and the switch-back is the backstop.
  //
  // These are the one place where a shared MCP session is genuinely visible to the test:
  // the fixtures make each test provision its own DATA, and the session-level active
  // budget is not data any factory owns.
  //
  // The whole round trip stays server-side: the zip never crosses the transport. The
  // export tool returns a path inside the container, and the import tool reads that same
  // path, so this exercises the real file rather than a base64 copy.
  test('actual_budgets_export - should write a zip and report accurate metadata', async ({ mcp }) => {
    const data = await mcp.call('actual_budgets_export', { filename: 'e2e-roundtrip.zip' });

    expect(data?.success).toBe(true);
    expect(data?.filename).toBe('e2e-roundtrip.zip');
    expect(typeof data?.path).toBe('string');
    // A real budget export is never a handful of bytes. This catches the failure mode
    // where the zip is produced but empty or truncated, which a plain "did it throw"
    // assertion would miss entirely.
    expect(data?.bytes).toBeGreaterThan(100);
    expect(data?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('actual_budgets_export - a second export of unchanged data has the SAME size class', async ({ mcp }) => {
    // Not a digest equality assertion: an Actual export embeds per-export metadata
    // (timestamps, device state), so two exports of identical data legitimately differ
    // byte for byte. Asserting equal digests here would be a flaky test that looks
    // rigorous. Size stability is the honest invariant.
    //
    // #375: this test takes BOTH exports itself. It used to compare against a value the
    // previous test left in a module variable, and skipped when that value was absent,
    // so running it alone proved nothing.
    const first = await mcp.call('actual_budgets_export', { filename: 'e2e-roundtrip.zip' });
    expect(first?.bytes).toBeGreaterThan(100);

    const second = await mcp.call('actual_budgets_export', { filename: 'e2e-roundtrip-2.zip' });
    expect(second?.success).toBe(true);
    expect(second?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const drift = Math.abs(second.bytes - first.bytes) / first.bytes;
    expect(drift).toBeLessThan(0.5);
  });

  test('actual_budgets_import - should restore the export and preserve its accounts', async ({ mcp, cleanup }) => {
    // Resolve the budget to come back to, and register the switch-back as TEARDOWN before
    // importing anything. Doing it inline at the end of the test (as this used to) means a
    // failed assertion above leaves the session pointed at the imported budget for the
    // rest of the process, which is precisely the cross-test contamination #375 removes.
    // The name is asserted rather than guarded with `if`, so an unexpected shape fails
    // here instead of silently skipping the restore.
    const availableBefore = await mcp.call('actual_budgets_list_available');
    const originalName = (Array.isArray(availableBefore) ? availableBefore : availableBefore?.budgets)?.[0]?.name;
    expect(originalName, 'the configured budget must be resolvable before an import').toBeTruthy();
    cleanup.add(CLEANUP_ORDER.activeBudget, `restore active budget ${originalName}`, async () => {
      await mcp.call('actual_budgets_switch', { budgetName: originalName });
    });

    // Take the export this test will restore, rather than reading a path an earlier test
    // happened to leave behind.
    const exported = await mcp.call('actual_budgets_export', { filename: 'e2e-import-source.zip' });
    expect(typeof exported?.path).toBe('string');

    // Capture what the CURRENT budget looks like, so we can assert the restore.
    const beforeAccounts = await mcp.call('actual_accounts_list');
    const beforeCount = Array.isArray(beforeAccounts) ? beforeAccounts.length : 0;

    const data = await mcp.call('actual_budgets_import', { path: exported.path, type: 'actual' });

    expect(data?.success).toBe(true);
    expect(typeof data?.budgetId).toBe('string');
    expect(data?.source).toBe('path');
    // The side-effect warning is part of the contract, not decoration: an assistant that
    // misses it operates on the wrong budget for the rest of the session.
    expect(String(data?.message)).toMatch(/actual_budgets_switch/);

    // THE ROUND-TRIP ASSERTION. The imported budget is now loaded, so a plain
    // accounts_list reads the restored copy. Matching account counts is what proves the
    // export was actually restorable, rather than merely well-formed.
    const afterAccounts = await mcp.call('actual_accounts_list');
    const afterCount = Array.isArray(afterAccounts) ? afterAccounts.length : 0;
    expect(afterCount).toBe(beforeCount);

    // Restore the session to a CONFIGURED budget and assert it worked. The registered
    // teardown above is the backstop that runs even if an assertion fails; this is the
    // assertion that the switch itself is honoured, which teardown deliberately cannot
    // make because it swallows its own errors.
    const back = await mcp.call('actual_budgets_switch', { budgetName: originalName });
    expect(back?.success).toBe(true);
  });
});
