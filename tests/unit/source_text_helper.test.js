// #532: tests/unit/helpers/source-text.js (stripTsComments, stripHashComments).
// Cases U*, H*, C* are the ones named in the ticket; each also asserts the newline invariant.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTsComments, stripHashComments } from './helpers/source-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lines = (s) => s.split('\n').length;
let passed = 0;

function check(name, strip, input, expected) {
  const out = strip(input);
  assert.equal(out, expected, `${name}: output`);
  assert.equal(lines(out), lines(input), `${name}: newline invariant`);
  passed++;
}
const ts = (name, input, expected) => check(name, stripTsComments, input, expected);
const hash = (name, input, expected) => check(name, stripHashComments, input, expected);

// ---- stripTsComments
ts('U1', "const u = 'http://x'; // note", "const u = 'http://x'; ");
ts('U2', 'const t = `a // b`;', 'const t = `a // b`;');
ts('U3', 'a;/* x\ny\nz */b;', 'a;\n\nb;');
ts('U4', "const s = 'it\\'s // not a comment';", "const s = 'it\\'s // not a comment';");
ts('U5', 'foo(); // shutdownActual(', 'foo(); ');
ts('U6', '/* shutdownActual( */ bar();', ' bar();');
ts('U8', 'if (/^http:\\/\\//i.test(u)) { go(); } // c', 'if (/^http:\\/\\//i.test(u)) { go(); } ');
ts('U9', 'x.match(/^(\\w+):\\s*"([^"]+)"$/); // c\nfoo(\'//\');', 'x.match(/^(\\w+):\\s*"([^"]+)"$/); \nfoo(\'//\');');
ts('U10', 'const r = a / b; // c', 'const r = a / b; ');
ts('U11', "return /'/.test(s); // c", "return /'/.test(s); ");
ts('U12', "const a = 'oops\nfoo(); // c", "const a = 'oops\nfoo(); ");
ts('U13', 'const t = `a ${ /* x */ b } // c`;', 'const t = `a ${  b } // c`;');
ts('U14', 'const t = `a ${f(`b // c`)} d`; // e', 'const t = `a ${f(`b // c`)} d`; ');
ts('U15', 'const t = `${ {a:1}.a } // x`; // y', 'const t = `${ {a:1}.a } // x`; ');
ts('U16', 'a(); // c\r\nb();', 'a(); \r\nb();');
ts('U17', 'x(); /* foo(', 'x(); ');
ts('U18', '', '');
ts('U19', "const s = '/* not */';", "const s = '/* not */';");
// Extra edges beyond the ticket table.
ts('X1 class slash', 'const r = /[/]x/g; // c', 'const r = /[/]x/g; ');
ts('X2 division after paren', 'const r = (a) / b; // c', 'const r = (a) / b; ');
ts('X3 CRLF in block', 'a;/* x\r\ny */b;', 'a;\r\nb;');
ts('X4 line continuation', "const s = 'a\\\nb // c';", "const s = 'a\\\nb // c';");

// ---- stripHashComments
hash('U7', "A=1 # c\nB='x # y'", "A=1 \nB='x # y'");
hash('H2', 'A=a#b', 'A=a#b');
hash('H3', 'key: a#b # real', 'key: a#b ');
hash('H4', '# whole line\nX=1', '\nX=1');
hash('H5', "msg=don't # c\nB=2", "msg=don't \nB=2");
hash('H6', 'X="a \\" # b" # c', 'X="a \\" # b" ');
hash('H7', 'echo ${#arr} # n', 'echo ${#arr} ');
hash('empty', '', '');

// ---- corpus checks
function walk(dir, accept, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, acc);
    else if (accept(p)) acc.push(p);
  }
  return acc;
}

// C1
const srcFiles = walk(join(ROOT, 'src'), (p) => p.endsWith('.ts'));
assert.ok(srcFiles.length > 0, 'C1: found src/**/*.ts');
for (const f of srcFiles) {
  const raw = readFileSync(f, 'utf8');
  assert.equal(lines(stripTsComments(raw)), lines(raw), `C1: newline count of ${f}`);
}
passed++;

// C2
for (const rel of ['src/lib/budget-registry.ts', 'src/config.ts']) {
  const f = join(ROOT, rel);
  if (!existsSync(f)) { console.log(`skip: ${rel} is absent`); continue; }
  const raw = readFileSync(f, 'utf8');
  if (!raw.includes('/^http:\\/\\//i.test(')) { console.log(`skip: ${rel} no longer contains the /^http:\\/\\//i.test( anchor`); continue; }
  assert.ok(stripTsComments(raw).includes('/^http:\\/\\//i.test('), `C2: ${rel} keeps the regex and its call`);
  passed++;
}

// C3
const hashFiles = [join(ROOT, '.env.example')].filter(existsSync);
for (const [dir, accept] of [
  ['scripts', (p) => p.endsWith('.sh')],
  ['.github/workflows', (p) => p.endsWith('.yml')],
]) {
  const d = join(ROOT, dir);
  if (existsSync(d)) hashFiles.push(...walk(d, accept));
  else console.log(`skip: ${dir} is absent`);
}
for (const f of hashFiles) {
  const raw = readFileSync(f, 'utf8');
  const out = stripHashComments(raw);
  const a = raw.split('\n');
  const b = out.split('\n');
  assert.equal(b.length, a.length, `C3: newline count of ${f}`);
  a.forEach((line, k) => {
    if (!line.includes('#')) assert.equal(b[k], line, `C3: ${f}:${k + 1} has no '#' and must be unchanged`);
  });
}
passed++;

console.log(`source_text_helper: ${passed} checks passed`);
