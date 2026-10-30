// tests/unit/client_examples.test.js
//
// #606: the client setup pages under docs/guides/clients/ and their example configs hold
// no literal secret. Rule: a secret (the MCP bearer token, MCP_SSE_AUTHORIZATION,
// MCP_TOKEN_*, ACTUAL_PASSWORD, BUDGET_n_PASSWORD, ACTUAL_BUDGET_PASSWORD,
// BUDGET_n_ENCRYPTION_PASSWORD) appears only as a reference in the client's own syntax.
// Claude Desktop is the one client with no interpolation, so its row alone accepts a
// `your_` / `YOUR_` placeholder (its page states that the file is per-user plaintext).
//
// Three scans:
//   1. Example files: every string value of each JSON file (args included), every line of
//      librechat.yaml and codex-config.toml, against that file's row.
//   2. Client page config blocks: every json, yaml and toml fenced block on a page, against
//      the row of the page's example (PAGE_ROW). A page with no row may hold no
//      secret-bearing config block at all.
//   3. Command-line scan: every bash, sh and console fenced block on the pages, plus the `#`
//      lines of the example files. A secret passes only as a reference: '${NAME}' in single
//      quotes (the client resolves it) or $NAME / "$NAME" (a variable set by `read -rs`).
//
// Pure text and JSON parsing: no TOML or YAML parser (smol-toml is transitive only, and
// the direct-only dependency policy forbids importing it), no network, no build needed.
//
// Run: node tests/unit/client_examples.test.js

import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENTS = 'docs/guides/clients';
const EXAMPLES = `${CLIENTS}/examples`;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Built from code points so this file never holds the characters it forbids.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// ------------------------------------------------------------------ shared patterns

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
// A string is secret-bearing when its nearest key matches KEY_RE, or the string itself
// matches VALUE_RE (which is what catches an `args` entry, which has no key).
const KEY_RE = /TOKEN|PASSWORD|SECRET|Authorization/i;
const VALUE_RE = /Bearer\s|Authorization\s*:|(PASSWORD|TOKEN|SECRET)\s*=/i;
// The secret variable names a command line may not carry a value for.
const SECRET_NAME = '(?:MCP_SSE_AUTHORIZATION|MCP_TOKEN_[A-Z0-9_]+|ACTUAL_MCP_TOKEN|ACTUAL_PASSWORD|ACTUAL_BUDGET_PASSWORD|BUDGET_\\d+_PASSWORD|BUDGET_\\d+_ENCRYPTION_PASSWORD)';
const PLACEHOLDER = '(?:your_|YOUR_)[A-Za-z0-9_-]*';

// The whole value must be the reference; `Bearer ` (or `Authorization:` in args) may precede it.
const wrap = (ref) => new RegExp(`^(?:Authorization:\\s*)?(?:Bearer\\s+)?${ref}$`);
const REF = {
  dollarBrace: wrap(`\\$\\{${NAME}\\}`),
  cursor: wrap(`\\$\\{env:${NAME}\\}`),
  vscodeEnv: wrap(`\\$\\{env:${NAME}\\}`),
  vscodeInput: wrap('\\$\\{input:([A-Za-z0-9_-]+)\\}'),
  gemini: wrap(`(?:\\$${NAME}|\\$\\{${NAME}\\})`),
  placeholder: wrap(PLACEHOLDER),
};

// ------------------------------------------------------------------ JSON rows

/** Every string in a JSON value, with the nearest key and a short path (`KEY` or `args[4]`). */
function walkStrings(node, key = '', path = '') {
  if (typeof node === 'string') return [{ key, path, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => walkStrings(v, key, `${path || key}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => walkStrings(v, k, k));
  }
  return [];
}

const isSecretBearing = ({ key, value }) => KEY_RE.test(key) || VALUE_RE.test(value);

/** The ids of every VS Code `inputs` entry that is a password promptString. */
function passwordInputIds(json) {
  const inputs = Array.isArray(json?.inputs) ? json.inputs : [];
  return new Set(inputs.filter((i) => i?.type === 'promptString' && i?.password === true).map((i) => i.id));
}

/**
 * The JSON rows. Each returns null when a secret-bearing string is acceptable, otherwise the
 * failure suffix ("must be a reference" or "holds a literal secret").
 */
const JSON_ROWS = {
  'claude-code-mcp.json': (s) => (REF.dollarBrace.test(s.value) ? null : 'must be a reference'),
  'cursor-mcp.json': (s) => (REF.cursor.test(s.value) ? null : 'must be a reference'),
  'vscode-mcp.json': (s, json) => {
    if (REF.vscodeEnv.test(s.value)) return null;
    const m = s.value.match(REF.vscodeInput);
    return m && passwordInputIds(json).has(m[1]) ? null : 'must be a reference';
  },
  'gemini-settings.json': (s) => (REF.gemini.test(s.value) ? null : 'must be a reference'),
  'claude-desktop.json': (s) =>
    REF.dollarBrace.test(s.value) || REF.placeholder.test(s.value) ? null : 'holds a literal secret',
};

/** Findings for one parsed JSON config against a row. `label` prefixes each finding. */
function jsonFindings(label, json, rowName, lineOf = null) {
  const row = JSON_ROWS[rowName];
  const out = [];
  for (const s of walkStrings(json)) {
    if (!isSecretBearing(s)) continue;
    const why = row ? row(s, json) : 'must not appear in a config block on this page';
    if (!why) continue;
    out.push(lineOf ? `${label}:${lineOf(s)}: ${s.path} ${why}` : `${label}: ${s.path} ${why}`);
  }
  return out;
}

/** The gemini rule beyond references: every shipped server entry sets trust: false. */
function trustFindings(label, json) {
  return Object.values(json?.mcpServers ?? {})
    .filter((server) => server?.trust !== false)
    .map(() => `${label}: trust must be false in a shipped example`);
}

// ------------------------------------------------------------------ line-level rows

const strip = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** librechat.yaml: every secret-bearing `key: value` line holds `${NAME}` or `Bearer ${NAME}`. */
function yamlFindings(label, text, baseLine = 1, withLine = false, why = 'must be a reference') {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // comment lines go through the command-line scan
    const m = line.match(/^\s*-?\s*([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/);
    if (!m) return;
    const [, key, raw] = m;
    const value = strip(raw.replace(/\s+#.*$/, ''));
    if (!isSecretBearing({ key, value })) return;
    if (why === 'must be a reference' && REF.dollarBrace.test(value)) return;
    out.push(withLine ? `${label}:${baseLine + i}: ${key} ${why}` : `${label}: ${key} ${why}`);
  });
  return out;
}

const TOML_SERVER_SHAPES = [
  /^command\s*=\s*"[^"]*"$/,
  /^args\s*=\s*\[.*\]$/,
  /^startup_timeout_sec\s*=\s*\d+$/,
  new RegExp(`^env_vars\\s*=\\s*\\[\\s*(?:"${NAME}"\\s*,?\\s*)*\\]$`),
  new RegExp(`^bearer_token_env_var\\s*=\\s*"${NAME}"$`),
  new RegExp(`^env_http_headers\\s*=\\s*\\{\\s*(?:"[A-Za-z0-9-]+"\\s*=\\s*"${NAME}"\\s*,?\\s*)*\\}$`),
];

/** codex-config.toml: accepted line shapes only, and no secret key in the env table. */
function tomlFindings(label, text, baseLine = 1, withLine = false) {
  const out = [];
  let section = null;
  text.split('\n').forEach((rawLine, i) => {
    const line = rawLine.trim();
    const at = baseLine + i;
    if (line === '' || line.startsWith('#')) return; // `#` lines go through the command-line scan
    if (line === '[mcp_servers.actual-budget]') { section = 'server'; return; }
    if (line === '[mcp_servers.actual-budget.env]') { section = 'env'; return; }
    if (section === 'env') {
      const m = line.match(new RegExp(`^(${NAME})\\s*=\\s*"[^"]*"$`));
      if (m && !isSecretBearing({ key: m[1], value: line })) return;
      if (m) { out.push(withLine ? `${label}:${at}: ${m[1]} holds a literal secret` : `${label}: ${m[1]} holds a literal secret`); return; }
    } else if (section === 'server' && TOML_SERVER_SHAPES.some((re) => re.test(line))) {
      return;
    }
    out.push(`${label}:${at} is not an accepted line shape: ${line}`);
  });
  return out;
}

// ------------------------------------------------------------------ command-line scan

const SECRET_ASSIGN_RE = new RegExp(`\\b(${SECRET_NAME})=(\\S*)`, 'g');

/**
 * True when `value` (the text after NAME= or after Bearer) is a whole reference: a
 * single-quoted ${NAME} (the shell leaves it alone, the client resolves it), or $NAME /
 * "$NAME" (a variable the reader set with `read -rs`). A double-quoted ${NAME} fails: the
 * brace form says "the client resolves this", and in double quotes the shell resolves it
 * first, so the value lands in the client's config file.
 */
function isCommandLineReference(value, line) {
  const v = value.replace(/\\$/, '');
  if (new RegExp(`^\\$\\{${NAME}\\}'$`).test(v)) return /'[^']*\$\{/.test(line);
  return new RegExp(`^"?\\$${NAME}"?$`).test(v);
}

/** Findings for an array of { line, text } command lines. */
function commandLineFindings(label, lines) {
  const out = [];
  for (const { line, text } of lines) {
    for (const m of text.matchAll(SECRET_ASSIGN_RE)) {
      if (!isCommandLineReference(m[2], text)) out.push(`${label}:${line} puts ${m[1]} on a command line`);
    }
    if (/Authorization|Bearer\s/i.test(text)) {
      const m = text.match(/Bearer\s+(\S+)/i) || text.match(/Authorization:\s*(\S+)/i);
      if (!m || !isCommandLineReference(m[1], text)) out.push(`${label}:${line} puts Authorization on a command line`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ markdown blocks

/** Fenced blocks: { lang, start (1-based page line of the first body line), text }. */
function fencedBlocks(markdown) {
  const blocks = [];
  let open = null;
  markdown.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_-]*)/);
    if (!open && m) { open = { fence: m[1], lang: m[2].toLowerCase(), start: i + 2, body: [] }; return; }
    if (open && line.trim().startsWith(open.fence)) { blocks.push({ ...open, text: open.body.join('\n') }); open = null; return; }
    if (open) open.body.push(line);
  });
  return blocks;
}

const SHELL_LANGS = new Set(['bash', 'sh', 'console', 'shell', 'zsh']);

/** Every line of every shell block on a page. */
function shellLines(markdown) {
  return fencedBlocks(markdown)
    .filter((b) => SHELL_LANGS.has(b.lang))
    .flatMap((b) => b.text.split('\n').map((text, i) => ({ line: b.start + i, text })));
}
/** The `#` lines of an example file. */
const commentLines = (text) =>
  text.split('\n').map((t, i) => ({ line: i + 1, text: t })).filter(({ text: t }) => /^\s*#/.test(t));

/** The 1-based page line of a JSON string inside a block. */
function lineInBlock(block, s) {
  const needle = JSON.stringify(s.value);
  const idx = block.text.split('\n').findIndex((l) => l.includes(needle));
  return block.start + Math.max(idx, 0);
}

/** Findings for every config block on a page, against the page's row. */
function pageBlockFindings(page, markdown, rowName) {
  const label = page.split('/').pop();
  const out = [];
  for (const b of fencedBlocks(markdown)) {
    if (b.lang === 'json' || b.lang === 'jsonc') {
      let json;
      try { json = JSON.parse(b.text); } catch (e) { out.push(`${label}:${b.start}: json block does not parse (${e.message})`); continue; }
      const row = rowName && rowName.endsWith('.json') ? rowName : null;
      out.push(...jsonFindings(label, json, row, (s) => lineInBlock(b, s)));
    } else if (b.lang === 'yaml' || b.lang === 'yml') {
      const why = rowName === 'librechat.yaml' ? 'must be a reference' : 'must not appear in a config block on this page';
      out.push(...yamlFindings(label, b.text, b.start, true, why));
    } else if (b.lang === 'toml') {
      if (rowName === 'codex-config.toml') out.push(...tomlFindings(label, b.text, b.start, true));
      else if (KEY_RE.test(b.text)) out.push(`${label}:${b.start}: toml config block on a page with no toml row`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ install links

/** Decoded JSON payloads of every VS Code install link and Cursor deeplink on a page. */
function installLinkPayloads(markdown) {
  const out = [];
  for (const m of markdown.matchAll(/vscode(?:-insiders)?:\/?\/?mcp\/install\?([^\s)"'>]+)/g)) {
    out.push({ kind: 'vscode', json: JSON.parse(decodeURIComponent(m[1])) });
  }
  for (const m of markdown.matchAll(/cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?([^\s)"'>]+)/g)) {
    const config = new URLSearchParams(m[1]).get('config') ?? '';
    out.push({ kind: 'cursor', json: JSON.parse(Buffer.from(config, 'base64').toString('utf8')) });
  }
  return out;
}

function installLinkFindings(page, markdown) {
  const label = page.split('/').pop();
  const out = [];
  for (const { kind, json } of installLinkPayloads(markdown)) {
    const row = kind === 'vscode' ? 'vscode-mcp.json' : 'cursor-mcp.json';
    if (jsonFindings(label, json, row).length) out.push(`${label} install link carries a literal token`);
  }
  return out;
}

// The sentence a page carries when verify-first dropped its install link.
const NO_LINK_SENTENCE = 'No install link is offered';

// ------------------------------------------------------------------ the inventory

const ROWS = {
  'claude-code-mcp.json': 'json',
  'claude-desktop.json': 'json',
  'cursor-mcp.json': 'json',
  'vscode-mcp.json': 'json',
  'gemini-settings.json': 'json',
  'librechat.yaml': 'yaml',
  'codex-config.toml': 'toml',
};

// Each client page and the example row its config blocks are checked against.
const PAGE_ROW = {
  'claude-desktop.md': 'claude-desktop.json',
  'claude-code.md': 'claude-code-mcp.json',
  'cursor.md': 'cursor-mcp.json',
  'vscode-copilot.md': 'vscode-mcp.json',
  'gemini-cli.md': 'gemini-settings.json',
  'codex.md': 'codex-config.toml',
  'librechat.md': 'librechat.yaml',
  'lobechat.md': null,
  'README.md': null,
};

/** Every finding for one example file's text. */
function exampleFindings(file, text) {
  const out = [];
  if (text.includes(EN_DASH) || text.includes(EM_DASH)) out.push(`${file}: holds an em or en dash`);
  if (ROWS[file] === 'json') {
    let json;
    try { json = JSON.parse(text); } catch (e) { return [...out, `${file}: does not parse (${e.message})`]; }
    out.push(...jsonFindings(file, json, file));
    if (file === 'gemini-settings.json') out.push(...trustFindings(file, json));
  } else if (ROWS[file] === 'yaml') {
    out.push(...yamlFindings(file, text));
    out.push(...commandLineFindings(file, commentLines(text)));
  } else if (ROWS[file] === 'toml') {
    out.push(...tomlFindings(file, text));
    out.push(...commandLineFindings(file, commentLines(text)));
  }
  return out;
}

/** Every finding for one client page's text. */
function pageFindings(page, text) {
  const name = page.split('/').pop();
  return [
    ...pageBlockFindings(page, text, PAGE_ROW[name]),
    ...commandLineFindings(page, shellLines(text)),
    ...installLinkFindings(page, text),
  ];
}

console.log('\n[client-examples] shipped examples and pages');

for (const file of Object.keys(ROWS)) {
  check(`${file} exists, parses and holds no literal secret`, () => {
    const p = `${EXAMPLES}/${file}`;
    assert.ok(existsSync(join(ROOT, p)), `${p} is missing`);
    const f = exampleFindings(file, read(p));
    assert.deepStrictEqual(f, [], f.join('; '));
  });
}

check('codex-config.toml forwards ACTUAL_PASSWORD by name (env_vars)', () => {
  assert.match(read(`${EXAMPLES}/codex-config.toml`), /^env_vars\s*=\s*\[[^\]]*"ACTUAL_PASSWORD"/m,
    'codex-config.toml has no env_vars line forwarding ACTUAL_PASSWORD');
});

const SKELETON = ['## Prerequisites', '## Configure', '## Verify', '## Troubleshooting', '## Where the secret lives'];

for (const [name, row] of Object.entries(PAGE_ROW)) {
  const page = `${CLIENTS}/${name}`;
  check(`${page}: config blocks, command lines and install links hold no literal secret`, () => {
    assert.ok(existsSync(join(ROOT, page)), `${page} is missing`);
    const f = pageFindings(page, read(page));
    assert.deepStrictEqual(f, [], f.join('; '));
  });
  if (name === 'README.md') continue;
  check(`${page}: has the page skeleton and links its example`, () => {
    assert.ok(existsSync(join(ROOT, page)), `${page} is missing`);
    const text = read(page);
    for (const h of SKELETON) assert.ok(text.split('\n').some((l) => l.trim() === h), `${page} has no "${h}" section`);
    if (row) assert.ok(text.includes(`](examples/${row})`), `${page} does not link examples/${row}`);
  });
}

for (const page of ['vscode-copilot.md', 'cursor.md']) {
  check(`${page}: ships no unverified install link, and says why`, () => {
    const p = `${CLIENTS}/${page}`;
    assert.ok(existsSync(join(ROOT, p)), `${p} is missing`);
    const text = read(p);
    if (installLinkPayloads(text).length) return; // a shipped link is checked by the page scan above
    assert.ok(text.includes(NO_LINK_SENTENCE), `${page} has neither an install link nor the "${NO_LINK_SENTENCE}" sentence`);
    assert.ok(fencedBlocks(text).some((b) => b.lang === 'json'), `${page} has no manual config block`);
  });
}

// ------------------------------------------------------------------ fixtures (no bad file is committed)

console.log('\n[client-examples] rule fixtures');

const cursorShape = (password) => ({ mcpServers: { 'actual-budget': { command: 'npx', env: { ACTUAL_PASSWORD: password } } } });

check('NEGATIVE: a placeholder in an interpolating client (cursor) must be a reference', () => {
  assert.deepStrictEqual(jsonFindings('cursor-mcp.json', cursorShape('your_actual_password'), 'cursor-mcp.json'),
    ['cursor-mcp.json: ACTUAL_PASSWORD must be a reference']);
});

check('NEGATIVE: a literal password (cursor) must be a reference', () => {
  assert.deepStrictEqual(jsonFindings('cursor-mcp.json', cursorShape('hunter2'), 'cursor-mcp.json'),
    ['cursor-mcp.json: ACTUAL_PASSWORD must be a reference']);
});

check('POSITIVE: each interpolating row accepts its own reference syntax, and only that', () => {
  assert.deepStrictEqual(jsonFindings('cursor-mcp.json', cursorShape('${env:ACTUAL_PASSWORD}'), 'cursor-mcp.json'), []);
  assert.deepStrictEqual(jsonFindings('claude-code-mcp.json', cursorShape('${ACTUAL_PASSWORD}'), 'claude-code-mcp.json'), []);
  assert.deepStrictEqual(jsonFindings('gemini-settings.json', cursorShape('$ACTUAL_PASSWORD'), 'gemini-settings.json'), []);
  assert.deepStrictEqual(jsonFindings('vscode-mcp.json', cursorShape('${env:ACTUAL_PASSWORD}'), 'vscode-mcp.json'), []);
  // A reference in another client's syntax is not a reference here.
  assert.strictEqual(jsonFindings('cursor-mcp.json', cursorShape('${ACTUAL_PASSWORD}'), 'cursor-mcp.json').length, 1);
  // The whole value must be the reference.
  assert.strictEqual(jsonFindings('claude-code-mcp.json', cursorShape('x${ACTUAL_PASSWORD}'), 'claude-code-mcp.json').length, 1);
  assert.deepStrictEqual(jsonFindings('claude-code-mcp.json', { headers: { Authorization: 'Bearer ${ACTUAL_MCP_TOKEN}' } }, 'claude-code-mcp.json'), []);
});

check('VS Code: ${input:id} needs a promptString input with password: true', () => {
  const cfg = (input) => ({ inputs: input ? [input] : [], servers: { a: { env: { ACTUAL_PASSWORD: '${input:actual-password}' } } } });
  assert.deepStrictEqual(jsonFindings('vscode-mcp.json', cfg({ type: 'promptString', id: 'actual-password', password: true }), 'vscode-mcp.json'), []);
  assert.deepStrictEqual(jsonFindings('vscode-mcp.json', cfg({ type: 'promptString', id: 'actual-password' }), 'vscode-mcp.json'),
    ['vscode-mcp.json: ACTUAL_PASSWORD must be a reference']);
  assert.deepStrictEqual(jsonFindings('vscode-mcp.json', cfg(null), 'vscode-mcp.json'), ['vscode-mcp.json: ACTUAL_PASSWORD must be a reference']);
});

check('NEGATIVE: a literal token in a claude-desktop args string holds a literal secret', () => {
  const json = { mcpServers: { 'actual-budget': { command: 'npx', args: ['-y', 'mcp-remote', 'http://localhost:3600/http', '--header', 'Authorization: Bearer abc123'] } } };
  assert.deepStrictEqual(jsonFindings('claude-desktop.json', json, 'claude-desktop.json'), ['claude-desktop.json: args[4] holds a literal secret']);
});

check('POSITIVE: claude-desktop accepts Authorization:${AUTH_HEADER} in args and a placeholder in env', () => {
  const json = { mcpServers: { a: { args: ['--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: 'Bearer your_secret_token', ACTUAL_PASSWORD: 'your_actual_password' } } } };
  assert.deepStrictEqual(jsonFindings('claude-desktop.json', json, 'claude-desktop.json'), []);
});

check('NEGATIVE: a literal header in librechat.yaml must be a reference', () => {
  const yaml = 'mcpServers:\n  actual-mcp:\n    type: "streamable-http"\n    headers:\n      Authorization: "Bearer abc123"\n';
  assert.deepStrictEqual(yamlFindings('librechat.yaml', yaml), ['librechat.yaml: Authorization must be a reference']);
  assert.deepStrictEqual(yamlFindings('librechat.yaml', yaml.replace('abc123', '${ACTUAL_MCP_TOKEN}')), []);
});

const TOML_OK = [
  '# Codex: forward the password by name',
  '',
  '[mcp_servers.actual-budget]',
  'command = "npx"',
  'args = ["-y", "actual-mcp-server", "--stdio"]',
  'startup_timeout_sec = 30',
  'env_vars = ["ACTUAL_PASSWORD"]',
  'bearer_token_env_var = "ACTUAL_MCP_TOKEN"',
  'env_http_headers = { "X-Example" = "ACTUAL_MCP_TOKEN" }',
  '',
  '[mcp_servers.actual-budget.env]',
  'ACTUAL_SERVER_URL = "http://localhost:5006"',
].join('\n');

check('POSITIVE: the Codex shapes pass with comments and blank lines', () => {
  assert.deepStrictEqual(tomlFindings('codex-config.toml', TOML_OK), []);
  assert.deepStrictEqual(commandLineFindings('codex-config.toml', commentLines(TOML_OK)), []);
});

check('NEGATIVE: a secret in the Codex env table holds a literal secret', () => {
  assert.deepStrictEqual(tomlFindings('codex-config.toml', `${TOML_OK}\nACTUAL_PASSWORD = "hunter2"`),
    ['codex-config.toml: ACTUAL_PASSWORD holds a literal secret']);
});

check('NEGATIVE: an unknown Codex line shape is named', () => {
  const head = TOML_OK.split('\n').slice(0, 9).join('\n');
  assert.deepStrictEqual(tomlFindings('codex-config.toml', `${head}\nhttp_headers = { "Authorization" = "Bearer x" }`),
    ['codex-config.toml:10 is not an accepted line shape: http_headers = { "Authorization" = "Bearer x" }']);
});

check('NEGATIVE: a password on a Codex comment command line', () => {
  const text = `${TOML_OK}\n#     --env ACTUAL_PASSWORD=your_actual_password \\`;
  assert.deepStrictEqual(commandLineFindings('codex-config.toml', commentLines(text)),
    ['codex-config.toml:13 puts ACTUAL_PASSWORD on a command line']);
});

const md = (lang, body) => `# Page\n\n\`\`\`${lang}\n${body}\n\`\`\`\n`;

check('NEGATIVE: a password on a recipe command line, in any shell block language', () => {
  for (const lang of ['bash', 'sh', 'console']) {
    assert.deepStrictEqual(commandLineFindings('docs/guides/clients/claude-code.md', shellLines(md(lang, 'claude mcp add x --env ACTUAL_PASSWORD=hunter2 -- npx actual-mcp-server --stdio'))),
      ['docs/guides/clients/claude-code.md:4 puts ACTUAL_PASSWORD on a command line']);
  }
});

check('POSITIVE: a reference on a command line passes', () => {
  const body = [
    "claude mcp add --scope user actual-budget --env 'ACTUAL_PASSWORD=${ACTUAL_PASSWORD}' -- npx -y actual-mcp-server --stdio",
    "claude mcp add --transport http actual-budget http://localhost:3600/http --header 'Authorization: Bearer ${ACTUAL_MCP_TOKEN}'",
    'curl -H "Authorization: Bearer $ACTUAL_MCP_TOKEN" http://localhost:3600/http',
  ].join('\n');
  assert.deepStrictEqual(commandLineFindings('docs/guides/clients/claude-code.md', shellLines(md('bash', body))), []);
});

check('NEGATIVE: ${NAME} in double quotes is expanded by the shell, so it fails', () => {
  assert.deepStrictEqual(commandLineFindings('p.md', shellLines(md('bash', 'x --header "Authorization: Bearer ${ACTUAL_MCP_TOKEN}"'))),
    ['p.md:4 puts Authorization on a command line']);
});

check('NEGATIVE: a placeholder bearer on a curl line fails', () => {
  assert.deepStrictEqual(commandLineFindings('docs/guides/clients/README.md', shellLines(md('bash', 'curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3600/http'))),
    ['docs/guides/clients/README.md:4 puts Authorization on a command line']);
});

check('NEGATIVE: a literal in a client page config block fails', () => {
  const page = md('json', JSON.stringify({ mcpServers: { a: { env: { ACTUAL_PASSWORD: 'your_actual_password' } } } }, null, 2));
  assert.deepStrictEqual(pageBlockFindings('docs/guides/clients/claude-code.md', page, 'claude-code-mcp.json'),
    ['claude-code.md:8: ACTUAL_PASSWORD must be a reference']);
});

check('NEGATIVE: a page with no row may hold no secret-bearing config block', () => {
  const page = md('yaml', 'headers:\n  Authorization: "Bearer ${ACTUAL_MCP_TOKEN}"');
  assert.deepStrictEqual(pageBlockFindings('docs/guides/clients/lobechat.md', page, null),
    ['lobechat.md:5: Authorization must not appear in a config block on this page']);
});

check('NEGATIVE: a token in an install link fails; a reference passes', () => {
  const vscode = (token) => `[Install](vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'a', type: 'http', url: 'http://x/http', headers: { Authorization: token } }))})`;
  assert.deepStrictEqual(installLinkFindings('docs/guides/clients/vscode-copilot.md', vscode('Bearer abc123')), ['vscode-copilot.md install link carries a literal token']);
  assert.deepStrictEqual(installLinkFindings('docs/guides/clients/vscode-copilot.md', vscode('Bearer ${env:ACTUAL_MCP_TOKEN}')), []);
  const cfg = (token) => Buffer.from(JSON.stringify({ url: 'http://x/http', headers: { Authorization: token } })).toString('base64');
  const cursor = (token) => `[Add](cursor://anysphere.cursor-deeplink/mcp/install?name=a&config=${cfg(token)})`;
  assert.deepStrictEqual(installLinkFindings('docs/guides/clients/cursor.md', cursor('Bearer abc123')), ['cursor.md install link carries a literal token']);
  assert.deepStrictEqual(installLinkFindings('docs/guides/clients/cursor.md', cursor('Bearer ${env:ACTUAL_MCP_TOKEN}')), []);
});

check('NEGATIVE: trust true fails, trust false passes', () => {
  const json = (trust) => ({ mcpServers: { 'actual-budget': { command: 'npx', env: { ACTUAL_PASSWORD: '$ACTUAL_PASSWORD' }, trust } } });
  assert.deepStrictEqual(trustFindings('gemini-settings.json', json(true)), ['gemini-settings.json: trust must be false in a shipped example']);
  assert.deepStrictEqual(trustFindings('gemini-settings.json', json(false)), []);
});

check('NEGATIVE: an em or en dash in an example is named', () => {
  assert.deepStrictEqual(exampleFindings('codex-config.toml', `# a ${EM_DASH} b\n${TOML_OK}`), ['codex-config.toml: holds an em or en dash']);
  assert.deepStrictEqual(exampleFindings('codex-config.toml', `# 1${EN_DASH}2\n${TOML_OK}`), ['codex-config.toml: holds an em or en dash']);
});

console.log(`\n[client-examples] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
