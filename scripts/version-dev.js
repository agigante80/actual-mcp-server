#!/usr/bin/env node
import fs from 'fs';
import { execSync } from 'child_process';

const baseVersion = fs.readFileSync('VERSION', 'utf8').trim();
const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
const devVersion = `${baseVersion}-dev-${commitHash}`;

console.log(`Development version: ${devVersion}`);

// Update package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
packageJson.version = devVersion;
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');

console.log('✅ package.json updated with dev version');
