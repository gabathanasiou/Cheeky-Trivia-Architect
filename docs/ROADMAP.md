# cheeky-trivia-architect — Roadmap (Open Work Only)

Status: **live backlog** — open items only; completed work is archived.

This is the **live backlog**: `[ ]` not started, `[~]` in progress. Completed work is
retired to `docs/ROADMAP-ARCHIVE.md` as **one line**; git history keeps the narrative.

**How this file works — the whole workflow lives here, so no custom skill is required:**

- **Query, don't read it all:** `grep '^## ' docs/ROADMAP.md` lists every item with its
  flags. Read only the matched line range.
- **Every new ask goes through triage first.** Dedupe in this order: headings here →
  `docs/ROADMAP-ARCHIVE.md` → `AGENTS.md` + `docs/*.md` → `git log --oneline --grep=<term>`
  → source. Open item → do it; in-progress → never parallel; done → use the pointer;
  overlaps several → merge into ONE item; nothing → add one.
- **Ids are stable and unique forever.** Never renumber or reuse. Next id =
  `max(live ∪ archive) + 1`. The CLI does this.
- **Shape:** request → approach/files → verify → `Relations:` (depends on / merges /
  supersedes / blocked by).
- **Close in one commit:** flip `[x]`, add ONE archive row
  (`| id | title | doc + code + test pointers |`), delete the live section, then
  `npm run roadmap:check`.
- **CLI:** `npm run roadmap -- list | add "title" | close <id> --points "..." | check`.
- **Portable kit for other repos:** `docs/ROADMAP-KIT.md`.

---

## 4. Book phase 1 — Gutenberg 46644 extraction (`[~]`)

- **Request:** Use *Invention and Discovery: Curious Facts and Characteristic Sketches*
  (Project Gutenberg eBook 46644, public domain) as the first real source; target 200–300
  approved questions.
- **Approach:** fetch and cache the text with a SHA-256; strip the PG header/footer;
  split into ~170 sections; extract 0–3 atomic facts per section with an exact quote;
  gate, score, review, export.
- **Verify:** every extracted quote is an exact substring; review yield ≥ 150 approved;
  `data/exports/book-en.jsonl` is valid.
- **Relations:** depends on 3; no licence gate (public domain).

## 7. Review UI — approve/reject/edit, score filters (`[~]`)

- **Request:** Make human review fast enough for thousands of candidates.
- **Approach:** item table with filters (source, category, score, status), keyboard
  shortcuts, edit fact/answer/lies, regenerate lies, approve/reject, write back to
  SQLite; auto-approve high-confidence/high-score items.
- **Verify:** e2e approve flow; refresh keeps state; no bulk state in localStorage.
- **Relations:** depends on 5, 6.

## 8. Lie pool — 12–15 diverse lies (`[ ]`)

- **Request:** Bots should not repeat the same five lies every game.
- **Approach:** generator asks for 15 lies across distinct angles (plausible, absurd,
  pun, technical, pop-culture); editor keeps 12 distinct; deterministic checks for
  uniqueness/length/no answer leak; Bamboozle samples without replacement.
- **Verify:** unit tests for pool rules; a bot-round simulation showing varied lies.
- **Relations:** depends on 3; Bamboozle has the matching runtime item.

## 9. Export contract — Bamboozle JSONL + JSON chunks (`[ ]`)

- **Request:** A stable, validated handoff from the Architect to the game.
- **Approach:** approved JSONL (`id`, `fact`, `answer`, `category`, `lies`, `funScore`,
  `blankScore`, `source`, `license`) plus per-language/per-category JSON chunks and a
  manifest; stable IDs.
- **Verify:** contract test in this repo; Bamboozle's validator accepts the export.
- **Relations:** depends on 3, 7; cross-repo with Bamboozle.

## 10. Optional — OpenTriviaQA import (licence gate) (`[ ]`)

- **Request:** Use the 49.6k-row dataset only if the ShareAlike obligation is
  acceptable.
- **Approach:** upstream is CC-BY-SA-4.0 (the HF mirror's CC-BY-4.0 card is not the
  source of truth); record the decision in `docs/SOURCES.md`; if approved, add a
  parquet adapter, prefilter (drop 2-choice/True-False/numbers/`None of these`/mojibake/
  duplicates), then reuse the synthesis pipeline.
- **Verify:** written licence decision; 500-row pilot with recorded yield and cost.
- **Relations:** blocked by the licence decision; depends on 3.

## 11. Optional — Wikidata / OpenTDB sources (`[ ]`)

- **Request:** Cleaner volume alternatives if OpenTriviaQA is rejected.
- **Approach:** CC0 Wikidata queries / CC-BY-SA OpenTDB adapter; reuse the `Fact`
  contract and gates.
- **Verify:** source licence recorded; 100-row pilot.
- **Relations:** depends on 3.

## 12. Optional — Greek localization (`[ ]`)

- **Request:** Localize approved EN questions without re-running the creative pipeline.
- **Approach:** existing Cultural Bridge → Linguist → Fixer agents; translation cache
  keyed by fact hash; only approved items.
- **Verify:** native-speaker sample review; no blank/grammar regressions.
- **Relations:** depends on 7, 9.
