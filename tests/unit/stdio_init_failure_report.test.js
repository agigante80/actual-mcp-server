// #452: stdio clients get no init-failure cause, because #438's classifier was HTTP-only.
//
// WHAT THIS PINS, and why each half exists:
//
//   1. The stdio tools/call handler turns a FAILED CONNECTION into the same fixed sentence an
//      HTTP client gets. Before this, the raw upstream string went straight to Claude Desktop,
//      and for the #427 case that string ("Make sure you are using the latest version") names
//      the WRONG component: the user has already upgraded Actual, and the thing to upgrade is
//      actual-mcp-server.
//
//   2. The negatives, which are the reason the classification is gated on a BRAND rather than
//      on the message. This catch sees EVERY tool error, and classifyInitFailure's last-resort
//      branches match prose. Measured on v0.21.0 before the brand existed:
//        `Actual API operation timed out after 30000ms (ACTUAL_OP_TIMEOUT_MS)` -> `timeout`
//        `Authentication failed: Too many requests`                            -> `auth_failed`
//      The first is the #270 nesting-bug signal CLAUDE.md tells a reader to interpret as a
//      probable deadlock; the second would tell a rate-limited user their password is wrong.
//      Both replace a TRUE message with a FALSE one, in a fix whose whole point is that the
//      user is being sent to the wrong place. If these two cases ever go green while returning
//      a sentence, the gate has been widened back to prose and the fix has become the bug.
//
//   3. That the adapter actually applies the brand. Without this the handler could be perfect
//      and the feature still dead, since nothing would ever be marked.
//
// Run: node tests/unit/stdio_init_failure_report.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

const { classifyInitFailure, markInitFailure, isInitFailure } =
  await import('../../dist/src/lib/init-failure.js');
const { createStdioCallToolHandler } = await import('../../dist/src/server/stdioServer.js');
const httpServerMod = await import('../../dist/src/server/httpServer.js');

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const section = (l) => log(`\n[#452] ${l}`);
async function check(name, fn) {
  try { await fn(); log(`  ok: ${name}`); passed++; }
  catch (err) { log(`  FAIL: ${name}\n    ${err.message}`); failed++; }
}

const SESSION = 'stdio-test-session';
const REQUEST = { params: { name: 'actual_accounts_list', arguments: {} } };
const handlerThatThrows = (err) =>
  createStdioCallToolHandler({ executeTool: async () => { throw err; } }, SESSION);

// A sentinel standing in for everything an upstream string can carry (a stack, raw SQL, an
// EACCES path, the configured server URL). It must never appear in what the client receives.
const UPSTREAM = 'RAW-UPSTREAM-/home/someone/.actual-SENTINEL';

section('a branded init failure becomes the fixed sentence');

await check('structured .code (invalid-schema) yields the schema_too_new sentence', async () => {
  const err = markInitFailure(Object.assign(new Error(UPSTREAM), { code: 'invalid-schema' }));
  const res = await handlerThatThrows(err)(REQUEST);
  assert.strictEqual(res.isError, true, 'expected an MCP tool error');
  const text = res.content[0].text;
  assert.strictEqual(text, classifyInitFailure(err).sentence);
  assert.ok(/upgrade actual-mcp-server/i.test(text), `sentence must name this server: ${text}`);
  assert.ok(!text.includes(UPSTREAM), 'the raw upstream string must not reach the client');
});

await check('the #396 synthesized post-condition shape yields the same sentence', async () => {
  // This is what actually arrives on a resync of an existing local copy, so a fix handling
  // only `.code` would miss the common case.
  const err = markInitFailure(new Error(`Budget load post-condition failed. Upstream reason: [out-of-sync-migrations] ${UPSTREAM}`));
  const res = await handlerThatThrows(err)(REQUEST);
  assert.strictEqual(res.isError, true);
  assert.strictEqual(res.content[0].text, classifyInitFailure(err).sentence);
  assert.ok(!res.content[0].text.includes(UPSTREAM));
});

await check('an ECONNREFUSED init failure yields the network sentence', async () => {
  const err = markInitFailure(Object.assign(new Error(UPSTREAM), { code: 'ECONNREFUSED' }));
  const res = await handlerThatThrows(err)(REQUEST);
  assert.strictEqual(res.isError, true);
  assert.ok(/could not be reached/i.test(res.content[0].text));
});

section('NEGATIVES: an error that is not an init failure is never relabeled');

const MUST_PROPAGATE = [
  ['#270 op timeout raised by a TOOL', new Error('Actual API operation timed out after 30000ms (ACTUAL_OP_TIMEOUT_MS)')],
  ['#422 rate limit on a write', new Error('Authentication failed: Too many requests')],
  ['an ordinary not-found refusal', new Error('Account "abc" not found')],
  ['an unbranded ECONNREFUSED from a tool', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), { code: 'ECONNREFUSED' })],
];
for (const [label, err] of MUST_PROPAGATE) {
  await check(`propagates verbatim: ${label}`, async () => {
    await assert.rejects(
      () => handlerThatThrows(err)(REQUEST),
      (thrown) => {
        assert.strictEqual(thrown, err, 'the ORIGINAL error object must propagate');
        return true;
      },
    );
  });
}

await check('a BRANDED but unclassifiable error still propagates verbatim', async () => {
  // Branded-and-unknown must not become the vague `unknown` sentence: we would be discarding a
  // real message in exchange for "see the server log", which is strictly less useful.
  const err = markInitFailure(new Error('something nobody has a name for yet'));
  assert.strictEqual(classifyInitFailure(err).cause, 'unknown');
  await assert.rejects(() => handlerThatThrows(err)(REQUEST), (thrown) => thrown === err);
});

section('the success path is unchanged');

await check('a successful call returns its JSON content', async () => {
  const handler = createStdioCallToolHandler({ executeTool: async () => ({ accounts: [] }) }, SESSION);
  const res = await handler(REQUEST);
  assert.ok(!res.isError, 'a success must not be flagged as an error');
  assert.strictEqual(res.content[0].text, JSON.stringify({ accounts: [] }));
});

await check('a non-string tool name still throws', async () => {
  const handler = createStdioCallToolHandler({ executeTool: async () => ({}) }, SESSION);
  await assert.rejects(() => handler({ params: { name: 42 } }), /Tool name must be a string/);
});

section('the classifier is shared, not duplicated');

await check('httpServer re-exports the identical function', () => {
  assert.strictEqual(httpServerMod.classifyInitFailure, classifyInitFailure,
    'httpServer must re-export the library function, not hold a second copy');
});

await check('the brand is non-enumerable, so it cannot leak into a log or a response', () => {
  const err = markInitFailure(new Error('x'));
  assert.strictEqual(isInitFailure(err), true);
  assert.deepStrictEqual(Object.keys(err), [], 'the brand must not be an own enumerable key');
  assert.strictEqual(JSON.stringify({ ...err }), '{}');
});

await check('marking a frozen error does not throw and degrades to unbranded', () => {
  const frozen = Object.freeze(new Error('frozen'));
  assert.strictEqual(markInitFailure(frozen), frozen);
  assert.strictEqual(isInitFailure(frozen), false);
});

await check('a plain error is not branded', () => {
  assert.strictEqual(isInitFailure(new Error('plain')), false);
  assert.strictEqual(isInitFailure(null), false);
  assert.strictEqual(isInitFailure('a string'), false);
});

section('the adapter APPLIES the brand (without this the handler is dead code)');

await check('an error from api.init escapes withActualApi branded', async () => {
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default || adapterMod;
  const origInit = api.init;
  const boom = Object.assign(new Error('This budget could not be loaded'), { code: 'invalid-schema' });
  api.init = async () => { throw boom; };
  try {
    await assert.rejects(
      () => adapter.getAccounts(),
      (thrown) => {
        assert.strictEqual(isInitFailure(thrown), true,
          'initActualApiForOperation must mark an initialisation failure');
        assert.strictEqual(classifyInitFailure(thrown).cause, 'schema_too_new');
        return true;
      },
    );
  } finally {
    api.init = origInit;
  }
});

section('round 2 review findings: the brand alone was not enough');

await check('a THROTTLED login is not reported as a wrong password', () => {
  // withAuthRetry rethrows once its budget is exhausted, from INSIDE
  // initActualApiForOperation, so a rate-limit IS a genuine init failure and IS branded. The
  // brand therefore cannot save us here: the classifier had to learn the case. Before this,
  // a rate-limited stdio user was told to check ACTUAL_PASSWORD, which is a wrong answer of
  // exactly the kind this whole classifier exists to remove. HTTP had the same defect.
  const err = markInitFailure(new Error('Authentication failed: Too many requests'));
  const { cause, sentence } = classifyInitFailure(err);
  assert.strictEqual(cause, 'rate_limited', 'a throttle must not classify as auth_failed');
  assert.ok(!/ACTUAL_PASSWORD/.test(sentence), `must not send the user to their password: ${sentence}`);
  assert.ok(/wait a minute|too many requests/i.test(sentence), sentence);
});

await check('the rate-limit decision comes from retry.ts, not a second copy', async () => {
  // #177 collapsed the retry and pool-drop decisions onto ONE pattern source so they could not
  // drift. A classifier holding its own near-miss regex would reintroduce that, and the copy
  // that was written first genuinely differed (it missed `too-many-requests` spacing variants).
  const { isRateLimitError } = await import('../../dist/src/lib/retry.js');
  for (const msg of ['Too many requests', 'too-many-requests', 'rate limit exceeded', 'Authentication failed: Too Many Requests']) {
    const err = markInitFailure(new Error(msg));
    assert.strictEqual(isRateLimitError(err), true, `retry.ts should call this a rate limit: ${msg}`);
    assert.strictEqual(classifyInitFailure(err).cause, 'rate_limited', `and so should the classifier: ${msg}`);
  }
});

await check('the brand survives a REWRAP that preserves cause', () => {
  // runQuery and bankSync both rewrap into a friendlier message. Dropping the object dropped
  // the brand, which silently exempted those tools from this fix while every test still passed.
  const original = markInitFailure(Object.assign(new Error('raw'), { code: 'invalid-schema' }));
  const rewrapped = new Error('Query execution failed: raw', { cause: original });
  assert.strictEqual(isInitFailure(rewrapped), true, 'isInitFailure must walk cause');
  assert.strictEqual(classifyInitFailure(original).cause, 'schema_too_new');
});

await check('walking cause is depth bounded and cycle safe', () => {
  const a = new Error('a');
  const b = new Error('b', { cause: a });
  a.cause = b;                       // a cycle: must terminate, not hang
  assert.strictEqual(isInitFailure(a), false);
  let deep = new Error('leaf');
  for (let i = 0; i < 50; i++) deep = new Error(`w${i}`, { cause: deep });
  assert.strictEqual(isInitFailure(deep), false, 'an unbranded deep chain is still not an init failure');
});

await check('actual_query_run reports a failed CONNECTION, not a failed query', async () => {
  // The end-to-end version of the rewrap case, through the real adapter.
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default || adapterMod;
  const origInit = api.init;
  api.init = async () => { throw Object.assign(new Error('This budget could not be loaded'), { code: 'invalid-schema' }); };
  try {
    await assert.rejects(
      () => adapter.runQuery('SELECT id FROM accounts'),
      (thrown) => {
        assert.strictEqual(isInitFailure(thrown), true,
          `the rewrapped error must still be recognisable as an init failure: ${thrown.message}`);
        assert.strictEqual(classifyInitFailure(thrown).cause, 'schema_too_new');
        return true;
      },
    );
  } finally {
    api.init = origInit;
  }
});

await check('EVERY budget load failure is branded, not just those via initActualApiForOperation', async () => {
  // Round 3 review: the write drain calls ensureLoadedBudgetMatchesSession directly per
  // operation, and the pooled precondition sites do too, so a load failure on those paths
  // escaped unbranded and stdio handed the user the raw upstream sentence. Branding moved to
  // loadBudgetTracked, the funnel every load passes through, so the set of call sites stops
  // mattering. Asserted through the loader itself rather than by grepping for the call.
  const { loadBudgetTracked } = await import('../../dist/src/lib/budgetLoader.js');
  const apiState = await import('../../dist/src/lib/apiState.js');
  const boom = Object.assign(new Error('This budget could not be loaded'), { code: 'invalid-schema' });
  const origDownload = api.downloadBudget;
  const origMonths = api.getBudgetMonths;
  const origVersion = api.getServerVersion;
  api.getServerVersion = async () => ({ error: 'no-server' });
  api.downloadBudget = async () => { throw boom; };
  api.getBudgetMonths = async () => ['2026-01'];
  apiState.setApiInitialized(true);
  try {
    await assert.rejects(
      () => loadBudgetTracked('sync-brand-test'),
      (thrown) => {
        assert.strictEqual(isInitFailure(thrown), true, 'a failed load must carry the brand');
        assert.strictEqual(classifyInitFailure(thrown).cause, 'schema_too_new');
        return true;
      },
    );
  } finally {
    api.downloadBudget = origDownload;
    api.getBudgetMonths = origMonths;
    api.getServerVersion = origVersion;
  }
});

section('prototype keys must not be treated as known causes');

// The lookup tables are object literals, so they inherit Object.prototype. A bare truthiness
// test (`if (REASON_TO_CAUSE[code])`) therefore MATCHES an error carrying `code: 'constructor'`,
// returns a `cause` that is not an InitFailureCause, and yields `INIT_FAILURE_SENTENCES[cause]`
// === undefined. stdio would then answer a tool call with `text: undefined`, which the SDK's
// result schema is entitled to reject. Pre-existing from #438; #452 is what makes every stdio
// tool error pass through here, so it became reachable.
//
// Review found the Object.hasOwn fix had no test: reverting all four lookups left the suite
// fully green. These cases are that test.
for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
  await check(`code: '${key}' is not a known cause`, () => {
    const err = markInitFailure(Object.assign(new Error('x'), { code: key }));
    const { cause, sentence } = classifyInitFailure(err);
    assert.strictEqual(cause, 'unknown', `a prototype key must classify as unknown, got '${cause}'`);
    assert.strictEqual(typeof sentence, 'string', 'the sentence must never be undefined');
    assert.ok(sentence.length > 0);
  });

  await check(`reason: '${key}' is not a known cause`, () => {
    const err = markInitFailure(Object.assign(new Error('x'), { reason: key }));
    assert.strictEqual(classifyInitFailure(err).cause, 'unknown');
  });
}

await check('and the stdio handler never answers with an undefined text', async () => {
  // The end-to-end consequence, through the real handler: branded (so it reaches the
  // classifier) with a prototype key. It must PROPAGATE, not return a malformed result.
  const err = markInitFailure(Object.assign(new Error('upstream text'), { code: 'constructor' }));
  await assert.rejects(() => handlerThatThrows(err)(REQUEST), (thrown) => thrown === err);
});

log(`\n[#452] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
