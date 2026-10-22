export interface PriceCard {
  input: number;
  output: number;
  cacheHit: number;
}

/**
 * DeepSeek V4.1 Flash list prices, USD per 1M tokens.
 * Peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday.
 * Off-peak is half price.
 */
export const PRICING = {
  model: 'deepseek-flash',
  offPeak: { input: 0.15, output: 0.6, cacheHit: 0.003 } satisfies PriceCard,
  peak: { input: 0.3, output: 1.2, cacheHit: 0.006 } satisfies PriceCard,
} as const;

export function isPeak(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function costForUsage(
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
  },
  date: Date = new Date(),
): number {
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const cacheHit = usage.cacheHitTokens ?? 0;
  const cacheMiss = usage.cacheMissTokens ?? Math.max(0, promptTokens - cacheHit);
  const prices = isPeak(date) ? PRICING.peak : PRICING.offPeak;

  return (
    (cacheHit / 1_000_000) * prices.cacheHit +
    (cacheMiss / 1_000_000) * prices.input +
    (completionTokens / 1_000_000) * prices.output
  );
}
