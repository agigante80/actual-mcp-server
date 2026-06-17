#!/usr/bin/env node
/**
 * scripts/tool-count.mjs  (#193)
 *
 * Enforce the tool count. Canonical = number of entries in IMPLEMENTED_TOOLS
 * (the same source verify-tools and version-bump.js use). This script owns the
 * PROSE / test / docker-description / constants total-count literals; version-bump.js
 * remains the sole writer of the `**Tool Count:**` markers and the package.json
 * description (those are NOT touched here).
 *
 * Strategy: an explicit allowlist of TOTAL-count anchors (phrase-anchored regexes).
 * Subset counts ("### Domain (N tools)", per-suite counts, per-phase counts) are out
 * of scope by construction, no anchor matches them, so --fix can never corrupt them.
 * A missed total simply stays stale and is surfaced by the non-failing advisory scan.
 *
 *   node scripts/tool-count.mjs            # --check (default): exit 1 on drift
 *   node scripts/tool-count.mjs --check
 *   node scripts/tool-count.mjs --fix      # rewrite drifting totals to canonical
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => join(ROOT, p);

export function getCanonicalCount() {
  const src = readFileSync(abs('src/actualToolsManager.ts'), 'utf8');
  return (src.match(/^\s*'actual_/gm) || []).length;
}

// In-scope files. NOT package.json and NOT the `**Tool Count:**` markers (version-bump.js owns those).
const FILES = [
  'README.md', 'CLAUDE.md', '.github/copilot-instructions.md',
  'docs/ARCHITECTURE.md', 'docs/guides/AI_CLIENT_SETUP.md', 'docs/TESTING_AND_RELIABILITY.md', 'docs/audit/FORK_ANALYSIS.md',
  '.github/CONTRIBUTING.md', 'docker/description/long.md', 'docker/description/short.md', 'src/lib/constants.ts',
  'tests/manual/tests/sanity.js', 'tests/manual/runner.js', 'tests/e2e/README.md', 'tests/manual/README.md',
  'tests/e2e/docker-all-tools.e2e.spec.ts',
];

/**
 * TOTAL-count anchor patterns. Each regex has exactly one capture group holding the
 * total number, and is anchored on distinctive surrounding text so it matches ONLY a
 * total, never a subset "(N tools)" header or a per-domain/per-phase count.
 * Applied (global) to every in-scope file.
 */
export const TOTAL_PATTERNS = [
  // Distinctive TOTAL phrasings (safe in any file; never match a subset "(N tools)" header).
  { re: /\ball (\d{2,3}) tools\b/gi, label: 'all N tools' },
  { re: /\*\*(\d{2,3}) tools\*\* across/g, label: '**N tools** across' },
  { re: /\*\*(\d{2,3}) tools\*\* listed/g, label: '**N tools** listed' },
  { re: /E2E \((\d{2,3}) tools\)/g, label: 'E2E (N tools)' },
  { re: /\b(\d{2,3})\/\1 tools\b/g, label: 'N/N tools (equal halves only)' },
  { re: /(\d{2,3}) tools, the most comprehensive/gi, label: 'N tools, most comprehensive' },
  { re: /\*\*(\d{2,3}) tools, the most comprehensive/gi, label: 'why-project bullet' },
  { re: /(\d{2,3}) tools tested end-to-end/gi, label: 'N tools tested end-to-end' },
  { re: /(\d{2,3}) tools organized by category/gi, label: 'N tools organized by category' },
  { re: /(\d{2,3}) tools registered/gi, label: 'N tools registered' },
  { re: /Registers (\d{2,3}) tools/g, label: 'Registers N tools' },
  { re: /(?:exposing|providing|exposes|provides) \*\*(\d{2,3}) tools\*\*/gi, label: 'exposing **N tools**' },
  { re: /should list (\d{2,3}) tools/gi, label: 'should list N tools' },
  { re: /\((\d{2,3}) tools in IMPLEMENTED_TOOLS/g, label: '(N tools in IMPLEMENTED_TOOLS' },
  { re: /\((\d{2,3}) tools, Zod/g, label: '(N tools, Zod' },
  { re: /\((\d{2,3}) tools \+ index/g, label: '(N tools + index' },
  { re: /Production-ready, (\d{2,3}) tools/g, label: 'Production-ready, N tools' },
  { re: /(\d{2,3}) tools implemented/g, label: 'N tools implemented' },
  { re: /tool definitions \((\d{2,3}) tools\)/g, label: 'tool definitions (N tools)' },
  { re: /│\s*\((\d{2,3}) tools\)/g, label: 'ASCII diagram (N tools)' },
  { re: /(\d{2,3}) tools loaded with/g, label: 'N tools loaded with' },
  { re: /Budget: (\d{2,3}) tools/g, label: 'Budget: N tools (short desc)' },
  { re: /(\d{2,3}) tools smoke validation/gi, label: 'N tools smoke validation' },
  { re: /(\d{2,3}) tools execute successfully/gi, label: 'N tools execute successfully' },
  { re: /(\d{2,3}) tools[:)] (?:stub|response-shape| stub|registered correctly)/gi, label: 'N tools: stub (TESTING)' },
  { re: /(\d{2,3}) tools, 80\+/g, label: 'N tools, 80+ (TESTING)' },
  { re: /Returns (\d{2,3}) tools/g, label: 'Returns N tools (TESTING)' },
  { re: /(\d{2,3}) tools returned/g, label: 'N tools returned (TESTING)' },
  { re: /FULL Level \((\d{2,3}) tools/g, label: 'FULL Level (N tools)' },
  { re: /(\d{2,3}) tools, 100% coverage/g, label: 'N tools, 100% coverage' },
  { re: /across (\d{2,3}) tools/g, label: 'across N tools' },
  // TOTAL forms that carry no lowercase " tools" token, so neither the anchors above
  // nor the advisory scan caught them: a comparison-table cell, the hyphenated
  // "N-tool smoke" phrasing, the Docker Hub description headings, and two TESTING
  // table cells (a "+ shape checks" count and an "N/N" coverage cell without "tools").
  // All are whole-server totals; none can match a single-digit per-domain subset.
  { re: /(\d{2,3})-tool smoke/gi, label: 'N-tool smoke (hyphenated)' },
  { re: /\*\*(\d{2,3}) Implemented Tools\*\*/g, label: '**N Implemented Tools** (docker)' },
  { re: /Available Tools \((\d{2,3}) Total\)/g, label: 'Available Tools (N Total) (docker)' },
  { re: /\| (\d{2,3}) \+ shape checks/g, label: 'N + shape checks (TESTING cell)' },
  { re: /\| (\d{2,3})\/\1 \|/g, label: 'N/N table cell (no tools word)' },
  // EXPECTED_TOOL_COUNT numeric spots (only where a number is present)
  { re: /EXPECTED_TOOL_COUNT \|\| '(\d{2,3})'/g, label: "EXPECTED_TOOL_COUNT || 'N'" },
  { re: /EXPECTED_TOOL_COUNT[^\n]*?\(default:?\s*`?(\d{2,3})`?\)/gi, label: 'EXPECTED_TOOL_COUNT (default: N)' },
  { re: /EXPECTED_TOOL_COUNT`? \| `(\d{2,3})` \|/g, label: 'EXPECTED_TOOL_COUNT | N | (table)' },
];

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

/**
 * Returns { drift: [{file,line,found,expected,label,context}], stale: [{label}], unclassified: [{file,line,context}] }
 */
export function analyze() {
  const canonical = getCanonicalCount();
  const drift = [];
  const matchedSpans = new Map(); // file -> array of [start,end]
  const patternHits = new Map(); // label -> count

  for (const file of FILES) {
    const p = abs(file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    matchedSpans.set(file, []);
    for (const { re, label } of TOTAL_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        patternHits.set(label, (patternHits.get(label) || 0) + 1);
        matchedSpans.get(file).push([m.index, m.index + m[0].length]);
        const count = Number(m[1]); // group 1 is always the total count
        if (count !== canonical) {
          drift.push({
            file, line: lineOf(content, m.index), found: count,
            expected: canonical, label, context: m[0].slice(0, 60),
          });
        }
      }
    }
  }

  // Stale-anchor guard: a pattern that matched nothing anywhere is dead and may be hiding drift.
  const stale = TOTAL_PATTERNS.filter((p) => !patternHits.has(p.label)).map((p) => ({ label: p.label }));

  // Advisory: any `N tools` in an in-scope file not covered by a TOTAL anchor (likely a subset, but flag for awareness).
  const unclassified = [];
  for (const file of FILES) {
    const p = abs(file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    const spans = matchedSpans.get(file) || [];
    // Case-insensitive and singular/hyphen-aware so a total in an unanticipated
    // phrasing ("71-tool", "71 Tools") is at least surfaced here, not silently stale.
    const re = /\b(\d{2,3})[ -]tools?\b/gi;
    let m;
    while ((m = re.exec(content)) !== null) {
      const covered = spans.some(([s, e]) => m.index >= s && m.index < e);
      if (!covered && Number(m[1]) !== canonical) {
        unclassified.push({ file, line: lineOf(content, m.index), context: content.split('\n')[lineOf(content, m.index) - 1].trim().slice(0, 80) });
      }
    }
  }
  return { canonical, drift, stale, unclassified };
}

export function applyFix() {
  const canonical = getCanonicalCount();
  let changed = 0;
  for (const file of FILES) {
    const p = abs(file);
    if (!existsSync(p)) continue;
    let content = readFileSync(p, 'utf8');
    let fileChanged = false;
    for (const { re, label } of TOTAL_PATTERNS) {
      content = content.replace(re, (full) => {
        // N/N has two equal halves to update; every other pattern's count is the FIRST
        // 2-3 digit number, replace only that so other numbers (80+, 100%) are preserved.
        const fixed = label.startsWith('N/N')
          ? full.replace(/\d{2,3}/g, String(canonical))
          : full.replace(/\d{2,3}/, String(canonical));
        if (fixed !== full) { fileChanged = true; changed++; }
        return fixed;
      });
    }
    if (fileChanged) writeFileSync(p, content);
  }
  return changed;
}

// CLI
const isMain = process.argv[1] && process.argv[1].endsWith('tool-count.mjs');
if (isMain) {
  const mode = process.argv.includes('--fix') ? 'fix' : 'check';
  if (mode === 'fix') {
    const n = applyFix();
    const after = analyze();
    console.log(`tool-count: canonical=${after.canonical}, applied ${n} fix(es). Drift now: ${after.drift.length}.`);
    process.exit(after.drift.length === 0 ? 0 : 1);
  }
  const { canonical, drift, stale, unclassified } = analyze();
  console.log(`tool-count: canonical=${canonical}`);
  if (unclassified.length) {
    console.log(`\nAdvisory (unclassified "N tools", not enforced, likely subsets):`);
    for (const u of unclassified) console.log(`  ${u.file}:${u.line}  ${u.context}`);
  }
  if (stale.length) {
    console.log(`\nSTALE anchors (matched nothing, the rule may be dead):`);
    for (const s of stale) console.log(`  ${s.label}`);
  }
  if (drift.length) {
    console.log(`\nDRIFT (${drift.length}) total-count literals != ${canonical}:`);
    for (const d of drift) console.log(`  ${d.file}:${d.line}  found ${d.found}, expected ${d.expected}  | ${d.context}  [${d.label}]`);
    process.exit(1);
  }
  console.log(stale.length ? '\nNo drift, but stale anchors above (review).' : '\nNo drift. All total-count literals match canonical.');
  process.exit(stale.length ? 1 : 0);
}
