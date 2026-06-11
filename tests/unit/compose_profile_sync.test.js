// tests/unit/compose_profile_sync.test.js
//
// #233: docs must not reference a Docker Compose profile that docker-compose.yaml
// does not define. The file declares only `dev` and `production` (no `fullstack`,
// no nginx tier). This guard fails CI if a doc names a profile the compose file
// lacks, in command form (`--profile X`) or as the specific `fullstack` phantom in
// prose. Mirrors tests/unit/port_alignment.test.js.
//
// Run: node tests/unit/compose_profile_sync.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Declared profiles: handle both the block-list form (`profiles:` then `- name`)
// and the inline-array form (`profiles: [dev, production]`). Commented blocks (e.g.
// the Traefik example) are skipped via the per-line `#` guard.
function declaredProfiles(yaml) {
  const lines = yaml.split('\n');
  const set = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) continue;
    const inline = lines[i].match(/^\s*profiles:\s*\[([^\]]*)\]/);
    if (inline) {
      for (const name of inline[1].split(',')) {
        const t = name.trim().replace(/^['"]|['"]$/g, '');
        if (/^[A-Za-z][\w-]*$/.test(t)) set.add(t);
      }
      continue;
    }
    if (/^\s*profiles:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = lines[j].match(/^\s*-\s*([A-Za-z][\w-]*)\s*$/);
        if (m) set.add(m[1]);
        else break;
      }
    }
  }
  return set;
}

// Profiles referenced in a doc via the `--profile X` or `--profile=X` command form.
const referencedProfiles = (text) => [...text.matchAll(/--profile[=\s]+([A-Za-z][\w-]*)/g)].map((m) => m[1]);

// The specific phantom this ticket removed; shared by the per-doc check and the
// negative test so weakening one does not leave the other vacuously green.
const mentionsFullstackProfile = (text) => /\bfullstack\b/i.test(text);

const DOCS = [
  'README.md',
  '.github/copilot-instructions.md',
  '.claude/agents/health-check.md',
  '.claude/commands/full-review.md',
  'CLAUDE.md',
];

console.log('\n[compose-profile-sync]');

const declared = declaredProfiles(read('docker-compose.yaml'));

check('docker-compose.yaml declares exactly the expected profiles', () => {
  assert.deepStrictEqual([...declared].sort(), ['dev', 'production'], `declared profiles: ${[...declared].join(', ')}`);
});

for (const doc of DOCS) {
  check(`${doc}: every --profile reference is a declared profile`, () => {
    const text = read(doc);
    const bad = referencedProfiles(text).filter((p) => !declared.has(p));
    assert.strictEqual(bad.length, 0, `references undeclared profile(s): ${[...new Set(bad)].join(', ')}`);
  });

  check(`${doc}: no "fullstack" phantom profile mention`, () => {
    assert.ok(!mentionsFullstackProfile(read(doc)), 'mentions a "fullstack" profile that docker-compose.yaml does not define');
  });
}

// Negative cases: invoke the SAME production helpers so weakening them is caught.
check('NEGATIVE: an undeclared --profile reference is detected (space and = forms)', () => {
  const bad = referencedProfiles('docker compose --profile fullstack up; docker compose --profile=staging up')
    .filter((p) => !declared.has(p));
  assert.deepStrictEqual(bad.sort(), ['fullstack', 'staging'], 'guard must flag undeclared profiles in both forms');
});

check('NEGATIVE: the fullstack phantom is detected in prose by the production helper', () => {
  assert.ok(mentionsFullstackProfile('profiles: dev, production, fullstack'), 'phantom check must match prose mentions');
});

console.log(`\n[compose-profile-sync] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
