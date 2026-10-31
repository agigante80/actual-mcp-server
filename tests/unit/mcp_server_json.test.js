// #610: MCP Registry metadata. Calls the pure functions in scripts/mcp-server-json.mjs
// on mutated in-memory copies (so every negative can fail), plus one positive pass
// over the committed server.json, package.json and Dockerfile, and a static read of
// the two CI jobs in ci-cd.yml.
// Run: node tests/unit/mcp_server_json.test.js
import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { stampServerJson, checkRegistryMetadata, assertVersionsAgree, ENV_ALLOWLIST } = await import(
  '../../scripts/mcp-server-json.mjs'
);
const { canonicalConfigVars } = await import('../../dist/src/lib/config-registry.js');
const { configSchema } = await import('../../dist/src/config.js');

const SERVER = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const DOCKERFILE = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci-cd.yml'), 'utf8');
const CANONICAL = canonicalConfigVars(Object.keys(configSchema.shape));

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

const clone = (o) => structuredClone(o);
const pkgOf = (s, type) => s.packages.find((p) => p.registryType === type);
const problems = (over = {}) =>
  checkRegistryMetadata({ serverJson: SERVER, pkg: PKG, dockerfileText: DOCKERFILE, canonical: CANONICAL, ...over });
function reports(over, message) {
  const got = problems(over);
  assert.ok(got.includes(message), `expected "${message}", got ${JSON.stringify(got)}`);
}

console.log('[mcp-server-json] committed files');
check('checkRegistryMetadata finds no problems in the committed files', () => {
  assert.deepStrictEqual(problems(), []);
});
check('the committed server.json carries 0.0.0 in all three version slots', () => {
  assert.strictEqual(SERVER.version, '0.0.0');
  assert.strictEqual(pkgOf(SERVER, 'npm').version, '0.0.0');
  assert.ok(pkgOf(SERVER, 'oci').identifier.endsWith(':0.0.0'));
});

console.log('\n[mcp-server-json] stampServerJson');
check('stamp writes the version into all three slots and leaves its input alone', () => {
  const before = JSON.stringify(SERVER);
  const out = stampServerJson(SERVER, '1.2.3');
  assert.strictEqual(out.version, '1.2.3');
  assert.strictEqual(pkgOf(out, 'npm').version, '1.2.3');
  assert.strictEqual(pkgOf(out, 'oci').identifier, 'docker.io/agigante80/actual-mcp-server:1.2.3');
  assert.strictEqual(JSON.stringify(SERVER), before);
});
check('stamp refuses an OCI identifier with no tag', () => {
  const s = clone(SERVER);
  pkgOf(s, 'oci').identifier = 'docker.io/agigante80/actual-mcp-server';
  assert.throws(() => stampServerJson(s, '1.2.3'), { message: 'server.json: cannot stamp OCI package identifier: missing tag' });
});
check('stamp refuses a registry port with no tag (the colon is not a tag separator)', () => {
  const s = clone(SERVER);
  pkgOf(s, 'oci').identifier = 'registry.example:5000/actual-mcp-server';
  assert.throws(() => stampServerJson(s, '1.2.3'), { message: 'server.json: cannot stamp OCI package identifier: missing tag' });
});
check('stamp refuses a file with no OCI package', () => {
  const s = clone(SERVER);
  s.packages = s.packages.filter((p) => p.registryType !== 'oci');
  assert.throws(() => stampServerJson(s, '1.2.3'), { message: 'server.json: expected exactly one oci package, found 0' });
});

console.log('\n[mcp-server-json] assertVersionsAgree');
check('agreeing sources do not throw', () => {
  assertVersionsAgree({ expected: '1.2.3', versionFile: '1.2.3', pkgVersion: '1.2.3' });
});
check('a tag that disagrees with VERSION and package.json throws', () => {
  assert.throws(() => assertVersionsAgree({ expected: '1.2.4', versionFile: '1.2.3', pkgVersion: '1.2.3' }), {
    message: 'tag, VERSION and package.json disagree: 1.2.4 / 1.2.3 / 1.2.3',
  });
});
check('package.json alone disagreeing throws', () => {
  assert.throws(() => assertVersionsAgree({ expected: '1.2.3', versionFile: '1.2.3', pkgVersion: '1.2.2' }), {
    message: 'tag, VERSION and package.json disagree: 1.2.3 / 1.2.3 / 1.2.2',
  });
});

console.log('\n[mcp-server-json] declared environment variables');
check('each package declares exactly its allowlist, all canonical, secrets marked', () => {
  for (const type of ['npm', 'oci']) {
    const vars = pkgOf(SERVER, type).environmentVariables;
    assert.deepStrictEqual(new Set(vars.map((v) => v.name)), new Set(ENV_ALLOWLIST[type]), type);
    for (const v of vars) {
      assert.ok(CANONICAL.has(v.name), `${v.name} not canonical`);
      if (/PASSWORD|AUTHORIZATION|TOKEN/.test(v.name)) assert.strictEqual(v.isSecret, true, v.name);
    }
  }
});
check('the opt-out variables are not on either allowlist', () => {
  for (const type of ['npm', 'oci']) {
    assert.ok(!ENV_ALLOWLIST[type].includes('MCP_ALLOW_UNAUTHENTICATED'));
    assert.ok(!ENV_ALLOWLIST[type].includes('ALLOW_INSECURE_UPSTREAM'));
  }
});
check('a forbidden variable is reported', () => {
  const s = clone(SERVER);
  pkgOf(s, 'oci').environmentVariables.push({ name: 'MCP_ALLOW_UNAUTHENTICATED', description: 'x' });
  reports({ serverJson: s }, 'server.json declares a forbidden or unknown variable: MCP_ALLOW_UNAUTHENTICATED');
});
check('an unknown variable is reported', () => {
  const s = clone(SERVER);
  pkgOf(s, 'npm').environmentVariables.push({ name: 'NOT_A_REAL_VAR', description: 'x' });
  reports({ serverJson: s }, 'server.json declares a forbidden or unknown variable: NOT_A_REAL_VAR');
});
check('an allowlisted name missing from the canonical config is reported', () => {
  reports({ canonical: new Set([...CANONICAL].filter((n) => n !== 'MCP_BRIDGE_DATA_DIR')) },
    'server.json declares a forbidden or unknown variable: MCP_BRIDGE_DATA_DIR');
});
check('a secret not marked isSecret is reported', () => {
  const s = clone(SERVER);
  pkgOf(s, 'npm').environmentVariables.find((v) => v.name === 'ACTUAL_PASSWORD').isSecret = false;
  reports({ serverJson: s }, 'ACTUAL_PASSWORD must be isSecret');
});
check('a dropped required variable is reported', () => {
  const s = clone(SERVER);
  const oci = pkgOf(s, 'oci');
  oci.environmentVariables = oci.environmentVariables.filter((v) => v.name !== 'MCP_SSE_AUTHORIZATION');
  reports({ serverJson: s }, 'oci package must declare MCP_SSE_AUTHORIZATION');
});
check('a missing npm package is reported', () => {
  const s = clone(SERVER);
  s.packages = s.packages.filter((p) => p.registryType !== 'npm');
  reports({ serverJson: s }, 'server.json must declare exactly one npm package');
});
check('a missing OCI package is reported', () => {
  const s = clone(SERVER);
  s.packages = s.packages.filter((p) => p.registryType !== 'oci');
  reports({ serverJson: s }, 'server.json must declare exactly one oci package');
});

console.log('\n[mcp-server-json] OCI transport');
check('the committed OCI package sends the bearer token and binds loopback', () => {
  const oci = pkgOf(SERVER, 'oci');
  const auth = oci.transport.headers.find((h) => h.name === 'Authorization');
  assert.strictEqual(auth.value, 'Bearer {token}');
  assert.strictEqual(auth.isRequired, true);
  assert.strictEqual(auth.isSecret, true);
  assert.deepStrictEqual([auth.variables.token.isRequired, auth.variables.token.isSecret], [true, true]);
  assert.strictEqual(oci.runtimeArguments.find((a) => a.name === '-p').value, '127.0.0.1:3600:3600');
});
check('no Authorization header is reported', () => {
  const s = clone(SERVER);
  delete pkgOf(s, 'oci').transport.headers;
  reports({ serverJson: s }, 'OCI transport must declare an Authorization header');
});
check('an Authorization header without its token variable is reported', () => {
  const s = clone(SERVER);
  delete pkgOf(s, 'oci').transport.headers.find((h) => h.name === 'Authorization').variables;
  reports({ serverJson: s }, 'Authorization header must declare a required secret token variable');
});
check('a token variable that is not secret is reported', () => {
  const s = clone(SERVER);
  pkgOf(s, 'oci').transport.headers.find((h) => h.name === 'Authorization').variables.token.isSecret = false;
  reports({ serverJson: s }, 'Authorization header must declare a required secret token variable');
});
check('a wildcard port publish is reported', () => {
  const s = clone(SERVER);
  pkgOf(s, 'oci').runtimeArguments.find((a) => a.name === '-p').value = '3600:3600';
  reports({ serverJson: s }, 'OCI port must bind 127.0.0.1');
});

console.log('\n[mcp-server-json] name, description and label');
check('a deleted mcpName is reported', () => {
  const p = clone(PKG);
  delete p.mcpName;
  reports({ pkg: p }, 'mcpName must equal server.json name');
});
check('a different mcpName is reported', () => {
  reports({ pkg: { ...PKG, mcpName: 'io.github.someone/else' } }, 'mcpName must equal server.json name');
});
check('a 101-character description is reported', () => {
  reports({ serverJson: { ...clone(SERVER), description: 'x'.repeat(101) } }, 'description exceeds 100 characters');
});
check('a 100-character description passes', () => {
  assert.ok(!problems({ serverJson: { ...clone(SERVER), description: 'x'.repeat(100) } }).includes('description exceeds 100 characters'));
});
const LABEL_LINE = /^LABEL io\.modelcontextprotocol\.server\.name=.*\n/m;
check('a label only in the build stage is reported', () => {
  const label = LABEL_LINE.exec(DOCKERFILE)[0];
  const moved = DOCKERFILE.replace(LABEL_LINE, '').replace(/^WORKDIR \/app\n/m, `WORKDIR /app\n${label}`);
  assert.ok(moved.indexOf(label) < moved.lastIndexOf('FROM '), 'fixture must put the label before the last FROM');
  reports({ dockerfileText: moved }, 'label missing from final stage');
});
check('an absent label is reported', () => {
  reports({ dockerfileText: DOCKERFILE.replace(LABEL_LINE, '') }, 'label missing from final stage');
});
check('a label with the wrong name is reported', () => {
  reports({ dockerfileText: DOCKERFILE.replace(LABEL_LINE, 'LABEL io.modelcontextprotocol.server.name="io.github.x/y"\n') },
    'label missing from final stage');
});

console.log('\n[mcp-server-json] ci-cd.yml wiring');
// Same shape as jobBlock() in tests/unit/ci_workflow_guards.test.js, but pure on its input.
function jobBlock(text, name) {
  const start = text.search(new RegExp(`\\n  ${name}:\\n`));
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const next = /\n  [A-Za-z][\w-]*:\n/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
function wiringProblems(text) {
  const out = [];
  const pub = jobBlock(text, 'mcp-registry-publish');
  const val = jobBlock(text, 'mcp-registry-validate');
  const needsLine = (b) => (/\n    needs:([^\n]*)/.exec(b) || [, ''])[1];
  // The whole job-level permissions block, as sorted "key: value" lines.
  const perms = (b) => {
    const m = /\n    permissions:\n((?:      [^\n]*\n)*)/.exec(b);
    return m ? m[1].trim().split('\n').map((l) => l.trim()).sort() : [];
  };
  if (!/verify-published-artifacts/.test(needsLine(pub))) out.push('publish must need verify-published-artifacts');
  if (!/\n    if: startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(pub)) out.push('publish must be tag-only');
  if (perms(pub).join(',') !== 'contents: read,id-token: write') out.push('publish must hold id-token: write and contents: read only');
  if (/mcp-registry-publish/.test(needsLine(jobBlock(text, 'release')))) out.push('release must not need publish');
  if (perms(val).join(',') !== 'contents: read') out.push('validate must hold contents: read only');
  if (/id-token/.test(val)) out.push('validate must not hold id-token');
  for (const [n, b] of [['publish', pub], ['validate', val]]) {
    if (!/persist-credentials: false/.test(b)) out.push(`${n} checkout must not persist credentials`);
    if (!/cosign verify-blob/.test(b) || !/sha256sum -c/.test(b)) out.push(`${n} must verify the publisher`);
    if (/cache:/.test(b)) out.push(`${n} must not use a setup-node cache`);
    if (!/\n    continue-on-error: true\n/.test(b)) out.push(`${n} must be continue-on-error`);
  }
  if (!/--expect-version "\$\{GITHUB_REF_NAME#v\}"/.test(pub)) out.push('publish must stamp with --expect-version');
  return out;
}
check('the committed workflow wires both jobs as specified', () => {
  assert.deepStrictEqual(wiringProblems(CI), []);
});
check('publish without the read-back dependency is caught', () => {
  const bad = CI.replace('needs: [version, verify-published-artifacts]', 'needs: [version]');
  assert.ok(wiringProblems(bad).includes('publish must need verify-published-artifacts'));
});
check('publish added to release.needs is caught', () => {
  const bad = CI.replace(/(\n  release:\n[\s\S]*?\n    needs: \[)/, '$1mcp-registry-publish, ');
  assert.ok(wiringProblems(bad).includes('release must not need publish'));
});
check('id-token granted to validate is caught', () => {
  const val = jobBlock(CI, 'mcp-registry-validate');
  const bad = CI.replace(val, val.replace('      contents: read\n', '      contents: read\n      id-token: write\n'));
  assert.ok(wiringProblems(bad).includes('validate must not hold id-token'));
});
check('a write scope added to validate is caught', () => {
  const val = jobBlock(CI, 'mcp-registry-validate');
  const bad = CI.replace(val, val.replace('      contents: read\n', '      contents: read\n      packages: write\n'));
  assert.ok(wiringProblems(bad).includes('validate must hold contents: read only'));
});
check('contents: write on publish is caught', () => {
  const pub = jobBlock(CI, 'mcp-registry-publish');
  const bad = CI.replace(pub, pub.replace('      contents: read\n', '      contents: write\n'));
  assert.ok(wiringProblems(bad).includes('publish must hold id-token: write and contents: read only'));
});
check('publish without continue-on-error is caught', () => {
  const pub = jobBlock(CI, 'mcp-registry-publish');
  const bad = CI.replace(pub, pub.replace('    continue-on-error: true\n', ''));
  assert.ok(wiringProblems(bad).includes('publish must be continue-on-error'));
});

console.log(`\n[mcp-server-json] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
