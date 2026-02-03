import React, { useEffect, useRef } from 'react';
import { AgentLog } from '../types';
import { Terminal, CheckCircle2, XCircle, Loader2, Bot } from 'lucide-react';

interface AgentVisualizerProps {
  logs: AgentLog[];
  compact?: boolean;
}

export const AgentVisualizer: React.FC<AgentVisualizerProps> = ({ logs, compact = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getStatusIcon = (status: AgentLog['status']) => {
    switch (status) {
      case 'working': return <Loader2 className="w-4 h-4 animate-spin text-neon-blue" />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-neon-green" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'retry': return <Bot className="w-4 h-4 text-neon-purple animate-pulse" />;
      default: return <div className="w-4 h-4 rounded-full border-2 border-slate-600" />;
    }
  };

  const getAgentColor = (name: string) => {
      if (name.includes('Critic')) return 'text-neon-pink';
      if (name.includes('Parser')) return 'text-yellow-400';
      if (name.includes('Triage')) return 'text-orange-400';
      // Localization Agents
      if (name.includes('Cultural')) return 'text-cyan-400';
      if (name.includes('Linguist')) return 'text-indigo-400';
      if (name.includes('Fixer')) return 'text-emerald-400';
      
      return 'text-neon-blue';
  };

  return (
    <div className={`w-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex flex-col shadow-inner ${compact ? 'h-[200px]' : 'h-[300px] shadow-2xl'}`}>
      <div className={`bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center gap-2 ${compact ? 'py-1.5' : ''}`}>
        <Terminal className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-mono text-slate-400 font-bold uppercase tracking-wider">
            {compact ? 'Fact Agent Log' : 'Global Operations Console'}
        </span>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-sm scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
      >
        {logs.length === 0 && (
          <div className="text-slate-600 italic text-center mt-10 text-xs">Waiting for agents...</div>
        )}
        
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="pt-1">{getStatusIcon(log.status)}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className={`font-bold text-xs px-2 py-0.5 rounded bg-slate-800 ${getAgentColor(log.agentName)}`}>
                  {log.agentName}
                </span>
                {!compact && (
                    <span className="text-slate-500 text-xs">
                    {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                )}
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">{log.action}</p>
              {log.details && (
                <div className="mt-1 pl-3 border-l-2 border-slate-800 text-[10px] text-slate-400 whitespace-pre-wrap">
                  {log.details}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};