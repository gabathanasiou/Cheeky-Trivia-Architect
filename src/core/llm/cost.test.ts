import { describe, expect, it } from 'vitest';
import { costForUsage, isPeak } from './cost';

describe('isPeak', () => {
  it('flags the 01:00-04:00 UTC weekday window', () => {
    expect(isPeak(new Date('2026-10-19T02:00:00Z'))).toBe(true); // Monday
    expect(isPeak(new Date('2026-10-19T03:59:00Z'))).toBe(true);
    expect(isPeak(new Date('2026-10-19T04:00:00Z'))).toBe(false);
  });

  it('flags the 06:00-10:00 UTC weekday window', () => {
    expect(isPeak(new Date('2026-10-19T06:00:00Z'))).toBe(true);
    expect(isPeak(new Date('2026-10-19T09:59:00Z'))).toBe(true);
    expect(isPeak(new Date('2026-10-19T10:00:00Z'))).toBe(false);
  });

  it('treats weekends as off-peak all day', () => {
    expect(isPeak(new Date('2026-10-17T02:00:00Z'))).toBe(false); // Saturday
    expect(isPeak(new Date('2026-10-18T07:00:00Z'))).toBe(false); // Sunday
  });

  it('treats the weekday lunch gap as off-peak', () => {
    expect(isPeak(new Date('2026-10-19T05:00:00Z'))).toBe(false);
    expect(isPeak(new Date('2026-10-19T11:00:00Z'))).toBe(false);
  });
});

describe('costForUsage', () => {
  const offPeak = new Date('2026-10-19T12:00:00Z'); // Monday, off-peak
  const peak = new Date('2026-10-19T02:00:00Z'); // Monday, peak

  it('charges off-peak input + output', () => {
    expect(
      costForUsage(
        { promptTokens: 1_000_000, completionTokens: 1_000_000, cacheMissTokens: 1_000_000 },
        offPeak,
      ),
    ).toBeCloseTo(0.15 + 0.6, 10);
  });

  it('charges cache hits at the cache-hit rate', () => {
    expect(
      costForUsage(
        { promptTokens: 1_000_000, completionTokens: 0, cacheHitTokens: 1_000_000 },
        offPeak,
      ),
    ).toBeCloseTo(0.003, 10);
  });

  it('doubles the rates at peak', () => {
    expect(
      costForUsage(
        { promptTokens: 1_000_000, completionTokens: 1_000_000, cacheMissTokens: 1_000_000 },
        peak,
      ),
    ).toBeCloseTo(0.3 + 1.2, 10);
  });

  it('splits prompt tokens into cache hit and miss', () => {
    expect(
      costForUsage(
        {
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
          cacheHitTokens: 400_000,
          cacheMissTokens: 600_000,
        },
        offPeak,
      ),
    ).toBeCloseTo(0.4 * 0.003 + 0.6 * 0.15 + 0.6, 10);
  });
});
