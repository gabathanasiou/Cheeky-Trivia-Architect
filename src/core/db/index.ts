import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TokenUsage } from '../types';

export interface JobRow {
  id: string;
  source: string;
  status: 'pending' | 'running' | 'paused' | 'stopped' | 'done' | 'failed';
  stage: string | null;
  effort: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  cost_usd: number;
  created_at: string;
  updated_at: string;
  stop_requested: number;
  pause_requested: number;
}

export interface ItemRow {
  id: string;
  job_id: string;
  source_id: string | null;
  content_hash: string;
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'failed';
  stage: string | null;
  payload_json: string | null;
  scores_json: string | null;
  error: string | null;
  attempts: number;
  started_at: string | null;
  updated_at: string;
}

export interface NewItem {
  sourceId: string;
  contentHash: string;
  payload: unknown;
}

export interface JobSummary extends JobRow {
  pending: number;
  processing: number;
}

function now(): string {
  return new Date().toISOString();
}

export class ArchitectDb {
  private readonly db: Database.Database;

  constructor(dbPath = process.env.ARCHITECT_DB ?? 'data/architect.db') {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        stage TEXT,
        effort TEXT NOT NULL DEFAULT 'high',
        total INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        stop_requested INTEGER NOT NULL DEFAULT 0,
        pause_requested INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        source_id TEXT,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        stage TEXT,
        payload_json TEXT,
        scores_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
        cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        item_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_items_job_status ON items(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
      CREATE INDEX IF NOT EXISTS idx_logs_job ON logs(job_id, id);
    `);
  }

  createJob(input: { source: string; effort: string; items: NewItem[] }): string {
    const id = randomUUID();
    const timestamp = now();

    const insertJob = this.db.prepare(
      `INSERT INTO jobs (id, source, status, effort, total, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO items (id, job_id, source_id, content_hash, status, payload_json, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    );

    this.db.transaction(() => {
      insertJob.run(id, input.source, input.effort, input.items.length, timestamp, timestamp);
      for (const item of input.items) {
        insertItem.run(
          randomUUID(),
          id,
          item.sourceId,
          item.contentHash,
          JSON.stringify(item.payload),
          timestamp,
        );
      }
    })();

    return id;
  }

  addItems(jobId: string, items: NewItem[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO items (id, job_id, source_id, content_hash, status, payload_json, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    );
    const timestamp = now();

    this.db.transaction(() => {
      for (const item of items) {
        insert.run(randomUUID(), jobId, item.sourceId, item.contentHash, JSON.stringify(item.payload), timestamp);
      }
      this.db
        .prepare(`UPDATE jobs SET total = (SELECT COUNT(*) FROM items WHERE job_id = ?), updated_at = ? WHERE id = ?`)
        .run(jobId, timestamp, jobId);
    })();
  }

  /** Atomically claim one pending item. Returns null when the queue is empty. */
  claimItem(jobId: string): ItemRow | null {
    const claim = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT * FROM items
           WHERE job_id = ? AND status = 'pending'
           ORDER BY rowid LIMIT 1`,
        )
        .get(jobId) as ItemRow | undefined;
      if (!row) return null;

      const result = this.db
        .prepare(
          `UPDATE items
           SET status = 'processing', attempts = attempts + 1, started_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(now(), now(), row.id);
      if (result.changes === 0) return null;

      return this.getItem(row.id);
    });

    return claim();
  }

  getItem(id: string): ItemRow | null {
    return (this.db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined) ?? null;
  }

  completeItem(
    id: string,
    result: {
      status: 'done' | 'skipped' | 'failed';
      payload?: unknown;
      scores?: unknown;
      error?: string;
    },
  ): void {
    const item = this.getItem(id);
    if (!item) return;

    this.db
      .prepare(
        `UPDATE items
         SET status = ?, payload_json = COALESCE(?, payload_json),
             scores_json = COALESCE(?, scores_json), error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        result.status,
        result.payload === undefined ? null : JSON.stringify(result.payload),
        result.scores === undefined ? null : JSON.stringify(result.scores),
        result.error ?? null,
        now(),
        id,
      );

    this.refreshJob(item.job_id);
  }

  addRun(
    jobId: string,
    run: {
      stage: string;
      model: string;
      effort?: string;
      usage: TokenUsage;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO runs
         (job_id, stage, model, effort, prompt_tokens, completion_tokens,
          cache_hit_tokens, cache_miss_tokens, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        run.stage,
        run.model,
        run.effort ?? null,
        run.usage.promptTokens,
        run.usage.candidatesTokens,
        run.usage.cacheHitTokens ?? 0,
        run.usage.cacheMissTokens ?? 0,
        run.usage.estimatedCost,
        now(),
      );

    this.refreshJob(jobId);
  }

  addLog(jobId: string, level: 'info' | 'warn' | 'error', message: string, itemId?: string): void {
    this.db
      .prepare(`INSERT INTO logs (job_id, item_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(jobId, itemId ?? null, level, message, now());
  }

  setJobStatus(jobId: string, status: JobRow['status'], stage?: string): void {
    this.db
      .prepare(`UPDATE jobs SET status = ?, stage = COALESCE(?, stage), updated_at = ? WHERE id = ?`)
      .run(status, stage ?? null, now(), jobId);
  }

  requestStop(jobId: string): void {
    this.db.prepare(`UPDATE jobs SET stop_requested = 1, updated_at = ? WHERE id = ?`).run(now(), jobId);
  }

  requestPause(jobId: string): void {
    this.db.prepare(`UPDATE jobs SET pause_requested = 1, updated_at = ? WHERE id = ?`).run(now(), jobId);
  }

  clearPause(jobId: string): void {
    this.db.prepare(`UPDATE jobs SET pause_requested = 0, updated_at = ? WHERE id = ?`).run(now(), jobId);
  }

  isStopRequested(jobId: string): boolean {
    const row = this.db.prepare(`SELECT stop_requested FROM jobs WHERE id = ?`).get(jobId) as
      | { stop_requested: number }
      | undefined;
    return Boolean(row?.stop_requested);
  }

  isPauseRequested(jobId: string): boolean {
    const row = this.db.prepare(`SELECT pause_requested FROM jobs WHERE id = ?`).get(jobId) as
      | { pause_requested: number }
      | undefined;
    return Boolean(row?.pause_requested);
  }

  /** Reclaim items left in `processing` by a crashed process. */
  reclaimStaleItems(jobId: string, olderThanSeconds = 300): number {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE items
         SET status = 'pending', started_at = NULL, updated_at = ?
         WHERE job_id = ? AND status = 'processing' AND (started_at IS NULL OR started_at < ?)`,
      )
      .run(now(), jobId, cutoff);
    this.refreshJob(jobId);
    return result.changes;
  }

  getJob(jobId: string): JobSummary | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    if (!row) return null;
    return { ...row, ...this.counts(jobId) };
  }

  listJobs(limit = 50): JobSummary[] {
    const rows = this.db
      .prepare(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as JobRow[];
    return rows.map((row) => ({ ...row, ...this.counts(row.id) }));
  }

  getItems(jobId: string, options: { status?: string; limit?: number; offset?: number } = {}): ItemRow[] {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    if (options.status) {
      return this.db
        .prepare(`SELECT * FROM items WHERE job_id = ? AND status = ? ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(jobId, options.status, limit, offset) as ItemRow[];
    }
    return this.db
      .prepare(`SELECT * FROM items WHERE job_id = ? ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(jobId, limit, offset) as ItemRow[];
  }

  getRuns(jobId: string): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT * FROM runs WHERE job_id = ? ORDER BY id`).all(jobId) as Array<
      Record<string, unknown>
    >;
  }

  getLogs(jobId: string, limit = 200): Array<Record<string, unknown>> {
    return this.db
      .prepare(`SELECT * FROM logs WHERE job_id = ? ORDER BY id DESC LIMIT ?`)
      .all(jobId, limit) as Array<Record<string, unknown>>;
  }

  private counts(jobId: string): { pending: number; processing: number } {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing
         FROM items WHERE job_id = ?`,
      )
      .get(jobId) as { pending: number | null; processing: number | null };
    return { pending: row.pending ?? 0, processing: row.processing ?? 0 };
  }

  private refreshJob(jobId: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET
           total = (SELECT COUNT(*) FROM items WHERE job_id = ?),
           done = (SELECT COUNT(*) FROM items WHERE job_id = ? AND status = 'done'),
           failed = (SELECT COUNT(*) FROM items WHERE job_id = ? AND status = 'failed'),
           skipped = (SELECT COUNT(*) FROM items WHERE job_id = ? AND status = 'skipped'),
           cost_usd = (SELECT COALESCE(SUM(cost_usd), 0) FROM runs WHERE job_id = ?),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(jobId, jobId, jobId, jobId, jobId, now(), jobId);
  }

  close(): void {
    this.db.close();
  }
}
