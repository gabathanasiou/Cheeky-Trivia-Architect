# Cheeky Trivia Architect

Batch fact pipeline and review console for [Bamboozle](https://github.com/gabathanasiou/bamboozle).
It takes a source (a public-domain book, and optionally a multiple-choice dataset),
synthesises one clean fact per row, places the `<BLANK>`, generates a pool of lies,
scores everything, and exports a validated question bank.

The pipeline is a **local CLI**; the browser UI is a **live monitor and review
console** over the same SQLite database. DeepSeek Flash does the language work, and
the API key never reaches the browser.

## Quick start

```bash
npm install
cp .env.example .env.local      # add DEEPSEEK_API_KEY
npm run smoke                   # one live end-to-end item
npm run dev                     # API :4101 + UI :4100
```

Open <http://127.0.0.1:4100>. Set `DEEPSEEK_MOCK=1` to run the UI with deterministic
fixtures and no API calls.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API server + Vite UI (dev) |
| `npm run start` | Build is served by the API on `:4100` |
| `npm run smoke` | Live DeepSeek smoke: synthesis → blank → critic → lies |
| `npm run cli -- book --limit 20` | Create a SQLite job and extract book facts |
| `npm run cli -- status` | List jobs and their progress/cost |
| `npm run cli -- items <id>` | Inspect a job's items |
| `npm run cli -- resume <id>` | Reclaim stale items and continue |
| `npm run test:unit` | Vitest logic tests |
| `npm run test:e2e` | Playwright UI smoke |
| `npm run test:smart` | Diff-based Playwright selection |
| `npm run lint` | Roadmap + docs + test hygiene + typecheck |
| `npm run roadmap -- list` | Open roadmap items |

## Architecture

```
src/core/     agents, prompts, DeepSeek client, Zod schemas, cost, gates
src/cli/      headless batch runner (SQLite job store)
src/server/   local API + static UI + SSE; injects the API key
src/ui/       React monitor/review console
data/         cached sources, architect.db, exports (gitignored)
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/PIPELINE.md](docs/PIPELINE.md) before changing the agents.

## Sources

- **Phase 1:** *Invention and Discovery: Curious Facts and Characteristic Sketches*
  (Project Gutenberg eBook 46644) — public domain.
- **Optional:** OpenTriviaQA — upstream is **CC-BY-SA-4.0**; using its text imposes a
  ShareAlike obligation on the derived bank. The roadmap keeps this behind a licence
  decision. See [docs/SOURCES.md](docs/SOURCES.md).

## Security

`.env.local` is gitignored and read only by the local server/CLI. The UI calls
`/api/agent`; it never receives `DEEPSEEK_API_KEY`. Never add the key to
`vite.config.ts` or any `VITE_*` variable.

## Docs

- [Roadmap](docs/ROADMAP.md): open work only; completed items live in the archive.
- [Pipeline](docs/PIPELINE.md): agents, effort levels, gates, batch sizes.
- [Sources](docs/SOURCES.md): licences, fetching, attribution.
- [Cost](docs/COST.md): pricing, estimates, budget controls.
- [Testing](docs/TESTING.md): unit → integration → e2e, mocks, flake policy.
- [Export](docs/EXPORT.md): the Bamboozle question-bank contract.
