#!/usr/bin/env node
// TDQS v1.3 self-scoring harness (#640). Usage:
//   node tdqs.mjs capture <repoRoot> <out tools.json>
//   node tdqs.mjs score <tools.json> <outDir> [--runs 3] [--only a,b,c] [--batch 10]
//   node tdqs.mjs coherence <tools.json> <outDir> [--runs 3]
//   node tdqs.mjs report <tools.json> <scoreDir> [coherenceDir]
// Prompts are the verbatim Appendix A and B system prompts of
// https://github.com/glama-ai/tool-definition-quality-score (README), saved beside this script.
//   node tdqs.mjs reparse <dir>   (rebuild coherence-runN.json from the saved raw answers)
// Method, scorer and results: docs/audit/tdqs-baseline.md.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
// Scorer CLI: opencode (default; the #640 pin is the free Zen model opencode/deepseek-v4.1-flash-free),
// agy (TDQS_MODEL=gemini-4-argon) or grok (grok-4.7). Compare only runs made with the same scorer.
const CLI = process.env.TDQS_CLI || 'opencode';
const MODEL = process.env.TDQS_MODEL || { opencode: 'opencode/deepseek-v4.1-flash-free', agy: 'gemini-4-argon', grok: 'grok-4.7' }[CLI];
const EFFORT = process.env.TDQS_EFFORT || 'high';
// TDQS_TIMEOUT_MIN caps one scorer call (default 25); a free model can hang, and a killed call is retried.
// The project bans the long dash characters in tracked files, so the saved prompts spell them as the
// six-character escapes backslash u 2014 and backslash u 2013; decoding restores the verbatim text.
const loadPrompt = (f) => readFileSync(join(HERE, f), 'utf8').trimEnd().replace(/\\u(2014|2013)/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

// ---------------------------------------------------------------- signals (spec Stage 1)
function resolve(root, node, seen) {
  let n = node;
  while (n && typeof n.$ref === 'string' && n.$ref.startsWith('#/')) {
    if (seen.has(n.$ref)) return {};
    seen = new Set([...seen, n.$ref]);
    let cur = root;
    for (const p of n.$ref.slice(2).split('/')) cur = cur?.[p];
    n = cur ?? {};
  }
  return n ?? {};
}
const isNullBranch = (b) => b && (b.type === 'null');
// Required-subtree analysis: { req, depth, unions }. depth counts object levels.
function analyze(root, node, seen = new Set(), level = 0) {
  node = resolve(root, node, seen);
  if (!node || typeof node !== 'object' || level > 10) return { req: 0, depth: 0, unions: 0 };
  for (const k of ['anyOf', 'oneOf']) {
    if (Array.isArray(node[k])) {
      const live = node[k].filter((b) => !isNullBranch(b));
      const parts = live.map((b) => analyze(root, b, seen, level + 1));
      const unions = (live.length > 1 ? live.length - 1 : 0) + parts.reduce((s, p) => s + p.unions, 0);
      return { req: Math.max(0, ...parts.map((p) => p.req)), depth: Math.max(0, ...parts.map((p) => p.depth)), unions };
    }
  }
  if (Array.isArray(node.allOf)) {
    const parts = node.allOf.map((b) => analyze(root, b, seen, level + 1));
    return { req: parts.reduce((s, p) => s + p.req, 0), depth: Math.max(0, ...parts.map((p) => p.depth)), unions: parts.reduce((s, p) => s + p.unions, 0) };
  }
  if (node.type === 'array' && node.items) return analyze(root, node.items, seen, level + 1);
  if (node.properties && typeof node.properties === 'object') {
    const required = Array.isArray(node.required) ? node.required : [];
    let req = 0, depth = 0, unions = 0;
    for (const name of required) {
      const sub = node.properties[name];
      if (!sub) continue;
      const a = analyze(root, sub, seen, level + 1);
      req += 1 + a.req; depth = Math.max(depth, a.depth); unions += a.unions;
    }
    return { req, depth: 1 + depth, unions };
  }
  return { req: 0, depth: 0, unions: 0 };
}
export function signals(tool) {
  const s = tool.inputSchema || {};
  const props = s.properties || {};
  const keys = Object.keys(props);
  const described = keys.filter((k) => {
    const p = resolve(s, props[k], new Set());
    return typeof (props[k].description ?? p.description) === 'string' && (props[k].description ?? p.description).trim() !== '';
  });
  const a = keys.length ? analyze(s, s) : { req: 0, depth: 0, unions: 0 };
  const cost = a.req + 2 * Math.max(0, a.depth - 1) + 2 * a.unions;
  return {
    paramCount: keys.length,
    requiredParamCount: Array.isArray(s.required) ? s.required.length : 0,
    schemaDescriptionCoverage: keys.length ? Math.round((described.length / keys.length) * 100) : 100,
    paramsWithEnums: keys.filter((k) => Array.isArray(resolve(s, props[k], new Set()).enum)).length,
    hasNestedObjects: keys.some((k) => resolve(s, props[k], new Set()).type === 'object'),
    requiredFieldCount: a.req, schemaDepth: a.depth, unionChoiceCount: a.unions, invocationCost: cost,
  };
}

// ---------------------------------------------------------------- Appendix A user message
function userMessageA(tool, siblings) {
  const sg = signals(tool);
  const j = (v) => JSON.stringify(v, null, 2);
  return `TOOL NAME: ${tool.name}
TITLE: ${tool.title ?? 'null'}

DESCRIPTION:
"${tool.description}"

<input-schema>
${tool.inputSchema ? j(tool.inputSchema) : '{}'}
</input-schema>

<output-schema>
${tool.outputSchema ? j(tool.outputSchema) : 'None provided'}
</output-schema>

<annotations>
${tool.annotations ? j(tool.annotations) : 'None provided'}
</annotations>

CONTEXT SIGNALS:
- Parameter count: ${sg.paramCount}
- Required parameters: ${sg.requiredParamCount}
- Schema description coverage: ${sg.schemaDescriptionCoverage}%
- Parameters with enums: ${sg.paramsWithEnums}
- Has nested objects: ${sg.hasNestedObjects}

<sibling-tools>
${siblings.length ? siblings.join('\n') : 'None'}
</sibling-tools>

Respond with JSON only.`;
}

// ---------------------------------------------------------------- agy
function runCli(prompt, work) {
  const opts = { cwd: work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: Number(process.env.TDQS_TIMEOUT_MIN || 25) * 60 * 1000 };
  if (CLI === 'opencode') {
    const r = spawnSync(process.env.TDQS_OPENCODE || 'opencode', ['run', '-m', MODEL, '--format', 'json', prompt],
      { ...opts, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENCODE_PERMISSION: '{"edit":"deny","bash":"deny","webfetch":"deny"}' } });
    const ev = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const text = ev.filter((e) => e.type === 'text').map((e) => e.part?.text || '').join('');
    return { response: text, status: r.status === 0 && text ? 'SUCCESS' : `exit ${r.status}`, raw: ev.filter((e) => e.type !== 'text'), stderr: r.stderr };
  }
  if (CLI === 'grok') {
    const pf = join(work, 'prompt.txt'); writeFileSync(pf, prompt);
    const r = spawnSync('grok', ['--prompt-file', pf, '-m', MODEL, '--effort', EFFORT, '--tools', 'list_dir',
      '--deny', 'Bash', '--deny', 'Write', '--deny', 'Edit', '--deny', 'MCPTool', '--output-format', 'json'], opts);
    let o = null; try { o = JSON.parse(r.stdout); } catch { /* unparseable */ }
    return { response: o?.text ?? '', status: r.status === 0 && o?.text ? 'SUCCESS' : `exit ${r.status}`, raw: o && { ...o, text: undefined }, stderr: r.stderr };
  }
  const input = JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
  const r = spawnSync('agy', ['-p=', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--model', MODEL, '--effort', EFFORT, '--print-timeout', '20m'], { ...opts, input });
  const lines = (r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const res = lines.filter((l) => l.event === 'result').pop();
  return { response: res?.result?.response ?? res?.result?.text ?? res?.response ?? '', status: res?.result?.status ?? 'none', raw: res ?? null, stderr: r.stderr };
}
function agy(prompt, tag, outDir) {
  const work = mkdtempSync(join(tmpdir(), 'tdqs-cli-'));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const c = runCli(prompt, work);
    writeFileSync(join(outDir, `${tag}.attempt${attempt}.raw.json`), JSON.stringify({ cli: CLI, model: MODEL, status: c.status, response: c.response, result: c.raw, stderr: (c.stderr || '').slice(0, 4000) }, null, 2));
    const parsed = extractJson(c.response);
    if (parsed !== undefined) return parsed;
    console.error(`  ${tag}: attempt ${attempt} unparseable (status ${c.status})`);
  }
  throw new Error(`${tag}: no parseable JSON after 3 attempts`);
}
function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // Try whichever bracket opens first: an object answer contains arrays, and an array answer contains objects.
  const pairs = [['[', ']'], ['{', '}']].filter(([o]) => t.includes(o)).sort((a, b) => t.indexOf(a[0]) - t.indexOf(b[0]));
  for (const [o, c] of pairs) {
    const i = t.indexOf(o), k = t.lastIndexOf(c);
    if (i >= 0 && k > i) { try { return JSON.parse(t.slice(i, k + 1)); } catch { /* next */ } }
  }
  return undefined;
}

const DIMS = ['purpose_clarity', 'usage_guidelines', 'behavioral_transparency', 'parameter_semantics', 'conciseness_structure', 'contextual_completeness'];
const W = { purpose_clarity: 25, usage_guidelines: 20, behavioral_transparency: 20, parameter_semantics: 15, conciseness_structure: 10, contextual_completeness: 10 };
const round1 = (p, q) => Math.floor((20 * p + q) / (2 * q)) / 10;
const tdqsOf = (s) => round1(DIMS.reduce((h, d) => h + s[d] * W[d], 0), 100);
const tier = (x) => (x >= 3.5 ? 'A' : x >= 3 ? 'B' : x >= 2 ? 'C' : x >= 1 ? 'D' : 'F');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const valid = (o) => o && typeof o.tool === 'string' && o.scores && DIMS.every((d) => Number.isInteger(o.scores[d]?.score) && o.scores[d].score >= 1 && o.scores[d].score <= 5) && typeof o.annotation_contradiction === 'boolean';

function batchPrompt(system, tools, all) {
  const names = all.map((t) => t.name);
  const msgs = tools.map((t) => userMessageA(t, names.filter((n) => n !== t.name)));
  return `${system}

## Batch instruction (harness, not part of Appendix A)
The ${tools.length} tool definitions below are each a separate user message in the Appendix A format, separated by lines of "=====". Score EACH tool INDEPENDENTLY, exactly as if it were the only tool you received. Respond with JSON only: a JSON array with one object per tool, in the order given, each object being the Appendix A output object with one extra first field "tool" holding the TOOL NAME. The output must be strictly valid JSON: inside any string value never write a double quote character (quote with single quotes or backticks instead).

${msgs.join('\n\n=====\n\n')}`;
}

async function capture(repo, out) {
  const { Client } = await import(pathToFileURL(join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(repo, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href);
  const dataDir = mkdtempSync(join(tmpdir(), 'tdqs-data-'));
  const transport = new StdioClientTransport({
    command: process.execPath, args: [join(repo, 'dist/src/index.js'), '--stdio'], cwd: repo,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ACTUAL_SERVER_URL: 'http://127.0.0.1:5999', ACTUAL_PASSWORD: 'dummy',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000', MCP_BRIDGE_DATA_DIR: dataDir },
    stderr: 'ignore',
  });
  const client = new Client({ name: 'tdqs-capture', version: '1' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  writeFileSync(out, JSON.stringify(tools, null, 2));
  console.log(`captured ${tools.length} tools to ${out}`);
}

// Batch and coherence files are cached by run and batch number only, so a directory must only
// ever hold scores of one tool set. The first run stamps the directory with a hash of what it
// scored; a later run with different tools or descriptions is refused instead of reusing them.
function stampDir(outDir, scored) {
  const want = createHash('sha256').update(JSON.stringify(scored)).digest('hex');
  const stamp = join(outDir, 'scored-tools.sha256');
  const has = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : null;
  const cached = readdirSync(outDir).some((f) => /^(run\d+-batch\d+|coherence-run\d+)\.json$/.test(f));
  if (has && has !== want) throw new Error(`${outDir} holds scores of a different tool set; use a new directory`);
  if (!has && cached) throw new Error(`${outDir} holds unstamped scores; use a new directory`);
  writeFileSync(stamp, want + '\n');
}

function score(toolsPath, outDir) {
  const all = JSON.parse(readFileSync(toolsPath, 'utf8'));
  const only = flag('--only', '');
  const target = only ? all.filter((t) => only.split(',').includes(t.name)) : all;
  const runs = Number(flag('--runs', '3'));
  const size = Number(flag('--batch', '10'));
  const system = loadPrompt('appendixA-system.txt');
  mkdirSync(outDir, { recursive: true });
  stampDir(outDir, { kind: 'score', size, tools: target });
  for (let r = 1; r <= runs; r++) {
    for (let b = 0; b * size < target.length; b++) {
      const tag = `run${r}-batch${String(b + 1).padStart(2, '0')}`;
      const file = join(outDir, `${tag}.json`);
      if (existsSync(file)) { console.log(`  ${tag}: cached`); continue; }
      const batch = target.slice(b * size, (b + 1) * size);
      const t0 = Date.now();
      let res;
      for (let attempt = 1; attempt <= 2; attempt++) {
        res = agy(batchPrompt(system, batch, all), `${tag}.try${attempt}`, outDir);
        const arr = Array.isArray(res) ? res : [];
        const ok = batch.every((t) => arr.some((o) => o.tool === t.name && valid(o)));
        if (ok) break;
        console.error(`  ${tag}: schema mismatch on attempt ${attempt}`);
        if (attempt === 2) throw new Error(`${tag}: invalid output twice`);
      }
      writeFileSync(file, JSON.stringify(res, null, 2));
      console.log(`  ${tag}: ${batch.length} tools in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
}

function coherence(toolsPath, outDir) {
  const all = JSON.parse(readFileSync(toolsPath, 'utf8'));
  const runs = Number(flag('--runs', '3'));
  const system = loadPrompt('appendixB-system.txt');
  mkdirSync(outDir, { recursive: true });
  stampDir(outDir, { kind: 'coherence', tools: all });
  const sg = Object.fromEntries(all.map((t) => [t.name, signals(t)]));
  const cand = [];
  for (const t of all) {
    const ce = sg[t.name].invocationCost;
    const q = all.filter((o) => o.name !== t.name).map((o) => [o.name, sg[o.name].invocationCost])
      .filter(([, c]) => ce >= 2 * c && ce - c >= 4).sort((a, b) => b[1] - a[1]);
    if (q.length) cand.push(`${t.name} (cost ${ce}) may be shadowed by ${q[0][0]} (cost ${q[0][1]})`);
  }
  const user = `SERVER NAME: actual-mcp-server
TOOL COUNT: ${all.length}

<tools>
${all.map((t) => { const s = sg[t.name]; return `- ${t.name} [cost ${s.invocationCost}: ${s.requiredFieldCount} required, depth ${s.schemaDepth}, ${s.unionChoiceCount} union choices]: ${t.description || '(no description)'}`; }).join('\n')}
</tools>

<shadow-candidates>
${cand.length ? cand.join('\n') : 'None'}
</shadow-candidates>

Respond with JSON only.`;
  for (let r = 1; r <= runs; r++) {
    const file = join(outDir, `coherence-run${r}.json`);
    if (existsSync(file)) { console.log(`  coherence run${r}: cached`); continue; }
    const res = agy(`${system}\n\n(Harness note: the output must be strictly valid JSON; inside any string value never write a double quote character, use single quotes or backticks.)\n\n${user}`, `coherence-run${r}`, outDir);
    writeFileSync(file, JSON.stringify(res, null, 2));
    console.log(`  coherence run${r}: done`);
  }
}

function report(toolsPath, dir, cohDir) {
  const all = JSON.parse(readFileSync(toolsPath, 'utf8'));
  const files = readdirSync(dir).filter((f) => /^run\d+-batch\d+\.json$/.test(f));
  const by = new Map();
  for (const f of files) {
    const run = Number(f.match(/^run(\d+)/)[1]);
    for (const o of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (!valid(o)) continue;
      const t = all.find((x) => x.name === o.tool);
      const s = Object.fromEntries(DIMS.map((d) => [d, o.scores[d].score]));
      const desc = (t?.description || '').toLowerCase().trim();
      if (t && (desc === t.name.toLowerCase() || desc === String(t.title || '').toLowerCase())) s.purpose_clarity = Math.min(s.purpose_clarity, 2);
      by.set(o.tool, [...(by.get(o.tool) ?? []), { run, s, tdqs: tdqsOf(s), contra: o.annotation_contradiction, summary: o.summary }]);
    }
  }
  const rows = all.filter((t) => by.has(t.name)).map((t) => {
    const rs = by.get(t.name);
    const med = Object.fromEntries(DIMS.map((d) => [d, median(rs.map((x) => x.s[d]))]));
    const tq = median(rs.map((x) => x.tdqs));
    return { name: t.name, runs: rs.length, med, tdqs: tq, tier: tier(tq), runTdqs: rs.map((x) => x.tdqs), contradiction: rs.some((x) => x.contra), summary: rs[0].summary };
  });
  const n = rows.length;
  const sum10 = rows.reduce((s, r) => s + Math.round(r.tdqs * 10), 0);
  const min10 = Math.min(...rows.map((r) => Math.round(r.tdqs * 10)));
  const dq = round1(6 * sum10 + 4 * n * min10, 100 * n);
  const out = { scored: n, total: all.length, meanTdqs: round1(sum10, n * 10), minTdqs: min10 / 10, descriptionQuality: dq, rows };
  if (cohDir && existsSync(cohDir)) {
    const cr = readdirSync(cohDir).filter((f) => /^coherence-run\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(cohDir, f), 'utf8')));
    const keys = ['disambiguation', 'naming_consistency', 'tool_count_appropriateness', 'completeness'];
    const cm = Object.fromEntries(keys.map((k) => [k, median(cr.map((c) => c.scores[k].score))]));
    const runScores = cr.map((c) => round1(keys.reduce((s, k) => s + c.scores[k].score, 0), 4));
    const coh = median(runScores);
    out.coherence = { runs: cr.length, medians: cm, runScores, score: coh, shadowing: cr.map((c) => c.shadowing_risks) };
    out.overall = round1(7 * Math.round(dq * 10) + 3 * Math.round(coh * 10), 100);
  }
  console.log(JSON.stringify(out, null, 2));
}

const [cmd, a1, a2, a3] = args;
if (cmd === 'capture') await capture(a1, a2);
else if (cmd === 'score') score(a1, a2);
else if (cmd === 'coherence') coherence(a1, a2);
else if (cmd === 'report') report(a1, a2, a3);
else if (cmd === 'reparse') { for (const f of readdirSync(a1).filter((x) => /\.raw\.json$/.test(x)).sort()) { const r = JSON.parse(readFileSync(join(a1, f), 'utf8')); const v = extractJson(r.response ?? r.result?.result?.response); const m = f.match(/^(coherence-run\d+)\.attempt\d+\.raw\.json$/); if (m && v && !Array.isArray(v)) { writeFileSync(join(a1, `${m[1]}.json`), JSON.stringify(v, null, 2)); console.log(`reparsed ${f}`); } } }
else if (cmd === 'signals') { for (const t of JSON.parse(readFileSync(a1, 'utf8'))) console.log(t.name, JSON.stringify(signals(t))); }
else if (cmd === 'prompt') { const all = JSON.parse(readFileSync(a1, 'utf8')); const n = Number(a2 || 3); process.stdout.write(batchPrompt(loadPrompt('appendixA-system.txt'), all.slice(0, n), all)); }
else { console.error('usage: capture|score|coherence|report|signals'); process.exit(2); }
