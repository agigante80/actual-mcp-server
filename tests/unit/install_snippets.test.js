// tests/unit/install_snippets.test.js
//
// #600: every documented install path must work when pasted. Three defects shipped for months
// in the README's Docker quick start: `#` comment lines inside a `\`-continued `docker run`
// (bash runs `docker run` with no image, then `-e: command not found`; `bash -n` passes), a
// container `ACTUAL_SERVER_URL=http://localhost:5006` (inside a container that is the
// container itself), and tokens and passwords on the command line (shell history) or as
// placeholders that the server accepts as real.
//
// What this proves:
//   1. Structural lint on every bash/sh block in the scan set, marked or not.
//   2. Content rules on every bash/sh block that RUNS `docker run` (a command match through
//      commandNames, never a substring: an upgrade block that names `docker run` only in a
//      comment is out of scope).
//   3. Required `<!-- runnable: <id> -->` markers, and the fragment-marker allowlist.
//   4. A snippet ARGUMENT check: each marked block runs under bash with stub docker, npx and
//      curl first on a scrubbed PATH, and the stubs record the argv the shell hands them. It
//      proves the shell passes Docker the intended arguments, not that the container works
//      (the docker-e2e CI startup smoke does that, through the same module).
//
// The checks live in scripts/install-snippets.mjs, shared with the CI smoke.
//
// Run: node tests/unit/install_snippets.test.js

import assert from 'assert';
import {
  readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, statSync, copyFileSync, mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  extractBlocks, lintStructure, checkContent, checkAllowlist, checkEnvExample, commandNames,
  dockerRunCommands, findRunnable, makeToolDir, runBlock, smokeArgv, tokenize, IMAGE_RE,
} from '../../scripts/install-snippets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'tests', 'unit', 'fixtures', 'install-snippets');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Marked blocks every listed file must carry. #604 and #607 may move a block, never drop it:
// moving one moves its row here.
const REQUIRED_RUNNABLE = {
  'README.md': ['env-token', 'docker-run', 'compose-production', 'npx-http'],
  'docs/guides/deployment.md': ['quick-start-docker-run', 'production-docker-run'],
  'docs/guides/MCP_CLIENTS_SETUP.md': ['http-docker-run'],
  'docker/description/long.md': ['docker-run', 'docker-run-https'],
};

// Illustrative partial commands exempt from the image and --env-file rules ONLY (never from
// the structural lint or the localhost, token and password rules). Keyed by file and the
// block's docker run lines rather than by line number: a line number drifts with every edit
// above the block, and an allowlist that drifts gets widened instead of read.
const FRAGMENT_ALLOWLIST = [
  { file: 'docs/explanation/architecture.md', runs: ['docker run -e MCP_TRANSPORT_MODE=--http ...'] },
  {
    file: 'docs/explanation/security-and-privacy.md',
    runs: ['docker run --read-only --tmpfs /tmp', 'docker run --memory=512m --cpus=1', 'docker run --cap-drop=ALL'],
  },
  { file: 'docs/explanation/security-and-privacy.md', runs: ['docker run --env-file .env ...'] },
];

const runsOf = (block) => dockerRunCommands(block).map((c) => c.map((w) => w.raw).join(' '));

function fragmentErrors(blocks, allowlist = FRAGMENT_ALLOWLIST) {
  const errors = [];
  for (const b of blocks.filter((x) => x.fragment)) {
    const runs = runsOf(b);
    const ok = allowlist.some((a) => a.file === b.file && JSON.stringify(a.runs) === JSON.stringify(runs));
    if (!ok) errors.push(`fragment marker not in the allowlist: ${b.file}:${b.fenceLine - 1}`);
  }
  return errors;
}

// Scan set: README.md, docs/**/*.md and the Docker Hub page. docs/plans/ and docs/audit/ are
// prose about the work, not instructions; tests/unit/fixtures/ is never under docs/.
function walk(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}
const SCAN_SET = [
  'README.md',
  'docker/description/long.md',
  ...walk('docs').filter((f) => f.endsWith('.md') && !f.startsWith('docs/plans/') && !f.startsWith('docs/audit/')),
];

const blocksOf = (file, text = read(file)) => extractBlocks(text, file);
const fixtureBlock = (heading) => {
  const md = readFileSync(join(FIXTURES, 'negative.md'), 'utf8');
  const section = md.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  assert.ok(section, `fixture section ${heading} missing`);
  const offset = md.slice(0, md.indexOf(`## ${section}`)).split('\n').length;
  return extractBlocks(section, 'fixture.md').map((b) => ({ ...b, fenceLine: b.fenceLine + offset - 1 }))[0];
};

console.log('\n[install-snippets] scan set');

const allBlocks = SCAN_SET.flatMap((f) => blocksOf(f));

check('structural lint: no comment or text inside a line continuation in any bash/sh block', () => {
  const errors = allBlocks.flatMap(lintStructure);
  assert.deepStrictEqual(errors, []);
});

check('content rules: every docker run block uses the published image, --env-file, no localhost, no token or password', () => {
  const errors = allBlocks.flatMap(checkContent);
  assert.deepStrictEqual(errors, []);
});

check('fragment markers: only on the allowlisted blocks', () => {
  assert.deepStrictEqual(fragmentErrors(allBlocks), []);
});

check('fragment allowlist: every entry still matches a marked block (no stale entries)', () => {
  for (const a of FRAGMENT_ALLOWLIST) {
    const hit = allBlocks.some((b) => b.fragment && b.file === a.file && JSON.stringify(runsOf(b)) === JSON.stringify(a.runs));
    assert.ok(hit, `stale fragment allowlist entry: ${a.file} ${a.runs.join(' | ')}`);
  }
});

for (const [file, ids] of Object.entries(REQUIRED_RUNNABLE)) {
  check(`${file}: carries every required runnable marker`, () => {
    const text = read(file);
    for (const id of ids) findRunnable(text, file, id);
  });
}

check('runnable ids are unique per file', () => {
  for (const file of SCAN_SET) {
    const ids = blocksOf(file).map((b) => b.runnable).filter(Boolean);
    assert.deepStrictEqual(ids, [...new Set(ids)], `duplicate runnable id in ${file}`);
  }
});

check('every marked block uses only allowlisted commands', () => {
  const errors = allBlocks.filter((b) => b.runnable).flatMap(checkAllowlist);
  assert.deepStrictEqual(errors, []);
});

check('.env.example: no uncommented localhost ACTUAL_SERVER_URL', () => {
  assert.deepStrictEqual(checkEnvExample(read('.env.example')), []);
});

console.log('\n[install-snippets] negative fixtures');

check('NEGATIVE: README without its docker-run marker fails with the missing-marker message', () => {
  const text = read('README.md').replace('<!-- runnable: docker-run -->\n', '');
  assert.throws(() => findRunnable(text, 'README.md', 'docker-run'), /missing runnable marker docker-run in README\.md/);
});

check('NEGATIVE: a comment line inside a continuation is flagged with file and line', () => {
  const errs = lintStructure(fixtureBlock('comment-in-continuation'));
  assert.ok(errs.some((e) => /^comment line inside a line continuation \(fixture\.md:\d+\)$/.test(e)), errs.join('; '));
});

check('NEGATIVE: text after a continuation is flagged', () => {
  const errs = lintStructure(fixtureBlock('text-after-continuation'));
  assert.ok(errs.some((e) => e.startsWith('text after line continuation')), errs.join('; '));
});

check('NEGATIVE: an unmarked docker run block with a localhost Actual URL fails', () => {
  const errs = checkContent(fixtureBlock('localhost-url'));
  assert.ok(errs.some((e) => e.startsWith('localhost ACTUAL_SERVER_URL inside a docker run block')), errs.join('; '));
});

check('NEGATIVE: a token on the docker run command line fails', () => {
  const errs = checkContent(fixtureBlock('token-inline'));
  assert.ok(errs.some((e) => e.startsWith('token on the docker run command line')), errs.join('; '));
});

check('NEGATIVE: a fragment marker outside the allowlist fails with file and line', () => {
  const errs = fragmentErrors([fixtureBlock('fragment-outside-allowlist')]);
  assert.deepStrictEqual(errs.length, 1);
  assert.match(errs[0], /^fragment marker not in the allowlist: fixture\.md:\d+$/);
});

check('POSITIVE: an upgrade block naming docker run only in a comment passes the content check', () => {
  const b = fixtureBlock('upgrade-comment-only');
  assert.deepStrictEqual(dockerRunCommands(b), []);
  assert.deepStrictEqual(checkContent(b), []);
});

check('POSITIVE: the allowlisted ARCHITECTURE fragment reports no image or --env-file failure', () => {
  const b = blocksOf('docs/explanation/architecture.md').find((x) => runsOf(x).length > 0);
  assert.ok(b && b.fragment, 'docs/explanation/architecture.md docker run block must carry the fragment marker');
  assert.deepStrictEqual(checkContent(b), []);
});

check('commandNames: sees inside $(...), backticks, process substitution and { } groups, ignores comments', () => {
  const names = commandNames('a=$(openssl rand -hex 32) # wget x\nx=`curl y`; diff <(grep a b) c && { printf z; }');
  assert.deepStrictEqual(names.sort(), ['curl', 'diff', 'grep', 'openssl', 'printf'].sort());
});

check('tokenize: quotes are removed without expansion', () => {
  const words = tokenize('docker run -e "A=$(x)" \'B=$y\' C\\ D').filter((t) => t.type === 'word').map((t) => t.value);
  assert.deepStrictEqual(words, ['docker', 'run', '-e', 'A=$(x)', 'B=$y', 'C D']);
});

// ---------------------------------------------------------------------------------------------
// Snippet argument check: run marked blocks with stub docker, npx and curl.

console.log('\n[install-snippets] snippet argument check');

const sandbox = mkdtempSync(join(tmpdir(), 'install-snippets-'));
let PATH_DIRS;
try {
  const stubDir = join(sandbox, 'stubs');
  mkdirSync(stubDir);
  const stub = readFileSync(join(FIXTURES, 'stubs', 'stub.sh'), 'utf8');
  for (const name of ['docker', 'npx', 'curl']) writeFileSync(join(stubDir, name), stub, { mode: 0o755 });
  const realDir = makeToolDir(join(sandbox, 'real'));
  PATH_DIRS = `${stubDir}:${realDir}`;
} catch (err) {
  console.error(`  FAIL: preparing the stub PATH -> ${err.message}`);
  failed++;
}

let caseNo = 0;
function runCase(block, { setup, withEnvExample = false } = {}) {
  const cwd = join(sandbox, `case-${++caseNo}`);
  mkdirSync(cwd);
  const log = join(cwd, '.stub-log');
  writeFileSync(log, '');
  if (withEnvExample) copyFileSync(join(ROOT, '.env.example'), join(cwd, '.env.example'));
  if (setup) setup(cwd);
  const r = runBlock(block, { cwd, path: PATH_DIRS, extraEnv: { STUB_LOG: log } });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').slice(0, -1));
  return { cwd, r, calls, env: () => readFileSync(join(cwd, '.env'), 'utf8') };
}
const tokenLines = (env) => env.split('\n').filter((l) => l.startsWith('MCP_SSE_AUTHORIZATION='));

try {
  const readme = read('README.md');

  check('README docker-run hands Docker exactly one run with the GHCR image, --env-file and no localhost', () => {
    const { r, calls } = runCase(findRunnable(readme, 'README.md', 'docker-run'));
    assert.strictEqual(r.status, 0, r.stderr);
    const runs = calls.filter((c) => c[0] === 'docker' && c[1] === 'run');
    assert.strictEqual(runs.length, 1, `docker run calls: ${JSON.stringify(calls)}`);
    assert.ok(runs[0].includes('ghcr.io/agigante80/actual-mcp-server:latest'), runs[0].join(' '));
    assert.ok(runs[0].includes('--env-file'), runs[0].join(' '));
    assert.ok(!runs[0].some((a) => /ACTUAL_SERVER_URL=\S*(localhost|127\.0\.0\.1)/.test(a)), runs[0].join(' '));
  });

  for (const [file, ids] of Object.entries(REQUIRED_RUNNABLE)) {
    for (const id of ids.filter((x) => /docker-run/.test(x))) {
      check(`${file} ${id}: every docker run gets a published image and --env-file`, () => {
        const { r, calls } = runCase(findRunnable(read(file), file, id));
        assert.strictEqual(r.status, 0, r.stderr);
        const runs = calls.filter((c) => c[0] === 'docker' && c[1] === 'run');
        assert.ok(runs.length >= 1, `no docker run recorded: ${JSON.stringify(calls)}`);
        for (const run of runs) {
          assert.ok(run.some((a) => IMAGE_RE.test(a)), run.join(' '));
          assert.ok(run.includes('--env-file'), run.join(' '));
          assert.ok(!run.some((a) => /MCP_SSE_AUTHORIZATION|ACTUAL_PASSWORD/.test(a)), run.join(' '));
          // The docs offer ACTUAL_SERVER_URL=http://host.docker.internal:5006 for the same
          // .env, and on Linux Docker Engine that name resolves only with this mapping.
          assert.ok(run.includes('--add-host=host.docker.internal:host-gateway'), run.join(' '));
        }
      });
    }
  }

  const envTokenBlock = () => findRunnable(readme, 'README.md', 'env-token');

  check('token snippet is idempotent and private', () => {
    const c = runCase(envTokenBlock());
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    const first = tokenLines(c.env());
    const again = runBlock(envTokenBlock(), { cwd: c.cwd, path: PATH_DIRS, extraEnv: { STUB_LOG: join(c.cwd, '.stub-log') } });
    assert.strictEqual(again.status, 0, again.stderr);
    const second = tokenLines(c.env());
    assert.strictEqual(statSync(join(c.cwd, '.env')).mode & 0o777, 0o600);
    assert.strictEqual(second.length, 1, c.env());
    assert.deepStrictEqual(second, first);
    assert.match(second[0], /^MCP_SSE_AUTHORIZATION=[0-9a-f]{64}$/);
    assert.ok(c.r.stdout.includes(second[0]), 'the snippet must show the token it wrote');
    for (const k of ['ACTUAL_SERVER_URL=http://YOUR-ACTUAL-HOST:5006', 'ACTUAL_PASSWORD=', 'ACTUAL_BUDGET_SYNC_ID=']) {
      assert.strictEqual(c.env().split('\n').filter((l) => l.startsWith(k.split('=')[0] + '=')).length, 1, `${k} once`);
    }
  });

  check('NEGATIVE: a placeholder token is replaced', () => {
    const c = runCase(envTokenBlock(), { setup: (cwd) => writeFileSync(join(cwd, '.env'), 'MCP_SSE_AUTHORIZATION=your_token_here\n') });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    const lines = tokenLines(c.env());
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /^MCP_SSE_AUTHORIZATION=[0-9a-f]{64}$/);
  });

  check('NEGATIVE: a stale world-readable .env.new does not leak into .env', () => {
    const c = runCase(envTokenBlock(), {
      setup: (cwd) => writeFileSync(join(cwd, '.env.new'), 'stale\n', { mode: 0o644 }),
    });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    assert.strictEqual(statSync(join(c.cwd, '.env')).mode & 0o777, 0o600);
  });

  check('NEGATIVE: a .env without a final newline keeps its last value', () => {
    const c = runCase(envTokenBlock(), {
      setup: (cwd) => writeFileSync(join(cwd, '.env'), 'ACTUAL_PASSWORD=secret', { mode: 0o600 }),
    });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    const lines = c.env().split('\n');
    assert.ok(lines.includes('ACTUAL_PASSWORD=secret'), c.env());
    assert.ok(lines.includes('ACTUAL_SERVER_URL=http://YOUR-ACTUAL-HOST:5006'), c.env());
  });

  check('NEGATIVE: duplicate token lines collapse to one', () => {
    const real = 'a'.repeat(64);
    const c = runCase(envTokenBlock(), {
      setup: (cwd) => writeFileSync(join(cwd, '.env'), `MCP_SSE_AUTHORIZATION=${real}\nMCP_SSE_AUTHORIZATION=short\n`),
    });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    const lines = tokenLines(c.env());
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /^MCP_SSE_AUTHORIZATION=[0-9a-f]{64}$/);
  });

  check('NEGATIVE: an existing .env is preserved by compose-production', () => {
    const c = runCase(findRunnable(readme, 'README.md', 'compose-production'), {
      withEnvExample: true,
      setup: (cwd) => writeFileSync(join(cwd, '.env'), 'ACTUAL_PASSWORD=keep\n', { mode: 0o600 }),
    });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    assert.ok(c.env().split('\n').includes('ACTUAL_PASSWORD=keep'), c.env());
    assert.ok(c.calls.some((x) => x.join(' ') === 'docker compose --profile production up -d'), JSON.stringify(c.calls));
  });

  check('compose-production creates .env from the template when there is none', () => {
    const c = runCase(findRunnable(readme, 'README.md', 'compose-production'), { withEnvExample: true });
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    assert.ok(existsSync(join(c.cwd, '.env')));
    assert.strictEqual(statSync(join(c.cwd, '.env')).mode & 0o777, 0o600);
    assert.strictEqual(tokenLines(c.env()).length, 1);
    assert.ok(c.env().includes('ACTUAL_BUDGET_SYNC_ID='), 'the template values are copied');
  });

  check('npx-http starts the HTTP server with npx and nothing on the command line', () => {
    const c = runCase(findRunnable(readme, 'README.md', 'npx-http'));
    assert.strictEqual(c.r.status, 0, c.r.stderr);
    const npx = c.calls.filter((x) => x[0] === 'npx');
    assert.strictEqual(npx.length, 1, JSON.stringify(c.calls));
    assert.ok(npx[0].includes('actual-mcp-server') && npx[0].includes('--http'), npx[0].join(' '));
  });

  check('NEGATIVE: a marked block with a command outside the allowlist is refused before it runs', () => {
    const cwd = join(sandbox, 'refused');
    mkdirSync(cwd);
    const log = join(cwd, '.stub-log');
    writeFileSync(log, '');
    const b = fixtureBlock('wget-marked');
    assert.throws(() => runBlock(b, { cwd, path: PATH_DIRS, extraEnv: { STUB_LOG: log } }),
      /command not in the snippet allowlist: wget \(fixture\.md:\d+\)/);
    assert.strictEqual(readFileSync(log, 'utf8'), '', 'nothing may run');
  });

  check('smoke argv: only the image, the name and named volumes change; argv is otherwise the block', () => {
    const block = findRunnable(readme, 'README.md', 'docker-run');
    const original = dockerRunCommands(block)[0].map((w) => w.value).slice(1);
    const { argv, port } = smokeArgv(block, { image: 'local:ci', name: 'ci-smoke-1', volumePrefix: 'ci-smoke-1' });
    assert.strictEqual(argv.length, original.length);
    assert.strictEqual(argv[argv.length - 1], 'local:ci');
    assert.strictEqual(argv[argv.indexOf('--name') + 1], 'ci-smoke-1');
    assert.strictEqual(port, '3600');
    const changed = argv.map((a, i) => (a === original[i] ? null : i)).filter((i) => i !== null);
    for (const i of changed) {
      assert.ok(i === argv.length - 1 || argv[i - 1] === '--name' || argv[i - 1] === '-v', `unexpected change at ${argv[i]}`);
    }
  });
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n[install-snippets] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
