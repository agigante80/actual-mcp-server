// tests/unit/refresh_test_budget_snapshot.test.js
//
// #595: scripts/refresh-test-budget-snapshot.mjs re-uploads the disposable test budget so the
// release gate's stdio leg replays only its own messages. It WRITES to the Actual server, so its
// refusal is the part that must never regress. This pins:
//   R1 (negative): MCP_TEST_BUDGET_SYNC_ID unset: exit 2, "refusing", before the api is imported.
//   R2 (negative): MCP_TEST_BUDGET_SYNC_ID set to another budget than ACTUAL_BUDGET_SYNC_ID: exit 2.
//   R3 (static): the script refreshes with upload-budget and never calls sync-reset (which assigns
//      a new groupId and would break BEARER_BUDGET_SYNC_ID and MCP_TEST_BUDGET_SYNC_ID).
//   R4 (static, positive): deploy-and-test.sh runs the refresh before the stdio integration run,
//      only at the levels that run it, as `app`, under a timeout, with the OIDC sync ids passed
//      as forbidden, and exits non-zero when the refresh does.
//   R5 (negative): the designation is one the OIDC instance serves: exit 3.
//   R6 (negative): a data dir root inside /app/data: exit 4.
//   S1 to S7 run the script against a STUB api module (REFRESH_API_MODULE), so the write path
//   is exercised without a server:
//   S1 (positive): upload-budget sent exactly once, exit 0, replay counts printed, no password.
//   S2 (negative): the opened budget's groupId differs: exit 1, upload-budget never sent.
//   S3 (negative): upload-budget returns { error }: exit 1.
//   S4 (negative): the server file id changes across the upload: exit 1, names both env vars.
//   S5 (negative): the second download still replays above REFRESH_MAX_REPLAY: exit 1.
//   S6 (negative): upstream logs no replay line at all: exit 1 (never read as 0).
//   S7 (negative): get-remote-files returns null: exit 1 naming the listing, not the env vars.
// The live behaviour is exercised by every `deploy-and-test.sh full`, which prints both
// cold-load timings and replay counts.
//
// Run: node tests/unit/refresh_test_budget_snapshot.test.js

import assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(root, 'scripts', 'refresh-test-budget-snapshot.mjs');
const DEPLOY = join(root, 'scripts', 'deploy-and-test.sh');

const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECRET = 'hunter2-not-for-logs';

// A stand-in for @actual-app/api. STUB_* env vars pick the failure; every send() is appended to
// STUB_CALLS so a case can assert what reached the "server".
const STUB = `
import { appendFileSync } from 'node:fs';
const e = process.env;
let downloads = 0;
let uploaded = false;
const lib = {
  async send(name) {
    appendFileSync(e.STUB_CALLS, name + '\\n');
    if (name === 'load-prefs') return { groupId: e.STUB_OPEN_GROUP || e.MCP_TEST_BUDGET_SYNC_ID };
    if (name === 'get-remote-files') {
      if (e.STUB_LIST_NULL) return null;
      const fileId = uploaded && e.STUB_NEW_FILE ? 'ffffffff-new' : 'eeeeeeee-old';
      return [{ groupId: e.MCP_TEST_BUDGET_SYNC_ID, fileId, deleted: false }];
    }
    if (name === 'upload-budget') { uploaded = true; return e.STUB_UPLOAD_ERROR ? { error: { reason: 'network-failure' } } : {}; }
    throw new Error('unexpected send ' + name);
  },
};
export async function init() { return lib; }
export async function downloadBudget() {
  downloads += 1;
  if (e.STUB_NO_REPLAY_LINE) return;
  console.log('Got messages from server', downloads === 1 ? 60000 : Number(e.STUB_SECOND_REPLAY || 3));
}
export async function shutdown() {}
`;
const stubDir = mkdtempSync(join(tmpdir(), 'refresh-stub-'));
const STUB_PATH = join(stubDir, 'api-stub.mjs');
writeFileSync(STUB_PATH, STUB);

function stubRun(extra) {
  const calls = join(stubDir, `calls-${Math.random().toString(36).slice(2)}`);
  writeFileSync(calls, '');
  const r = run({
    ACTUAL_BUDGET_SYNC_ID: ID,
    MCP_TEST_BUDGET_SYNC_ID: ID,
    ACTUAL_BUDGET_PASSWORD: SECRET,
    REFRESH_API_MODULE: STUB_PATH,
    REFRESH_DATA_ROOT: stubDir,
    STUB_CALLS: calls,
    ...extra,
  });
  return { ...r, calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean) };
}

function run(env) {
  const base = { PATH: process.env.PATH };
  // An unroutable server: if a refusal ever regressed, the run would fail to connect rather
  // than touch a real Actual server (localhost:5006 is a live one on the maintainer machine).
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...base, ACTUAL_SERVER_URL: 'http://127.0.0.1:5999', ACTUAL_PASSWORD: 'dummy', ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
}

// R1
{
  const r = run({ ACTUAL_BUDGET_SYNC_ID: 'aaaaaaaa-0000-0000-0000-000000000001' });
  assert.strictEqual(r.status, 2, `R1: expected exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /refusing: MCP_TEST_BUDGET_SYNC_ID is unset/, 'R1: refusal names the missing designation');
}

// R2
{
  const r = run({
    ACTUAL_BUDGET_SYNC_ID: 'aaaaaaaa-0000-0000-0000-000000000001',
    MCP_TEST_BUDGET_SYNC_ID: 'bbbbbbbb-0000-0000-0000-000000000002',
  });
  assert.strictEqual(r.status, 2, `R2: expected exit 2, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /refusing: .* is not the loaded budget/, 'R2: refusal names the mismatch');
}

// R3
{
  const src = readFileSync(SCRIPT, 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /send\('upload-budget'\)/, 'R3: refresh uses upload-budget');
  assert.doesNotMatch(code, /sync-reset/, 'R3: refresh never calls sync-reset');
  const guard = code.indexOf('process.exit(2)');
  const imp = code.indexOf("'@actual-app/api'");
  assert.ok(guard > 0 && imp > guard, 'R3: the refusal runs before the api is imported');
}

// R4
{
  const sh = readFileSync(DEPLOY, 'utf8');
  const levels = sh.indexOf('normal|extended|full)', sh.indexOf('Step 8/9'));
  const refresh = sh.indexOf('refresh-test-budget-snapshot.mjs', levels);
  const exitOnFail = sh.indexOf('exit "$REFRESH_EXIT"', refresh);
  const stdioRun = sh.indexOf('MCP_TEST_TRANSPORT=stdio', refresh);
  assert.ok(levels > 0, 'R4: step 8 has a normal|extended|full branch');
  assert.ok(refresh > levels, 'R4: the refresh runs inside that branch');
  assert.ok(exitOnFail > refresh && exitOnFail < stdioRun, 'R4: a failed refresh exits before the stdio run');
  const designation = sh.indexOf('-e MCP_TEST_BUDGET_SYNC_ID=', levels);
  assert.ok(designation > levels && designation < refresh, 'R4: the designation is passed into the container');
  const forbidden = sh.indexOf('-e MCP_REFRESH_FORBIDDEN_SYNC_IDS=', levels);
  assert.ok(forbidden > levels && forbidden < refresh, 'R4: the OIDC sync ids are passed as forbidden');
  const asApp = sh.indexOf('timeout 300 docker exec -i -u app', levels);
  assert.ok(asApp > levels && asApp < refresh, 'R4: the refresh runs as app under a timeout');
}

// R5
{
  const r = run({
    ACTUAL_BUDGET_SYNC_ID: ID,
    MCP_TEST_BUDGET_SYNC_ID: ID,
    MCP_REFRESH_FORBIDDEN_SYNC_IDS: `bbbbbbbb-0000-0000-0000-000000000002, ${ID}`,
  });
  assert.strictEqual(r.status, 3, `R5: expected exit 3, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /refusing: .* OIDC instance serves/, 'R5: refusal names the OIDC budget');
}

// R6
{
  const r = run({ ACTUAL_BUDGET_SYNC_ID: ID, MCP_TEST_BUDGET_SYNC_ID: ID, REFRESH_DATA_ROOT: '/app/data/x' });
  assert.strictEqual(r.status, 4, `R6: expected exit 4, got ${r.status}: ${r.stderr}`);
}

// S1
{
  const r = stubRun({});
  assert.strictEqual(r.status, 0, `S1: expected exit 0, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.strictEqual(r.calls.filter((c) => c === 'upload-budget').length, 1, 'S1: upload-budget sent once');
  assert.match(r.stdout, /before refresh: \d+ ms, 60000 messages/, 'S1: first replay count printed');
  assert.match(r.stdout, /after refresh: +\d+ ms, 3 messages/, 'S1: second replay count printed');
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET), 'S1: no password in output');
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(ID), 'S1: the sync id is printed redacted');
}

// S2
{
  const r = stubRun({ STUB_OPEN_GROUP: 'cccccccc-0000-0000-0000-000000000003' });
  assert.strictEqual(r.status, 1, `S2: expected exit 1, got ${r.status}`);
  assert.ok(!r.calls.includes('upload-budget'), 'S2: upload-budget never sent for the wrong budget');
  assert.match(r.stdout, /not the designated one/, 'S2: names the mismatch');
}

// S3
{
  const r = stubRun({ STUB_UPLOAD_ERROR: '1' });
  assert.strictEqual(r.status, 1, `S3: expected exit 1, got ${r.status}`);
  assert.match(r.stdout, /upload-budget failed: network-failure/, 'S3: names the upstream error');
}

// S4
{
  const r = stubRun({ STUB_NEW_FILE: '1' });
  assert.strictEqual(r.status, 1, `S4: expected exit 1, got ${r.status}`);
  assert.match(r.stdout, /BEARER_BUDGET_SYNC_ID and MCP_TEST_BUDGET_SYNC_ID/, 'S4: names the env vars to check');
}

// S5
{
  const r = stubRun({ STUB_SECOND_REPLAY: '5000', REFRESH_MAX_REPLAY: '200' });
  assert.strictEqual(r.status, 1, `S5: expected exit 1, got ${r.status}`);
  assert.match(r.stdout, /did not reduce the replay: 5000 messages, limit 200/, 'S5: names the count');
}

// S6
{
  const r = stubRun({ STUB_NO_REPLAY_LINE: '1' });
  assert.strictEqual(r.status, 1, `S6: expected exit 1, got ${r.status}`);
  assert.match(r.stdout, /logged no replay count/, 'S6: a missing replay line fails');
  assert.ok(!r.calls.includes('upload-budget'), 'S6: nothing is uploaded when the replay cannot be read');
}

// S7
{
  const r = stubRun({ STUB_LIST_NULL: '1' });
  assert.strictEqual(r.status, 1, `S7: expected exit 1, got ${r.status}`);
  assert.match(r.stdout, /could not list the server files/, 'S7: names the listing failure');
  assert.doesNotMatch(r.stdout, /BEARER_BUDGET_SYNC_ID/, 'S7: does not blame the env vars');
}

rmSync(stubDir, { recursive: true, force: true });

console.log('refresh_test_budget_snapshot: R1 to R6, S1 to S7 passed');
