#!/usr/bin/env node
/**
 * #275: single-source-of-truth guard for the Node version floor.
 *
 * The floor was declared in nine places and verified in none. `package.json` engines
 * is canonical; everything else must agree with it. Sibling of scripts/config-drift.mjs
 * (config vars), scripts/tool-count.mjs (tool count), and scripts/version-check.js
 * (VERSION vs package.json).
 *
 * Rules:
 *   1. Every `FROM node:<major>` in the Dockerfile equals the floor exactly. The image
 *      we ship on is the version we test on.
 *   2. `NODE_VERSION` in ci-cd.yml equals the floor exactly. It is the canonical CI Node.
 *   3. Every literal `node-version: '<major>'` in a workflow is >= the floor. CI may
 *      deliberately run a newer Node (npm-publish pins 24 for its bundled sigstore), it
 *      may never run an older one. Lines carrying the `node-version-drift: allow-below-floor`
 *      marker are exempt, which is how the guard's own below-floor regression job opts out.
 *   4. The README states the floor.
 *
 * Usage: node scripts/node-version-drift.mjs [--root <dir>]
 * Exit 0 when consistent, 1 when any file disagrees (naming the file and the value).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag === -1
  ? join(dirname(fileURLToPath(import.meta.url)), '..')
  : argv[rootFlag + 1];

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const exists = (rel) => existsSync(join(ROOT, rel));

const violations = [];
const checked = [];

const pkg = JSON.parse(read('package.json'));
const range = pkg?.engines?.node;
if (!range) {
  console.error('node-version-drift: package.json has no engines.node. Nothing to guard against.');
  process.exit(1);
}
const floor = Number(/(\d+)/.exec(range)?.[1]);
if (Number.isNaN(floor)) {
  console.error(`node-version-drift: cannot parse a major version out of engines.node = ${range}`);
  process.exit(1);
}
checked.push(`package.json engines.node = ${range} (floor ${floor})`);

// Rule 1: Dockerfile base images. Every `FROM node:<tag>` is checked, including tags
// that do not start with a digit (`node:lts-alpine`). A tag we cannot compare is a
// violation, not a pass: silently skipping it is how the floor drifts unnoticed.
if (exists('Dockerfile')) {
  const dockerfile = read('Dockerfile');
  const tags = [...dockerfile.matchAll(/^FROM\s+node:(\S+)/gm)].map((m) => m[1]);
  if (tags.length === 0) violations.push('Dockerfile: no `FROM node:<tag>` line found');
  for (const tag of tags) {
    const major = Number(/^(\d+)/.exec(tag)?.[1]);
    if (Number.isNaN(major)) {
      violations.push(`Dockerfile: FROM node:${tag} has no comparable major version (pin a numeric tag)`);
    } else if (major !== floor) {
      violations.push(`Dockerfile: FROM node:${tag} disagrees with engines floor ${floor}`);
    }
  }
  checked.push(`Dockerfile FROM node tags = [${tags.join(', ')}]`);
}

// Rule 2: the canonical CI Node.
const CI = '.github/workflows/ci-cd.yml';
if (exists(CI)) {
  const ci = read(CI);
  const match = /^\s*NODE_VERSION:\s*'?(\d+)'?/m.exec(ci);
  if (!match) violations.push(`${CI}: no NODE_VERSION env found`);
  else {
    const value = Number(match[1]);
    if (value !== floor) violations.push(`${CI}: NODE_VERSION: '${value}' disagrees with engines floor ${floor}`);
    checked.push(`${CI} NODE_VERSION = ${match[1]}`);
  }
}

// Rule 3: no workflow may pin a Node below the floor.
//
// Every workflow is scanned, not a hardcoded list, so a newly added one cannot escape
// the guard. Quoting is not assumed: `'22'`, `"22"`, `22`, and `20.x` are all read. A
// pin we cannot compare (`lts/*`) is a violation rather than a silent skip. The only
// intentional skip is an expression like `${{ env.NODE_VERSION }}`, which rule 2 covers.
const WORKFLOW_DIR = '.github/workflows';
const ALLOW_MARKER = 'node-version-drift: allow-below-floor';
// The marker may sit on the pinned line itself or on any of the 3 lines above it, so it
// can be attached either to the `node-version:` key or to the step that owns it. Any
// further away and it stops being obviously connected to the pin it exempts.
const MARKER_LOOKBACK = 3;

const workflows = exists(WORKFLOW_DIR)
  ? readdirSync(join(ROOT, WORKFLOW_DIR))
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => `${WORKFLOW_DIR}/${f}`)
      .sort()
  : [];
checked.push(`scanned ${workflows.length} workflow file(s)`);

for (const wf of workflows) {
  const lines = read(wf).split('\n');
  lines.forEach((line, i) => {
    if (line.trim().startsWith('#')) return; // A commented-out example is not a pin.
    const match = /node-version:\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (!match) return;

    const raw = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (raw.includes('${{')) return; // An expression; rule 2 pins the env it reads.

    const window = lines.slice(Math.max(0, i - MARKER_LOOKBACK), i + 1);
    if (window.some((l) => l.includes(ALLOW_MARKER))) {
      checked.push(`${wf}:${i + 1} node-version: ${raw} (exempt, below-floor by design)`);
      return;
    }

    const value = Number(/^v?(\d+)/.exec(raw)?.[1]);
    if (Number.isNaN(value)) {
      violations.push(`${wf}:${i + 1}: node-version: ${raw} has no comparable major version (pin a numeric one)`);
      return;
    }
    if (value < floor) {
      violations.push(`${wf}:${i + 1}: node-version: ${raw} is below the engines floor ${floor}`);
    }
    checked.push(`${wf}:${i + 1} node-version: ${raw}`);
  });
}

// Rule 4: the README states the floor where users look for it.
if (exists('README.md')) {
  const readme = read('README.md');
  const stated = new RegExp(`Node\\.js\\s*${floor}\\+?`).test(readme);
  if (!stated) violations.push(`README.md: does not state the Node ${floor} floor (expected "Node.js ${floor}")`);
  const stale = [...readme.matchAll(/Node\.js\s*(\d+)/g)].map((m) => Number(m[1])).filter((v) => v < floor);
  for (const value of stale) {
    violations.push(`README.md: mentions Node.js ${value}, which is below the engines floor ${floor}`);
  }
  checked.push(`README.md states Node.js ${floor}`);
}

if (violations.length > 0) {
  console.error('\nnode-version-drift: the Node floor is declared inconsistently.\n');
  for (const v of violations) console.error(`  FAIL  ${v}`);
  console.error(`\nengines.node in package.json is canonical (floor ${floor}). Update the files above to match.\n`);
  process.exit(1);
}

console.log('\n[node-version-drift] all declarations agree with engines.node\n');
for (const c of checked) console.log(`  ok: ${c}`);
console.log(`\n[node-version-drift] ${checked.length} checks passed\n`);
