import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  checkGrammar,
  critiquePlacement,
  extractBookFacts,
  fixTranslation,
  generateRawLies,
  localizeContent,
  localizeLies,
  optimizePlacement,
  parseRawInput,
  refineLies,
  scoreFact,
  synthesizeFact,
  triageFact,
  type AgentName,
} from '../core/agents/index';
import { hasApiKey, isMockMode } from '../core/llm/deepseek';
import { ArchitectDb } from '../core/db/index';
import type { TriviaFact } from '../core/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT ?? 4101);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = express();
app.use(express.json({ limit: '4mb' }));

const db = new ArchitectDb();

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
    mock: isMockMode(),
    hasKey: hasApiKey(),
  });
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: db.listJobs() });
});

function spawnJob(jobId: string, options: { maxCost: number; concurrency: number }): void {
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'run',
      'cli',
      '--',
      'run',
      jobId,
      '--max-cost',
      String(options.maxCost),
      '--concurrency',
      String(options.concurrency),
    ],
    {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    },
  );

  child.on('error', (error) => {
    db.addLog(jobId, 'error', `failed to spawn CLI: ${error.message}`);
    db.setJobStatus(jobId, 'failed');
  });
  child.unref();
}

app.post('/api/jobs', (req, res) => {
  const body = req.body as {
    input?: TriviaFact[];
    mode?: 'optimization' | 'localization';
    language?: string;
    effort?: 'low' | 'high' | 'max';
    maxCost?: number;
    concurrency?: number;
    full?: boolean;
  };

  if (!Array.isArray(body.input) || body.input.length === 0) {
    res.status(400).json({ error: 'Expected a non-empty input array' });
    return;
  }
  if (body.input.length > 1_000) {
    res.status(400).json({ error: 'Too many facts (max 1000 per job)' });
    return;
  }

  const facts = body.input
    .filter((item) => item && typeof item.fact === 'string' && typeof item.answer === 'string')
    .map((item) => ({
      fact: item.fact,
      answer: item.answer,
      category: typeof item.category === 'string' ? item.category : 'General',
      lies: Array.isArray(item.lies) ? item.lies.filter((lie) => typeof lie === 'string') : [],
    }));

  if (facts.length === 0) {
    res.status(400).json({ error: 'No valid facts in input' });
    return;
  }

  const mode = body.mode === 'localization' ? 'localization' : 'optimization';
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'English';
  const effort = body.effort === 'low' || body.effort === 'max' ? body.effort : 'high';
  const maxCost = Number.isFinite(body.maxCost) ? Number(body.maxCost) : 1;
  const concurrency = Number.isFinite(body.concurrency) ? Math.max(1, Math.min(10, Number(body.concurrency))) : 2;
  const out = `data/exports/optimized-${language.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jsonl`;

  const jobId = db.createJob({
    source: 'input',
    effort,
    items: facts.map((fact, index) => ({
      sourceId: `fact-${index}`,
      contentHash: createHash('sha256').update(JSON.stringify(fact)).digest('hex'),
      payload: fact,
    })),
    options: { mode, language, full: body.full !== false, out },
  });
  db.addLog(jobId, 'info', `created from UI with ${facts.length} facts`);

  spawnJob(jobId, { maxCost, concurrency });
  res.status(201).json({ job: db.getJob(jobId) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = Number(req.query.limit ?? 100);
  res.json({
    job,
    items: db.getItems(req.params.id, {
      status,
      limit: Number.isFinite(limit) ? limit : 100,
    }),
    runs: db.getRuns(req.params.id),
    logs: db.getLogs(req.params.id, 50),
  });
});

app.post('/api/jobs/:id/pause', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  db.requestPause(req.params.id);
  db.setJobStatus(req.params.id, 'paused');
  res.json({ job: db.getJob(req.params.id) });
});

app.post('/api/jobs/:id/resume', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  db.clearPause(req.params.id);
  spawnJob(req.params.id, { maxCost: 1, concurrency: 2 });
  res.json({ job: db.getJob(req.params.id) });
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = db.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  db.requestStop(req.params.id);
  res.json({ job: db.getJob(req.params.id) });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const jobId = req.params.id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    const job = db.getJob(jobId);
    if (!job) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Job not found' })}\n\n`);
      return false;
    }
    res.write(`data: ${JSON.stringify(job)}\n\n`);
    return true;
  };

  send();
  const timer = setInterval(() => {
    if (!send()) {
      clearInterval(timer);
      res.end();
    }
  }, 1_000);

  req.on('close', () => clearInterval(timer));
});

app.post('/api/agent', async (req, res) => {
  const { name, args } = req.body as { name?: AgentName; args?: unknown[] };
  if (!name || !Array.isArray(args)) {
    res.status(400).json({ error: 'Expected { name: AgentName, args: unknown[] }' });
    return;
  }

  try {
    let result: unknown;

    switch (name) {
      case 'parse':
        result = await parseRawInput(String(args[0] ?? ''));
        break;
      case 'synthesize':
        result = await synthesizeFact(args[0] as Parameters<typeof synthesizeFact>[0]);
        break;
      case 'extract':
        result = await extractBookFacts(
          args[0] as Parameters<typeof extractBookFacts>[0],
          args[1] as string | undefined,
        );
        break;
      case 'triage':
        result = await triageFact(
          args[0] as Parameters<typeof triageFact>[0],
          args[1] as string | undefined,
        );
        break;
      case 'score':
        result = await scoreFact(
          String(args[0] ?? ''),
          String(args[1] ?? 'General'),
        );
        break;
      case 'architect':
        result = await optimizePlacement(
          args[0] as Parameters<typeof optimizePlacement>[0],
          (args[1] as string[] | undefined) ?? [],
          (args[2] as string | undefined) ?? '',
          (args[3] as string | undefined) ?? 'English',
        );
        break;
      case 'critic':
        result = await critiquePlacement(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          (args[2] as string | undefined) ?? 'English',
        );
        break;
      case 'generate':
        result = await generateRawLies(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          String(args[2] ?? 'General'),
          (args[3] as string | undefined) ?? 'English',
        );
        break;
      case 'refine':
        result = await refineLies(
          String(args[0] ?? ''),
          (args[1] as string[] | undefined) ?? [],
          (args[2] as string | undefined) ?? 'English',
        );
        break;
      case 'localize':
        result = await localizeContent(
          args[0] as Parameters<typeof localizeContent>[0],
          String(args[1] ?? 'Greek'),
          args[2] as string | undefined,
        );
        break;
      case 'localize-lies':
        result = await localizeLies(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          (args[2] as string[] | undefined) ?? [],
          String(args[3] ?? 'Greek'),
        );
        break;
      case 'linguist':
        result = await checkGrammar(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          (args[2] as string[] | undefined) ?? [],
          String(args[3] ?? 'Greek'),
        );
        break;
      case 'fixer':
        result = await fixTranslation(
          String(args[0] ?? ''),
          String(args[1] ?? ''),
          (args[2] as string[] | undefined) ?? [],
          (args[3] as string[] | undefined) ?? [],
          String(args[4] ?? 'Greek'),
          args[5] as TriviaFact | undefined,
        );
        break;
      default:
        res.status(400).json({ error: `Unknown agent: ${String(name)}` });
        return;
    }

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${name}]`, message);
    res.status(500).json({ error: message });
  }
});

// Serve the built UI in start/test mode. Vite owns the UI in dev.
const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(
    `[architect] ${isMockMode() ? 'MOCK' : 'DeepSeek'} server on http://${HOST}:${PORT}`,
  );
  if (!isMockMode() && !hasApiKey()) {
    console.warn('[architect] DEEPSEEK_API_KEY is not set — /api/agent will fail until it is.');
  }
});
