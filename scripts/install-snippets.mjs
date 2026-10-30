#!/usr/bin/env node
// scripts/install-snippets.mjs
//
// #600: one module for the install-snippet checks, shared by
// tests/unit/install_snippets.test.js and the CI startup smoke in the docker-e2e job, so the
// argv the unit test checks and the argv CI starts a container with cannot diverge.
//
// It never runs a shell on a documented block it has not checked: blocks are split into
// words by tokenize() (no expansion, no eval), and the smoke spawns `docker` with an argv
// array. The only blocks it hands to bash are marked runnable blocks whose every command is
// on COMMAND_ALLOWLIST, under a scrubbed environment whose PATH holds only the allowed tools.
//
// CLI:
//   node scripts/install-snippets.mjs smoke --image <tag> [--host-port <n>] [--drop-token]
//     --host-port   publish on this host port instead of the block's (local runs where the
//                   documented port is taken; CI uses the documented one)
//     --drop-token  test only: delete the token line from the generated .env, so the
//                   container must refuse to start (proves the smoke sees a crash)

import { readFileSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const RUNNABLE_RE = /^<!--\s*runnable:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->$/;
export const FRAGMENT_MARKER = '<!-- install-snippets: fragment -->';

// Commands a marked block may use. Anything else fails before the block runs.
export const COMMAND_ALLOWLIST = new Set([
  'docker', 'npx', 'curl', 'openssl', 'grep', 'install', 'chmod', 'printf', 'mv', 'umask', 'tail',
  '[', 'for', 'do', 'done', 'if', 'then', 'fi', '!',
]);

// The real binaries a marked block may reach; docker, npx and curl are stubs in the unit test.
export const REAL_TOOLS = ['bash', 'openssl', 'grep', 'install', 'chmod', 'printf', 'mv', 'tail'];

export const IMAGE_RE = /^(?:ghcr\.io\/agigante80\/actual-mcp-server|agigante80\/actual-mcp-server):[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const LOCALHOST_URL_RE = /ACTUAL_SERVER_URL=\S*(?:localhost|127\.0\.0\.1)/;

// ---------------------------------------------------------------------------------------------
// Markdown

/**
 * Every fenced block whose info string is `bash` or `sh`.
 * fenceLine is the 1-based line of the opening fence; the block's first line is fenceLine + 1.
 */
export function extractBlocks(markdown, file) {
  const lines = markdown.split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = line.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/);
      if (!m) continue;
      open = { indent: m[1].length, fence: m[2], lang: m[3].toLowerCase(), fenceLine: i + 1, body: [] };
      continue;
    }
    const close = line.match(/^(\s*)(`{3,}|~{3,})\s*$/);
    if (close && close[2][0] === open.fence[0] && close[2].length >= open.fence.length) {
      if (open.lang === 'bash' || open.lang === 'sh') {
        const above = open.fenceLine >= 2 ? lines[open.fenceLine - 2].trim() : '';
        const rm = above.match(RUNNABLE_RE);
        // An indented fence (inside a list item) carries its indent on every body line.
        const body = open.body.map((l) => (l.slice(0, open.indent).trim() === '' ? l.slice(open.indent) : l));
        blocks.push({
          file,
          lang: open.lang,
          fenceLine: open.fenceLine,
          text: body.join('\n'),
          runnable: rm ? rm[1] : null,
          fragment: above === FRAGMENT_MARKER,
        });
      }
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------
// Structural lint

/** Logical lines: every `\`-continued run joined into one, with the line it starts on. */
export function joinContinuations(block) {
  const out = [];
  let cur = null;
  block.text.split('\n').forEach((line, idx) => {
    const lineNo = block.fenceLine + 1 + idx;
    if (cur) cur.text += '\n' + line;
    else cur = { text: line, line: lineNo };
    if (!endsWithContinuation(line)) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

function endsWithContinuation(line) {
  const m = line.match(/(\\+)$/);
  return !!m && m[1].length % 2 === 1;
}

/** Structural defects that bash -n does not catch. Run on every bash/sh block, marked or not. */
export function lintStructure(block) {
  const errors = [];
  const lines = block.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const at = `${block.file}:${block.fenceLine + 1 + i}`;
    const line = lines[i];
    if (i > 0 && endsWithContinuation(lines[i - 1]) && /^\s*#/.test(line)) {
      errors.push(`comment line inside a line continuation (${at})`);
    }
    // A backslash followed by blanks escapes a blank, not the newline: the command ends here
    // and whatever follows (often a comment) is lost or run on its own.
    if (!/^\s*#/.test(line) && /(?:^|\s)\\[ \t]+(?:\S.*)?$/.test(line)) {
      errors.push(`text after line continuation (${at})`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Tokenizer: shell words, no expansion, never a shell.

const OPERATORS = ['&&', '||', ';;', ';', '|', '&', '(', ')', '\n'];

/**
 * Split shell text into tokens: { type: 'word', value, raw, subs, line } or { type: 'op', value }.
 * value has quotes removed and backslash escapes resolved; `$...` is kept literally.
 * subs holds the source text of every `$(...)`, backtick and `<(...)`/`>(...)` in the word.
 * Comments are dropped. Redirections are { type: 'redir', value }.
 */
export function tokenize(command, baseLine = 1) {
  const src = String(command);
  const tokens = [];
  let i = 0;
  const n = src.length;
  const lineAt = (pos) => {
    let l = baseLine;
    for (let k = 0; k < pos; k++) if (src[k] === '\n') l++;
    return l;
  };

  const readBalanced = (start, openCh, closeCh) => {
    // src[start] is just past the opening char; returns index just past the matching close.
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === "'") { j = src.indexOf("'", j + 1); if (j < 0) j = n; j++; continue; }
      if (c === '"') {
        j++;
        while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
        j++;
        continue;
      }
      if (c === openCh) depth++;
      else if (c === closeCh) depth--;
      j++;
    }
    return j;
  };

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) { tokens.push({ type: 'op', value: op }); i += op.length; continue; }
    const redir = src.slice(i).match(/^(\d*)(>>|>&|<<|>|<)(?!\()/);
    if (redir) { tokens.push({ type: 'redir', value: redir[0] }); i += redir[0].length; continue; }

    // A word.
    let value = '';
    let raw = '';
    const subs = [];
    const start = i;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
      if (ch === ';' || ch === '&' || ch === '|' || ch === ')') break;
      if (ch === '(' && value === '') break;
      if ((ch === '<' || ch === '>') && src[i + 1] !== '(') break;
      if (ch === '\\') {
        if (src[i + 1] === '\n') { i += 2; continue; }
        if (i + 1 < n) value += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") {
        let j = src.indexOf("'", i + 1);
        if (j < 0) j = n;
        value += src.slice(i + 1, j);
        i = j + 1;
        continue;
      }
      if (ch === '"') {
        i++;
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\' && i + 1 < n && '"\\$`\n'.includes(src[i + 1])) {
            if (src[i + 1] !== '\n') value += src[i + 1];
            i += 2;
            continue;
          }
          if (src[i] === '$' && src[i + 1] === '(') {
            const end = readBalanced(i + 2, '(', ')');
            subs.push(src.slice(i + 2, end - 1));
            value += src.slice(i, end);
            i = end;
            continue;
          }
          if (src[i] === '`') {
            let j = src.indexOf('`', i + 1);
            if (j < 0) j = n;
            subs.push(src.slice(i + 1, j));
            value += src.slice(i, j + 1);
            i = j + 1;
            continue;
          }
          value += src[i];
          i++;
        }
        i++;
        continue;
      }
      if ((ch === '$' || ch === '<' || ch === '>') && src[i + 1] === '(') {
        const end = readBalanced(i + 2, '(', ')');
        subs.push(src.slice(i + 2, end - 1));
        value += src.slice(i, end);
        i = end;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        const end = readBalanced(i + 2, '{', '}');
        value += src.slice(i, end);
        i = end;
        continue;
      }
      if (ch === '`') {
        let j = src.indexOf('`', i + 1);
        if (j < 0) j = n;
        subs.push(src.slice(i + 1, j));
        value += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      value += ch;
      i++;
    }
    raw = src.slice(start, i);
    tokens.push({ type: 'word', value, raw, subs, line: lineAt(start) });
  }
  return tokens;
}

// Reserved words after which the next word starts a new simple command.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!']);
// Group braces separate commands like `(` and `)` do; they are not commands themselves, so
// they never reach the allowlist (the token snippet groups its writes with `{ ...; }`).
const GROUP_WORDS = new Set(['{', '}']);

/**
 * Every simple command in the text, as an array of word tokens with leading assignments
 * removed, including the commands inside every substitution. `for NAME in LIST` yields `for`
 * only. A reserved word is reported as its own one-word command; group braces are skipped.
 */
export function simpleCommands(text, baseLine = 1) {
  const tokens = tokenize(text, baseLine);
  const commands = [];
  let cur = [];
  let skipNextWord = false;
  let inFor = false;
  const flush = () => { if (cur.length) commands.push(cur); cur = []; inFor = false; };
  for (const t of tokens) {
    if (t.type === 'op') { flush(); continue; }
    if (t.type === 'redir') { skipNextWord = true; continue; }
    for (const sub of t.subs) commands.push(...simpleCommands(sub, t.line));
    if (skipNextWord) { skipNextWord = false; continue; }
    if (inFor) continue;
    if (cur.length === 0) {
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.raw)) continue; // leading assignment
      if (GROUP_WORDS.has(t.raw)) continue;
      if (KEYWORDS.has(t.raw)) { commands.push([t]); continue; }
      if (t.raw === 'for') { commands.push([t]); inFor = true; continue; }
    }
    cur.push(t);
  }
  flush();
  return commands;
}

/** The first word of every simple command, inside every substitution too. */
export function commandNames(block) {
  const text = typeof block === 'string' ? block : block.text;
  return simpleCommands(text).map((c) => c[0].value);
}

/** Simple commands that are `docker run ...`. Comments never count. */
export function dockerRunCommands(block) {
  const text = typeof block === 'string' ? block : block.text;
  const base = typeof block === 'string' ? 1 : block.fenceLine + 1;
  return simpleCommands(text, base).filter((c) => c[0].value === 'docker' && c[1] && c[1].value === 'run');
}

// ---------------------------------------------------------------------------------------------
// Content rules

/**
 * Content rules for one bash/sh block. In scope only when the block runs `docker run` as a
 * command (a `docker run` inside a comment does not count). The image and --env-file rules
 * read the docker run command itself; the localhost, token and password rules read every
 * word of the block (comments excluded), so a value split off the command by a broken
 * continuation, or staged in a variable first, is still caught.
 */
export function checkContent(block) {
  const runs = dockerRunCommands(block);
  if (runs.length === 0) return [];
  const errors = [];
  const words = tokenize(block.text, block.fenceLine + 1).filter((t) => t.type === 'word');
  if (!block.fragment) {
    for (const run of runs) {
      const at = `${block.file}:${run[0].line}`;
      if (!run.some((w) => IMAGE_RE.test(w.value))) {
        errors.push(`docker run image is not ghcr.io/agigante80/actual-mcp-server or agigante80/actual-mcp-server (${at})`);
      }
      if (!run.some((w) => w.value === '--env-file' || w.value.startsWith('--env-file='))) {
        errors.push(`docker run block without --env-file (${at})`);
      }
    }
  }
  const flag = (re, msg) => {
    for (const w of words) if (re.test(w.raw)) errors.push(`${msg} (${block.file}:${w.line})`);
  };
  flag(LOCALHOST_URL_RE, 'localhost ACTUAL_SERVER_URL inside a docker run block');
  flag(/MCP_SSE_AUTHORIZATION/, 'token on the docker run command line');
  flag(/ACTUAL_PASSWORD/, 'password on the docker run command line');
  return [...new Set(errors)];
}

/** Commands of a marked block that are not on the allowlist, as failure messages. */
export function checkAllowlist(block) {
  const bad = commandNames(block).filter((c) => !COMMAND_ALLOWLIST.has(c));
  return [...new Set(bad)].map((c) => `command not in the snippet allowlist: ${c} (${block.file}:${block.fenceLine})`);
}

/** The .env.example line rule: no uncommented localhost ACTUAL_SERVER_URL. */
export function checkEnvExample(text, file = '.env.example') {
  const errors = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*ACTUAL_SERVER_URL=\s*["']?https?:\/\/(?:localhost|127\.0\.0\.1)\b/.test(line)) {
      errors.push(`localhost ACTUAL_SERVER_URL in .env.example (${file}:${i + 1})`);
    }
  });
  return errors;
}

/** The marked block with this id in this markdown, or a failure. */
export function findRunnable(markdown, file, id) {
  const block = extractBlocks(markdown, file).find((b) => b.runnable === id);
  if (!block) throw new Error(`missing runnable marker ${id} in ${file}`);
  return block;
}

// ---------------------------------------------------------------------------------------------
// Running a marked block

function resolveTool(name) {
  const r = spawnSync('bash', ['-c', `type -P ${name}`], { encoding: 'utf8' });
  // type -P, not command -v: printf is a bash builtin, and command -v names the builtin, not a file.
  const p = (r.stdout || '').trim();
  if (r.status !== 0 || !p.startsWith('/')) throw new Error(`required tool not found: ${name}`);
  return p;
}

/** A directory of symlinks to the real allowed tools, for a scrubbed PATH. */
export function makeToolDir(dir, names = REAL_TOOLS) {
  mkdirSync(dir, { recursive: true });
  for (const name of names) symlinkSync(resolveTool(name), join(dir, name));
  return dir;
}

/**
 * Run a marked block with bash in cwd, with an explicit environment and nothing else.
 * Refuses (throws) when a command is not on the allowlist, before anything runs.
 */
export function runBlock(block, { cwd, path, extraEnv = {} }) {
  const bad = checkAllowlist(block);
  if (bad.length) throw new Error(bad.join('; '));
  const bash = path.split(':').map((d) => join(d, 'bash')).find((p) => {
    try { readFileSync(p); return true; } catch { return false; }
  });
  if (!bash) throw new Error('required tool not found: bash');
  return spawnSync(bash, ['-c', block.text], {
    cwd,
    env: { PATH: path, HOME: cwd, LC_ALL: 'C', ...extraEnv },
    encoding: 'utf8',
  });
}

// ---------------------------------------------------------------------------------------------
// CI startup smoke

const DUMMY_ACTUAL = {
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'dummy',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};

function parseArgs(argv) {
  const opts = { image: null, hostPort: null, dropToken: false, readme: join(ROOT, 'README.md') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image') opts.image = argv[++i];
    else if (a === '--host-port') opts.hostPort = argv[++i];
    else if (a === '--drop-token') opts.dropToken = true;
    else if (a === '--readme') opts.readme = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.image) throw new Error('--image <tag> is required');
  return opts;
}

/** The docker argv for the README docker-run block, with only the image and name replaced. */
export function smokeArgv(block, { image, name, hostPort, volumePrefix }) {
  const runs = dockerRunCommands(block);
  if (runs.length !== 1) throw new Error(`expected exactly one docker run in ${block.file}:${block.fenceLine}, found ${runs.length}`);
  const argv = runs[0].map((w) => w.value);
  const last = argv.length - 1;
  if (!IMAGE_RE.test(argv[last])) throw new Error(`the image is not the last word of ${block.file}:${block.fenceLine}`);
  argv[last] = image;
  let port = null;
  for (let i = 2; i < last; i++) {
    if (argv[i] === '--name') argv[i + 1] = name;
    if (argv[i] === '-p' || argv[i] === '--publish') {
      const parts = argv[i + 1].split(':');
      if (hostPort) parts[parts.length - 2] = String(hostPort);
      port = parts[parts.length - 2];
      argv[i + 1] = parts.join(':');
    }
    // Named volumes get per-run names so a smoke never mounts a real user's data volume.
    if ((argv[i] === '-v' || argv[i] === '--volume') && volumePrefix && /^[A-Za-z0-9][\w.-]*:/.test(argv[i + 1])) {
      argv[i + 1] = `${volumePrefix}-${argv[i + 1]}`;
    }
  }
  if (!port) throw new Error(`no -p in ${block.file}:${block.fenceLine}`);
  return { argv: argv.slice(1), port };
}

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opts });
}

async function smoke(opts) {
  const readme = readFileSync(opts.readme, 'utf8');
  const envBlock = findRunnable(readme, 'README.md', 'env-token');
  const runBlockDef = findRunnable(readme, 'README.md', 'docker-run');
  const dir = mkdtempSync(join(tmpdir(), 'install-smoke-'));
  const name = `ci-smoke-${process.pid}`;
  const volumePrefix = name;
  let volumes = [];
  try {
    const toolDir = makeToolDir(join(dir, '.tools'));
    const work = join(dir, 'work');
    mkdirSync(work);
    const r = runBlock(envBlock, { cwd: work, path: toolDir });
    if (r.status !== 0) throw new Error(`env-token block exited ${r.status}: ${r.stderr}`);
    const env = readFileSync(join(work, '.env'), 'utf8');
    const token = (env.match(/^MCP_SSE_AUTHORIZATION=(.*)$/m) || [])[1];
    // Mask before anything prints the token, so it never reaches the log in clear.
    if (token && process.env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
    process.stdout.write(r.stdout);

    let lines = env.split('\n').filter((l) => !/^(ACTUAL_SERVER_URL|ACTUAL_PASSWORD|ACTUAL_BUDGET_SYNC_ID)=/.test(l));
    if (opts.dropToken) lines = lines.filter((l) => !/^MCP_SSE_AUTHORIZATION=/.test(l));
    lines.push(...Object.entries(DUMMY_ACTUAL).map(([k, v]) => `${k}=${v}`), '');
    writeFileSync(join(work, '.env'), lines.filter((l, i, a) => l !== '' || i === a.length - 1).join('\n'), { mode: 0o600 });

    const { argv, port } = smokeArgv(runBlockDef, { image: opts.image, name, hostPort: opts.hostPort, volumePrefix });
    volumes = argv.flatMap((a, i) => (argv[i - 1] === '-v' && a.startsWith(`${volumePrefix}-`) ? [a.split(':')[0]] : []));
    console.log(`smoke: docker ${argv.join(' ')}`);
    const run = docker(argv, { cwd: work });
    if (run.status !== 0) throw new Error(`docker run exited ${run.status}: ${run.stderr}`);

    const deadline = Date.now() + 30_000;
    const t0 = Date.now();
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.status === 200) {
          console.log(`smoke: /health 200 after ${Math.round((Date.now() - t0) / 1000)} s`);
          return 0;
        }
      } catch { /* not listening yet */ }
      const state = docker(['inspect', '-f', '{{.State.Running}}', name]);
      if (state.stdout.trim() !== 'true') {
        console.log('smoke: container exited before /health answered');
        const logs = docker(['logs', name]);
        process.stdout.write(logs.stdout + logs.stderr);
        return 1;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    console.log('smoke: /health did not answer 200 within 30 s');
    const logs = docker(['logs', name]);
    process.stdout.write(logs.stdout + logs.stderr);
    return 1;
  } finally {
    docker(['rm', '-f', name]);
    for (const v of volumes) docker(['volume', 'rm', '-f', v]);
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'smoke') {
    console.error('usage: node scripts/install-snippets.mjs smoke --image <tag> [--host-port <n>] [--drop-token]');
    process.exit(2);
  }
  smoke(parseArgs(rest)).then(
    (code) => process.exit(code),
    (err) => { console.error(`smoke: ${err.message}`); process.exit(1); },
  );
}
