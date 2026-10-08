// tests/unit/helpers/adapter-call-graph.js
//
// The adapter call-graph derivation, shared by tool_annotations.test.js (#379) and
// toolsets.test.js (#483). Two tests need the same answer to "which tools can write?", and
// one inline copy per test is how they drift apart. Both import this.
//
// The writer classification is keyed on `queueWriteOperation(` ONLY. An adapter function is a
// writer when its body calls it. (An older alternative for `batchBudgetUpdates` matched
// nothing after #516 removed that method, and a dead alternative reads as coverage.)
//
// FAIL CLOSED: a tool whose file is missing THROWS rather than returning "no calls". Both
// callers used to treat a missing file as "nothing to check", which turns a renamed tool
// file into a silent pass.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Strip comments before any analysis. A docblock that MENTIONS `queueWriteOperation` in
 * prose would otherwise be read as a call: that exact false positive classified
 * `adapter.getNote` as a write while building the annotations table, because `updateNote`'s
 * docblock sits between the two declarations.
 */
export function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Split an adapter source into { writes, reads } sets of exported function names. */
export function classifyAdapterSource(rawSrc) {
  let src = stripComments(rawSrc);
  // The default-export object lists EVERY method name, so without cutting it off the last
  // function's slice swallows it and is misread as writing. Asserted, not assumed: a guard
  // whose safety step is a no-op is the kind of thing these tests exist to catch.
  const cut = src.indexOf('\nexport default {');
  if (cut === -1) throw new Error('could not find the default-export block to cut; the classifier would misread the last function');
  src = src.slice(0, cut);

  const fns = [...src.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)];
  const writes = new Set();
  const reads = new Set();
  fns.forEach((m, i) => {
    const end = i + 1 < fns.length ? fns[i + 1].index : src.length;
    const body = src.slice(m.index, end);
    (/\bqueueWriteOperation\s*\(/.test(body) ? writes : reads).add(m[1]);
  });
  return { writes, reads };
}

/** Which adapter methods reach the write queue? */
export function classifyAdapterMethods() {
  return classifyAdapterSource(read('src/lib/actual-adapter.ts'));
}

/** The tool source path for a registered tool name. */
export function toolFileOf(toolName) {
  return `src/tools/${toolName.replace(/^actual_/, '')}.ts`;
}

/** Adapter method names called in a tool source (comments stripped). */
export function adapterCallsInSource(rawSrc) {
  return [...new Set([...stripComments(rawSrc).matchAll(/adapter\.(\w+)\s*\(/g)].map((m) => m[1]))];
}

/** The adapter methods a tool file calls. Throws when the tool's file is missing. */
export function adapterCallsOf(toolName) {
  const file = toolFileOf(toolName);
  if (!existsSync(join(ROOT, file))) {
    throw new Error(`${toolName}: expected tool file ${file} does not exist (the call-graph check fails closed)`);
  }
  return adapterCallsInSource(read(file));
}

// State changes a tool can make WITHOUT any adapter method: filesystem writes, tearing down a
// session, clearing per-session state, or mutating the connection pool. The call graph above
// cannot see these, so a tool that does any of them is a writer whatever its adapter calls say
// (#483 review). Reading the pool (getStats, has) and reading files are not state changes.
const FS_WRITE_FNS = [
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync', 'rm', 'rmSync',
  'unlink', 'unlinkSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'createWriteStream',
  'truncate', 'truncateSync', 'cp', 'cpSync',
];
const POOL_READS = new Set(['getStats', 'has', 'hasConnection', 'isLive', 'getConnectionInfo', 'isInitialized', 'canAcceptNewSession', 'getIdleTimeoutMinutes']);

/** Side-effect markers in a tool source (comments stripped); [] when it has none. */
export function sideEffectsInSource(rawSrc) {
  const src = stripComments(rawSrc);
  const found = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?fs(?:\/promises)?['"]/g)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0])) {
      if (FS_WRITE_FNS.includes(name)) found.add(`fs.${name}`);
    }
  }
  if (/import\s+\*\s+as\s+\w+\s+from\s*['"](?:node:)?fs(?:\/promises)?['"]|import\s+\w+\s+from\s*['"](?:node:)?fs(?:\/promises)?['"]/.test(src)) {
    found.add('fs (namespace or default import)');
  }
  for (const fn of ['shutdownActualForSession', 'clearSessionBudgetState']) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(src)) found.add(fn);
  }
  for (const m of src.matchAll(/\bconnectionPool\.(\w+)\s*\(/g)) {
    if (!POOL_READS.has(m[1])) found.add(`connectionPool.${m[1]}`);
  }
  return [...found].sort();
}

/** The side-effect markers in a tool file. Throws when the tool's file is missing. */
export function sideEffectsOf(toolName) {
  const file = toolFileOf(toolName);
  if (!existsSync(join(ROOT, file))) {
    throw new Error(`${toolName}: expected tool file ${file} does not exist (the side-effect check fails closed)`);
  }
  return sideEffectsInSource(read(file));
}
