#!/usr/bin/env node
/**
 * version-bump.js
 *
 * Usage:
 *   node scripts/version-bump.js [major|minor|patch|sync]
 *
 * Modes:
 *   major / minor / patch  — bump VERSION + package.json + sync **Version:** and **Tool Count:** in docs
 *   sync                   — only update **Version:** and **Tool Count:** markers in docs
 *                            to match the current VERSION file and actualToolsManager.ts (no bump)
 *
 * npm scripts:
 *   npm run release:major    →  node scripts/version-bump.js major
 *   npm run release:minor    →  node scripts/version-bump.js minor
 *   npm run release:patch    →  node scripts/version-bump.js patch
 *   npm run docs:sync        →  node scripts/version-bump.js sync
 */
import fs from 'fs';
import path from 'path';

const bumpType = process.argv[2] || 'patch';
const syncOnly = bumpType === 'sync';
const currentVersion = fs.readFileSync('VERSION', 'utf8').trim();

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
