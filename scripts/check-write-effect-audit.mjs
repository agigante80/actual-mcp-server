#!/usr/bin/env node
/**
 * #362: report when docs/audit/write-effect-audit.md is stale, and NEVER fail.
 *
 * The audit records which write tools can report success for an upstream call that did
 * nothing. Every disposition in it is a claim about one specific `@actual-app/api`
 * version, recorded in the file as `<!-- audited-api-version: X.Y.Z -->`. The release
 * train bumps that dependency on a schedule, so the document rots without anybody
 * touching it.
 *
 * WHY THIS CANNOT FAIL THE BUILD, EVER.
 *
 * #321: a check whose result changes with no commit used to live in the unit suite. An
 * upstream release turned it red, the auto-release train died for two nights, and a
 * security PR sat blocked behind a failure nobody had caused. The signal was real; the
 * placement was wrong. This script reports and exits 0, and it belongs in the
 * non-blocking api-surface-drift lane, never in `test:unit-js`.
 *
 * Exit code is 0 in every path, including a missing or malformed document. A staleness
 * reminder that can break a pipeline is worse than no reminder.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_PATH = join(ROOT, 'docs', 'audit', 'write-effect-audit.md');
const MARKER = /<!--\s*audited-api-version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*-->/;

/** Rows whose disposition depends on upstream continuing to THROW. Those are the ones a
 *  re-audit has to re-read: a SAFE row that is safe only because upstream throws can flip
 *  to CONFIRMED in any release, silently. */
const UPSTREAM_DEPENDENT = [
  'actual_categories_delete (upstream throws "Category with id X not found")',
  'actual_schedules_update (upstream throws "Schedule X not found")',
  'actual_transactions_delete / actual_transactions_update (upstream returns [] for a missing id)',
  'actual_budgets_setCarryover (upstream validates month and category)',
];

export function readAuditedVersion(text) {
  const m = MARKER.exec(text ?? '');
  return m ? m[1] : null;
}

export function buildReport(auditedVersion, installedVersion) {
  if (!auditedVersion) {
    return {
      stale: false,
      lines: [
        'write-effect audit: no `audited-api-version` marker found in docs/audit/write-effect-audit.md.',
        'The staleness check cannot run. This is reported, not enforced: see #321 for why.',
      ],
    };
  }
  if (!installedVersion) {
    return {
      stale: false,
      lines: ['write-effect audit: could not read the installed @actual-app/api version. Skipping.'],
    };
  }
  if (auditedVersion === installedVersion) {
    return {
      stale: false,
      lines: [`write-effect audit: current. Audited and installed @actual-app/api both ${installedVersion}.`],
    };
  }
  return {
    stale: true,
    lines: [
      `write-effect audit: STALE. Audited against @actual-app/api ${auditedVersion}, installed is ${installedVersion}.`,
      '',
      'Every disposition in docs/audit/write-effect-audit.md is a claim about the audited',
      'version. Re-run the extraction documented in that file and re-read the handlers whose',
      'disposition depends on upstream throwing:',
      '',
      ...UPSTREAM_DEPENDENT.map((entry) => `  - ${entry}`),
      '',
      'This is a reminder, not a gate. The run stays green.',
    ],
  };
}

function main() {
  let auditedVersion = null;
  try {
    auditedVersion = readAuditedVersion(readFileSync(AUDIT_PATH, 'utf8'));
  } catch {
    console.log('write-effect audit: docs/audit/write-effect-audit.md not found. Nothing to check.');
    return 0;
  }

  let installedVersion = null;
  try {
    installedVersion = JSON.parse(
      readFileSync(join(ROOT, 'node_modules', '@actual-app', 'api', 'package.json'), 'utf8'),
    ).version;
  } catch {
    installedVersion = null;
  }

  const { lines } = buildReport(auditedVersion, installedVersion);
  for (const line of lines) console.log(line);
  return 0;
}

// Exact entry-point check, through realpath. Node's ESM loader realpaths
// `import.meta.url`, so comparing a non-realpathed `process.argv[1]` makes this script a
// SILENT no-op when invoked through a symlink, and this repo is reachable through one
// (`/home/alien/dev-github-personal`). Silent-and-exit-0 is indistinguishable from
// "current", which is precisely the failure mode #362 exists to remove.
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  process.exit(main());
}
