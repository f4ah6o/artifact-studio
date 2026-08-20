#!/usr/bin/env node
import { readdirSync, statSync, unlinkSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outName = 'bpmn-generator-v3.skill';
const outPath = join(repoRoot, outName);

// Inclusion rules: SKILL.md + runtime BPMN/core/adapter/server source
//                  + package metadata + references/*.md|json
// Browser UI, AI providers, tests, robustness tooling, and node_modules are excluded.
const sourceRoots = ['bpmn', 'core', 'adapters', 'server'];
const includes = [
  'SKILL.md',
  'package.json',
  ...sourceRoots.flatMap((sourceRoot) =>
    walk(
      join(repoRoot, 'src', sourceRoot),
      (_full, name) => name.endsWith('.js') || name === 'config.json',
    ).map((file) => relative(repoRoot, file)),
  ),
  ...walk(join(repoRoot, 'references'), (full, name) => {
    if (full.includes('/omg-spec/') || full.includes('/review-set/')) return false;
    return name.endsWith('.md') || name.endsWith('.json');
  }).map((file) => relative(repoRoot, file)),
];

function walk(dir, filter, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, filter, acc);
    else if (filter(full, entry)) acc.push(full);
  }
  return acc;
}

const args = ['-r', outPath, ...includes];
try {
  unlinkSync(outPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
execFileSync('zip', args, { cwd: repoRoot, stdio: 'inherit' });
console.log(`\nBuilt ${outName} (${includes.length} files).`);
console.log(`Inspect: unzip -l ${outName}`);
