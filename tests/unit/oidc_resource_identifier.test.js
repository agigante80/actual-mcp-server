// tests/unit/oidc_resource_identifier.test.js
//
// #461: OIDC_RESOURCE must be an absolute http(s) URL, because mcp-auth derives the
// RFC 9728 well-known route from its pathname and echoes it verbatim as the metadata
// `resource`. Four of our own recipes said `OIDC_RESOURCE=your-client-id`, which dies
// inside the library at startup. This file covers the PURE module: the validator, the
// scheme and query advisories, the advertised-path derivation (with its fallback for an
// advertised URL that does not parse) and the metadata warning. It also proves, against
// the REAL mcp-auth, that the route follows the identifier's path. The server-boot
// assertions live in httpServer_oidc_resource_metadata.test.js.
//
// Every positive assertion is paired with a mutated fixture that must FAIL, so a
// validator that accepts everything, or a warning that fires for nothing, cannot pass.
//
// Run: node tests/unit/oidc_resource_identifier.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { MCPAuth } from 'mcp-auth';
import {
  validateOidcResource,
  resourceSchemeAdvisories,
  advertisedPathFrom,
  resourceMetadataWarning,
  oidcResourceStartupWarnings,
} from '../../dist/src/lib/oidc-resource.js';
import { buildAcceptedAudiences } from '../../dist/src/lib/oidc-audiences.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
const throwsWith = (fn, ...needles) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  assert.ok(msg !== null, 'expected a throw, got none');
  for (const n of needles) assert.ok(msg.includes(n), `message lacks "${n}": ${msg}`);
  return msg;
};

console.log('\n[oidc-resource] #461 validator');

check('a bare client id is rejected, naming the variable and the requirement', () => {
  throwsWith(() => validateOidcResource('my-client-id'), 'OIDC_RESOURCE', 'absolute URL');
});
check('undefined is rejected naming the variable (setup.ts checks unset first, this is the fallback)', () => {
  throwsWith(() => validateOidcResource(undefined), 'OIDC_RESOURCE');
});
check('https://host/http is accepted and returned parsed', () => {
  const u = validateOidcResource('https://host/http');
  assert.strictEqual(u.pathname, '/http');
  assert.strictEqual(u.origin, 'https://host');
});
check('http on loopback is accepted with no scheme advisory', () => {
  const u = validateOidcResource('http://127.0.0.1:3701/http');
  assert.deepStrictEqual(resourceSchemeAdvisories(u), []);
});
check('http on a non-loopback host is accepted with one scheme advisory', () => {
  const u = validateOidcResource('http://192.168.1.10/http');
  const adv = resourceSchemeAdvisories(u);
  assert.strictEqual(adv.length, 1);
  assert.ok(/plaintext http/.test(adv[0]), adv[0]);
});
check('a non-http scheme is rejected', () => {
  throwsWith(() => validateOidcResource('ftp://host/http'), 'OIDC_RESOURCE', 'http(s)');
});
check('a fragment is rejected', () => {
  throwsWith(() => validateOidcResource('https://host/http#frag'), 'OIDC_RESOURCE', 'fragment');
});
check('embedded credentials are rejected and the secret is NOT echoed', () => {
  const msg = throwsWith(() => validateOidcResource('https://u:s3cr3t@host/http'), 'OIDC_RESOURCE', 'credentials');
  assert.ok(!msg.includes('s3cr3t'), `secret leaked into the message: ${msg}`);
});
check('surrounding whitespace is rejected (mcp-auth would echo the padded string verbatim)', () => {
  throwsWith(() => validateOidcResource(' https://host/http '), 'OIDC_RESOURCE', 'whitespace');
});
check('a query component is accepted with one advisory that does not echo the query', () => {
  const u = validateOidcResource('https://host/http?x=1');
  const adv = resourceSchemeAdvisories(u);
  assert.strictEqual(adv.length, 1);
  assert.ok(/query/.test(adv[0]), adv[0]);
  assert.ok(!adv[0].includes('x=1'), `query echoed: ${adv[0]}`);
});
check('MUTATION: the validator can fail (a valid URL must not throw)', () => {
  assert.doesNotThrow(() => validateOidcResource('https://actual-mcp.example.com/http'));
});

console.log('\n[oidc-resource] #461 advertised path derivation');

check('undefined advertised URL falls back to the listen path with no warning', () => {
  assert.deepStrictEqual(advertisedPathFrom(undefined, '/http'), { path: '/http', warning: null });
});
check('a parseable advertised URL yields its pathname (reverse-proxy shape)', () => {
  assert.deepStrictEqual(advertisedPathFrom('https://host:3600/mcp', '/http'), { path: '/mcp', warning: null });
});
check('an unparseable advertised URL (MCP_BRIDGE_HTTP_PATH without a leading slash) falls back and warns without echoing it', () => {
  const r = advertisedPathFrom('http://10.0.0.5:3600mcp', '/http');
  assert.strictEqual(r.path, '/http');
  assert.ok(r.warning && r.warning.includes('MCP_BRIDGE_HTTP_PATH'), String(r.warning));
  assert.ok(!r.warning.includes('3600mcp'), `malformed URL echoed: ${r.warning}`);
});

console.log('\n[oidc-resource] #461 metadata warning');

check('origin form with the default path warns and recommends the endpoint form', () => {
  const w = resourceMetadataWarning({ resource: 'https://host', advertisedPath: '/http' });
  assert.ok(w && w.includes('https://host/http'), String(w));
  assert.ok(w.includes('OIDC_RESOURCE'), w);
});
check('endpoint form with the default path is silent', () => {
  assert.strictEqual(resourceMetadataWarning({ resource: 'https://host/http', advertisedPath: '/http' }), null);
});
check('a reverse-proxied deployment whose identifier matches the ADVERTISED path is not warned about', () => {
  assert.strictEqual(resourceMetadataWarning({ resource: 'https://host/mcp', advertisedPath: '/mcp' }), null);
});
check('a reverse-proxied deployment with the listen-path identifier is told the advertised path, never /http', () => {
  const w = resourceMetadataWarning({ resource: 'https://host/http', advertisedPath: '/mcp' });
  assert.ok(w && w.includes('OIDC_RESOURCE=https://host/mcp'), String(w));
  assert.ok(!/Recommended: OIDC_RESOURCE=https:\/\/host\/http\b/.test(w), w);
});
check('a trailing slash on the identifier is named as the only difference, with the audience hazard, and the no-slash form recommended', () => {
  const w = resourceMetadataWarning({ resource: 'https://host/http/', advertisedPath: '/http' });
  assert.ok(w && /trailing slash/.test(w), String(w));
  assert.ok(/accepted audience/.test(w), w);
  assert.ok(w.endsWith('OIDC_RESOURCE=https://host/http'), w);
});
check('a trailing slash on the ADVERTISED path never produces a slash recommendation, and the canonical identifier is silent', () => {
  assert.strictEqual(resourceMetadataWarning({ resource: 'https://host/http', advertisedPath: '/http/' }), null);
  const w = resourceMetadataWarning({ resource: 'https://host', advertisedPath: '/http/' });
  assert.ok(w && w.endsWith('OIDC_RESOURCE=https://host/http'), String(w));
});
check('the origin-form warning names the migration mitigation (keep the old aud accepted while switching)', () => {
  const w = resourceMetadataWarning({ resource: 'https://host', advertisedPath: '/http' });
  assert.ok(w && w.includes('OIDC_ACCEPTED_AUDIENCES=https://host'), String(w));
});
check('MUTATION: the warning can fail (a different path really warns)', () => {
  assert.notStrictEqual(resourceMetadataWarning({ resource: 'https://host/other', advertisedPath: '/http' }), null);
});

console.log('\n[oidc-resource] #461 composition entry point');

check('endpoint form, matching advertised URL: no warnings at all', () => {
  assert.deepStrictEqual(
    oidcResourceStartupWarnings({ resource: 'https://host/http', advertisedUrl: 'https://host:3600/http', httpPath: '/http' }),
    [],
  );
});
check('origin form, no advertised URL: exactly one warning naming the endpoint form', () => {
  const ws = oidcResourceStartupWarnings({ resource: 'https://host', advertisedUrl: undefined, httpPath: '/http' });
  assert.strictEqual(ws.length, 1, JSON.stringify(ws));
  assert.ok(ws[0].includes('https://host/http'), ws[0]);
});
check('an invalid resource still throws through the entry point (it is not an advisory)', () => {
  throwsWith(() => oidcResourceStartupWarnings({ resource: 'my-client-id', advertisedUrl: undefined, httpPath: '/http' }), 'absolute URL');
});

console.log('\n[oidc-resource] #461 the accepted audience is the RAW string (no url.href trailing slash)');

check('origin form: buildAcceptedAudiences holds exactly the configured string', () => {
  assert.deepStrictEqual(buildAcceptedAudiences('https://host', undefined), ['https://host']);
});

console.log('\n[oidc-resource] #461 route derivation against the real mcp-auth');

async function metadataFor(resource) {
  const mcpAuth = new MCPAuth({
    protectedResources: [{ metadata: { resource, authorizationServers: [{ issuer: 'https://idp.example.com', type: 'oidc' }], scopesSupported: [] } }],
  });
  const router = mcpAuth.protectedResourceMetadataRouter();
  const routes = router.stack.filter((l) => l.route).map((l) => l.route.path);
  const app = express();
  app.use(router);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address();
  const bodies = {};
  for (const p of routes) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    bodies[p] = await res.json();
  }
  await new Promise((r) => srv.close(r));
  return { routes, bodies };
}

{
  const ep = await metadataFor('https://host/http');
  check('https://host/http is served ONLY at the path-specific route, resource identical (RFC 9728 3.1 and 3.3)', () => {
    assert.deepStrictEqual(ep.routes, ['/.well-known/oauth-protected-resource/http']);
    assert.strictEqual(ep.bodies['/.well-known/oauth-protected-resource/http'].resource, 'https://host/http');
  });
  const origin = await metadataFor('https://host');
  check('https://host is served ONLY at the root route, resource exactly https://host (no trailing slash)', () => {
    assert.deepStrictEqual(origin.routes, ['/.well-known/oauth-protected-resource']);
    assert.strictEqual(origin.bodies['/.well-known/oauth-protected-resource'].resource, 'https://host');
  });
  check('MUTATION: a bare client id makes the real library throw (the failure this ticket makes legible)', () => {
    let msg = null;
    try {
      new MCPAuth({ protectedResources: [{ metadata: { resource: 'my-client-id', authorizationServers: [{ issuer: 'https://idp.example.com', type: 'oidc' }], scopesSupported: [] } }] })
        .protectedResourceMetadataRouter();
    } catch (e) { msg = e.message; }
    assert.ok(msg && msg.includes('Invalid resource identifier URI'), String(msg));
  });
}

console.log('\n[oidc-resource] #461 purity');

check('src/lib/oidc-resource.ts imports nothing from config, logger or auth', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'oidc-resource.ts'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepStrictEqual(imports, ['./oidc-discovery.js'], `imports: ${imports.join(', ')}`);
  assert.ok(!/config\.js|logger\.js|\/auth\//.test(src), 'module reaches into config, logger or auth');
});

console.log(`\n[oidc-resource] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
