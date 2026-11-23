// tests/unit/adapter_error_logging.test.js  (#559)
// The adapter's own error lines for a failed operation must not carry the error MESSAGE:
// it can quote what the caller sent (a category name, a whole query, a refused id) and
// the client still receives it. Drives the REAL adapter with raw api stubs (installed
// before the adapter import, session disarmed), captures stdout and stderr at debug, and
// asserts the sentinel reaches the caller but no log line.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/adapter_error_logging.test.js

// Set BEFORE importing anything that loads the logger singleton.
process.env.MCP_STDIO_MODE = 'true';
process.env.LOG_FORMAT = 'json';
process.env.MCP_BRIDGE_LOG_LEVEL = 'debug';
process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const out = (s) => process.stderr.write(s + '\n');
const ok = (cond, l, d = '') => {
  if (cond) out(`  ok: ${l}`);
  else { out(`  FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const capture = async (fn) => {
  const chunks = [];
  const origErr = process.stderr.write.bind(process.stderr);
  const origOut = process.stdout.write.bind(process.stdout);
  process.stderr.write = (...a) => { chunks.push(String(a[0])); return true; };
  process.stdout.write = (...a) => { chunks.push(String(a[0])); return true; };
  let outcome;
  try {
    try { outcome = { value: await fn() }; } catch (error) { outcome = { error }; }
    await sleep(30);
  } finally {
    process.stderr.write = origErr;
    process.stdout.write = origOut;
  }
  return { text: chunks.join(''), ...outcome };
};

const apiMod = await import('@actual-app/api');
const apiDefault = (apiMod.default || apiMod);
apiDefault.sync = async () => {};
apiDefault.runQuery = async () => { throw new Error('Field "SENTINEL559F" does not exist in table "transactions"'); };
// #763: createCategory now checks the group exists first, so the fixture group 'g1' must be listed.
apiDefault.getCategoryGroups = async () => [{ id: 'g1', name: 'G' }];
apiDefault.createCategory = async (c) => { throw new Error(`category "${c.name}" already exists in group`); };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;

out('\n[#559] a failed category create: the upstream message reaches the caller, not the logs');
{
  const r = await capture(() => adapter.createCategory({ name: 'SENTINEL-559-C', group_id: 'g1' }));
  ok(r.error && String(r.error.message).includes('SENTINEL-559-C'), 'the caller receives the upstream message', r.error && r.error.message);
  ok(!r.text.includes('SENTINEL-559-C'), 'the name is absent from every log line', r.text.split("\n").filter((l) => l.includes("SENTINEL")).join(" | ").slice(0, 600));
  ok(r.text.includes('[WRITE QUEUE] Operation failed') && r.text.includes('"errorClass":"Error"'),
    'the write queue still records the failure by class', r.text.split("\n").filter((l) => l.includes("SENTINEL")).join(" | ").slice(0, 600));
}

out('\n[#559] a rejected query: the message quotes the query to the caller, not the logs');
{
  const r = await capture(() => adapter.runQuery('SELECT SENTINEL559Q FROM nosuchtable'));
  ok(r.error && String(r.error.message).includes('SENTINEL559Q'), 'the caller receives the query in the message', r.error && r.error.message);
  ok(!r.text.includes('SENTINEL559Q'), 'the query is absent from every log line', r.text.split("\n").filter((l) => l.includes("SENTINEL")).join(" | ").slice(0, 600));
  ok(r.text.includes('[ADAPTER] Query execution failed'), 'the failure is still recorded');
}

out('\n[#559] an upstream query error: the field name reaches the caller, not the logs');
{
  const r = await capture(() => adapter.runQuery({ table: 'transactions' }));
  ok(r.error && String(r.error.message).includes('SENTINEL559F'), 'the caller receives the upstream text', r.error && r.error.message);
  ok(!r.text.includes('SENTINEL559F'), 'the upstream text is absent from every log line', r.text.split("\n").filter((l) => l.includes("SENTINEL")).join(" | ").slice(0, 600));
}

out('\n[#559] errorLogFields reads only content-free fields');
{
  const { errorLogFields } = await import('../../dist/src/lib/errors.js');
  const forged = new Error('x');
  Object.defineProperty(forged, 'constructor', { value: { name: 'SENTINEL-559-K' } });
  ok(errorLogFields(forged).errorClass === 'Error', 'an own constructor property cannot name the class', JSON.stringify(errorLogFields(forged)));
  const net = Object.assign(new Error('connect ECONNRESET 10.0.0.1'), { code: 'ECONNRESET' });
  ok(errorLogFields(net).code === 'ECONNRESET', 'a system error code is kept for operators');
  const odd = Object.assign(new Error('x'), { code: 'SENTINEL-559-K' });
  ok(!('code' in errorLogFields(odd)), 'a code without the system shape is dropped', JSON.stringify(errorLogFields(odd)));
  const thrown = errorLogFields('SENTINEL-559-K string thrown');
  ok(thrown.errorClass === 'string' && !JSON.stringify(thrown).includes('SENTINEL'), 'a non-Error throw is logged by its type only', JSON.stringify(thrown));
}

out('');
if (failures === 0) out('[#559] All adapter error logging tests passed');
else { out(`[#559] ${failures} test(s) FAILED`); process.exit(2); }
process.exit(0);
