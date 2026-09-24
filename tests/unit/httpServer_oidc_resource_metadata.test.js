// tests/unit/httpServer_oidc_resource_metadata.test.js
//
// #461: the RUNTIME half of the OIDC_RESOURCE work. It boots the REAL startHttpServer in
// AUTH_PROVIDER=oidc and asserts, over HTTP, what a standards client actually sees:
//
//   - the RFC 9728 protected-resource document is served at the path-specific well-known
//     URL when OIDC_RESOURCE carries the endpoint path, with `resource` IDENTICAL to the
//     configured string (section 3.3), and the 401 WWW-Authenticate names that URL;
//   - the origin form still starts, serves only the root document (resource exactly the
//     origin, no url.href trailing slash), 404s the path form, and logs ONE warning that
//     recommends the endpoint form built from the ADVERTISED path;
//   - the audience allowlist is unchanged: a signature-valid token for the origin is
//     rejected when the identifier is the endpoint form, and a client-id audience is
//     accepted only once OIDC_ACCEPTED_AUDIENCES names it (#160, #245 preserved);
//   - a query component never reaches a log line, and an unparseable advertised URL
//     (MCP_BRIDGE_HTTP_PATH without a leading slash) is an advisory, not a refusal.
//
// ONE CHILD PROCESS PER VARIANT, deliberately. src/config.ts parses process.env once at
// module load and src/auth/setup.ts memoises the MCPAuth instance with no reset export,
// so a second boot in the same process would silently reuse the FIRST resource: every
// variant would pass for the wrong reason. Pattern: server_version_guard.test.js.
//
// The child installs a URL-dispatching fetch stub BEFORE importing the server: requests
// to the stub issuer answer discovery and JWKS from memory (discoverOidcMetadata and
// jose's createRemoteJWKSet both resolve the global fetch at call time), everything else
// (the child's own loopback requests) falls through to the real fetch. No live IdP.
//
// The child reports through process.stdout.write with a sentinel, never console.log:
// src/logger.ts reassigns console.* into winston at load, and in HTTP mode winston
// writes EVERY level to stdout (stderrLevels is only set under MCP_STDIO_MODE), so the
// warning assertions read stdout too and stderr is expected to be empty of log lines.
//
// Run: node tests/unit/httpServer_oidc_resource_metadata.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISSUER = 'https://idp.test';
const SENTINEL = '__OIDC_RESULT__ ';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// The inline child. Everything it needs comes from env: OIDC_RESOURCE and the advertised
// path via the same variables production uses, plus T_* knobs for the requests to make.
const CHILD = `
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
const ISSUER = ${JSON.stringify(ISSUER)};
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey); jwk.alg = 'RS256'; jwk.kid = 'k1';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (u.startsWith(ISSUER + '/')) {
    if (u.endsWith('/.well-known/openid-configuration')) {
      return Response.json({ issuer: ISSUER, jwks_uri: ISSUER + '/jwks', userinfo_endpoint: ISSUER + '/userinfo',
        authorization_endpoint: ISSUER + '/authorize', token_endpoint: ISSUER + '/token', response_types_supported: ['code'] });
    }
    if (u.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    return new Response('not stubbed: ' + u, { status: 404 });
  }
  return realFetch(input, init);
};
const httpPath = process.env.T_HTTP_PATH || '/http';
const advertisedUrl = process.env.T_ADVERTISED_URL || undefined;
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const { listener, cleanup } = await startHttpServer({}, 0, httpPath, {}, [], 'desc', 'instr', {}, 'test', '127.0.0.1', advertisedUrl);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const base = 'http://127.0.0.1:' + listener.address().port;
const results = { base };
const meta = async (p) => { const r = await realFetch(base + p); return { status: r.status, body: r.status === 200 ? await r.json() : null, cors: r.headers.get('access-control-allow-origin') }; };
const preflight = async (p) => { const r = await realFetch(base + p, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' } });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin') }; };
results.metaPath = await meta('/.well-known/oauth-protected-resource' + httpPath);
results.metaRoot = await meta('/.well-known/oauth-protected-resource');
results.metaOther = await meta('/.well-known/oauth-protected-resource/not-our-path');
results.metaQuery = await meta('/.well-known/oauth-protected-resource?query=1');
results.preflightRoot = await preflight('/.well-known/oauth-protected-resource');
results.preflightPath = await preflight('/.well-known/oauth-protected-resource' + httpPath);
if (process.env.T_EXTRA_META) results.metaExtra = await meta(process.env.T_EXTRA_META);
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
const post = async (headers) => { const r = await realFetch(base + httpPath, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  return { status: r.status, wwwAuthenticate: r.headers.get('www-authenticate') }; };
results.unauth = await post({});
if (process.env.T_TOKEN_AUD) {
  const token = await new SignJWT({ scope: 'openid' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(process.env.T_TOKEN_AUD).setSubject('user-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  results.withToken = await post({ Authorization: 'Bearer ' + token });
}
await new Promise((r) => listener.close(r));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(results) + '\\n');
process.exit(0);
`;

function boot(env, label) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: ROOT,
    env: {
      ...process.env,
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_PASSWORD: 'stub-password-for-unit-test',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      AUTH_PROVIDER: 'oidc',
      OIDC_ISSUER: ISSUER,
      MCP_BRIDGE_HTTP_PATH: undefined,
      OIDC_ACCEPTED_AUDIENCES: undefined,
      ...env,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  const lines = (child.stdout || '').split('\n');
  const resultLines = lines.filter((l) => l.startsWith(SENTINEL));
  const logLines = lines.filter((l) => l && !l.startsWith(SENTINEL));
  const warnings = logLines.filter((l) => /\[OIDC\] (OIDC_RESOURCE|The advertised MCP URL)/.test(l));
  return {
    label, status: child.status, signal: child.signal, stdout: child.stdout || '', stderr: child.stderr || '',
    result: resultLines.length === 1 ? JSON.parse(resultLines[0].slice(SENTINEL.length)) : null,
    resultLines: resultLines.length, warnings,
  };
}
const booted = (r) => {
  assert.strictEqual(r.signal, null, `${r.label}: child hung (timeout) or was signalled`);
  assert.strictEqual(r.status, 0, `${r.label}: child exited ${r.status}\n${r.stderr.slice(-1500)}\n${r.stdout.slice(-1500)}`);
  assert.strictEqual(r.resultLines, 1, `${r.label}: expected exactly one sentinel line, got ${r.resultLines}`);
};

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenarios 1 and 2: endpoint form (#473 root discovery rewrite)');
{
  const r = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com/http' }, 'endpoint form');
  check('server boots with the endpoint form and reports', () => booted(r));
  check('GET /.well-known/oauth-protected-resource/http is 200 with resource IDENTICAL to OIDC_RESOURCE and the issuer listed', () => {
    assert.strictEqual(r.result.metaPath.status, 200);
    assert.strictEqual(r.result.metaPath.body.resource, 'https://actual-mcp.example.com/http');
    assert.ok(r.result.metaPath.body.authorization_servers.includes(ISSUER), JSON.stringify(r.result.metaPath.body));
  });
  check('the root document IS served for the endpoint form, deep-equal to path-specific document (#473)', () => {
    assert.strictEqual(r.result.metaRoot.status, 200);
    assert.deepStrictEqual(r.result.metaRoot.body, r.result.metaPath.body);
    assert.strictEqual(r.result.metaRoot.cors, r.result.metaPath.cors);
  });
  check('root query string is preserved during rewrite (#473)', () => {
    assert.strictEqual(r.result.metaQuery.status, 200);
    assert.deepStrictEqual(r.result.metaQuery.body, r.result.metaPath.body);
  });
  check('OPTIONS CORS preflight on root returns CORS headers matching path-specific route (#473)', () => {
    assert.strictEqual(r.result.preflightRoot.status, 204);
    assert.strictEqual(r.result.preflightRoot.cors, '*');
    assert.strictEqual(r.result.preflightRoot.cors, r.result.preflightPath.cors);
  });
  check('only the exact root path is rewritten: /not-our-path remains 404 (#473)', () => {
    assert.strictEqual(r.result.metaOther.status, 404);
  });
  check('unauthenticated POST is 401 and WWW-Authenticate names the path-specific metadata URL', () => {
    assert.strictEqual(r.result.unauth.status, 401);
    assert.ok(String(r.result.unauth.wwwAuthenticate).includes('resource_metadata="https://actual-mcp.example.com/.well-known/oauth-protected-resource/http"'),
      String(r.result.unauth.wwwAuthenticate));
  });
  check('no OIDC_RESOURCE warning is logged for the endpoint form', () => {
    assert.deepStrictEqual(r.warnings, []);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 3: origin form');
{
  const r = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com' }, 'origin form');
  check('server still boots with the origin form', () => booted(r));
  check('root document is 200 with resource EXACTLY the origin (no url.href trailing slash)', () => {
    assert.strictEqual(r.result.metaRoot.status, 200);
    assert.strictEqual(r.result.metaRoot.body.resource, 'https://actual-mcp.example.com');
  });
  check('the path-specific document is 404 (this is what the warning is about)', () => {
    assert.strictEqual(r.result.metaPath.status, 404);
  });
  check('exactly one warning, naming OIDC_RESOURCE and recommending the endpoint form', () => {
    assert.strictEqual(r.warnings.length, 1, r.warnings.join('\n'));
    assert.ok(r.warnings[0].includes('OIDC_RESOURCE=https://actual-mcp.example.com/http'), r.warnings[0]);
  });
  check('stderr carries no log lines (HTTP mode logs to stdout; the assertions above read the right stream)', () => {
    assert.ok(!/\[OIDC\]/.test(r.stderr), r.stderr.slice(0, 300));
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 4: the README recipe is refused legibly');
{
  const r = boot({ OIDC_RESOURCE: 'my-client-id' }, 'client id');
  check('the child does NOT boot', () => {
    assert.strictEqual(r.signal, null, 'child hung');
    assert.notStrictEqual(r.status, 0, 'a bare client id must refuse to start');
  });
  check('the failure names OIDC_RESOURCE and "absolute URL", and is NOT the library TypeError', () => {
    const out = r.stdout + r.stderr;
    assert.ok(out.includes('OIDC_RESOURCE') && out.includes('absolute URL'), out.slice(-600));
    assert.ok(!out.includes('Invalid resource identifier URI'), 'the mcp-auth TypeError surfaced instead of ours');
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 5: the audience allowlist is unchanged');
{
  const r = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com/http', T_TOKEN_AUD: 'https://actual-mcp.example.com' }, 'aud=origin');
  check('a signature-valid token for the ORIGIN is rejected when the identifier is the endpoint form', () => {
    booted(r);
    assert.strictEqual(r.result.withToken.status, 401, JSON.stringify(r.result.withToken));
    assert.ok(r.result.withToken.wwwAuthenticate, 'WWW-Authenticate missing on the 401');
  });
  const c = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com/http', T_TOKEN_AUD: 'my-client-id' }, 'aud=client-id, not accepted');
  check('a client-id audience is rejected without OIDC_ACCEPTED_AUDIENCES', () => {
    booted(c);
    assert.strictEqual(c.result.withToken.status, 401, JSON.stringify(c.result.withToken));
  });
  const a = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com/http', OIDC_ACCEPTED_AUDIENCES: 'my-client-id', T_TOKEN_AUD: 'my-client-id' }, 'aud=client-id, accepted');
  check('the same token is accepted (sessionless tools/list -> 200) once OIDC_ACCEPTED_AUDIENCES names it (#245)', () => {
    booted(a);
    assert.strictEqual(a.result.withToken.status, 200, JSON.stringify(a.result.withToken));
  });
  const g = boot({ OIDC_RESOURCE: 'https://actual-mcp.example.com/http', T_TOKEN_AUD: 'https://actual-mcp.example.com/http' }, 'aud=resource');
  check('MUTATION: the correct audience IS accepted, so the 401s above are audience decisions, not a broken stub', () => {
    booted(g);
    assert.strictEqual(g.result.withToken.status, 200, JSON.stringify(g.result.withToken));
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenarios 6 and 7: the advertised path, not a literal /http');
{
  const r = boot({ OIDC_RESOURCE: 'https://host/mcp', T_HTTP_PATH: '/mcp' }, 'listen path /mcp');
  check('MCP_HTTP_PATH=/mcp with the matching identifier serves the /mcp document and warns about nothing', () => {
    booted(r);
    assert.strictEqual(r.result.metaPath.status, 200);
    assert.strictEqual(r.result.metaPath.body.resource, 'https://host/mcp');
    assert.strictEqual(r.result.metaRoot.status, 200);
    assert.deepStrictEqual(r.result.metaRoot.body, r.result.metaPath.body);
    assert.deepStrictEqual(r.warnings, []);
  });
  const p = boot({ OIDC_RESOURCE: 'https://host/mcp', T_ADVERTISED_URL: 'https://host/mcp', T_EXTRA_META: '/.well-known/oauth-protected-resource/mcp' }, 'proxied /mcp');
  check('reverse proxy: listen /http, advertised /mcp, identifier /mcp: no warning and the /mcp document is served', () => {
    booted(p);
    assert.deepStrictEqual(p.warnings, []);
    assert.strictEqual(p.result.metaExtra.status, 200);
    assert.strictEqual(p.result.metaExtra.body.resource, 'https://host/mcp');
  });
  const q = boot({ OIDC_RESOURCE: 'https://host/http', T_ADVERTISED_URL: 'https://host/mcp' }, 'proxied, listen-path identifier');
  check('reverse proxy with the listen-path identifier: exactly one warning naming /mcp, never recommending /http', () => {
    booted(q);
    assert.strictEqual(q.warnings.length, 1, q.warnings.join('\n'));
    assert.ok(q.warnings[0].includes('OIDC_RESOURCE=https://host/mcp'), q.warnings[0]);
    assert.ok(!q.warnings[0].includes('OIDC_RESOURCE=https://host/http'), q.warnings[0]);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 8: trailing slash');
{
  const r = boot({ OIDC_RESOURCE: 'https://host/http/', T_EXTRA_META: '/.well-known/oauth-protected-resource/http/' }, 'trailing slash');
  check('the slash form is its own identifier: served at /http/, resource verbatim, and the one warning names the trailing slash', () => {
    booted(r);
    assert.strictEqual(r.result.metaExtra.status, 200);
    assert.strictEqual(r.result.metaExtra.body.resource, 'https://host/http/');
    assert.strictEqual(r.warnings.length, 1, r.warnings.join('\n'));
    assert.ok(/trailing slash/.test(r.warnings[0]), r.warnings[0]);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 9: a query component never reaches a log');
{
  const r = boot({ OIDC_RESOURCE: 'https://host/http?x=1' }, 'query form');
  check('boots, exactly one query advisory, and NO line of stdout or stderr contains the query', () => {
    booted(r);
    const queryAdvisories = r.warnings.filter((l) => /query component/.test(l));
    assert.strictEqual(queryAdvisories.length, 1, r.warnings.join('\n'));
    const leaked = (r.stdout + '\n' + r.stderr).split('\n').filter((l) => !l.startsWith(SENTINEL) && l.includes('x=1'));
    assert.deepStrictEqual(leaked, [], `query echoed:\n${leaked.join('\n')}`);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 scenario 10: an unparseable advertised URL is an advisory, not a refusal');
{
  const r = boot({ OIDC_RESOURCE: 'https://host/http', T_ADVERTISED_URL: 'http://10.0.0.5:3600mcp' }, 'unparseable advertised URL');
  check('still boots, the /http document is served, and one warning names MCP_BRIDGE_HTTP_PATH without echoing the malformed URL', () => {
    booted(r);
    assert.strictEqual(r.result.metaPath.status, 200);
    assert.strictEqual(r.warnings.length, 1, r.warnings.join('\n'));
    assert.ok(r.warnings[0].includes('MCP_BRIDGE_HTTP_PATH'), r.warnings[0]);
    assert.ok(!r.warnings[0].includes('3600mcp'), r.warnings[0]);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[oidc-resource-metadata] #461 source: the OIDC block of httpServer.ts carries no literal /http');
check('between `mcpAuth = createMcpAuth()` and `mcpAuth.bearerAuth(` there is no hardcoded /http (the /mcp-info/http route elsewhere is legitimate)', () => {
  const src = readFileSync(join(ROOT, 'src', 'server', 'httpServer.ts'), 'utf8');
  const start = src.indexOf('mcpAuth = createMcpAuth()');
  const end = src.indexOf('mcpAuth.bearerAuth(');
  assert.ok(start > 0 && end > start, 'anchors not found; keep both literals intact');
  const block = src.slice(start, end);
  assert.ok(!/['"`]\/http['"`]/.test(block), 'a literal /http inside the OIDC block');
});

console.log(`\n[oidc-resource-metadata] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
