# cheeky-trivia-architect — Roadmap Archive (Completed Index)

Status: **index only** — the live backlog is `docs/ROADMAP.md`; consult this file
during triage (grep it before asking for or implementing anything). Full narrative
lives in git history (the commit that retired the item); canonical knowledge lives
in `AGENTS.md` / `docs/*.md` and the pointers below.

How to use: grep for a feature term before asking for or implementing anything. If it
hits, the work is done — read the pointers, don't re-implement. **Ids are stable:
never renumber or reuse.**

| # | Item | Knowledge / code pointers |
|---|---|---|
| 1 | Repo baseline — roadmap, docs, tests, CI | AGENTS.md; docs/TESTING.md; scripts/; .github/workflows/ci.yml |
| 2 | DeepSeek Flash provider — server-side key, effort levels, JSON/Zod, cost | src/core/llm/; src/core/agents/; src/server/; docs/COST.md; scripts/smoke.ts |
| 6 | Browser monitor — job dashboard, SSE, pause/stop | src/ui/JobsView.tsx; src/ui/App.tsx; src/server/index.ts; e2e/smoke.spec.ts; docs/ARCHITECTURE.md |
| 3 | Fact model + fact gate — synthesis contract, validation, dedup | src/core/agents/validate.ts; src/core/agents/validate.test.ts; src/cli/processFact.ts; docs/PIPELINE.md |
| 5 | Batch CLI — SQLite job store, resume, concurrency, budget | src/core/db/; src/cli/; src/core/db/index.test.ts; docs/ARCHITECTURE.md |
