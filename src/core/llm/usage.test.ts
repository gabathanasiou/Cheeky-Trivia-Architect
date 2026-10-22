import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, addUsage, usageFromResponse } from './usage';

describe('usageFromResponse', () => {
  it('uses the cache fields when DeepSeek returns them', () => {
    const usage = usageFromResponse(
      {
        prompt_tokens: 1_000,
        completion_tokens: 200,
        total_tokens: 1_200,
        prompt_cache_hit_tokens: 400,
        prompt_cache_miss_tokens: 600,
      },
      new Date('2026-10-19T12:00:00Z'),
    );

    expect(usage.promptTokens).toBe(1_000);
    expect(usage.candidatesTokens).toBe(200);
    expect(usage.totalTokens).toBe(1_200);
    expect(usage.cacheHitTokens).toBe(400);
    expect(usage.cacheMissTokens).toBe(600);
    expect(usage.estimatedCost).toBeGreaterThan(0);
  });

  it('treats an absent cache split as a full cache miss', () => {
    const usage = usageFromResponse({
      prompt_tokens: 500,
      completion_tokens: 100,
      total_tokens: 600,
    });

    expect(usage.cacheHitTokens).toBe(0);
    expect(usage.cacheMissTokens).toBe(500);
  });

  it('returns zeros for missing usage', () => {
    expect(usageFromResponse(undefined)).toEqual({ ...EMPTY_USAGE, cacheHitTokens: 0, cacheMissTokens: 0 });
  });
});

describe('addUsage', () => {
  it('accumulates tokens, cache fields and cost', () => {
    const a = usageFromResponse({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
    const b = usageFromResponse({ prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 });
    const sum = addUsage(a, b);

    expect(sum.promptTokens).toBe(300);
    expect(sum.candidatesTokens).toBe(30);
    expect(sum.totalTokens).toBe(330);
    expect(sum.estimatedCost).toBeCloseTo(a.estimatedCost + b.estimatedCost, 12);
  });
});
