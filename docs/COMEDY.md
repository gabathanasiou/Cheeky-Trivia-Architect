# Comedy Sense

Status: **agent rubric** — read before changing the Architect, Critic, extractor or fun scorer.

This is the taste layer for the question pipeline. The goal is not "technically
interesting trivia"; it is a fact someone would retell at a party, with a blank that
turns a wrong answer into a concrete, funny image.

Adapted from two MIT-licensed agent skills:

- [`heyfuturejesse/trivia-writing`](https://github.com/heyfuturejesse/trivia-writing) —
  fun over obscurity, fair/guessable clues, a satisfying reveal, answer worthiness.
  Copyright (c) 2026 Jesse Russell, MIT.
- [`jwynia/agent-skills` — joke-engineering](https://github.com/jwynia/agent-skills/blob/main/skills/creative/humor/joke-engineering/SKILL.md) —
  connection distance, specificity, irony, compression. Author jwynia, MIT.

## The test

> Would a player immediately imagine two funny lies for this blank?

If not, the blank is in the wrong place. A blank is not a vocabulary test and not a
grammar exercise. It is the **punchline position**.

## The five rules

1. **The fact must have a funny core.** A surprising, ironic, absurd, or
   "I can't believe that's true" detail. Dry biography, tributes, and "X was born in
   Y" are not eligible. Reject the fact; do not force a blank.
2. **Blank the funniest replaceable detail — anywhere.** The blank can hide the
   subject, object, action, consequence, setup, or punchline. Position is not the
   rule; the lie test is. A blank in the "plumbing" can be the funniest one:
   - "A group of `<BLANK>` is called a murder." -> **crows** ("accountants",
     "lawyers", "teenagers").
   - "The fear of `<BLANK>` is called Lachanophobia." -> **vegetables**
     ("laughing", "shoelaces", "lunch").
   High-risk positions: dates, years, numbers, percentages, bare connectors, vague
   nouns. They can work, but only if two concrete, funny lies are immediately
   obvious. If the lies are just synonyms or random numbers, move the blank.
3. **A wrong answer must create a picture.** The best lies are concrete, visual,
   plausible-but-absurd. "A flamingo" is funnier than "a different animal" because
   you can see it.
4. **Specificity beats generality.** One precise detail is funnier than three vague
   adjectives. Keep the setup short; remove throat-clearing and unnecessary
   biography.
5. **Prefer the last beat, but do not force it.** Put the blank near the end when
   the answer is the punchline. A subject/setup blank can score 9 if the lies are
   funny; judge by the lie test, not the position.

## Good vs bad blanks

**Good** — the blank hides the absurd object:

> In Switzerland, it is illegal to own just one `<BLANK>`.
> **Answer:** Guinea Pig
> **Why:** the blank is the absurd thing; "chocolate bar", "cuckoo clock", "bank
> account" all create a concrete image.

**Good** — the blank hides the subject, not the punchline:

> A group of `<BLANK>` is called a murder.
> **Answer:** crows
> **Why:** the blank is the subject; "accountants", "lawyers", "teenagers" make the
> setup pay off.

**Good** — the blank hides the ironic reward:

> The inventor of the microwave only received `<BLANK>` for his discovery.
> **Answer:** $2
> **Why:** the punchline is the tiny payment, not the invention.

**Bad** — the blank hides a number:

> In 1828, the river filled the tunnel in `<BLANK>`.
> **Answer:** fifteen minutes
> **Why:** a number is not a joke; the lies have nowhere funny to go.

**Bad** — the blank hides a long descriptive clause:

> Dr. Darwin projected a steam-carriage that was to use `<BLANK>`.
> **Answer:** bird-like wings driven by high-pressure steam
> **Why:** the funny image is the steam-carriage itself. The wings are a technical
> description, and the answer is too long.

**Better** — blank the absurd object:

> Dr. Darwin projected an `<BLANK>` that was to use bird-like wings powered by steam.
> **Answer:** aerial steam-carriage
> **Why:** the blank is the absurd invention; lies can be "a flying teapot",
> "a steam-powered pigeon", "a Victorian drone".

**Bad** — the blank hides a date:

> The first cup of tea in England was drunk in `<BLANK>`.
> **Answer:** 1660
> **Why:** nobody can lie funny about a year.

**Better** — blank the person or the situation:

> The first cup of tea in England was allegedly drunk by `<BLANK>`.
> **Answer:** a coffee-house waiter
> **Why:** the blank is a person/situation; lies create scenes.

## Scoring (1–10)

Use this for the Critic and the fun scorer.

| Score | Meaning |
|---|---|
| 9–10 | You would retell it at a party. The blank is the punchline; two funny lies are obvious. |
| 7–8 | Strong. A good lie can land; the blank hides a real detail. |
| 5–6 | Mildly interesting. The blank is okay but not the funniest place, or the fact is dry. |
| 3–4 | Dry fact, or a blank on a date/number/connector/generic noun. |
| 1–2 | No joke is possible. |

**Book extraction gate:** fun score ≥ 7.
**Blank gate:** Critic score ≥ 8 to keep; 7 is a weak pass only if the answer is
short and the fact is strong; below 7 is rejected after one re-blank attempt.

## Agent mapping

- **Extractor** — only extract facts with a funny/absurd/ironic core. Reject dry
  biography and "X was born" facts.
- **Fun scorer** — rate the fact before spending lie-generation tokens. Reject < 7.
- **Architect** — place the blank where the lie test is strongest. The subject,
  setup, object or punchline can win; prefer the end only when it is the punchline.
  Answer ≤5 words / 45 characters. If the fact has no funny blank, return the best
  attempt and let the Critic reject it.
- **Critic** — score the joke, not the grammar. Name the funnier place to blank in
  the feedback. Most blanks are 6 or below; 8+ needs an immediate "I can see the
  lies" reaction.
- **Generator** — write lies that create concrete images, not generic alternatives.
- **Editor** — keep the lies that are plausible, visual, and distinct.

## Anti-cringe

- Never punch down at a real person, a disability, a death, or a tragedy.
- "Dark" is allowed only when the historical fact itself is absurd; the joke targets
  the situation, not a victim.
- If the fact is only "weird because it is old", it is not funny. Skip it.
