import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, Pause, Play, RefreshCw, Square, Terminal } from 'lucide-react';

interface Job {
  id: string;
  source: string;
  status: string;
  effort: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  pending: number;
  processing: number;
  cost_usd: number;
  created_at: string;
  updated_at: string;
}

interface Item {
  id: string;
  source_id: string | null;
  status: string;
  error: string | null;
  attempts: number;
  payload_json: string | null;
  scores_json: string | null;
}

interface Candidate {
  id?: string;
  status?: 'fact' | 'question';
  statement?: string;
  fact?: string;
  answer: string;
  category: string;
  lies?: string[];
  funScore?: number;
  blankScore?: number;
  difficulty?: string;
  quote?: string;
  confidence?: number;
}

function candidatesFor(item: Item): Candidate[] {
  try {
    const payload = JSON.parse(item.payload_json ?? '{}') as { candidates?: Candidate[] };
    return Array.isArray(payload.candidates) ? payload.candidates : [];
  } catch {
    return [];
  }
}

interface Log {
  id: number;
  level: string;
  message: string;
  created_at: string;
}

interface JobDetail {
  job: Job;
  items: Item[];
  logs: Log[];
}

function statusColor(status: string): string {
  switch (status) {
    case 'done':
      return 'text-neon-green';
    case 'running':
      return 'text-neon-blue';
    case 'paused':
      return 'text-yellow-400';
    case 'failed':
      return 'text-red-400';
    case 'stopped':
      return 'text-slate-400';
    default:
      return 'text-slate-300';
  }
}

function progress(job: Job): number {
  if (job.total === 0) return 0;
  return Math.round(((job.done + job.failed + job.skipped) / job.total) * 100);
}

export const JobsView: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadJobs = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/jobs');
      if (!response.ok) throw new Error(`jobs ${response.status}`);
      const data = (await response.json()) as { jobs: Job[] };
      setJobs(data.jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadDetail = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}?limit=200`);
      if (!response.ok) throw new Error(`job ${response.status}`);
      setDetail((await response.json()) as JobDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 2_000);
    return () => clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void loadDetail(selected);
    const source = new EventSource(`/api/jobs/${selected}/events`);
    source.onmessage = (event) => {
      const job = JSON.parse(event.data) as Job;
      setDetail((prev) => (prev ? { ...prev, job } : prev));
    };
    return () => source.close();
  }, [selected, loadDetail]);

  const control = async (jobId: string, action: 'pause' | 'stop') => {
    await fetch(`/api/jobs/${jobId}/${action}`, { method: 'POST' });
    await loadJobs();
    if (selected === jobId) await loadDetail(jobId);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-800 pb-6 gap-4">
        <div>
          <a href="#" className="text-xs text-slate-500 hover:text-neon-blue flex items-center gap-1 mb-3">
            <ArrowLeft className="w-3 h-3" /> Back to Optimizer
          </a>
          <h1 className="text-3xl md:text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-neon-blue via-neon-purple to-neon-pink">
            JOBS
          </h1>
          <p className="text-slate-400 font-mono text-xs mt-2">
            Live SQLite runs · the CLI writes, this page watches
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadJobs()}
            className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <a
            href="#"
            className="text-xs font-bold text-neon-blue hover:text-white bg-neon-blue/10 border border-neon-blue/40 rounded-lg px-3 py-2"
          >
            Optimizer
          </a>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto mt-4 text-xs text-red-300 bg-red-950/40 border border-red-900 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <main className="max-w-7xl mx-auto mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">New job</h2>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              The Optimizer is the creation surface: paste facts, pick optimization or
              localization, then hit <span className="text-neon-blue">Run as background job</span>.
              It lands here with live progress, items, logs and pause/stop.
            </p>
            <a
              href="#"
              className="mt-3 inline-flex items-center gap-2 bg-neon-purple/20 hover:bg-neon-purple/40 text-neon-purple border border-neon-purple/40 rounded-lg px-3 py-2 text-xs font-bold"
            >
              <Play className="w-3 h-3" /> Open Optimizer
            </a>
          </div>

          {jobs.length === 0 && (
            <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-slate-500">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No jobs yet.</p>
              <p className="text-xs mt-1 font-mono">npm run cli -- book --limit 5</p>
            </div>
          )}

          {jobs.map((job) => (
            <button
              key={job.id}
              onClick={() => setSelected(job.id)}
              className={`w-full text-left bg-slate-900 border rounded-xl p-4 transition-all ${
                selected === job.id
                  ? 'border-neon-blue/60 shadow-[0_0_18px_rgba(0,204,255,0.12)]'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500 font-mono truncate">{job.id}</div>
                  <div className="text-sm font-bold mt-1">
                    {job.source} <span className={`ml-2 ${statusColor(job.status)}`}>{job.status}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono text-neon-green">${job.cost_usd.toFixed(5)}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{progress(job)}%</div>
                </div>
              </div>

              <div className="mt-3 h-1.5 bg-slate-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-blue to-neon-purple transition-all"
                  style={{ width: `${progress(job)}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-slate-500 font-mono">
                <span>
                  {job.done}/{job.total} done · {job.failed} failed · {job.skipped} skipped
                </span>
                <span>{job.effort}</span>
              </div>
            </button>
          ))}
        </section>

        <section className="lg:col-span-7">
          {!detail ? (
            <div className="border border-dashed border-slate-800 rounded-xl p-12 text-center text-slate-500">
              <Terminal className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Select a job to see items and logs.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-slate-500">{detail.job.id}</div>
                    <div className="text-lg font-black mt-1">
                      {detail.job.source}{' '}
                      <span className={statusColor(detail.job.status)}>{detail.job.status}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {detail.job.status === 'running' && (
                      <>
                        <button
                          onClick={() => void control(detail.job.id, 'pause')}
                          className="flex items-center gap-1 text-xs font-bold bg-yellow-500/10 text-yellow-300 border border-yellow-700/50 rounded-lg px-3 py-2"
                        >
                          <Pause className="w-3 h-3" /> Pause
                        </button>
                        <button
                          onClick={() => void control(detail.job.id, 'stop')}
                          className="flex items-center gap-1 text-xs font-bold bg-red-500/10 text-red-300 border border-red-700/50 rounded-lg px-3 py-2"
                        >
                          <Square className="w-3 h-3" /> Stop
                        </button>
                      </>
                    )}
                    {detail.job.status === 'paused' && (
                      <button
                        disabled
                        className="flex items-center gap-1 text-xs font-bold text-slate-500 border border-slate-800 rounded-lg px-3 py-2"
                      >
                        <Play className="w-3 h-3" /> Resume from CLI
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 text-center">
                  {[
                    ['done', detail.job.done],
                    ['pending', detail.job.pending],
                    ['failed', detail.job.failed],
                    ['cost', `$${detail.job.cost_usd.toFixed(5)}`],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-slate-950/60 border border-slate-800 rounded-lg p-2">
                      <div className="text-[10px] uppercase text-slate-500 font-bold">{label}</div>
                      <div className="font-mono text-sm mt-1">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Items ({detail.items.length})
                </h2>
                <div className="max-h-[28rem] overflow-auto space-y-2 font-mono text-[11px]">
                  {detail.items.map((item) => {
                    const candidates = candidatesFor(item);
                    return (
                      <details key={item.id} className="border border-slate-800/70 rounded-lg bg-slate-950/40">
                        <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                          <span className="text-slate-400">{item.source_id ?? item.id.slice(0, 8)}</span>
                          <span className={statusColor(item.status)}>{item.status}</span>
                          <span className="text-slate-600">
                            {candidates.length > 0 ? `${candidates.length} candidate(s)` : (item.error ?? '')}
                          </span>
                        </summary>
                        {candidates.length > 0 && (
                          <div className="px-3 pb-3 space-y-2">
                            {candidates.map((candidate, index) => (
                              <div
                                key={candidate.id ?? index}
                                className="border-l-2 border-neon-purple/40 pl-3 py-1"
                              >
                                <div className="text-slate-200 font-sans text-xs leading-relaxed">
                                  {candidate.statement ?? candidate.fact}
                                </div>
                                <div className="mt-1 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                                  <span className="text-neon-green">answer: {candidate.answer}</span>
                                  <span>{candidate.category}</span>
                                  {candidate.funScore !== undefined && (
                                    <span className="text-neon-blue">fun {candidate.funScore}/10</span>
                                  )}
                                  {candidate.blankScore !== undefined && (
                                    <span>blank {candidate.blankScore}/10</span>
                                  )}
                                  {candidate.difficulty && <span>{candidate.difficulty}</span>}
                                </div>
                                {candidate.lies && candidate.lies.length > 0 && (
                                  <div className="mt-1 text-[10px] text-slate-500">
                                    lies: {candidate.lies.join(' · ')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    );
                  })}
                  {detail.items.length === 0 && <div className="text-slate-600">No items.</div>}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Logs
                </h2>
                <div className="max-h-64 overflow-auto space-y-1 font-mono text-[11px]">
                  {detail.logs.map((log) => (
                    <div key={log.id} className="flex gap-2">
                      <span className="text-slate-600">{log.created_at.slice(11, 19)}</span>
                      <span
                        className={
                          log.level === 'error'
                            ? 'text-red-400'
                            : log.level === 'warn'
                              ? 'text-yellow-400'
                              : 'text-slate-400'
                        }
                      >
                        {log.level}
                      </span>
                      <span className="text-slate-300">{log.message}</span>
                    </div>
                  ))}
                  {detail.logs.length === 0 && <div className="text-slate-600">No logs.</div>}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
