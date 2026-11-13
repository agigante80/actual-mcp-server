#!/usr/bin/env node
/**
 * #668: measure the `tools/list` payload of each published-surface configuration, offline, and
 * keep the figures in scripts/docs/tools-list-sizes.json (committed, keys sorted, no timestamp).
 * The README toolset size table is generated from that JSON by `npm run docs:gen`.
 *
 * The method is the #486 one that tests/unit/tools_list_size_budget.test.js uses: initialise the
 * tool manager with dummy ACTUAL_* settings, take getPublishedToolNames(), build the entries with
 * buildToolListEntries and the same meta resolver the server uses (tool description, input
 * schema through z.toJSONSchema, outputSchema through outputJsonSchema, as src/index.ts and
 * src/server/stdioServer.ts do), and size them as Buffer.byteLength(JSON.stringify(entries)).
 * Bytes, not UTF-16 units. No server is started and no Actual server is contacted.
 *
 * Config is read at import, so every configuration runs in its own child process
 * (`--one <id>`); the parent only sets env and collects one result line from each.
 *
 *   node scripts/measure-tools-list-size.mjs            measure all, rewrite the JSON
 *   node scripts/measure-tools-list-size.mjs --check    exit 1 when the JSON differs from a fresh measurement
 *
 * Needs `npm run build` first (it reads dist/).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const SIZES_JSON = join(HERE, 'docs', 'tools-list-sizes.json');
const RESULT_PREFIX = 'TOOLS_LIST_SIZE_RESULT ';

/** One entry per configuration. `env` is the whole MCP_* environment of the run. */
export const CONFIGS = [
  { id: 'compact', label: 'Compact surface (default)', env: { MCP_TOOL_SURFACE: 'compact' } },
  { id: 'compact-chat', label: 'Compact, `MCP_TOOLSETS=chat`', env: { MCP_TOOL_SURFACE: 'compact', MCP_TOOLSETS: 'chat' } },
  { id: 'compact-read-only', label: 'Compact, `MCP_READ_ONLY=true`', env: { MCP_TOOL_SURFACE: 'compact', MCP_READ_ONLY: 'true' } },
  { id: 'legacy', label: '`MCP_TOOL_SURFACE=legacy`', env: { MCP_TOOL_SURFACE: 'legacy' } },
  { id: 'legacy-chat', label: 'Legacy, `MCP_TOOLSETS=chat`', env: { MCP_TOOL_SURFACE: 'legacy', MCP_TOOLSETS: 'chat' } },
  { id: 'legacy-read-only', label: 'Legacy, `MCP_READ_ONLY=true`', env: { MCP_TOOL_SURFACE: 'legacy', MCP_READ_ONLY: 'true' } },
];

/** Pure. Differences between a committed and a fresh result, one line each, naming both numbers. */
export function diffSizes(committed, fresh) {
  const lines = [];
  for (const id of new Set([...Object.keys(committed), ...Object.keys(fresh)])) {
    const a = committed[id];
    const b = fresh[id];
    if (!a) lines.push(`${id}: not in scripts/docs/tools-list-sizes.json, measured ${b.tools} tools and ${b.bytes} bytes`);
    else if (!b) lines.push(`${id}: committed but no longer a configuration`);
    else if (a.bytes !== b.bytes || a.tools !== b.tools || a.label !== b.label) {
      lines.push(`${id}: committed ${a.tools} tools and ${a.bytes} bytes (${a.label}), measured ${b.tools} tools and ${b.bytes} bytes (${b.label})`);
    }
  }
  return lines;
}

/** Pure. The JSON text: keys sorted at both levels, trailing newline, no timestamp. */
export function serializeSizes(sizes) {
  const sorted = {};
  for (const id of Object.keys(sizes).sort()) {
    const { bytes, label, tools } = sizes[id];
    sorted[id] = { bytes, label, tools };
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** Child side: measure the configuration this process was started with. */
async function measureHere() {
  const { buildToolListEntries } = await import(pathToFileURL(join(ROOT, 'dist/src/lib/tool-list-entry.js')).href);
  const { outputJsonSchema } = await import(pathToFileURL(join(ROOT, 'dist/src/lib/tool-output.js')).href);
  const manager = (await import(pathToFileURL(join(ROOT, 'dist/src/actualToolsManager.js')).href)).default;
  const { z } = await import('zod');
  await manager.initialize();
  const names = manager.getPublishedToolNames();
  const entries = buildToolListEntries(names, (name) => {
    const tool = manager.getTool(name);
    return {
      description: tool?.description,
      schema: tool?.inputSchema ? z.toJSONSchema(tool.inputSchema) : undefined,
      outputSchema: outputJsonSchema(tool),
    };
  });
  return { tools: names.length, bytes: Buffer.byteLength(JSON.stringify(entries)) };
}

/** Parent side: one child process per configuration, in order. Throws when a child fails. */
export function measureAll() {
  const result = {};
  for (const cfg of CONFIGS) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('MCP_')) delete env[key];
    Object.assign(env, {
      ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
      ACTUAL_PASSWORD: 'dummy',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      MCP_STDIO_MODE: 'true',
      ...cfg.env,
    });
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--one', cfg.id], { env, encoding: 'utf8' });
    const line = (child.stdout ?? '').split('\n').find((l) => l.startsWith(RESULT_PREFIX));
    if (child.status !== 0 || !line) {
      throw new Error(`measuring ${cfg.id} failed (exit ${child.status}); did you run npm run build?\n${child.stderr ?? ''}`);
    }
    const { tools, bytes } = JSON.parse(line.slice(RESULT_PREFIX.length));
    result[cfg.id] = { bytes, label: cfg.label, tools };
  }
  return result;
}

export function readCommitted() {
  return JSON.parse(readFileSync(SIZES_JSON, 'utf8'));
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  }
}

if (isDirectRun()) {
  const args = process.argv.slice(2);
  if (args[0] === '--one') {
    const measured = await measureHere();
    // Raw stdout: with MCP_STDIO_MODE set, console.log is routed to the logger and stderr.
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(measured)}\n`);
    process.exit(0);
  }
  const fresh = measureAll();
  for (const [id, m] of Object.entries(fresh)) console.log(`${id}: ${m.tools} tools, ${m.bytes} bytes`);
  if (args.includes('--check')) {
    const diffs = diffSizes(readCommitted(), fresh);
    for (const line of diffs) console.error(`stale: ${line}`);
    if (diffs.length > 0) {
      console.error('Run node scripts/measure-tools-list-size.mjs, then npm run docs:gen, and commit both.');
      process.exit(1);
    }
    console.log('scripts/docs/tools-list-sizes.json matches a fresh measurement');
  } else {
    writeFileSync(SIZES_JSON, serializeSizes(fresh));
    console.log('wrote scripts/docs/tools-list-sizes.json');
  }
}
