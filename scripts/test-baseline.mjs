#!/usr/bin/env node
// Run Playwright against a clean checkout of HEAD in a throwaway git worktree,
// WITHOUT touching your working tree. Answers "was this failure mine?" without
// the destructive `git checkout` / `git stash` dance.
//
//   npm run test:baseline -- e2e/foo.spec.ts
//   npm run test:baseline -- e2e/foo.spec.ts -g "some title"
//
// Uses an isolated PLAYWRIGHT_PORT so it never reuses the working tree's
// server. Ported from lemon_schedule/scripts/test-baseline.mjs.
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (!args.some((a) => !a.startsWith('-'))) {
  console.error('Usage: npm run test:baseline -- <spec...> [-g "title"]');
  process.exit(2);
}

const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const tmp = mkdtempSync(join(tmpdir(), 'baseline-'));
const wt = join(tmp, 'wt');
const port = String(5400 + (process.pid % 400)); // isolated → config OWNS the server

let code = 1;
try {
  console.log(`[baseline] clean HEAD worktree → ${wt} (isolated port ${port})`);
  execSync(`git worktree add --detach --quiet "${wt}" HEAD`, { cwd: root, stdio: 'inherit' });
  symlinkSync(join(root, 'node_modules'), join(wt, 'node_modules'), 'dir');
  for (const env of ['.env', '.env.local']) {
    if (existsSync(join(root, env))) symlinkSync(join(root, env), join(wt, env));
  }
  const r = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.config.ts', ...args], {
    cwd: wt,
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_PORT: port },
  });
  code = r.status ?? 1;
  console.log(
    code === 0
      ? `[baseline] PASSED on HEAD → the failure is from YOUR working tree.`
      : `[baseline] FAILED on HEAD → pre-existing / flaky, not your diff.`,
  );
} finally {
  try { execSync(`git worktree remove --force "${wt}"`, { cwd: root, stdio: 'ignore' }); } catch {}
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
