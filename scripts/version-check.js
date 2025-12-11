#!/usr/bin/env node
import fs from 'fs';

const versionFile = fs.readFileSync('VERSION', 'utf8').trim();
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

console.log(`VERSION file: ${versionFile}`);
console.log(`package.json:  ${packageJson.version}`);

// Check if versions match (ignoring metadata after first hyphen)
const versionFileBase = versionFile.split('-')[0];
const packageJsonBase = packageJson.version.split('-')[0];

if (versionFileBase !== packageJsonBase) {
  console.error('❌ Version mismatch detected!');
  console.error(`   VERSION file base: ${versionFileBase}`);
  console.error(`   package.json base: ${packageJsonBase}`);
  console.error('\n💡 Fix by running:');
  console.error(`   echo "${packageJson.version}" > VERSION`);
  console.error('   OR');
  console.error(`   npm run version:bump -- patch`);
  process.exit(1);
}

console.log('✅ Versions are in sync');
