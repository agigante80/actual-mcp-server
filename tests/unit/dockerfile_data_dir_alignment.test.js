// tests/unit/dockerfile_data_dir_alignment.test.js
//
// #228: the in-image data dir must be ONE canonical path everywhere, so the
// directory the image creates and chowns is exactly the directory the app writes,
// and the docker-compose volume mount does not re-shadow it with a different path.
// Anchors: the Dockerfile `mkdir`/`chown` target, the Dockerfile
// `ENV MCP_BRIDGE_DATA_DIR`, the compose `MCP_BRIDGE_DATA_DIR` env, AND every
// compose data-volume mount target (the actual-data / mcp-data mounts). This is
// the guard that keeps the #228 split-path bug (/app/data vs ./actual-data vs /data)
// from recurring.
//
// Reads source files as text (no build needed).
//
// Run: node tests/unit/dockerfile_data_dir_alignment.test.js

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

console.log('\n[dockerfile-data-dir-alignment]');

const dockerfile = read('Dockerfile');
const compose = read('docker-compose.yaml');

// Canonical source of truth: the Dockerfile ENV MCP_BRIDGE_DATA_DIR.
const envMatch = dockerfile.match(/ENV\s+MCP_BRIDGE_DATA_DIR=(\S+)/);
assert(envMatch, 'could not parse ENV MCP_BRIDGE_DATA_DIR from Dockerfile');
const CANON = envMatch[1];
console.log(`  canonical data dir (Dockerfile ENV) = ${CANON}`);

check('Dockerfile creates and chowns the canonical data dir', () => {
  const m = dockerfile.match(/mkdir -p ([^\s&]+)[\s\S]*?chown -R app:app ([^\s\n]+)/);
  assert(m, 'mkdir/chown line not found');
  assert.strictEqual(m[1], CANON, `mkdir target ${m[1]} != ${CANON}`);
  assert.strictEqual(m[2], CANON, `chown target ${m[2]} != ${CANON}`);
});

check('no dead chown of a non-canonical dir remains in the Dockerfile', () => {
  const chowns = [...dockerfile.matchAll(/chown -R app:app (\S+)/g)].map((m) => m[1]);
  for (const target of chowns) {
    assert.strictEqual(target, CANON, `Dockerfile chowns ${target}, expected only ${CANON}`);
  }
});

check('every compose MCP_BRIDGE_DATA_DIR env matches canonical (incl. CI compose)', () => {
  // Only the MCP service defines MCP_BRIDGE_DATA_DIR, so scanning both compose
  // files is safe (the upstream actual-server service has no such var). Including
  // docker-compose.test.yaml stops the CI stack from silently drifting.
  let total = 0;
  for (const f of ['docker-compose.yaml', 'docker-compose.test.yaml']) {
    for (const e of read(f).matchAll(/MCP_BRIDGE_DATA_DIR=(\S+)/g)) {
      total++;
      assert.strictEqual(e[1], CANON, `${f} MCP_BRIDGE_DATA_DIR=${e[1]} != ${CANON}`);
    }
  }
  assert(total > 0, 'no MCP_BRIDGE_DATA_DIR env found in any compose file');
});

check('every compose data-volume mount target matches canonical', () => {
  // Data volumes are exactly the ./actual-data (bind) and mcp-data (named) mounts.
  // Anchor the source precisely so an unrelated volume whose name merely ends in
  // "actual-data" (e.g. ./backups/old-actual-data) is not mis-captured. Capture the
  // target up to the next colon so a valid mode suffix (:ro, :rw, :z) is not swallowed.
  const lines = compose.split('\n').filter((l) => !l.trim().startsWith('#'));
  const mounts = [...lines.join('\n').matchAll(/-\s+(?:\.\/actual-data|mcp-data):([^:\s]+)/g)];
  assert(mounts.length > 0, 'no actual-data/mcp-data mounts found in docker-compose.yaml');
  for (const m of mounts) {
    assert.strictEqual(m[1], CANON, `compose data mount target ${m[1]} != ${CANON}`);
  }
});

check('no leftover :/data shadow for the MCP data volumes', () => {
  assert.ok(!/(?:actual-data|mcp-data):\/data\b/.test(compose),
    'a data volume still mounts at /data instead of the canonical path');
});

console.log(`\n[dockerfile-data-dir-alignment] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
