/**
 * #605: docs:check module "index", the docs/README.md coverage guard.
 *
 * docs/README.md is the index of the docs tree. Every docs/**\/*.md page must be
 * linked from it, except the index itself and the two tooling folders
 * (docs/plans/**, read by the phase tooling, and docs/audit/**, the audit
 * artifacts). A page with no link is reported as `not in index: <path>`.
 *
 * Only presence is checked here. A link in the index that points at a missing file
 * or anchor is the links module's job (lychee), so the two never report the same
 * defect twice.
 *
 * Pages are enumerated with listMarkdownFiles from the markers module, so this
 * module sees exactly the file set the other docs:check modules see (tracked files
 * in a git checkout, a recursive walk anywhere else).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { listMarkdownFiles } from './markers.mjs';

export const name = 'index';

const INDEX = 'docs/README.md';
const EXCLUDED_PREFIXES = ['docs/plans/', 'docs/audit/'];

/** True for a page the index must link. */
function inScope(file) {
  if (!file.startsWith('docs/') || file === INDEX) return false;
  return !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

/**
 * Every relative link target in the index, resolved to a repo-relative POSIX path.
 * Covers inline links `[text](target "title")` (titles in double quotes, single
 * quotes or parentheses), `<target>` forms (which may contain spaces) and reference
 * definitions `[id]: target`. HTML comments are removed first, because a commented
 * link does not render. Anchors and queries are stripped; URLs with a scheme,
 * protocol-relative URLs and pure anchors are ignored.
 */
function indexTargets(text) {
  const visible = text.replace(/<!--[\s\S]*?-->/g, '');
  const title = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
  const inline = new RegExp(String.raw`\]\(\s*(?:<([^>\n]+)>|([^)\s<>]+))${title}\s*\)`, 'g');
  const raw = [];
  for (const m of visible.matchAll(inline)) raw.push(m[1] ?? m[2]);
  for (const m of visible.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>\n]+)>|(\S+))(?:\s+.*)?$/gm)) raw.push(m[1] ?? m[2]);
  const targets = new Set();
  for (const target of raw) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) continue;
    const path = safeDecode(target.split('#')[0].split('?')[0]);
    if (!path) continue;
    targets.add(posix.normalize(posix.join('docs', path)));
  }
  return targets;
}

/** Percent-decodes a target; a malformed escape such as a bare `%` is kept literally. */
function safeDecode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export async function check({ root }) {
  const pages = listMarkdownFiles(root).filter(inScope);
  const problems = [];
  const indexPath = join(root, INDEX);
  let linked = new Set();
  if (existsSync(indexPath)) linked = indexTargets(readFileSync(indexPath, 'utf8'));
  else problems.push(`index missing: ${INDEX}`);
  for (const page of pages) {
    if (!linked.has(page)) problems.push(`not in index: ${page}`);
  }
  return { name, problems };
}
