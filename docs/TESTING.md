# Testing — Agent Manual

Status: **read this before writing, changing, retiring, or debugging specs or unit tests.**
`playwright.config.ts`, `vitest.config.ts` and `scripts/` are the harness; this file is the policy.

## Mental model

1. **Two layers, cheapest first.** Vitest unit tests (node/jsdom, ms) pin pure logic;
   the Playwright suite proves the app behaves end-to-end in real browsers. If a bug
   can be reproduced without a browser, it belongs in a unit test — then keep ONE e2e
   case proving the surface is wired.
2. **The suite is the regression net.** Keep it fast and trustworthy: fully parallel,
   reduced motion, no sleeping assertions. A slow/red suite stops being run.
3. **A red run is not proof of a regression.** Answer "was it me?" with
   `npm run test:baseline` — never by `git checkout`/`git stash` (destroys work).

## Test sizes & the pyramid

| Size | Here | Use it for | Cost |
|---|---|---|---|
| **Small / unit** | Vitest — `npm run test:unit`, `src/**/*.test.ts`. Node env; DOM modules add `// @vitest-environment jsdom` | Pure logic: parsing, storage formats, computed values, math | ~ms |
| **Large / e2e** | Playwright specs in `e2e/` | Real browser behaviour: interactions, persistence, geometry, cross-surface propagation | ~0.4–2s each |

**Rule of thumb:** push logic down (extract it to an importable module — that
extraction is the real work), keep one e2e case for the wiring, and **never assert
the same behaviour at both layers**. When you move a case down, retire the e2e case.

## When to add a test (rubric)

Add one when it changes a future decision — a reasonable change could break it silently:

1. **New observable behaviour / invariant** — one focused case.
2. **A bug fix** — a regression test that fails before and passes after.
3. **A hard-won edge case** (security boundary, format round-trip, wrap-around,
   reduced-motion skip).

Do **not** add one when:

- **The user can confirm it by looking** (colors, spacing, labels, menu items,
  "the panel opens") — hand them a numbered manual check instead.
- It asserts implementation detail (internal state, CSS class) rather than
  observable behaviour.
- It duplicates an existing case (extend it).
- It can only "pass" by sleeping (`waitForTimeout`) — make it deterministic.

## Manual verification (the user has eyes)

When a change is visually verifiable, end the task with a short numbered check
(exact clicks + expected result). Automate only when a silent break is plausible:
data loss/corruption, a wrong computed value, persistence, cross-surface
propagation, or geometry that only fails at scale.

## What lives where

| Area | Layer | Notes |
|---|---|---|
| `src/core/llm/cost.ts`, `usage.ts` | unit | Peak/off-peak math, cache-hit/miss, token accumulation |
| `src/core/llm/schemas.ts` | unit | Every agent response contract |
| `src/core/agents/validate.ts` (planned) | unit | Fact/lie gates, dedup, normalisation |
| `src/core/sources/book.ts` (planned) | unit | Header stripping, section splitting, quote anchors |
| `src/core/db/*` (planned) | integration | Job claim/complete, resume, WAL behaviour |
| `src/core/pipeline.ts` (planned) | integration | Stage transitions with the mock LLM |
| `src/ui/**` | e2e | One smoke spec; no visual assertions |

**Live API policy:** CI and Playwright always use `DEEPSEEK_MOCK=1` (or injected
fixtures). `npm run smoke` is the only live path and is run manually when changing a
prompt or the LLM client.

## Selector strategy

Prefer, in order: `getByRole`/`getByLabel`/`getByPlaceholder` → `getByTestId`/
data-* → stable documented class contracts → **last resort** structural CSS.
`scripts/check-test-hygiene.mjs` warns on inline-style/utility-class/parent
selectors. If a component has no stable hook, add a `data-testid`/`data-*`
attribute rather than a structural selector. A class used for styling can match
more than you expect — scope the locator.

## Harness facts

- **The test port is TEST-ONLY** (default `4102`); the human dev server keeps its
  own (`:4100` UI, `:4101` API). `PLAYWRIGHT_PORT=n` forces an isolated, owned server
  (no reuse).
- `fullyParallel: true`, **5 workers** (cores/2); raise deliberately with
  `PLAYWRIGHT_WORKERS=8`. The duration reporter prints `[timing] …` on the last line.
- `retries: 1` locally (2 on CI) + `trace: 'on-first-retry'` + screenshot on failure.
  The retry absorbs transient flake; chronic flake gets `@quarantine` (excluded).
- **`reducedMotion: 'reduce'` globally** — tests aren't about animation, and motion
  off removes the biggest flake class. Specs ABOUT motion opt back in per file:
  `test.use({ contextOptions: { reducedMotion: 'no-preference' } })`.
- Unit tests: `src/**/*.test.ts`, node env by default.

## Rules (MUST NOT)

1. **Web-first assertions.** `expect`/`expect.poll`/`waitForFunction` — only true
   animation/interaction pacing may `waitForTimeout`, with a comment. The ratchet in
   `scripts/check-test-hygiene.mjs` enforces the count (baseline `0`).
2. **Specs must be reachable from `scripts/smart-test.mjs` RULES** — an unmapped spec
   is an orphan and `npm run lint` fails.
3. **Never `git checkout`/`git stash` to test a baseline** — use `npm run test:baseline`
   (throwaway HEAD worktree, isolated port).
4. **Retire dead specs.** A spec for removed behaviour is deleted (git preserves it).
5. **Quarantine, don't tolerate, chronic flake** (tag `@quarantine` + registry below).
6. **Never grow the suite past its caps** without a conscious decision recorded in
   `scripts/check-test-hygiene.mjs`.

## Flake policy

- **Transient** (passes on retry): leave it — the retry + trace handle it.
- **Chronic** (fails repeated runs, unrelated to your diff):
  1. tag the test(s) `@quarantine` (excluded from the default suite immediately);
  2. record it below (spec · test · why · date · owner);
  3. file/fix or delete it.

### Quarantine registry

| Spec · test | Why | Since |
|---|---|---|
| _(none)_ | | |

## "Was it me?" workflow (red run)

1. **Did smart-test select it?** `npm run test:smart -- --list` — if not, your change
   can't reach it (pre-existing/flaky).
2. Re-run just that spec (`npx playwright test e2e/<spec>.spec.ts`). The retry
   often clears it.
3. Baseline without touching your tree: `npm run test:baseline -- e2e/<spec>.spec.ts`.
4. Read the trace from the first retry (`test-results/**/trace.zip`).
5. Only if it's genuinely yours: fix it; if flaky, quarantine it in the same change.

## Commands

- `npm run test:unit` — Vitest (watch: `test:unit:watch`).
- `npm run test:e2e` — full Playwright suite.
- `npm run test:smart` — only specs your diff can touch + canaries + last failures
  (`--list` to preview, `--full` to force everything).
- `npm run test:baseline -- <spec>` — clean HEAD worktree, isolated port.
- `npm run lint` — typecheck + `scripts/check-test-hygiene.mjs` (ratchets, orphan
  specs, caps, doc budget).
