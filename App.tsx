import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Sparkles, RefreshCw, Copy, Layers, Globe, ChevronLeft, ChevronRight, Settings, Download, Trash2, StopCircle, FileText, Zap, CheckSquare, Square, Clock, ListChecks, CheckCircle, Hourglass } from 'lucide-react';
import { AgentLog, ProcessedItem, TriviaFact, TokenUsage } from './types';
import { AgentVisualizer } from './components/AgentVisualizer';
import { ResultCard } from './components/ResultCard';
import * as AgentService from './services/geminiService';

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

const ITEMS_PER_PAGE = 10;
const AVG_PROCESSING_TIME = 8000; // ms

// Simple success sound using Web Audio API
const playSuccessSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        // A pleasant "ding" sound
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1); // C6
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
        console.error("Audio play failed", e);
    }
};

function App() {
  const [inputText, setInputText] = useState(DEFAULT_INPUT);
  const [language, setLanguage] = useState("English");
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<AgentLog[]>([]); // Global logs
  const [processedItems, setProcessedItems] = useState<ProcessedItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'processing' | 'ready' | 'reviewed'>('ready');
  
  // Settings
  const [tokenLimit, setTokenLimit] = useState(100000);
  const [concurrency, setConcurrency] = useState(5);
  const [totalTokenUsage, setTotalTokenUsage] = useState({ count: 0, cost: 0 });
  const [shouldStop, setShouldStop] = useState(false);

  // --------------------------------------------------------
  // LOGGING UTILS
  // --------------------------------------------------------
  const addLog = (
      agentName: string, 
      action: string, 
      status: AgentLog['status'], 
      details?: string, 
      itemIdToUpdate?: string
  ): string => {
    const id = Math.random().toString(36).substr(2, 9);
    const newLog: AgentLog = {
      id,
      agentName,
      action,
      status,
      details,
      timestamp: Date.now()
    };

    setLogs(prev => [...prev, newLog]);

    if (itemIdToUpdate) {
        setProcessedItems(prev => prev.map(item => {
            if (item.id === itemIdToUpdate) {
                return { ...item, logs: [...item.logs, newLog] };
            }
            return item;
        }));
    }
    return id;
  };

  const updateLog = (logId: string, status: AgentLog['status'], details?: string, itemIdToUpdate?: string) => {
    setLogs(prev => prev.map(log => 
      log.id === logId ? { ...log, status, details: details || log.details } : log
    ));
    if (itemIdToUpdate) {
        setProcessedItems(prev => prev.map(item => {
            if (item.id === itemIdToUpdate) {
                return {
                    ...item,
                    logs: item.logs.map(log => 
                         log.id === logId ? { ...log, status, details: details || log.details } : log
                    )
                };
            }
            return item;
        }));
    }
  };

  // --------------------------------------------------------
  // WORKER LOGIC
  // --------------------------------------------------------
  const processItemWorker = async (itemId: string, itemOriginal: TriviaFact, actionType: string = 'DEFAULT', feedback: string = '', currentOptimized: TriviaFact | null = null, existingTokenStats: TokenUsage | undefined = undefined) => {
    // Initialize with existing stats if any (Accumulation logic)
    let itemTokenUsage: TokenUsage = existingTokenStats ? { ...existingTokenStats } : { promptTokens: 0, candidatesTokens: 0, totalTokens: 0, estimatedCost: 0 };
    
    const trackUsage = (usage: TokenUsage) => {
       itemTokenUsage.promptTokens += usage.promptTokens;
       itemTokenUsage.candidatesTokens += usage.candidatesTokens;
       itemTokenUsage.totalTokens += usage.totalTokens;
       itemTokenUsage.estimatedCost += usage.estimatedCost;
       
       setTotalTokenUsage(prev => ({
           count: prev.count + usage.totalTokens,
           cost: prev.cost + usage.estimatedCost
       }));
    };

    // Update item status
    const updateItemState = (updater: (p: ProcessedItem) => ProcessedItem) => {
        setProcessedItems(prev => prev.map(p => p.id === itemId ? updater(p) : p));
    };

    try {
      if (shouldStop) throw new Error("Stopped by user");
      if (totalTokenUsage.count > tokenLimit) throw new Error("Token limit exceeded");

      // Default State
      let currentFactString = itemOriginal.fact;
      let currentAnswer = itemOriginal.answer;
      let finalScore = 0;
      let needsLies = true;
      let triageAction = 'FULL_OPTIMIZE';

      // --- LOGIC BRANCHING ---

      if (actionType === 'REGENERATE_LIES' && currentOptimized) {
          addLog(`Worker`, `Regenerating lies only...`, "working", undefined, itemId);
          currentFactString = currentOptimized.fact;
          currentAnswer = currentOptimized.answer;
          triageAction = 'GENERATE_LIES'; // Skip architect
          finalScore = 0; // Will not score fact again
      } 
      else if (actionType === 'REPROCESS_WITH_FEEDBACK') {
          addLog(`Worker`, `Reprocessing with user feedback...`, "working", undefined, itemId);
          addLog(`System`, `User Guidance: "${feedback}"`, "working", undefined, itemId);
          // Force Full Optimization flow, but inject feedback
          triageAction = 'FULL_OPTIMIZE';
      }
      else {
          addLog(`Worker`, `Starting standard process...`, "working", undefined, itemId);
          // --- STANDARD TRIAGE ---
          updateItemState(p => ({ ...p, currentStep: "Triage: Analyzing..." }));
          const triageLogId = addLog(`Triage`, "Analyzing...", "working", undefined, itemId);
          
          const triageResult = await AgentService.triageFact(itemOriginal, language);
          trackUsage(triageResult.usage);
          triageAction = triageResult.data.action;
          
          updateLog(triageLogId, "success", `Decision: ${triageAction}`, itemId);
          updateItemState(p => ({ ...p, triageDecision: triageAction, tokenStats: itemTokenUsage }));
      }

      // --- EXECUTION ---

      if (triageAction === 'KEEP_ALL' && actionType === 'DEFAULT') {
          const result = { 
              optimized: { ...itemOriginal }, 
              score: 10, 
              status: 'completed' as const, 
              logs: [],
              tokenStats: itemTokenUsage 
          };
          updateItemState(p => ({ ...p, ...result }));
          addLog(`System`, `Item Perfect - Skipped.`, "success", undefined, itemId);
          return;
      }

      // --- ARCHITECT & CRITIC LOOP ---
      if (triageAction === 'FULL_OPTIMIZE') {
          let placementApproved = false;
          let attempts = 0;
          const MAX_ATTEMPTS = 3;
          const attemptedPhrases: string[] = [];
          
          // Inject user feedback as starting feedback if reprocessing
          let currentFeedback = actionType === 'REPROCESS_WITH_FEEDBACK' ? feedback : "";

          while (!placementApproved && attempts < MAX_ATTEMPTS) {
            if (shouldStop) throw new Error("Stopped by user");
            attempts++;
            
            updateItemState(p => ({ ...p, currentStep: `Architect: Optimization ${attempts}...` }));
            const archLogId = addLog(`Architect`, `Attempt ${attempts}...`, "working", undefined, itemId);

            const archResult = await AgentService.optimizePlacement(
                { ...itemOriginal, fact: currentFactString, answer: currentAnswer }, 
                attemptedPhrases, 
                currentFeedback,
                language
            );
            trackUsage(archResult.usage);
            updateLog(archLogId, "success", undefined, itemId);
            updateItemState(p => ({ ...p, tokenStats: itemTokenUsage }));

            const { newFact, newAnswer } = archResult.data;
            attemptedPhrases.push(newFact);

            updateItemState(p => ({ ...p, currentStep: `Critic: Scoring ${attempts}...` }));
            const criticLogId = addLog(`Critic`, `Scoring ${attempts}...`, "working", undefined, itemId);
            
            const critiqueResult = await AgentService.critiquePlacement(newFact, newAnswer, language);
            trackUsage(critiqueResult.usage);
            finalScore = critiqueResult.data.score;
            updateItemState(p => ({ ...p, tokenStats: itemTokenUsage }));

            const fullFeedbackMsg = `Score: ${critiqueResult.data.score}\nFeedback: ${critiqueResult.data.feedback || "None"}`;

            if (critiqueResult.data.score >= 7) {
              placementApproved = true;
              currentFactString = newFact;
              currentAnswer = newAnswer;
              updateLog(criticLogId, "success", `Approved! ${fullFeedbackMsg}`, itemId);
            } else {
               currentFeedback = critiqueResult.data.feedback || "";
               
               if (attempts === MAX_ATTEMPTS) {
                   currentFactString = newFact;
                   currentAnswer = newAnswer;
                   updateLog(criticLogId, "pending", `Max attempts reached. ${fullFeedbackMsg}`, itemId);
               } else {
                   updateLog(criticLogId, "retry", `Retrying... ${fullFeedbackMsg}`, itemId);
               }
            }
          }
      }

      // --- GENERATOR (Idea Factory) ---
      updateItemState(p => ({ ...p, currentStep: "Generator: Brainstorming..." }));
      const genLogId = addLog(`Generator`, `Creating 8 raw options...`, "working", undefined, itemId);
      
      const genResult = await AgentService.generateRawLies(currentFactString, currentAnswer, itemOriginal.category, language);
      trackUsage(genResult.usage);
      
      const rawLiesList = genResult.data.rawLies.map((l, i) => `${i+1}. ${l}`).join("\n");
      updateLog(genLogId, "success", `Created ${genResult.data.rawLies.length} options:\n${rawLiesList}`, itemId);
      
      updateItemState(p => ({ ...p, tokenStats: itemTokenUsage }));

      // --- EDITOR (The Trimmer) ---
      updateItemState(p => ({ ...p, currentStep: "Editor: Trimming..." }));
      const editLogId = addLog(`Editor`, `Refining to top 5 (<20 chars)...`, "working", undefined, itemId);

      const editResult = await AgentService.refineLies(currentFactString, genResult.data.rawLies, language);
      trackUsage(editResult.usage);
      updateLog(editLogId, "success", undefined, itemId);
      updateItemState(p => ({ ...p, tokenStats: itemTokenUsage }));
      
      const optimizedResult: TriviaFact = {
        ...itemOriginal,
        fact: currentFactString,
        answer: currentAnswer,
        lies: editResult.data.fixedLies
      };

      updateItemState(p => ({ 
          ...p, 
          optimized: optimizedResult, 
          score: finalScore || 8, 
          status: 'completed',
          tokenStats: itemTokenUsage,
          // Clear flags
          pendingAction: undefined,
          userFeedback: undefined,
          // Update timestamp only if it was a specific user action (reprocess/regenerate)
          // This moves the item to the end of the FIFO list (treating it as "newly ready")
          timestamp: actionType !== 'DEFAULT' ? Date.now() : p.timestamp
      }));
      addLog(`System`, `Item Complete.`, "success", undefined, itemId);
      
    } catch (error: any) {
      console.error(error);
      updateItemState(p => ({ 
          ...p, 
          status: 'failed', 
          error: error.message, 
          currentStep: 'Failed',
          tokenStats: itemTokenUsage,
          timestamp: actionType !== 'DEFAULT' ? Date.now() : p.timestamp
      }));
      addLog(`Error`, error.message, "failed", undefined, itemId);
    }
  };

  // --------------------------------------------------------
  // QUEUE MANAGER (The Conductor)
  // --------------------------------------------------------
  useEffect(() => {
      if (!isProcessing || shouldStop) return;

      const activeCount = processedItems.filter(p => p.status === 'processing').length;
      const pendingItem = processedItems.find(p => p.status === 'pending');

      if (totalTokenUsage.count > tokenLimit) {
        setShouldStop(true);
        alert("Token limit reached. Stopping queue.");
        return;
      }

      if (activeCount < concurrency && pendingItem) {
          // Start the pending item
          setProcessedItems(prev => prev.map(p => p.id === pendingItem.id ? { ...p, status: 'processing' } : p));
          
          // Trigger the async worker with context from the item state
          processItemWorker(
              pendingItem.id, 
              pendingItem.original, 
              pendingItem.pendingAction || 'DEFAULT', 
              pendingItem.userFeedback || '', 
              pendingItem.optimized,
              pendingItem.tokenStats // Pass existing stats for accumulation
          );
      } else if (activeCount === 0 && !pendingItem && processedItems.length > 0 && processedItems.some(p => p.status === 'processing')) {
          // All done (check if we just finished to play sound)
          // Simple check: we are isProcessing, but nothing is active or pending.
          setIsProcessing(false);
          playSuccessSound();
      } else if (activeCount === 0 && !pendingItem && processedItems.length > 0 && isProcessing) {
          // Fallback cleanup
           setIsProcessing(false);
           playSuccessSound();
      }
  }, [processedItems, concurrency, isProcessing, shouldStop, totalTokenUsage, tokenLimit]);


  // --------------------------------------------------------
  // INITIALIZER
  // --------------------------------------------------------
  const handleStartQueue = async () => {
    if (!process.env.API_KEY) {
      alert("Please set the API_KEY environment variable.");
      return;
    }

    setShouldStop(false);
    setIsProcessing(true);
    setLogs([]);
    setActiveTab('processing');
    
    try {
      const parseLogId = addLog("Parser", "Parsing input...", "working");
      const newFacts = await AgentService.parseRawInput(inputText);
      
      const queueItems: ProcessedItem[] = newFacts.map((fact, index) => ({
          id: Math.random().toString(36).substr(2, 9),
          timestamp: Date.now() + index, // Ensure unique and ordered timestamp
          original: fact,
          optimized: null,
          score: null,
          status: 'pending',
          currentStep: 'Waiting in queue...',
          logs: [],
          triageDecision: undefined,
          tokenStats: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0, estimatedCost: 0 },
          pendingAction: 'DEFAULT'
      }));

      if (queueItems.length === 0) {
        updateLog(parseLogId, "success", "No items found.");
        setIsProcessing(false);
        return;
      }

      updateLog(parseLogId, "success", `Added ${queueItems.length} items to queue.`);
      setProcessedItems(prev => [...prev, ...queueItems]);

    } catch (error: any) {
      addLog("System", "Parse Error", "failed", error.message);
      setIsProcessing(false);
    }
  };

  // --------------------------------------------------------
  // UTILS & EXPORTS
  // --------------------------------------------------------
  const handleItemUpdate = (id: string, newFact: TriviaFact) => {
    setProcessedItems(prev => prev.map(item => 
        item.id === id ? { ...item, optimized: newFact } : item
    ));
  };

  const handleToggleReview = (id: string) => {
    setProcessedItems(prev => prev.map(item => 
        item.id === id ? { ...item, reviewed: !item.reviewed } : item
    ));
  };

  const handleReprocessWithFeedback = (id: string, feedback: string) => {
     setProcessedItems(prev => prev.map(item => {
        if (item.id === id) {
            return {
                ...item,
                status: 'pending',
                logs: [], // Clear logs for new run
                currentStep: 'Queued for optimization...',
                reviewed: false,
                pendingAction: 'REPROCESS_WITH_FEEDBACK',
                userFeedback: feedback,
                triageDecision: 'FULL_OPTIMIZE', // Set decision immediately for UI feedback
                // Update Original to be the current optimized state (user accepted baseline)
                original: item.optimized ? { ...item.optimized } : item.original
            };
        }
        return item;
    }));
    // Do NOT change active tab automatically
    setIsProcessing(true);
    setShouldStop(false);
  };

  const handleRegenerateLies = (id: string) => {
      setProcessedItems(prev => prev.map(item => {
        if (item.id === id) {
            return {
                ...item,
                status: 'pending',
                currentStep: 'Queued for lies...',
                reviewed: false,
                pendingAction: 'REGENERATE_LIES',
                logs: [], 
                triageDecision: 'GENERATE_LIES', // Set decision immediately for UI feedback
                // Update Original to be the current optimized state
                original: item.optimized ? { ...item.optimized } : item.original
            };
        }
        return item;
    }));
    // Do NOT change active tab automatically
    setIsProcessing(true);
    setShouldStop(false);
  };

  const handleRevert = (id: string) => {
    setProcessedItems(prev => prev.map(item => {
        if (item.id === id) {
            return {
                ...item,
                status: 'completed',
                optimized: { ...item.original }, // Deep copy
                score: null,
                triageDecision: 'KEEP_ALL',
                currentStep: 'Reverted to original',
                reviewed: false,
                pendingAction: 'DEFAULT'
            };
        }
        return item;
    }));
  };

  const handleDiscard = (id: string) => {
      setProcessedItems(prev => prev.filter(item => item.id !== id));
  };

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
      if (activeTab === 'reviewed') {
          return item.reviewed;
      }
      if (activeTab === 'processing') {
          return item.status === 'pending' || item.status === 'processing';
      }
      if (activeTab === 'ready') {
          // Ready for Review includes ONLY Completed or Failed items that are NOT currently processing.
          // This ensures processing items (even if they were once ready) are strictly shown in the queue tab.
          return !item.reviewed && (item.status === 'completed' || item.status === 'failed');
      }
      return false;
  });

  // Sort by Timestamp (FIFO)
  tabItems.sort((a, b) => a.timestamp - b.timestamp);

  // Pagination for current tab
  const indexOfLastItem = currentPage * ITEMS_PER_PAGE;
  const indexOfFirstItem = indexOfLastItem - ITEMS_PER_PAGE;
  const currentDisplayItems = tabItems.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(tabItems.length / ITEMS_PER_PAGE);

  // Estimation Logic for Ready Tab
  const getEstimatedWaitTime = () => {
      const queueCount = processedItems.filter(p => p.status === 'pending').length;
      if (queueCount === 0) return null;
      // Simple heuristic: X seconds per item
      const ms = queueCount * AVG_PROCESSING_TIME / concurrency;
      return Math.ceil(ms / 1000);
  };
  const waitTime = getEstimatedWaitTime();

  // Reset page when tab changes
  useEffect(() => {
      setCurrentPage(1);
  }, [activeTab]);

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center gap-8 max-w-[1600px] mx-auto">
      
      {/* Header */}
      <header className="w-full flex justify-between items-end border-b border-slate-800 pb-6">
        <div>
            <h1 className="text-4xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-neon-purple via-neon-pink to-neon-blue tracking-tighter">
            CHEEKY TRIVIA ARCHITECT
            </h1>
            <p className="text-slate-400 font-mono text-sm mt-2">
            Multi-Agent Batch Optimization System
            </p>
        </div>
        <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-4 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
                <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Total Tokens</div>
                    <div className={`font-mono font-bold ${totalTokenUsage.count > tokenLimit ? 'text-red-500' : 'text-neon-blue'}`}>
                        {totalTokenUsage.count.toLocaleString()} / {tokenLimit.toLocaleString()}
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

      {/* Settings Panel */}
      {showSettings && (
          <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-6 animate-in slide-in-from-top-2">
              <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Global Settings
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Safety Token Limit</label>
                          <input 
                            type="number" 
                            value={tokenLimit}
                            onChange={(e) => setTokenLimit(parseInt(e.target.value))}
                            className="bg-slate-950 border border-slate-700 rounded p-2 text-white w-full focus:border-neon-purple outline-none"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Stops batch processing if total session usage exceeds this amount.</p>
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
                        onClick={() => setProcessedItems([])} 
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
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-bold focus:border-neon-purple outline-none"
                    placeholder="e.g. English, Spanish, German..."
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
              className="w-full h-64 bg-slate-950 border border-slate-700 rounded-lg p-4 font-mono text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-neon-purple resize-none"
              placeholder='Paste JSON array or raw list of facts...'
            />
            
            {isProcessing ? (
                <button
                    onClick={() => setShouldStop(true)}
                    className="w-full bg-red-900/80 hover:bg-red-800 text-white font-bold py-3 px-6 rounded-lg transition-all flex items-center justify-center gap-2"
                >
                    <StopCircle className="w-5 h-5" /> Stop Processing
                </button>
            ) : (
                <button
                    onClick={handleStartQueue}
                    disabled={totalTokenUsage.count >= tokenLimit}
                    className="w-full bg-gradient-to-r from-neon-purple to-neon-blue hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3 px-6 rounded-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    <Sparkles className="w-5 h-5" />
                    {processedItems.length > 0 && processedItems.some(p => p.status === 'processing') 
                        ? 'Queue Running...' 
                        : processedItems.length > 0 ? 'Resume Queue' : 'Start Queue'}
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
                    Queue / Processing ({processedItems.filter(p => p.status === 'pending' || p.status === 'processing').length})
                    {activeTab === 'processing' && <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-neon-purple shadow-[0_0_8px_rgba(176,38,255,0.8)]"></div>}
                 </button>
                 <button 
                    onClick={() => setActiveTab('ready')}
                    className={`text-sm font-bold pb-2 px-3 whitespace-nowrap transition-all relative flex items-center gap-2 ${activeTab === 'ready' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                    <ListChecks className="w-4 h-4" />
                    Ready for Review ({processedItems.filter(p => !p.reviewed && (p.status === 'completed' || p.status === 'failed')).length})
                    {activeTab === 'ready' && <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-neon-blue shadow-[0_0_8px_rgba(0,204,255,0.8)]"></div>}
                 </button>
                 <button 
                    onClick={() => setActiveTab('reviewed')}
                    className={`text-sm font-bold pb-2 px-3 whitespace-nowrap transition-all relative flex items-center gap-2 ${activeTab === 'reviewed' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                 >
                    <CheckCircle className="w-4 h-4" />
                    Reviewed ({processedItems.filter(p => p.reviewed).length})
                    {activeTab === 'reviewed' && <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-neon-green shadow-[0_0_8px_rgba(0,255,153,0.8)]"></div>}
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
                    <p className="text-lg">No items in {activeTab === 'processing' ? 'Queue' : activeTab === 'ready' ? 'Ready list' : 'Reviewed list'}</p>
                    <p className="text-sm opacity-60">
                        {activeTab === 'processing' ? 'Add facts to start.' : activeTab === 'ready' ? 'Wait for agents to finish.' : 'Review items to move them here.'}
                    </p>
                </div>
            )}

            {currentDisplayItems.map((item) => (
                <ResultCard 
                    key={item.id}
                    item={item}
                    onUpdate={handleItemUpdate}
                    onToggleReview={() => handleToggleReview(item.id)}
                    onReprocessWithFeedback={(feedback) => handleReprocessWithFeedback(item.id, feedback)}
                    onRegenerateLies={() => handleRegenerateLies(item.id)}
                    onRevert={() => handleRevert(item.id)}
                    onDiscard={() => handleDiscard(item.id)}
                />
            ))}
          </div>

        </section>
      </main>
    </div>
  );
}

export default App;