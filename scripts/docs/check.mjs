#!/usr/bin/env node
/**
 * #602: `npm run docs:check` (and `npm run docs:gen`), the one orchestrator for
 * documentation checks. No framework and no directory scan: MODULES below is the
 * explicit list, awaited one at a time.
 *
 * Module contract (each scripts/docs/<module>.mjs):
 *   export const name                         the prefix of every line it causes
 *   export async function check({ root })     -> { name, problems: string[], skipped? }
 *   export async function generate({ root })  optional -> string[] (paths written)
 *
 * `problems` are UNPREFIXED; this file adds `<module>: `. A module never prints. To
 * skip (a tool it needs is missing) it returns `skipped: { tool, reason }` and this
 * file alone decides what that means:
 *   - locally: a loud `skip: <module>: <reason>` line, exit unaffected;
 *   - when CI is set: `<module>: <tool> required but not found` and exit 1. A check
 *     that silently skips in CI is a check that never runs.
 *
 * Usage:
 *   node scripts/docs/check.mjs           run every module's check()
 *   node scripts/docs/check.mjs --gen     run every module's generate()
 * Exit 0 when clean, 1 on any problem (or any CI skip).
 */

import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as links from './links.mjs';
import * as markers from './markers.mjs';
import * as configDrift from './config-drift.mjs';
import * as docsIndex from './index.mjs';

const MODULES = [links, markers, configDrift, docsIndex];

/** GitHub sets CI=true in every job. "false" and "0" are treated as unset. */
function ciIsSet(env) {
  const v = env?.CI;
  return v !== undefined && v !== '' && v !== 'false' && v !== '0';
}

/** Normalise the skip field. A bare string is accepted as the reason. */
function skipInfo(skipped, moduleName) {
  if (!skipped) return null;
  if (typeof skipped === 'string') return { tool: moduleName, reason: skipped };
  return { tool: skipped.tool ?? moduleName, reason: skipped.reason ?? 'skipped' };
}

/** Run every module's check(). Pure: returns lines instead of printing them. */
export async function run({ root, modules = MODULES, env = {} }) {
  const lines = [];
  let exitCode = 0;
  for (const mod of modules) {
    let result;
    try {
      result = await mod.check({ root });
    } catch (err) {
      lines.push(`${mod.name ?? 'unknown'}: check threw: ${err?.message ?? err}`);
      exitCode = 1;
      continue;
    }
    const modName = result?.name ?? mod.name ?? 'unknown';
    const skip = skipInfo(result?.skipped, modName);
    if (skip) {
      if (ciIsSet(env)) {
        // A wrong version is not a missing tool: name the reason so CI says which.
        lines.push(skip.reason === `${skip.tool} not installed`
          ? `${modName}: ${skip.tool} required but not found`
          : `${modName}: ${skip.tool} required: ${skip.reason}`);
        exitCode = 1;
      } else {
        lines.push(`skip: ${modName}: ${skip.reason}`);
      }
    }
    for (const problem of result?.problems ?? []) {
      lines.push(`${modName}: ${problem}`);
      exitCode = 1;
    }
  }
  return { exitCode, lines };
}

/** Run every module's optional generate(). No module defines one yet (#603 adds the first; config-drift, #604, has none). */
export async function generate({ root, modules = MODULES }) {
  const lines = [];
  for (const mod of modules) {
    if (typeof mod.generate !== 'function') continue;
    for (const path of (await mod.generate({ root })) ?? []) lines.push(`${mod.name}: wrote ${path}`);
  }
  return { exitCode: 0, lines };
}

/** Through realpath: the repo is reachable through a symlink on the maintainer machine. */
function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
}

if (isDirectRun()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const gen = process.argv.includes('--gen');
  const { exitCode, lines } = gen
    ? await generate({ root })
    : await run({ root, env: process.env });
  for (const line of lines) console.log(line);
  if (!gen && exitCode === 0) console.log(`docs:check: ${MODULES.length} modules, no problems`);
  process.exit(exitCode);
}
