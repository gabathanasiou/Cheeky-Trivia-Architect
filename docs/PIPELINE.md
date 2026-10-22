# Pipeline

Status: reference — agent stages, contracts, gates and cost controls. Architecture is
in [ARCHITECTURE.md](ARCHITECTURE.md); the handoff is [EXPORT.md](EXPORT.md).

## Stages

```
source row / book section
  → 1. Synthesize      one standalone declarative fact + answer
  → 2. Fact gate       deterministic: answer present, no question mark, length, dedup
  → 3. Fun score       funScore, difficulty, timeless, tone (batch)
  → 4. Architect       place <BLANK>, extract the new answer
  → 5. Critic          score blank placement; retry only on failure
  → 6. Generator       12–15 diverse lies
  → 7. Editor          keep 12 distinct; trim length; no answer leak
  → 8. Validate        deterministic lie/fact gates
  → 9. Review          human approve/reject (auto-approve high scores)
  → 10. Export         JSONL + per-category chunks
```

Stages 1–3 are safe to batch (10–50 rows per call). Stages 4–6 are creative and
should stay at 1–5 items per call to avoid cross-contamination.

## Agents and effort

`deepseek-flash` (V4.1 Flash) only. Thinking is opt-in; `reasoning_effort` is
`low | high | max`.

| Agent | Thinking | Effort | Batch | Output |
|---|---|---|---|---|
| Synthesizer | on | high | 10–20 | `{status, statement, answer, category, confidence}` |
| Triage | off | — | 1 | `{action}` |
| Fun scorer | off | — | 20–50 | `{funScore, difficulty, timeless, tone}` |
| Architect | on | high | 1–5 | `{newFact, newAnswer}` |
| Critic | on | high | 10 | `{score, feedback}` |
| Generator | on | high | 1–5 | `{rawLies: string[]}` |
| Editor | off | — | 10–20 | `{fixedLies: string[]}` |
| Localizer | off | — | 10–20 | `{fact, answer, lies}` |
| Linguist | off | — | 10–20 | `{score, issues}` |
| Fixer | on | low | 1–5 | `{fact, answer, lies}` |

Use `max` only to retry a rare hard item; it is not a default. Thinking mode ignores
`temperature`, so mechanical agents run non-thinking with a low temperature.

## Fact contract

```ts
interface Fact {
  id: string;                 // stable, e.g. book-0042
  statement: string;          // standalone, declarative, contains answer
  answer: string;
  category: string;
  source: { name: string; url: string; license: string; sourceId: string };
  confidence: number;         // 0–1, from the synthesizer
  scores?: { fun: number; difficulty: string; timeless: boolean; tone: string };
}
```

## Deterministic gates

A fact is rejected before any creative spend when:

- the answer does not appear in the statement (case/punctuation-insensitive)
- the statement is a question or ends with `?`
- the answer is `None of these`, `All of these`, `True`, or `False`
- the statement is shorter than ~20 or longer than ~220 chars
- the source row is a 2-choice/True-False item (OpenTriviaQA)
- the normalised statement duplicates an accepted fact
- confidence is below the configured threshold

A question is rejected after generation when:

- `fact` does not contain exactly one `<BLANK>`
- `answer` is empty, longer than 5 words / 45 characters, appears in `fact`, or appears in `lies`
- fewer than 12 lies, duplicates, or any lie > ~30 chars
- the truth is a pure number/date (warning; reject for the default bank)
- language/schema validation fails

## Manual/input jobs

The same funnel also runs on pasted facts (`npm run cli -- optimize --input facts.json`).
The Optimizer page creates the job via `POST /api/jobs`; the server spawns the CLI.
The page then polls the same SQLite job and renders its result cards, so the terminal,
the Optimizer and `/#jobs` share one queue, one progress stream and one pause/stop
path. There is no in-browser executor. A fact with fewer than five lies is forced through lie generation rather than
`KEEP_ALL`.

## Prompts

Live in `src/core/agents/prompts.ts`. Keep the long rules in the **system** message
and the item data in the **user** message: DeepSeek caches stable prefixes at
$0.003/M. Do not interpolate timestamps or random IDs into the system prompt.

## Funnel and cost

Target for 49.6k OpenTriviaQA rows (optional phase):

| Stage | Survives |
|---|---|
| Raw rows | 49,599 |
| Prefilter | ~25,000 |
| Synthesize + fact gate | ~15,000 |
| Fun score + critic | ~8,000 |
| Lie generation | ~6,000 |
| Human review | 2,000–3,000 |

The live smoke (5 calls: synthesis → architect → critic → generator → editor) cost
about **$0.0011** at off-peak rates. A 25k-row funnel lands around **$15–30** and a
few hours at 30–50 concurrency. See [COST.md](COST.md).

## Book phase

1. Fetch `https://www.gutenberg.org/cache/epub/46644/pg46644.txt`; strip the PG
   header/footer; cache with SHA-256.
2. Split into sections by the book's headings and `-----` separators (~170).
3. Extract 0–3 atomic facts per section; require an **exact quote** from the section.
4. Gate the quote (substring), then run the normal score → blank → lies funnel.

The book is public domain; its facts are historical. Mark `period: "historical"` and
do not "modernise" a fact into a different claim.
