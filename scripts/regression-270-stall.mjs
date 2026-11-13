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
// every subsequent tool call. That is the budget-tracker production hang.
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
import { deleteOwnObjects } from './lib/harness-cleanup.mjs';
import { stdioExecArgs, prepareStdioDataDir } from './lib/harness-stdio.mjs';
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

// #575: its own data dir as `app`. On the HTTP server's /app/data this process was a
// second writer whose stale copy broke every later session open (out_of_sync).
const DATA_DIR = '/tmp/mcp-reg270-data';
prepareStdioDataDir(MCP_CTR, DATA_DIR);
const transport = new StdioClientTransport({
  command: 'docker',
  args: stdioExecArgs({ container: MCP_CTR, dataDir: DATA_DIR, env: { ACTUAL_OP_TIMEOUT_MS: OP_TIMEOUT_MS } }),
  stderr: 'ignore',
});
const client = new Client({ name: 'regression-270', version: '1.0.0' }, { capabilities: {} });

const textOf = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? '';
// #576: every name this run creates is `MCP-REG270-<label>-<RUN_ID>`. The 13-digit id
// puts it in the shape the pre-run residue sweep already removes (TEST_OBJECT_RE in
// tests/manual/residue.js), and it is what removeOwnObjects() below matches exactly.
const RUN_ID = Date.now();
const PREFIX = 'MCP-REG270';
const create = (label, groupId) => client.callTool({ name: 'manage_categories', arguments: { action: 'create', entity: 'category', name: `MCP-REG270-${label}-${RUN_ID}`, group_id: groupId } });

// #680: compact tool names. The gate container publishes the default compact surface, where
// a legacy name is refused (tests/unit/manual_support_compact.test.js guards this file).
const listGroups = () => client.callTool({ name: 'list_entities', arguments: { type: 'category_group' } });

async function getGroupId() {
  const g = await listGroups();
  const groups = JSON.parse(textOf(g) || '{}').groups || [];
  if (groups.length) return groups[0].id;
  const created = await client.callTool({ name: 'manage_categories', arguments: { action: 'create', entity: 'category_group', name: `MCP-REG270-grp-${RUN_ID}` } });
  // The tool returns { id, success }; the legacy read of `groupId` here never matched.
  const made = JSON.parse(textOf(created) || '{}');
  return made.id ?? made.result?.id;
}

// #575: the own data dir starts empty on every recreated container, so the first op
// downloads the whole budget, which outlasts the deliberately low OP_TIMEOUT_MS. The
// abandoned download finishes in the background; retry a read until it answers, BEFORE
// T0, so the stall check still runs under the low timeout. Raising the timeout instead
// would weaken the bound the regression asserts.
async function warmUp(attempts = 12, pauseMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    const r = await listGroups();
    if (!r.isError) return;
    console.log(`  warm-up ${i}/${attempts}: budget not loaded yet (${textOf(r).slice(0, 120)})`);
    await new Promise((res) => setTimeout(res, pauseMs));
  }
  throw new Error(`budget did not load into ${DATA_DIR} after ${attempts} attempts`);
}

async function main() {
  await client.connect(transport);
  await warmUp();
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
    return 2;
  }

  log(`step 2 ok: stalled create ${outcome} within ${now() - start}ms`);
  await netemClear();

  // Step 3: after recovery, a fresh write must succeed (lock was released).
  const r2 = await create('recovery', groupId);
  if (r2.isError) {
    console.log('\nRESULT: FAIL. Recovery write errored after link restore: ' + textOf(r2));
    return 2;
  }
  log('step 3 ok: recovery create succeeded (mutex was released)');
  console.log('\nRESULT: PASS. Stalled op rejected within bound and the lock recovered (#270 behavior correct).');
  return 0;
}

// Always restore the network, whatever happens.
const cleanup = async () => { try { await netemClear(); } catch { /* ignore */ } };

// #576: delete this run's MCP-REG270-*-<RUN_ID> objects on EVERY outcome, including the
// hang path, after the network is restored, through this run's own client (never a
// second stdio server on the same data dir). Best effort and bounded: the verdict is
// decided before this runs and is never changed by it. A write that timed out can still
// land a moment later (#493), so a second pass runs after a short settle.
const SETTLE_MS = 3000;
const removeOwnObjects = async () => {
  try {
    const call = (name, args) => client.callTool({ name, arguments: args });
    const first = await deleteOwnObjects(call, { prefix: PREFIX, runId: RUN_ID });
    if (first.timedOut) return;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await deleteOwnObjects(call, { prefix: PREFIX, runId: RUN_ID });
  } catch (e) {
    console.log(`  cleanup: skipped (${e?.message || e})`);
  }
};
// Works for a signal sent to this pid. A terminal Ctrl-C also reaches the docker exec
// child (same process group), so the transport is gone and the next pre-run sweep cleans.
const onSignal = async () => { await cleanup(); await removeOwnObjects(); process.exit(1); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

const code = await main().catch(async (e) => {
  console.error('\nRESULT: ERROR (harness/environment): ' + (e?.message || e));
  return 1;
});
await cleanup();
await removeOwnObjects();
process.exit(code);
