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
 * #680: the default surface is compact, so the block also states the compact chat and
 * read-only sets. They are derived from dist/src/compact/ (a compact tool is listed when
 * any operation behind it is selected; read-only drops a tool with any write-capable
 * operation, the resolver's own rule), never typed. `compact` is optional: absent, the
 * block carries the legacy sentences only.
 *
 * #668: the same module also owns the README capabilities blocks (tools by domain, the prompts
 * table and the measured toolset sizes), rendered by ./capabilities.mjs from the compact
 * registry, the prompt registry and scripts/docs/tools-list-sizes.json. They are checked and
 * generated with the tools-summary block, so a stale one is reported as `tools:` too. They exist
 * only when dist/src/compact/ does (a root with a stub toolsets.js alone has none).
 *
 * `scopes` is injectable for the unit tests, which run against stub registries.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROMPTS_BLOCK, SIZES_BLOCK, TOOLS_BLOCK, renderPrompts, renderSizes, renderToolsByDomain } from './capabilities.mjs';

export const name = 'tools';

const SUMMARY_BLOCK = 'tools-summary';
const markersOf = (id) => ({ begin: `<!-- BEGIN GENERATED: ${id} -->`, end: `<!-- END GENERATED: ${id} -->` });
const { begin: BEGIN, end: END } = markersOf(SUMMARY_BLOCK);
const COMPACT_TYPES_REL = 'dist/src/compact/types.js';
const PROMPTS_INDEX_REL = 'dist/src/prompts/index.js';
const PROMPTS_REGISTRY_REL = 'dist/src/prompts/registry.js';
const SIZES_REL = 'scripts/docs/tools-list-sizes.json';
const DIST_REL = 'dist/src/lib/toolsets.js';
const COMPACT_REGISTRY_REL = 'dist/src/compact/registry.js';
const COMPACT_DISPATCH_REL = 'dist/src/compact/dispatch.js';
const NO_DIST = `${DIST_REL} not found (run npm run build)`;
const markerErr = (id) => `README.md needs exactly one ${id} BEGIN marker followed by one END marker`;
const STALE_ERR = 'README.md tools-summary block is stale: run npm run build && npm run docs:gen';
const CAPABILITIES_STALE_ERR = 'README.md capabilities block is stale: run npm run build && npm run docs:gen';

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
export function renderToolsSummary({ toolsets, chat, writeCapable, scopes, compact }) {
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
    `| Toolset | ${compact ? 'Operations' : 'Tools'} | Contents |`,
    '|---------|-------|----------|',
    ...rows,
    '',
    ...(compact
      ? [
        `On the default compact surface the \`chat\` preset publishes ${compact.chat.length} tools: ${joinNames(compact.chat)}.`,
        '',
        `With \`MCP_TOOL_SURFACE=legacy\` the \`chat\` preset publishes ${chat.length} tools: ${joinNames(chat)}.`,
        '',
        `\`MCP_READ_ONLY=true\` publishes ${compact.readOnly.length} compact tools (${joinNames(compact.readOnly)}); every tool that can write is hidden whole. With \`MCP_TOOL_SURFACE=legacy\` it hides and refuses ${writeCapable.size} write-capable tools and leaves ${total - writeCapable.size} published.`,
      ]
      : [
        `The \`chat\` preset publishes ${chat.length} tools: ${joinNames(chat)}.`,
        '',
        `\`MCP_READ_ONLY=true\` hides and refuses ${writeCapable.size} write-capable tools and leaves ${total - writeCapable.size} published.`,
      ]),
    END,
  ].join('\n');
}

/**
 * Pure. Swaps the marked block in `text`, or throws the marker error. The block is
 * written with the line ending `text` already uses, so a CRLF checkout (Windows,
 * core.autocrlf) is neither reported stale nor left with mixed endings.
 */
export function replaceBlock(text, block, id = SUMMARY_BLOCK) {
  const { begin: BEGIN, end: END } = markersOf(id);
  const count = (needle) => text.split(needle).length - 1;
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (count(BEGIN) !== 1 || count(END) !== 1 || end < start) throw new Error(markerErr(id));
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return text.slice(0, start) + block.replace(/\r?\n/g, eol) + text.slice(end + END.length);
}

/** Pure. The compact tools the chat preset lists and the read-only surface keeps, in registry order. */
export function deriveCompact({ tools, chat, writeCapable }) {
  const chatSet = new Set(chat);
  return {
    chat: tools.filter((t) => t.legacy.some((n) => chatSet.has(n))).map((t) => t.name),
    readOnly: tools.filter((t) => !t.legacy.some((n) => writeCapable.has(n))).map((t) => t.name),
  };
}

async function loadCapabilities(root, compact, tools) {
  const typesFile = join(root, COMPACT_TYPES_REL);
  const promptsFile = join(root, PROMPTS_INDEX_REL);
  const promptsRegistryFile = join(root, PROMPTS_REGISTRY_REL);
  const sizesFile = join(root, SIZES_REL);
  for (const [file, rel] of [[typesFile, COMPACT_TYPES_REL], [promptsFile, PROMPTS_INDEX_REL], [promptsRegistryFile, PROMPTS_REGISTRY_REL]]) {
    if (!existsSync(file)) throw new Error(`${rel} not found (run npm run build)`);
  }
  if (!existsSync(sizesFile)) throw new Error(`${SIZES_REL} not found (run node scripts/measure-tools-list-size.mjs)`);
  const { COMPACT_DOMAINS } = await import(pathToFileURL(typesFile).href);
  const { PROMPT_DEFINITIONS } = await import(pathToFileURL(promptsFile).href);
  const { resolveOfferedPrompts } = await import(pathToFileURL(promptsRegistryFile).href);
  return {
    tools,
    domains: [...COMPACT_DOMAINS],
    prompts: [...PROMPT_DEFINITIONS],
    offeredReadOnly: resolveOfferedPrompts(PROMPT_DEFINITIONS, new Set(compact.readOnly)),
    sizes: JSON.parse(readFileSync(sizesFile, 'utf8')),
  };
}

async function loadRegistry(root) {
  const file = join(root, DIST_REL);
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  const base = { toolsets: mod.TOOLSETS, chat: mod.PRESETS.chat, writeCapable: mod.WRITE_CAPABLE };
  const registryFile = join(root, COMPACT_REGISTRY_REL);
  const dispatchFile = join(root, COMPACT_DISPATCH_REL);
  if (!existsSync(registryFile) || !existsSync(dispatchFile)) return base;
  const { COMPACT_TOOLS } = await import(pathToFileURL(registryFile).href);
  const { compactLegacyNames } = await import(pathToFileURL(dispatchFile).href);
  const tools = COMPACT_TOOLS.map((c) => ({ name: c.name, legacy: compactLegacyNames(c) }));
  const compact = deriveCompact({ tools, chat: base.chat, writeCapable: base.writeCapable });
  const docTools = COMPACT_TOOLS.map((c) => ({ name: c.name, domain: c.domain, summary: c.summary, examplePrompt: c.examplePrompt }));
  return { ...base, compact, capabilities: await loadCapabilities(root, compact, docTools) };
}

/** Pure. Every generated README block for a registry, in README order: [{ id, block, stale }]. */
export function renderBlocks({ capabilities, ...summaryInputs }) {
  const blocks = [{ id: SUMMARY_BLOCK, block: renderToolsSummary(summaryInputs), stale: STALE_ERR }];
  if (capabilities) {
    blocks.push(
      { id: TOOLS_BLOCK, block: renderToolsByDomain(capabilities), stale: CAPABILITIES_STALE_ERR },
      { id: PROMPTS_BLOCK, block: renderPrompts(capabilities), stale: CAPABILITIES_STALE_ERR },
      { id: SIZES_BLOCK, block: renderSizes(capabilities), stale: CAPABILITIES_STALE_ERR },
    );
  }
  return blocks;
}

export async function check({ root, scopes = TOOLSET_SCOPES }) {
  let registry;
  try {
    registry = await loadRegistry(root);
  } catch (err) {
    return { name, problems: [err.message] };
  }
  if (!registry) return { name, problems: [], skipped: { tool: 'dist', reason: NO_DIST } };
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const problems = [];
  try {
    for (const { id, block, stale } of renderBlocks({ ...registry, scopes })) {
      if (replaceBlock(readme, block, id) !== readme && !problems.includes(stale)) problems.push(stale);
    }
  } catch (err) {
    return { name, problems: [err.message] };
  }
  return { name, problems };
}

export async function generate({ root, scopes = TOOLSET_SCOPES }) {
  const registry = await loadRegistry(root);
  if (!registry) throw new Error(NO_DIST);
  const path = join(root, 'README.md');
  const readme = readFileSync(path, 'utf8');
  let next = readme;
  for (const { id, block } of renderBlocks({ ...registry, scopes })) next = replaceBlock(next, block, id);
  if (next === readme) return [];
  writeFileSync(path, next);
  return ['README.md'];
}
