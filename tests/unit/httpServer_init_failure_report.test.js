// tests/unit/httpServer_init_failure_report.test.js
//
// #438: a session whose Actual init failed must report WHY, instead of the
// client's next request getting a bare "Session not found".
//
// Reproduced before the fix, end to end against the real server: booting with
// ACTUAL_SERVER_URL pointing at a closed port makes connectToActualForSession
// genuinely throw; `initialize` still returned SUCCESS, and the next request
// returned only `-32001 Session not found`, while the server log held
// "Authentication failed: network-failure". After the fix the same run returns
// the network_unreachable cause and its sentence.
//
// Two-pronged, matching this repo's convention for httpServer tests:
//   1. The classifier is a PURE EXPORTED function, called directly with
//      synthetic values. This is deliberate: there is NO fault-injection seam in
//      actualConnection.ts or the pool, and a closed-port boot reaches only
//      `network-failure`, so every other class is unreachable end to end.
//   2. Static source guards for the properties a behavioural test cannot see:
//      the record's bound, peek-not-consume, containment, and above all that no
//      upstream-derived string can reach the wire.
//
// Run: node tests/unit/httpServer_init_failure_report.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/438

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The dist module validates config at import, so give it dummies if the caller
// did not (CI sets these for the whole chain).
process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');
const { classifyInitFailure } = await import('../../dist/src/server/httpServer.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

console.log('\n[#438 session-init failure reporting]');

const err = (o) => Object.assign(new Error(o.message ?? 'synthetic'), o);

// --- 1. the classifier, by direct call ---------------------------------------

check('#438: `.code` is the primary discriminator, per the api-handler boundary', () => {
  // Upstream's api/download-budget and api/load-budget never let a SyncError
  // escape: they throw a plain Error carrying .code via withErrorCode. A
  // classifier keyed on .reason alone would miss every real case.
  assert.strictEqual(classifyInitFailure(err({ code: 'invalid-schema' })).cause, 'schema_too_new');
  assert.strictEqual(classifyInitFailure(err({ code: 'budget-not-found' })).cause, 'budget_not_found');
  assert.strictEqual(classifyInitFailure(err({ code: 'out-of-sync-data' })).cause, 'out_of_sync');
});

check('#438: out-of-sync-migrations is schema_too_new, NOT out_of_sync', () => {
  // The mapping that decides whether #427 is reported correctly. `invalid-schema`
  // is absent from budgetLoader's KNOWN_LOAD_REASONS, so on the post-condition
  // path `out-of-sync-migrations` is the ONLY route by which a too-new schema
  // surfaces. Filing it under out_of_sync would send an operator to look for a
  // sync problem that does not exist.
  assert.strictEqual(classifyInitFailure(err({ code: 'out-of-sync-migrations' })).cause, 'schema_too_new');
  assert.strictEqual(classifyInitFailure(err({ code: 'out-of-sync' })).cause, 'out_of_sync');
});

check('#438: our own post-condition error (#396) is classified from its prose', () => {
  // On a resync of an existing local copy this is the shape that actually
  // reaches the caller for the schema and migration classes: OUR synthesized
  // Error, with no .code and no .reason, carrying the upstream reason embedded.
  // A classifier that handled only the upstream shapes would answer `unknown`
  // for exactly the failures this ticket exists to surface.
  const e = new Error('Budget load post-condition failed. Upstream reason: [out-of-sync-migrations] (sync id 1234)');
  assert.strictEqual(classifyInitFailure(e).cause, 'schema_too_new');
});

check('#438: fs codes are a separate namespace from Actual reasons', () => {
  assert.strictEqual(classifyInitFailure(err({ code: 'EACCES', message: "mkdir '/home/someone/.actual'" })).cause, 'permission_denied');
  assert.strictEqual(classifyInitFailure(err({ code: 'ECONNREFUSED' })).cause, 'network_unreachable');
  assert.strictEqual(classifyInitFailure(err({ code: 'ETIMEDOUT' })).cause, 'timeout');
});

check('#438: SyncError `.reason` still works as a defensive fallback', () => {
  assert.strictEqual(classifyInitFailure(err({ reason: 'decrypt-failure' })).cause, 'encryption_error');
  assert.strictEqual(classifyInitFailure(err({ reason: 'missing-key' })).cause, 'encryption_error');
  assert.strictEqual(classifyInitFailure(err({ reason: 'clock-drift' })).cause, 'clock_drift');
});

check('#438: an unreachable server reads as network, not as bad credentials', () => {
  // Upstream reports an unreachable server as "Authentication failed:
  // network-failure". The actionable half is the network, so the network test
  // runs FIRST. This is the exact string the end-to-end reproduction produces.
  assert.strictEqual(classifyInitFailure(new Error('Authentication failed: network-failure')).cause, 'network_unreachable');
  assert.strictEqual(classifyInitFailure(new Error('Authentication failed: invalid-password')).cause, 'auth_failed');
});

check('#438: the classifier is TOTAL and never throws', () => {
  // It runs inside a branch enclosed by the outer POST catch, which returns raw
  // String(err) (see #446). A classifier that threw would egress through exactly
  // the hole this ticket declines to fix.
  const hostile = [
    ['null', null], ['undefined', undefined], ['0', 0], ['empty string', ''], ['a string', 'a string'],
    ['array', []], ['plain object', {}], ['empty Error', new Error('')],
    // A null-prototype object cannot even be stringified for an assertion
    // message, which is why each input is LABELLED rather than interpolated.
    ['null-prototype object', Object.create(null)],
    ['object with a throwing getter', { get code() { throw new Error('hostile getter'); } }],
  ];
  for (const [label, input] of hostile) {
    const out = classifyInitFailure(input);
    assert.ok(typeof out.cause === 'string' && typeof out.sentence === 'string', `total for ${label}`);
  }
});

check('#438: every cause carries a non-empty, actionable sentence', () => {
  const seen = new Set();
  for (const e of [
    err({ code: 'invalid-schema' }), err({ code: 'budget-not-found' }), err({ code: 'out-of-sync-data' }),
    err({ code: 'EACCES' }), err({ code: 'ETIMEDOUT' }), err({ reason: 'clock-drift' }),
    err({ reason: 'encrypt-failure' }), new Error('Authentication failed: invalid-password'),
    new Error('network-failure'), null,
  ]) {
    const { cause, sentence } = classifyInitFailure(e);
    assert.ok(sentence.length > 20, `${cause} needs a real sentence`);
    seen.add(cause);
  }
  assert.ok(seen.size >= 9, `expected most of the enum to be exercised, saw ${seen.size}`);
});

// --- 2. source guards for what a call cannot observe --------------------------

/** The two #438 response blocks, extracted so the assertions below are about
 *  THIS feature rather than about the file as a whole. */
function initFailureBlocks() {
  const blocks = [];
  const re = /knownFailure\s*\?[\s\S]{0,600}?\}|if \(knownFailure\) \{[\s\S]*?\n          \}/g;
  let m;
  while ((m = re.exec(source)) !== null) blocks.push(m[0]);
  return blocks;
}

check('#438: WIRE CONTRACT: no upstream-derived string can reach the payload', () => {
  // The whole point of the closed enum: if nothing upstream reaches the wire,
  // no scrubber has to be correct. Upstream strings can carry a stack, raw SQL
  // from SyncError.meta.query, an EACCES path with the OS username, and the
  // configured server URL.
  const blocks = initFailureBlocks();
  assert.ok(blocks.length >= 2, `expected the POST and GET response blocks, found ${blocks.length}`);
  for (const b of blocks) {
    assert.ok(!/String\(err/.test(b), 'no String(err) in a #438 response');
    assert.ok(!/\berr\.message\b|\berror\.message\b/.test(b), 'no upstream message in a #438 response');
    assert.ok(/knownFailure\.(sentence|cause)/.test(b), 'the payload is built from the classification only');
  }
});

check('#438: the record is BOUNDED, so a persistent upstream failure cannot leak memory', () => {
  // A failed init creates no pool entry, so onSessionEvicted never fires for
  // these and nothing else would ever reap them.
  assert.ok(/INIT_FAILURE_TTL_MS\s*=\s*60_000/.test(source), 'a 60s TTL');
  assert.ok(/INIT_FAILURE_MAX\s*=\s*1000/.test(source), 'a 1000-entry cap');
  assert.ok(/sessionInitFailures\.clear\(\)/.test(source), 'cleared on shutdown beside its two siblings');
});

check('#438: the read is PEEK-ONLY, never consume', () => {
  // Consume-on-read would race: two concurrent requests on one session id (a
  // discovery client firing tools/list and tools/call together) would fight over
  // the single record and the loser would silently get the generic 404,
  // restoring this ticket's own bug non-deterministically.
  const peek = /const peekInitFailure[\s\S]*?\n  \};/.exec(source);
  assert.ok(peek, 'peekInitFailure exists');
  assert.ok(!/\.delete\(/.test(peek[0]), 'peek must not delete: the TTL is the sole reaper');
});

check('#438: both call sites are CONTAINED by their own try/catch', () => {
  // POST: a throw would land on the outer catch and egress as raw String(err).
  // GET: that route has NO try/catch and the file registers no error-handling
  // middleware, so under Express 5 a throw reaches the default final handler,
  // which puts err.stack in the body whenever NODE_ENV is not production. That
  // is unset for a bare node run and is `development` in docker-compose.
  const guarded = source.match(/try \{\s*\n\s*knownFailure = peekInitFailure\(sessionId\);\s*\n\s*\}\s*catch/g) ?? [];
  assert.strictEqual(guarded.length, 2, `both lookups guarded, found ${guarded.length}`);
});

check('#438: exactly ONE lookup per request, before the discovery shim', () => {
  // Two lookups in one request would break single-read semantics, and answering
  // 200 plus a full tool list to a session whose connection never came up is the
  // same masking in a friendlier costume.
  const post = /if \(!transport\) \{[\s\S]*?LOBECHAT COMPAT\] Handling tools\/list with expired/.exec(source);
  assert.ok(post, 'found the POST not-found block up to the shim');
  assert.strictEqual((post[0].match(/peekInitFailure\(/g) ?? []).length, 1, 'exactly one lookup');
  assert.ok(post[0].indexOf('peekInitFailure(') < post[0].indexOf('LOBECHAT COMPAT'), 'lookup precedes the shim');
});

check('#438: the failure is RECORDED where it is already known and was thrown away', () => {
  // The wiring, which no classifier call can observe. Without this the feature is
  // inert: the classifier is perfect and never runs. The end-to-end reproduction
  // covers it too (closed-port boot, network_unreachable reported), but that
  // harness is a scratchpad artifact and does not run in CI, so the guard lives
  // here. Deliberately checked INSIDE the init catch, not merely present in the
  // file, since a call anywhere else would not populate the record.
  // Anchored on the catch's OWN log line, not on the file's first `catch (err)`:
  // a non-greedy match from there spans hundreds of lines and swallows the
  // success path, which made the transport assertion below fail against correct
  // code the first time this guard was written.
  const catchBlock = /Failed to initialize Actual for session[\s\S]*?rejectInit\?\.\(err\);/.exec(source);
  assert.ok(catchBlock, 'found the session-init catch');
  assert.ok(/rememberInitFailure\(sid, err\)/.test(catchBlock[0]),
    'the init catch must record the cause; it already had the error and discarded it');
  assert.ok(!/transports\.set\(sid/.test(catchBlock[0]),
    'and must still NOT register the transport: dead-session accumulation stays prevented');
});

check('#438: the deferred #446 line is annotated, not silently left dirty', () => {
  // A clean new path beside a known-dirty old one must be deliberate and
  // traceable, or the next reader assumes the old one was reviewed and approved.
  const outer = /error: \{ code: -32603, message: String\(err\) \}/.exec(source);
  assert.ok(outer, 'the pre-existing raw-egress line still exists (out of scope here)');
  const before = source.slice(Math.max(0, outer.index - 500), outer.index);
  assert.ok(/#446/.test(before), 'annotated with the ticket that owns it');
  assert.ok(/CONTAINED|contained/.test(before), 'and states that the #438 path never reaches it');
});

console.log(`\n[#438] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
