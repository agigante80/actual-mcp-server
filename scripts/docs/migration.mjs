/**
 * #669: docs:check module "migration". Generates the legacy-to-compact table in
 * docs/guides/migrating-to-compact-tools.md (between the tool-migration markers) from the
 * compact registry, so no row is typed by hand.
 *
 * One row per legacy name in IMPLEMENTED_TOOLS (read from src/actualToolsManager.ts, in its
 * order). A legacy tool reached from several compact actions lists every one of them. The
 * out-of-scope legacy tools come from the OUT_OF_SCOPE export of src/compact/registry.ts, the
 * same list the parity test imports. Derived per use: the compact tool, its selector value, the
 * route trigger, renamed keys, a wrap, dropped keys and fixed values. The one hand-written part
 * is BUILD_NOTES: a target with a `build` hook needs a note explaining the value translation,
 * and the generator fails naming the row when it has none (or when a note names no build row).
 *
 * The compiled registry is imported lazily inside check() and generate() only. The block is a
 * pure function of its inputs, so two runs give identical bytes. `notes` is injectable for the
 * unit tests, which run against stub registries.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const name = 'migration';

const BEGIN = '<!-- BEGIN GENERATED: tool-migration -->';
const END = '<!-- END GENERATED: tool-migration -->';
const PAGE = 'docs/guides/migrating-to-compact-tools.md';
const MANAGER_REL = 'src/actualToolsManager.ts';
const REGISTRY_REL = 'dist/src/compact/registry.js';
const NO_DIST = `${REGISTRY_REL} not found (run npm run build)`;
const MARKER_ERR = `${PAGE} needs exactly one tool-migration BEGIN marker followed by one END marker`;
const STALE_ERR = `${PAGE} tool-migration block is stale: run npm run build && npm run docs:gen`;

/**
 * The only hand-written text in the table: what a `build` hook does to the arguments. Keyed
 * `<tool>.<action>` (or `<tool>.<action>.<first trigger>` for a route). Reconciled against the
 * registry both ways, so a new build row without a note and a stale note both fail.
 */
export const BUILD_NOTES = {
  'manage_budget_months.set_note': '`month` becomes `id: "budget-<month>"`, so `month: "2026-11"` is sent as `id: "budget-2026-11"`',
};

const q = (s) => `\`${s}\``;

/** Every use of a legacy tool: { tool, selector, action, isDefault, target, route? } in registry order. */
function collectUses(compactTools) {
  const uses = new Map();
  const add = (legacy, use) => uses.set(legacy, [...(uses.get(legacy) ?? []), use]);
  for (const spec of compactTools) {
    const selector = spec.selector === undefined ? 'action' : spec.selector;
    for (const [action, row] of spec.actions) {
      add(row.legacy, { tool: spec.name, selector, action, target: row });
      for (const route of row.routes ?? []) add(route.legacy, { tool: spec.name, selector, action, target: route, route });
    }
  }
  return uses;
}

/** The call as the compact tool takes it: `tool` with its selector value, and the route trigger. */
function callCell(use) {
  const sel = use.selector === null ? '' : ` (${q(`${use.selector}: "${use.action}"`)})`;
  const route = use.route ? `, when ${use.route.triggers.map(q).join(' or ')} is set` : '';
  return `${q(use.tool)}${sel}${route}`;
}

/** The key and value changes the compact layer makes before calling the legacy tool. */
function changeCell(use, notes, problems) {
  const t = use.target;
  const parts = [];
  const rename = Object.entries(t.rename ?? {}).filter(([a, b]) => a !== b);
  if (rename.length) parts.push(`${rename.map(([a, b]) => `${q(a)} is sent as ${q(b)}`).join('; ')}`);
  if (t.drop?.length) parts.push(`${t.drop.map(q).join(', ')} is not forwarded`);
  if (t.wrap) {
    parts.push(`keys other than ${t.wrap.top.map(q).join(', ')} are sent under ${q(t.wrap.into)}`);
  }
  const fixed = Object.entries(t.fixed ?? {});
  if (fixed.length) parts.push(`sets ${fixed.map(([k, v]) => q(`${k}: ${JSON.stringify(v)}`)).join(', ')}`);
  if (t.build) {
    const key = use.route ? `${use.tool}.${use.action}.${use.route.triggers[0]}` : `${use.tool}.${use.action}`;
    if (notes[key]) parts.push(notes[key]);
    else problems.push(`build row ${key} has no entry in BUILD_NOTES`);
  }
  return parts.length ? parts.join('; ') : 'none';
}

function buildKeys(compactTools) {
  const keys = [];
  for (const [, list] of collectUses(compactTools)) {
    for (const use of list) {
      if (!use.target.build) continue;
      keys.push(use.route ? `${use.tool}.${use.action}.${use.route.triggers[0]}` : `${use.tool}.${use.action}`);
    }
  }
  return keys;
}

/**
 * Pure. Returns the block text including both markers. Throws, naming the tool or row, when a
 * legacy tool is unmapped, a compact row names an unregistered tool, a build row has no note,
 * or a note names no build row.
 */
export function renderMigrationTable({ legacyNames, compactTools, outOfScope, notes = BUILD_NOTES }) {
  const uses = collectUses(compactTools);
  const legacy = new Set(legacyNames);
  const problems = [];
  for (const [n] of uses) if (!legacy.has(n)) problems.push(`compact registry maps unregistered tool ${n}`);
  for (const n of outOfScope) if (!legacy.has(n)) problems.push(`out-of-scope tool ${n} is not registered`);
  const out = new Set(outOfScope);
  const rows = [];
  for (const n of legacyNames) {
    const list = uses.get(n);
    if (!list && !out.has(n)) { problems.push(`${n} is not mapped to a compact tool and not out of scope`); continue; }
    if (list && out.has(n)) { problems.push(`${n} is both mapped and out of scope`); continue; }
    if (!list) {
      rows.push(`| ${q(n)} | not in the compact surface; legacy only | none |`);
      continue;
    }
    const calls = list.map(callCell).join('<br>');
    const changes = list.map((u) => changeCell(u, notes, problems)).join('<br>');
    rows.push(`| ${q(n)} | ${calls} | ${changes} |`);
  }
  const wanted = new Set(buildKeys(compactTools));
  for (const key of Object.keys(notes)) if (!wanted.has(key)) problems.push(`BUILD_NOTES entry ${key} names no build row`);
  if (problems.length) throw new Error([...new Set(problems)].join('; '));
  return [
    BEGIN,
    '<!-- Generated from dist/src/compact/registry.js by `npm run docs:gen`. Do not edit. -->',
    '| Legacy tool | Compact call | What the compact layer changes |',
    '|---|---|---|',
    ...rows,
    END,
  ].join('\n');
}

/** Pure. Swaps the marked block in `text`, or throws the marker error. Keeps the file's line ending. */
export function replaceBlock(text, block) {
  const count = (needle) => text.split(needle).length - 1;
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (count(BEGIN) !== 1 || count(END) !== 1 || end < start) throw new Error(MARKER_ERR);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text.slice(0, start) + block.replace(/\r?\n/g, eol) + text.slice(end + END.length);
}

/** The IMPLEMENTED_TOOLS names, in the order the manager lists them. */
export function readLegacyNames(root) {
  const src = readFileSync(join(root, MANAGER_REL), 'utf8');
  const start = src.indexOf('const IMPLEMENTED_TOOLS = [');
  const end = src.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error(`${MANAGER_REL} has no IMPLEMENTED_TOOLS array`);
  return [...src.slice(start, end).matchAll(/^\s*'(actual_[A-Za-z0-9_]+)'/gm)].map((m) => m[1]);
}

async function loadInputs(root) {
  const file = join(root, REGISTRY_REL);
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  return { legacyNames: readLegacyNames(root), compactTools: mod.COMPACT_TOOLS, outOfScope: mod.OUT_OF_SCOPE };
}

export async function check({ root, notes = BUILD_NOTES }) {
  const inputs = await loadInputs(root);
  if (!inputs) return { name, problems: [], skipped: { tool: 'dist', reason: NO_DIST } };
  const pagePath = join(root, PAGE);
  if (!existsSync(pagePath)) return { name, problems: [`${PAGE} not found`] };
  const page = readFileSync(pagePath, 'utf8');
  try {
    const next = replaceBlock(page, renderMigrationTable({ ...inputs, notes }));
    return { name, problems: next === page ? [] : [STALE_ERR] };
  } catch (err) {
    return { name, problems: [err.message] };
  }
}

export async function generate({ root, notes = BUILD_NOTES }) {
  const inputs = await loadInputs(root);
  if (!inputs) throw new Error(NO_DIST);
  const pagePath = join(root, PAGE);
  const page = readFileSync(pagePath, 'utf8');
  const next = replaceBlock(page, renderMigrationTable({ ...inputs, notes }));
  if (next === page) return [];
  writeFileSync(pagePath, next);
  return [PAGE];
}
