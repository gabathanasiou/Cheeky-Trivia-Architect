import type { TokenUsage } from '../core/types';

export type RunMode = 'optimization' | 'localization';
export type Effort = 'low' | 'high' | 'max';

export interface RunOptions {
  limit: number;
  sections?: number[];
  full: boolean;
  effort: Effort;
  maxCost: number;
  concurrency: number;
  out: string;
  force: boolean;
  jobId?: string;
  mode: RunMode;
  language: string;
}

export interface Candidate {
  id: string;
  status: 'fact' | 'question';
  statement?: string;
  fact?: string;
  answer: string;
  category: string;
  lies?: string[];
  blankScore?: number;
  funScore?: number;
  difficulty?: string;
  timeless?: boolean;
  tone?: string;
  quote?: string;
  confidence?: number;
  language?: string;
  source: {
    name: string;
    url: string;
    license: string;
    sourceId: string;
  };
  usage: TokenUsage;
}

export type UsageSink = (stage: string, usage: TokenUsage) => void;
