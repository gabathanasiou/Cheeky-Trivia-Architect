#!/usr/bin/env node
// Deterministic guard against agent-doc bloat + roadmap drift.
//
// AGENTS.md loads into every session → hard budget. docs/*.md manuals are read on
// demand → looser budget. The live roadmap holds OPEN items only; the archive has
// unique stable ids. Test-specific hygiene lives in the `test-harness` skill.
//
// Wired into `npm run lint` (and `npm run lint:docs`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BYTES_PER_TOKEN = 4;
const HUB = { file: 'AGENTS.md', maxLines: 200, maxBytes: 36000 };
const MANUAL = { maxLines: 400, maxBytes: 50000 };
const EXEMPT = new Set(['ROADMAP.md', 'ROADMAP-ARCHIVE.md', 'ROADMAP-KIT.md']);

const errors = [];
const warnings = [];
const read = (rel) => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
};
const measure = (text) => {
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const bytes = Buffer.byteLength(text, 'utf8');
  return { lines, bytes, tokens: Math.round(bytes / BYTES_PER_TOKEN) };
};
const fmt = (n) => n.toLocaleString('en-US');
const row = (rel, m, cap) => {
  const pct = cap ? Math.round((m.lines / cap.maxLines) * 100) : null;
  const over = cap && (m.lines > cap.maxLines || m.bytes > cap.maxBytes);
  return `  ${rel.padEnd(42)} ${String(m.lines).padStart(5)} lines  ${fmt(m.bytes).padStart(8)} B  ~${fmt(m.tokens).padStart(6)} tok  ${cap ? (over ? 'OVER' : `${pct}%`) : 'exempt'}`;
};

// --- hub + manuals -----------------------------------------------------------
const hubText = read(HUB.file);
if (!hubText) {
  warnings.push(`no ${HUB.file} — add the Roadmap + Testing pointer sections.`);
} else {
  const hub = measure(hubText);
  console.log(`Agent-doc budget (hub cap: ${HUB.maxLines} lines / ${fmt(HUB.maxBytes)} B)\n`);
  console.log(row(HUB.file, hub, HUB));
  if (hub.lines > HUB.maxLines || hub.bytes > HUB.maxBytes) {
    errors.push(`${HUB.file} is over budget (${hub.lines}/${HUB.maxLines} lines, ${fmt(hub.bytes)}/${fmt(HUB.maxBytes)} B). Move detail to a docs manual and leave a summary + pointers.`);
  }
}

const docsDir = join(ROOT, 'docs');
if (existsSync(docsDir)) {
  console.log('\nOn-demand manuals (cap: ~%d lines / %s B):', MANUAL.maxLines, fmt(MANUAL.maxBytes));
  for (const f of readdirSync(docsDir).filter((x) => x.endsWith('.md')).sort()) {
    const rel = `docs/${f}`;
    const text = read(rel);
    if (text === null) continue;
    const m = measure(text);
    if (EXEMPT.has(f)) { console.log(row(rel, m, null)); continue; }
    console.log(row(rel, m, MANUAL));
    if (m.lines > MANUAL.maxLines || m.bytes > MANUAL.maxBytes) {
      warnings.push(`${rel} is over its manual cap (${m.lines}/${MANUAL.maxLines} lines, ${fmt(m.bytes)}/${fmt(MANUAL.maxBytes)} B) — split it or move detail into a focused sibling doc.`);
    }
    const head = text.split('\n').slice(0, 8).join('\n');
    if (!/^#\s+\S/m.test(head)) warnings.push(`${rel} has no "# Title" in its first lines.`);
    if (!/read this|read before|status:/i.test(head)) warnings.push(`${rel} has no read-first/Status line in its first 8 lines.`);
  }
} else {
  warnings.push('no docs/ directory — run the scaffold with --roadmap --docs.');
}

// --- roadmap -----------------------------------------------------------------
const roadmapText = read('docs/ROADMAP.md');
const archiveText = read('docs/ROADMAP-ARCHIVE.md');
if (!roadmapText || !archiveText) {
  warnings.push('no docs/ROADMAP.md or docs/ROADMAP-ARCHIVE.md — run the scaffold with --roadmap.');
} else {
  const doneInLive = [...roadmapText.matchAll(/^##\s+\d+\..*\[x\]/gm)].map((m) => m[0].trim());
  const openCount = [...roadmapText.matchAll(/^##\s+\d+\..*/gm)].length;
  const ids = [...archiveText.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  const dupIds = [...new Set(ids.filter((n, i) => ids.indexOf(n) !== i))];
  console.log('\nRoadmap hygiene: %d open item(s); %d archived index row(s).', openCount, ids.length);
  if (doneInLive.length) {
    errors.push(`docs/ROADMAP.md contains ${doneInLive.length} completed ([x]) item(s) — the live roadmap must hold OPEN items only. Move each to a one-line archive row and delete the section. Found: ${doneInLive.slice(0, 5).join(' | ')}`);
  }
  if (dupIds.length) errors.push(`docs/ROADMAP-ARCHIVE.md has duplicate item id(s): ${dupIds.join(', ')} — ids are stable and unique.`);
}

if (warnings.length) {
  console.log('\nWarnings (non-blocking):');
  for (const w of warnings) console.log(`  - ${w}`);
}
if (errors.length) {
  console.log('\nFAIL: doc/roadmap hygiene.\n');
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log('\nDoc budget + roadmap hygiene OK.');
