import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Sparkles, RefreshCw, Copy, Layers, Globe, ChevronLeft, ChevronRight, Settings, Download, Trash2, StopCircle, FileText, Zap, CheckSquare, Square, Clock, ListChecks, CheckCircle, Hourglass, Power } from 'lucide-react';
import { AgentLog, AgentResponseLocalization, ProcessedItem, TriviaFact, TokenUsage, SystemMode } from '../core/types';
import { AgentVisualizer } from './components/AgentVisualizer';
import { ResultCard } from './components/ResultCard';

const DEFAULT_INPUT = `[
  {
    "fact": "The inventor of the microwave only received <BLANK> for his discovery.",
    "answer": "$2",
    "category": "Irony",
    "lies": ["A frozen dinner", "Radiation", "A pat on the back", "Third-degree burns", "Nothing"]
  },
  {
    "fact": "In 1386, a pig in France was <BLANK> for animal bestiality.",
    "answer": "Forced to watch his donkey being executed",
    "category": "History",
    "lies": ["Traumatized", "Made to watch", "Psychologically tortured", "Emotionally scarred", "Forced to witness"]
  }
]`;

interface JobItemRow {
  id: string;
  source_id: string | null;
  status: string;
  payload_json: string | null;
  error: string | null;
  updated_at: string;
}

interface JobLogRow {
  id: number;
  item_id: string | null;
  level: string;
  message: string;
  created_at: string;
}

interface JobRunRow {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface JobDetail {
  job: {
    id: string;
    source: string;
    status: string;
    done: number;
    total: number;
    failed: number;
    skipped: number;
    cost_usd: number;
    pending: number;
    processing: number;
  };
  items: JobItemRow[];
  logs: JobLogRow[];
  runs: JobRunRow[];
}

function mapJobItems(detail: JobDetail, mode: SystemMode): ProcessedItem[] {
  return detail.items.map((item) => {
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(item.payload_json ?? '{}') as Record<string, any>;
    } catch {
      payload = {};
    }

    const source = (payload.source ?? payload.section ?? payload) as Record<string, any>;
    const original: TriviaFact =
      detail.job.source === 'input' && typeof source.fact === 'string'
        ? {
            fact: source.fact,
            answer: typeof source.answer === 'string' ? source.answer : '',
            category: typeof source.category === 'string' ? source.category : 'General',
            lies: Array.isArray(source.lies) ? source.lies : [],
          }
        : {
            fact: typeof source.heading === 'string' ? source.heading : 'Book section',
            answer: '',
            category: 'Book',
            lies: [],
          };

    const candidate = Array.isArray(payload.candidates) ? payload.candidates[0] : null;
    const optimized: TriviaFact | null = candidate
      ? {
          fact: candidate.fact ?? candidate.statement ?? '',
          answer: candidate.answer ?? '',
          category: candidate.category ?? 'General',
          lies: Array.isArray(candidate.lies) ? candidate.lies : [],
        }
      : null;

    const logs: AgentLog[] = detail.logs
      .filter((log) => log.item_id === item.id)
      .slice()
      .reverse()
      .map((log) => ({
        id: String(log.id),
        agentName: 'Job',
        action: log.message,
        status: log.level === 'error' ? 'failed' : 'success',
        timestamp: Date.parse(log.created_at),
      }));

    const status: ProcessedItem['status'] =
      item.status === 'done'
        ? 'completed'
        : item.status === 'processing'
          ? 'processing'
          : item.status === 'pending'
            ? 'pending'
            : 'failed';

    return {
      id: item.id,
      timestamp: Date.parse(item.updated_at) || Date.now(),
      mode,
      original,
      optimized,
      score: candidate?.blankScore ?? candidate?.funScore ?? null,
      status,
      currentStep: item.status === 'processing' ? 'Background job working...' : undefined,
      triageDecision: candidate ? 'JOB' : undefined,
      logs,
      tokenStats: candidate?.usage,
      error: item.error ?? undefined,
      reviewed: false,
      pendingAction: 'DEFAULT',
    };
  });
}

const ITEMS_PER_PAGE = 10;
const AVG_PROCESSING_TIME = 8000; // ms
const STORAGE_KEY = 'cheeky_trivia_app_state_v1';

function App() {
  // Load initial state lazily once
  const [initialState] = useState(() => {
    try {
        const item = localStorage.getItem(STORAGE_KEY);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.error("Failed to load local storage", e);
        return null;
    }
  });

  const [inputText, setInputText] = useState(initialState?.inputText || DEFAULT_INPUT);
  const [language, setLanguage] = useState(initialState?.language || "Greek");
  const [systemMode, setSystemMode] = useState<SystemMode>(initialState?.systemMode || 'OPTIMIZATION');
  const [isProcessing, setIsProcessing] = useState(false); // Always start paused on reload
  const [logs, setLogs] = useState<AgentLog[]>([]);
  
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);

  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'processing' | 'ready'>(initialState?.activeTab === 'processing' ? 'processing' : 'ready');
  
  // Settings
  const [maxCost, setMaxCost] = useState(initialState?.maxCost || 1);
  const [effort, setEffort] = useState<'low' | 'high' | 'max'>(initialState?.effort || 'high');
  const [concurrency, setConcurrency] = useState(initialState?.concurrency || 5);
  const [totalTokenUsage, setTotalTokenUsage] = useState<{ count: number; cost: number }>({
    count: 0,
    cost: 0,
  });
  const [activeJobId, setActiveJobId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('architect_active_job');
    } catch {
      return null;
    }
  });
  const [jobInfo, setJobInfo] = useState<JobDetail['job'] | null>(null);

  // --------------------------------------------------------
  // PERSISTENCE
  // --------------------------------------------------------
  useEffect(() => {
    const stateToSave = {
        inputText,
        language,
        systemMode,
        maxCost,
        effort,
        concurrency,
        activeTab
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
        console.error("Failed to save state to local storage", e);
    }
  }, [inputText, language, systemMode, maxCost, effort, concurrency, activeTab]);

  const handleClearSession = () => {
      if (window.confirm("Are you sure you want to clear the entire session? This will delete all logs and items permanently.")) {
          setProcessedItems([]);
          setLogs([]);
          setTotalTokenUsage({ count: 0, cost: 0 });
          setIsProcessing(false);
          localStorage.removeItem(STORAGE_KEY);
      }
  };

  // --------------------------------------------------------
  // BACKGROUND JOB POLLER
  // --------------------------------------------------------
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setActiveTab('processing');

    const load = async () => {
      try {
        const response = await fetch(`/api/jobs/${activeJobId}?limit=1000`);
        if (!response.ok) return;
        const detail = (await response.json()) as JobDetail;
        if (cancelled) return;

        setJobInfo(detail.job);
        setProcessedItems(mapJobItems(detail, systemMode));
        setLogs(
          detail.logs
            .slice()
            .reverse()
            .map((log) => ({
              id: String(log.id),
              agentName: 'Job',
              action: log.message,
              status: log.level === 'error' ? 'failed' : 'success',
              timestamp: Date.parse(log.created_at),
            })),
        );
        setTotalTokenUsage({
          count: detail.runs.reduce(
            (sum, run) => sum + (run.prompt_tokens ?? 0) + (run.completion_tokens ?? 0),
            0,
          ),
          cost: detail.job.cost_usd,
        });

        const terminal = ['done', 'paused', 'stopped', 'failed'].includes(detail.job.status);
        if (terminal) {
          setIsProcessing(false);
          if (detail.job.status === 'done') setActiveTab('ready');
          if (timer) clearInterval(timer);
        } else {
          setIsProcessing(true);
        }
      } catch {
        // Keep the last known state; the next poll retries.
      }
    };

    void load();
    timer = setInterval(() => void load(), 2_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [activeJobId, systemMode]);

  // --------------------------------------------------------
  // INITIALIZER
  // --------------------------------------------------------
  const handleRunAsJob = async () => {
    try {
      const input = JSON.parse(inputText) as unknown;
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          mode: systemMode === 'LOCALIZATION' ? 'localization' : 'optimization',
          language,
          effort,
          maxCost,
          concurrency,
        }),
      });
      const data = (await response.json()) as { job?: { id: string }; error?: string };
      if (!response.ok || !data.job) {
        throw new Error(data.error ?? `Failed to create job (${response.status})`);
      }
      setActiveJobId(data.job.id);
      setJobInfo(null);
      setProcessedItems([]);
      setLogs([]);
      setActiveTab('processing');
      setIsProcessing(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStop = async () => {
    if (!activeJobId) return;
    await fetch(`/api/jobs/${activeJobId}/stop`, { method: 'POST' });
  };

  const handleStartJob = async () => handleRunAsJob();

  // --------------------------------------------------------
  // UTILS & EXPORTS
  // --------------------------------------------------------
  const generateRawOutput = () => {
    const validItems = processedItems
        .filter(p => p.status === 'completed' && p.optimized)
        .map(p => p.optimized!);
    const escape = (str: string) => str.replace(/"/g, '\\"');
    const objects = validItems.map(data => `  {
    fact: "${escape(data.fact)}",
    answer: "${escape(data.answer)}",
    category: "${escape(data.category)}",
    lies: [${data.lies.map(l => `"${escape(l)}"`).join(", ")}]
  }`);
    return objects.join(",\n");
  };

  const exportJsonSession = () => {
     const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(processedItems, null, 2));
     const downloadAnchorNode = document.createElement('a');
     downloadAnchorNode.setAttribute("href", dataStr);
     downloadAnchorNode.setAttribute("download", `trivia_session_${Date.now()}.json`);
     document.body.appendChild(downloadAnchorNode);
     downloadAnchorNode.click();
     downloadAnchorNode.remove();
  };

  const exportRawSession = () => {
    const text = generateRawOutput();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", url);
    downloadAnchorNode.setAttribute("download", `trivia_raw_${Date.now()}.txt`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    const output = generateRawOutput();
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --------------------------------------------------------
  // RENDER LOGIC
  // --------------------------------------------------------

  // Filter based on Tab
  const tabItems = processedItems.filter(item => {
      if (activeTab === 'processing') {
          return item.status === 'pending' || item.status === 'processing';
      }
      return item.status === 'completed' || item.status === 'failed';
  });

  // Sort by Timestamp (FIFO)
  tabItems.sort((a, b) => a.timestamp - b.timestamp);

  // Pagination for current tab
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentDisplayItems = tabItems.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(tabItems.length / ITEMS_PER_PAGE);

  // Estimation Logic
  const getEstimatedWaitTime = () => {
      const queueCount = processedItems.filter(p => p.status === 'pending').length;
      if (queueCount === 0) return null;
      const ms = queueCount * AVG_PROCESSING_TIME / concurrency;
      return Math.ceil(ms / 1000);
  };
  const waitTime = getEstimatedWaitTime();

  useEffect(() => {
      setCurrentPage(1);
  }, [activeTab]);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center gap-8 max-w-[1600px] mx-auto">
      
      {/* Header */}
      <header className="w-full flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-800 pb-6 gap-6">
        <div>
            <h1 className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-neon-purple via-neon-pink to-neon-blue tracking-tighter">
            CHEEKY TRIVIA ARCHITECT
            </h1>
            <p className="text-slate-400 font-mono text-sm mt-2 flex items-center gap-2">
            Multi-Agent Batch Optimization System
            </p>
            <a
              href="#jobs"
              className="inline-flex items-center gap-1 text-xs font-bold text-neon-blue hover:text-white mt-3"
            >
              Jobs dashboard →
            </a>
        </div>

        {/* MODE SWITCHER */}
        <div className="bg-slate-900 border border-slate-800 p-1 rounded-lg flex gap-1">
             <button
                onClick={() => setSystemMode('OPTIMIZATION')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition-all ${
                    systemMode === 'OPTIMIZATION' 
                    ? 'bg-neon-purple text-white shadow-lg shadow-neon-purple/20' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
             >
                <Sparkles className="w-4 h-4" />
                Creative Optimization
             </button>
             <button
                onClick={() => setSystemMode('LOCALIZATION')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-bold transition-all ${
                    systemMode === 'LOCALIZATION' 
                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
             >
                <Globe className="w-4 h-4" />
                Localization Engine
             </button>
        </div>

        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
                <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Total Tokens</div>
                    <div className="font-mono font-bold text-neon-blue">
                        {totalTokenUsage.count.toLocaleString()}
                    </div>
                </div>
                <div className="h-8 w-px bg-slate-800"></div>
                <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Est. Cost</div>
                    <div className="font-mono text-neon-green font-bold">
                        ${totalTokenUsage.cost.toFixed(4)}
                    </div>
                </div>
            </div>
            <button 
                onClick={() => setShowSettings(!showSettings)}
                className="text-slate-500 hover:text-white flex items-center gap-1 text-xs transition-colors"
            >
                <Settings className="w-3 h-3" /> Settings
            </button>
        </div>
      </header>

      {activeJobId && (
        <div data-testid="job-banner" className="w-full bg-slate-900 border border-neon-blue/30 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-mono text-slate-300">
            Background job <span className="text-neon-blue">{activeJobId.slice(0, 8)}</span>
            {jobInfo && (
              <>
                {' '}· {jobInfo.status} · {jobInfo.done}/{jobInfo.total} · ${jobInfo.cost_usd.toFixed(5)}
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <a href="#jobs" className="text-xs font-bold text-neon-blue hover:text-white">
              Open in Jobs →
            </a>
            <button
              onClick={() => {
                setActiveJobId(null);
                setJobInfo(null);
                setIsProcessing(false);
              }}
              className="text-[10px] text-slate-500 hover:text-white"
            >
              detach
            </button>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
          <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-6 animate-in slide-in-from-top-2">
              <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Global Settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Max cost (USD)</label>
                          <input 
                            type="number" 
                            min={0.01}
                            step={0.01}
                            value={maxCost}
                            onChange={(e) => setMaxCost(Number(e.target.value))}
                            className="bg-slate-950 border border-slate-700 rounded p-2 text-white w-full focus:border-neon-purple outline-none"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">The CLI pauses the job before the next item when it exceeds this.</p>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Thinking effort</label>
                          <select
                            value={effort}
                            onChange={(e) => setEffort(e.target.value as typeof effort)}
                            className="bg-slate-950 border border-slate-700 rounded p-2 text-white w-full focus:border-neon-purple outline-none"
                          >
                            <option value="low">low</option>
                            <option value="high">high</option>
                            <option value="max">max</option>
                          </select>
                          <p className="text-[10px] text-slate-500 mt-1">DeepSeek Flash effort; high is the creative default.</p>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                            <Zap className="w-3 h-3 text-neon-yellow" /> 
                            Concurrency Limit
                          </label>
                          <div className="flex items-center gap-4">
                            <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                value={concurrency}
                                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                                className="flex-1 accent-neon-purple h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="font-mono text-neon-blue font-bold w-8 text-center">{concurrency}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">Number of items processed simultaneously (1-10).</p>
                      </div>
                  </div>
                  <div className="flex items-end gap-2 flex-wrap content-end">
                     <button 
                        onClick={handleClearSession} 
                        className="bg-red-900/20 hover:bg-red-900/50 text-red-500 border border-red-900/50 px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                     >
                        <Trash2 className="w-3 h-3" /> Clear Session
                     </button>
                     <button 
                        onClick={exportJsonSession} 
                        className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                     >
                        <Download className="w-3 h-3" /> Export Session JSON
                     </button>
                     <button 
                        onClick={exportRawSession} 
                        className="bg-neon-purple/20 hover:bg-neon-purple/40 text-neon-purple border border-neon-purple/50 px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                     >
                        <FileText className="w-3 h-3" /> Download Raw Text
                     </button>
                  </div>
              </div>
          </div>
      )}

      {/* Main Content Grid */}
      <main className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Input & Controls */}
        <section className="lg:col-span-4 space-y-6 flex flex-col h-full">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col gap-4">
            
            {/* Language Selector */}
            <div>
                 <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Globe className="w-3 h-3" /> Target Language
                 </label>
                 <input 
                    type="text" 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className={`w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-bold outline-none ${
                        systemMode === 'LOCALIZATION' ? 'focus:border-orange-500 border-orange-900/50 text-orange-100' : 'focus:border-neon-purple'
                    }`}
                    placeholder="e.g. English, Spanish, Greek..."
                 />
            </div>

            <div className="flex justify-between items-center">
               <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                 <Layers className="w-3 h-3" /> Input Data
               </label>
               <button 
                onClick={() => setInputText(DEFAULT_INPUT)}
                className="text-xs text-neon-blue hover:text-white transition-colors flex items-center gap-1"
               >
                 <RefreshCw className="w-3 h-3" /> Load Example
               </button>
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full h-64 bg-slate-950 border border-slate-700 rounded-lg p-4 font-mono text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-opacity-50 resize-none focus:ring-slate-600"
              placeholder='Paste JSON array or raw list of facts...'
            />
            
            {isProcessing ? (
                <button
                    onClick={() => void handleStop()}
                    className="w-full bg-red-900/80 hover:bg-red-800 text-white font-bold py-3 px-6 rounded-lg transition-all flex items-center justify-center gap-2"
                >
                    <StopCircle className="w-5 h-5" /> Stop Processing
                </button>
            ) : (
                <button
                    onClick={handleStartJob}
                    disabled={isProcessing}
                    className={`w-full font-bold py-3 px-6 rounded-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-white ${
                        systemMode === 'LOCALIZATION' 
                        ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500' 
                        : 'bg-gradient-to-r from-neon-purple to-neon-blue hover:from-purple-500 hover:to-blue-500'
                    }`}
                >
                    {systemMode === 'LOCALIZATION' ? <Globe className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                    {isProcessing ? 'Job Running...' : 'Start background job'}
                </button>
            )}

          </div>

          <AgentVisualizer logs={logs} />
        </section>

        {/* Right Column: Results List */}
        <section className="lg:col-span-8 flex flex-col gap-6">
           
           {/* Actions Bar & Stats */}
           <div className="flex flex-col gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-800">
              
              {/* TABS */}
              <div className="flex items-center gap-4 border-b border-slate-800 pb-2 mb-2 overflow-x-auto">
                 <button 
                    onClick={() => setActiveTab('processing')}
                    className={`text-sm font-bold pb-2 px-3 whitespace-nowrap transition-all relative flex items-center gap-2 ${activeTab === 'processing' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                    <Clock className="w-4 h-4" />
                    Processing ({processedItems.filter(p => p.status === 'pending' || p.status === 'processing').length})
                    {activeTab === 'processing' && <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-neon-purple shadow-[0_0_8px_rgba(176,38,255,0.8)]"></div>}
                 </button>
                 <button 
                    onClick={() => setActiveTab('ready')}
                    className={`text-sm font-bold pb-2 px-3 whitespace-nowrap transition-all relative flex items-center gap-2 ${activeTab === 'ready' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                    <ListChecks className="w-4 h-4" />
                    Results ({processedItems.filter(p => !p.reviewed && (p.status === 'completed' || p.status === 'failed')).length})
                    {activeTab === 'ready' && <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-neon-blue shadow-[0_0_8px_rgba(0,204,255,0.8)]"></div>}
                 </button>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-slate-400 text-sm font-mono flex items-center gap-4">
                    <span>
                        Showing {tabItems.length > 0 ? indexOfFirstItem + 1 : 0}-{Math.min(indexOfLastItem, tabItems.length)} of {tabItems.length}
                    </span>
                    {activeTab === 'ready' && waitTime !== null && waitTime > 0 && (
                        <span className="flex items-center gap-2 text-neon-blue bg-neon-blue/10 px-2 py-0.5 rounded text-xs animate-pulse">
                            <Hourglass className="w-3 h-3" />
                            Next item ~{waitTime}s
                        </span>
                    )}
                </div>
                
                <div className="flex items-center gap-4">
                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center gap-2 bg-slate-950 rounded-lg border border-slate-800 p-1">
                            <button 
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="p-1 hover:bg-slate-800 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <span className="text-xs font-mono text-slate-400 px-2">
                                {currentPage} / {totalPages}
                            </span>
                            <button 
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="p-1 hover:bg-slate-800 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    {processedItems.some(p => p.status === 'completed') && (
                        <button 
                            onClick={copyToClipboard}
                            className="flex items-center gap-2 bg-neon-green/10 text-neon-green border border-neon-green/50 hover:bg-neon-green hover:text-black font-bold py-2 px-4 rounded transition-all text-sm"
                        >
                            {copied ? 'Copied!' : 'Copy All Raw'}
                            <Copy className="w-4 h-4" />
                        </button>
                    )}
                </div>
              </div>
           </div>

          <div className="space-y-6">
            {tabItems.length === 0 && (
                <div className="flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl min-h-[400px]">
                    <Layers className="w-12 h-12 mb-4 opacity-50" />
                    <p className="text-lg">No items in {activeTab === 'processing' ? 'Processing' : 'Results'}</p>
                    <p className="text-sm opacity-60">
                        {activeTab === 'processing' ? 'Start a background job to see progress.' : 'No results yet.'}
                    </p>
                </div>
            )}

            {currentDisplayItems.map((item) => (
                <ResultCard 
                    key={item.id}
                    item={item}
                    readOnly
                    onUpdate={() => {}}
                    onToggleReview={() => {}}
                    onReprocessWithFeedback={() => {}}
                    onRegenerateLies={() => {}}
                    onRevert={() => {}}
                    onDiscard={() => {}}
                />
            ))}
          </div>

        </section>
      </main>
    </div>
  );
}

export default App;