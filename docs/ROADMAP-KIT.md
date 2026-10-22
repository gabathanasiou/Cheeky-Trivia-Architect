# Portable Roadmap Kit

Status: **reference** — copy this workflow into another repo.

The roadmap workflow is **self-contained** — no custom skill, no per-repo instructions
beyond a short AGENTS.md pointer. Copy it into any project:

## Install in another repo (3 files + 3 scripts)

1. Copy:
   - `docs/ROADMAP.md` (keep the header — it is the contract; replace the items)
   - `docs/ROADMAP-ARCHIVE.md` (keep the header + table)
   - `scripts/roadmap.mjs` (zero dependencies, Node 18+)
2. Add to `package.json`:
   ```json
   "scripts": {
     "roadmap": "node scripts/roadmap.mjs",
     "roadmap:check": "node scripts/roadmap.mjs check",
     "lint": "npm run roadmap:check"
   }
   ```
   (Merge `lint` with the repo's existing lint command instead of replacing it.)
3. Add this to `AGENTS.md` / `CLAUDE.md` / the repo's agent file:
   ```md
   ## Roadmap
   - `docs/ROADMAP.md` is open-only; completed items go to `docs/ROADMAP-ARCHIVE.md`
     as one line. Ids are stable and unique forever.
   - Use `npm run roadmap -- list|add|close|check`; the rules are in the roadmap header.
   ```

That's it. The roadmap header is the documentation; an agent reading the repo finds
the contract without loading a skill.

## Commands

```bash
npm run roadmap -- list                 # open items
npm run roadmap -- add "My item"        # next free id + template
npm run roadmap -- close 12 --title "Short title" --points "docs/X.md; src/y.ts"
npm run roadmap -- check                # exit 1 on contract violations
npm run roadmap:check                   # same, for lint/CI
```

`ROADMAP_FILE` / `ARCHIVE_FILE` override the default paths.

## What `check` enforces

- No `[x]` items left in the live roadmap.
- No duplicate ids in either file.
- No id present in both files.
- Archive rows have exactly 3 columns: `| id | title | pointers |`.
- Warnings: headings without `[ ]`/`[~]`; an item that references `#id` but has no
  `**Relations**:` line.

## Invariants (the whole method)

1. Live roadmap = open/in-progress only.
2. One id = one item, forever. Never renumber or reuse.
3. On close: one archive row, delete the live section, git keeps the narrative.
4. Triage every new ask through the dedupe ladder before adding an item.
5. Put canonical knowledge in `docs/*.md` / code, not in the roadmap narrative.

Works for any stack; the CLI only reads Markdown.
