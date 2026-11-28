// tests/unit/coderabbit_applied.test.js
//
// #851: scripts/check-coderabbit-applied.mjs reads the bot's "Run configuration" block and
// reports whether the app applied .coderabbit.yaml at the pull request head. No network:
// the pure functions run on fixture texts, and the two command cases that are tested here
// fail before any gh call returns (a bad argument, no gh on PATH).
//
// Run: node tests/unit/coderabbit_applied.test.js

import assert from 'assert';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkApplied, pickText } from '../../scripts/check-coderabbit-applied.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-coderabbit-applied.mjs');
const SHA = 'ea7ba049e8124e441dff96cfb973c2a82806f3bf';

// Copied from the bot's Walkthrough comment on pull request 850 (icons trimmed).
const BLOCK = `<!-- review_info_content -->
<details>
<summary><strong> Run configuration</strong></summary>
<dl>
<dd>
<br>

- **Source mode**: Auto
- **Repository**: [agigante80/actual-mcp-server](<https://github.com/agigante80/actual-mcp-server>)
- **Branch**: [t/849-coderabbit-pins](<https://github.com/agigante80/actual-mcp-server/tree/t%2F849-coderabbit-pins>)
- **File**: [.coderabbit.yaml](<https://github.com/agigante80/actual-mcp-server/blob/${SHA}/.coderabbit.yaml>)
- **Commit**: [ea7ba04](<https://github.com/agigante80/actual-mcp-server/commit/${SHA}>)
- **Layers**: Repository YAML
- **Review profile**: CHILL
- **Plan**: Advanced

</dd>
</dl>
</details>

<details>
<summary><strong> Commits</strong></summary>
</details>
`;

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
const problems = (label, text, expected) => check(label, () => {
  assert.deepStrictEqual(checkApplied(text, SHA), expected);
});
const swap = (from, to) => {
  assert.ok(BLOCK.includes(from), `fixture lacks ${from}`);
  return BLOCK.replace(from, to);
};

console.log('coderabbit_applied');
problems('the real Walkthrough block of pull request 850 passes', BLOCK, []);
check('the full head sha may be upper case', () => assert.deepStrictEqual(checkApplied(BLOCK, SHA.toUpperCase()), []));
problems('negative: another layer in force', swap('Layers**: Repository YAML', 'Layers**: Repository YAML, Organization UI'),
  ['layers: expected exactly "Repository YAML", review shows "Repository YAML, Organization UI"']);
problems('negative: another commit', swap('[ea7ba04]', '[1234567]'), ['commit: expected ea7ba04, review shows 1234567']);
problems('negative: a commit too short to identify', swap('[ea7ba04]', '[ea7]'), ['commit: expected ea7ba04, review shows ea7']);
problems('negative: another file', swap('[.coderabbit.yaml]', '[other.yaml]'),
  ['file: expected .coderabbit.yaml, review shows other.yaml']);
problems('negative: the Commit line missing', BLOCK.replace(/^- \*\*Commit\*\*.*\n/m, ''),
  ['commit: not found in the run configuration block']);
// Vendor-doc shaped (docs.coderabbit.ai troubleshoot page): never observed on this repository.
check('negative: parsing error text', () => {
  const got = checkApplied(`\`.coderabbit.yaml\` has a parsing error\n\n${BLOCK}`, SHA);
  assert.ok(got.includes('parsing error reported by the app'), JSON.stringify(got));
});
// Vendor-doc shaped (docs.coderabbit.ai global overrides page): never observed here.
problems('negative: an Enforced overrides line', swap('- **Plan**', '- **Enforced overrides**: reviews.profile\n- **Plan**'),
  ['enforced overrides: a global override is in force']);
problems('negative: no Run configuration block', 'Walkthrough text with no block', ['no run configuration block found']);
problems('the heading in earlier prose does not hide the real block',
  `The Run configuration below is collapsed.\n</details>\n${BLOCK}`, []);

const bot = { login: 'coderabbitai[bot]' };
check('pickText: the newest bot text holding the block wins over a newer one without it', () => {
  const got = pickText(
    [{ id: 1, user: bot, updated_at: '2026-11-27T10:00:00Z', body: BLOCK },
      { id: 2, user: bot, updated_at: '2026-11-27T11:00:00Z', body: 'a reply' },
      { id: 3, user: { login: 'someone' }, updated_at: '2026-11-27T12:00:00Z', body: BLOCK }],
    [{ id: 4, user: bot, submitted_at: '2026-11-26T10:00:00Z', body: BLOCK }]);
  assert.deepStrictEqual([got.kind, got.id], ['issue-comment', 1]);
});
check('pickText: a review is read when it is newer', () => {
  const got = pickText([{ id: 1, user: bot, updated_at: '2026-11-26T10:00:00Z', body: BLOCK }],
    [{ id: 4, user: bot, submitted_at: '2026-11-27T10:00:00Z', body: BLOCK }]);
  assert.deepStrictEqual([got.kind, got.id], ['review', 4]);
});
check('pickText: a tie goes to the issue comment', () => {
  const at = '2026-11-27T10:00:00Z';
  const got = pickText([{ id: 1, user: bot, updated_at: at, body: BLOCK }], [{ id: 4, user: bot, submitted_at: at, body: BLOCK }]);
  assert.deepStrictEqual([got.kind, got.id], ['issue-comment', 1]);
});
check('pickText: a block at the head commit wins over a newer stale one', () => {
  const stale = BLOCK.replace('[ea7ba04]', '[1234567]');
  const got = pickText([{ id: 1, user: bot, updated_at: '2026-11-27T12:00:00Z', body: stale }],
    [{ id: 4, user: bot, submitted_at: '2026-11-27T10:00:00Z', body: BLOCK }], SHA);
  assert.deepStrictEqual([got.kind, got.id], ['review', 4]);
});
check('pickText: no bot text is null', () => {
  assert.strictEqual(pickText([{ id: 3, user: { login: 'someone' }, body: BLOCK }], []), null);
});

const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
check('negative: the command refuses a non-numeric argument with exit 2', () => {
  const r = run(['12;ls'], { PATH: '' });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes('pull request number must be digits'), r.stderr);
});
check('negative: the command without gh on PATH exits 3', () => {
  const r = run(['850'], { PATH: '' });
  assert.strictEqual(r.status, 3, r.stderr);
  assert.ok(r.stderr.startsWith('gh failed:'), r.stderr);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
