export interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

import type { TokenUsage } from '../types';
import { costForUsage } from './cost';

export function usageFromResponse(
  usage: UsageLike | undefined,
  date: Date = new Date(),
): TokenUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const candidatesTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + candidatesTokens;
  const cacheHitTokens = usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMissTokens =
    usage?.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHitTokens);

  return {
    promptTokens,
    candidatesTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    estimatedCost: costForUsage(
      { promptTokens, completionTokens: candidatesTokens, cacheHitTokens, cacheMissTokens },
      date,
    ),
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    candidatesTokens: a.candidatesTokens + b.candidatesTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cacheHitTokens: (a.cacheHitTokens ?? 0) + (b.cacheHitTokens ?? 0),
    cacheMissTokens: (a.cacheMissTokens ?? 0) + (b.cacheMissTokens ?? 0),
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

export const EMPTY_USAGE: TokenUsage = {
  promptTokens: 0,
  candidatesTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  estimatedCost: 0,
};
