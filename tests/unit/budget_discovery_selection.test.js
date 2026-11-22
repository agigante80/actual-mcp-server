// #689: run the selection against the live request list and observe the actual SDK open target.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'discovery-selection-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
Object.assign(process.env, {
  MCP_BRIDGE_DATA_DIR: dir, ACTUAL_SERVER_URL: 'https://one.example.test/actual',
  ACTUAL_PASSWORD: 'fixture', ACTUAL_BUDGET_SYNC_ID: 'T', BUDGET_DEFAULT_NAME: 'Default',
  BUDGET_1_NAME: 'Home', BUDGET_1_SYNC_ID: 'S',
  BUDGET_2_NAME: 'Archive', BUDGET_2_SYNC_ID: 'S', BUDGET_2_SERVER_URL: 'https://two.example.test',
  BUDGET_2_ENCRYPTION_PASSWORD: 'fixture-key', USE_CONNECTION_POOL: 'false',
  AUTH_PROVIDER: 'oidc', AUTH_BUDGET_ACL_SOURCE: 'actual', AUTH_BUDGET_DISCOVERY: 'true',
});
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const adapter = await import('../../dist/src/lib/actual-adapter.js');
const preferences = await import('../../dist/src/lib/budget-preference-store.js');
const { connectToActualForSession } = await import('../../dist/src/actualConnection.js');
const api = (await import('@actual-app/api')).default;
const logins = [], downloads = [];
globalThis.fetch = async url => {
  logins.push(String(url));
  return Response.json({ status: 'ok', data: { token: 'fixture' } });
};
api.init = async () => ({ send: async () => {} });
api.getBudgetMonths = async () => [];
api.getServerVersion = async () => ({ version: '26.5.0' });
api.downloadBudget = async (...args) => { downloads.push(args); };

const file = (syncId, name, encrypted = false) => ({ syncId, name, encrypted });
const zeta = file('Z', 'Zeta'), alpha = file('A', 'alpha'), household = file('H', '0000 Household');
const defaultFile = file('T', 'Default'), copied = file('S', 'Copied');
const locked = file('L', 'Locked', true);
function context(files, sessionId = 'new', principal = 'bob') {
  return { sessionId, principal, discoveredBudgets: files, allowedBudgets: files.map(f => f.syncId) };
}
const start = store => requestContext.run(store, () => adapter.initialBudgetForSession(store.sessionId));
const list = store => requestContext.run(store, () => adapter.getBudgetRegistry().map(b => b.name));
async function noStart(store) {
  assert.equal(start(store).name, 'Default');
  await assert.rejects(requestContext.run(store, () => adapter.getAccounts()), { message: /^Budget ACL:/ });
}
async function open(store, expectedName, server, expectedDownload) {
  const budget = start(store);
  assert.equal(budget.name, expectedName);
  logins.length = 0;
  downloads.length = 0;
  await requestContext.run(store, () => connectToActualForSession(store.sessionId, budget));
  assert.deepEqual(logins, [server + '/account/login']);
  assert.deepEqual(downloads, [expectedDownload]);
  return budget;
}
const primary = process.env.ACTUAL_SERVER_URL;
const single = context([zeta]);
const selected = await open(single, 'Zeta', primary, ['Z']);
adapter.pinSessionBudget(single.sessionId, selected);
assert.equal(start(context([zeta, household])).syncId, 'Z');
assert.equal(start(context([{ ...zeta, name: 'Renamed' }, household])).name, 'Renamed');
assert.equal(existsSync(join(dir, 'budget-preferences.json')), false);

const onlyLocked = context([locked], 'locked-only');
assert.equal(start(onlyLocked).name, 'Default');
await assert.rejects(requestContext.run(onlyLocked, () => adapter.getAccounts()), { refusalKind: 'locked', message: /^Budget L / });
for (const files of [[zeta, alpha], [zeta, household], [locked, alpha],
  [{ ...defaultFile, encrypted: true }, alpha], []]) {
  const store = context(files, 'ambiguous');
  await noStart(store);
}
assert.deepEqual(list(context([zeta, alpha], 'listing')), ['Zeta', 'alpha']);
const limited = { ...context([zeta, locked], 'limited'), allowedBudgets: ['Z'] };
assert.equal(start(limited).syncId, 'Z');

adapter._setSkipApiInitForTests(true);
const manual = context([zeta, alpha], 'manual');
await requestContext.run(manual, () => adapter.switchBudget('A'));
assert.equal(preferences.getPreferredBudgetSyncId('bob'), 'A');
adapter._setSkipApiInitForTests(false);
await open(context([zeta, alpha], 'saved'), 'alpha', primary, ['A']);
await open(context([zeta], 'revoked'), 'Zeta', primary, ['Z']);
assert.equal(preferences.getPreferredBudgetSyncId('bob'), 'A');
await noStart(context([zeta, household], 'stale'));
assert.equal(start(context([zeta, copied, defaultFile], 'configured')).syncId, 'T');
const configured = context([defaultFile, zeta], 'configured');
adapter.pinSessionBudget(configured.sessionId, start(configured));
await assert.rejects(requestContext.run(context([zeta], 'configured'), () => adapter.getAccounts()),
  { message: /^Budget ACL:/ });

preferences.setPreferredBudgetSyncId('dave', 'S');
await open(context([defaultFile, copied], 'duplicate', 'dave'), 'Home', primary, ['S']);
await open(context([defaultFile, { ...copied, encrypted: true }], 'encrypted', 'dave'),
  'Archive', process.env.BUDGET_2_SERVER_URL, ['S', { password: 'fixture-key' }]);

// No discovery metadata: use the existing configured-budget fallback.
const legacy = { sessionId: 'legacy', principal: 'bob', allowedBudgets: ['S'] };
assert.equal(start(legacy).name, 'Home');
process.stdout.write('Discovery starting budget selection and SDK targets passed\n');
