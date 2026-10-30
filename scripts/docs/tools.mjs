/**
 * #603: docs:check module "tools". Generates the README tools-summary block (the
 * toolset table, the `chat` preset sentence and the read-only sentence) from
 * dist/src/lib/toolsets.js, so no tool-surface number in it is typed by hand.
 *
 * The compiled module is imported lazily inside check() and generate() only, so
 * importing this file does nothing. toolsets.js imports only ./errors.js: it needs no
 * environment, prints nothing and leaves process.env unchanged. The block is a pure
 * function of its inputs (no timestamp, no total), so two runs give identical bytes.
 * Read or write comes from WRITE_CAPABLE, never from tool annotations.
 *
 * `scopes` is injectable for the unit tests, which run against stub registries.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const name = 'tools';

const BEGIN = '<!-- BEGIN GENERATED: tools-summary -->';
const END = '<!-- END GENERATED: tools-summary -->';
const DIST_REL = 'dist/src/lib/toolsets.js';
const NO_DIST = `${DIST_REL} not found (run npm run build)`;
const MARKER_ERR = 'README.md needs exactly one tools-summary BEGIN marker followed by one END marker';
const STALE_ERR = 'README.md tools-summary block is stale: run npm run build && npm run docs:gen';

/**
 * The only hand-written text the block carries: what each toolset contains. Reconciled
 * against the TOOLSETS keys, so a new toolset without an entry (or a stale entry) fails.
 */
export const TOOLSET_SCOPES = {
  context: 'Orientation, lookups and server information',
  transactions: 'Transaction reads, create, update, delete, import and transfers',
  analysis: 'Summaries, aggregates and balances',
  budget: 'Budget months, amounts, carryover, holds, transfers, batch updates and notes',
  rules: 'Rules and payee rules, including `actual_rules_create_batch`',
  schedules: 'Scheduled transactions',
  structure: 'Accounts, account groups, categories, category groups, payees and tags',
  query: '`actual_query_run` (SELECT only)',
  admin: 'Budget switching, import, export, bank sync and session management',
};

/** "`a`", "`a` and `b`", "`a`, `b` and `c`". */
function joinNames(names) {
  const q = names.map((n) => `\`${n}\``);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

/** Pure. Returns the block text including both markers. Throws on a scope mismatch. */
export function renderToolsSummary({ toolsets, chat, writeCapable, scopes }) {
  const keys = Object.keys(toolsets);
  for (const key of keys) {
    if (!(key in scopes)) throw new Error(`TOOLSET_SCOPES has no entry for toolset ${key}`);
  }
  for (const key of Object.keys(scopes)) {
    if (!(key in toolsets)) throw new Error(`TOOLSET_SCOPES names unknown toolset ${key}`);
  }
  const total = keys.reduce((n, k) => n + toolsets[k].length, 0);
  const rows = keys.map((k) => `| \`${k}\` | ${toolsets[k].length} | ${scopes[k]} |`);
  return [
    BEGIN,
    '<!-- Generated from dist/src/lib/toolsets.js by `npm run docs:gen`. Do not edit. -->',
    '| Toolset | Tools | Contents |',
    '|---------|-------|----------|',
    ...rows,
    '',
    `The \`chat\` preset publishes ${chat.length} tools: ${joinNames(chat)}.`,
    '',
    `\`MCP_READ_ONLY=true\` hides and refuses ${writeCapable.size} write-capable tools and leaves ${total - writeCapable.size} published.`,
    END,
  ].join('\n');
}

/**
 * Pure. Swaps the marked block in `text`, or throws the marker error. The block is
 * written with the line ending `text` already uses, so a CRLF checkout (Windows,
 * core.autocrlf) is neither reported stale nor left with mixed endings.
 */
export function replaceBlock(text, block) {
  const count = (needle) => text.split(needle).length - 1;
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (count(BEGIN) !== 1 || count(END) !== 1 || end < start) throw new Error(MARKER_ERR);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text.slice(0, start) + block.replace(/\r?\n/g, eol) + text.slice(end + END.length);
}

async function loadRegistry(root) {
  const file = join(root, DIST_REL);
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  return { toolsets: mod.TOOLSETS, chat: mod.PRESETS.chat, writeCapable: mod.WRITE_CAPABLE };
}

export async function check({ root, scopes = TOOLSET_SCOPES }) {
  const registry = await loadRegistry(root);
  if (!registry) return { name, problems: [], skipped: { tool: 'dist', reason: NO_DIST } };
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  try {
    const next = replaceBlock(readme, renderToolsSummary({ ...registry, scopes }));
    return { name, problems: next === readme ? [] : [STALE_ERR] };
  } catch (err) {
    return { name, problems: [err.message] };
  }
}

export async function generate({ root, scopes = TOOLSET_SCOPES }) {
  const registry = await loadRegistry(root);
  if (!registry) throw new Error(NO_DIST);
  const path = join(root, 'README.md');
  const readme = readFileSync(path, 'utf8');
  const next = replaceBlock(readme, renderToolsSummary({ ...registry, scopes }));
  if (next === readme) return [];
  writeFileSync(path, next);
  return ['README.md'];
}
