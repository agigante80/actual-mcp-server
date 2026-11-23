// tests/unit/advertised_url.test.js
//
// #777: the address /mcp-info advertises. The Host header is attacker controlled, so the pure
// function must accept only a host name, IPv4 or bracketed IPv6 literal with an optional port,
// never echo anything else, and never fall back to the internal startup address. Also pins
// bearerChallenge(): a fixed RFC 6750 shaped value that never carries a request value.
//
// Run: node tests/unit/advertised_url.test.js

import assert from 'node:assert';
import { advertisedUrlFor, validatedHost } from '../../dist/src/lib/advertised-url.js';
import { bearerChallenge } from '../../dist/src/auth/bearer.js';

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (e) { console.error(`  FAIL: ${label}\n    ${e.message}`); failed++; }
}

const STARTUP = 'http://172.18.0.4:3600/http';
const base = { publicHostConfigured: false, startupUrl: STARTUP, fallbackScheme: 'http', httpPath: '/http', configuredFallbackUrl: 'http://fallback:1/http' };
const url = (hostHeader, extra = {}) => advertisedUrlFor({ ...base, hostHeader, ...extra });

console.log('\n[advertised-url] valid Host headers');
check('host with port keeps the caller port and the startup scheme and path', () => assert.strictEqual(url('localhost:3601'), 'http://localhost:3601/http'));
check('host without a port', () => assert.strictEqual(url('mcp.example.test'), 'http://mcp.example.test/http'));
check('uppercase host is lowercased', () => assert.strictEqual(url('LocalHost:3601'), 'http://localhost:3601/http'));
check('IPv4 literal', () => assert.strictEqual(url('192.168.1.5:8080'), 'http://192.168.1.5:8080/http'));
check('bracketed IPv6 literal with port', () => assert.strictEqual(url('[::1]:3601'), 'http://[::1]:3601/http'));
check('bracketed IPv6 literal without port', () => assert.strictEqual(url('[fe80::1]'), 'http://[fe80::1]/http'));
check('port 65535 is accepted', () => assert.strictEqual(url('a:65535'), 'http://a:65535/http'));
check('the startup URL scheme and path are honoured (https, custom path)', () =>
  assert.strictEqual(url('localhost:3601', { startupUrl: 'https://10.0.0.2:3600/custom' }), 'https://localhost:3601/custom'));
check('an unparseable startup URL falls back to the scheme and path arguments', () =>
  assert.strictEqual(url('localhost:3601', { startupUrl: 'not a url', fallbackScheme: 'https', httpPath: '/p' }), 'https://localhost:3601/p'));
check('an undefined startup URL falls back to the scheme and path arguments', () =>
  assert.strictEqual(url('localhost:3601', { startupUrl: undefined }), 'http://localhost:3601/http'));
check('a host header of 260 characters is accepted', () => {
  const h = 'a'.repeat(255) + ':3601';
  assert.strictEqual(h.length, 260);
  assert.ok(url(h) !== undefined);
});

console.log('\n[advertised-url] hostile or invalid Host headers yield undefined (never echoed, never the startup address)');
const bad = {
  'path': 'evil.test/../admin',
  'space': 'a b',
  'userinfo': 'x@y',
  'userinfo with port': 'user:pass@host:80',
  'port above 65535': 'host:99999',
  'port zero': 'host:0',
  'empty port': 'host:',
  'empty': '',
  'CR': 'evil.test\rX-Injected: 1',
  'LF': 'evil.test\nX-Injected: 1',
  'CRLF': 'evil.test\r\nSet-Cookie: a=b',
  'NUL': 'evil\u0000.test',
  'tab': 'evil\t.test',
  'scheme': 'http://evil.test',
  'query': 'evil.test?x=1',
  'fragment': 'evil.test#x',
  'backslash': 'evil.test\\x',
  'leading dot': '.evil.test',
  'trailing dash': 'evil-',
  'unterminated IPv6': '[::1',
  'IPv6 without brackets': '::1',
  'IPv6 with a zone and junk': '[::1%25eth0]',
  'bracketed non-IPv6 (:::)': '[:::]:3601',
  'bracketed junk': '[1.2.3.4]',
  'oversized': 'a'.repeat(262),
  'oversized with port': 'a'.repeat(300) + ':80',
  'two ports': 'host:80:81',
  'html': '<script>',
};
for (const [name, value] of Object.entries(bad)) {
  check(`${name}: ${JSON.stringify(value.slice(0, 30))} -> undefined`, () => {
    assert.strictEqual(url(value), undefined);
    assert.strictEqual(validatedHost(value), undefined);
  });
}
check('a missing header (undefined) -> undefined', () => assert.strictEqual(url(undefined), undefined));
check('a non-string header -> undefined', () => assert.strictEqual(url(['a', 'b']), undefined));
check('a rejected Host never yields the startup URL or its internal address', () => {
  const out = String(url('evil.test/../admin'));
  assert.ok(!out.includes('172.18.0.4') && !out.includes('evil'));
});

console.log('\n[advertised-url] a configured public host keeps today\'s value');
check('configured + startup URL: the startup URL, whatever the Host says', () =>
  assert.strictEqual(url('localhost:3601', { publicHostConfigured: true, startupUrl: 'https://mcp.example.test:3600/http' }), 'https://mcp.example.test:3600/http'));
check('configured + a hostile Host: still the startup URL', () =>
  assert.strictEqual(url('evil.test/x', { publicHostConfigured: true, startupUrl: 'https://mcp.example.test:3600/http' }), 'https://mcp.example.test:3600/http'));
check('configured + no startup URL: the caller supplied expression', () =>
  assert.strictEqual(url(undefined, { publicHostConfigured: true, startupUrl: undefined }), 'http://fallback:1/http'));

console.log('\n[advertised-url] bearerChallenge');
check('no options: the realm only', () => assert.strictEqual(bearerChallenge(), 'Bearer realm="actual-mcp-server"'));
check('invalid_request', () => assert.strictEqual(bearerChallenge({ error: 'invalid_request' }), 'Bearer realm="actual-mcp-server", error="invalid_request"'));
check('invalid_token', () => assert.strictEqual(bearerChallenge({ error: 'invalid_token' }), 'Bearer realm="actual-mcp-server", error="invalid_token"'));
check('metadata URL with no error', () =>
  assert.strictEqual(bearerChallenge({ metadataUrl: 'https://x.test/.well-known/oauth-protected-resource/http' }),
    'Bearer realm="actual-mcp-server", resource_metadata="https://x.test/.well-known/oauth-protected-resource/http"'));

console.log(`\n[advertised-url] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
