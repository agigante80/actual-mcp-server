#!/usr/bin/env node
// Regression check for #270: a stalled upstream operation must not hang forever.
//
// Correct (post-fix) behavior asserted here:
//   1. A first write completes normally.
//   2. When the upstream link blackholes mid-session, the next write REJECTS
//      within a bounded time (a per-operation timeout) instead of hanging.
//   3. After the link recovers, a further write SUCCEEDS, proving the global api
//      mutex was released rather than held forever.
//
// The bug (no operation timeout) makes step 2 hang indefinitely, which wedges
// every subsequent tool call. That is the personal-finance production hang.
//
// Exit codes (consumed by deploy-and-test.sh):
//   0  = correct behavior (fix present / working)
//   2  = KNOWN #270 hang reproduced (stall did not reject within the bound)
//   1  = harness / environment error (could not run the scenario)
//
// The fix must expose an env-configurable per-op timeout so this test can set it
// low (ACTUAL_OP_TIMEOUT_MS); see the #270 acceptance criteria.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
const pexec = promisify(execFile);

const ACTUAL_CTR = process.env.REGRESSION_ACTUAL_CTR || 'finance-actual-budget-main';
const MCP_CTR = process.env.MCP_STDIO_CONTAINER || 'actual-mcp-bearer-backend';
const OP_TIMEOUT_MS = Number(process.env.ACTUAL_OP_TIMEOUT_MS || 5000);
const BOUND_MS = Number(process.env.REGRESSION_BOUND_MS || 12000); // must exceed the op timeout with margin
const now = () => Number(process.hrtime.bigint() / 1000000n);
let T0;
const log = (m) => console.log(`  [t+${String(now() - T0).padStart(6)}ms] ${m}`);

let netemApplied = false;
const runNetshoot = (args) => pexec('docker', ['run', '--rm', '--net', `container:${ACTUAL_CTR}`, '--cap-add', 'NET_ADMIN', 'nicolaka/netshoot', 'tc', ...args]);
async function netemBlackhole() { await runNetshoot(['qdisc', 'add', 'dev', 'eth0', 'root', 'netem', 'loss', '100%']); netemApplied = true; }
async function netemClear() { if (!netemApplied) return; try { await runNetshoot(['qdisc', 'del', 'dev', 'eth0', 'root']); } catch { /* already gone */ } netemApplied = false; }

const transport = new StdioClientTransport({
  command: 'docker',
  args: ['exec', '-i', '-e', `ACTUAL_OP_TIMEOUT_MS=${OP_TIMEOUT_MS}`, MCP_CTR, 'node', 'dist/src/index.js', '--stdio'],
  stderr: 'ignore',
});
const client = new Client({ name: 'regression-270', version: '1.0.0' }, { capabilities: {} });

const textOf = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? '';
const create = (label, groupId) => client.callTool({ name: 'actual_categories_create', arguments: { name: `REG270-${label}-${process.pid}`, group_id: groupId } });

async function getGroupId() {
  const g = await client.callTool({ name: 'actual_category_groups_get', arguments: {} });
  const groups = JSON.parse(textOf(g) || '{}').groups || [];
  if (groups.length) return groups[0].id;
  const created = await client.callTool({ name: 'actual_category_groups_create', arguments: { name: `REG270-grp-${process.pid}` } });
  return JSON.parse(textOf(created) || '{}').groupId;
}

async function main() {
  await client.connect(transport);
  T0 = now();
  const groupId = await getGroupId();
  if (!groupId) throw new Error('could not obtain a category group id');

  // Step 1: baseline write succeeds.
  const r0 = await create('baseline', groupId);
  if (r0.isError) throw new Error('baseline create failed (environment not ready): ' + textOf(r0));
  log('step 1 ok: baseline create succeeded');

  // Step 2: blackhole the upstream, then a write must reject within BOUND_MS.
  await netemBlackhole();
  log(`step 2: upstream blackholed; a create must now REJECT within ${BOUND_MS}ms (op timeout=${OP_TIMEOUT_MS}ms)`);
  const start = now();
  let outcome = 'pending';
  const stalled = create('stalled', groupId)
    .then((r) => { outcome = r.isError ? 'rejected' : 'resolved'; })
    .catch(() => { outcome = 'rejected'; });
  const bound = new Promise((res) => setTimeout(res, BOUND_MS));
  await Promise.race([stalled, bound]);

  if (outcome === 'pending') {
    // Bug reproduced: stall never rejected within the bound.
    log(`step 2 KNOWN-FAIL: create still HANGING after ${now() - start}ms (no operation timeout)`);
    await netemClear(); // let the in-flight call error out and release
    console.log('\nRESULT: KNOWN #270 hang reproduced (stalled op did not reject within the bound).');
    process.exit(2);
  }

  log(`step 2 ok: stalled create ${outcome} within ${now() - start}ms`);
  await netemClear();

  // Step 3: after recovery, a fresh write must succeed (lock was released).
  const r2 = await create('recovery', groupId);
  if (r2.isError) {
    console.log('\nRESULT: FAIL. Recovery write errored after link restore: ' + textOf(r2));
    process.exit(2);
  }
  log('step 3 ok: recovery create succeeded (mutex was released)');
  console.log('\nRESULT: PASS. Stalled op rejected within bound and the lock recovered (#270 behavior correct).');
  process.exit(0);
}

// Always restore the network, whatever happens.
const cleanup = async () => { try { await netemClear(); } catch { /* ignore */ } };
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(1); });

main().catch(async (e) => {
  await cleanup();
  console.error('\nRESULT: ERROR (harness/environment): ' + (e?.message || e));
  process.exit(1);
});
