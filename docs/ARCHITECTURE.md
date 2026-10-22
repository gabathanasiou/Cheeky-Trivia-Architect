# Architecture

Status: reference — local batch tool + monitor UI. The pipeline is described in
[PIPELINE.md](PIPELINE.md); the handoff is [EXPORT.md](EXPORT.md).

## Shape

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ CLI (headless)               │        │ Browser monitor / review     │
│ src/cli/                     │        │ src/ui/  (Vite + React)      │
│  jobs, p-limit, resume       │        │  job list, SSE, review cards │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │ writes/reads                         │ HTTP + SSE
               ▼                                      ▼
        ┌────────────────────────────────────────────────────┐
        │ SQLite (data/architect.db, WAL)                    │
        │ jobs · items · runs · logs                         │
        └──────────────────────┬─────────────────────────────┘
                               │
                               ▼
        ┌────────────────────────────────────────────────────┐
        │ src/core/  — the only code that talks to DeepSeek  │
        │ agents · prompts · Zod schemas · gates · cost      │
        └──────────────────────┬─────────────────────────────┘
                               │ HTTPS (key held server-side)
                               ▼
                         DeepSeek Flash
```

The CLI owns batch execution. The browser UI never runs a bulk job in memory; it
reads the same SQLite store and can pause/stop a job or approve/review an item. A
small local Express server (`src/server/`) holds the API key, exposes `/api/agent`
for the interactive UI, and serves the built UI.

## Components

| Path | Responsibility |
|---|---|
| `src/core/llm/deepseek.ts` | OpenAI-compatible fetch, JSON mode, retry/backoff, timeout |
| `src/core/llm/schemas.ts` | Zod contracts for every agent response |
| `src/core/llm/cost.ts` | Peak/off-peak pricing, cache hit/miss, USD estimate |
| `src/core/llm/usage.ts` | Usage normalisation + accumulation |
| `src/core/llm/mock.ts` | Deterministic fixtures (`DEEPSEEK_MOCK=1`) |
| `src/core/agents/prompts.ts` | One prompt per stage |
| `src/core/agents/index.ts` | Typed agent functions (synthesis, triage, architect, critic, generator, editor, localiser, linguist, fixer) |
| `src/core/agents/validate.ts` | Deterministic fact/lie gates, dedup (planned) |
| `src/core/sources/book.ts` | Gutenberg fetch/cache/parse/extract (planned) |
| `src/core/db/` | SQLite job store (planned) |
| `src/cli/` | Commands: `book`, `resume`, `export`, `status` |
| `src/server/` | `/api/health`, `/api/agent`, `/api/jobs`, SSE |
| `src/ui/` | Monitor + review console |

## Server endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | `{ ok, model, mock, hasKey }` — never the key itself |
| `POST` | `/api/agent` | `{ name, args }` → agent result + usage (interactive UI) |
| `GET` | `/api/jobs` | Job summaries |
| `GET` | `/api/jobs/:id` | Job + items + runs + logs |
| `GET` | `/api/jobs/:id/events` | SSE progress stream |
| `POST` | `/api/jobs/:id/pause` | Set the pause flag |
| `POST` | `/api/jobs/:id/stop` | Set the stop flag |

## SQLite job store (implemented)

```sql
jobs(id, source, status, stage, total, done, failed, cost_usd,
     effort, created_at, updated_at, cancel_requested, pause_requested)
items(id, job_id, source_id, content_hash, stage, status, payload_json,
      scores_json, error, updated_at,
      UNIQUE(job_id, content_hash))
runs(id, job_id, stage, model, effort, prompt_tokens, completion_tokens,
     cache_hit_tokens, cache_miss_tokens, cost_usd, created_at)
logs(id, job_id, item_id, level, message, created_at)
```

WAL mode, one writer per transaction, `UPDATE … WHERE status='pending'` claim so a
crashed worker's item is re-claimable after a timeout. Content hashes make every
stage idempotent. The store lives in `src/core/db/index.ts`; the CLI and the local
server share it.

## Security boundary

- `DEEPSEEK_API_KEY` lives in `.env.local` (gitignored), read by the server/CLI only.
- The UI calls `/api/agent`; it never imports `src/core/llm/deepseek.ts` and never
  receives a key.
- `hasKey` is a boolean in `/api/health`; the key is never echoed or logged.
- The local server binds to `127.0.0.1` by default.

## Failure model

- Network/429/5xx → retry with exponential backoff, then mark the item failed.
- Schema violation → retry once; then fail the item with the raw response in `logs`.
- Process crash → items stay `processing`; `resume` reclaims stale claims.
- Budget cap → stop claiming new items, finish in-flight ones, mark the job `paused`.
