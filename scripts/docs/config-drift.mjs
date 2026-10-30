/**
 * #604: docs:check module "config-drift". Runs scripts/config-drift.mjs against the
 * root in a CHILD process: importing dist/src/config.js validates and mutates
 * process.env at load, which must not happen inside the docs:check process, and one
 * spawned CLI keeps a single code path for `npm run config-drift` and docs:check.
 *
 * Mapping of the CLI's exit status:
 *   0       clean, no problems
 *   1       one problem per indented line of its "Config drift detected:" block
 *   2       dist/ is not built: skipped (a loud local skip, a failure in CI)
 *   other   `config-drift exited <status>` (or the signal that ended it)
 *
 * It defines no generate().
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'config-drift';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'config-drift.mjs');

/** The indented lines that follow "Config drift detected:" in the CLI's stderr. */
function problemLines(stderr) {
  const lines = stderr.split('\n');
  const start = lines.findIndex((l) => l.startsWith('Config drift detected:'));
  if (start === -1) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    out.push(line.trim());
  }
  return out;
}

export async function check({ root }) {
  // process.execPath, never `node` from PATH: a caller may run with a stripped PATH.
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return { name, problems: [] };
  if (r.status === 2) {
    return { name, problems: [], skipped: { tool: 'dist', reason: 'dist/ not built (run npm run build)' } };
  }
  if (r.status === 1) {
    const problems = problemLines(r.stderr ?? '');
    return { name, problems: problems.length ? problems : ['config-drift exited 1'] };
  }
  return { name, problems: [`config-drift exited ${r.status ?? r.signal ?? r.error?.message}`] };
}
