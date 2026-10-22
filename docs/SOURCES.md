# Sources and licences

Status: reference — every source must have a recorded licence before import. An
unknown licence blocks the pipeline.

## Phase 1 — Invention and Discovery (public domain)

- **Title:** *Invention and Discovery: Curious Facts and Characteristic Sketches*
- **Author:** Anonymous (19th century)
- **Project Gutenberg:** eBook 46644
- **Text:** <https://www.gutenberg.org/cache/epub/46644/pg46644.txt>
- **Licence:** public domain in the USA; the underlying work is long out of copyright.
- **Shape:** ~6,850 lines, ~170 sections, Victorian prose about inventors and
  discoveries.
- **Use:** extract atomic facts with an exact supporting quote, then rewrite them
  into modern, punchy statements. Do not copy paragraphs into the game.
- **Caveat:** some 19th-century science is outdated. Keep `period: "historical"` and
  reject claims that are no longer true; do not silently modernise them.

**Cache:** `scripts/fetch-sources.mjs` downloads the text to
`data/sources/gutenberg-46644.txt`, records the SHA-256 in
`data/sources/manifest.json`, and refuses a changed hash without `--force`.

## Optional — OpenTriviaQA (licence gate)

- **Dataset:** <https://huggingface.co/datasets/kth8/OpenTriviaQA>
- **Rows:** 49,599; 22 categories; ~42k with four choices.
- **Upstream:** <https://github.com/uberspot/OpenTriviaQA>
- **Licence:** upstream README and repository say **CC-BY-SA-4.0**. The HF dataset
  card says CC-BY-4.0, but a mirror cannot relicense the source; treat the upstream
  ShareAlike as authoritative until the author confirms otherwise.
- **Consequence:** if we copy or adapt its text, the derived question bank must be
  shared under CC-BY-SA-4.0 with attribution. That is a product decision, not a
  technical one; roadmap item 10 stays blocked until it is recorded here.

### Prefilter (only if the licence is accepted)

Drop:

- 2-choice / True-False rows (~6,658)
- `None of these` / `All of these` answers or choices
- pure number/date answers (the game's truth should not be a number)
- plot-recap questions longer than ~200 characters
- mojibake (`â`, `Ð`, replacement chars) and empty choices
- exact/near duplicates

Then synthesise, gate and score as normal. Expect ~25k candidates, not 49.6k.

## Optional — Wikidata / OpenTDB

- **Wikidata:** CC0, huge, structured; needs SPARQL/templates and a source adapter.
- **OpenTDB:** CC-BY-SA-4.0, smaller and cleaner than OpenTriviaQA; same ShareAlike
  decision applies.

## Source record

Every fact carries:

```json
{
  "source": {
    "name": "Invention and Discovery",
    "url": "https://www.gutenberg.org/ebooks/46644",
    "license": "public-domain",
    "sourceId": "section-042"
  }
}
```

Exports include an attribution line generated from this field. Never strip it during
review or export.
