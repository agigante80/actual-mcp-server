/**
 * tests/manual/repro-delete-guards.mjs
 *
 * Reproduction + regression harness for the "delete tool, non-existent id" contract
 * (issue #211 and its siblings). For EVERY delete tool it calls the tool with a nil
 * UUID against a LIVE server and asserts the strict contract the lenient integration
 * tests do not:
 *   1. it must NOT return a silent success for a non-existent id,
 *   2. it must return an ACTIONABLE "not found" error (not a cryptic internal error),
 *   3. the server must stay alive afterward (no crash / connection reset).
 *
 * Run (local bearer instance, native TLS):
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 MCP_SERVER_URL=https://localhost:3601/http \
 *     MCP_TEST_MAX_RETRIES=2 node tests/manual/repro-delete-guards.mjs
 *
 * Exit 0 = all tools satisfy the contract. Exit 1 = at least one violates it.
 */
import readline from 'node:readline';
import { createClient } from './mcp-client.js';

const URL = process.env.MCP_SERVER_URL || 'https://localhost:3601/http';
const TOKEN = process.env.MCP_AUTH_TOKEN || 'MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6';
const NIL = '00000000-0000-0000-0000-000000000000';

// Every delete tool. `id` is the arg name for all of them.
const DELETE_TOOLS = [
  'actual_accounts_delete',
  'actual_categories_delete',
  'actual_category_groups_delete',
  'actual_payees_delete',
  'actual_rules_delete',
  'actual_schedules_delete',
  'actual_tags_delete',
  'actual_transactions_delete',
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const client = createClient({ url: URL, rl, retryPauseMs: 500 });
client.setToken(`Bearer ${TOKEN}`);

const INFRA = /ECONNRESET|socket hang up|ECONNREFUSED|ETIMEDOUT|fetch failed|Connection lost|aborted/i;
const CRYPTIC = /Cannot destructure|Cannot read propert|undefined is not|is not a function|NOT NULL constraint|intermediate value/i;

async function attempt(tool, args) {
  try {
    const value = await client.callTool(tool, args);
    return { outcome: 'returned', value };
  } catch (err) {
    return { outcome: 'threw', message: err?.message || String(err) };
  }
}

async function serverAlive() {
  try {
    await client.callTool('actual_server_info', {});
    return true;
  } catch {
    return false;
  }
}

function classify(res, aliveAfter) {
  if (!aliveAfter) return { pass: false, verdict: 'CRASH: server did not survive (no follow-up response)' };
  if (res.outcome === 'returned') {
    return { pass: false, verdict: `SILENT SUCCESS: returned ${JSON.stringify(res.value)} for a non-existent id` };
  }
  const m = res.message || '';
  if (INFRA.test(m)) return { pass: false, verdict: `INFRA/CRASH error: "${m.slice(0, 150)}"` };
  if (CRYPTIC.test(m)) return { pass: false, verdict: `CRYPTIC internal error: "${m.slice(0, 150)}"` };
  if (/not found/i.test(m)) return { pass: true, verdict: `ACTIONABLE not-found: "${m.slice(0, 150)}"` };
  return { pass: false, verdict: `NON-ACTIONABLE error: "${m.slice(0, 150)}"` };
}

(async () => {
  console.log(`# repro-delete-guards against ${URL}\n`);
  await client.initialize();
  if (!(await serverAlive())) {
    console.log('ABORT: server not responsive at baseline.');
    rl.close();
    process.exit(2);
  }

  const rows = [];
  for (const tool of DELETE_TOOLS) {
    const res = await attempt(tool, { id: NIL });
    const alive = await serverAlive();
    const c = classify(res, alive);
    rows.push({ tool, pass: c.pass, verdict: c.verdict });
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${tool.padEnd(34)} ${c.verdict}`);
  }

  const failed = rows.filter((r) => !r.pass);
  console.log(`\n# RESULT: ${rows.length - failed.length}/${rows.length} pass`);
  if (failed.length) console.log(`# FAIL: ${failed.map((r) => r.tool).join(', ')}`);
  rl.close();
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('HARNESS ERROR:', err);
  rl.close();
  process.exit(3);
});
