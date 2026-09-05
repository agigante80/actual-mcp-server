/**
 * #439: resolve the version of `@actual-app/api` this process actually has
 * installed, as opposed to the range `package.json` declares.
 *
 * WHY NOT the obvious routes, all verified rather than assumed:
 *  - `require.resolve('@actual-app/api/package.json')` throws
 *    ERR_PACKAGE_PATH_NOT_EXPORTED: the package does not export that subpath.
 *  - The module's own `VERSION` export is `undefined`, and the bundle carries an
 *    unrelated third-party `VERSION` string, so reading it could silently yield a
 *    wrong version.
 *  - `package.json` holds a CARET RANGE, so the installed version is unknowable
 *    at our build time and cannot be baked in.
 * So: resolve the entry point, then walk up to the nearest `package.json` whose
 * `name` matches, mirroring the shape of node-version-guard.ts.
 *
 * THIS MODULE IS SILENT. It emits nothing: no `console.*`, no logger import, no
 * direct stdout or stderr write. At module load there is no injected logger, and
 * on stdio stdout is reserved for JSON-RPC framing, so a stray write would
 * corrupt the protocol with nothing to catch it. A failure returns null.
 *
 * The `try/catch` and the memoisation both live HERE rather than in the caller,
 * so every consumer imports a value that cannot throw. That matters beyond the
 * adapter: #445 will make `src/tools/server_info.ts` a second consumer, and that
 * file is reachable from `src/tools/index.ts` into `actualToolsManager`, where an
 * uncaught resolution throw would break TOOL REGISTRATION rather than merely the
 * adapter. Resolving once at load also keeps a blocking `readFileSync` out of the
 * per-operation path, which runs inside the process-global api mutex.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PACKAGE = '@actual-app/api';

/** Exported for tests: an injectable start directory over a synthetic fixture
 *  tree, so the walk-up logic is covered without touching the live node_modules
 *  (an in-chain test may never depend on what happens to be installed, #321). */
export function readVersionFromTree(startDir: string, pkgName: string = PACKAGE): string | null {
  let dir = startDir;
  // Bounded walk: stop at the filesystem root, and never above a node_modules
  // boundary, so a nested copy resolves to ITS manifest rather than a parent's.
  for (let hops = 0; hops < 32; hops++) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (manifest?.name === pkgName && typeof manifest.version === 'string') return manifest.version;
    } catch {
      // No manifest at this level, or unreadable. Keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function resolveInstalledApiVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return readVersionFromTree(dirname(require.resolve(PACKAGE)));
  } catch {
    return null;
  }
}

/** The installed version, or null when it cannot be determined. Resolved ONCE at
 *  module load. Null is a normal state, not an error: every consumer must stay
 *  silent on it rather than reporting a sentinel. */
export const INSTALLED_API_VERSION: string | null = resolveInstalledApiVersion();
