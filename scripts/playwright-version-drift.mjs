#!/usr/bin/env node
/**
 * #385: single-source-of-truth guard for the Playwright version.
 *
 * The E2E suite runs INSIDE `mcr.microsoft.com/playwright:v<x>-jammy`, and then `npm ci` inside
 * that container installs `@playwright/test` from the lockfile. So two Playwright versions are in
 * play at once, they were pinned in different files, and nothing checked that they agreed. They
 * had drifted by five minor versions (image v1.57.0, lockfile 1.62.1) before this guard existed.
 *
 * WHY IT MATTERS EVEN THOUGH IT CURRENTLY WORKS. No spec in this repository drives a browser: they
 * use the `request` fixture, which is plain HTTP. That is exactly why the drift was invisible, and
 * exactly why it is worth pinning: the failure mode when someone adds the first browser-touching
 * spec is a version mismatch between the runner and the browsers baked into the image, which
 * surfaces as an opaque launch error rather than as "your image is old".
 *
 * The LOCKFILE is canonical, not the `package.json` range. `^1.60.0` is not a version; the thing
 * that actually installs and runs in CI is the resolved one, and that is what the image has to
 * match. A Playwright bump therefore turns this red until the image tag moves with it, which is
 * the intended behaviour and the same contract `node-version-drift` has for Node.
 *
 * Sibling of scripts/node-version-drift.mjs (Node floor), scripts/config-drift.mjs (config vars),
 * scripts/tool-count.mjs (tool count) and scripts/version-check.js (VERSION vs package.json).
 *
 * Usage: node scripts/playwright-version-drift.mjs [--root <dir>]
 * Exit 0 when consistent, 1 when any file disagrees (naming the file, the line and the value).
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag === -1
  ? join(dirname(fileURLToPath(import.meta.url)), '..')
  : argv[rootFlag + 1];

/** Every `mcr.microsoft.com/playwright:v<version>-<base>` reference, wherever it appears. */
const IMAGE_RE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-([a-z]+)/g;

/**
 * Files that pin the image. Scanned rather than listed one by one where possible, because the
 * reference in `ci-cd.yml` appears twice (once in a comment, once in a `docker save`) and a guard
 * that knew about only one of them would go green on a half-done bump.
 */
function pinSites(root) {
  const files = [join(root, 'docker-compose.test.yaml')];
  const wfDir = join(root, '.github', 'workflows');
  if (existsSync(wfDir)) {
    for (const f of readdirSync(wfDir)) {
      if (f.endsWith('.yml') || f.endsWith('.yaml')) files.push(join(wfDir, f));
    }
  }
  const sites = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(IMAGE_RE)) {
        sites.push({ file: file.replace(root + '/', ''), line: i + 1, version: m[1], base: m[2] });
      }
    });
  }
  return sites;
}

/** The version that actually installs in CI, from the lockfile. */
function lockedVersion(root) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.['node_modules/@playwright/test'];
  if (!entry?.version) {
    throw new Error('@playwright/test not found in package-lock.json; the parser is stale');
  }
  return entry.version;
}

export function checkPlaywrightDrift(root = ROOT) {
  const errors = [];
  const locked = lockedVersion(root);
  const sites = pinSites(root);

  // A guard that finds nothing to check must say so rather than passing. This is how
  // node-version-drift's siblings avoid going quietly vacuous when a file is renamed.
  if (sites.length === 0) {
    errors.push('no mcr.microsoft.com/playwright image reference found anywhere; the scan is stale');
  }

  for (const s of sites) {
    if (s.version !== locked) {
      errors.push(
        `${s.file}:${s.line} pins the Playwright image at v${s.version} but the lockfile installs ` +
        `${locked}. Bump the image tag to v${locked}-${s.base} (the lockfile is canonical).`,
      );
    }
  }

  // All references must also agree on the base image, or `docker save` caches a tag that the
  // compose file never pulls and the cache silently does nothing.
  const bases = [...new Set(sites.map((s) => s.base))];
  if (bases.length > 1) {
    errors.push(`the image base differs across files (${bases.join(', ')}); they must be identical`);
  }

  return { locked, sites, errors };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { locked, sites, errors } = checkPlaywrightDrift();
  if (errors.length > 0) {
    console.error('Playwright version drift:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log(
    `No Playwright drift. ${sites.length} image reference(s) all pin v${locked}, matching the lockfile.`,
  );
}
