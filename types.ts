export interface TriviaFact {
  fact: string;
  answer: string;
  category: string;
  lies: string[];
}

export interface AgentLog {
  id: string;
  agentName: string;
  action: string;
  status: 'pending' | 'working' | 'success' | 'retry' | 'failed';
  details?: string;
  timestamp: number;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCost: number; // In USD
}

export interface ProcessedItem {
  id: string;
  timestamp: number; // For FIFO sorting
  original: TriviaFact;
  optimized: TriviaFact | null;
  score: number | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  currentStep?: string;
  triageDecision?: string;
  logs: AgentLog[];
  tokenStats?: TokenUsage;
  error?: string;
  reviewed?: boolean;
  
  // New fields for advanced control
  pendingAction?: 'DEFAULT' | 'REPROCESS_WITH_FEEDBACK' | 'REGENERATE_LIES';
  userFeedback?: string;
}

// Wrapper for Service responses to include usage data
export interface AgentResult<T> {
  data: T;
  usage: TokenUsage;
}

export type TriageAction = 'KEEP_ALL' | 'GENERATE_LIES' | 'FULL_OPTIMIZE';

export interface TriageResult {
  action: TriageAction;
}

export interface AgentResponseArchitect {
  newFact: string;
  newAnswer: string;
}

export interface AgentResponseCheck {
  score: number;
  feedback?: string;
}

export interface AgentResponseLies {
  lies: string[];
}

export interface AgentResponseRawLies {
  rawLies: string[];
}

export interface AgentResponseLieCheck {
  fixedLies: string[];
}