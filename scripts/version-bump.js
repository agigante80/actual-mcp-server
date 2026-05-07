#!/usr/bin/env node
/**
 * version-bump.js
 *
 * Usage:
 *   node scripts/version-bump.js [major|minor|patch|sync] [--force]
 *
 * Modes:
 *   major / minor / patch  — bump VERSION + package.json + sync **Version:** and **Tool Count:** in docs
 *   sync                   — only update **Version:** and **Tool Count:** markers in docs
 *                            to match the current VERSION file and actualToolsManager.ts (no bump)
 *
 * Flags:
 *   --force                — skip the production-tag freshness check below
 *                            (only use when you know production is wrong, e.g. a corrupt tag)
 *
 * npm scripts:
 *   npm run release:major    →  node scripts/version-bump.js major
 *   npm run release:minor    →  node scripts/version-bump.js minor
 *   npm run release:patch    →  node scripts/version-bump.js patch
 *   npm run docs:sync        →  node scripts/version-bump.js sync
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const bumpType = process.argv[2] || 'patch';
const syncOnly = bumpType === 'sync';
const force = process.argv.includes('--force');
const currentVersion = fs.readFileSync('VERSION', 'utf8').trim();

// ── Production-tag freshness check ──────────────────────────────────────────
// Added 2026-05-07 after a v0.6.4 collision: the scheduled
// "Dependency Update & Auto-Release" workflow shipped v0.6.4 at 01:41 UTC,
// then a manual `npm run release:patch` at 08:46 UTC bumped develop to the
// same number — independently — because the local VERSION (0.6.3) didn't
// know origin had advanced.
//
// To prevent that class of bug, we now query `git ls-remote --tags origin`
// (origin's authoritative tag list) and abort if the local VERSION is BEHIND
// the latest release tag. The remediation is a clean message telling the
// caller to merge origin/main locally first.
//
// `--force` overrides the check — only use it when production is genuinely
// wrong (e.g. a corrupt tag) and you're consciously rewriting history.
if (!syncOnly && !force) {
  let latestProdVersion = null;
  try {
    const lsRemote = execFileSync(
      'git',
      ['ls-remote', '--tags', 'origin', 'refs/tags/v*.*.*'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const remoteTagNames = lsRemote
      .split('\n')
      .map(line => {
        const match = line.match(/refs\/tags\/(v\d+\.\d+\.\d+)(?:\^\{\})?$/);
        return match ? match[1] : null;
      })
      .filter(Boolean);
    const remoteSemvers = [...new Set(remoteTagNames)]
      .map(t => t.replace(/^v/, '').split('.').map(Number))
      .filter(parts => parts.length === 3 && parts.every(n => Number.isInteger(n)));
    if (remoteSemvers.length > 0) {
      remoteSemvers.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      latestProdVersion = remoteSemvers[remoteSemvers.length - 1];
    }
  } catch (err) {
    console.warn(`⚠ Could not query origin tags (${(err && err.message) || err}). Proceeding without the freshness check.`);
    console.warn(`  Common causes: offline, origin unreachable, or this is a fresh clone with no tags yet.`);
    console.warn(`  Re-run with network access to enable the safety check.`);
  }

  if (latestProdVersion) {
    const localParts = currentVersion.split('.').map(Number);
    const cmp =
      localParts[0] - latestProdVersion[0] ||
      localParts[1] - latestProdVersion[1] ||
      localParts[2] - latestProdVersion[2];
    const prodStr = latestProdVersion.join('.');
    if (cmp < 0) {
      console.error('');
      console.error('❌ ABORTING: production is AHEAD of your local branch.');
      console.error('');
      console.error(`   Local VERSION:        ${currentVersion}`);
      console.error(`   Latest release tag:   v${prodStr}  (on origin)`);
      console.error('');
      console.error('   Production has moved on — most likely the scheduled');
      console.error('   "Dependency Update & Auto-Release" workflow shipped a new');
      console.error('   version since this branch was last synced. Bumping now would');
      console.error('   reuse a version number that is already published.');
      console.error('');
      console.error('   To resolve, merge production into your local branch first:');
      console.error('     git fetch origin');
      console.error('     git merge --ff-only origin/main      # if your branch is an ancestor');
      console.error('     # OR if your branch has its own commits:');
      console.error('     git merge origin/main                # creates a merge commit');
      console.error('');
      const npmCmd = bumpType === 'major' ? 'release:major' : bumpType === 'minor' ? 'release:minor' : 'release:patch';
      console.error(`   Then re-run: npm run ${npmCmd}`);
      console.error('');
      console.error('   To override the check (rare — only if production is wrong):');
      console.error(`     node scripts/version-bump.js ${bumpType} --force`);
      console.error('');
      process.exit(1);
    } else if (cmp === 0) {
      console.log(`✓ Local VERSION matches latest production tag (v${prodStr}) — safe to bump.`);
    } else {
      console.log(`ℹ Local VERSION (${currentVersion}) is ahead of latest production tag (v${prodStr}).`);
      console.log(`  This usually means a previous bump is committed but not yet released. Proceeding.`);
    }
  }
}

let targetVersion = currentVersion;
let major, minor, patch;
if (!syncOnly) {
  [major, minor, patch] = currentVersion.split('.').map(Number);
}

if (!syncOnly) {
  switch (bumpType) {
    case 'major': targetVersion = `${major + 1}.0.0`; break;
    case 'minor': targetVersion = `${major}.${minor + 1}.0`; break;
    case 'patch':
    default:      targetVersion = `${major}.${minor}.${patch + 1}`; break;
  }

  console.log(`Bumping version: ${currentVersion} → ${targetVersion}`);

  fs.writeFileSync('VERSION', targetVersion + '\n');

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  packageJson.version = targetVersion;
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
}

// ── Sync tool count in package.json description ────────────────────────────
// Done outside the !syncOnly block so `docs:sync` also keeps it up to date.
{
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const managerSrcEarly = fs.readFileSync(path.join('src', 'actualToolsManager.ts'), 'utf8');
  const earlyToolCount = (managerSrcEarly.match(/^\s*'actual_/gm) || []).length;
  if (packageJson.description) {
    const updated = packageJson.description.replace(/\d+ tools/, `${earlyToolCount} tools`);
    if (updated !== packageJson.description) {
      packageJson.description = updated;
      fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
      console.log(`📝 Updated tool count in package.json description → ${earlyToolCount} tools`);
    }
  }
}

if (syncOnly) {
  console.log(`Syncing **Version:** markers to current version: ${currentVersion}`);
}

// ── Compute current tool count from actualToolsManager.ts ──────────────────
const managerSrc = fs.readFileSync(path.join('src', 'actualToolsManager.ts'), 'utf8');
const toolCount = (managerSrc.match(/^\s*'actual_/gm) || []).length;
console.log(`Tool count (from actualToolsManager.ts): ${toolCount}`);

// ── Auto-update **Version:** and **Tool Count:** markers in docs ─────────────
// **Version:** X.Y.Z  — version marker
// **Tool Count:** N   — tool count marker (number immediately after the colon+space)
const versionPattern   = /(\*\*Version:\*\*\s*)\d+\.\d+\.\d+/g;
const toolCountPattern = /(\*\*Tool Count:\*\*\s*)\d+/g;

const docsToUpdate = [
  'README.md',
  ...fs.readdirSync('docs').filter(f => f.endsWith('.md')).map(f => path.join('docs', f)),
  path.join('.github', 'copilot-instructions.md'),
];

const updatedDocs = [];
for (const file of docsToUpdate) {
  if (!fs.existsSync(file)) continue;
  const original = fs.readFileSync(file, 'utf8');
  let updated = original.replace(versionPattern, `$1${targetVersion}`);
  updated = updated.replace(toolCountPattern, `$1${toolCount}`);
  if (updated !== original) {
    fs.writeFileSync(file, updated);
    updatedDocs.push(file);
  }
}

if (updatedDocs.length > 0) {
  console.log(`📝 Updated markers in: ${updatedDocs.join(', ')}`);
} else {
  console.log(`ℹ️  No markers needed updating`);
}

if (!syncOnly) {
  console.log(`✅ Version bumped to ${targetVersion}`);
  console.log('📝 Next steps:');
  console.log(`   git add VERSION package.json docs/ README.md .github/`);
  console.log(`   git commit -m "chore(release): bump version to ${targetVersion}"`);
  console.log(`   git tag -a "v${targetVersion}" -m "Release v${targetVersion}"`);
} else {
  console.log(`✅ Docs synced to v${targetVersion} / ${toolCount} tools`);
}
