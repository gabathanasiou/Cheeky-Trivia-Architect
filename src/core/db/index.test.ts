import { describe, expect, it } from 'vitest';
import { ArchitectDb } from './index';

function usage(cost: number) {
  return {
    promptTokens: 100,
    candidatesTokens: 20,
    totalTokens: 120,
    estimatedCost: cost,
    cacheHitTokens: 0,
    cacheMissTokens: 100,
  };
}

describe('ArchitectDb', () => {
  it('creates a job, claims items and tracks progress', () => {
    const db = new ArchitectDb(':memory:');
    const jobId = db.createJob({
      source: 'book',
      effort: 'high',
      items: [
        { sourceId: 's0', contentHash: 'h0', payload: { text: 'zero' } },
        { sourceId: 's1', contentHash: 'h1', payload: { text: 'one' } },
      ],
    });

    expect(db.getJob(jobId)).toMatchObject({ total: 2, done: 0, pending: 2, processing: 0 });

    const first = db.claimItem(jobId);
    expect(first?.source_id).toBe('s0');
    expect(db.getJob(jobId)).toMatchObject({ pending: 1, processing: 1 });

    db.completeItem(first!.id, { status: 'done', payload: { result: 'ok' } });
    expect(db.getJob(jobId)).toMatchObject({ done: 1, processing: 0, pending: 1 });

    const second = db.claimItem(jobId);
    expect(second?.source_id).toBe('s1');
    db.completeItem(second!.id, { status: 'skipped', error: 'duplicate' });
    expect(db.getJob(jobId)).toMatchObject({ done: 1, skipped: 1, pending: 0 });

    expect(db.claimItem(jobId)).toBeNull();
    db.close();
  });

  it('tracks usage cost per job', () => {
    const db = new ArchitectDb(':memory:');
    const jobId = db.createJob({ source: 'book', effort: 'high', items: [] });

    db.addRun(jobId, { stage: 'extract', model: 'deepseek-flash', effort: 'high', usage: usage(0.001) });
    db.addRun(jobId, { stage: 'score', model: 'deepseek-flash', usage: usage(0.0002) });

    expect(db.getJob(jobId)?.cost_usd).toBeCloseTo(0.0012, 10);
    expect(db.getRuns(jobId)).toHaveLength(2);
    db.close();
  });

  it('supports pause/stop flags, logs and stale reclaim', () => {
    const db = new ArchitectDb(':memory:');
    const jobId = db.createJob({
      source: 'book',
      effort: 'high',
      items: [{ sourceId: 's0', contentHash: 'h0', payload: {} }],
    });

    db.addLog(jobId, 'info', 'started');
    expect(db.getLogs(jobId)[0]).toMatchObject({ level: 'info', message: 'started' });

    db.requestStop(jobId);
    expect(db.isStopRequested(jobId)).toBe(true);
    db.requestPause(jobId);
    expect(db.isPauseRequested(jobId)).toBe(true);
    db.clearPause(jobId);
    expect(db.isPauseRequested(jobId)).toBe(false);

    const claimed = db.claimItem(jobId);
    expect(claimed).not.toBeNull();
    // A negative threshold forces the stale-claim branch.
    expect(db.reclaimStaleItems(jobId, -1)).toBe(1);
    expect(db.getJob(jobId)).toMatchObject({ pending: 1, processing: 0 });
    db.close();
  });
});
