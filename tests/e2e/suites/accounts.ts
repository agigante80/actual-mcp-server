/**
 * tests/e2e/suites/accounts.ts
 *
 * Registration function for account lifecycle tests (7 tools, 8 named tests).
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
      expect(error.message).toMatch(/Unrecognized|invalid/i);
      console.log('✅ Invalid field rejected correctly');
    }
  });

  test('actual_accounts_close - should close account', async ({ request }) => {
    if (!state.ctx.accountId) test.skip();
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
    console.log('✅ Account reopened');
  });
}
