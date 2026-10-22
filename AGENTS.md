# cheeky-trivia-architect — Agent Guide

## Commands

- `npm run dev` — API server (`:4101`) + Vite UI (`:4100`)
- `npm run start` — serve the built UI and API on `:4100`
- `npm run build` — typecheck + production build (run before every commit)
- `npm run smoke` — one live DeepSeek end-to-end item
- `npm run cli -- <command>` — headless batch runner (`book`, `optimize`, `run`, `status`, `items`, `logs`, `resume`)
- `npm run test:unit` / `test:e2e` / `test:smart` / `test:baseline`
- `npm run roadmap -- list|add|close|check`
- `npm run lint` — roadmap + docs + test hygiene + typecheck

## Roadmap — the required workflow

- `docs/ROADMAP.md` holds **open items only** (`[ ]` / `[~]`).
- Completed work moves to `docs/ROADMAP-ARCHIVE.md` as **one line** (id, title,
  doc/code pointers). Git history keeps the narrative.
- Ids are **stable and unique forever**. The CLI assigns the next free id.
- Every new ask goes through triage first: headings here → archive → `docs/*.md` →
  `git log --oneline --grep=<term>` → source. Open item → do it; in-progress → don't
  parallel it; done → use the pointer; overlaps → merge into one item.
- Close in one commit: `npm run roadmap -- close <id> --points "docs/...; path/..."`,
  then `npm run roadmap:check`.

## Architecture facts

- `src/core/` is the only place that talks to DeepSeek. The browser never imports it.
- `src/core/llm/deepseek.ts` — OpenAI-compatible fetch, JSON mode, retry, usage/cost.
- `src/core/agents/` — prompts + typed agent functions, one per stage.
- `src/core/llm/schemas.ts` — Zod is the contract; every model response is parsed.
- `src/server/` — local key holder and `/api/agent` proxy; serves the built UI.
- `src/cli/` — batch execution and SQLite job state (`src/core/db/`).
- `src/server/` exposes `/api/jobs`, pause/stop and an SSE progress stream for the UI.
- `src/ui/` — Optimizer + jobs console; creates jobs via `/api/jobs`, polls the same DB, no in-browser executor, no secrets.
- **Model policy:** `deepseek-flash` only. Effort (`low|high|max`) and thinking on/off
  carry quality; there is no Pro tier in this project.
- **Data policy:** sources, SQLite files and exports live under `data/` and are
  gitignored; only reviewed exports are committed to Bamboozle.

## Hard rules

- **Never** expose `DEEPSEEK_API_KEY` to the browser or commit `.env*` / `data/`.
- All LLM traffic goes through `src/core/llm/deepseek.ts` (no ad-hoc `fetch`).
- Every structured response goes through its Zod schema; no `any` passthrough.
- Every pipeline stage must be resumable and idempotent (content-hash keyed).
- Every source row carries a licence/source field; an unknown licence blocks import.
- Tests use `DEEPSEEK_MOCK=1` or injected fixtures — never a live API call in CI.
- Small, revertible commits; imperative messages.

## Testing

- Read `docs/TESTING.md` first: Vitest logic → integration → Playwright smoke.
- Automate only silent-break risk; visual changes get a numbered manual check.
- Register new spec base names in `scripts/smart-test.mjs`; an orphan fails `lint`.
- Triage a red run with `test:smart -- --list` + `test:baseline`, never `git checkout`.

## Docs

`README.md`, `docs/ARCHITECTURE.md`, `docs/PIPELINE.md`, `docs/COMEDY.md`,
`docs/SOURCES.md`, `docs/COST.md`, `docs/EXPORT.md`. Keep this file ≤200 lines; detail goes in `docs/`.
