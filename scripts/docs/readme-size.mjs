/**
 * #607: docs:check module "readme-size". README.md is also the Docker Hub long
 * description: the ci-cd.yml docker-hub-description step uploads it with
 * peter-evans/dockerhub-description and enable-url-completion, which rewrites every
 * relative link (inside code blocks too) into an absolute GitHub URL. Docker Hub caps
 * the full description at 25,000 bytes, so this module keeps the upload under it:
 *
 *   - projected size = raw bytes + 100 bytes per relative inline link, at most 24000.
 *     100 is a deliberate upper bound, not a copy of the action's rule: the longest
 *     prefix it adds is a raw.githubusercontent.com repo URL (63 bytes) plus a ref such
 *     as refs/tags/v99.99.99/ (20 bytes). The 1,000 bytes below the cap absorb anything
 *     that bound misses;
 *   - the first `<!-- runnable: <id> -->` install block opens by line 40, so the page
 *     shows how to install before the reader scrolls;
 *   - no relative link inside a fenced block (completion rewrites it into a URL that is
 *     wrong as shell or config text);
 *   - no reference-style link definitions (completion skips them, so they break on Hub);
 *   - no <details> (Docker Hub renders it as plain text).
 *
 * The install block is found with extractBlocks from scripts/install-snippets.mjs:51,
 * the same parser the install-snippet checks use, so "runnable block" means one thing.
 * That parser only returns bash and sh fences; the fence rule below has its own scan
 * because it applies to every fence whatever its info string.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBlocks } from '../install-snippets.mjs';

export const name = 'readme-size';

const LIMIT = 24000;
const PER_LINK = 100;
const FIRST_BLOCK_BY = 40;

const LINK_RE = /\]\(\s*<?([^)\s>]*)/g;

/**
 * A link target the completion would rewrite: anything not absolute and not mailto.
 * A same-page `#anchor` counts too: the action rewrites it into a .../README.md#anchor URL.
 */
function isRelative(target) {
  return target !== '' && !/^(?:https?:|mailto:)/i.test(target);
}

function relativeLinks(line) {
  let n = 0;
  for (const m of line.matchAll(LINK_RE)) if (isRelative(m[1])) n++;
  return n;
}

export async function check({ root }) {
  const path = join(root, 'README.md');
  if (!existsSync(path)) return { name, problems: ['README.md not found'] };
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const problems = [];

  const raw = Buffer.byteLength(text, 'utf8');
  const relative = lines.reduce((n, line) => n + relativeLinks(line), 0);
  const projected = raw + relative * PER_LINK;
  if (projected > LIMIT) {
    problems.push(
      `README.md uploads as ${projected} bytes (${raw} raw plus ${relative} relative links at ${PER_LINK} bytes each), over the ${LIMIT} byte limit`,
    );
  }

  const first = extractBlocks(text, 'README.md').find((b) => b.runnable);
  if (!first) problems.push('README.md has no <!-- runnable: <id> --> install block');
  else if (first.fenceLine > FIRST_BLOCK_BY) {
    problems.push(`first install block opens at line ${first.fenceLine}, must open by line ${FIRST_BLOCK_BY}`);
  }

  let fence = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!fence) {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open) {
        fence = open[1];
        return;
      }
      if (/^\s{0,3}\[[^\]]+\]:\s*\S/.test(line)) {
        problems.push(`README.md:${n}: reference-style link definition, use an inline link`);
      }
      if (/<details\b/i.test(line)) problems.push(`README.md:${n}: <details> does not render on Docker Hub`);
      return;
    }
    const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      fence = null;
      return;
    }
    if (relativeLinks(line) > 0) problems.push(`README.md:${n}: relative link inside a code block`);
  });

  return { name, problems };
}
