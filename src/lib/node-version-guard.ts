/**
 * #275: fail fast, and legibly, on an unsupported Node.
 *
 * npm and npx do not enforce `engines` (`engine-strict` defaults to false), so the
 * package installs and launches happily on Node 18. There it dies with
 * `ERR_IMPORT_ASSERTION_TYPE_MISSING`, because Node 18 predates the `with` import
 * attribute spelling used by the dynamic `import('../package.json', { with: ... })`
 * calls in index.ts. That is a link-time error on a dynamic import, not a syntax
 * error, so it escapes to `unhandledRejection` AFTER the stdio transport has already
 * announced itself. The client sees a connected server with zero tools and blames
 * its own config.
 *
 * This module runs the check on import, before anything else is evaluated.
 *
 * CONSTRAINTS, enforced by tests/unit/node_version_guard.test.js:
 *
 *  1. Zero dependencies beyond `node:fs`, `node:path`, `node:url`. It has to run on
 *     the very interpreter it is about to reject, so it cannot import anything that
 *     might fail to parse or resolve there.
 *  2. No import attributes. Reading the floor via `import(pkg, { with: ... })` would
 *     be the exact construct that breaks on the Node we are guarding against, so the
 *     floor is read with `readFileSync` + `JSON.parse`, which works everywhere.
 *  3. The floor is never hardcoded. It comes from `engines.node` in the root
 *     package.json, so bumping the floor needs no change here.
 *
 * On the root package.json: `tsc` emits a mirror at `dist/package.json` (rootDir is
 * "." and resolveJsonModule is on), and in a dev tree that mirror goes stale. Reading
 * it would reintroduce the class of bug this guard exists to prevent, so we walk up
 * looking for the package.json that identifies itself as this package, rather than
 * trusting a fixed relative depth.
 */

import { existsSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package.json we trust. The dist mirror carries the same name, so the walk also bounds by depth. */
const PACKAGE_NAME = 'actual-mcp-server';

/** How far up to look. From dist/src/lib/ the root is 3 levels up; 5 leaves headroom for an outDir change. */
const MAX_WALK_LEVELS = 5;

/** `'v18.19.1'` and `'18.19.1'` both yield `18`. Returns NaN when unparseable. */
export function parseMajor(version: string): number {
  if (typeof version !== 'string') return NaN;
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : NaN;
}

/** `'>=22.0.0'` yields `22`. Returns NaN when unparseable, which callers treat as "fail open". */
export function requiredMajor(range: string): number {
  if (typeof range !== 'string') return NaN;
  const match = /(\d+)/.exec(range.trim());
  return match ? Number(match[1]) : NaN;
}

export interface VersionVerdict {
  ok: boolean;
  message?: string;
}

/**
 * Pure. No I/O, no process access, so the truth table is unit-testable without spawning.
 *
 * Fails OPEN on anything it cannot parse. A guard that bricks a valid install because
 * `engines.node` was written in a spelling we did not anticipate would be worse than
 * the bug it is fixing.
 */
export function checkNodeVersion(running: string, range: string): VersionVerdict {
  const have = parseMajor(running);
  const need = requiredMajor(range);
  if (Number.isNaN(have) || Number.isNaN(need)) return { ok: true };
  if (have >= need) return { ok: true };

  return {
    ok: false,
    message:
      `actual-mcp-server requires Node ${range}, but is running on ${running}.\n` +
      '\n' +
      "If you launched this through npx or the installed launcher, its '#!/usr/bin/env node'\n" +
      'shebang re-resolves node from PATH. Pointing your MCP client at a newer npx, or at an\n' +
      'absolute path to the launcher, therefore does NOT change which interpreter runs. Fix\n' +
      'PATH, or invoke a supported node binary directly:\n' +
      '\n' +
      '  /path/to/node-22/bin/node $(which actual-mcp-server) --stdio\n' +
      '\n' +
      'Without this check the server would start, announce itself to your client, and\n' +
      'then die with ERR_IMPORT_ASSERTION_TYPE_MISSING, leaving a connected session\n' +
      'that exposes zero tools.',
  };
}

interface PackageManifest {
  name?: string;
  engines?: { node?: string };
}

/**
 * Walk up from `startDir` for the package.json whose `name` is this package.
 * Depth-independent, so it resolves identically from `bin/` and from `dist/src/lib/`.
 * Returns null when not found, or when the file is unreadable or not valid JSON.
 *
 * Takes the OUTERMOST match, not the first one. This matters: the `dist/package.json`
 * mirror also carries `name: "actual-mcp-server"` and an `engines` block, and it is
 * structurally identical to the root apart from a possibly stale `version`. A
 * first-match-wins walk from `dist/src/lib/` would therefore stop at the mirror,
 * which is precisely the stale read this guard must avoid. The root always sits
 * above the mirror, so the last match on the way up is the right one.
 *
 * The walk stops at a `node_modules` boundary so that an installed copy resolves to
 * its own manifest and can never climb into a consuming project that happens to
 * share the name.
 */
export function findRootPackageJson(startDir: string): PackageManifest | null {
  let dir = startDir;
  let outermost: PackageManifest | null = null;

  for (let level = 0; level <= MAX_WALK_LEVELS; level++) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageManifest;
      if (manifest && manifest.name === PACKAGE_NAME && manifest.engines) outermost = manifest;
    } catch {
      // No package.json here, or it is unreadable or malformed. Keep walking.
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    // `dir` is the installed package root; above it lies the consumer's tree.
    if (outermost && parent.endsWith(`${sep}node_modules`)) break;
    // Having found a manifest, stop as soon as the chain of package.json files breaks.
    // Without this the walk climbs out of the repository, and an ancestor directory
    // that happens to hold a package.json named actual-mcp-server (a checkout nested
    // inside another checkout of itself) would override the real root.
    if (outermost && !existsSync(join(parent, 'package.json'))) break;
    dir = parent;
  }

  return outermost;
}

/**
 * Read the floor and enforce it. Writes to stderr ONLY: stdout is reserved for stdio
 * JSON-RPC framing, and a stray byte there corrupts the client's message stream.
 *
 * Uses `writeSync(2, ...)` rather than `process.stderr.write(...)`. Node's stderr is
 * ASYNCHRONOUS when it is a pipe on POSIX, which is precisely how an MCP client
 * captures it, so a `process.stderr.write()` immediately followed by `process.exit()`
 * can be torn down before the buffer flushes. A guard whose message gets dropped
 * leaves the user staring at the same silent failure it was written to explain.
 *
 * Exported for the tests. Called on import (below) so a bare
 * `import './lib/node-version-guard.js'` is enough to arm it.
 */
export function enforceNodeVersion(runningVersion: string = process.version): void {
  const manifest = findRootPackageJson(dirname(fileURLToPath(import.meta.url)));
  const range = manifest?.engines?.node;
  if (!range) return; // Fail open: cannot find the floor, so do not invent one.

  const verdict = checkNodeVersion(runningVersion, range);
  if (verdict.ok) return;

  writeSync(2, `\n${verdict.message}\n\n`);
  process.exit(1);
}

enforceNodeVersion();
