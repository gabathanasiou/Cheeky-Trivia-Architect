#!/usr/bin/env node
// Smart E2E selector — runs only the Playwright specs your changes can touch.
//
//   npm run test:smart              # run affected specs
//   npm run test:smart -- --list    # just print the selection
//   SMART_BASE=origin/main npm run test:smart   # diff against a branch
//   npm run test:smart -- --full    # always run the entire suite
//
// How it works (ported from lemon_schedule/scripts/smart-test.mjs):
//  1. Collect changed files (git working tree vs $BASE, incl. untracked).
//  2. Every changed file maps through RULES (source glob -> spec base names).
//     - 'ALL' (core shared files) forces the full suite.
//     - A spec file change pulls in exactly that spec.
//     - An UNMAPPED src change runs canaries only, with a warning: add a rule
//       or run the full suite before done.
//  3. Canaries (always-on smoke specs) + last-run failures are always included.
//
// The rule map is a judgment call — extend it as the project grows. Never
// second-guess an ALL entry; when in doubt, run the full suite.
//
// TODO(after scaffolding): replace the EXAMPLE rules below with the project's
// real spec buckets. Every spec under e2e MUST appear in some bucket or
// `npm run lint` (check-test-hygiene.mjs) fails as an orphan.

import { execSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SMART_BASE || 'HEAD';
const E2E = join(ROOT, 'e2e');

// ---- Spec buckets (base names under the e2e dir, no extension) ----
// EXAMPLE — replace with the project's real buckets:
const CANARY = ['smoke']; // always included (a boot smoke spec)
// const MENUS = ['dropdown-menu', 'context-menu'];

// ---- Source -> specs map. First match wins per file. s: 'ALL' = full suite. ----
const RULES = [
  // tooling / unit tests don't affect the browser suite
  { g: 'scripts/**', s: [] },
  { g: 'src/**/*.test.ts', s: [] },
  // config / harness files — full suite
  { g: 'package*.json', s: 'ALL' },
  { g: 'vite.config.*', s: 'ALL' },
  { g: 'vitest.config.*', s: 'ALL' },
  { g: 'playwright*.config.ts', s: 'ALL' },
  { g: 'tsconfig*.json', s: 'ALL' },
  { g: 'index.html', s: 'ALL' },
  { g: 'e2e/helpers.ts', s: 'ALL' },
  // core shared modules — full suite
  { g: 'src/core/**', s: 'ALL' },
  { g: 'src/server/**', s: 'ALL' },
  { g: 'src/ui/**', s: 'ALL' },
  // EXAMPLE feature mapping — replace:
  // { g: 'src/components/Menu*.tsx', s: MENUS },
];

// ---- tiny glob: supports `**` (any depth), `*` (within a segment) ----
function globRe(glob) {
  const parts = glob.split('/');
  const re = parts
    .map(p => {
      if (p === '**') return '(?:[^/]*(?:/[^/]*)*)?';
      return p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/');
  return new RegExp(`^${re}$`);
}
const compiled = RULES.map(({ g, s }) => ({ re: globRe(g), s }));

function firstMatch(file) {
  for (const { re, s } of compiled) if (re.test(file)) return s;
  return null;
}

// ---- collect changed files (working tree vs BASE, incl. untracked) ----
function gitOut(args) {
  try { return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch { return ''; }
}
function isRelevant(f) {
  return (
    f.startsWith('src/') || f.startsWith('e2e/') || f.startsWith('scripts/') ||
    /^(package(?:-lock)?\.json|vite\.config\.[cm]?[jt]s?|vitest\.config\.[cm]?[jt]s?|playwright[\w-]*\.config\.ts|tsconfig[\w-]*\.json|index\.html)$/.test(f)
  );
}
function changedFiles() {
  const files = new Set();
  for (const line of gitOut(`diff --name-only ${BASE}`).split('\n')) if (line.trim()) files.add(line.trim());
  for (const line of gitOut(`ls-files --others --exclude-standard`).split('\n')) if (line.trim()) files.add(line.trim());
  return [...files].filter(isRelevant).sort();
}

function execInherit(bin, args) {
  try { execFileSync(bin, args, { cwd: ROOT, stdio: 'inherit' }); process.exit(0); }
  catch (e) { process.exit(typeof e.status === 'number' ? e.status : 1); }
}

function run(sel, listOnly) {
  if (listOnly) {
    console.log(sel && sel.length ? sel.join('\n') : '(full suite)');
    return;
  }
  if (!sel) {
    console.log('running FULL suite');
    execInherit('npx', ['playwright', 'test', '-c', 'playwright.config.ts']);
  }
  console.log(`running ${sel.length} spec(s):`);
  console.log(sel.map(s => '  ' + s).join('\n'));
  execInherit('npx', ['playwright', 'test', '-c', 'playwright.config.ts', ...sel]);
}

function main() {
  const listOnly = process.argv.includes('--list');
  const forceFull = process.argv.includes('--full');
  const changed = changedFiles();
  if (forceFull) { console.log('--full: running entire suite'); run(null, false); process.exit(0); }
  if (changed.length === 0) {
    console.log(`no changes since ${BASE} — nothing to run. Use --full.`);
    process.exit(0);
  }

  const wanted = new Set(CANARY.map(s => `${E2E}/${s}.spec.ts`));
  const matched = [], unmatched = [];
  let full = false;
  for (const file of changed) {
    if (new RegExp(`^e2e/.+\\.spec\\.ts$`).test(file)) { matched.push(file); wanted.add(file); continue; }
    const s = firstMatch(file);
    if (s === 'ALL') { full = true; break; }
    if (s) { matched.push(file); s.forEach(spec => wanted.add(`${E2E}/${spec}.spec.ts`)); }
    else unmatched.push(file);
  }

  // last-run failures are always retried
  try {
    const lr = JSON.parse(readFileSync(join(ROOT, 'test-results/.last-run.json'), 'utf8'));
    for (const t of lr.failedTests ?? []) {
      const m = String(t).match(new RegExp(`^(?:\\[[^\\]]+\\]\\s*›\\s*)?(e2e/[\\w-]+\\.spec\\.ts)`));
      if (m) wanted.add(m[1]);
    }
  } catch {}

  if (full) {
    console.log(`core/config change detected — running FULL suite.`);
    run(null, listOnly);
    process.exit(0);
  }
  if (unmatched.length) {
    console.warn('\nUNMAPPED changes (cannot attribute to specs) — running canaries only:');
    for (const f of unmatched) console.warn('  ' + f);
    console.warn('Add a mapping rule in scripts/smart-test.mjs, or run the full suite before done.\n');
  }
  console.log(`smart selection from ${BASE} (${changed.length} changed):`);
  for (const f of changed) console.log('  - ' + f);
  run([...wanted].sort(), listOnly);
}

main();
