// #644: glama.json (the Glama directory's ownership file) and the README score badge.
// checkGlamaJson is pure, so every negative fixture below can fail; then the
// committed file and README are checked.
// Run: node tests/unit/glama_json.test.js
import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = 'https://glama.ai/mcp/schemas/server.json';
const LISTING = 'https://glama.ai/mcp/servers/agigante80/actual-mcp-server';
// GitHub login: alphanumeric runs joined by single hyphens, at most 39 characters.
const LOGIN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

function checkGlamaJson(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return ['glama.json must be a JSON object'];
  const out = [];
  if (obj.$schema !== SCHEMA) out.push(`$schema must equal ${SCHEMA}`);
  const m = obj.maintainers;
  if (!Array.isArray(m) || m.length === 0) {
    out.push('maintainers must be a non-empty array');
  } else {
    const seen = new Set();
    for (const login of m) {
      if (typeof login !== 'string' || login.length > 39 || !LOGIN.test(login)) {
        out.push(`invalid GitHub login: ${typeof login === 'string' ? login : JSON.stringify(login)}`);
        continue;
      }
      // GitHub logins are case-insensitive, so AGIGANTE80 duplicates agigante80.
      if (seen.has(login.toLowerCase())) out.push(`maintainers contains duplicate login: ${login}`);
      seen.add(login.toLowerCase());
    }
  }
  // Stricter than Glama's schema, which has no additionalProperties: false. Deliberate
  // (#644): an unrecognised key (for example a guessed "build" block) would be silently
  // ignored by Glama, so we reject it rather than let it look like configuration.
  for (const k of Object.keys(obj)) {
    if (k !== '$schema' && k !== 'maintainers') out.push(`unexpected key: ${k}`);
  }
  return out;
}

const BADGE_IMG = `${LISTING}/badges/score.svg`;
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkReadmeBadge(text) {
  if (!text.includes(BADGE_IMG)) return ['README is missing the Glama score badge'];
  // [![alt](BADGE_IMG)](LISTING): the image must be the text of a link to the listing.
  const linked = new RegExp(`\\[!\\[[^\\]]*\\]\\(${escapeRe(BADGE_IMG)}\\)\\]\\(${escapeRe(LISTING)}\\)`);
  return linked.test(text) ? [] : ['Glama badge must link to the listing URL'];
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

const good = { $schema: SCHEMA, maintainers: ['agigante80'] };
function returns(name, problems, expected) {
  check(name, () => assert.deepStrictEqual(problems, expected));
}

console.log('checkGlamaJson');
returns('accepts the minimal valid object', checkGlamaJson(good), []);
returns('rejects a missing maintainers key', checkGlamaJson({ $schema: SCHEMA }), ['maintainers must be a non-empty array']);
returns('rejects an empty maintainers list', checkGlamaJson({ ...good, maintainers: [] }), [
  'maintainers must be a non-empty array',
]);
returns('rejects a duplicate login, case-insensitively', checkGlamaJson({ ...good, maintainers: ['agigante80', 'AGIGANTE80'] }), [
  'maintainers contains duplicate login: AGIGANTE80',
]);
for (const bad of ['a_b', 'abc-', 'a--b', '-abc', 'a'.repeat(40)]) {
  returns(`rejects login ${JSON.stringify(bad)}`, checkGlamaJson({ ...good, maintainers: [bad] }), [`invalid GitHub login: ${bad}`]);
}
returns('rejects a non-string login readably', checkGlamaJson({ ...good, maintainers: [{}] }), ['invalid GitHub login: {}']);
returns('accepts a 39-character login', checkGlamaJson({ ...good, maintainers: ['a'.repeat(39)] }), []);
returns('rejects an unknown key', checkGlamaJson({ ...good, build: {} }), ['unexpected key: build']);
returns('rejects a wrong $schema', checkGlamaJson({ ...good, $schema: 'https://example.test/other.json' }), [
  `$schema must equal ${SCHEMA}`,
]);
returns('rejects a non-object', checkGlamaJson([]), ['glama.json must be a JSON object']);

console.log('checkReadmeBadge');
const badgeLine = `[![actual-mcp-server MCP server: quality and maintenance score on Glama](${BADGE_IMG})](${LISTING})`;
returns('accepts the badge linked to the listing', checkReadmeBadge(`# x\n${badgeLine}\n`), []);
returns('rejects a missing badge', checkReadmeBadge('# x\nno badge here\n'), ['README is missing the Glama score badge']);
returns('rejects a badge linked elsewhere', checkReadmeBadge(`[![alt](${BADGE_IMG})](https://glama.ai/)`), [
  'Glama badge must link to the listing URL',
]);
returns('rejects an unlinked badge', checkReadmeBadge(`![alt](${BADGE_IMG})`), ['Glama badge must link to the listing URL']);

console.log('committed files');
returns('glama.json is valid', checkGlamaJson(JSON.parse(readFileSync(join(ROOT, 'glama.json'), 'utf8'))), []);
returns('README carries the badge', checkReadmeBadge(readFileSync(join(ROOT, 'README.md'), 'utf8')), []);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall glama.json checks passed');
