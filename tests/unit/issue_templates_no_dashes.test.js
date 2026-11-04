// tests/unit/issue_templates_no_dashes.test.js
//
// #635: the issue templates under .github/ISSUE_TEMPLATE/ follow two rules every ticket body
// copies from them:
//
//   1. No em or en dash characters (the project's no-dash rule). The checker names file and line.
//   2. A template with a `scenarios` field labels its placeholder scenarios **Positive:** and
//      **Negative:**, the form the ticket gate parses. The emoji-plus-word labels it used before
//      cost a gate round on tickets written from the template (#627).
//
// Each template is also parsed with the `yaml` package, so an indentation slip in an edit is
// caught here rather than by GitHub's form parser after a push.
//
// Run: node tests/unit/issue_templates_no_dashes.test.js

import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, '.github', 'ISSUE_TEMPLATE');
// Built from code points so this file itself carries no dash character.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
const LABELS = ['**Positive:**', '**Negative:**'];

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/** Every line of `text` holding an em or en dash, as { file, line } (1-based). */
function findDashes(file, text) {
  const hits = [];
  text.split('\n').forEach((l, i) => { if (DASHES.test(l)) hits.push({ file, line: i + 1 }); });
  return hits;
}

/** The labels missing from the `scenarios` field's placeholder; [] when there is no such field. */
function missingScenarioLabels(doc) {
  const field = (doc?.body ?? []).find((b) => b?.id === 'scenarios');
  if (!field) return [];
  const placeholder = field.attributes?.placeholder ?? '';
  return LABELS.filter((l) => !placeholder.includes(l));
}

/** The failure message for a template whose scenarios placeholder lacks `label`. */
function labelMessage(file, label) {
  return `${file}: scenarios placeholder lacks ${label}`;
}

console.log('\n[issue-templates-no-dashes]');

const files = readdirSync(DIR).filter((f) => f.endsWith('.yml')).sort();

check('the template directory holds the five work templates', () => {
  for (const f of ['bug.yml', 'feature_request.yml', 'infrastructure.yml', 'security.yml', 'copilot-task.yml']) {
    assert.ok(files.includes(f), `${f} is missing from .github/ISSUE_TEMPLATE/`);
  }
});

check('no template contains an em or en dash', () => {
  const hits = files.flatMap((f) => findDashes(f, readFileSync(join(DIR, f), 'utf8')));
  assert.deepStrictEqual(hits, [], `dash characters at ${hits.map((h) => `${h.file}:${h.line}`).join(', ')}`);
});

check('every template parses as YAML', () => {
  for (const f of files) {
    try { parse(readFileSync(join(DIR, f), 'utf8')); }
    catch (err) { throw new Error(`${f}: ${err.message}`); }
  }
});

check('every scenarios placeholder carries **Positive:** and **Negative:** labels', () => {
  let withField = 0;
  for (const f of files) {
    const doc = parse(readFileSync(join(DIR, f), 'utf8'));
    if ((doc?.body ?? []).some((b) => b?.id === 'scenarios')) withField++;
    const missing = missingScenarioLabels(doc);
    assert.deepStrictEqual(missing, [], missing.map((l) => labelMessage(f, l)).join('; '));
  }
  assert.strictEqual(withField, 5, `expected 5 templates with a scenarios field, found ${withField}`);
});

// Negative cases: the checkers must catch what they guard against, or the passes above prove nothing.

check('findDashes names the file and line of an en dash', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
  lines[9] = `ranges [N${String.fromCodePoint(0x2013)}M]`;
  assert.deepStrictEqual(findDashes('fixture.yml', lines.join('\n')), [{ file: 'fixture.yml', line: 10 }]);
});

check('findDashes catches an em dash too', () => {
  assert.deepStrictEqual(findDashes('f.yml', `a\nitem ${String.fromCodePoint(0x2014)} text`), [{ file: 'f.yml', line: 2 }]);
});

check('missingScenarioLabels reports emoji-only labels as missing', () => {
  const doc = parse([
    'body:',
    '  - type: textarea',
    '    id: scenarios',
    '    attributes:',
    '      placeholder: |',
    '        ✅ Positive',
    '        - Given: x',
    '        ❌ Negative',
    '        - Given: y',
  ].join('\n'));
  assert.deepStrictEqual(missingScenarioLabels(doc), ['**Positive:**', '**Negative:**']);
});

check('missingScenarioLabels reports a lone missing **Negative:** label, with the exact message', () => {
  const doc = parse([
    'body:',
    '  - type: textarea',
    '    id: scenarios',
    '    attributes:',
    '      placeholder: |',
    '        **Positive:** works',
    '        - Given: x',
    '        Negative',
    '        - Given: y',
  ].join('\n'));
  const missing = missingScenarioLabels(doc);
  assert.deepStrictEqual(missing, ['**Negative:**']);
  assert.strictEqual(labelMessage('fixture.yml', missing[0]), 'fixture.yml: scenarios placeholder lacks **Negative:**');
});

check('a plain scalar holding ": " fails to parse (the slip the YAML check exists for)', () => {
  assert.throws(() => parse('body:\n  - type: textarea\n    attributes:\n      description: Full findings: CVE ID\n'));
});

check('missingScenarioLabels ignores a template with no scenarios field', () => {
  assert.deepStrictEqual(missingScenarioLabels(parse('body:\n  - type: markdown\n    attributes:\n      value: hi\n')), []);
});

console.log(`\n[issue-templates-no-dashes] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
