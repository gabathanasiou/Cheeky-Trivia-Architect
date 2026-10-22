import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  answerTooLong,
  isDuplicate,
  remember,
  stableId,
  validateFact,
  validateQuestion,
} from '../core/agents/validate';
import { fetchBookText, parseBook } from '../core/sources/book';
import type { TokenUsage, TriviaFact } from '../core/types';
import { addUsage } from '../core/llm/usage';
import { ArchitectDb, type ItemRow, type JobSummary } from '../core/db/index';
import { processFact, SkipError } from './processFact';
import type { Candidate, Effort, RunMode, RunOptions, UsageSink } from './types';

const USAGE = `Usage: npm run cli -- <command> [options]

Commands:
  fetch                     Download/cache the Gutenberg book and print section stats
  book                      Create a book job (add --full for blanks + lies)
  optimize                  Create a manual/input job from a JSON array
  run <jobId>               Run or resume any job by id
  resume <jobId>            Alias for run (reclaims stale items first)
  status [jobId]            List jobs, or show one job + its latest logs
  items <jobId>             Show job items (--status pending|processing|done|skipped|failed)
  logs <jobId>              Show the latest logs
  help                      Show this message

Common options:
  --effort <low|high|max>   Thinking effort (default high)
  --max-cost <usd>          Pause before the next item when this is exceeded (default 1)
  --concurrency <n>         Parallel workers (default 2)
  --out <path>              Final JSONL export
  --job <id>                Use an existing job instead of creating one

Book options:
  --limit <n>               Number of sections (default 5)
  --sections <a,b,c>        Explicit section indexes (overrides --limit)
  --full                    Run Architect -> Critic -> Generator -> Editor
  --force                   Re-download the source even if cached

Optimize options:
  --input <path|->          JSON array of { fact, answer, category, lies }
  --mode <optimization|localization>  (default optimization)
  --language <name>         Target language (default English)
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

function sourceForBook(sectionIndex: number) {
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

function parseEffort(value: string): Effort {
  if (value !== 'low' && value !== 'high' && value !== 'max') {
    throw new Error(`--effort must be low, high or max (got ${value})`);
  }
  return value;
}

function parseMode(value: string): RunMode {
  if (value !== 'optimization' && value !== 'localization') {
    throw new Error(`--mode must be optimization or localization (got ${value})`);
  }
  return value;
}

function printJobs(jobs: JobSummary[]): void {
  if (jobs.length === 0) {
    console.log('no jobs');
    return;
  }
  console.log(
    'id'.padEnd(38),
    'source'.padEnd(8),
    'status'.padEnd(8),
    'done'.padStart(10),
    'fail'.padStart(5),
    'skip'.padStart(5),
    'cost'.padStart(10),
  );
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
  if (job.options_json) console.log(`options:  ${job.options_json}`);
  console.log(`created:  ${job.created_at}`);
  console.log(`updated:  ${job.updated_at}`);
}

function printItem(item: ItemRow): void {
  console.log(
    `${item.id.slice(0, 8)}  ${item.status.padEnd(10)}  ${(item.source_id ?? '-').padEnd(12)}  ${item.error ?? ''}`,
  );
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
      source: sourceForBook(section.index),
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

    let placement = await optimizePlacement(current, [], '', options.language);
    onUsage('architect', placement.usage);
    let critique = await critiquePlacement(
      placement.data.newFact,
      placement.data.newAnswer,
      options.language,
    );
    onUsage('critic', critique.usage);

    const tooLong = answerTooLong(placement.data.newAnswer);
    if (critique.data.score < 7 || tooLong) {
      const feedback = [
        critique.data.feedback ?? '',
        tooLong
          ? `The answer "${placement.data.newAnswer}" is too long; it must be at most 5 words and 45 characters. Choose a shorter blank.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      placement = await optimizePlacement(
        current,
        [placement.data.newFact],
        feedback,
        options.language,
      );
      onUsage('architect', placement.usage);
      critique = await critiquePlacement(
        placement.data.newFact,
        placement.data.newAnswer,
        options.language,
      );
      onUsage('critic', critique.usage);
    }

    if (answerTooLong(placement.data.newAnswer)) {
      console.log(`  skip [${section.index}] answer too long: ${placement.data.newAnswer}`);
      continue;
    }
    if (critique.data.score < 6) {
      console.log(`  skip [${section.index}] critic score ${critique.data.score}: ${placement.data.newFact}`);
      continue;
    }

    const generated = await generateRawLies(
      placement.data.newFact,
      placement.data.newAnswer,
      fact.category,
      options.language,
    );
    onUsage('generate', generated.usage);

    const edited = await refineLies(placement.data.newFact, generated.data.rawLies, options.language);
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

function selectSections(allSections: ReturnType<typeof parseBook>, options: RunOptions) {
  return options.sections
    ? options.sections
        .map((index) => allSections[index])
        .filter((section): section is (typeof allSections)[number] => Boolean(section))
    : allSections.slice(0, options.limit);
}

function jobOptions(job: JobSummary, fallback: RunOptions): RunOptions {
  let stored: Partial<RunOptions> = {};
  try {
    stored = JSON.parse(job.options_json ?? '{}') as Partial<RunOptions>;
  } catch {
    stored = {};
  }
  return {
    ...fallback,
    effort: parseEffort(job.effort),
    mode: stored.mode ?? fallback.mode,
    language: stored.language ?? fallback.language,
    full: stored.full ?? fallback.full,
    out: stored.out ?? fallback.out,
    jobId: job.id,
  };
}

async function runJob(db: ArchitectDb, jobId: string, options: RunOptions): Promise<void> {
  const existing = db.getJob(jobId);
  if (!existing) throw new Error(`Job not found: ${jobId}`);
  const effective = jobOptions(existing, options);
  process.env.ARCHITECT_EFFORT = effective.effort;

  const reclaimed = db.reclaimStaleItems(jobId);
  if (reclaimed > 0) console.log(`reclaimed ${reclaimed} stale item(s)`);
  db.setJobStatus(jobId, 'running');

  const seen = loadSeen(db, jobId);
  const out = path.resolve(effective.out);
  await mkdir(path.dirname(out), { recursive: true });

  const job = db.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  console.log(`job: ${jobId}`);
  console.log(`source: ${job.source}, effort ${effective.effort}, ${job.pending + job.processing} pending`);
  console.log(`output: ${out}\n`);

  const workers = Array.from({ length: effective.concurrency }, async () => {
    while (true) {
      if (db.isStopRequested(jobId)) {
        db.addLog(jobId, 'warn', 'stop requested');
        break;
      }
      if (db.isPauseRequested(jobId)) {
        await sleep(1_000);
        continue;
      }

      const current = db.getJob(jobId);
      if (!current) break;
      if (current.status === 'paused') break;
      if (current.cost_usd >= effective.maxCost) {
        db.requestPause(jobId);
        db.setJobStatus(jobId, 'paused');
        db.addLog(jobId, 'warn', `budget cap $${effective.maxCost.toFixed(4)} reached`);
        console.log(`budget cap $${effective.maxCost.toFixed(4)} reached; pausing.`);
        break;
      }

      const item = db.claimItem(jobId);
      if (!item) break;

      let candidates: Candidate[];
      let sourcePayload: unknown;
      try {
        if (job.source === 'book') {
          const section = JSON.parse(item.payload_json ?? '{}') as {
            index: number;
            heading: string;
            text: string;
          };
          sourcePayload = section;
          console.log(`[${section.index}] ${section.heading}`);
          candidates = await processSection(section, effective, seen, (stage, usage) => {
            db.addRun(jobId, { stage, model: MODEL, effort: effective.effort, usage });
          });
        } else {
          const fact = JSON.parse(item.payload_json ?? '{}') as TriviaFact;
          sourcePayload = fact;
          const index = Number((item.source_id ?? 'fact-0').replace('fact-', '')) || 0;
          console.log(`[${index}] ${fact.fact.slice(0, 60)}`);
          candidates = await processFact(fact, effective, (stage, usage) => {
            db.addRun(jobId, { stage, model: MODEL, effort: effective.effort, usage });
          }, index);
        }

        if (candidates.length === 0) {
          db.completeItem(item.id, { status: 'skipped', error: 'no accepted candidate' });
          db.addLog(jobId, 'info', `${item.source_id ?? item.id} skipped`, item.id);
        } else {
          db.completeItem(item.id, {
            status: 'done',
            payload: { source: sourcePayload, candidates },
            scores: {
              bestFunScore: Math.max(...candidates.map((candidate) => candidate.funScore ?? 0)),
            },
          });
          db.addLog(jobId, 'info', `${item.source_id ?? item.id}: ${candidates.length} candidate(s)`, item.id);
        }

        const currentJob = db.getJob(jobId);
        console.log(
          `${item.source_id ?? item.id} done, job cost $${(currentJob?.cost_usd ?? 0).toFixed(5)}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof SkipError) {
          console.log(`${item.source_id ?? item.id} skipped: ${message}`);
          db.completeItem(item.id, { status: 'skipped', error: message });
          db.addLog(jobId, 'info', `${item.source_id ?? item.id} skipped: ${message}`, item.id);
        } else {
          console.error(`${item.source_id ?? item.id} failed: ${message}`);
          db.completeItem(item.id, { status: 'failed', error: message });
          db.addLog(jobId, 'error', `${item.source_id ?? item.id}: ${message}`, item.id);
        }
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
        lines.push(`${JSON.stringify(candidate)}\n`);
      }
    } catch {
      // Ignore malformed payloads.
    }
  }
  await writeFile(out, lines.join(''), 'utf8');

  console.log(`\ndone: ${lines.length} candidates written to ${out}`);
  const after = db.getJob(jobId);
  console.log(`job: ${jobId} (${after?.status}) cost $${(after?.cost_usd ?? 0).toFixed(6)}`);
}

async function createBookJob(db: ArchitectDb, options: RunOptions): Promise<string> {
  const source = await fetchBookText({ force: options.force });
  const allSections = parseBook(source.text);
  const sections = selectSections(allSections, options);

  if (sections.length === 0) {
    throw new Error('No sections selected. Check --limit/--sections.');
  }

  const jobId = db.createJob({
    source: 'book',
    effort: options.effort,
    items: sections.map((section) => ({
      sourceId: `section-${section.index}`,
      contentHash: contentHash(section.text),
      payload: section,
    })),
    options: { mode: 'optimization', language: options.language, full: options.full, out: options.out },
  });
  db.addLog(jobId, 'info', `created with ${sections.length} sections from ${allSections.length}`);
  console.log(`created job ${jobId} (${sections.length} sections)`);
  return jobId;
}

async function readInput(inputPath: string): Promise<TriviaFact[]> {
  let text: string;
  if (inputPath === '-') {
    text = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  } else {
    text = await readFile(inputPath, 'utf8');
  }

  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Input must be a non-empty JSON array');
  }
  return parsed as TriviaFact[];
}

async function createOptimizeJob(db: ArchitectDb, options: RunOptions & { input: string }): Promise<string> {
  const facts = await readInput(options.input);
  const jobId = db.createJob({
    source: 'input',
    effort: options.effort,
    items: facts.map((fact, index) => ({
      sourceId: `fact-${index}`,
      contentHash: contentHash(JSON.stringify(fact)),
      payload: fact,
    })),
    options: {
      mode: options.mode,
      language: options.language,
      full: options.full,
      out: options.out,
    },
  });
  db.addLog(jobId, 'info', `created with ${facts.length} manual facts`);
  console.log(`created job ${jobId} (${facts.length} facts)`);
  return jobId;
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
      input: { type: 'string' },
      mode: { type: 'string' },
      language: { type: 'string' },
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

  const common = {
    effort: parseEffort(str(values.effort, 'high')),
    maxCost: number(values['max-cost'], 1),
    concurrency: number(values.concurrency, 2),
    force: bool(values.force),
    mode: parseMode(str(values.mode, 'optimization')),
    language: str(values.language, 'English'),
  };

  if (command === 'book') {
    const db = new ArchitectDb();
    const options: RunOptions = {
      ...common,
      limit: number(values.limit, 5),
      sections: values.sections
        ? str(values.sections, '')
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value))
        : undefined,
      full: bool(values.full),
      out: str(values.out, 'data/exports/book-en.jsonl'),
      jobId: typeof values.job === 'string' ? values.job : undefined,
    };
    const jobId = options.jobId ?? (await createBookJob(db, options));
    await runJob(db, jobId, options);
    db.close();
    return;
  }

  if (command === 'optimize') {
    if (typeof values.input !== 'string') {
      throw new Error('optimize requires --input <path|->');
    }
    const db = new ArchitectDb();
    const options: RunOptions = {
      ...common,
      limit: 0,
      full: bool(values.full),
      out: str(values.out, `data/exports/optimized-${common.language.toLowerCase()}.jsonl`),
      input: values.input,
      jobId: typeof values.job === 'string' ? values.job : undefined,
    } as RunOptions & { input: string };
    const jobId = options.jobId ?? (await createOptimizeJob(db, options as RunOptions & { input: string }));
    await runJob(db, jobId, options);
    db.close();
    return;
  }

  if (command === 'run' || command === 'resume') {
    const jobId = positionals[1] ?? (typeof values.job === 'string' ? values.job : undefined);
    if (!jobId) throw new Error(`${command} requires a job id`);
    const db = new ArchitectDb();
    const job = db.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const options: RunOptions = {
      ...common,
      limit: 0,
      full: bool(values.full),
      out: str(values.out, 'data/exports/job.jsonl'),
      jobId,
    };
    await runJob(db, jobId, options);
    db.close();
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
