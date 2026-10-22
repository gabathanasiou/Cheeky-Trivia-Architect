# Cost

Status: reference — DeepSeek Flash only, peak/off-peak aware. The live smoke is the
calibration check when prompts change.

## Price card (USD per 1M tokens)

| | Off-peak | Peak |
|---|---|---|
| Input (cache miss) | $0.15 | $0.30 |
| Output | $0.60 | $1.20 |
| Input (cache hit) | $0.003 | $0.006 |

- **Model:** `deepseek-flash` (V4.1 Flash). No Pro tier.
- **Peak:** 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday. Everything else,
  including weekends, is off-peak.
- **Concurrency:** 2,500 per account; use 30–50 locally.
- Prices live in `src/core/llm/cost.ts`; update there and here together.

## Measured

`npm run smoke` (synthesis → architect → critic → generator → editor):

| Agent | Prompt | Completion | Cost |
|---|---|---|---|
| Synthesize | 329 | 67 | $0.00008955 |
| Architect | 291 | 238 | $0.00018645 |
| Critic | 236 | 270 | $0.00019740 |
| Generator | 286 | 911 | $0.00058950 |
| Editor | 207 | 24 | $0.00004545 |
| **Total** | **1,349** | **1,510** | **~$0.0011** |

Full book pass (161 sections, extract + fun-score, facts only):
**225 candidates, 30 sections skipped, $0.187** at off-peak rates.

Thinking mode is the output-token driver. The generator's 911 completion tokens
include reasoning; the editor (non-thinking) produced 24.

## Estimates

| Run | Items | Est. cost (off-peak) |
|---|---|---|
| Book phase 1 | ~170 sections → ~300 facts | < $1 |
| OpenTriviaQA pilot | 500 rows | $0.50–1.50 |
| OpenTriviaQA funnel | 25k candidates → 2–3k approved | $15–30 |
| Greek localisation | 2–3k approved | $3–8 |

At 30–50 concurrency and batched synthesis/scoring, the 25k funnel is a few hours of
wall-clock time. Schedule it off-peak.

## Controls

- `--max-cost <usd>` stops claiming new items and finishes in-flight work.
- The UI shows cost per job, per stage and total, read from `runs`.
- `DEEPSEEK_MOCK=1` is free; use it for every test and UI iteration.
- Prompt caching: keep the system prompt stable and put variable data in the user
  message. Never interpolate timestamps or random IDs into the system prompt.
- Do not localise candidates; localise approved items only.
