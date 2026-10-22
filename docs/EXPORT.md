# Export contract — Bamboozle

Status: reference — the Architect owns authoring; Bamboozle owns the runtime bank.
The export is the only handoff.

## Question record

```ts
interface ExportedQuestion {
  id: string;              // stable: en-<category>-<seq>, never derived from text
  fact: string;            // exactly one <BLANK>
  answer: string;
  category: string;        // canonical key, not a free-text label
  lies: string[];          // 12–15 distinct lies
  funScore: number;        // 1–10
  blankScore: number;      // 1–10
  difficulty: 'easy' | 'medium' | 'hard';
  tags?: string[];
  source: {
    name: string;
    url?: string;
    license: string;       // e.g. "public-domain", "CC-BY-SA-4.0"
    sourceId?: string;
  };
}
```

## Files

```
data/exports/en.jsonl                    # reviewed source of truth
data/exports/en/manifest.json            # version, counts, categories, attribution
data/exports/en/<category>.json          # array of ExportedQuestion
data/exports/el/...                      # same shape, localised
```

The game loads `manifest.json`, then only the category files it needs. It never
downloads the whole bank. Each file is a plain JSON array; no runtime DB.

## Validation (must pass in both repos)

- exactly one `<BLANK>` in `fact`
- `answer` non-empty and not present in `fact` or `lies`
- 12–15 lies, unique, ≤ ~30 chars, no `<BLANK>`
- `category` in the canonical registry
- `id` unique and stable across exports
- `funScore`/`blankScore` in 1–10
- no duplicate normalised `fact`
- source/licence present

## Versioning

- `manifest.version` increments on every export.
- `manifest.generatedAt` is informational; the game must not depend on it.
- Removed questions stay removed: keep a `retired` list in the manifest so a stale
  client cache cannot resurrect them.

## Bamboozle side

The matching game changes live in the Bamboozle roadmap: question bank v2 (JSON
chunks + lazy host-only loading), the 12–15 lie pool, and the import of the approved
book facts. The Architect must not write directly into Bamboozle's source tree.
