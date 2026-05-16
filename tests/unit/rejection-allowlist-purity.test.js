// Purity test for src/lib/rejection-allowlist.ts (#159).
// Parses the source file and asserts:
//   1. The sentinel docblock marker is present.
//   2. No static import statements except node: specifiers.
//   3. No dynamic import expressions.
//   4. No CommonJS module-loading calls.
//   5. No top-level side-effecting statements.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, '../../src/lib/rejection-allowlist.ts');
const source = readFileSync(sourcePath, 'utf8');
const lines = source.split('\n');

console.log('Running purity test for src/lib/rejection-allowlist.ts');

let failed = false;
function fail(msg, lineNum) {
  failed = true;
  if (typeof lineNum === 'number') {
    console.error(`  FAIL (line ${lineNum + 1}): ${msg}`);
    console.error(`    > ${lines[lineNum]}`);
  } else {
    console.error(`  FAIL: ${msg}`);
  }
}

const SENTINEL = 'MUST remain side-effect-free';
if (!source.includes(SENTINEL)) {
  fail(
    `Sentinel marker "${SENTINEL}" missing. The docblock must include this phrase. See #159.`,
  );
}

const STATIC_IMPORT_RE = /^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;
const COMMONJS_RE = /\b(?:re' + 'quire|createR' + 'equire)\s*\(/;

lines.forEach((line, idx) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;

  const m = STATIC_IMPORT_RE.exec(line);
  if (m && !m[1].startsWith('node:')) {
    fail(
      `Forbidden static import of "${m[1]}". Only node: specifiers permitted. See #159.`,
      idx,
    );
  }

  if (DYNAMIC_IMPORT_RE.test(line)) {
    fail(
      'Forbidden dynamic import. Dynamic imports run at call time and can pull side effects ' +
        'into the module graph after the handler is registered. See #159.',
      idx,
    );
  }

  if (COMMONJS_RE.test(line)) {
    fail(
      'Forbidden CommonJS module-loading call. ESM only. See #159.',
      idx,
    );
  }
});

const TOP_LEVEL_ALLOWED_RE = /^(\s*$|\/\/|\*|export\s|function\s|import\s|\/\*|\*\/|\s*\*|\})/;
let inBlockComment = false;
lines.forEach((line, idx) => {
  if (line.includes('/*')) inBlockComment = true;
  if (line.includes('*/')) {
    inBlockComment = false;
    return;
  }
  if (inBlockComment) return;
  if (line.length === 0) return;
  if (line[0] === ' ' || line[0] === '\t') return;
  if (!TOP_LEVEL_ALLOWED_RE.test(line)) {
    fail(
      'Forbidden top-level statement. The module must contain only declarations ' +
        '(function, export, comments). Side-effecting statements at module scope are not allowed.',
      idx,
    );
  }
});

if (failed) {
  console.error('');
  console.error('Purity invariant violated. See issue #159.');
  process.exit(1);
}

console.log('rejection-allowlist purity test passed');
