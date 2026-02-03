import React, { useState, useRef } from 'react';
import { ProcessedItem, TriviaFact, TriageAction } from '../types';
import { Sparkles, Save, X, Loader2, Copy, ChevronDown, ChevronUp, DollarSign, FileText, CheckCircle2, AlertTriangle, Lightbulb, RefreshCw, RotateCcw, CheckSquare, Square, BrainCircuit, Dna, ArrowLeftRight, Trash2, Scissors, Globe } from 'lucide-react';
import { AgentVisualizer } from './AgentVisualizer';

interface ResultCardProps {
  item: ProcessedItem;
  onUpdate: (id: string, newFact: TriviaFact) => void;
  onToggleReview: () => void;
  onReprocessWithFeedback: (feedback: string) => void;
  onRegenerateLies: () => void;
  onRevert: () => void;
  onDiscard: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({ item, onUpdate, onToggleReview, onReprocessWithFeedback, onRegenerateLies, onRevert, onDiscard }) => {
  const { id, original, optimized, score, status, currentStep, logs, triageDecision, tokenStats, reviewed, mode } = item;
  
  const [formData, setFormData] = React.useState<TriviaFact | null>(null);
  const [showLogs, setShowLogs] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  
  const factTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isLocalization = mode === 'LOCALIZATION';

  React.useEffect(() => {
    if (optimized) {
      setFormData(optimized);
    }
  }, [optimized]);

  // Collapse logs automatically when finished
  React.useEffect(() => {
    if (status === 'completed') {
      setShowLogs(false);
    }
  }, [status]);

  const handleFactChange = (val: string) => {
    if (!formData) return;
    const newData = { ...formData, fact: val };
    setFormData(newData);
    onUpdate(id, newData);
  };

  const handleAnswerChange = (val: string) => {
    if (!formData) return;
    const newData = { ...formData, answer: val };
    setFormData(newData);
    onUpdate(id, newData);
  };

  const handleLieChange = (index: number, value: string) => {
    if (!formData) return;
    const newLies = [...formData.lies];
    newLies[index] = value;
    const newData = { ...formData, lies: newLies };
    setFormData(newData);
    onUpdate(id, newData);
  };

  // Logic to turn selected text into blank and restore old answer
  const handleMakeBlank = () => {
      if (!formData || !factTextareaRef.current) return;
      
      const textarea = factTextareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      
      // If no text selected, ignore
      if (start === end) return;
      
      const currentFactText = formData.fact;
      const selectedText = currentFactText.substring(start, end);
      
      // We want to hide 'selectedText' -> This becomes the NEW Answer.
      // We want to restore the old answer into the OLD <BLANK>.
      
      const beforeSelection = currentFactText.substring(0, start);
      const afterSelection = currentFactText.substring(end);
      
      // 1. Create a temp string where the NEW blank location is marked.
      const TEMP_MARKER = "@@@NEW_BLANK@@@";
      const tempFact = beforeSelection + TEMP_MARKER + afterSelection;
      
      // 2. Replace the OLD <BLANK> (if it exists outside the selection) with the OLD Answer.
      // We use a regex to catch variations of blank.
      const restoredFact = tempFact.replace(/<BLANK>|\[BLANK\]|___/gi, formData.answer);
      
      // 3. Put the actual <BLANK> tag in the new position.
      const finalFact = restoredFact.replace(TEMP_MARKER, "<BLANK>");

      // 4. If the old blank was actually INSIDE the selection, 'selectedText' will contain <BLANK>.
      // We should resolve that to the old answer as well, so the new answer text is clean.
      const finalNewAnswer = selectedText.replace(/<BLANK>|\[BLANK\]|___/gi, formData.answer);
      
      const newData = {
          ...formData,
          fact: finalFact,
          answer: finalNewAnswer
      };
      
      setFormData(newData);
      onUpdate(id, newData);
  };

  const formatRaw = (data: TriviaFact) => {
    const escape = (str: string) => str.replace(/"/g, '\\"');
    return `  {
    fact: "${escape(data.fact)}",
    answer: "${escape(data.answer)}",
    category: "${escape(data.category)}",
    lies: [${data.lies.map(l => `"${escape(l)}"`).join(", ")}]
  },`;
  };

  const copySingleRaw = () => {
    if (!formData) return;
    const raw = formatRaw(formData);
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReprocessSubmit = () => {
      onReprocessWithFeedback(feedbackText);
      setShowFeedbackInput(false);
      setFeedbackText("");
  };

  // Helper for Decision Badge
  const renderDecisionBadge = (decision?: string) => {
    if (!decision) return null;
    
    let colorClass = "bg-slate-800 text-slate-300 border-slate-700";
    let icon = null;
    let label = decision.replace('_', ' ');

    if (decision === 'KEEP_ALL') {
        colorClass = "bg-green-900/40 text-green-400 border-green-800";
        icon = <CheckCircle2 className="w-3 h-3" />;
    } else if (decision === 'FULL_OPTIMIZE') {
        colorClass = "bg-neon-purple/20 text-neon-purple border-neon-purple/40 shadow-[0_0_10px_rgba(176,38,255,0.2)]";
        icon = <Sparkles className="w-3 h-3" />;
    } else if (decision === 'GENERATE_LIES') {
        colorClass = "bg-yellow-900/40 text-yellow-400 border-yellow-800";
        icon = <Lightbulb className="w-3 h-3" />;
    }

    return (
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border ${colorClass}`}>
            {icon}
            {label}
        </div>
    );
  };
  
  const renderModeBadge = () => {
      if (isLocalization) {
          return (
             <div className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border bg-orange-900/30 text-orange-400 border-orange-800">
                <Globe className="w-3 h-3" />
                Localized
             </div>
          );
      }
      return null;
  };

  // Status Rendering
  if (status === 'processing') return (
     <div className="w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg p-6 flex flex-col gap-6 animate-pulse">
        <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
                <Loader2 className={`w-6 h-6 animate-spin ${isLocalization ? 'text-orange-400' : 'text-neon-blue'}`} />
                <div className="space-y-1">
                    <span className="text-slate-300 font-bold font-mono text-sm block">Processing Item #{id.substring(0,4)}</span>
                    <span className={`${isLocalization ? 'text-orange-400' : 'text-neon-purple'} font-mono text-xs`}>{currentStep || "Initializing agents..."}</span>
                </div>
            </div>
            <div className="flex gap-2">
                {renderModeBadge()}
                {renderDecisionBadge(triageDecision)}
            </div>
        </div>
        <div className="bg-slate-950/50 p-4 rounded border border-slate-800">
             <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Original Input</div>
             <div className="text-xs text-slate-400">{original.fact}</div>
        </div>
        <AgentVisualizer logs={logs} compact />
     </div>
  );

  if (status === 'pending') return (
    <div className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between opacity-60">
        <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${isLocalization ? 'bg-orange-500' : 'bg-slate-600'}`}></div>
            <span className="text-xs text-slate-400 font-mono">Queued ({mode}): {original.fact.substring(0, 50)}...</span>
        </div>
        <div className="flex items-center gap-2">
            {renderModeBadge()}
            {renderDecisionBadge(triageDecision)}
            <span className="text-[10px] text-slate-600 uppercase font-bold">Waiting</span>
        </div>
    </div>
  );
  
  if (status === 'failed') return (
    <div className="w-full bg-red-950/20 border border-red-900/50 rounded-xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
             <div className="flex items-center gap-4">
                <X className="w-6 h-6 text-red-500" />
                <div>
                    <p className="text-red-400 font-bold">Optimization Failed</p>
                    <p className="text-red-300/50 text-xs font-mono">{item.error || "Check logs for details."}</p>
                </div>
             </div>
             <div className="flex items-center gap-2">
                <button 
                    onClick={() => onReprocessWithFeedback("Retry after failure")}
                    className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-800/50 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                >
                    <RefreshCw className="w-3 h-3" /> Retry
                </button>
                <button 
                    onClick={onDiscard}
                    className="text-xs bg-slate-900 hover:bg-red-900/20 text-slate-500 hover:text-red-400 border border-slate-800 hover:border-red-900/30 px-3 py-1.5 rounded flex items-center gap-2 transition-colors"
                >
                    <Trash2 className="w-3 h-3" />
                </button>
             </div>
        </div>
        <AgentVisualizer logs={logs} compact />
    </div>
  );

  if (!formData) return null;

  const scoreColor = (score || 0) >= 8 ? 'text-neon-green' : (score || 0) >= 6 ? 'text-yellow-400' : 'text-red-400';
  const themeColor = isLocalization ? 'orange' : 'neon-purple';
  const themeBorder = isLocalization ? 'border-orange-500/20' : 'border-neon-purple/20';
  const themeBg = isLocalization ? 'bg-orange-900/5' : 'bg-neon-purple/5';
  const themeText = isLocalization ? 'text-orange-400' : 'text-neon-purple';

  return (
    <div className={`w-full bg-slate-900 border ${reviewed ? 'border-neon-green/30' : 'border-slate-800'} rounded-xl overflow-hidden shadow-lg hover:shadow-${themeColor}/10 transition-all duration-300 flex flex-col relative`}>
      
      {/* Header Bar */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex justify-between items-center flex-wrap gap-2">
         <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500">#{id.substring(0,4)}</span>
            <div className={`px-2 py-0.5 rounded text-xs font-bold border bg-opacity-10 ${scoreColor.replace('text', 'bg').replace('400', '900')} ${scoreColor} border-current`}>
                Score: {score}/10
            </div>
            
            {renderModeBadge()}
            {renderDecisionBadge(triageDecision)}

            {tokenStats && (
                <div className="hidden md:flex items-center gap-1 text-[10px] text-slate-500 font-mono bg-black/30 px-2 py-1 rounded ml-2">
                   <DollarSign className="w-3 h-3" />
                   <span>{tokenStats.totalTokens} toks</span>
                   <span className="text-slate-600">|</span>
                   <span>${tokenStats.estimatedCost.toFixed(5)}</span>
                </div>
            )}
         </div>
         
         <div className="flex items-center gap-2">
             <button
                onClick={onToggleReview}
                className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-bold transition-all ${
                    reviewed 
                    ? 'bg-neon-green text-black border border-neon-green' 
                    : 'bg-slate-900 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-white'
                }`}
             >
                {reviewed ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                {reviewed ? 'Reviewed' : 'Review'}
             </button>
             
             <div className="h-4 w-px bg-slate-800 mx-1"></div>

             <button 
                onClick={onRevert}
                title="Revert to original input"
                className="p-1.5 text-slate-500 hover:text-neon-pink bg-slate-900 border border-slate-800 rounded hover:border-neon-pink/50 transition-colors"
             >
                 <RotateCcw className="w-3.5 h-3.5" />
             </button>

             <button 
                onClick={onRegenerateLies}
                title={isLocalization ? "Re-localize Lies to fit current Fact" : "Regenerate Lies Only"}
                className={`p-1.5 text-slate-500 ${isLocalization ? 'hover:text-orange-400 hover:bg-orange-900/20' : 'hover:text-neon-yellow hover:bg-neon-yellow/10'} bg-slate-900 border border-slate-800 rounded hover:border-current transition-colors`}
             >
                <Dna className="w-3.5 h-3.5" />
             </button>

             <button 
                onClick={() => setShowFeedbackInput(!showFeedbackInput)}
                title={isLocalization ? "Refine Translation with Instructions" : "Reprocess with Feedback"}
                className={`p-1.5 border rounded transition-colors ${showFeedbackInput ? 'text-neon-blue border-neon-blue bg-neon-blue/10' : 'text-slate-500 hover:text-neon-blue bg-slate-900 border-slate-800 hover:border-neon-blue/50'}`}
             >
                 <BrainCircuit className="w-3.5 h-3.5" />
             </button>

             <button 
               onClick={copySingleRaw}
               title="Copy Raw Format"
               className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors group bg-slate-900 border border-slate-800 px-2 py-1.5 rounded hover:border-neon-green/50"
             >
                {copied ? <span className="text-neon-green text-[10px] uppercase font-bold">Copied</span> : <span className="text-[10px] uppercase font-bold group-hover:text-neon-blue">RAW</span>}
                <Copy className={`w-3.5 h-3.5 ${copied ? 'text-neon-green' : ''}`} />
             </button>

             <div className="h-4 w-px bg-slate-800 mx-1"></div>

             <button 
                onClick={onDiscard}
                title="Discard Item"
                className="p-1.5 text-slate-500 hover:text-red-500 bg-slate-900 border border-slate-800 rounded hover:border-red-900 hover:bg-red-950 transition-colors"
             >
                 <Trash2 className="w-3.5 h-3.5" />
             </button>
         </div>
      </div>

      {/* FEEDBACK INPUT AREA */}
      {showFeedbackInput && (
          <div className="bg-slate-900 border-b border-slate-800 p-4 animate-in slide-in-from-top-2">
              <label className="text-xs font-bold text-neon-blue mb-2 block flex items-center gap-2">
                  <BrainCircuit className="w-3 h-3" /> {isLocalization ? 'Translation Guidance' : 'Architect Feedback'}
              </label>
              <div className="flex gap-2">
                  <input 
                    autoFocus
                    type="text" 
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder={isLocalization ? "e.g. Too formal, use slang for 'Money'..." : "e.g. The blank is too easy, make it harder..."}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-neon-blue outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleReprocessSubmit()}
                  />
                  <button 
                    onClick={handleReprocessSubmit}
                    className="bg-neon-blue/20 hover:bg-neon-blue/40 text-neon-blue border border-neon-blue/50 px-4 py-2 rounded text-xs font-bold"
                  >
                      {isLocalization ? 'Re-translate' : 'Reprocess'}
                  </button>
              </div>
          </div>
      )}

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: ORIGINAL */}
        <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-4 space-y-4 h-full flex flex-col">
            <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-slate-800 pb-2">
                Original Input
            </h4>
            
            <div className="space-y-1">
                <div className="text-xs font-bold text-slate-500">Fact:</div>
                <div className="text-xs text-slate-400 leading-relaxed opacity-80">
                    {original.fact}
                </div>
            </div>

            <div className="space-y-1">
                <div className="text-xs font-bold text-slate-500">Answer:</div>
                <div className="text-xs text-slate-400">
                    {original.answer}
                </div>
            </div>

            <div className="flex-1">
                <div className="text-xs font-bold text-slate-500 mb-2">Original Lies:</div>
                <div className="grid grid-cols-1 gap-1.5">
                    {original.lies.map((lie, i) => (
                         <div key={i} className="text-[10px] text-slate-500 bg-slate-900 px-2 py-1 rounded border border-slate-800/50">
                            {i+1}. {lie}
                         </div>
                    ))}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: OPTIMIZED */}
        <div className={`${themeBg} border ${themeBorder} rounded-lg p-4 space-y-4 h-full relative`}>
            <h4 className={`text-[10px] uppercase tracking-widest ${themeText} font-bold border-b ${themeBorder} pb-2 flex items-center gap-2`}>
                {isLocalization ? <Globe className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {isLocalization ? 'Localized Result' : 'Optimized Result'}
            </h4>
            
            <div className="space-y-2 relative">
                 <div className="flex justify-between items-center">
                    <label className={`text-[10px] uppercase font-bold ${themeText} opacity-70`}>Fact (Editable)</label>
                    <button 
                        onClick={handleMakeBlank}
                        title="Convert selected text to blank and restore old answer to fact"
                        className={`text-[10px] bg-slate-900 hover:bg-white/10 ${themeText} border border-current opacity-50 hover:opacity-100 px-2 py-0.5 rounded flex items-center gap-1 mb-1 transition-colors`}
                    >
                        <Scissors className="w-3 h-3" /> Swap Blank
                    </button>
                 </div>
                 <textarea 
                    ref={factTextareaRef}
                    className={`w-full bg-slate-950 text-white text-sm p-3 rounded border border-slate-700 focus:border-current outline-none transition-colors min-h-[80px] ${themeText}`}
                    value={formData.fact}
                    onChange={(e) => handleFactChange(e.target.value)}
                    placeholder="Enter fact with <BLANK>..."
                />
            </div>

            <div className="space-y-2">
                 <label className="text-[10px] uppercase font-bold text-neon-green/70">Answer (Editable)</label>
                 <input 
                    className="w-full bg-slate-950 text-neon-green text-sm p-2 rounded border border-slate-700 focus:border-neon-green outline-none transition-colors"
                    value={formData.answer}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                 />
            </div>

            <div>
                 <label className="text-[10px] uppercase font-bold text-slate-400 mb-2 block">
                    {isLocalization ? 'Localized Lies (Editable)' : 'Optimized Lies (Editable)'}
                 </label>
                 <div className="grid grid-cols-1 gap-2">
                    {formData.lies.map((lie, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-600 font-mono w-4">{i+1}</span>
                            <input 
                                value={lie}
                                onChange={(e) => handleLieChange(i, e.target.value)}
                                className="w-full bg-slate-950 text-slate-200 text-xs p-2 rounded border border-slate-700 focus:border-neon-blue outline-none transition-colors"
                            />
                        </div>
                    ))}
                 </div>
            </div>
        </div>
      </div>

      {/* FOOTER: MINI CONSOLE */}
      <div className="border-t border-slate-800">
         <button 
            onClick={() => setShowLogs(!showLogs)}
            className="w-full bg-slate-900 hover:bg-slate-800 p-2 text-xs text-slate-500 font-mono flex items-center justify-center gap-2 transition-colors"
         >
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showLogs ? 'Collapse Agent Logs' : 'Expand Agent Logs'}
         </button>
         
         {showLogs && (
             <div className="border-t border-slate-800">
                <AgentVisualizer logs={logs} compact />
             </div>
         )}
      </div>

    </div>
  );
};