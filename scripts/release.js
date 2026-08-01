#!/usr/bin/env node
// Cuts a release: bumps the manifest and package version, commits, tags, pushes.
// The workflow does the rest. Usage: npm run release 1.1.0

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: npm run release <major.minor.patch>   e.g. npm run release 1.1.0');
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' }).trim();

if (run('git status --porcelain')) {
  console.error('Working tree is dirty. Commit or stash first.');
  process.exit(1);
}

if (run('git rev-parse --abbrev-ref HEAD') !== 'main') {
  console.error('Releases are cut from main.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

// Store versions are write-once — a rejected 1.1.0 can never be re-uploaded as
// 1.1.0. Refusing to go backwards is the cheap half of avoiding that.
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

if (cmp(version, manifest.version) <= 0) {
  console.error(`Version must increase: manifest is already ${manifest.version}.`);
  process.exit(1);
}

const FILES = ['manifest.json', 'package.json'];
const original = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, 'utf8')]));

for (const file of FILES) {
  const json = JSON.parse(original[file]);
  json.version = version;
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

// A failed test run must not leave a half-cut release behind. The version bump
// is only real once everything after it has passed.
try {
  execSync('npm test', { stdio: 'inherit' });
} catch {
  for (const file of FILES) writeFileSync(file, original[file]);
  console.error(`\nTests failed. Reverted the bump to ${version}; nothing was committed.`);
  process.exit(1);
}

execSync(`git add manifest.json package.json`, { stdio: 'inherit' });
execSync(`git commit -m "Release ${version}"`, { stdio: 'inherit' });
execSync(`git tag -a v${version} -m "v${version}"`, { stdio: 'inherit' });
execSync('git push origin main --follow-tags', { stdio: 'inherit' });

console.log(`\nTagged v${version} and pushed. Watch it at:`);
console.log('  https://github.com/samburba/cart-to-shelf/actions');
