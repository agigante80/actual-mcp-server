// tests/unit/budget_acl_parse.test.js
//
// #551: an invalid AUTH_BUDGET_ACL refuses startup instead of silently opening
// every budget to every user.
//
// Three layers:
//   parser  : parseBudgetAcl (the zero-import leaf), by value, plus the error-text
//             contract (never a key, a value or JSON.parse's echo of the input)
//   layer 1 : configSchema.safeParse in-process, OIDC env and AUTH_PROVIDER=none
//   layer 2 : a child process imports dist/src/config.js with an explicit env and
//             must exit non-zero with AUTH_BUDGET_ACL on stderr and nothing on
//             stdout (the shared config module is what both transports load)
//   runtime : the deny state through _setRawAclForTests, the prototype-key rows,
//             and _resetAclForTests restoring the open state
//
// Run: node tests/unit/budget_acl_parse.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';
delete process.env.AUTH_BUDGET_ACL;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { parseBudgetAcl } = await import('../../dist/src/auth/budget-acl-parse.js');
const { configSchema } = await import('../../dist/src/config.js');
const { getAllowedBudgets, _setAclForTests, _setRawAclForTests, _resetAclForTests } =
  await import('../../dist/src/auth/budget-acl.js');
const logger = (await import('../../dist/src/logger.js')).default;

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Capture error and info lines without silencing them.
const errorLines = [];
const infoLines = [];
const origError = logger.error.bind(logger);
const origInfo = logger.info.bind(logger);
logger.error = (msg, ...rest) => { errorLines.push(String(msg)); return origError(msg, ...rest); };
logger.info = (msg, ...rest) => { infoLines.push(String(msg)); return origInfo(msg, ...rest); };

const SECRETS = ['alice', 'example.com', 'b1-secret-id'];
const LEAKY_INPUTS = ['alice@example.com:[b1-secret-id]', '{"alice@example.com":"b1-secret-id"}'];
const noSecret = (text, where) => {
  for (const s of SECRETS) assert.ok(!String(text).includes(s), `${where} leaks ${s}: ${String(text).slice(0, 160)}`);
};
const throwsNaming = (raw, ...needles) => {
  let err;
  try { parseBudgetAcl(raw); } catch (e) { err = e; }
  assert.ok(err, `parsed although it must throw: ${raw}`);
  assert.ok(err instanceof TypeError, `not a TypeError: ${err}`);
  assert.ok(err.message.startsWith('AUTH_BUDGET_ACL: '), `message does not name the variable: ${err.message}`);
  for (const n of needles) assert.ok(err.message.includes(n), `message lacks "${n}": ${err.message}`);
  assert.strictEqual(err.cause, undefined, 'the error carries a cause');
  return err;
};
const mockReq = ({ sub, email, groups } = {}) => ({ auth: { token: 't', subject: sub, claims: { email, groups } } });

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] parser rows');
// ---------------------------------------------------------------------------

check("'{bad' is rejected as not valid JSON", () => throwsNaming('{bad', 'not valid JSON'));
check("'   ' (whitespace only) is rejected as not valid JSON", () => throwsNaming('   ', 'not valid JSON'));
check("'[\"b1\"]' is rejected: must be a JSON object (got array)", () => throwsNaming('["b1"]', 'must be a JSON object', 'got array'));
check("'42' is rejected: must be a JSON object (got number)", () => throwsNaming('42', 'must be a JSON object', 'got number'));
check("'\"x\"' is rejected: must be a JSON object (got string)", () => throwsNaming('"x"', 'must be a JSON object', 'got string'));
check("'null' is rejected: must be a JSON object (got null)", () => throwsNaming('null', 'must be a JSON object', 'got null'));
check("'{\"a\":\"b1\"}' is rejected: entry 0 must be an array (got string)", () => throwsNaming('{"a":"b1"}', 'entry 0', 'array of non-empty strings', 'got string'));
check("'{\"a\":[1]}' is rejected: entry 0 holds a number element", () => throwsNaming('{"a":[1]}', 'entry 0', 'number element'));
check("'{\"a\":[\"\"]}' is rejected: entry 0 holds an empty string", () => throwsNaming('{"a":[""]}', 'entry 0', 'empty string'));
check('the entry index is zero-based in key order (second entry bad reports entry 1)', () => throwsNaming('{"a":["b1"],"b":"x"}', 'entry 1'));
check('review r1: an integer-like key sorts first, so a bad first-written entry reports entry 1 and the message says why', () =>
  throwsNaming('{"a":"oops","12345":["b1"]}', 'entry 1', 'integer-like keys first', 'got string'));

check("'{}' parses to an empty map", () => assert.deepStrictEqual({ ...parseBudgetAcl('{}') }, {}));
check("'{\"alice@example.com\":[\"b1\"]}' parses by value", () =>
  assert.deepStrictEqual({ ...parseBudgetAcl('{"alice@example.com":["b1"]}') }, { 'alice@example.com': ['b1'] }));
check("'{\"group:admin\":[\"*\"]}' parses by value", () =>
  assert.deepStrictEqual({ ...parseBudgetAcl('{"group:admin":["*"]}') }, { 'group:admin': ['*'] }));
check("'{\"a\":[]}' is valid and parses to an empty list for that principal", () =>
  assert.deepStrictEqual({ ...parseBudgetAcl('{"a":[]}') }, { a: [] }));
check('the returned map has a null prototype', () => assert.strictEqual(Object.getPrototypeOf(parseBudgetAcl('{"a":["b1"]}')), null));

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] error-text contract (leak rows)');
// ---------------------------------------------------------------------------

for (const raw of LEAKY_INPUTS) {
  check(`parser message and cause carry no key or value for ${JSON.stringify(raw)}`, () => {
    const err = throwsNaming(raw);
    noSecret(err.message, 'message');
    noSecret(String(err.cause ?? ''), 'cause');
    noSecret(err.stack ?? '', 'stack');
  });
}
check("JSON.parse's own message is never echoed (its Node 22 shape quotes the input)", () => {
  const err = throwsNaming('alice@example.com:[b1-secret-id]');
  assert.ok(!err.message.includes('Unexpected token'), `echoed JSON.parse: ${err.message}`);
  assert.ok(!err.message.includes('is not valid JSON'), `echoed JSON.parse: ${err.message}`);
});

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] layer 1: configSchema.safeParse in-process');
// ---------------------------------------------------------------------------

const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};
const oidc = { ...base, AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://team.cloudflareaccess.test', OIDC_RESOURCE: 'https://host/http' };

const refusedOn = (env, ...needles) => {
  const r = configSchema.safeParse(env);
  assert.strictEqual(r.success, false, 'parsed although it must be refused');
  const issue = r.error.issues.find((i) => i.path.includes('AUTH_BUDGET_ACL'));
  assert.ok(issue, `no issue on AUTH_BUDGET_ACL: ${JSON.stringify(r.error.issues.map((i) => i.path))}`);
  assert.deepStrictEqual(issue.path, ['AUTH_BUDGET_ACL']);
  assert.ok(issue.message.includes('AUTH_BUDGET_ACL'), `message does not name the variable: ${issue.message}`);
  for (const n of needles) assert.ok(issue.message.includes(n), `message lacks "${n}": ${issue.message}`);
  return issue;
};
const parses = (env) => {
  const r = configSchema.safeParse(env);
  assert.strictEqual(r.success, true, JSON.stringify(r.error?.issues));
  return r.data;
};

check('OIDC + {"alice@example.com":["b1"],} (trailing comma) is refused on path AUTH_BUDGET_ACL', () =>
  refusedOn({ ...oidc, AUTH_BUDGET_ACL: '{"alice@example.com":["b1"],}' }, 'malformed', 'not valid JSON'));
check('OIDC + an array is refused', () => refusedOn({ ...oidc, AUTH_BUDGET_ACL: '["b1"]' }, 'got array'));
check('OIDC + a non-array value is refused naming the entry', () => refusedOn({ ...oidc, AUTH_BUDGET_ACL: '{"alice@example.com":"b1"}' }, 'entry 0'));
check('OIDC + null is refused', () => refusedOn({ ...oidc, AUTH_BUDGET_ACL: 'null' }, 'got null'));
check('OIDC + whitespace-only is refused', () => refusedOn({ ...oidc, AUTH_BUDGET_ACL: '  ' }, 'not valid JSON'));
check('AUTH_PROVIDER=none + an invalid value is refused too (validated unconditionally)', () =>
  refusedOn({ ...base, AUTH_PROVIDER: 'none', AUTH_BUDGET_ACL: '{bad' }, 'not valid JSON'));
check('AUTH_BUDGET_ACL_SOURCE=actual + an invalid value is refused too', () =>
  refusedOn({ ...oidc, AUTH_BUDGET_ACL_SOURCE: 'actual', AUTH_BUDGET_ACL: '{bad' }, 'not valid JSON'));
for (const raw of LEAKY_INPUTS) {
  check(`the issue message carries no key or value for ${JSON.stringify(raw)}`, () => noSecret(refusedOn({ ...oidc, AUTH_BUDGET_ACL: raw }).message, 'issue'));
}
check('the issue message tells the operator the expected shape and where to read', () =>
  refusedOn({ ...oidc, AUTH_BUDGET_ACL: '{bad' }, 'JSON object', 'docs/reference/configuration.md'));

check('POSITIVE CONTROL: a valid map parses and is kept as the raw string', () =>
  assert.strictEqual(parses({ ...oidc, AUTH_BUDGET_ACL: '{"alice@example.com":["b1"],"group:admin":["*"]}' }).AUTH_BUDGET_ACL, '{"alice@example.com":["b1"],"group:admin":["*"]}'));
check('NEGATIVE: unset still parses', () => assert.strictEqual(parses(oidc).AUTH_BUDGET_ACL, undefined));
check("NEGATIVE: '' still parses (unset)", () => assert.strictEqual(parses({ ...oidc, AUTH_BUDGET_ACL: '' }).AUTH_BUDGET_ACL, ''));
check("NEGATIVE: '{}' still parses (documented open default)", () => parses({ ...oidc, AUTH_BUDGET_ACL: '{}' }));
check('NEGATIVE: {"a":[]} parses', () => parses({ ...oidc, AUTH_BUDGET_ACL: '{"a":[]}' }));

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] layer 2: a child process loads dist/src/config.js');
// ---------------------------------------------------------------------------

const CHILD_ENV = {
  PATH: process.env.PATH,
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'dummy',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};
const configUrl = pathToFileURL(path.join(ROOT, 'dist', 'src', 'config.js')).href;
function loadConfigIn(extraEnv) {
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(configUrl)}).then(() => process.exit(0))`], {
    cwd: ROOT, env: { ...CHILD_ENV, ...extraEnv }, encoding: 'utf-8', timeout: 60_000,
  });
  assert.strictEqual(r.error, undefined, `spawn failed: ${r.error}`);
  return r;
}
const childRefuses = (extraEnv) => {
  const r = loadConfigIn(extraEnv);
  assert.notStrictEqual(r.status, 0, `child exited 0; stderr: ${r.stderr.slice(0, 200)}`);
  // The exact line config.ts prints for this issue (path: message). A bare
  // 'AUTH_BUDGET_ACL' would also match the AUTH_BUDGET_ACL_* refines.
  assert.ok(r.stderr.includes('AUTH_BUDGET_ACL: AUTH_BUDGET_ACL is malformed'), `stderr does not carry the ACL refusal: ${r.stderr.slice(0, 300)}`);
  assert.strictEqual(r.stdout, '', `stdout is not empty: ${r.stdout.slice(0, 200)}`);
  return r;
};
const childStarts = (extraEnv) => {
  const r = loadConfigIn(extraEnv);
  assert.strictEqual(r.status, 0, `child exited ${r.status}; stderr: ${r.stderr.slice(0, 300)}`);
  assert.strictEqual(r.stdout, '', `stdout is not empty: ${r.stdout.slice(0, 200)}`);
};
const OIDC_ENV = { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://team.cloudflareaccess.test', OIDC_RESOURCE: 'https://host/http' };

check('OIDC + invalid JSON: config load exits non-zero, names AUTH_BUDGET_ACL on stderr, prints nothing to stdout', () =>
  childRefuses({ ...OIDC_ENV, AUTH_BUDGET_ACL: '{"alice@example.com":["b1"],}' }));
check('OIDC + an array: config load exits non-zero', () => childRefuses({ ...OIDC_ENV, AUTH_BUDGET_ACL: '["b1"]' }));
check('AUTH_PROVIDER=none + invalid JSON: config load exits non-zero', () => childRefuses({ AUTH_PROVIDER: 'none', AUTH_BUDGET_ACL: '{bad' }));
for (const raw of LEAKY_INPUTS) {
  check(`child stderr carries no key or value for ${JSON.stringify(raw)}`, () => noSecret(childRefuses({ ...OIDC_ENV, AUTH_BUDGET_ACL: raw }).stderr, 'child stderr'));
}
check('WITNESS: a valid map starts', () => childStarts({ ...OIDC_ENV, AUTH_BUDGET_ACL: '{"alice@example.com":["b1"],"group:admin":["*"]}' }));
check("WITNESS: '{}' starts", () => childStarts({ ...OIDC_ENV, AUTH_BUDGET_ACL: '{}' }));
check('WITNESS: unset starts', () => childStarts(OIDC_ENV));

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] runtime: the deny state');
// ---------------------------------------------------------------------------

check('_setRawAclForTests({bad): a principal that would match a valid entry gets [] and the log says access denied', () => {
  _resetAclForTests();
  errorLines.length = 0;
  _setRawAclForTests('{bad');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'user-1', email: 'alice@example.com' })), []);
  const line = errorLines.find((l) => l.includes('[ACL] Invalid AUTH_BUDGET_ACL'));
  assert.ok(line, `no error line: ${JSON.stringify(errorLines)}`);
  assert.ok(line.includes('access denied'), line);
  assert.ok(!line.includes('no budget restrictions'), line);
  assert.ok(line.includes('not valid JSON'), line);
});
check('deny: a principal that would not match gets [] too', () => assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'nobody' })), []));
check('deny: a request with no req.auth gets [], never ["*"]', () => assert.deepStrictEqual(getAllowedBudgets({}), []));
check('deny is classified once and cached (one error line for three lookups)', () =>
  assert.strictEqual(errorLines.filter((l) => l.includes('[ACL] Invalid AUTH_BUDGET_ACL')).length, 1));
for (const raw of LEAKY_INPUTS) {
  check(`the runtime log line carries no key or value for ${JSON.stringify(raw)}`, () => {
    _resetAclForTests();
    errorLines.length = 0;
    _setRawAclForTests(raw);
    assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'user-1', email: 'alice@example.com' })), []);
    noSecret(errorLines.join('\n'), 'runtime log');
  });
}
check('_resetAclForTests() with the ACL unset returns ["*"] again (deny does not stick)', () => {
  _resetAclForTests();
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'user-1' })), ['*']);
});
check("_setRawAclForTests('') is open", () => { _setRawAclForTests(''); assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'x' })), ['*']); });
check("_setRawAclForTests('{}') is open and logs nothing", () => {
  _resetAclForTests(); infoLines.length = 0; errorLines.length = 0;
  _setRawAclForTests('{}');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'x' })), ['*']);
  assert.strictEqual(infoLines.filter((l) => l.includes('[ACL]')).length, 0);
  assert.strictEqual(errorLines.filter((l) => l.includes('[ACL]')).length, 0);
});
check('a valid raw map applies as before and logs the principal count', () => {
  _resetAclForTests(); infoLines.length = 0;
  _setRawAclForTests('{"alice@example.com":["b1"],"group:admin":["*"]}');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ email: 'alice@example.com' })), ['b1']);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'x', groups: ['admin'] })), ['*']);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'nobody' })), []);
  assert.ok(infoLines.some((l) => l.includes('[ACL] Budget ACL loaded: 2 principal(s)')), JSON.stringify(infoLines));
});
check('{"a":[]} denies that principal (empty list is not the open state)', () => {
  _resetAclForTests();
  _setRawAclForTests('{"a":[]}');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'a' })), []);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'b' })), []);
});

// ---------------------------------------------------------------------------
console.log('\n[budget-acl-parse] prototype keys');
// ---------------------------------------------------------------------------

check('{"__proto__":["b1"]} yields a non-empty map: a non-matching principal gets [], never ["*"]', () => {
  _resetAclForTests();
  _setRawAclForTests('{"__proto__":["b1"]}');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'nobody' })), []);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: '__proto__' })), ['b1']);
});
check('parseBudgetAcl keeps "__proto__" as an own key without touching the prototype', () => {
  const map = parseBudgetAcl('{"__proto__":["b1"]}');
  assert.ok(Object.hasOwn(map, '__proto__'));
  assert.strictEqual(Object.getPrototypeOf(map), null);
  assert.deepStrictEqual(Object.keys(map), ['__proto__']);
});
check('principals named constructor and toString get [] without throwing (parsed map)', () => {
  _resetAclForTests();
  _setRawAclForTests('{"alice@example.com":["b1"]}');
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'constructor' })), []);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'toString', groups: ['constructor'] })), []);
});
check('principals named constructor and toString get [] without throwing (plain object via _setAclForTests)', () => {
  _resetAclForTests();
  _setAclForTests({ 'alice@example.com': ['b1'] });
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'constructor' })), []);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'toString' })), []);
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'hasOwnProperty' })), []);
});
check('_setAclForTests({}) is the open state, as before', () => {
  _setAclForTests({});
  assert.deepStrictEqual(getAllowedBudgets(mockReq({ sub: 'x' })), ['*']);
});

_resetAclForTests();
logger.error = origError;
logger.info = origInfo;

console.log(`\n[budget-acl-parse] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
