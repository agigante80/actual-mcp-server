// tests/unit/compose_profile_sync.test.js
//
// #233: docs must not reference a Docker Compose profile that docker-compose.yaml
// does not define. The file declares only `dev` and `production` (no `fullstack`,
// no nginx tier). This guard fails CI if a doc names a profile the compose file
// lacks, in command form (`--profile X`) or as the specific `fullstack` phantom in
// prose. Mirrors tests/unit/port_alignment.test.js.
//
// #600 adds a compose CONTENT check (checkCompose below), parsed with the `yaml` package
// rather than the line parser: the production service must pull a namespaced image, read
// `.env` through `env_file` (long syntax, required: false) and map MCP_SSE_AUTHORIZATION,
// and no shipped compose file may publish an unauthenticated server (or the test stack at
// all) on a non-loopback interface. The profile checks keep their line parser unchanged.
//
// Run: node tests/unit/compose_profile_sync.test.js

import assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseDocument, LineCounter, isMap, isSeq, isScalar } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Declared profiles: handle both the block-list form (`profiles:` then `- name`)
// and the inline-array form (`profiles: [dev, production]`). Commented blocks (e.g.
// the Traefik example) are skipped via the per-line `#` guard.
function declaredProfiles(yaml) {
  const lines = yaml.split('\n');
  const set = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) continue;
    const inline = lines[i].match(/^\s*profiles:\s*\[([^\]]*)\]/);
    if (inline) {
      for (const name of inline[1].split(',')) {
        const t = name.trim().replace(/^['"]|['"]$/g, '');
        if (/^[A-Za-z][\w-]*$/.test(t)) set.add(t);
      }
      continue;
    }
    if (/^\s*profiles:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = lines[j].match(/^\s*-\s*([A-Za-z][\w-]*)\s*$/);
        if (m) set.add(m[1]);
        else break;
      }
    }
  }
  return set;
}

// Profiles referenced in a doc via the `--profile X` or `--profile=X` command form.
const referencedProfiles = (text) => [...text.matchAll(/--profile[=\s]+([A-Za-z][\w-]*)/g)].map((m) => m[1]);

// The specific phantom this ticket removed; shared by the per-doc check and the
// negative test so weakening one does not leave the other vacuously green.
const mentionsFullstackProfile = (text) => /\bfullstack\b/i.test(text);

const DOCS = [
  'README.md',
  '.github/copilot-instructions.md',
  '.claude/agents/health-check.md',
  '.claude/commands/full-review.md',
  'CLAUDE.md',
];

// Assistant instruction files and .claude/ are kept OUT of the repository by the leak
// guard (untracked by class, see the "leak-guard baseline" block in .gitignore), so a
// fresh checkout does not have them. They stay in DOCS so a developer's working copy is
// still checked; an absent one is skipped LOUDLY rather than failed, because an ENOENT
// here says nothing about compose profiles. Before this, every push after the files were
// ignored turned Run Tests red on exactly that ENOENT.
const LOCAL_ONLY_DOCS = new Set([
  '.github/copilot-instructions.md',
  '.claude/agents/health-check.md',
  '.claude/commands/full-review.md',
  'CLAUDE.md',
]);

console.log('\n[compose-profile-sync]');

const declared = declaredProfiles(read('docker-compose.yaml'));

check('docker-compose.yaml declares exactly the expected profiles', () => {
  assert.deepStrictEqual([...declared].sort(), ['dev', 'production'], `declared profiles: ${[...declared].join(', ')}`);
});

for (const doc of DOCS) {
  if (!existsSync(join(ROOT, doc))) {
    assert.ok(LOCAL_ONLY_DOCS.has(doc), `${doc} is missing and is not a declared local-only file`);
    console.log(`  skip: ${doc} (local-only, absent in this checkout)`);
    continue;
  }

  check(`${doc}: every --profile reference is a declared profile`, () => {
    const text = read(doc);
    const bad = referencedProfiles(text).filter((p) => !declared.has(p));
    assert.strictEqual(bad.length, 0, `references undeclared profile(s): ${[...new Set(bad)].join(', ')}`);
  });

  check(`${doc}: no "fullstack" phantom profile mention`, () => {
    assert.ok(!mentionsFullstackProfile(read(doc)), 'mentions a "fullstack" profile that docker-compose.yaml does not define');
  });
}

// Negative cases: invoke the SAME production helpers so weakening them is caught.
check('NEGATIVE: an undeclared --profile reference is detected (space and = forms)', () => {
  const bad = referencedProfiles('docker compose --profile fullstack up; docker compose --profile=staging up')
    .filter((p) => !declared.has(p));
  assert.deepStrictEqual(bad.sort(), ['fullstack', 'staging'], 'guard must flag undeclared profiles in both forms');
});

check('NEGATIVE: the fullstack phantom is detected in prose by the production helper', () => {
  assert.ok(mentionsFullstackProfile('profiles: dev, production, fullstack'), 'phantom check must match prose mentions');
});

// ---------------------------------------------------------------------------------------------
// #600 compose content check.

// Every published port, as { spec, line, loopback }. Short syntax "HOST_IP:HOST:CONTAINER" is
// loopback only with a 127.0.0.1 prefix; long syntax needs host_ip: 127.0.0.1.
function publishedPorts(service, lc) {
  const ports = service.get('ports', true);
  if (!isSeq(ports)) return [];
  return ports.items.map((item) => {
    const line = lc.linePos(item.range[0]).line;
    if (isMap(item)) {
      return { spec: JSON.stringify(item.toJSON()), line, loopback: item.get('host_ip') === '127.0.0.1' };
    }
    const spec = String(isScalar(item) ? item.value : item);
    return { spec, line, loopback: spec.startsWith('127.0.0.1:') };
  });
}

// Environment entries as [{ key, value, line }], from list or map syntax.
function environmentOf(service, lc) {
  const env = service.get('environment', true);
  if (isSeq(env)) {
    return env.items.map((item) => {
      const [key, ...rest] = String(item.value).split('=');
      return { key, value: rest.join('='), line: lc.linePos(item.range[0]).line };
    });
  }
  if (isMap(env)) {
    return env.items.map((pair) => ({ key: String(pair.key.value), value: String(pair.value?.value ?? ''), line: lc.linePos(pair.key.range[0]).line }));
  }
  return [];
}

// kind: 'main' for docker-compose.yaml (keyed on mcp-server-prod and mcp-server-dev), 'test'
// for docker-compose.test.yaml (every service, every port).
function checkCompose(text, kind, file) {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  if (doc.errors.length) return [`${file} does not parse: ${doc.errors[0].message}`];
  const services = doc.get('services', true);
  if (!isMap(services)) return [`${file} has no services map`];
  const errors = [];
  const at = (line) => `(${file}:${line})`;
  const serviceLine = (name) => lc.linePos(services.items.find((p) => p.key.value === name).key.range[0]).line;

  if (kind === 'test') {
    for (const pair of services.items) {
      for (const p of publishedPorts(pair.value, lc)) {
        if (!p.loopback) errors.push(`test stack publishes a port on all interfaces ${at(p.line)}`);
      }
    }
    return errors;
  }

  const prod = services.get('mcp-server-prod', true);
  if (prod) {
    const image = prod.get('image', true);
    if (!image || !String(image.value).includes('/')) {
      errors.push(`production image has no registry namespace ${at(image ? lc.linePos(image.range[0]).line : serviceLine('mcp-server-prod'))}`);
    }
    const envFile = prod.get('env_file');
    const entries = Array.isArray(envFile?.toJSON?.()) ? envFile.toJSON() : [];
    if (!entries.some((e) => e && e.path === '.env' && e.required === false)) {
      errors.push(`production env_file must be .env with required: false ${at(serviceLine('mcp-server-prod'))}`);
    }
    if (!environmentOf(prod, lc).some((e) => e.key === 'MCP_SSE_AUTHORIZATION')) {
      errors.push(`production does not map MCP_SSE_AUTHORIZATION ${at(serviceLine('mcp-server-prod'))}`);
    }
  }
  const dev = services.get('mcp-server-dev', true);
  if (dev) {
    const open = environmentOf(dev, lc).find((e) => e.key === 'MCP_ALLOW_UNAUTHENTICATED' && e.value === 'true');
    if (open) {
      for (const p of publishedPorts(dev, lc)) {
        if (!p.loopback) errors.push(`dev publishes an unauthenticated server on all interfaces ${at(p.line)}`);
      }
    }
  }
  return errors;
}

check('docker-compose.yaml: production pulls the GHCR image, reads .env, maps the token; dev is loopback-bound', () => {
  assert.deepStrictEqual(checkCompose(read('docker-compose.yaml'), 'main', 'docker-compose.yaml'), []);
});

check('docker-compose.test.yaml: every published port binds 127.0.0.1', () => {
  assert.deepStrictEqual(checkCompose(read('docker-compose.test.yaml'), 'test', 'docker-compose.test.yaml'), []);
});

const fixture = (name) => read(`tests/unit/fixtures/compose/${name}`);
const COMPOSE_NEGATIVES = [
  ['prod-no-namespace.yaml', 'main', 'production image has no registry namespace'],
  ['prod-token-commented.yaml', 'main', 'production does not map MCP_SSE_AUTHORIZATION'],
  ['prod-no-env-file.yaml', 'main', 'production env_file must be .env with required: false'],
  ['dev-all-interfaces.yaml', 'main', 'dev publishes an unauthenticated server on all interfaces'],
  ['test-all-interfaces.yaml', 'test', 'test stack publishes a port on all interfaces'],
];
for (const [name, kind, message] of COMPOSE_NEGATIVES) {
  check(`NEGATIVE: ${name} fails with "${message}"`, () => {
    const errors = checkCompose(fixture(name), kind, name);
    assert.ok(errors.some((e) => e.startsWith(message)), `got: ${JSON.stringify(errors)}`);
  });
}

console.log(`\n[compose-profile-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
