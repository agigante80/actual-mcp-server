/**
 * tests/manual/repro-212.mjs
 *
 * Reproduce + regression check for #212: transactions_update and update_batch must
 * NOT report success for a non-existent transaction id (the raw API silently no-ops).
 *   1. transactions_update(nil id)  -> actionable not-found error, server alive.
 *   2. update_batch([nil id])       -> the nil id lands in failed[], not succeeded[].
 *   3. update_batch([valid, nil])   -> valid one succeeds, nil one fails (per-item).
 *
 * Run:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 MCP_SERVER_URL=https://localhost:3601/http \
 *     MCP_TEST_MAX_RETRIES=2 node tests/manual/repro-212.mjs
 */
import readline from 'node:readline';
import { createClient } from './mcp-client.js';

const URL = process.env.MCP_SERVER_URL || 'https://localhost:3601/http';
const TOKEN = process.env.MCP_AUTH_TOKEN || 'MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6';
const NIL = '00000000-0000-0000-0000-000000000000';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const client = createClient({ url: URL, rl, retryPauseMs: 500 });
client.setToken(`Bearer ${TOKEN}`);

async function call(tool, args) {
  try { return { ok: true, value: await client.callTool(tool, args) }; }
  catch (e) { return { ok: false, message: e?.message || String(e) }; }
}
async function alive() { try { await client.callTool('actual_server_info', {}); return true; } catch { return false; } }

(async () => {
  console.log(`# repro-212 against ${URL}\n`);
  await client.initialize();
  if (!(await alive())) { console.log('ABORT: server not responsive'); rl.close(); process.exit(2); }

  let pass = 0, total = 0;
  const ok = (cond, label, detail) => { total++; if (cond) { pass++; console.log(`PASS  ${label}`); } else { console.log(`FAIL  ${label} -> ${detail}`); } };

  // Need a real transaction id for the mixed-batch positive case. Find one (read-only).
  let realId = null;
  const accts = await call('actual_accounts_list', {});
  const firstAcct = accts.ok && Array.isArray(accts.value) ? accts.value[0]?.id : null;
  if (firstAcct) {
    const txns = await call('actual_transactions_get', { accountId: firstAcct });
    const arr = txns.ok ? (txns.value?.transactions || txns.value) : null;
    realId = Array.isArray(arr) && arr.length ? arr[0].id : null;
  }

  // 1. single update, nil id -> not-found error (currently: {success:true})
  const r1 = await call('actual_transactions_update', { id: NIL, fields: { notes: 'repro-212' } });
  const a1 = await alive();
  const r1err = (!r1.ok && /not found/i.test(r1.message || '')) ||
                (r1.ok && typeof r1.value?.error === 'string' && /not found/i.test(r1.value.error));
  ok(r1err && a1, 'transactions_update(nil): actionable not-found error', JSON.stringify(r1).slice(0, 160) + ` | alive=${a1}`);

  // 2. batch, nil id -> in failed[], not succeeded[] (currently: succeeded)
  const r2 = await call('actual_transactions_update_batch', { updates: [{ id: NIL, fields: { notes: 'repro-212' } }] });
  const r2ok = r2.ok && r2.value?.successCount === 0 && r2.value?.failureCount === 1 &&
               /not found/i.test(JSON.stringify(r2.value?.failed || ''));
  ok(r2ok, 'update_batch([nil]): nil lands in failed[] with not-found', JSON.stringify(r2).slice(0, 200));

  // 3. mixed batch: valid succeeds, nil fails (per-item isolation preserved)
  if (realId) {
    const r3 = await call('actual_transactions_update_batch', { updates: [
      { id: realId, fields: { notes: 'repro-212-ok' } },
      { id: NIL, fields: { notes: 'repro-212-bad' } },
    ] });
    const r3ok = r3.ok && r3.value?.successCount === 1 && r3.value?.failureCount === 1 &&
                 (r3.value.succeeded || []).some(s => s.id === realId) &&
                 (r3.value.failed || []).some(f => f.id === NIL);
    ok(r3ok, 'update_batch([valid,nil]): 1 succeeded + 1 failed (per-item)', JSON.stringify(r3).slice(0, 220));
  } else {
    console.log('SKIP  mixed-batch case (no real transaction id found in the test budget)');
  }

  console.log(`\n# RESULT: ${pass}/${total} pass`);
  rl.close();
  process.exit(pass === total ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); rl.close(); process.exit(3); });
