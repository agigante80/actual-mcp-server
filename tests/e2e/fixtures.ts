/**
 * tests/e2e/fixtures.ts
 *
 * Playwright fixtures that make every E2E test self-provisioning (#375).
 *
 * THE PROBLEM THESE SOLVE. `docker-all-tools.e2e.spec.ts` used to be 100+ ordered
 * tests sharing one mutable `testContext` object: a test created an entity, wrote
 * its id into that object, and later tests read it behind
 * `if (!testContext.accountId) test.skip()`. Correctness depended on file order,
 * running one test alone SKIPPED it, and any test that mutated the shared fixture
 * silently changed what every later test saw.
 *
 * That coupling produced three real failures, each of which was a green test that
 * had been passing for the wrong reason:
 *
 *   1. The shared account was created with `balance: 0` and closed before any
 *      transaction existed. Actual TOMBSTONES a zero-transaction account on close,
 *      so every later test reusing that id operated on an account that no longer
 *      existed, and passed because the tools silently accepted the dead id.
 *   2. `transactions_uncategorized` asserted against an account an earlier test had
 *      set `offbudget: true`, which that tool deliberately excludes. It only passed
 *      because of defect 1.
 *   3. In the manual suite, a transfer left the shared account with a non-zero
 *      balance, so a teardown far away stopped working and the run failed its
 *      zero-residue assertion.
 *
 * THE RULE THIS ESTABLISHES. A test asks for what it needs and gets a fresh one:
 *
 *   test('...', async ({ mcp, makeAccount }) => {
 *     const account = await makeAccount();
 *     ...
 *   });
 *
 * Everything a factory creates is removed in fixture teardown, which runs even
 * when the test fails, so a failing test cannot leak residue into the next one.
 *
 * WHY A SINGLE PRIORITY-ORDERED REGISTRY rather than per-factory teardown.
 * Playwright unwinds fixtures in reverse setup order, which is the order the TEST
 * happened to declare them, not the order Actual's referential integrity needs.
 * Deletes have a required order here (transactions, then rules, then payees, then
 * categories, then groups, then accounts), so all factories share one `cleanup`
 * registry that sorts by that priority. `cleanup` is a dependency of every factory,
 * so it is set up first and therefore torn down last.
 */

import { test as base, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  waitForMCPHealth,
  retryRequest,
  callTool,
  extractResult,
  DEFAULT_MCP_SERVER_URL,
  HTTP_PATH,
} from '../shared/e2e-helpers.js';

export { expect };

/**
 * Cleanup priorities. LOWER runs FIRST, and the order is Actual's referential
 * integrity, not a preference: a rule referencing a category must go before the
 * category, and an account goes last because deleting one also deletes its
 * transactions.
 */
export const CLEANUP_ORDER = {
  /** A note is attached to another entity, so it is cleared before anything is removed. */
  note: 5,
  transaction: 10,
  /**
   * Month-level budget state (a hold carried to next month). Runs before entities are
   * removed, while the income those numbers were computed from still exists.
   */
  budgetHold: 8,
  /** Tags are referenced by transaction text, so they go after transactions. */
  tag: 15,
  rule: 20,
  schedule: 25,
  payee: 30,
  category: 40,
  categoryGroup: 50,
  account: 60,
  /**
   * Not an entity: restoring the session's ACTIVE BUDGET. It must run last, because every
   * step above deletes through the session and would otherwise be aimed at the wrong
   * budget. Used by the export/import round trip.
   */
  activeBudget: 100,
} as const;

export type CleanupRegistry = {
  /** Register a teardown step. `priority` comes from CLEANUP_ORDER. */
  add(priority: number, label: string, fn: () => Promise<void>): void;
};

/** A thin MCP client bound to one initialised session. */
export type McpClient = {
  sessionId: string;
  /** tools/call, returning the UNWRAPPED result (extractResult applied). Throws on a tool error. */
  call(tool: string, args?: Record<string, unknown>): Promise<any>;
  /** tools/call, returning the RAW MCP envelope. Use when the `{ id, created }` shape matters. */
  raw(tool: string, args?: Record<string, unknown>): Promise<any>;
  /** Post an arbitrary JSON-RPC payload and return the HTTP response, for error-envelope tests. */
  post(payload: unknown): Promise<APIResponse>;
};

export type AccountRef = { id: string; name: string };
export type CategoryGroupRef = { id: string; name: string };
export type CategoryRef = { id: string; name: string; groupId: string };
export type PayeeRef = { id: string; name: string };
export type TransactionRef = { id: string; accountId: string; notes: string };
export type RuleRef = { id: string };
export type ScheduleRef = { id: string; name: string };

export type Fixtures = {
  cleanup: CleanupRegistry;
  mcp: McpClient;
  makeAccount: (opts?: {
    name?: string;
    balance?: number;
    /**
     * Seed one zero-amount transaction. Required by any test that CLOSES the
     * account: Actual deletes a zero-transaction account on close instead of
     * closing it, which is defect 1 in this file's header.
     */
    seedTransaction?: boolean;
  }) => Promise<AccountRef>;
  makeCategoryGroup: (opts?: { name?: string }) => Promise<CategoryGroupRef>;
  makeCategory: (opts?: { name?: string; group?: CategoryGroupRef }) => Promise<CategoryRef>;
  makePayee: (opts?: { name?: string }) => Promise<PayeeRef>;
  makeTransaction: (opts: {
    account: AccountRef;
    amount?: number;
    date?: string;
    notes?: string;
    payee?: string;
    category?: string;
  }) => Promise<TransactionRef>;
  makeRule: (opts: {
    marker?: string;
    categoryId: string;
    /** Omit the action's `op` field, which is a supported shorthand this suite covers. */
    withoutOp?: boolean;
  }) => Promise<RuleRef>;
  makeSchedule: (opts?: { name?: string; date?: string; amount?: number }) => Promise<ScheduleRef>;
};

/**
 * One MCP session per worker process. Initialising costs a handshake plus a health
 * poll, and the session is not state a test can corrupt, so it is cached rather
 * than rebuilt per test. Module scope IS worker scope: Playwright runs each worker
 * in its own process, so two workers never share this.
 */
let cachedSessionId: string | undefined;

async function initSession(request: APIRequestContext): Promise<string> {
  if (cachedSessionId) return cachedSessionId;

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

  const initRes = await retryRequest(() =>
    request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    }),
  );

  const sessionId = initRes.headers()['mcp-session-id'];
  expect(sessionId, 'the initialize handshake must return an mcp-session-id').toBeTruthy();

  const isHealthy = await waitForMCPHealth(request, `${DEFAULT_MCP_SERVER_URL}/health`);
  expect(isHealthy, 'the MCP server must report healthy before tests run').toBeTruthy();

  cachedSessionId = sessionId;
  return sessionId;
}

function makeClient(request: APIRequestContext, sessionId: string): McpClient {
  return {
    sessionId,
    raw: (tool, args = {}) => callTool(request, sessionId, tool, args),
    call: async (tool, args = {}) => extractResult(await callTool(request, sessionId, tool, args)),
    post: (payload) =>
      request.post(`${DEFAULT_MCP_SERVER_URL}${HTTP_PATH}`, {
        data: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', 'mcp-session-id': sessionId },
      }),
  };
}

/** A short unique suffix. Date.now() alone collides when two entities are made in one tick. */
let uniqueCounter = 0;
export function uniqueSuffix(): string {
  uniqueCounter += 1;
  return `${Date.now()}-${uniqueCounter}`;
}

export const today = (): string => new Date().toISOString().substring(0, 10);
export const currentMonth = (): string => new Date().toISOString().substring(0, 7);

export const test = base.extend<Fixtures>({
  cleanup: async ({}, use) => {
    const items: { priority: number; seq: number; label: string; fn: () => Promise<void> }[] = [];
    let seq = 0;

    await use({
      add(priority, label, fn) {
        items.push({ priority, seq: (seq += 1), label, fn });
      },
    });

    // Ascending priority, and LIFO within one priority so a later-created entity of
    // the same kind goes first. Every step swallows its own error: teardown must not
    // convert a passing test into a failing one, and a delete test that already
    // removed its object leaves a step here that correctly finds nothing to do.
    items.sort((a, b) => a.priority - b.priority || b.seq - a.seq);
    for (const item of items) {
      try {
        await item.fn();
      } catch (error) {
        console.warn(`cleanup: ${item.label} failed (non-fatal): ${(error as Error).message}`);
      }
    }
  },

  mcp: async ({ request }, use) => {
    await use(makeClient(request, await initSession(request)));
  },

  makeAccount: async ({ mcp, cleanup }, use) => {
    await use(async (opts = {}) => {
      const name = opts.name ?? `E2E-Test-${uniqueSuffix()}`;
      const id = (await mcp.call('actual_accounts_create', {
        name,
        balance: opts.balance ?? 0,
      })) as string;
      // REGISTER BEFORE ASSERTING. The entity exists on the server the moment create
      // returns. If the id assertion below fires (an upstream shape change, say), a
      // registration placed after it would never run and the entity would survive as
      // residue, failing the zero-residue check for a reason unrelated to the real fault.
      // Every cleanup step swallows its own error, so registering a bad id is harmless.
      cleanup.add(CLEANUP_ORDER.account, `account ${name}`, async () => {
        // A CLOSED account cannot be deleted (Actual silently ignores it, and since
        // v0.12.0 the tool reports that rather than claiming success). Reopen first
        // so a test that closes its account still tears down cleanly.
        try {
          await mcp.call('actual_accounts_delete', { id });
          return;
        } catch (error) {
          if (!/closed/i.test((error as Error).message)) throw error;
        }
        await mcp.call('actual_accounts_reopen', { id });
        await mcp.call('actual_accounts_delete', { id });
      });

      expect(typeof id, `accounts_create must return an id string, got ${JSON.stringify(id)}`).toBe(
        'string',
      );

      if (opts.seedTransaction) {
        await mcp.call('actual_transactions_create', {
          account: id,
          date: today(),
          amount: 0,
          notes: 'E2E fixture: keeps the account closable rather than deletable',
        });
      }

      return { id, name };
    });
  },

  makeCategoryGroup: async ({ mcp, cleanup }, use) => {
    await use(async (opts = {}) => {
      const name = opts.name ?? `E2E-Group-${uniqueSuffix()}`;
      const raw = await mcp.call('actual_category_groups_create', { name });
      const id = (typeof raw === 'string' ? raw : raw?.id) as string;
      cleanup.add(CLEANUP_ORDER.categoryGroup, `category group ${name}`, async () => {
        await mcp.call('actual_category_groups_delete', { id });
      });
      expect(id, 'category_groups_create must return an id').toBeTruthy();

      return { id, name };
    });
  },

  makeCategory: async ({ mcp, cleanup, makeCategoryGroup }, use) => {
    await use(async (opts = {}) => {
      const group = opts.group ?? (await makeCategoryGroup());
      const name = opts.name ?? `E2E-Category-${uniqueSuffix()}`;
      const raw = await mcp.call('actual_categories_create', { name, group_id: group.id });
      const id = (typeof raw === 'string' ? raw : raw?.categoryId ?? raw?.id) as string;
      cleanup.add(CLEANUP_ORDER.category, `category ${name}`, async () => {
        await mcp.call('actual_categories_delete', { id });
      });
      expect(id, 'categories_create must return an id').toBeTruthy();

      return { id, name, groupId: group.id };
    });
  },

  makePayee: async ({ mcp, cleanup }, use) => {
    await use(async (opts = {}) => {
      const name = opts.name ?? `E2E-Payee-${uniqueSuffix()}`;
      const id = (await mcp.call('actual_payees_create', { name })) as string;
      cleanup.add(CLEANUP_ORDER.payee, `payee ${name}`, async () => {
        await mcp.call('actual_payees_delete', { id });
      });
      expect(id, 'payees_create must return an id').toBeTruthy();

      return { id, name };
    });
  },

  makeTransaction: async ({ mcp, cleanup }, use) => {
    await use(async (opts) => {
      const notes = opts.notes ?? `E2E-Txn-${uniqueSuffix()}`;
      const args: Record<string, unknown> = {
        account: opts.account.id,
        date: opts.date ?? today(),
        amount: opts.amount ?? -5000,
        notes,
      };
      if (opts.payee) args.payee = opts.payee;
      if (opts.category) args.category = opts.category;

      const created = await mcp.call('actual_transactions_create', args);
      // transactions_create returns the id for a single create. Fall back to a
      // filter-by-notes lookup rather than guessing, so the ref is always real.
      let id = typeof created === 'string' ? created : (created?.id as string | undefined);
      if (!id) {
        const rows = ((await mcp.call('actual_transactions_filter', {
          accountId: opts.account.id,
        })) ?? []) as any[];
        id = rows.find((t) => t?.notes === notes)?.id;
      }
      cleanup.add(CLEANUP_ORDER.transaction, `transaction ${notes}`, async () => {
        await mcp.call('actual_transactions_delete', { id });
      });
      expect(id, 'a created transaction must be locatable by id').toBeTruthy();

      return { id: id as string, accountId: opts.account.id, notes };
    });
  },

  makeRule: async ({ mcp, cleanup }, use) => {
    await use(async (opts) => {
      const marker = opts.marker ?? `E2E-Rule-${uniqueSuffix()}`;
      const id = (await mcp.call('actual_rules_create', {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'notes', op: 'contains', value: marker }],
        actions: opts.withoutOp
          ? [{ field: 'category', value: opts.categoryId }]
          : [{ op: 'set', field: 'category', value: opts.categoryId }],
      })) as string;
      cleanup.add(CLEANUP_ORDER.rule, `rule ${marker}`, async () => {
        await mcp.call('actual_rules_delete', { id });
      });
      expect(id, 'rules_create must return an id').toBeTruthy();

      return { id };
    });
  },

  makeSchedule: async ({ mcp, cleanup }, use) => {
    await use(async (opts = {}) => {
      const name = opts.name ?? `E2E-Schedule-${uniqueSuffix()}`;
      const data = await mcp.call('actual_schedules_create', {
        name,
        date: opts.date ?? '2026-06-15',
        amount: opts.amount ?? -5000,
        amountOp: 'is',
        posts_transaction: false,
      });
      const id = (typeof data === 'string' ? data : data?.id) as string;
      cleanup.add(CLEANUP_ORDER.schedule, `schedule ${name}`, async () => {
        await mcp.call('actual_schedules_delete', { id });
      });
      expect(typeof id, 'schedules_create must return an id string').toBe('string');

      return { id, name };
    });
  },
});
