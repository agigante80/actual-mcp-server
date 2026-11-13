/**
 * #668: the pure renderers behind the README capabilities blocks, driven by the "tools" docs
 * module (scripts/docs/tools.mjs): the tools by domain, the prompts table and the toolset size
 * table. Nothing here reads a file or the environment and nothing prints: every function is a
 * pure function of its inputs, so two runs give identical bytes (no timestamp).
 *
 * Sources, all loaded by tools.mjs and injected here so the unit tests can pass stubs:
 *   - compact tools and their `domain`, `summary` and `examplePrompt`: dist/src/compact/registry.js
 *     (docs-only fields on CompactToolSpec, never published in tools/list);
 *   - the domain headings and their order: COMPACT_DOMAINS from dist/src/compact/types.js;
 *   - prompts: PROMPT_DEFINITIONS and resolveOfferedPrompts from dist/src/prompts/;
 *   - sizes: scripts/docs/tools-list-sizes.json, written by scripts/measure-tools-list-size.mjs.
 */

export const TOOLS_BLOCK = 'capabilities-tools';
export const PROMPTS_BLOCK = 'capabilities-prompts';
export const SIZES_BLOCK = 'capabilities-sizes';

const GENERATED_NOTE = (source) => `<!-- Generated from ${source} by \`npm run docs:gen\`. Do not edit. -->`;
const wrap = (id, source, lines) => [`<!-- BEGIN GENERATED: ${id} -->`, GENERATED_NOTE(source), ...lines, `<!-- END GENERATED: ${id} -->`].join('\n');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();

function requireText(tool, field) {
  const v = tool[field];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`compact tool ${tool.name}: ${field} must be a non-empty string`);
  }
  return v.trim();
}

/** Pure. The tools grouped under one heading per domain, in `domains` order. Throws on bad data. */
export function renderToolsByDomain({ tools, domains }) {
  for (const tool of tools) {
    if (!domains.includes(tool.domain)) {
      throw new Error(`compact tool ${tool.name}: domain ${JSON.stringify(tool.domain)} is not one of ${domains.join(', ')}`);
    }
  }
  const lines = [];
  for (const domain of domains) {
    const members = tools.filter((t) => t.domain === domain);
    if (members.length === 0) throw new Error(`domain ${domain} has no compact tool`);
    lines.push('', `### ${domain}`, '');
    for (const tool of members) {
      lines.push(`- **\`${tool.name}\`**: ${requireText(tool, 'summary')} Example prompt: "${requireText(tool, 'examplePrompt')}"`);
    }
  }
  return wrap(TOOLS_BLOCK, 'dist/src/compact/registry.js', lines);
}

/** "`a`", "`a` and `b`", "`a`, `b` and `c`". */
function joinNames(names) {
  const q = names.map((n) => `\`${n}\``);
  return q.length < 2 ? q.join('') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

function paramsCell(args) {
  if (args.length === 0) return 'none';
  return args.map((a) => `\`${a.name}\` (${a.required ? 'required' : 'optional'})`).join(', ');
}

/**
 * Pure. One row per registered prompt. `offeredReadOnly` is the list `resolveOfferedPrompts`
 * returns over the read-only compact set, so which prompts the read-only surface hides is
 * derived, never typed.
 */
export function renderPrompts({ prompts, offeredReadOnly }) {
  if (prompts.length === 0) return wrap(PROMPTS_BLOCK, 'dist/src/prompts/index.js', ['No prompts are registered yet.']);
  const offered = new Set(offeredReadOnly.map((p) => p.name));
  const hidden = prompts.filter((p) => !offered.has(p.name)).map((p) => p.name);
  const rows = prompts.map((p) => `| \`${p.name}\` | ${paramsCell(p.arguments)} | ${cell(p.description)} |`);
  return wrap(PROMPTS_BLOCK, 'dist/src/prompts/index.js', [
    '| Prompt | Parameters | Description |',
    '|--------|------------|-------------|',
    ...rows,
    '',
    hidden.length === 0
      ? 'A prompt appears only when every tool it names is offered; with `MCP_READ_ONLY=true`, every prompt above is still offered.'
      : `A prompt appears only when every tool it names is offered. With \`MCP_READ_ONLY=true\`, ${joinNames(hidden)} ${hidden.length === 1 ? 'is' : 'are'} hidden, because ${hidden.length === 1 ? 'it names' : 'they name'} a tool that can write.`,
  ]);
}

const kib = (bytes) => (bytes / 1024).toFixed(1);

/** Pure. The measured `tools/list` size per configuration, rows in the key order of `sizes`. */
export function renderSizes({ sizes }) {
  const ids = Object.keys(sizes);
  if (ids.length === 0) throw new Error('tools-list-sizes.json has no configuration');
  const rows = ids.map((id) => {
    const { label, tools, bytes } = sizes[id];
    if (typeof label !== 'string' || !Number.isInteger(tools) || !Number.isInteger(bytes)) {
      throw new Error(`tools-list-sizes.json entry ${id} needs a label, an integer tools and an integer bytes`);
    }
    return `| ${cell(label)} | ${tools} | ${bytes} | ${kib(bytes)} |`;
  });
  return wrap(SIZES_BLOCK, 'scripts/docs/tools-list-sizes.json', [
    '| Configuration | Tools | `tools/list` bytes | KiB |',
    '|---------------|-------|--------------------|-----|',
    ...rows,
    '',
    'Measured offline, as the server builds the list (the bytes of the `tools/list` result, not an estimate); reproduce with `node scripts/measure-tools-list-size.mjs`.',
  ]);
}
