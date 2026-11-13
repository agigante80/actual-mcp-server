/**
 * #681: the compact tool surface, end to end, over stdio.
 *
 * Project `docker-e2e-compact-stdio`, run as Step 6c of tests/e2e/run-docker-e2e.sh with
 * MCP_TEST_TRANSPORT=stdio and MCP_E2E_TOOL_SURFACE=compact (tests/e2e/stdio-client.ts passes it
 * to the exec'd server as MCP_TOOL_SURFACE=compact). It is the only run where the server
 * publishes ONLY the 15 compact tools, so it is the only place the compact-only dispatch path
 * (`operationUnavailableError` in src/lib/errors.ts) and the exact published tool list are seen
 * on the wire. The 85-tool surface is covered by docker-all-tools.e2e.spec.ts.
 *
 * It uses the stdio transport and the pacer only: no provisioning factories from fixtures.ts,
 * because those create entities through legacy `actual_*` names that this surface refuses.
 * The one entity it creates it deletes itself, in a `finally`.
 */

import { test, expect, isStdio, uniqueSuffix } from './fixtures.js';

/** The 15 published compact tools (src/compact/registry.ts, COMPACT_TOOLS). */
const COMPACT_NAMES = [
  'get_context',
  'list_entities',
  'search_transactions',
  'summarize_transactions',
  'list_budget_months',
  'run_query',
  'manage_accounts',
  'manage_categories',
  'manage_payees',
  'manage_tags',
  'manage_rules',
  'manage_schedules',
  'manage_transactions',
  'manage_budget_months',
  'manage_budget_files',
];

const REFUSAL =
  'Tool "actual_accounts_list" is not available: this server publishes the compact tool surface (MCP_TOOL_SURFACE).';

test.describe('compact surface (MCP_TOOL_SURFACE=compact)', () => {
  test.skip(!isStdio, 'the compact leg is a stdio project: run with MCP_TEST_TRANSPORT=stdio');

  test('tools/list is exactly the 15 compact names and none start with actual_', async ({ mcp }) => {
    const names = (await mcp.listTools()).map((t: { name: string }) => t.name);
    expect([...names].sort()).toEqual([...COMPACT_NAMES].sort());
    expect(names).toHaveLength(15);
    expect(names.filter((n: string) => n.startsWith('actual_'))).toEqual([]);
  });

  test('get_context topic=version returns a semver string', async ({ mcp }) => {
    const data = await mcp.call('get_context', { topic: 'version' });
    expect(typeof data?.version).toBe('string');
    expect(data.version).toMatch(/\d+\.\d+\.\d+/);
  });

  test('manage_accounts create then delete, each read back through list_entities', async ({ mcp }) => {
    const name = `MCP-Test-compact-${uniqueSuffix()}`;
    const findByName = async () => {
      const accounts = (await mcp.call('list_entities', { type: 'account' })) as Array<{ id: string; name: string }>;
      return accounts.find((a) => a.name === name);
    };

    const id = (await mcp.call('manage_accounts', {
      action: 'create',
      entity: 'account',
      name,
      balance: 0,
    })) as string;
    try {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      const created = await findByName();
      expect(created, `list_entities type=account should contain ${name}`).toBeTruthy();
      expect(created!.id).toBe(id);
    } finally {
      await mcp.call('manage_accounts', { action: 'delete', entity: 'account', id });
    }

    expect(await findByName(), `${name} should be gone after delete`).toBeUndefined();
  });

  test('a direct legacy call is refused with the compact-surface message', async ({ mcp }) => {
    // The refusal reaches the client as a thrown protocol error or as an isError result,
    // depending on the SDK path; both carry the same message, so accept either.
    let message = '';
    try {
      const res = await mcp.raw('actual_accounts_list', {});
      expect(res.isError, 'the refusal must be an error').toBe(true);
      message = res.content?.[0]?.text ?? '';
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(REFUSAL);
  });
});
