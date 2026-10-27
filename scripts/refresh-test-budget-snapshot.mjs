#!/usr/bin/env node
// #595: refresh the server snapshot of the DISPOSABLE test budget so a fresh download
// starts from today instead of replaying every message since the last snapshot.
//
// Why: the stdio leg of deploy-and-test.sh downloads the test budget into an empty data dir
// on every op and replays every sync message newer than the server's stored file. Nothing
// else refreshes that file, so the replay grew by about 800 messages per `full` run until a
// stdio load crossed ACTUAL_OP_TIMEOUT_MS (30 s) and the gate went red on 2026-10-26
// (62,899 messages).
//
// How: download the budget into a fresh data dir, check the open budget IS the designated one,
// then call upstream `upload-budget`, which re-uploads the open file under the SAME groupId.
// Never `sync-reset`: it assigns a new groupId and so invalidates BEARER_BUDGET_SYNC_ID and
// MCP_TEST_BUDGET_SYNC_ID in the out-of-repo .env. Afterwards the server listing must show the
// same groupId on the same file, and a second cold download must replay at most
// REFRESH_MAX_REPLAY messages (an upload that silently wrote nothing fails here).
//
// Runs INSIDE the bearer container as `app`, where @actual-app/api and the ACTUAL_* env vars
// live (passwords come from the container's own environment, never from argv or -e):
//   docker exec -i -u app -w /app -e MCP_TEST_BUDGET_SYNC_ID=<id> actual-mcp-bearer-backend \
//     node --input-type=module - < scripts/refresh-test-budget-snapshot.mjs
//
// It writes to the Actual server, so it refuses before importing the api unless the operator
// designated the loaded budget disposable: MCP_TEST_BUDGET_SYNC_ID must be set, equal
// ACTUAL_BUDGET_SYNC_ID, and not appear in MCP_REFRESH_FORBIDDEN_SYNC_IDS (deploy-and-test.sh
// fills that with every sync id the OIDC instance serves). Never derive one id from another.
//
// Exit codes: 0 refreshed and verified, 1 failed, 2 refused (designation), 3 refused (OIDC id),
// 4 refused (data dir), 5 timed out.
import { rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SERVER_DATA_DIR = '/app/data'; // the running server's own copy (#575): never touch it
const redact = (id) => (typeof id === 'string' && id.length > 8 ? `${id.slice(0, 8)}...` : String(id));

const designated = process.env.MCP_TEST_BUDGET_SYNC_ID || '';
const loaded = process.env.ACTUAL_BUDGET_SYNC_ID || '';
const forbidden = (process.env.MCP_REFRESH_FORBIDDEN_SYNC_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const dataRoot = resolve(process.env.REFRESH_DATA_ROOT || tmpdir());
const maxReplay = Number(process.env.REFRESH_MAX_REPLAY || 200);
const timeoutMs = Number(process.env.REFRESH_TIMEOUT_MS || 240000);

if (!designated) {
  console.error('refusing: MCP_TEST_BUDGET_SYNC_ID is unset, so no budget is designated disposable; nothing was written');
  process.exit(2);
}
if (designated !== loaded) {
  console.error(`refusing: MCP_TEST_BUDGET_SYNC_ID (${redact(designated)}) is not the loaded budget (${redact(loaded)}); nothing was written`);
  process.exit(2);
}
if (forbidden.includes(designated)) {
  console.error(`refusing: MCP_TEST_BUDGET_SYNC_ID (${redact(designated)}) is a budget the OIDC instance serves; nothing was written`);
  process.exit(3);
}
if (dataRoot === SERVER_DATA_DIR || dataRoot.startsWith(`${SERVER_DATA_DIR}/`)) {
  console.error(`refusing: data dir root ${dataRoot} is inside the server's own ${SERVER_DATA_DIR} (#575); nothing was written`);
  process.exit(4);
}

const dirs = [];
const timer = setTimeout(() => {
  console.error(`  test budget refresh timed out after ${Math.round(timeoutMs / 1000)} s`);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  process.exit(5);
}, timeoutMs);
timer.unref();

// Upstream reports each sync's replay as a console.log line (0 included); count the first one per
// load. Every other line goes to stderr, so an upstream error still reaches the failure tail.
const replays = [];
const consoleLog = console.log;
console.log = (...args) => {
  const line = args.map(String).join(' ');
  const m = /Got messages from server (\d+)/.exec(line);
  if (m) replays.push(Number(m[1]));
  else console.error(line);
};
const say = (msg) => consoleLog(`  ${msg}`);

const connection = { serverURL: process.env.ACTUAL_SERVER_URL, password: process.env.ACTUAL_PASSWORD };
const encryption = process.env.ACTUAL_BUDGET_PASSWORD ? { password: process.env.ACTUAL_BUDGET_PASSWORD } : undefined;

// Never pass `verbose: false` to api.init: the replay count is a verbose log line.
const api = await import(process.env.REFRESH_API_MODULE || '@actual-app/api');

// One cold download into a fresh data dir, the shape of a stdio op's load. `api.init` returns
// the upstream handler object (`api.internal` is null in v26). Returns the first replay count.
async function coldDownload() {
  const dataDir = await mkdtemp(join(dataRoot, 'refresh-test-budget-'));
  dirs.push(dataDir);
  const lib = await api.init({ ...connection, dataDir });
  const before = replays.length;
  const started = Date.now();
  await api.downloadBudget(designated, encryption);
  // A missing line is never a legitimate 0 (upstream logs "0"): without it the replay check
  // below would pass an upload that wrote nothing.
  if (replays.length === before) throw new Error('upstream logged no replay count; cannot verify the refresh');
  return { lib, ms: Date.now() - started, replay: replays[before] };
}

async function serverFile(lib) {
  const files = await lib.send('get-remote-files');
  if (!Array.isArray(files)) throw new Error('could not list the server files (get-remote-files returned no list)');
  return files.find((f) => f.groupId === designated && !f.deleted);
}

let exitCode = 1;
try {
  const first = await coldDownload();
  say(`cold download before refresh: ${first.ms} ms, ${first.replay} messages replayed`);

  const prefs = await first.lib.send('load-prefs');
  if (prefs?.groupId !== designated) {
    throw new Error(`the open budget (${redact(prefs?.groupId)}) is not the designated one; upload-budget not sent`);
  }
  const fileBefore = await serverFile(first.lib);
  if (!fileBefore) throw new Error(`the server lists no file for ${redact(designated)}; upload-budget not sent`);

  const res = await first.lib.send('upload-budget');
  if (res?.error) throw new Error(`upload-budget failed: ${res.error.reason || JSON.stringify(res.error)}`);

  const fileAfter = await serverFile(first.lib);
  if (!fileAfter || fileAfter.fileId !== fileBefore.fileId) {
    throw new Error(
      `the server file for ${redact(designated)} changed (${redact(fileBefore.fileId)} to ${redact(fileAfter?.fileId)}): ` +
        'BEARER_BUDGET_SYNC_ID and MCP_TEST_BUDGET_SYNC_ID may now be invalid',
    );
  }
  await api.shutdown();

  const second = await coldDownload();
  say(`cold download after refresh:  ${second.ms} ms, ${second.replay} messages replayed (groupId ${redact(designated)} unchanged)`);
  if (second.replay > maxReplay) {
    throw new Error(`the refresh did not reduce the replay: ${second.replay} messages, limit ${maxReplay}`);
  }
  exitCode = 0;
} catch (e) {
  say(`test budget refresh failed: ${e?.message || e}`);
} finally {
  await api.shutdown().catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
