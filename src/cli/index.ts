import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { parseArgs } from 'node:util';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pLimit from 'p-limit';
import {
  critiquePlacement,
  extractBookFacts,
  generateRawLies,
  optimizePlacement,
  refineLies,
  scoreFact,
} from '../core/agents/index';
import { isDuplicate, remember, stableId, validateFact, validateQuestion } from '../core/agents/validate';
import { fetchBookText, parseBook } from '../core/sources/book';
import type { TokenUsage } from '../core/types';
import { EMPTY_USAGE, addUsage } from '../core/llm/usage';

const USAGE = `Usage: npm run cli -- <command> [options]

Commands:
  fetch                 Download/cache the Gutenberg book and print section stats
  book                  Extract facts from the book (add --full for blanks + lies)
  help                  Show this message

Options:
  --limit <n>           Number of sections to process (default 5)
  --sections <a,b,c>    Explicit section indexes (overrides --limit)
  --full                Run Architect -> Critic -> Generator -> Editor
  --effort <low|high>   Thinking effort for creative stages (default high)
  --max-cost <usd>      Stop before the next section when this is exceeded (default 1)
  --concurrency <n>     Parallel sections (default 2)
  --out <path>          Output JSONL path (default data/exports/book-en.jsonl)
  --force               Re-download the source even if cached
`;

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function printUsage(): void {
  console.log(USAGE);
}

function sourceFor(sectionIndex: number) {
  return {
    name: 'Invention and Discovery: Curious Facts and Characteristic Sketches',
    url: 'https://www.gutenberg.org/ebooks/46644',
    license: 'public-domain',
    sourceId: `section-${sectionIndex}`,
  };
}

async function runFetch(options: { force: boolean }): Promise<void> {
  const result = await fetchBookText({ force: options.force });
  const sections = parseBook(result.text);
  console.log(`source: ${result.cached ? 'cache' : 'download'}`);
  console.log(`sha256: ${result.sha256}`);
  console.log(`bytes: ${result.text.length}`);
  console.log(`sections: ${sections.length}`);
  console.log(`first: ${sections[0]?.heading ?? '-'}`);
  console.log(`last: ${sections[sections.length - 1]?.heading ?? '-'}`);
}

interface RunOptions {
  limit: number;
  sections?: number[];
  full: boolean;
  effort: 'low' | 'high' | 'max';
  maxCost: number;
  concurrency: number;
  out: string;
  force: boolean;
}

interface Candidate {
  id: string;
  status: 'fact' | 'question';
  fact?: string;
  statement?: string;
  answer: string;
  category: string;
  lies?: string[];
  blankScore?: number;
  funScore?: number | null;
  difficulty?: string;
  timeless?: boolean;
  tone?: string;
  quote?: string;
  confidence?: number;
  source: ReturnType<typeof sourceFor>;
  usage: TokenUsage;
}

function candidateLine(candidate: Candidate): string {
  return `${JSON.stringify(candidate)}\n`;
}

async function processSection(
  section: { index: number; heading: string; text: string },
  options: RunOptions,
  seen: Set<string>,
  onUsage: (usage: TokenUsage) => void,
): Promise<Candidate[]> {
  const extracted = await extractBookFacts(section);
  onUsage(extracted.usage);

  const candidates: Candidate[] = [];

  for (const fact of extracted.data.facts) {
    const gate = validateFact(fact, { sectionText: section.text, rejectNumericAnswers: true });
    if (!gate.ok) {
      console.log(`  skip [${section.index}] ${gate.errors.join('; ')}`);
      continue;
    }
    if (isDuplicate(fact.statement, seen)) {
      console.log(`  skip [${section.index}] duplicate: ${fact.statement.slice(0, 60)}...`);
      continue;
    }
    remember(fact.statement, seen);

    const scored = await scoreFact(fact.statement, fact.category);
    onUsage(scored.usage);
    if (scored.data.funScore < 6) {
      console.log(`  skip [${section.index}] funScore ${scored.data.funScore}: ${fact.statement.slice(0, 60)}...`);
      continue;
    }

    const id = stableId('book', fact.statement);
    const base = {
      id,
      answer: fact.answer,
      category: fact.category,
      quote: fact.quote,
      confidence: fact.confidence,
      funScore: scored.data.funScore,
      blankScore: scored.data.blankScore,
      difficulty: scored.data.difficulty,
      timeless: scored.data.timeless,
      tone: scored.data.tone,
      source: sourceFor(section.index),
      usage: scored.usage,
    } satisfies Partial<Candidate>;

    if (!options.full) {
      candidates.push({
        ...base,
        status: 'fact',
        statement: fact.statement,
      });
      continue;
    }

    const current = {
      fact: fact.statement,
      answer: fact.answer,
      category: fact.category,
      lies: [],
    };

    let placement = await optimizePlacement(current, [], '', 'English');
    onUsage(placement.usage);
    let critique = await critiquePlacement(placement.data.newFact, placement.data.newAnswer, 'English');
    onUsage(critique.usage);

    if (critique.data.score < 7) {
      placement = await optimizePlacement(
        current,
        [placement.data.newFact],
        critique.data.feedback ?? '',
        'English',
      );
      onUsage(placement.usage);
      critique = await critiquePlacement(placement.data.newFact, placement.data.newAnswer, 'English');
      onUsage(critique.usage);
    }

    if (critique.data.score < 6) {
      console.log(`  skip [${section.index}] critic score ${critique.data.score}: ${placement.data.newFact}`);
      continue;
    }

    const generated = await generateRawLies(
      placement.data.newFact,
      placement.data.newAnswer,
      fact.category,
      'English',
    );
    onUsage(generated.usage);

    const edited = await refineLies(placement.data.newFact, generated.data.rawLies, 'English');
    onUsage(edited.usage);

    const question = {
      fact: placement.data.newFact,
      answer: placement.data.newAnswer,
      category: fact.category,
      lies: edited.data.fixedLies,
    };
    const questionGate = validateQuestion(question);
    if (!questionGate.ok) {
      console.log(`  skip [${section.index}] question gate: ${questionGate.errors.join('; ')}`);
      continue;
    }

    candidates.push({
      ...base,
      status: 'question',
      fact: question.fact,
      answer: question.answer,
      lies: question.lies,
      blankScore: critique.data.score,
      usage: addUsage(scored.usage, addUsage(placement.usage, addUsage(critique.usage, addUsage(generated.usage, edited.usage)))),
    });
  }

  return candidates;
}

async function runBook(options: RunOptions): Promise<void> {
  process.env.ARCHITECT_EFFORT = options.effort;
  const source = await fetchBookText({ force: options.force });
  const allSections = parseBook(source.text);
  const sections = options.sections
    ? options.sections
        .map((index) => allSections[index])
        .filter((section): section is (typeof allSections)[number] => Boolean(section))
    : allSections.slice(0, options.limit);

  if (sections.length === 0) {
    throw new Error('No sections selected. Check --limit/--sections.');
  }

  const out = path.resolve(options.out);
  await mkdir(path.dirname(out), { recursive: true });

  console.log(`book: ${source.cached ? 'cache' : 'download'}, ${allSections.length} sections`);
  console.log(`run: ${sections.length} sections, ${options.full ? 'facts + blanks + lies' : 'facts only'}`);
  console.log(`output: ${out}\n`);

  const seen = new Set<string>();
  const limit = pLimit(options.concurrency);
  const total = { ...EMPTY_USAGE };
  let written = 0;
  let stoppedForBudget = false;

  const results = await Promise.all(
    sections.map((section) =>
      limit(async () => {
        if (stoppedForBudget) return [];
        if (total.estimatedCost >= options.maxCost) {
          stoppedForBudget = true;
          console.log(`budget cap $${options.maxCost.toFixed(4)} reached; stopping new sections.`);
          return [];
        }

        console.log(`[${section.index}] ${section.heading}`);
        try {
          const candidates = await processSection(section, options, seen, (usage) => {
            Object.assign(total, addUsage(total, usage));
          });

          for (const candidate of candidates) {
            await appendFile(out, candidateLine(candidate), 'utf8');
            written += 1;
          }

          console.log(
            `[${section.index}] ${candidates.length} accepted, cost so far $${total.estimatedCost.toFixed(5)}`,
          );
          return candidates;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[${section.index}] failed: ${message}`);
          return [];
        }
      }),
    ),
  );

  const accepted = results.reduce((sum, list) => sum + list.length, 0);
  console.log(`\ndone: ${accepted} candidates (${written} written)`);
  console.log(
    `tokens: ${total.promptTokens} in / ${total.candidatesTokens} out; cost $${total.estimatedCost.toFixed(6)}`,
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: 'string' },
      sections: { type: 'string' },
      full: { type: 'boolean' },
      effort: { type: 'string' },
      'max-cost': { type: 'string' },
      concurrency: { type: 'string' },
      out: { type: 'string' },
      force: { type: 'boolean' },
    },
  });

  const command = positionals[0] ?? 'help';

  if (command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  if (command === 'fetch') {
    await runFetch({ force: bool(values.force) });
    return;
  }

  if (command === 'book') {
    const effort = str(values.effort, 'high');
    if (effort !== 'low' && effort !== 'high' && effort !== 'max') {
      throw new Error(`--effort must be low, high or max (got ${effort})`);
    }

    await runBook({
      limit: number(values.limit, 5),
      sections: values.sections
        ? str(values.sections, '')
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value))
        : undefined,
      full: bool(values.full),
      effort,
      maxCost: number(values['max-cost'], 1),
      concurrency: number(values.concurrency, 2),
      out: str(values.out, 'data/exports/book-en.jsonl'),
      force: bool(values.force),
    });
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
