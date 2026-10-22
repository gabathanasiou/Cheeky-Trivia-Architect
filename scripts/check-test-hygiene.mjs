#!/usr/bin/env node
// Deterministic guards against test-suite + agent-doc drift — wired into
// `npm run lint`. Ported (right-sized) from lemon_schedule/scripts/check-doc-budget.mjs
// and ui-kit/scripts/check-test-hygiene.mjs.
//
// Why each check exists (each paid for itself):
//  1. wait ratchet — `waitForTimeout` is the #1 flake source. Hold the count
//     at/below the baseline; a new wait must be paid for by removing one.
//     (Set 0 at scaffold time from the current count.)
//  2. fragile selectors — inline-style / utility-class / parent selectors are
//     the documented drift cause; prefer role/testid/data-*.
//  3. suite caps — the browser suite is the expensive layer; growth must be
//     deliberate (extend, push logic to unit tests, or consciously raise a cap).
//  4. orphan specs — every spec must be reachable from scripts/smart-test.mjs
//     RULES, or smart selection silently skips it.
//  5. doc budget — AGENTS.md loads into every session; keep it lean and move
//     detail to docs/*.md.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = join(ROOT, 'e2e');

const WAIT_BASELINE = 0;
const SPEC_CAP = 1;
const TEST_CAP = 4;

const specFiles = readdirSync(SPECS_DIR).filter(f => f.endsWith('.spec.ts')).sort();

let waitCount = 0;
let testCount = 0;
const fragile = [];
const FRAGILE_SELECTORS = [
  { re: /locator\((['"`])[^'"`]*\[style\*=/g, why: 'inline-style selector' },
  { re: /locator\((['"`])div\.[a-zA-Z]/g, why: 'utility-class selector' },
  { re: /locator\((['"`])\.\./g, why: 'parent (`..`) selector' },
  { re: /locator\((['"`])[^'"`]*\[class\*=/g, why: '[class*=] selector' },
];

const errors = [];
const warnings = [];

for (const f of specFiles) {
  const body = readFileSync(join(SPECS_DIR, f), 'utf8');
  waitCount += (body.match(/waitForTimeout\(/g) || []).length;
  testCount += (body.match(/^\s*test\(/gm) || []).length;
  const n = FRAGILE_SELECTORS.reduce((sum, { re }) => sum + (body.match(re)?.length || 0), 0);
  if (n) fragile.push(`${f} (${n})`);
}

console.log('Test hygiene: %d specs / %d tests (caps %d / %d); waitForTimeout %d / baseline %d.',
  specFiles.length, testCount, SPEC_CAP, TEST_CAP, waitCount, WAIT_BASELINE);

if (waitCount > WAIT_BASELINE) {
  errors.push(
    `waitForTimeout calls rose to ${waitCount} (baseline ${WAIT_BASELINE}) — prefer expect/expect.poll/waitForFunction.\n` +
      `  If a wait is genuine animation/interaction pacing, remove another or consciously lower WAIT_BASELINE in this script.`,
  );
}
if (specFiles.length > SPEC_CAP || testCount > TEST_CAP) {
  errors.push(
    `suite grew past its cap (${specFiles.length}/${SPEC_CAP} specs, ${testCount}/${TEST_CAP} tests) — ` +
      `extend an existing spec, push pure logic to a Vitest unit test, or consciously raise the cap (see docs/TESTING.md).`,
  );
}

// Orphan specs: unreachable from smart-test RULES => test:smart never runs them.
const smartSrc = readFileSync(join(ROOT, 'scripts/smart-test.mjs'), 'utf8');
const orphanSpecs = [];
for (const f of specFiles) {
  const base = f.replace(/\.spec\.ts$/, '');
  if (smartSrc.includes(`'${base}'`)) continue;
  const titles = [...readFileSync(join(SPECS_DIR, f), 'utf8').matchAll(/\btest(?:\.\w+)?\(\s*['"`]([^'"`]*)/g)].map(m => m[1]);
  const excluded = titles.length > 0 && titles.every(t => /@quarantine/.test(t));
  if (!excluded) orphanSpecs.push(`e2e/${f}`);
}
console.log('Orphan specs: %d.', orphanSpecs.length);
if (orphanSpecs.length) {
  errors.push(
    `unmapped spec(s) — unreachable from scripts/smart-test.mjs RULES, so test:smart never selects them:\n  ` +
      `${orphanSpecs.join(', ')}\n  Fix: add the spec base name to a bucket in smart-test.mjs, or tag its tests @quarantine.`,
  );
}

// Doc budget: AGENTS.md is always loaded; manuals are read on demand.
const HUB = { file: 'AGENTS.md', maxLines: 200, maxBytes: 36000 };
const MANUAL = { maxLines: 400, maxBytes: 50000 };

function measure(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  return { text, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), bytes: Buffer.byteLength(text, 'utf8') };
}

const hub = measure(HUB.file);
console.log('Docs: AGENTS.md %d/%d lines, %s/%s B.', hub.lines, HUB.maxLines, hub.bytes, HUB.maxBytes);
if (hub.lines > HUB.maxLines || hub.bytes > HUB.maxBytes) {
  errors.push(
    `${HUB.file} is over budget (${hub.lines}/${HUB.maxLines} lines, ${hub.bytes}/${HUB.maxBytes} B).\n` +
      `  Fix: move detail to a docs/*.md manual and leave a summary + pointer.`,
  );
}

const docsDir = join(ROOT, 'docs');
let manuals = [];
try { manuals = readdirSync(docsDir).filter(f => f.endsWith('.md')).sort(); } catch { /* no docs/ yet */ }
for (const f of manuals) {
  const rel = `docs/${f}`;
  const m = measure(rel);
  if (m.lines > MANUAL.maxLines || m.bytes > MANUAL.maxBytes) {
    warnings.push(`${rel} is ${m.lines} lines — split it or move detail into a focused sibling doc.`);
  }
  const head = m.text.split('\n').slice(0, 8).join('\n');
  if (!/^#\s+\S/m.test(head)) warnings.push(`${rel} has no "# Title" in its first lines.`);
  if (!/read this|read before|status:/i.test(head)) warnings.push(`${rel} has no read-first/Status line in its first 8 lines.`);
}

if (fragile.length) {
  warnings.push(
    `fragile locator(s) in ${fragile.join(', ')} — prefer role/getByTestId/data-*; ` +
      `class selectors are the #1 documented drift cause.`,
  );
}

if (warnings.length) {
  console.log('\nWarnings (non-blocking):');
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.log('\nFAIL: test/doc hygiene.\n');
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\nTest hygiene + doc budget OK.');
