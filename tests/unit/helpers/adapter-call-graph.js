// tests/unit/helpers/adapter-call-graph.js
//
// Scope: tool classification only (which tools can write). Other source guards live in their own tests.
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
import { stripTsComments } from './source-text.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Split an adapter source into { writes, reads } sets of exported function names. */
export function classifyAdapterSource(rawSrc) {
  let src = stripTsComments(rawSrc);
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
  return [...new Set([...stripTsComments(rawSrc).matchAll(/adapter\.(\w+)\s*\(/g)].map((m) => m[1]))];
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
//
// #533: the scan is an IMPORT ALLOWLIST. A watched module may be used only through the
// reviewed reads below; anything else is reported, so an unlisted spelling fails loud instead
// of passing.
const FS_READS = new Set([
  'readFileSync', 'readFile', 'existsSync', 'readdirSync', 'readdir', 'statSync', 'stat',
  'lstatSync', 'lstat', 'accessSync', 'access', 'realpathSync', 'realpath', 'constants',
]);
const CONN_READS = new Set(['getConnectionState', 'canAcceptNewSession']);
const POOL_READS = new Set(['getStats', 'has', 'hasConnection', 'isLive', 'getConnectionInfo', 'isInitialized', 'canAcceptNewSession', 'getIdleTimeoutMinutes']);
const TEARDOWN_NAMES = ['shutdownActual', 'shutdownActualForSession', 'clearSessionBudgetState'];
const WATCHED = [
  ['fs', /^(?:node:)?fs(?:\/promises)?$/],
  ['actualConnection', /(?:^|\/)actualConnection(?:\.js)?$/],
  ['ActualConnectionPool', /(?:^|\/)ActualConnectionPool(?:\.js)?$/],
  ['actual-adapter', /(?:^|\/)actual-adapter(?:\.js)?$/],
  ['@actual-app/api', /^@actual-app\/api$/],
];
const watchedModule = (spec) => (WATCHED.find(([, re]) => re.test(spec)) ?? [null])[0];
const IDENT = '[A-Za-z_$][\\w$]*';
// A binding occurrence is not a property (.x), part of a longer word, or inside a path/string.
const BINDING_LEAD = "(?<![.\\w$'\"/-])";
const escapeRe = (s) => s.replace(/[$]/g, '\\$&');

/**
 * Side-effect markers in a tool source; [] when it has none. Returns a deduplicated, sorted
 * string[]. Runs on stripTsComments(rawSrc).
 *
 * ANALYSIS MODEL (a bounded text scanner; typescript 7 has no JS scanner API). It resolves
 * only: (a) the clause of each static `import ... from '<spec>'` (named bindings with `as`
 * aliases, default and namespace bindings; `import type` is skipped); (b) `import('<spec>')`
 * and `require('<spec>')` call sites, where <spec> is a literal only when it is a single- or
 * double-quoted string (a template literal counts as non-literal); (c) later occurrences of a
 * resolved local binding name in the same file (the connectionPool binding, and the
 * `const <x> = await import('@actual-app/api')` binding). It does NOT follow property flow,
 * other files, or data flow through other variables. Anything it cannot resolve on a watched
 * specifier is REPORTED, never followed; string contents are kept by stripTsComments, so a
 * call spelled inside a string fails loud. The teardown-name and `connectionPool.<m>(` name
 * checks are in addition to the allowlist, so a call with no visible import is still reported.
 */
export function sideEffectsInSource(rawSrc) {
  const src = stripTsComments(rawSrc);
  const found = new Set();
  const poolLocals = new Set();

  // (a) static imports
  const importRe = /\bimport\s+([^'"();]*?)\s*\bfrom\s*(['"])([^'"]+)\2/g;
  const importSpans = [];
  for (const m of src.matchAll(importRe)) {
    importSpans.push([m.index, m.index + m[0].length]);
    const clause = m[1].trim();
    if (/^type\s+[\w${*]/.test(clause)) continue;
    const mod = watchedModule(m[3]);
    if (!mod) continue;
    if (mod === '@actual-app/api') { found.add('@actual-app/api (static import)'); continue; }
    const ns = clause.match(/\*\s*as\s+([\w$]+)/);
    const named = clause.match(/\{([^}]*)\}/);
    const rest = clause.replace(/\*\s*as\s+[\w$]+/, '').replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    const def = rest.match(/^[\w$]+$/)?.[0];
    const names = named
      ? named[1].split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !/^type\s/.test(x))
        .map((x) => { const [orig, alias] = x.split(/\s+as\s+/); return { orig: orig.trim(), local: (alias ?? orig).trim() }; })
      : [];
    if (mod === 'actual-adapter') {
      if (ns) found.add('actual-adapter (namespace or default import)');
      if (def && def !== 'adapter') found.add('actual-adapter (default import not named adapter)');
      for (const n of names) found.add(n.orig);
      continue;
    }
    if (ns || def) found.add(`${mod} (namespace or default import)`);
    for (const n of names) {
      if (mod === 'fs' && !FS_READS.has(n.orig)) found.add(`fs.${n.orig}`);
      else if (mod === 'actualConnection' && !CONN_READS.has(n.orig)) found.add(n.orig);
      else if (mod === 'ActualConnectionPool') {
        if (n.orig === 'connectionPool') poolLocals.add(n.local);
        else found.add(n.orig);
      }
    }
  }
  for (const m of src.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) {
    if (watchedModule(m[2]) === '@actual-app/api') found.add('@actual-app/api (static import)');
  }

  // (b) dynamic import and require call sites
  const literal = (arg) => arg.match(/^(['"])([^'"\\]*)\1$/)?.[2];
  for (const m of src.matchAll(/\bimport\s*\(\s*([^)]*?)\s*\)/g)) {
    const spec = literal(m[1]);
    if (spec === undefined) { found.add('dynamic import (non-literal specifier)'); continue; }
    const mod = watchedModule(spec);
    if (!mod) continue;
    if (mod !== '@actual-app/api') { found.add(`${mod} (dynamic import)`); continue; }
    const decl = src.slice(0, m.index).match(new RegExp(`\\bconst\\s+(${IDENT})\\s*=\\s*await\\s*$`));
    if (!decl) { found.add('@actual-app/api (dynamic import not bound to a const)'); continue; }
    const b = escapeRe(decl[1]);
    const declAt = m.index - decl[0].length + decl[0].indexOf(decl[1], 'const'.length);
    for (const u of src.matchAll(new RegExp(`${BINDING_LEAD}${b}(?![\\w$])`, 'g'))) {
      if (u.index === declAt) continue;
      const after = src.slice(u.index + decl[1].length);
      const before = src.slice(0, u.index);
      const okPlain = /^\s*\.\s*q(?![\w$])/.test(after);
      const okCast = /\($/.test(before.trimEnd()) && /^\s+as\s+any\s*\)\s*\.\s*q(?![\w$])/.test(after);
      if (!okPlain && !okCast) found.add('@actual-app/api (use other than .q)');
    }
  }
  for (const m of src.matchAll(/\brequire\s*\(\s*([^)]*?)\s*\)/g)) {
    if (/module\s*\.\s*$/.test(src.slice(0, m.index))) continue; // reported by the alias rule below
    const spec = literal(m[1]);
    if (spec === undefined) { found.add('require (non-literal specifier)'); continue; }
    const mod = watchedModule(spec);
    if (mod) found.add(`${mod} (require)`);
  }
  if (/\bcreateRequire\s*\(|\bmodule\s*\.\s*require\s*\(/.test(src)) found.add('createRequire (require alias)');

  // (c) later occurrences of the local connectionPool binding (aliases included)
  let rest = src;
  for (const [from, to] of [...importSpans].reverse()) rest = rest.slice(0, from) + rest.slice(to);
  for (const local of poolLocals) {
    for (const u of rest.matchAll(new RegExp(`${BINDING_LEAD}${escapeRe(local)}(?![\\w$])`, 'g'))) {
      const call = rest.slice(u.index + local.length).match(/^\s*\??\.\s*([\w$]+)\s*\(/);
      if (!call) found.add('connectionPool (non-call use)');
      else if (!POOL_READS.has(call[1])) found.add(`connectionPool.${call[1]}`);
    }
  }

  // Name checks, kept whatever the import path.
  for (const fn of TEARDOWN_NAMES) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(src)) found.add(fn);
  }
  for (const m of src.matchAll(/\bconnectionPool\s*\??\.\s*(\w+)\s*\(/g)) {
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
