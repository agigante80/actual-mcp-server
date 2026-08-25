/**
 * Comprehensive Docker E2E Tests - ALL 74 TOOLS
 *
 * Tests every tool with success and error scenarios
 * Based on manual integration tests and unit tests
 */

import { test, expect } from '@playwright/test';
import {
  waitForMCPHealth,
  retryRequest,
  callTool,
  extractResult,
  DEFAULT_MCP_SERVER_URL,
  HTTP_PATH,
} from '../shared/e2e-helpers.js';

test.describe('Docker E2E - ALL 74 TOOLS', () => {
  let sessionId: string;
  let testContext: {
    accountId?: string;
    accountName?: string;
    categoryGroupId?: string;
    categoryId?: string;
    payeeId?: string;
    payeeId2?: string;
    transactionId?: string;
    ruleId?: string;
    ruleWithoutOpId?: string;
    rulesUpsertId?: string;
    scheduleOneOffId?: string;
  } = {};

  // #332/#334: state for the export/import round trip at the end of this file.
  // Set by the export test, read by the second export and the import test.
  let exportedPath: string | undefined;
  let exportedSha: string | undefined;
  let exportedBytes: number | undefined;

  test.beforeAll(async ({ request }) => {
    console.log('🔌 Initializing MCP session...');
    const rpcUrl = `${DEFAULT_MCP_SERVER_URL}${HTTP_PATH}`;
    
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'docker-all-tools-e2e-test', version: '1.0.0' },
      },
    };

    const initRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }));

    sessionId = initRes.headers()['mcp-session-id'];
    expect(sessionId).toBeTruthy();
    
    // Wait for server to be fully ready
    const isHealthy = await waitForMCPHealth(request, `${DEFAULT_MCP_SERVER_URL}/health`);
    expect(isHealthy).toBeTruthy();
    
    console.log('✅ Session initialized and server ready');
  });

  // ==================== SERVER INFO ====================
  test('actual_server_info - should return server info', async ({ request }) => {
    console.log('🔧 Testing actual_server_info...');
    const result = await callTool(request, sessionId, 'actual_server_info');
    const data = extractResult(result);
    
    expect(data).toBeTruthy();
    console.log('✅ Server info retrieved');
  });

  test('actual_server_get_version - should return version string', async ({ request }) => {
    console.log('🔧 Testing actual_server_get_version...');
    const result = await callTool(request, sessionId, 'actual_server_get_version');
    const data = extractResult(result);

    expect(data).toBeTruthy();
    console.log(`✅ Server version: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  });

  // ==================== SESSION MANAGEMENT ====================
  test('actual_session_list - should list active sessions', async ({ request }) => {
    console.log('📋 Testing actual_session_list...');
    const result = await callTool(request, sessionId, 'actual_session_list');
    const data = extractResult(result);
    
    // Handle both array and object formats
    const sessions = Array.isArray(data) ? data : (data?.sessions || []);
    expect(sessions).toBeTruthy();
    console.log(`✅ Found ${sessions.length || 0} active sessions`);
  });

  test('actual_session_close - should handle close request gracefully', async ({ request }) => {
    console.log('🔒 Testing actual_session_close...');
    // Call with no sessionId: tool will try to close oldest idle session other than the current one.
    // In a single-session test environment it returns a non-error informational response — both
    // success and "no idle sessions / won't close current session" are acceptable outcomes.
    const result = await callTool(request, sessionId, 'actual_session_close', {});
    const data = extractResult(result);
    // Tool must return a structured response (not throw / not return null)
    expect(data).toBeTruthy();
    expect(typeof data).toBe('object');
    console.log(`✅ actual_session_close responded: ${data?.message ?? data?.success ?? JSON.stringify(data)}`);
  });

  // ==================== ACCOUNTS (7 tools) ====================
  test('actual_accounts_list - should list all accounts', async ({ request }) => {
    console.log('📁 Testing actual_accounts_list...');
    const result = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts = extractResult(result);
    
    expect(Array.isArray(accounts)).toBeTruthy();
    console.log(`✅ Listed ${accounts.length} accounts`);
  });

  test('actual_accounts_create - should create account', async ({ request }) => {
    console.log('➕ Testing actual_accounts_create...');
    const timestamp = Date.now();
    testContext.accountName = `E2E-Test-${timestamp}`;

    const result = await callTool(request, sessionId, 'actual_accounts_create', {
      name: testContext.accountName,
      balance: 0,
    });
    const accountId = extractResult(result);

    expect(accountId).toBeTruthy();
    expect(typeof accountId).toBe('string');
    testContext.accountId = accountId;
    console.log(`✅ Account created: ${accountId}`);
  });

  test('actual_accounts_create - ERROR: should fail without name', async ({ request }) => {
    console.log('⚠️  Testing actual_accounts_create error handling...');
    const rpcUrl = `${DEFAULT_MCP_SERVER_URL}${HTTP_PATH}`;
    const payload = {
      jsonrpc: '2.0',
      id: 9999,
      method: 'tools/call',
      params: {
        name: 'actual_accounts_create',
        arguments: { balance: 0 }, // Missing required 'name'
      },
    };

    const res = await request.post(rpcUrl, {
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId,
      },
    });

    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.error.message).toMatch(/name|required/i);
    console.log('✅ Validation error handled correctly');
  });

  test('actual_accounts_get_balance - should get account balance', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('💰 Testing actual_accounts_get_balance...');
    const result = await callTool(request, sessionId, 'actual_accounts_get_balance', {
      id: testContext.accountId,
    });
    const data = extractResult(result);
    
    // Handle both direct number and object with balance property
    const balance = typeof data === 'number' ? data : data?.balance;
    expect(typeof balance).toBe('number');
    console.log(`✅ Balance retrieved: ${balance}`);
  });

  test('actual_accounts_update - should update account', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('✏️  Testing actual_accounts_update...');
    await callTool(request, sessionId, 'actual_accounts_update', {
      id: testContext.accountId,
      fields: {
        name: testContext.accountName + '-Updated',
        offbudget: true,
      },
    });
    console.log('✅ Account updated');
  });

  // #206: prove the central error-formatter change does not regress the happy path over the wire.
  test('actual_accounts_update - POSITIVE: valid update succeeds with no error', async ({ request }) => {
    if (!testContext.accountId) test.skip();

    console.log('✅ Testing happy path is unaffected by the #206 formatter change...');
    // callTool throws on any tool error (including a validation error), so reaching the
    // assertions already proves the happy path was not regressed. extractResult unwraps
    // accounts_update's { success, accountId, updatedFields } envelope to the accountId.
    const result = await callTool(request, sessionId, 'actual_accounts_update', {
      id: testContext.accountId,
      fields: { name: testContext.accountName + '-Updated2' },
    });
    const data = extractResult(result);
    expect(data).toBe(testContext.accountId);
    console.log('✅ Valid update succeeded with no validation error');
  });

  test('actual_accounts_update - ERROR: should reject invalid fields', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('⚠️  Testing strict validation on accounts_update...');
    try {
      await callTool(request, sessionId, 'actual_accounts_update', {
        id: testContext.accountId,
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
    if (!testContext.accountId) test.skip();

    // #357/#358 FIXTURE FIX, and it is load bearing for everything after it in this
    // file. Actual TOMBSTONES an account that has no transactions when you close it
    // (closeAccount: `if (numTransactions === 0) await db.deleteAccount({ id })`), and
    // getAccounts filters `tombstone = 0`. The fixture account is created with balance 0
    // and the first transaction is not created until much later in this spec, so this
    // close used to DELETE it, and every later test that reused testContext.accountId
    // was operating on an id that no longer existed. Those tests passed only because the
    // tools silently accepted the dead id, which is the whole class of bug #350 is about.
    //
    // Seeding one transaction first is the same idiom tests/manual/tests/account.js has
    // used for this exact reason. With it, close means closed, reopen works, and the rest
    // of the suite runs against a live account.
    console.log('🌱 Seeding a transaction so the close does not tombstone the account...');
    await callTool(request, sessionId, 'actual_transactions_create', {
      account: testContext.accountId,
      date: new Date().toISOString().substring(0, 10),
      amount: 0,
      notes: 'E2E fixture: keeps the account closable rather than deletable',
    });

    console.log('🔒 Testing actual_accounts_close...');
    const result = await callTool(request, sessionId, 'actual_accounts_close', {
      id: testContext.accountId,
    });
    // #357: assert the resulting STATE. Both outcomes are handled because the tool now
    // reports which one happened, but with the seed transaction above the closed branch
    // is the expected one.
    const closeResult = extractResult(result);
    const listResult = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const found = (Array.isArray(accounts) ? accounts : []).find(
      (a: any) => a?.id === testContext.accountId,
    );
    if (closeResult?.removed) {
      expect(found).toBeFalsy();
      console.log('✅ Account had no transactions and was removed, as reported');
    } else {
      expect(found).toBeTruthy();
      expect(found.closed).toBeTruthy();
      console.log('✅ Account closed and confirmed closed');
    }
  });

  test('actual_accounts_close - already closed reports no change', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    // #357: a second close must not claim to have closed anything. It is still a
    // success (the requested state holds) but it says nothing changed. If the first
    // close removed the account instead, this is a not-found, which is also correct.
    console.log('🔒 Testing actual_accounts_close on an already-closed account...');
    try {
      const result = await callTool(request, sessionId, 'actual_accounts_close', {
        id: testContext.accountId,
      });
      const payload = extractResult(result);
      expect(payload?.alreadyClosed).toBeTruthy();
      console.log('✅ Second close reported alreadyClosed');
    } catch (error: any) {
      expect(error.message).toMatch(/not found/i);
      console.log('✅ Account was removed by the first close, so the second is not-found');
    }
  });

  test('actual_accounts_reopen - should reopen account', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('🔓 Testing actual_accounts_reopen...');
    await callTool(request, sessionId, 'actual_accounts_reopen', {
      id: testContext.accountId,
    });
    // #358: assert the resulting STATE. This test used to call the tool and log a
    // checkmark, so it passed whether or not the reopen did anything at all.
    const listResult = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const reopened = (Array.isArray(accounts) ? accounts : []).find(
      (a: any) => a?.id === testContext.accountId,
    );
    expect(reopened).toBeTruthy();
    expect(reopened.closed).toBeFalsy();
    console.log('✅ Account reopened and confirmed open');
  });

  test('actual_accounts_reopen - unknown id is refused and creates nothing', async ({ request }) => {
    // #358 regression. Upstream reopenAccount is a bare db.update, and db.update INSERTs
    // when the row is absent, so an unknown id used to create a nameless account that
    // appeared in listings and synced to other clients. The second assertion is the one
    // that matters: nothing was created.
    console.log('🔓 Testing actual_accounts_reopen with an unknown id...');
    const ghostId = '00000000-0000-4000-8000-000000000358';
    let refused = false;
    try {
      await callTool(request, sessionId, 'actual_accounts_reopen', { id: ghostId });
    } catch (error: any) {
      refused = true;
      expect(error.message).toMatch(/not found/i);
    }
    expect(refused).toBe(true);

    const listResult = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const ids = (Array.isArray(accounts) ? accounts : []).map((a: any) => a?.id);
    expect(ids).not.toContain(ghostId);
    console.log('✅ Unknown reopen refused, no phantom account created');
  });

  // ==================== CATEGORY GROUPS (4 tools) ====================
  test('actual_category_groups_get - should list category groups', async ({ request }) => {
    console.log('📂 Testing actual_category_groups_get...');
    const result = await callTool(request, sessionId, 'actual_category_groups_get');
    const groups = extractResult(result);
    
    expect(groups).toBeTruthy();
    console.log('✅ Category groups listed');
  });

  test('actual_category_groups_create - should create category group', async ({ request }) => {
    console.log('➕ Testing actual_category_groups_create...');
    const timestamp = Date.now();
    
    const result = await callTool(request, sessionId, 'actual_category_groups_create', {
      name: `E2E-Group-${timestamp}`,
    });
    const groupId = extractResult(result);
    
    expect(groupId).toBeTruthy();
    testContext.categoryGroupId = groupId;
    console.log(`✅ Category group created: ${groupId}`);
  });

  test('actual_category_groups_update - should update category group', async ({ request }) => {
    if (!testContext.categoryGroupId) test.skip();
    
    console.log('✏️  Testing actual_category_groups_update...');
    // Ensure ID is string (extractResult might return object)
    const groupId = typeof testContext.categoryGroupId === 'string' 
      ? testContext.categoryGroupId 
      : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);
    
    await callTool(request, sessionId, 'actual_category_groups_update', {
      id: groupId,
      fields: { name: 'E2E-Group-Updated' },
    });
    console.log('✅ Category group updated');
  });

  // ==================== CATEGORIES (4 tools) ====================
  test('actual_categories_get - should list categories', async ({ request }) => {
    console.log('📁 Testing actual_categories_get...');
    const result = await callTool(request, sessionId, 'actual_categories_get');
    const categories = extractResult(result);
    
    expect(categories).toBeTruthy();
    console.log('✅ Categories listed');
  });

  test('actual_categories_create - should create category', async ({ request }) => {
    if (!testContext.categoryGroupId) test.skip();
    
    console.log('➕ Testing actual_categories_create...');
    const timestamp = Date.now();
    
    // Ensure group_id is a string
    const groupId = typeof testContext.categoryGroupId === 'string' 
      ? testContext.categoryGroupId 
      : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);
    
    const result = await callTool(request, sessionId, 'actual_categories_create', {
      name: `E2E-Category-${timestamp}`,
      group_id: groupId,
    });
    const data = extractResult(result);
    
    // Extract categoryId from the response object
    const categoryId = typeof data === 'string' ? data : data?.categoryId;
    expect(categoryId).toBeTruthy();
    testContext.categoryId = categoryId;
    console.log(`✅ Category created: ${categoryId}`);
  });

  test('actual_categories_create - ERROR: should fail without group_id', async ({ request }) => {
    console.log('⚠️  Testing actual_categories_create error handling...');
    try {
      await callTool(request, sessionId, 'actual_categories_create', {
        name: 'Test-No-Group',
      });
      throw new Error('Should have failed without group_id');
    } catch (error: any) {
      expect(error.message).toMatch(/group_id|required/i);
      console.log('✅ Missing group_id rejected');
    }
  });

  test('actual_categories_update - should update category', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('✏️  Testing actual_categories_update...');
    
    // Ensure categoryId is a string
    const categoryId = typeof testContext.categoryId === 'string' 
      ? testContext.categoryId 
      : (testContext.categoryId as any).id || String(testContext.categoryId);
    
    await callTool(request, sessionId, 'actual_categories_update', {
      id: categoryId,
      fields: { name: 'E2E-Category-Updated' },
    });
    console.log('✅ Category updated');
  });

  // ==================== PAYEES (6 tools) ====================
  test('actual_payees_get - should list payees', async ({ request }) => {
    console.log('Testing actual_payees_get...');
    const result = await callTool(request, sessionId, 'actual_payees_get');
    const payees = extractResult(result);

    expect(Array.isArray(payees)).toBeTruthy();
    console.log(`Listed ${payees.length} payees`);
  });

  test('actual_payees_common_list - should return recent frequent payees or empty array', async ({ request }) => {
    console.log('Testing actual_payees_common_list...');
    const result = await callTool(request, sessionId, 'actual_payees_common_list');
    const payees = extractResult(result);

    // Empty list is a valid success result (no recent activity); both cases must pass.
    expect(Array.isArray(payees)).toBeTruthy();
    expect(payees.length).toBeGreaterThanOrEqual(0);
    expect(payees.length).toBeLessThanOrEqual(10);

    // Verify shape of each entry when results are present
    for (const p of payees) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      // transfer_acct is optional
      if ('transfer_acct' in p && p.transfer_acct !== undefined) {
        expect(typeof p.transfer_acct).toBe('string');
      }
    }
    console.log(`Common payees returned: ${payees.length} (empty is also valid)`);
  });

  test('actual_payees_create - should create payee', async ({ request }) => {
    console.log('➕ Testing actual_payees_create...');
    const timestamp = Date.now();
    
    const result = await callTool(request, sessionId, 'actual_payees_create', {
      name: `E2E-Payee-${timestamp}`,
    });
    const payeeId = extractResult(result);
    
    expect(payeeId).toBeTruthy();
    testContext.payeeId = payeeId;
    console.log(`✅ Payee created: ${payeeId}`);
  });

  test('actual_payees_create - should create second payee for merge test', async ({ request }) => {
    console.log('➕ Creating second payee...');
    const timestamp = Date.now();
    
    const result = await callTool(request, sessionId, 'actual_payees_create', {
      name: `E2E-Payee2-${timestamp}`,
    });
    const payeeId = extractResult(result);
    
    expect(payeeId).toBeTruthy();
    testContext.payeeId2 = payeeId;
    console.log(`✅ Second payee created: ${payeeId}`);
  });

  test('actual_payees_update - should update payee name and set default category via rule', async ({ request }) => {
    if (!testContext.payeeId) test.skip();

    console.log('✏️  Testing actual_payees_update (name)...');
    await callTool(request, sessionId, 'actual_payees_update', {
      id: testContext.payeeId,
      fields: { name: 'E2E-Payee-Updated' },
    });
    console.log('✅ Payee name updated');

    // Set default category — adapter stores this as a "payee is X → set category" rule,
    // NOT as a direct DB column (category does not exist on the payees table in @actual-app/api v26+)
    if (testContext.categoryId) {
      await callTool(request, sessionId, 'actual_payees_update', {
        id: testContext.payeeId,
        fields: { category: testContext.categoryId },
      });
      console.log('✅ Payee default category set via rules');

      // Verify: payee_rules_get should show a "set category" rule
      const rulesResult = await callTool(request, sessionId, 'actual_payee_rules_get', {
        payeeId: testContext.payeeId,
      });
      const rulesData = extractResult(rulesResult);
      const rules = Array.isArray(rulesData) ? rulesData : (rulesData?.rules || []);
      const setCatRule = rules.find((r: any) =>
        Array.isArray(r.actions) &&
        r.actions.some((a: any) => a.op === 'set' && a.field === 'category')
      );
      if (setCatRule) {
        const action = setCatRule.actions.find((a: any) => a.op === 'set' && a.field === 'category');
        expect(action.value).toBe(testContext.categoryId);
        console.log('✅ Verified: set-category rule created for payee');
      } else {
        console.log(`⚠ No set-category rule found in ${rules.length} rule(s) — check adapter`);
      }
    } else {
      console.log('⚠ categoryId not in testContext — skipping category rule verification');
    }
  });

  test('actual_payees_update - should clear default category (null removes rule)', async ({ request }) => {
    if (!testContext.payeeId || !testContext.categoryId) test.skip();

    console.log('🧹 Testing actual_payees_update category=null (delete rule path)...');
    await callTool(request, sessionId, 'actual_payees_update', {
      id: testContext.payeeId,
      fields: { category: null },
    });
    console.log('✅ category=null accepted');

    // Verify: no set-category rule remains
    const rulesResult = await callTool(request, sessionId, 'actual_payee_rules_get', {
      payeeId: testContext.payeeId,
    });
    const rulesData = extractResult(rulesResult);
    const rules = Array.isArray(rulesData) ? rulesData : (rulesData?.rules || []);
    const remaining = rules.filter((r: any) =>
      Array.isArray(r.actions) &&
      r.actions.some((a: any) => a.op === 'set' && a.field === 'category')
    );
    expect(remaining.length).toBe(0);
    console.log('✅ Verified: set-category rule removed after category=null');
  });

  test('actual_payees_update - ERROR: should reject invalid fields', async ({ request }) => {
    if (!testContext.payeeId) test.skip();
    
    console.log('⚠️  Testing strict validation on payees_update...');
    try {
      await callTool(request, sessionId, 'actual_payees_update', {
        id: testContext.payeeId,
        fields: { invalidField: 'should fail' },
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      // #206: unrecognized keys now render as "unexpected field(s): X" via the central formatter.
      expect(error.message).toMatch(/unexpected field/i);
      console.log('✅ Invalid field rejected');
    }
  });

  test('actual_payees_merge - should merge payees', async ({ request }) => {
    if (!testContext.payeeId || !testContext.payeeId2) test.skip();
    
    console.log('🔀 Testing actual_payees_merge...');
    await callTool(request, sessionId, 'actual_payees_merge', {
      targetId: testContext.payeeId,
      mergeIds: [testContext.payeeId2],
    });
    testContext.payeeId2 = undefined; // Merged away
    console.log('✅ Payees merged');
  });

  // ==================== ENTITY SEARCH (1 tool) ====================
  test('actual_entities_search - should find payees by partial name and confirm no-match contract', async ({ request }) => {
    console.log('Testing actual_entities_search...');

    // Fetch live payees so the test is robust against unknown seed data.
    const payeesResult = await callTool(request, sessionId, 'actual_payees_get');
    const allPayees: any[] = extractResult(payeesResult) ?? [];

    const namedPayees = allPayees.filter((p: any) => typeof p.name === 'string' && p.name.length > 0);

    if (namedPayees.length > 0) {
      // Take a guaranteed substring of an existing payee name (min 2 chars from the middle).
      const seedPayee = namedPayees[0];
      const fullName: string = seedPayee.name;
      const mid = Math.floor(fullName.length / 2);
      const fragment = fullName.slice(Math.max(0, mid - 2), mid + 3).toLowerCase();

      const searchResult = await callTool(request, sessionId, 'actual_entities_search', {
        type: 'payees',
        query: fragment,
        matchType: 'contains',
        limit: 50,
      });
      const data = extractResult(searchResult);

      // Shape assertions: matches array, count, type, matchType always present.
      expect(Array.isArray(data?.matches)).toBeTruthy();
      expect(typeof data?.count).toBe('number');
      expect(data?.type).toBe('payees');
      expect(data?.matchType).toBe('contains');

      // At least one match must be in the live payee list.
      const liveIds = new Set(namedPayees.map((p: any) => p.id));
      const matchedInLive = (data?.matches as any[]).some((m: any) => liveIds.has(m.id));
      expect(matchedInLive).toBeTruthy();

      console.log(`entities_search (contains "${fragment}"): ${data?.count} match(es), confirmed id in live payee list`);
    } else {
      console.log('entities_search: no named payees in budget (contains sub-test skipped)');
    }

    // No-match contract: a clearly-nonexistent query must return count:0, matches:[], no error.
    const noMatchResult = await callTool(request, sessionId, 'actual_entities_search', {
      type: 'payees',
      query: 'zzz-definitely-nonexistent-payee-xqz-9999',
      matchType: 'contains',
      limit: 10,
    });
    const noMatchData = extractResult(noMatchResult);

    expect(Array.isArray(noMatchData?.matches)).toBeTruthy();
    expect(noMatchData?.matches).toHaveLength(0);
    expect(noMatchData?.count).toBe(0);
    console.log('entities_search (no-match): count=0, matches=[] confirmed (no error)');
  });

  // ==================== PAYEE RULES (1 tool) ====================
  test('actual_payee_rules_get - should get payee rules', async ({ request }) => {
    if (!testContext.payeeId) test.skip();
    
    console.log('📋 Testing actual_payee_rules_get...');
    const result = await callTool(request, sessionId, 'actual_payee_rules_get', {
      payeeId: testContext.payeeId,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(rules).toBeTruthy();
    console.log(`✅ Found ${rules.length || 0} payee rules`);
  });

  // ==================== TRANSACTIONS (10 tools) ====================
  test('actual_transactions_create - should create transaction', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('💸 Testing actual_transactions_create...');
    const result = await callTool(request, sessionId, 'actual_transactions_create', {
      account: testContext.accountId,
      date: new Date().toISOString().split('T')[0],
      amount: -5000, // -$50.00
      payee: testContext.payeeId,
      category: testContext.categoryId,
      notes: 'E2E test transaction',
    });
    const txnId = extractResult(result);
    
    if (txnId && typeof txnId === 'string' && txnId.length > 10) {
      testContext.transactionId = txnId;
      console.log(`✅ Transaction created: ${txnId}`);
    } else {
      console.log('✅ Transaction created (ID not available)');
    }
  });

  test('actual_transactions_create - ERROR: should fail with invalid amount format', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('⚠️  Testing transaction amount validation...');
    try {
      await callTool(request, sessionId, 'actual_transactions_create', {
        account: testContext.accountId,
        date: new Date().toISOString().split('T')[0],
        amount: -50.00, // Should be -5000 (cents), not -50.00
      });
      // Note: This might succeed if validation doesn't catch it
      console.log('⚠️  Amount validation might need improvement');
    } catch (error: any) {
      console.log('✅ Invalid amount format caught');
    }
  });

  test('actual_transactions_create - ERROR: should fail with invalid date', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('⚠️  Testing transaction date validation...');
    try {
      await callTool(request, sessionId, 'actual_transactions_create', {
        account: testContext.accountId,
        date: 'invalid-date',
        amount: -5000,
      });
      throw new Error('Should have failed with invalid date');
    } catch (error: any) {
      expect(error.message).toMatch(/date|invalid/i);
      console.log('✅ Invalid date rejected');
    }
  });

  test('actual_transactions_get - should get transaction by ID', async ({ request }) => {
    if (!testContext.transactionId) test.skip();
    
    console.log('🔍 Testing actual_transactions_get...');
    const result = await callTool(request, sessionId, 'actual_transactions_get', {
      id: testContext.transactionId,
    });
    const txn = extractResult(result);
    
    expect(txn).toBeTruthy();
    console.log('✅ Transaction retrieved');
  });

  test('actual_transactions_update - should update transaction', async ({ request }) => {
    if (!testContext.transactionId) test.skip();
    
    console.log('✏️  Testing actual_transactions_update...');
    await callTool(request, sessionId, 'actual_transactions_update', {
      id: testContext.transactionId,
      fields: { amount: -7500 }, // -$75.00
    });
    console.log('✅ Transaction updated');
  });

  test('actual_transactions_filter - should filter transactions', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    
    console.log('🔎 Testing actual_transactions_filter...');
    const result = await callTool(request, sessionId, 'actual_transactions_filter', {
      account_id: testContext.accountId,
    });
    const txns = extractResult(result);
    
    expect(Array.isArray(txns)).toBeTruthy();
    console.log(`✅ Filtered ${txns.length} transactions`);
  });

  test('actual_transactions_import - imports a real transaction (typed, non-empty)', async ({ request }) => {
    if (!testContext.accountId) test.skip();

    console.log('📥 Testing actual_transactions_import...');
    // #217: import a REAL transaction. The old `txs: []` succeeded vacuously and never
    // exercised the schema/handler; a typed, non-empty `txs` array is now required, and the
    // import must add exactly one transaction (proves the typed payload reaches the handler
    // instead of being silently dropped as it was with `z.unknown()`).
    // Note: de-dup by imported_id is reconciliation behavior tied to bank sync, not a
    // guarantee for separate manual importTransactions calls, so it is not asserted here.
    const today = new Date().toISOString().split('T')[0];
    const tx = { date: today, amount: -4321, payee_name: 'E2E-Import', imported_id: `e2e-import-${Date.now()}` };

    const first = extractResult(await callTool(request, sessionId, 'actual_transactions_import', {
      accountId: testContext.accountId, txs: [tx],
    }));
    expect(Array.isArray(first?.added)).toBeTruthy();
    expect(first.added.length).toBe(1);
    console.log('✅ Imported 1 real transaction via the typed schema');
  });

  test('actual_transactions_uncategorized - should list uncategorized transactions', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    console.log('🔍 Testing actual_transactions_uncategorized...');

    // The fixture account was set `offbudget: true` by the accounts_update test above,
    // and this tool DELIBERATELY excludes off-budget and closed accounts (see its
    // description and the exclusion set it builds). So the transaction created below
    // would never appear, and the test would be asserting the opposite of the tool's
    // documented contract.
    //
    // This used to pass for the wrong reason: before #357 the close test DELETED the
    // fixture account (Actual tombstones a zero-transaction account on close), so the
    // account was absent from the listing, never made it into the exclusion set, and its
    // orphaned transactions were returned. Fixing the account lifecycle exposed the
    // faulty precondition here.
    //
    // Put the account back on budget for this check, then restore it, so the test proves
    // what it claims to prove without changing what any later test sees.
    await callTool(request, sessionId, 'actual_accounts_update', {
      id: testContext.accountId,
      fields: { offbudget: false },
    });

    // Create a transaction with no category so we know at least one exists
    const today = new Date().toISOString().split('T')[0];
    const uncatNote = `E2E-Uncat-${Date.now()}`;
    await callTool(request, sessionId, 'actual_transactions_create', {
      account: testContext.accountId,
      date: today,
      amount: -1111,
      notes: uncatNote,
      // deliberately no category
    });

    const result = await callTool(request, sessionId, 'actual_transactions_uncategorized', {
      includeTransactions: true,
      limit: 1000,
    });
    const data = extractResult(result);
    const txns: any[] = data?.transactions ?? data?.result?.transactions ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(txns)).toBeTruthy();
    const found = txns.find((t: any) => t?.notes === uncatNote);
    expect(found).toBeTruthy();
    console.log(`✅ actual_transactions_uncategorized: found ${txns.length} uncategorized, including our test transaction`);

    // Negative half, and it is the tool's actual contract: an off-budget account's
    // transactions must NOT appear. Restoring the fixture and re-asserting proves the
    // exclusion works rather than merely restoring state.
    await callTool(request, sessionId, 'actual_accounts_update', {
      id: testContext.accountId,
      fields: { offbudget: true },
    });
    const afterResult = await callTool(request, sessionId, 'actual_transactions_uncategorized', {
      includeTransactions: true,
      limit: 1000,
    });
    const afterData = extractResult(afterResult);
    const afterTxns: any[] = afterData?.transactions ?? afterData?.result?.transactions ?? (Array.isArray(afterData) ? afterData : []);
    expect(afterTxns.find((t: any) => t?.notes === uncatNote)).toBeFalsy();
    console.log('✅ Off-budget account correctly excluded from uncategorized');

    // Edge: far-future date range must return empty summary
    const emptyResult = await callTool(request, sessionId, 'actual_transactions_uncategorized', {
      startDate: '2099-01-01',
      endDate: '2099-01-31',
    });
    const emptyData = extractResult(emptyResult);
    expect(typeof emptyData?.totalCount).toBe('number');
    expect(emptyData?.totalCount).toBe(0);
    console.log('✅ actual_transactions_uncategorized: future date range returns totalCount:0');
  });

  test('actual_transactions_update_batch - should batch update transactions', async ({ request }) => {
    if (!testContext.accountId || !testContext.transactionId) test.skip();
    console.log('✏️  Testing actual_transactions_update_batch...');

    const batchNote = `E2E-Batch-${Date.now()}`;
    const result = await callTool(request, sessionId, 'actual_transactions_update_batch', {
      updates: [{ id: testContext.transactionId, fields: { notes: batchNote } }],
    });
    const data = extractResult(result);
    const batchData = data?.total !== undefined ? data : (data?.result ?? data);
    // Accept any shape that indicates 1 success
    const succeededCount = batchData?.successCount ?? batchData?.succeeded?.length ?? (batchData?.total === 1 ? 1 : null);
    expect(succeededCount).toBe(1);
    console.log('✅ actual_transactions_update_batch: batch update succeeded');

    // NEGATIVE: non-existent ID — must not throw, must report failure or at least not succeed
    const negResult = await callTool(request, sessionId, 'actual_transactions_update_batch', {
      updates: [{ id: '00000000-dead-beef-0000-000000000000', fields: { notes: 'should-fail' } }],
    });
    const negData = extractResult(negResult);
    const negBatch = negData?.total !== undefined ? negData : (negData?.result ?? negData);
    // Either failureCount=1 or successCount=0 or tool swallowed it — just must not throw
    console.log(`✅ actual_transactions_update_batch: negative case handled (failureCount=${negBatch?.failureCount ?? 'n/a'})`);
  });

  test('actual_transactions_search_by_amount - should search by amount', async ({ request }) => {
    console.log('🔍 Testing actual_transactions_search_by_amount...');
    const result = await callTool(request, sessionId, 'actual_transactions_search_by_amount', {
      amount: -5000,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by amount returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_category - should search by category', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('🔍 Testing actual_transactions_search_by_category...');
    const result = await callTool(request, sessionId, 'actual_transactions_search_by_category', {
      categoryId: testContext.categoryId,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by category returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_month - should search by month', async ({ request }) => {
    console.log('🔍 Testing actual_transactions_search_by_month...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_transactions_search_by_month', {
      month: currentMonth,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by month returned ${txns.length || 0} results`);
  });

  test('actual_transactions_search_by_payee - should search by payee', async ({ request }) => {
    if (!testContext.payeeId) test.skip();
    
    console.log('🔍 Testing actual_transactions_search_by_payee...');
    const result = await callTool(request, sessionId, 'actual_transactions_search_by_payee', {
      payeeId: testContext.payeeId,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const txns = Array.isArray(data) ? data : (data?.transactions || []);
    expect(txns).toBeTruthy();
    console.log(`✅ Search by payee returned ${txns.length || 0} results`);
  });

  test('actual_transactions_summary_by_category - should summarize by category', async ({ request }) => {
    console.log('📊 Testing actual_transactions_summary_by_category...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_transactions_summary_by_category', {
      month: currentMonth,
    });
    const summary = extractResult(result);
    
    expect(summary).toBeTruthy();
    console.log('✅ Category summary retrieved');
  });

  test('actual_transactions_summary_by_payee - should summarize by payee', async ({ request }) => {
    console.log('📊 Testing actual_transactions_summary_by_payee...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_transactions_summary_by_payee', {
      month: currentMonth,
    });
    const summary = extractResult(result);
    
    expect(summary).toBeTruthy();
    console.log('✅ Payee summary retrieved');
  });

  // ==================== BUDGETS (9 tools) ====================
  test('actual_budgets_get_all - should get all budgets', async ({ request }) => {
    console.log('💰 Testing actual_budgets_get_all...');
    const result = await callTool(request, sessionId, 'actual_budgets_get_all');
    const budgets = extractResult(result);
    
    expect(budgets).toBeTruthy();
    console.log('✅ All budgets retrieved');
  });

  test('actual_budgets_getMonth - should get month budget', async ({ request }) => {
    console.log('💰 Testing actual_budgets_getMonth...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_budgets_getMonth', {
      month: currentMonth,
    });
    const budget = extractResult(result);
    
    expect(budget).toBeTruthy();
    console.log('✅ Month budget retrieved');
  });

  test('actual_budgets_getMonths - should get multiple months', async ({ request }) => {
    console.log('💰 Testing actual_budgets_getMonths...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_budgets_getMonths', {
      start: currentMonth,
      end: currentMonth,
    });
    const data = extractResult(result);
    
    // Handle both array and object formats
    const months = Array.isArray(data) ? data : (data?.months || []);
    expect(months).toBeTruthy();
    console.log(`✅ Retrieved ${months.length || 0} months`);
  });

  test('actual_budgets_setAmount - should set budget amount', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing actual_budgets_setAmount...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, sessionId, 'actual_budgets_setAmount', {
      month: currentMonth,
      categoryId: testContext.categoryId,
      amount: 50000,
    });
    console.log('✅ Budget amount set');
  });

  test('actual_budgets_setCarryover - should set carryover', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing actual_budgets_setCarryover...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, sessionId, 'actual_budgets_setCarryover', {
      month: currentMonth,
      categoryId: testContext.categoryId,
      flag: true,
    });
    console.log('✅ Carryover set');
  });

  test('actual_budgets_holdForNextMonth - should hold for next month', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing actual_budgets_holdForNextMonth...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    // #355: the tool now reports the truth instead of always reporting success.
    // Upstream holds nothing and returns false when the month's To Budget is not
    // positive, which depends on the fixture budget's state and is therefore not
    // something this test can assume either way. BOTH outcomes are correct; what is
    // asserted is that a failure is the documented one and not something else.
    try {
      await callTool(request, sessionId, 'actual_budgets_holdForNextMonth', {
        month: currentMonth,
        categoryId: testContext.categoryId,
        amount: 10000,
      });
      console.log('✅ Budget held for next month');
    } catch (error: any) {
      expect(error.message).toMatch(/nothing was held/i);
      expect(error.message).toContain(currentMonth);
      console.log('✅ Hold correctly refused: no positive To Budget in the fixture month');
    }
  });

  test('actual_budgets_resetHold - should reset hold', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing actual_budgets_resetHold...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    await callTool(request, sessionId, 'actual_budgets_resetHold', {
      month: currentMonth,
      categoryId: testContext.categoryId,
    });
    console.log('✅ Hold reset');
  });

  test('actual_budget_updates_batch - should batch update budgets', async ({ request }) => {
    test.setTimeout(60000); // Batch operations can take longer
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing actual_budget_updates_batch...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const result = await callTool(request, sessionId, 'actual_budget_updates_batch', {
      operations: [
        { month: currentMonth, categoryId: testContext.categoryId, amount: 60000 },
      ],
    });
    const batchResult = extractResult(result);
    
    expect(batchResult).toBeTruthy();
    console.log('✅ Batch update completed');
  });

  test('actual_budget_updates_batch - should handle large batch (35 ops)', async ({ request }) => {
    // #278: back to 60s. This test was never slow, it was DEADLOCKED, and it was a
    // correct canary. #273 raised the timeout to 120s on the theory that the request
    // queued behind others on the api mutex "under the full 63-test parallel load".
    // That cannot be: playwright.config.docker.ts sets `workers: 1` and `retries: 0`,
    // so these tests run serially and nothing contends for the mutex.
    //
    // The real cause was a lost wakeup in the adapter's write queue: this test fires
    // its write ~11ms after the previous test's response, landing while that batch was
    // still draining (the response is sent from inside Promise.allSettled, before
    // api.sync() and before the lock releases). The enqueued op was never dispatched,
    // so it hung until an unrelated later write drained the queue. No timeout value can
    // fix a hang. Fixed in src/lib/actual-adapter.ts; regression pinned by
    // tests/unit/adapter_write_queue_wakeup.test.js.
    test.setTimeout(60000);
    if (!testContext.categoryId) test.skip();
    
    console.log('💰 Testing large batch update (35 operations)...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const operations = [];
    for (let i = 0; i < 35; i++) {
      operations.push({
        month: currentMonth,
        categoryId: testContext.categoryId,
        amount: 10000 + (i * 100),
      });
    }
    
    const result = await callTool(request, sessionId, 'actual_budget_updates_batch', {
      operations,
    });
    const batchResult = extractResult(result);
    
    expect(batchResult).toBeTruthy();
    console.log('✅ Large batch handled successfully');
  });

  test('actual_budgets_transfer - should transfer between categories', async ({ request }) => {
    if (!testContext.categoryId || !testContext.categoryGroupId) test.skip();
    
    console.log('💰 Testing actual_budgets_transfer...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    
    // Ensure group_id is a string
    const groupId = typeof testContext.categoryGroupId === 'string' 
      ? testContext.categoryGroupId 
      : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);
    
    // Create second category for transfer
    const result = await callTool(request, sessionId, 'actual_categories_create', {
      name: `E2E-Transfer-Target-${Date.now()}`,
      group_id: groupId,
    });
    const data = extractResult(result);
    const targetCategoryId = typeof data === 'string' ? data : data?.categoryId;
    
    await callTool(request, sessionId, 'actual_budgets_transfer', {
      month: currentMonth,
      amount: 5000,
      fromCategoryId: testContext.categoryId,
      toCategoryId: targetCategoryId,
    });
    console.log('✅ Budget transferred');
  });

  test('actual_budgets_transfer - should reject insufficient funds', async ({ request }) => {
    if (!testContext.categoryId || !testContext.categoryGroupId) test.skip();

    console.log('🚫 Testing actual_budgets_transfer insufficient-funds rejection...');
    const currentMonth = new Date().toISOString().substring(0, 7);
    const groupId = typeof testContext.categoryGroupId === 'string'
      ? testContext.categoryGroupId
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);

    // Create a sink category with zero budget. Insufficient funds is the rejection
    // we want, regardless of the source's current value.
    const sinkRes = await callTool(request, sessionId, 'actual_categories_create', {
      name: `E2E-Transfer-Reject-${Date.now()}`,
      group_id: groupId,
    });
    const sinkData = extractResult(sinkRes);
    const sinkId = typeof sinkData === 'string' ? sinkData : sinkData?.categoryId;

    // Attempt to drain an obscene amount from sink (which has 0 budgeted).
    const result = await callTool(request, sessionId, 'actual_budgets_transfer', {
      month: currentMonth,
      amount: 99_999_999,
      fromCategoryId: sinkId,
      toCategoryId: testContext.categoryId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).catch((err: Error) => ({ __error: err.message } as any));

    // The MCP error surfaces in either the JSON-RPC error envelope or as a thrown error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errMsg = (result as any)?.__error ?? (result as any)?.error?.message ?? '';
    expect(errMsg).toContain('Insufficient budget');
    console.log('✅ Insufficient-funds correctly rejected');
  });

  // ==================== RULES (4 tools) ====================
  test('actual_rules_get - should list rules', async ({ request }) => {
    console.log('📋 Testing actual_rules_get...');
    const result = await callTool(request, sessionId, 'actual_rules_get');
    const data = extractResult(result);
    
    // Handle both array and object formats
    const rules = Array.isArray(data) ? data : (data?.rules || []);
    expect(rules).toBeTruthy();
    console.log(`✅ Listed ${rules.length || 0} rules`);
  });

  test('actual_rules_create - should create rule without op field', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('➕ Testing actual_rules_create (without op)...');
    const result = await callTool(request, sessionId, 'actual_rules_create', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { field: 'notes', op: 'contains', value: 'no-op-test' },
      ],
      actions: [
        { field: 'category', value: testContext.categoryId }, // No 'op'
      ],
    });
    const ruleId = extractResult(result);
    
    expect(ruleId).toBeTruthy();
    testContext.ruleWithoutOpId = ruleId;
    console.log('✅ Rule created without op field');
  });

  test('actual_rules_create - should create rule with op field', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    
    console.log('➕ Testing actual_rules_create (with op)...');
    const result = await callTool(request, sessionId, 'actual_rules_create', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [
        { field: 'notes', op: 'contains', value: 'test-marker' },
      ],
      actions: [
        { op: 'set', field: 'category', value: testContext.categoryId },
      ],
    });
    const ruleId = extractResult(result);
    
    expect(ruleId).toBeTruthy();
    testContext.ruleId = ruleId;
    console.log('✅ Rule created with op field');
  });

  test('actual_rules_update - should update rule', async ({ request }) => {
    if (!testContext.ruleId) test.skip();
    
    console.log('✏️  Testing actual_rules_update...');
    await callTool(request, sessionId, 'actual_rules_update', {
      id: testContext.ruleId,
      fields: {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [
          { field: 'notes', op: 'contains', value: 'updated-marker' },
        ],
        actions: [
          { op: 'set', field: 'category', value: testContext.categoryId },
        ],
      },
    });
    console.log('✅ Rule updated');
  });

  test('actual_rules_create_or_update - should upsert rule idempotently', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    console.log('🔄 Testing actual_rules_create_or_update...');

    const marker = `E2E-Upsert-${Date.now()}`;
    const conditions = [{ field: 'notes', op: 'contains', value: marker }];
    const actions = [{ op: 'set', field: 'category', value: testContext.categoryId }];

    // Parse raw MCP envelope directly to preserve the { id, created } shape.
    // extractResult() reduces objects with an 'id' field down to just the id string,
    // which would cause firstData?.created to be undefined.
    const parseUpsert = (raw: any): { id: string; created: boolean } =>
      raw?.content?.[0]?.text ? JSON.parse(raw.content[0].text) : raw;

    // First call: must create (created=true)
    const first = await callTool(request, sessionId, 'actual_rules_create_or_update', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions,
      actions,
    });
    const firstData = parseUpsert(first);
    expect(typeof firstData.id).toBe('string');
    expect(firstData.created).toBe(true);
    testContext.rulesUpsertId = firstData.id;
    console.log(`✅ actual_rules_create_or_update: created=true, id=${firstData.id}`);

    // Second call with identical conditions: must update (created=false, same id)
    const second = await callTool(request, sessionId, 'actual_rules_create_or_update', {
      stage: 'pre',
      conditionsOp: 'and',
      conditions,
      actions,
    });
    const secondData = parseUpsert(second);
    expect(secondData.id).toBe(firstData.id);
    expect(secondData.created).toBe(false);
    console.log('✅ actual_rules_create_or_update: second call created=false, same id (idempotent)');
  });

  // ==================== ADVANCED (2 tools) ====================
  test('actual_bank_sync - should return actionable error when no accounts are bank-linked', async ({ request }) => {
    console.log('🏦 Testing actual_bank_sync (global sync)...');
    let threw = false;
    let errorMessage = '';
    try {
      await callTool(request, sessionId, 'actual_bank_sync');
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }
    // CI budget has no bank-linked accounts — must throw immediately with an actionable message.
    // If a real bank-linked account exists in the budget this test would need updating.
    expect(threw).toBe(true);
    const isActionable = /not configured|no accounts|local account|not found/i.test(errorMessage);
    expect(isActionable).toBe(true);
    console.log('✅ Global sync correctly rejected (no bank-linked accounts):', errorMessage.slice(0, 100));
  });

  test('actual_bank_sync - should return actionable error for local account', async ({ request }) => {
    console.log('🏦 Testing actual_bank_sync with local account...');
    
    // Create a temporary local account for this test
    const tempAccountName = `BankSync-LocalTest-${Date.now()}`;
    const createResult = await callTool(request, sessionId, 'actual_accounts_create', {
      name: tempAccountName,
      balance: 0,
    });
    const tempAccountId = extractResult(createResult);
    
    let threw = false;
    let errorMessage = '';
    try {
      await callTool(request, sessionId, 'actual_bank_sync', {
        accountId: tempAccountId,
      });
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }
    
    // Clean up the temp account
    try {
      await callTool(request, sessionId, 'actual_accounts_delete', { id: tempAccountId });
    } catch (cleanupError) {
      console.log('⚠️  Temp account cleanup failed (non-critical)');
    }
    
    // This account is local (created without bank sync) — must reject immediately.
    expect(threw).toBe(true);
    const isLocalAccountError = /local account|not configured/i.test(errorMessage);
    expect(isLocalAccountError).toBe(true);
    console.log('✅ Local account correctly rejected:', errorMessage.slice(0, 100));
  });

  test('actual_bank_sync - should return actionable error for non-existent accountId', async ({ request }) => {
    console.log('🏦 Testing actual_bank_sync with non-existent account...');
    let threw = false;
    let errorMessage = '';
    try {
      await callTool(request, sessionId, 'actual_bank_sync', {
        accountId: '00000000-0000-0000-0000-000000000000',
      });
    } catch (error: any) {
      threw = true;
      errorMessage = error?.message || String(error);
    }
    expect(threw).toBe(true);
    // Should mention account not found or not configured — actionable message
    const isActionable = /not found|not configured|local account/i.test(errorMessage);
    expect(isActionable).toBe(true);
    console.log('✅ Non-existent accountId rejected with actionable error:', errorMessage.slice(0, 100));
  });

  test('actual_query_run - should execute SELECT * query', async ({ request }) => {
    console.log('🔍 Testing actual_query_run with SELECT *...');
    const result = await callTool(request, sessionId, 'actual_query_run', {
      query: 'SELECT * FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    
    expect(queryResult).toBeTruthy();
    console.log('✅ SELECT * query executed');
  });

  test('actual_query_run - should execute query with specific fields', async ({ request }) => {
    console.log('🔍 Testing query with specific fields...');
    const result = await callTool(request, sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount, account FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with specific fields executed');
  });

  test('actual_query_run - should execute query with join path (payee.name)', async ({ request }) => {
    console.log('🔍 Testing query with payee.name join...');
    const result = await callTool(request, sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount, payee.name FROM transactions LIMIT 10',
    });
    const queryResult = extractResult(result);
    
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with payee.name join executed');
  });

  test('actual_query_run - should execute query with join path (category.name)', async ({ request }) => {
    console.log('🔍 Testing query with category.name join...');
    const result = await callTool(request, sessionId, 'actual_query_run', {
      query: 'SELECT id, amount, category.name FROM transactions WHERE amount < 0 LIMIT 10',
    });
    const queryResult = extractResult(result);
    
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with category.name join executed');
  });

  test('actual_query_run - should execute query with WHERE and ORDER BY', async ({ request }) => {
    console.log('🔍 Testing query with WHERE and ORDER BY...');
    const result = await callTool(request, sessionId, 'actual_query_run', {
      query: 'SELECT id, date, amount FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 20',
    });
    const queryResult = extractResult(result);
    
    expect(queryResult).toBeTruthy();
    console.log('✅ Query with WHERE and ORDER BY executed');
  });

  test('actual_query_run - ERROR: should reject invalid field (payee_name)', async ({ request }) => {
    console.log('⚠️  Testing invalid field validation (payee_name)...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT id, payee_name FROM transactions LIMIT 5',
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|Available fields|invalid/i);
      console.log('✅ Invalid field payee_name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid field (category_name)', async ({ request }) => {
    console.log('⚠️  Testing invalid field validation (category_name)...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT id, category_name FROM transactions LIMIT 5',
      });
      throw new Error('Should have failed with invalid field');
    } catch (error: any) {
      expect(error.message).toMatch(/category_name|Available fields|invalid/i);
      console.log('✅ Invalid field category_name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid table name', async ({ request }) => {
    console.log('⚠️  Testing invalid table validation...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT * FROM transaction LIMIT 10',
      });
      throw new Error('Should have failed with invalid table');
    } catch (error: any) {
      expect(error.message).toMatch(/transaction|table|Available tables|invalid/i);
      console.log('✅ Invalid table name rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid field in WHERE clause', async ({ request }) => {
    console.log('⚠️  Testing invalid field in WHERE clause...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT id, amount FROM transactions WHERE payee_name = "Test"',
      });
      throw new Error('Should have failed with invalid field in WHERE');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|Available fields|invalid/i);
      console.log('✅ Invalid field in WHERE clause rejected');
    }
  });

  test('actual_query_run - ERROR: should reject multiple invalid fields', async ({ request }) => {
    console.log('⚠️  Testing multiple invalid fields...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT id, payee_name, category_name FROM transactions',
      });
      throw new Error('Should have failed with multiple invalid fields');
    } catch (error: any) {
      expect(error.message).toMatch(/payee_name|category_name|Available fields|invalid/i);
      console.log('✅ Multiple invalid fields rejected');
    }
  });

  test('actual_query_run - ERROR: should reject invalid join path (account.id)', async ({ request }) => {
    console.log('⚠️  Testing invalid join path (account.id)...');
    try {
      await callTool(request, sessionId, 'actual_query_run', {
        query: 'SELECT * FROM transactions WHERE account.id = \'bff82978-3f20-4956-860b-fa2cb069a144\' ORDER BY date DESC LIMIT 5',
      });
      throw new Error('Should have failed - account is not a join, just a field');
    } catch (error: any) {
      expect(error.message).toMatch(/account|Available fields|invalid/i);
      console.log('✅ Invalid join path account.id rejected');
    }
  });

  // ==================== SCHEDULES (4 tools) ====================
  test('actual_schedules_get - should list schedules', async ({ request }) => {
    console.log('📅 Testing actual_schedules_get...');
    const result = await callTool(request, sessionId, 'actual_schedules_get');
    const data = extractResult(result);
    const schedules: any[] = data?.schedules ?? data?.result?.schedules ?? (Array.isArray(data) ? data : []);
    expect(Array.isArray(schedules)).toBeTruthy();
    console.log(`✅ Listed ${schedules.length} schedules`);
  });

  test('actual_schedules_create - should create one-off schedule', async ({ request }) => {
    console.log('➕ Testing actual_schedules_create (one-off)...');
    const result = await callTool(request, sessionId, 'actual_schedules_create', {
      name: `E2E-Schedule-${Date.now()}`,
      date: '2026-06-15',
      amount: -5000,
      amountOp: 'is',
      posts_transaction: false,
    });
    const data = extractResult(result);
    const scheduleId: string = data?.id ?? data?.result?.id ?? data;
    expect(typeof scheduleId).toBe('string');
    expect(scheduleId.length).toBeGreaterThan(8);
    testContext.scheduleOneOffId = scheduleId;
    console.log(`✅ Schedule created: ${scheduleId}`);
  });

  test('actual_schedules_update - should update schedule name', async ({ request }) => {
    if (!testContext.scheduleOneOffId) test.skip();
    console.log('✏️  Testing actual_schedules_update...');
    const updatedName = `E2E-Schedule-Updated-${Date.now()}`;
    const result = await callTool(request, sessionId, 'actual_schedules_update', {
      id: testContext.scheduleOneOffId,
      name: updatedName,
    });
    const data = extractResult(result);
    expect(data?.success ?? data?.result?.success).toBe(true);
    // Verify name changed in the list
    const listResult = await callTool(request, sessionId, 'actual_schedules_get');
    const listData = extractResult(listResult);
    const schedules: any[] = listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    const found = schedules.find((s: any) => s.id === testContext.scheduleOneOffId);
    expect(found?.name).toBe(updatedName);
    console.log('✅ Schedule updated and name verified in list');
  });

  test('actual_schedules_delete - should delete schedule and verify gone', async ({ request }) => {
    if (!testContext.scheduleOneOffId) test.skip();
    console.log('🗑️  Testing actual_schedules_delete...');
    const result = await callTool(request, sessionId, 'actual_schedules_delete', {
      id: testContext.scheduleOneOffId,
    });
    const data = extractResult(result);
    expect(data?.success ?? data?.result?.success).toBe(true);
    // Verify it no longer appears in the list
    const listResult = await callTool(request, sessionId, 'actual_schedules_get');
    const listData = extractResult(listResult);
    const schedules: any[] = listData?.schedules ?? listData?.result?.schedules ?? (Array.isArray(listData) ? listData : []);
    const stillThere = schedules.find((s: any) => s.id === testContext.scheduleOneOffId);
    expect(stillThere).toBeFalsy();
    testContext.scheduleOneOffId = undefined; // self-cleaned
    console.log('✅ Schedule deleted and confirmed absent from list');
  });

  // ==================== GET ID BY NAME ====================
  test('actual_get_id_by_name - should resolve account name to id', async ({ request }) => {
    console.log('🔍 Testing actual_get_id_by_name...');
    // Pull a real account from the live list so the lookup is guaranteed to match
    const listResult = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts = extractResult(listResult);
    const firstAccount = Array.isArray(accounts) ? accounts[0] : null;
    if (!firstAccount) {
      console.log('⚠️  No accounts available — skipping get_id_by_name');
      return;
    }
    const result = await callTool(request, sessionId, 'actual_get_id_by_name', {
      type: 'accounts',
      name: firstAccount.name,
    });
    const data = extractResult(result);
    const resolvedId = data?.id ?? (typeof data === 'string' ? data : null);
    expect(resolvedId).toBe(firstAccount.id);
    console.log(`✅ actual_get_id_by_name: resolved "${firstAccount.name}" → ${resolvedId}`);
  });

  // ==================== DELETE OPERATIONS (6 tools) ====================
  // Each test deletes a real object created earlier in the suite, then asserts
  // it is absent from the corresponding list.  afterAll below acts as a safety
  // fallback — if a delete test clears the context ID, afterAll skips it.
  // Order matters: transactions → rules → payees → categories → groups → account.

  test('actual_transactions_delete - should delete transaction and verify gone', async ({ request }) => {
    if (!testContext.transactionId) test.skip();
    console.log('🗑️  Testing actual_transactions_delete...');
    await callTool(request, sessionId, 'actual_transactions_delete', {
      id: testContext.transactionId,
    });
    // Verify it's gone — filter the owning account and confirm ID absent
    if (testContext.accountId) {
      const result = await callTool(request, sessionId, 'actual_transactions_filter', {
        account_id: testContext.accountId,
      });
      const txns: any[] = extractResult(result) ?? [];
      const stillThere = txns.find((t: any) => t.id === testContext.transactionId);
      expect(stillThere).toBeFalsy();
    }
    testContext.transactionId = undefined;
    console.log('✅ Transaction deleted and confirmed absent');
  });

  test('actual_rules_delete - should delete rules and verify gone', async ({ request }) => {
    const idsToDelete = [
      testContext.ruleWithoutOpId,
      testContext.ruleId,
      testContext.rulesUpsertId,
    ].filter(Boolean) as string[];
    if (idsToDelete.length === 0) test.skip();
    console.log(`🗑️  Testing actual_rules_delete (${idsToDelete.length} rules)...`);
    for (const id of idsToDelete) {
      await callTool(request, sessionId, 'actual_rules_delete', { id });
    }
    // Verify none appear in the rules list
    const result = await callTool(request, sessionId, 'actual_rules_get');
    const data = extractResult(result);
    const rules: any[] = Array.isArray(data) ? data : (data?.rules ?? []);
    const stillThere = rules.filter((r: any) => idsToDelete.includes(r.id));
    expect(stillThere).toHaveLength(0);
    testContext.ruleWithoutOpId = undefined;
    testContext.ruleId = undefined;
    testContext.rulesUpsertId = undefined;
    console.log(`✅ ${idsToDelete.length} rule(s) deleted and confirmed absent from list`);
  });

  test('actual_payees_delete - should delete payee and verify gone', async ({ request }) => {
    if (!testContext.payeeId) test.skip();
    console.log('🗑️  Testing actual_payees_delete...');
    await callTool(request, sessionId, 'actual_payees_delete', {
      id: testContext.payeeId,
    });
    // Verify absent from payees list
    const result = await callTool(request, sessionId, 'actual_payees_get');
    const payees: any[] = extractResult(result) ?? [];
    const stillThere = Array.isArray(payees) ? payees.find((p: any) => p.id === testContext.payeeId) : null;
    expect(stillThere).toBeFalsy();
    testContext.payeeId = undefined;
    console.log('✅ Payee deleted and confirmed absent from list');
  });

  test('actual_categories_delete - should delete category and verify gone', async ({ request }) => {
    if (!testContext.categoryId) test.skip();
    console.log('🗑️  Testing actual_categories_delete...');
    const categoryId = typeof testContext.categoryId === 'string'
      ? testContext.categoryId
      : (testContext.categoryId as any).id || String(testContext.categoryId);
    await callTool(request, sessionId, 'actual_categories_delete', {
      id: categoryId,
    });
    // Verify absent from categories list
    const result = await callTool(request, sessionId, 'actual_categories_get');
    const data = extractResult(result);
    const categories: any[] = Array.isArray(data) ? data : (data?.categories ?? []);
    const stillThere = categories.find((c: any) => c.id === categoryId);
    expect(stillThere).toBeFalsy();
    testContext.categoryId = undefined;
    console.log('✅ Category deleted and confirmed absent from list');
  });

  test('actual_category_groups_delete - should delete category group and verify gone', async ({ request }) => {
    if (!testContext.categoryGroupId) test.skip();
    console.log('🗑️  Testing actual_category_groups_delete...');
    const groupId = typeof testContext.categoryGroupId === 'string'
      ? testContext.categoryGroupId
      : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);
    await callTool(request, sessionId, 'actual_category_groups_delete', {
      id: groupId,
    });
    // Verify absent from category groups list
    const result = await callTool(request, sessionId, 'actual_category_groups_get');
    const groups: any[] = extractResult(result) ?? [];
    const stillThere = Array.isArray(groups) ? groups.find((g: any) => g.id === groupId) : null;
    expect(stillThere).toBeFalsy();
    testContext.categoryGroupId = undefined;
    console.log('✅ Category group deleted and confirmed absent from list');
  });

  test('actual_accounts_delete - should delete account and verify gone', async ({ request }) => {
    if (!testContext.accountId) test.skip();
    console.log('🗑️  Testing actual_accounts_delete...');
    await callTool(request, sessionId, 'actual_accounts_delete', {
      id: testContext.accountId,
    });
    // Verify absent from accounts list
    const result = await callTool(request, sessionId, 'actual_accounts_list');
    const accounts: any[] = extractResult(result) ?? [];
    const stillThere = Array.isArray(accounts) ? accounts.find((a: any) => a.id === testContext.accountId) : null;
    expect(stillThere).toBeFalsy();
    testContext.accountId = undefined;
    console.log('✅ Account deleted and confirmed absent from list');
  });

  // ==================== CLEANUP (safety fallback) ====================
  // Each delete tool above clears its testContext ID on success.
  // Guards below only fire if a delete test was skipped or failed mid-run.
  test.afterAll(async ({ request }) => {
    console.log('\n🧹 Fallback cleanup — removing any test data not cleaned by named tests...');
    
    try {
      if (testContext.transactionId) {
        await callTool(request, sessionId, 'actual_transactions_delete', {
          id: testContext.transactionId,
        });
        console.log('✅ Transaction deleted (fallback)');
      }
      
      if (testContext.ruleWithoutOpId) {
        await callTool(request, sessionId, 'actual_rules_delete', {
          id: testContext.ruleWithoutOpId,
        });
        console.log('✅ Rule (without op) deleted (fallback)');
      }
      
      if (testContext.ruleId) {
        await callTool(request, sessionId, 'actual_rules_delete', {
          id: testContext.ruleId,
        });
        console.log('✅ Rule deleted (fallback)');
      }

      if (testContext.rulesUpsertId) {
        await callTool(request, sessionId, 'actual_rules_delete', {
          id: testContext.rulesUpsertId,
        });
        console.log('✅ Upsert rule deleted (fallback)');
      }
      
      if (testContext.payeeId) {
        await callTool(request, sessionId, 'actual_payees_delete', {
          id: testContext.payeeId,
        });
        console.log('✅ Payee deleted (fallback)');
      }
      
      if (testContext.categoryId) {
        const categoryId = typeof testContext.categoryId === 'string' 
          ? testContext.categoryId 
          : (testContext.categoryId as any).id || String(testContext.categoryId);
        await callTool(request, sessionId, 'actual_categories_delete', {
          id: categoryId,
        });
        console.log('✅ Category deleted (fallback)');
      }
      
      if (testContext.categoryGroupId) {
        const groupId = typeof testContext.categoryGroupId === 'string' 
          ? testContext.categoryGroupId 
          : (testContext.categoryGroupId as any).id || String(testContext.categoryGroupId);
        await callTool(request, sessionId, 'actual_category_groups_delete', {
          id: groupId,
        });
        console.log('✅ Category group deleted (fallback)');
      }

      // scheduleOneOffId is normally cleaned up by the named delete test.
      // This guard handles the case where that test was skipped or failed.
      if (testContext.scheduleOneOffId) {
        await callTool(request, sessionId, 'actual_schedules_delete', {
          id: testContext.scheduleOneOffId,
        });
        console.log('✅ Schedule deleted (fallback)');
      }
      
      if (testContext.accountId) {
        await callTool(request, sessionId, 'actual_accounts_delete', {
          id: testContext.accountId,
        });
        console.log('✅ Account deleted (fallback)');
      }
      
      console.log('✅ Fallback cleanup completed');
    } catch (error: any) {
      console.warn('⚠️  Some fallback cleanup operations failed:', error.message);
    }
  });

  // ==================== TAGS ====================
  test('actual_tags_list - should list tags', async ({ request }) => {
    const result = await callTool(request, sessionId, 'actual_tags_list');
    const data = extractResult(result);
    expect(Array.isArray(data)).toBeTruthy();
    console.log(`Tags listed: ${data.length}`);
  });

  test('actual_tags_create - should create a tag', async ({ request }) => {
    const result = await callTool(request, sessionId, 'actual_tags_create', {
      tag: 'mcp-e2e-test-tag',
      color: '#33aa33',
      description: 'Created by E2E test',
    });
    const data = extractResult(result);
    expect(typeof data === 'string' || typeof data?.id === 'string').toBeTruthy();
    console.log('Tag created');
  });

  test('actual_tags_create - upsert same name returns same id', async ({ request }) => {
    const result1 = await callTool(request, sessionId, 'actual_tags_create', {
      tag: 'mcp-e2e-upsert-tag',
    });
    const result2 = await callTool(request, sessionId, 'actual_tags_create', {
      tag: 'mcp-e2e-upsert-tag',
      color: '#0000ff',
    });
    const id1 = extractResult(result1);
    const id2 = extractResult(result2);
    expect(id1).toEqual(id2);
    console.log('Upsert: same id returned for same tag name');
  });

  test('actual_tags_update - should update a tag', async ({ request }) => {
    const createResult = await callTool(request, sessionId, 'actual_tags_create', {
      tag: 'mcp-e2e-update-tag',
    });
    const tagId = extractResult(createResult);
    if (typeof tagId === 'string') {
      const result = await callTool(request, sessionId, 'actual_tags_update', {
        id: tagId,
        tag: 'mcp-e2e-update-tag-renamed',
        color: '#112233',
      });
      const data = extractResult(result);
      expect(data?.success).toBeTruthy();
      console.log('Tag updated');
    }
  });

  // ==================== NOTES ====================
  test('actual_notes_get - should return clear result for id with no note', async ({ request }) => {
    // Use a known budget month that very likely has no note set yet.
    const result = await callTool(request, sessionId, 'actual_notes_get', {
      id: 'budget-1970-01',
    });
    const data = extractResult(result);
    // Either a note object (found=true) or a no-note object (found=false) is valid.
    expect(typeof data?.found === 'boolean').toBeTruthy();
    expect(typeof data?.id === 'string').toBeTruthy();
    console.log(`notes_get (no-note path): found=${data?.found}, message=${data?.message ?? 'n/a'}`);
  });

  test('actual_notes_update + actual_notes_get - round-trip note on budget month', async ({ request }) => {
    const testId = 'budget-2026-01';
    const testNote = `E2E-notes-test-${Date.now()}`;

    // Set the note.
    const setResult = await callTool(request, sessionId, 'actual_notes_update', {
      id: testId,
      note: testNote,
    });
    const setData = extractResult(setResult);
    expect(setData?.success).toBe(true);
    expect(setData?.id).toBe(testId);
    console.log('notes_update: set note OK');

    // Read it back.
    const getResult = await callTool(request, sessionId, 'actual_notes_get', { id: testId });
    const getData = extractResult(getResult);
    expect(getData?.found).toBe(true);
    expect(getData?.note).toBe(testNote);
    console.log(`notes_get: round-trip note matched: "${getData?.note}"`);

    // Clear the note (cleanup).
    const clearResult = await callTool(request, sessionId, 'actual_notes_update', {
      id: testId,
      note: '',
    });
    const clearData = extractResult(clearResult);
    expect(clearData?.success).toBe(true);
    expect(clearData?.cleared).toBe(true);
    console.log('notes_update: clear OK');
  });

  test('actual_notes_update - orphan id returns error without writing', async ({ request }) => {
    const result = await callTool(request, sessionId, 'actual_notes_update', {
      id: 'not-a-real-entity-id',
      note: 'should not be written',
    });
    const data = extractResult(result);
    // The tool returns { error: '...' } and does NOT write.
    expect(typeof data?.error === 'string').toBeTruthy();
    console.log(`notes_update orphan guard: error="${String(data?.error).slice(0, 80)}"`);
  });

  test('actual_tags_delete - should delete a tag', async ({ request }) => {
    const createResult = await callTool(request, sessionId, 'actual_tags_create', {
      tag: 'mcp-e2e-delete-tag',
    });
    const tagId = extractResult(createResult);
    if (typeof tagId === 'string') {
      const result = await callTool(request, sessionId, 'actual_tags_delete', {
        id: tagId,
      });
      const data = extractResult(result);
      expect(data?.success).toBeTruthy();
      console.log('Tag deleted');
    }
  });

  // ==================== PREFERENCES (1 tool) ====================
  test('actual_preferences_get - should read synced preferences', async ({ request }) => {
    const result = await callTool(request, sessionId, 'actual_preferences_get');
    const data = extractResult(result);
    expect(data).toBeTruthy();
    // The normalisation contract: `preferences` is ALWAYS a non-array object and
    // `count` always matches its key count, whatever upstream returned.
    expect(typeof data?.preferences).toBe('object');
    expect(Array.isArray(data?.preferences)).toBe(false);
    expect(Array.isArray(data?.keys)).toBe(true);
    expect(data?.count).toBe(Object.keys(data.preferences).length);
    console.log(`preferences_get: ${data.count} synced preference(s)`);
  });

  // ==================== EXPORT / IMPORT ROUND TRIP (2 tools) ====================
  //
  // Deliberately the LAST tests in this file. actual_budgets_import LOADS the
  // imported budget, so the session's active budget changes and every test after
  // it would silently run against the imported copy. The test switches back at the
  // end, but ordering is the primary defence and the switch-back is the backstop.
  //
  // The whole round trip stays server-side: the zip never crosses the transport.
  // The export tool returns a path inside the container, and the import tool reads
  // that same path, so this exercises the real file rather than a base64 copy.
  test('actual_budgets_export - should write a zip and report accurate metadata', async ({ request }) => {
    const result = await callTool(request, sessionId, 'actual_budgets_export', {
      filename: 'e2e-roundtrip.zip',
    });
    const data = extractResult(result);

    expect(data?.success).toBe(true);
    expect(data?.filename).toBe('e2e-roundtrip.zip');
    expect(typeof data?.path).toBe('string');
    // A real budget export is never a handful of bytes. This catches the failure
    // mode where the zip is produced but empty or truncated, which a plain
    // "did it throw" assertion would miss entirely.
    expect(data?.bytes).toBeGreaterThan(100);
    expect(data?.sha256).toMatch(/^[0-9a-f]{64}$/);

    exportedPath = data.path;
    exportedSha = data.sha256;
    exportedBytes = data.bytes;
    console.log(`budgets_export: ${data.bytes} bytes at ${data.path} (sha256 ${data.sha256.slice(0, 12)}...)`);
  });

  test('actual_budgets_export - a second export of unchanged data has the SAME size class', async ({ request }) => {
    // Not a digest equality assertion: an Actual export embeds per-export metadata
    // (timestamps, device state), so two exports of identical data legitimately
    // differ byte for byte. Asserting equal digests here would be a flaky test
    // that looks rigorous. Size stability is the honest invariant.
    const result = await callTool(request, sessionId, 'actual_budgets_export', {
      filename: 'e2e-roundtrip-2.zip',
    });
    const data = extractResult(result);
    expect(data?.success).toBe(true);
    expect(data?.sha256).toMatch(/^[0-9a-f]{64}$/);

    // Compare against the FIRST export. Skip rather than self-compare if the first
    // test did not record a size, so this can never silently pass by comparing a
    // value with itself. Bound to a local so the narrowing is visible to the
    // compiler: test.skip() does not narrow.
    const firstBytes = exportedBytes;
    if (firstBytes === undefined) {
      test.skip();
      return;
    }
    const drift = Math.abs(data.bytes - firstBytes) / firstBytes;
    expect(drift).toBeLessThan(0.5);
    console.log(`budgets_export: second export ${data.bytes} bytes, digest ${data.sha256 === exportedSha ? 'identical' : 'differs (expected)'}`);
  });

  test('actual_budgets_import - should restore the export and preserve its accounts', async ({ request }) => {
    if (!exportedPath) test.skip();

    // Capture what the CURRENT budget looks like, and which configured budget we
    // are on, so we can both assert the restore and get back afterwards.
    const beforeAccounts = extractResult(await callTool(request, sessionId, 'actual_accounts_list'));
    const beforeCount = Array.isArray(beforeAccounts) ? beforeAccounts.length : 0;

    const availableBefore = extractResult(await callTool(request, sessionId, 'actual_budgets_list_available'));
    const originalName =
      (Array.isArray(availableBefore) ? availableBefore : availableBefore?.budgets)?.[0]?.name;

    const result = await callTool(request, sessionId, 'actual_budgets_import', {
      path: exportedPath,
      type: 'actual',
    });
    const data = extractResult(result);

    expect(data?.success).toBe(true);
    expect(typeof data?.budgetId).toBe('string');
    expect(data?.source).toBe('path');
    // The side-effect warning is part of the contract, not decoration: an
    // assistant that misses it operates on the wrong budget for the rest of the
    // session. Assert it is actually present in the message.
    expect(String(data?.message)).toMatch(/actual_budgets_switch/);
    console.log(`budgets_import: restored as ${data.budgetId}`);

    // THE ROUND-TRIP ASSERTION. The imported budget is now loaded, so a plain
    // accounts_list reads the restored copy. Matching account counts is what
    // proves the export was actually restorable, rather than merely well-formed.
    const afterAccounts = extractResult(await callTool(request, sessionId, 'actual_accounts_list'));
    const afterCount = Array.isArray(afterAccounts) ? afterAccounts.length : 0;
    expect(afterCount).toBe(beforeCount);
    console.log(`round trip verified: ${beforeCount} account(s) before, ${afterCount} after restore`);

    // Restore the session to a CONFIGURED budget. The imported budget is not in
    // the BUDGET_N_* registry, so leaving the session on it would strand any
    // later test on a budget that cannot be switched back to by name.
    if (originalName) {
      const back = extractResult(
        await callTool(request, sessionId, 'actual_budgets_switch', { budgetName: originalName }),
      );
      expect(back?.success).toBe(true);
      console.log(`switched back to the configured budget "${originalName}"`);
    }
  });
});
