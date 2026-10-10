import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRootPackageJson } from './node-version-guard.js';

/**
 * #541: the single source of this server's own version, shared by the MCP initialize
 * `serverInfo.version` (src/index.ts) and the `actual_server_info` tool.
 *
 * A build-time `VERSION` (set by the Docker build arg and by CI) wins. Otherwise a
 * developer checkout gets `<package version>-dev-<short hash>` when it is not on `main`.
 *
 * Git runs only when `.git` exists AT the package root, and always with that root as its
 * cwd. The published npm package has no `.git`, and without that check `git rev-parse`
 * would walk up from an install under some other repository (a consumer's node_modules)
 * and report THAT repository's branch and hash. `existsSync` also accepts the `.git` FILE
 * of a worktree or submodule.
 */
export function resolveMcpServerVersion(
  baseVersion: string,
  env: NodeJS.ProcessEnv,
  root: string,
  runGit: (args: string[]) => string,
): string {
  if (env.VERSION && env.VERSION !== 'unknown') return env.VERSION;
  if (!existsSync(join(root, '.git'))) return baseVersion;
  try {
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const hash = runGit(['rev-parse', '--short', 'HEAD']);
    if (!hash) return baseVersion;
    // A detached HEAD reports 'HEAD', which is not main, so it gets the suffix too.
    return branch !== 'main' ? `${baseVersion}-dev-${hash}` : baseVersion;
  } catch {
    // Git missing, not a repository, or the timeout fired: report the plain version.
    return baseVersion;
  }
}

let cached: string | undefined;

/**
 * This package's (the MCP server's) version, computed once per process. Unrelated to the
 * adapter's `getServerVersion()`, which returns the ACTUAL BUDGET server version.
 */
export function getMcpServerVersion(): string {
  if (cached !== undefined) return cached;
  // dist/src/lib/ to the package root. This one root is both the `.git` check directory
  // and git's cwd; never process.cwd(), which is wherever the server was started from.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const base = findRootPackageJson(root)?.version ?? 'unknown';
  // stderr is discarded so a "not a git repository" line never reaches the stdio channel
  // or the log, and the timeout keeps a hung git from blocking startup.
  const runGit = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  cached = resolveMcpServerVersion(base, process.env, root, runGit);
  return cached;
}
