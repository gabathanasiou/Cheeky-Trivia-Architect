#!/usr/bin/env node
/**
 * Portable roadmap CLI — zero dependencies.
 *
 * Copy this file into any repo that has docs/ROADMAP.md + docs/ROADMAP-ARCHIVE.md.
 * Override the paths with ROADMAP_FILE / ARCHIVE_FILE when they live elsewhere.
 *
 *   node scripts/roadmap.mjs check
 *   node scripts/roadmap.mjs list
 *   node scripts/roadmap.mjs add "My item"
 *   node scripts/roadmap.mjs close 12 --title "Short title" --points "docs/X.md; src/y.ts"
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROADMAP = process.env.ROADMAP_FILE || 'docs/ROADMAP.md';
const ARCHIVE = process.env.ARCHIVE_FILE || 'docs/ROADMAP-ARCHIVE.md';

const fail = (msg) => { console.error(`roadmap: ${msg}`); process.exit(1); };
const read = (p) => { if (!existsSync(p)) fail(`missing ${p}`); return readFileSync(p, 'utf8'); };
const write = (p, s) => writeFileSync(p, s);

function parseItems(text) {
  const heads = [...text.matchAll(/^##\s+(\d+)\.\s+(.+)$/gm)];
  return heads.map((m, i) => {
    const start = m.index;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    return {
      id: Number(m[1]),
      heading: m[0].trim(),
      title: m[2].replace(/\s*\([^)]*\)\s*$/, '').trim(),
      body: text.slice(start, end),
      start,
      end,
    };
  });
}

function archiveRows(text) {
  return [...text.matchAll(/^\|\s*(\d+)\s*\|(.*)\|\s*$/gm)].map((m) => ({
    id: Number(m[1]),
    line: m[0],
    cells: m[0].split('|').slice(1, -1).map((c) => c.trim()),
  }));
}

function nextId(live, arch) {
  const ids = [...live.map((i) => i.id), ...arch.map((r) => r.id)];
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function check() {
  const live = parseItems(read(ROADMAP));
  const arch = archiveRows(read(ARCHIVE));
  const errors = [];
  const warnings = [];

  const done = live.filter((i) => i.heading.includes('[x]'));
  if (done.length) errors.push(`${ROADMAP}: completed item(s) left live: ${done.map((i) => i.id).join(', ')}`);

  const noStatus = live.filter((i) => !/\[[ x~]\]/.test(i.heading));
  if (noStatus.length) warnings.push(`${ROADMAP}: heading(s) without [ ]/[~]: ${noStatus.map((i) => i.id).join(', ')}`);

  const dup = (nums) => [...new Set(nums.filter((n, i, a) => a.indexOf(n) !== i))];
  const liveDup = dup(live.map((i) => i.id));
  const archDup = dup(arch.map((r) => r.id));
  if (liveDup.length) errors.push(`${ROADMAP}: duplicate id(s): ${liveDup.join(', ')}`);
  if (archDup.length) errors.push(`${ARCHIVE}: duplicate id(s): ${archDup.join(', ')}`);

  const overlap = live.filter((i) => arch.some((r) => r.id === i.id)).map((i) => i.id);
  if (overlap.length) errors.push(`id(s) in both files: ${overlap.join(', ')}`);

  for (const r of arch) {
    if (r.cells.length !== 3) errors.push(`${ARCHIVE}: row ${r.id} must have 3 columns (| id | title | pointers |)`);
    if (!r.cells[1]) errors.push(`${ARCHIVE}: row ${r.id} has no title`);
  }
  for (const i of live) {
    if (/#\d+/.test(i.body) && !/\*\*Relations\*\*:/.test(i.body)) {
      warnings.push(`${ROADMAP}: item ${i.id} references another id but has no **Relations**: line`);
    }
  }

  console.log(`roadmap: ${live.length} open item(s), ${arch.length} archived row(s).`);
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length) process.exit(1);
}

function list() {
  const live = parseItems(read(ROADMAP));
  for (const i of live) console.log(`${String(i.id).padStart(3)}  ${i.heading.replace(/^##\s+\d+\.\s*/, '')}`);
  if (!live.length) console.log('(no open items)');
}

function add(title) {
  if (!title) fail('add needs a title: npm run roadmap -- add "My item"');
  const liveText = read(ROADMAP);
  const id = nextId(parseItems(liveText), archiveRows(read(ARCHIVE)));
  const section =
    `\n## ${id}. ${title} (\`[ ]\`)\n\n` +
    `- **Request:** ${title}\n` +
    `- **Approach:** TBD\n` +
    `- **Verify:** TBD\n\n` +
    `**Relations:** none\n`;
  write(ROADMAP, liveText.replace(/\s*$/, '\n') + section);
  console.log(`added roadmap ${id}: ${title}`);
}

function close(idArg, opts) {
  const id = Number(idArg);
  if (!Number.isInteger(id)) fail('close needs a numeric id');
  const liveText = read(ROADMAP);
  const item = parseItems(liveText).find((i) => i.id === id);
  if (!item) fail(`item ${id} not found in ${ROADMAP}`);

  const archText = read(ARCHIVE);
  if (archiveRows(archText).some((r) => r.id === id)) fail(`item ${id} already archived`);

  const title = opts.title || item.title;
  const points = opts.points || 'TBD — fill in doc/code pointers';

  const before = liveText.slice(0, item.start).replace(/\s*$/, '\n\n');
  const after = liveText.slice(item.end).replace(/^\s*/, '');
  write(ROADMAP, before + after);

  const lines = archText.replace(/\s*$/, '').split('\n');
  const last = lines.map((l, i) => ({ l, i })).filter((x) => /^\|\s*\d+\s*\|/.test(x.l)).pop();
  const row = `| ${id} | ${title} | ${points} |`;
  if (last) lines.splice(last.i + 1, 0, row);
  else lines.push('', '| # | Item | Knowledge / code pointers |', '|---|---|---|', row);
  write(ARCHIVE, lines.join('\n') + '\n');

  console.log(`closed roadmap ${id}: ${title}`);
}

function help() {
  console.log(`Usage: npm run roadmap -- <command>

Commands:
  list                     list open items
  add "Title"              append the next-id item template
  close <id> [--title T] [--points P]  retire one item to the archive
  check                    validate the contract (exit 1 on errors)

Files: ${ROADMAP} + ${ARCHIVE}
Override with ROADMAP_FILE / ARCHIVE_FILE. Rules live in the roadmap header.`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') help();
else if (cmd === 'check') check();
else if (cmd === 'list') list();
else if (cmd === 'add') add(rest.join(' ').trim());
else if (cmd === 'close') {
  const opts = {};
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '--title') opts.title = rest[++i];
    else if (rest[i] === '--points') opts.points = rest[++i];
  }
  close(rest[0], opts);
} else fail(`unknown command "${cmd}" — try: npm run roadmap -- help`);
