import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  critiquePlacement,
  extractBookFacts,
  generateRawLies,
  optimizePlacement,
  refineLies,
  scoreFact,
} from '../core/agents/index';
import {
  isDuplicate,
  remember,
  stableId,
  validateFact,
  validateQuestion,
} from '../core/agents/validate';
import { fetchBookText, parseBook } from '../core/sources/book';
import type { TokenUsage } from '../core/types';
import { addUsage } from '../core/llm/usage';
import { ArchitectDb, type ItemRow, type JobSummary } from '../core/db/index';

const USAGE = `Usage: npm run cli -- <command> [options]

Commands:
  fetch                     Download/cache the Gutenberg book and print section stats
  book                      Create a job and extract facts (add --full for blanks + lies)
  status [jobId]            List jobs, or show one job + its latest logs
  items <jobId>             Show job items (--status pending|processing|done|skipped|failed)
  logs <jobId>              Show the latest logs
  resume <jobId>            Reclaim stale items in a job and continue it
  help                      Show this message

Book options:
  --limit <n>               Number of sections to process (default 5)
  --sections <a,b,c>        Explicit section indexes (overrides --limit)
  --full                    Run Architect -> Critic -> Generator -> Editor
  --effort <low|high|max>   Thinking effort for creative stages (default high)
  --max-cost <usd>          Pause before the next item when this is exceeded (default 1)
  --concurrency <n>         Parallel workers (default 2)
  --out <path>              Final JSONL export (default data/exports/book-en.jsonl)
  --force                   Re-download the source even if cached
`;

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function printJobs(jobs: JobSummary[]): void {
  if (jobs.length === 0) {
    console.log('no jobs');
    return;
  }
  console.log('id'.padEnd(38), 'source'.padEnd(8), 'status'.padEnd(8), 'done'.padStart(10), 'fail'.padStart(5), 'skip'.padStart(5), 'cost'.padStart(10));
  for (const job of jobs) {
    const progress = `${job.done}/${job.total}`;
    console.log(
      job.id.padEnd(38),
      job.source.padEnd(8),
      job.status.padEnd(8),
      progress.padStart(10),
      String(job.failed).padStart(5),
      String(job.skipped).padStart(5),
      `$${job.cost_usd.toFixed(5)}`.padStart(10),
    );
  }
}

function printJob(job: JobSummary): void {
  console.log(`job:      ${job.id}`);
  console.log(`source:   ${job.source}`);
  console.log(`status:   ${job.status}${job.stage ? ` (${job.stage})` : ''}`);
  console.log(`effort:   ${job.effort}`);
  console.log(`progress: ${job.done}/${job.total} done, ${job.failed} failed, ${job.skipped} skipped, ${job.pending} pending, ${job.processing} processing`);
  console.log(`cost:     $${job.cost_usd.toFixed(6)}`);
  console.log(`created:  ${job.created_at}`);
  console.log(`updated:  ${job.updated_at}`);
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
  jobId?: string;
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
  funScore?: number;
  difficulty?: string;
  timeless?: boolean;
  tone?: string;
  quote?: string;
  confidence?: number;
  source: ReturnType<typeof sourceFor>;
  usage: TokenUsage;
}

type UsageSink = (stage: string, usage: TokenUsage) => void;

function candidateLine(candidate: Candidate): string {
  return `${JSON.stringify(candidate)}\n`;
}

async function processSection(
  section: { index: number; heading: string; text: string },
  options: RunOptions,
  seen: Set<string>,
  onUsage: UsageSink,
): Promise<Candidate[]> {
  const extracted = await extractBookFacts(section);
  onUsage('extract', extracted.usage);

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
    onUsage('score', scored.usage);
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
    onUsage('architect', placement.usage);
    let critique = await critiquePlacement(placement.data.newFact, placement.data.newAnswer, 'English');
    onUsage('critic', critique.usage);

    if (critique.data.score < 7) {
      placement = await optimizePlacement(
        current,
        [placement.data.newFact],
        critique.data.feedback ?? '',
        'English',
      );
      onUsage('architect', placement.usage);
      critique = await critiquePlacement(placement.data.newFact, placement.data.newAnswer, 'English');
      onUsage('critic', critique.usage);
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
    onUsage('generate', generated.usage);

    const edited = await refineLies(placement.data.newFact, generated.data.rawLies, 'English');
    onUsage('refine', edited.usage);

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
      statement: fact.statement,
      fact: question.fact,
      answer: question.answer,
      lies: question.lies,
      blankScore: critique.data.score,
      usage: addUsage(
        scored.usage,
        addUsage(
          placement.usage,
          addUsage(critique.usage, addUsage(generated.usage, edited.usage)),
        ),
      ),
    });
  }

  return candidates;
}

/** Restore the dedupe set from completed items so a resume does not duplicate. */
function loadSeen(db: ArchitectDb, jobId: string): Set<string> {
  const seen = new Set<string>();
  for (const item of db.getItems(jobId, { status: 'done', limit: 100_000 })) {
    try {
      const payload = JSON.parse(item.payload_json ?? '{}') as { candidates?: Candidate[] };
      for (const candidate of payload.candidates ?? []) {
        const text = candidate.statement ?? candidate.fact;
        if (text) remember(text, seen);
      }
    } catch {
      // Ignore malformed payloads from an older run.
    }
  }
  return seen;
}

function selectSections(
  allSections: ReturnType<typeof parseBook>,
  options: RunOptions,
) {
  return options.sections
    ? options.sections
        .map((index) => allSections[index])
        .filter((section): section is (typeof allSections)[number] => Boolean(section))
    : allSections.slice(0, options.limit);
}

async function runBook(options: RunOptions): Promise<void> {
  process.env.ARCHITECT_EFFORT = options.effort;
  const db = new ArchitectDb();

  let jobId = options.jobId;
  if (!jobId) {
    const source = await fetchBookText({ force: options.force });
    const allSections = parseBook(source.text);
    const sections = selectSections(allSections, options);

    if (sections.length === 0) {
      throw new Error('No sections selected. Check --limit/--sections.');
    }

    jobId = db.createJob({
      source: 'book',
      effort: options.effort,
      items: sections.map((section) => ({
        sourceId: `section-${section.index}`,
        contentHash: contentHash(section.text),
        payload: section,
      })),
    });
    db.addLog(jobId, 'info', `created with ${sections.length} sections from ${allSections.length}`);
    console.log(`created job ${jobId} (${sections.length} sections)`);
  } else {
    const job = db.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const reclaimed = db.reclaimStaleItems(jobId);
    if (reclaimed > 0) console.log(`reclaimed ${reclaimed} stale item(s)`);
  }

  const job = db.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  db.setJobStatus(jobId, 'running');
  const seen = loadSeen(db, jobId);
  const out = path.resolve(options.out);
  await mkdir(path.dirname(out), { recursive: true });

  console.log(`job: ${jobId}`);
  console.log(`run: ${job.pending + job.processing} pending, ${options.full ? 'facts + blanks + lies' : 'facts only'}`);
  console.log(`output: ${out}\n`);

  const workers = Array.from({ length: options.concurrency }, async () => {
      while (true) {
        if (db.isStopRequested(jobId!)) {
          db.addLog(jobId!, 'warn', 'stop requested');
          break;
        }
        if (db.isPauseRequested(jobId!)) {
          await sleep(1_000);
          continue;
        }

        const current = db.getJob(jobId!);
        if (!current) break;
        if (current.status === 'paused') break;
        if (current.cost_usd >= options.maxCost) {
          db.requestPause(jobId!);
          db.setJobStatus(jobId!, 'paused');
          db.addLog(jobId!, 'warn', `budget cap $${options.maxCost.toFixed(4)} reached`);
          console.log(`budget cap $${options.maxCost.toFixed(4)} reached; pausing.`);
          break;
        }

        const item = db.claimItem(jobId!);
        if (!item) break;

        let section: { index: number; heading: string; text: string };
        try {
          section = JSON.parse(item.payload_json ?? '{}') as typeof section;
        } catch (error) {
          db.completeItem(item.id, { status: 'failed', error: 'invalid item payload' });
          continue;
        }

        console.log(`[${section.index}] ${section.heading}`);
        try {
          const candidates = await processSection(section, options, seen, (stage, usage) => {
            db.addRun(jobId!, { stage, model: MODEL, effort: options.effort, usage });
          });

          if (candidates.length === 0) {
            db.completeItem(item.id, { status: 'skipped', error: 'no accepted facts' });
            db.addLog(jobId!, 'info', `[${section.index}] skipped: no accepted facts`, item.id);
          } else {
            db.completeItem(item.id, {
              status: 'done',
              payload: { section, candidates },
              scores: {
                bestFunScore: Math.max(...candidates.map((candidate) => candidate.funScore ?? 0)),
              },
            });
            db.addLog(jobId!, 'info', `[${section.index}] ${candidates.length} candidate(s)`, item.id);
          }

          const currentJob = db.getJob(jobId!);
          console.log(
            `[${section.index}] ${candidates.length} accepted, job cost $${(currentJob?.cost_usd ?? 0).toFixed(5)}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[${section.index}] failed: ${message}`);
          db.completeItem(item.id, { status: 'failed', error: message });
          db.addLog(jobId!, 'error', `[${section.index}] ${message}`, item.id);
        }
      }
  });

  await Promise.all(workers);

  const final = db.getJob(jobId);
  if (!final) throw new Error(`Job disappeared: ${jobId}`);

  if (db.isStopRequested(jobId)) db.setJobStatus(jobId, 'stopped');
  else if (db.isPauseRequested(jobId)) db.setJobStatus(jobId, 'paused');
  else if (final.pending === 0 && final.processing === 0) db.setJobStatus(jobId, 'done');

  // Rebuild the JSONL from the DB so a resumed run produces a complete file.
  const all = db.getItems(jobId, { status: 'done', limit: 100_000 });
  const lines: string[] = [];
  for (const item of all) {
    try {
      const payload = JSON.parse(item.payload_json ?? '{}') as { candidates?: Candidate[] };
      for (const candidate of payload.candidates ?? []) {
        lines.push(candidateLine(candidate));
      }
    } catch {
      // Ignore malformed payloads.
    }
  }
  await writeFile(out, lines.join(''), 'utf8');

  console.log(`\ndone: ${lines.length} candidates written to ${out}`);
  console.log(`job: ${jobId} (${db.getJob(jobId)?.status}) cost $${(db.getJob(jobId)?.cost_usd ?? 0).toFixed(6)}`);
  db.close();
}

function printItem(item: ItemRow): void {
  console.log(
    `${item.id.slice(0, 8)}  ${item.status.padEnd(10)}  ${(item.source_id ?? '-').padEnd(12)}  ${item.error ?? ''}`,
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
      status: { type: 'string' },
      job: { type: 'string' },
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

  if (command === 'status') {
    const db = new ArchitectDb();
    const jobId = positionals[1];
    if (jobId) {
      const job = db.getJob(jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      printJob(job);
      console.log('\nrecent logs:');
      for (const log of db.getLogs(jobId, 15)) {
        console.log(`  ${String(log.created_at)}  ${String(log.level).padEnd(5)}  ${String(log.message)}`);
      }
    } else {
      printJobs(db.listJobs());
    }
    db.close();
    return;
  }

  if (command === 'items') {
    const jobId = positionals[1];
    if (!jobId) throw new Error('items requires a job id');
    const db = new ArchitectDb();
    const items = db.getItems(jobId, {
      status: typeof values.status === 'string' ? values.status : undefined,
      limit: number(values.limit, 100),
    });
    items.forEach(printItem);
    db.close();
    return;
  }

  if (command === 'logs') {
    const jobId = positionals[1];
    if (!jobId) throw new Error('logs requires a job id');
    const db = new ArchitectDb();
    for (const log of db.getLogs(jobId, number(values.limit, 100))) {
      console.log(`${String(log.created_at)}  ${String(log.level).padEnd(5)}  ${String(log.message)}`);
    }
    db.close();
    return;
  }

  if (command === 'resume') {
    const jobId = positionals[1] ?? (typeof values.job === 'string' ? values.job : undefined);
    if (!jobId) throw new Error('resume requires a job id');
    await runBook({
      limit: 0,
      full: bool(values.full),
      effort: (str(values.effort, 'high') as RunOptions['effort']),
      maxCost: number(values['max-cost'], 1),
      concurrency: number(values.concurrency, 2),
      out: str(values.out, 'data/exports/book-en.jsonl'),
      force: false,
      jobId,
    });
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
      jobId: typeof values.job === 'string' ? values.job : undefined,
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
