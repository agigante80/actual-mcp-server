/**
 * tests/e2e/suites/accounts.ts
 *
 * NOTE (#366): nothing currently executes this file. `registerAccountTests` has no call
 * site and neither Playwright config matches `suites/*.ts`, so the assertions below do
 * NOT run. The live equivalents live in `tests/e2e/docker-all-tools.e2e.spec.ts`. Do not
 * add coverage here expecting it to gate anything until #366 is resolved.
 *
 * Registration function for account lifecycle tests (7 tools, 9 named tests).
 * Writes state.ctx.accountId and state.ctx.accountName for use by later suites.
 */

import { test, expect } from '@playwright/test';
import { callTool, extractResult, DEFAULT_MCP_SERVER_URL, HTTP_PATH } from '../../shared/e2e-helpers.js';
import type { SharedState } from './shared-context.js';

export function registerAccountTests(state: SharedState): void {
  // ==================== ACCOUNTS (7 tools) ====================
  test('actual_accounts_list - should list all accounts', async ({ request }) => {
    const result = await callTool(request, state.sessionId, 'actual_accounts_list');
    const accounts = extractResult(result);
    expect(Array.isArray(accounts)).toBeTruthy();
    console.log(`✅ Listed ${accounts.length} accounts`);
  });

  test('actual_accounts_create - should create account', async ({ request }) => {
    const timestamp = Date.now();
    state.ctx.accountName = `E2E-Test-${timestamp}`;
    const result = await callTool(request, state.sessionId, 'actual_accounts_create', {
      name: state.ctx.accountName,
      balance: 0,
    });
    const accountId = extractResult(result);
    expect(accountId).toBeTruthy();
    expect(typeof accountId).toBe('string');
    state.ctx.accountId = accountId;
    console.log(`✅ Account created: ${accountId}`);
  });

  test('actual_accounts_create - ERROR: should fail without name', async ({ request }) => {
    // This test bypasses callTool to inspect the raw json.error field directly.
    const rpcUrl = `${DEFAULT_MCP_SERVER_URL}${HTTP_PATH}`;
    const payload = {
      jsonrpc: '2.0',
      id: 9999,
      method: 'tools/call',
      params: { name: 'actual_accounts_create', arguments: { balance: 0 } },
    };
    const res = await request.post(rpcUrl, {
      data: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', 'mcp-session-id': state.sessionId },
    });
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.error.message).toMatch(/name|required/i);
    console.log('✅ Validation error handled correctly');
  });

  test('actual_accounts_get_balance - should get account balance', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    const result = await callTool(request, state.sessionId, 'actual_accounts_get_balance', {
      id: state.ctx.accountId,
    });
    const data = extractResult(result);
    const balance = typeof data === 'number' ? data : data?.balance;
    expect(typeof balance).toBe('number');
    console.log(`✅ Balance retrieved: ${balance}`);
  });

  test('actual_accounts_update - should update account', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    await callTool(request, state.sessionId, 'actual_accounts_update', {
      id: state.ctx.accountId,
      fields: { name: state.ctx.accountName + '-Updated', offbudget: true },
    });
    console.log('✅ Account updated');
  });

  test('actual_accounts_update - ERROR: should reject invalid fields', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    try {
      await callTool(request, state.sessionId, 'actual_accounts_update', {
        id: state.ctx.accountId,
        fields: { invalidField: 'should fail' },
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      // #206: unrecognized keys now render as "unexpected field(s): X" via the central formatter.
      expect(error.message).toMatch(/unexpected field/i);
      console.log('✅ Invalid field rejected correctly');
    }
  });

  test('actual_accounts_close - should close account', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    // #357: seed a transaction FIRST. Actual tombstones an account with no transactions
    // when you close it, so without this the account is deleted and the reopen test below
    // fails with not-found. This file does not execute today (see the header note and
    // #366), and this seed is here so that whoever wires it up does not inherit a
    // guaranteed failure. The live spec does the same thing for the same reason.
    await callTool(request, state.sessionId, 'actual_transactions_create', {
      account: state.ctx.accountId,
      date: new Date().toISOString().substring(0, 10),
      amount: 0,
      notes: 'E2E fixture: keeps the account closable rather than deletable',
    });
    await callTool(request, state.sessionId, 'actual_accounts_close', {
      id: state.ctx.accountId,
    });
    console.log('✅ Account closed');
  });

  test('actual_accounts_reopen - should reopen account', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
    await callTool(request, state.sessionId, 'actual_accounts_reopen', {
      id: state.ctx.accountId,
    });
    // #358: assert the resulting STATE, not merely that the call returned. This test
    // previously logged a checkmark and would have passed even if the reopen had done
    // nothing at all.
    const listResult = await callTool(request, state.sessionId, 'actual_accounts_list', {});
    const data = extractResult(listResult);
    const accounts = Array.isArray(data) ? data : (data?.result ?? data?.accounts ?? []);
    const reopened = (accounts as any[]).find((a: any) => a?.id === state.ctx.accountId);
    expect(reopened).toBeTruthy();
    expect(reopened.closed).toBeFalsy();
    console.log('✅ Account reopened and confirmed open');
  });

  test('actual_accounts_reopen - unknown id is refused and creates nothing', async ({ request }) => {
    // #358 regression. Upstream reopenAccount is a bare db.update, and db.update INSERTs
    // when the row is absent, so an unknown id used to create a nameless account that
    // showed up in listings and synced to other clients. The second assertion is the one
    // that matters: nothing was created.
    const ghostId = '00000000-0000-4000-8000-000000000358';
    let refused = false;
    try {
      await callTool(request, state.sessionId, 'actual_accounts_reopen', { id: ghostId });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);

    const listResult = await callTool(request, state.sessionId, 'actual_accounts_list', {});
    const data = extractResult(listResult);
    const accounts = Array.isArray(data) ? data : (data?.result ?? data?.accounts ?? []);
    const ids = (accounts as any[]).map((a: any) => a?.id);
    expect(ids).not.toContain(ghostId);
    console.log('✅ Unknown reopen refused, no phantom account created');
  });
}
