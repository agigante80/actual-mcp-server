/**
 * #602: docs:check module "markers", the recursive version-marker guard.
 *
 * scripts/version-bump.js rewrites `**Version:** N.N.N` and `**Tool Count:** N` in
 * exactly three places: the root README.md, TOP-LEVEL docs/*.md (it reads the docs
 * directory without recursing) and .github/copilot-instructions.md. A numeric
 * marker anywhere else is never updated and freezes silently at whatever value it
 * was written with. This module is the inverse of that set: it reports every
 * numeric marker OUTSIDE it as `frozen marker: <file>:<line>`.
 *
 * Only a marker followed by a number counts. The bare `**Version:**` token in prose
 * (docs/plans/docs-and-readme-restructure.md mentions it) is not a marker.
 *
 * It also owns the markdown file enumerator that the links module reuses, so both
 * modules see the same file set (see listMarkdownFiles below).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const name = 'markers';

const VERSION_MARKER = /\*\*Version:\*\*\s*\d+\.\d+\.\d+/;
const TOOL_COUNT_MARKER = /\*\*Tool Count:\*\*\s*\d+/;

/** Directories the non-git walk never descends into. */
const WALK_SKIP = new Set(['node_modules', '.git']);

const toPosix = (p) => p.split(sep).join('/');

/**
 * True only when `root` IS the top of a git work tree. A temp dir created inside
 * the repo would pass `--is-inside-work-tree` alone and be enumerated through the
 * repo's index (seeing none of its own untracked files), so the toplevel must also
 * equal `root`. Both sides go through realpath because the repo is reachable
 * through a symlink on the maintainer machine.
 */
function isGitCheckoutRoot(root) {
  const git = (args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') return false;
    return realpathSync(git(['rev-parse', '--show-toplevel'])) === realpathSync(root);
  } catch {
    // git missing, or `root` not inside any work tree: both mean "walk the tree".
    return false;
  }
}

function walkMarkdown(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(root, full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(toPosix(relative(root, full)));
  }
}

/**
 * Every `*.md` file under `root`, as sorted root-relative POSIX paths.
 *
 * In a git checkout this is `git ls-files '*.md'` (tracked files only, so the CLI on
 * the real repo ignores local-only and untracked docs). A git pathspec `*` matches
 * across `/`, so nested files are included. Index entries deleted from the work
 * tree are dropped. Anywhere else (the unit tests' temp trees are not checkouts)
 * it is a recursive walk that skips node_modules and .git.
 */
export function listMarkdownFiles(root) {
  const absRoot = resolve(root);
  let files;
  if (isGitCheckoutRoot(absRoot)) {
    files = execFileSync('git', ['-C', absRoot, 'ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && existsSync(join(absRoot, f)));
  } else {
    files = [];
    walkMarkdown(absRoot, absRoot, files);
  }
  return files.sort();
}

/** The files scripts/version-bump.js keeps current (its `docsToUpdate` set). */
function isVersionBumpManaged(file) {
  if (file === 'README.md' || file === '.github/copilot-instructions.md') return true;
  return /^docs\/[^/]+\.md$/.test(file);
}

export async function check({ root }) {
  const problems = [];
  for (const file of listMarkdownFiles(root)) {
    if (isVersionBumpManaged(file)) continue;
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (VERSION_MARKER.test(line) || TOOL_COUNT_MARKER.test(line)) {
        problems.push(`frozen marker: ${file}:${i + 1}`);
      }
    });
  }
  return { name, problems };
}
