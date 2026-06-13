// tests/manual/tests/entrypoint.js
//
// #227: behavioural verification of the PUID/PGID privilege-drop entrypoint,
// run on the HOST (where Docker is available) during `/local-env full`. The
// Playwright E2E runner cannot reach Docker, and the unit guard
// (entrypoint_invariants.test.js) only source-asserts the script, so this is the
// real behavioural check: it actually runs the built image.
//
// Two cases (the third, graceful SIGTERM, is covered by the live container that
// /local-env starts and the running server's SIGTERM handler):
//   1. Started as root with PUID/PGID -> entrypoint remaps `app` and execs the
//      CMD as that uid (id -u prints PUID).
//   2. Started with an explicit --user (not root) -> entrypoint is a no-op and
//      execs as-is (PUID ignored).
//
// Run standalone: node tests/manual/tests/entrypoint.js
// Override the image: MCP_LOCAL_IMAGE=actual-mcp-server:local-latest node ...
//
// Exits 0 on pass OR when Docker / the image is unavailable (skipped, not failed),
// 1 on a real behavioural mismatch.

import { execSync } from 'node:child_process';

const IMAGE = process.env.MCP_LOCAL_IMAGE || 'actual-mcp-server:local-latest';

let passed = 0;
let failed = 0;
const ok = (m) => { console.log(`  ok: ${m}`); passed++; };
const bad = (m) => { console.error(`  FAIL: ${m}`); failed++; };

function sh(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function dockerAvailable() {
  try { execSync('docker info', { stdio: 'ignore' }); } catch { return false; }
  try { execSync(`docker image inspect ${IMAGE}`, { stdio: 'ignore' }); } catch { return false; }
  return true;
}

console.log('\n[entrypoint-behaviour]');

if (!dockerAvailable()) {
  console.log(`  SKIP: Docker or the image ${IMAGE} is not available; skipping behavioural check.`);
  console.log('\n[entrypoint-behaviour] Results: skipped');
  process.exit(0);
}

// Case 1: started as root with PUID/PGID -> the app runs as that uid.
try {
  // Default user is root (the image has no USER line). The entrypoint remaps
  // `app` to PUID/PGID, chowns the volumes, then `exec su-exec app "$@"`.
  const uid = sh(`docker run --rm -e PUID=99 -e PGID=100 ${IMAGE} id -u`);
  uid === '99'
    ? ok('root start with PUID=99 -> app execs as uid 99 (remapped + dropped)')
    : bad(`root start with PUID=99 -> expected uid 99, got "${uid}"`);
} catch (e) {
  bad(`root+PUID case errored: ${(e.stderr || e).toString().split('\n')[0]}`);
}

// Case 2: started with an explicit non-root --user -> entrypoint is a no-op.
try {
  const uid = sh(`docker run --rm --user 1000:1000 -e PUID=99 ${IMAGE} id -u`);
  uid === '1000'
    ? ok('non-root --user 1000 with PUID=99 -> no-op, execs as uid 1000 (PUID ignored)')
    : bad(`non-root --user 1000 -> expected uid 1000, got "${uid}"`);
} catch (e) {
  bad(`non-root case errored: ${(e.stderr || e).toString().split('\n')[0]}`);
}

console.log(`\n[entrypoint-behaviour] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
