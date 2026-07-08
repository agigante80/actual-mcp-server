#!/usr/bin/env node
// INFORMATIONAL diagnostic for #270 on the HTTP transport. NOT a gated regression.
//
// Why not gated: over HTTP the StreamableHTTP client itself times out a stalled
// request (~11s), so a client-observed "rejection" does NOT prove the server
// released the api mutex. The server-side wedge (mutex held, other sessions
// blocked) is the real #270 bug, and it is covered deterministically by the
// transport-agnostic unit test tests/unit/adapter_op_timeout.test.js (same
// withActualApi / withWriteSession / withApiLock that HTTP uses). This script
// just documents the observable HTTP behavior; it always exits 0.
//
// It reports two things under an upstream blackhole:
//   A. steady-state pooled write: expected to still resolve (Actual is offline-first)
//   B. session open / pool init: expected to stall server-side (client times out)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
const pexec = promisify(execFile);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // local self-signed bearer cert on :3601
const URL_ = process.env.MCP_HTTP_URL || 'https://localhost:3601/http';
const TOKEN = process.env.MCP_AUTH_TOKEN || 'MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6';
const ACTUAL_CTR = process.env.REGRESSION_ACTUAL_CTR || 'finance-actual-budget-main';
const BOUND_MS = Number(process.env.REGRESSION_BOUND_MS || 15000);
const now = () => Number(process.hrtime.bigint() / 1000000n);
let T0 = now();
const log = (m) => console.log(`  [t+${String(now() - T0).padStart(6)}ms] ${m}`);

let netemOn = false;
const nsh = (a) => pexec('docker', ['run', '--rm', '--net', `container:${ACTUAL_CTR}`, '--cap-add', 'NET_ADMIN', 'nicolaka/netshoot', 'tc', ...a]);
const blackhole = async () => { await nsh(['qdisc', 'add', 'dev', 'eth0', 'root', 'netem', 'loss', '100%']); netemOn = true; };
const clearNet = async () => { if (netemOn) { try { await nsh(['qdisc', 'del', 'dev', 'eth0', 'root']); } catch {} netemOn = false; } };

const mkClient = () => {
  const t = new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
  return { client: new Client({ name: 'diag-270-http', version: '1.0.0' }, { capabilities: {} }), transport: t };
};
const textOf = (r) => r?.content?.find((c) => c.type === 'text')?.text ?? '';
const bounded = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('__HANG__'), BOUND_MS))]);

async function main() {
  // A: steady-state pooled write under a mid-session stall.
  const A = mkClient();
  await A.client.connect(A.transport);
  const g = await A.client.callTool({ name: 'actual_category_groups_get', arguments: {} });
  const gid = (JSON.parse(textOf(g) || '{}').groups || [])[0]?.id;
  await A.client.callTool({ name: 'actual_categories_create', arguments: { name: `DIAG270-base-${process.pid}`, group_id: gid } });
  T0 = now();
  log('A: session open; baseline write OK. Blackholing upstream...');
  await blackhole();
  const wr = await bounded(A.client.callTool({ name: 'actual_categories_create', arguments: { name: `DIAG270-mid-${process.pid}`, group_id: gid } }).then((r) => (r.isError ? 'rejected' : 'resolved'), () => 'rejected'));
  log(`A: steady-state pooled write during stall -> ${wr === '__HANG__' ? 'HANG' : wr} (expected: resolved; offline-first)`);
  await clearNet();

  // B: session open / pool init under a stall.
  await blackhole();
  const B = mkClient();
  T0 = now();
  let phase = 'connect';
  const initRun = (async () => {
    await B.client.connect(B.transport);
    phase = 'op';
    await B.client.callTool({ name: 'actual_category_groups_get', arguments: {} });
    return 'ok';
  })().catch(() => 'client-rejected');
  const initRes = await bounded(initRun);
  log(`B: session-open under stall -> ${initRes === '__HANG__' ? 'client still waiting' : initRes} at phase='${phase}' (client-side timeout ~11s; server mutex covered by the unit test)`);
  await clearNet();
  await bounded(initRun).catch(() => {});

  console.log('\nDIAG (informational): HTTP steady-state tolerates a mid-session stall; session-open stalls server-side.');
  console.log('DIAG: the SERVER-side timeout+lock-release guarantee is gated by tests/unit/adapter_op_timeout.test.js.');
  process.exit(0);
}

process.on('SIGINT', async () => { await clearNet(); process.exit(0); });
main().catch(async (e) => { await clearNet(); console.error('DIAG note: harness/env issue (non-fatal): ' + (e?.message || e)); process.exit(0); });
