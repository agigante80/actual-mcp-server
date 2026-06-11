// tests/unit/port_alignment.test.js
//
// #230: the default HTTP port must be ONE canonical value across every anchor:
// the src/config.ts Zod default (the declared single source of truth), the
// src/lib/constants.ts DEFAULT_HTTP_PORT, the src/index.ts listen fallback, the
// Dockerfile EXPOSE and HEALTHCHECK fallback, .env.example, and every
// docker-compose.yaml port mapping and MCP_BRIDGE_PORT env. This guard fails CI
// if any one of them drifts (the split-brain 3000-vs-3600 state this fixed).
//
// Reads source files as text (no build needed). Mirrors the tool-count drift guard.
//
// Run: node tests/unit/port_alignment.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[port-alignment]');

// Canonical source of truth: the src/config.ts MCP_BRIDGE_PORT Zod default.
// Quote-tolerant so a formatter flipping ' to " does not crash the parse.
const configSrc = read('src/config.ts');
const canonMatch = configSrc.match(/MCP_BRIDGE_PORT:\s*z\.string\(\)\.default\(['"](\d+)['"]\)/);
assert(canonMatch, 'could not parse MCP_BRIDGE_PORT default from src/config.ts');
const CANON = canonMatch[1];
console.log(`  canonical port (src/config.ts) = ${CANON}`);

check('src/lib/constants.ts DEFAULT_HTTP_PORT matches canonical', () => {
  const m = read('src/lib/constants.ts').match(/DEFAULT_HTTP_PORT\s*=\s*(\d+)/);
  assert(m, 'DEFAULT_HTTP_PORT not found');
  assert.strictEqual(m[1], CANON, `DEFAULT_HTTP_PORT=${m[1]} != ${CANON}`);
});

check('src/index.ts listen-port fallback matches canonical', () => {
  // Tolerate the common equivalent default spellings: ternary `: 3600`,
  // nullish `?? 3600`, and logical-or `|| 3600`, each closed by ; ) or newline.
  const m = read('src/index.ts').match(/MCP_BRIDGE_PORT[^\n]*?(?::|\?\?|\|\|)\s*(\d+)\s*[;)\n]/);
  assert(m, 'index.ts MCP_BRIDGE_PORT fallback not found');
  assert.strictEqual(m[1], CANON, `index.ts fallback=${m[1]} != ${CANON}`);
});

check('Dockerfile EXPOSE matches canonical', () => {
  const m = read('Dockerfile').match(/EXPOSE\s+(\d+)/);
  assert(m, 'EXPOSE not found');
  assert.strictEqual(m[1], CANON, `EXPOSE ${m[1]} != ${CANON}`);
});

check('Dockerfile HEALTHCHECK fallback matches canonical', () => {
  const m = read('Dockerfile').match(/MCP_BRIDGE_PORT:-(\d+)/);
  assert(m, 'HEALTHCHECK MCP_BRIDGE_PORT fallback not found');
  assert.strictEqual(m[1], CANON, `HEALTHCHECK fallback ${m[1]} != ${CANON}`);
});

check('.env.example MCP_BRIDGE_PORT matches canonical', () => {
  const m = read('.env.example').match(/^MCP_BRIDGE_PORT=(\d+)/m);
  assert(m, 'MCP_BRIDGE_PORT not found in .env.example');
  assert.strictEqual(m[1], CANON, `.env.example ${m[1]} != ${CANON}`);
});

check('every compose MCP_BRIDGE_PORT env matches canonical (incl. CI compose)', () => {
  // Only the MCP service defines MCP_BRIDGE_PORT, so this is safe to scan across
  // both compose files without tripping on the upstream actual-server service.
  // docker-compose.test.yaml is included so the CI stack cannot silently drift.
  let total = 0;
  for (const f of ['docker-compose.yaml', 'docker-compose.test.yaml']) {
    for (const e of read(f).matchAll(/MCP_BRIDGE_PORT=(\d+)/g)) {
      total++;
      assert.strictEqual(e[1], CANON, `${f} MCP_BRIDGE_PORT=${e[1]} != ${CANON}`);
    }
  }
  assert(total > 0, 'no MCP_BRIDGE_PORT env found in any compose file');
});

check('every docker-compose.yaml port mapping matches canonical', () => {
  // Only uncommented lines. Mappings look like  - "3600:3600"  and may carry an
  // optional host-IP prefix  - "127.0.0.1:3600:3600" , whose leading IP we ignore.
  const lines = read('docker-compose.yaml').split('\n').filter((l) => !l.trim().startsWith('#'));
  const maps = [...lines.join('\n').matchAll(/"(?:[\d.]+:)?(\d+):(\d+)"/g)];
  assert(maps.length > 0, 'no port mappings found in docker-compose.yaml');
  for (const m of maps) {
    assert.strictEqual(m[1], CANON, `compose host port ${m[1]} != ${CANON}`);
    assert.strictEqual(m[2], CANON, `compose container port ${m[2]} != ${CANON}`);
  }
});

console.log(`\n[port-alignment] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
