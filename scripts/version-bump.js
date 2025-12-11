#!/usr/bin/env node
import fs from 'fs';

const bumpType = process.argv[2] || 'patch';
const currentVersion = fs.readFileSync('VERSION', 'utf8').trim();
const [major, minor, patch] = currentVersion.split('.').map(Number);

let newVersion;
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

console.log(`Bumping version: ${currentVersion} → ${newVersion}`);

// Update VERSION file
fs.writeFileSync('VERSION', newVersion + '\n');

// Update package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');

console.log(`✅ Version bumped to ${newVersion}`);
console.log('📝 Next steps:');
console.log('   git add VERSION package.json');
console.log(`   git commit -m "chore(release): bump version to ${newVersion}"`);
console.log(`   git tag -a "v${newVersion}" -m "Release v${newVersion}"`);
