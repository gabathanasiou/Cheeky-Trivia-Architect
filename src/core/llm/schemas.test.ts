import { describe, expect, it } from 'vitest';
import {
  architectSchema,
  editorSchema,
  generatorSchema,
  localizationSchema,
  parseSchema,
  synthesisSchema,
  triageSchema,
} from './schemas';

describe('synthesisSchema', () => {
  it('accepts a clean fact', () => {
    const parsed = synthesisSchema.parse({
      status: 'ok',
      statement: 'A group of lions is called a pride.',
      answer: 'pride',
      category: 'animals',
      confidence: 0.98,
    });
    expect(parsed.status).toBe('ok');
  });

  it('accepts a rejection with a reason', () => {
    const parsed = synthesisSchema.parse({ status: 'reject', reason: 'None of these' });
    expect(parsed.status).toBe('reject');
  });

  it('rejects an unknown status', () => {
    expect(() => synthesisSchema.parse({ status: 'maybe' })).toThrow();
  });
});

describe('agent schemas', () => {
  it('triage only allows the three actions', () => {
    expect(triageSchema.parse({ action: 'FULL_OPTIMIZE' }).action).toBe('FULL_OPTIMIZE');
    expect(() => triageSchema.parse({ action: 'DO_SOMETHING' })).toThrow();
  });

  it('architect requires both fields', () => {
    expect(() => architectSchema.parse({ newFact: 'A <BLANK>.', newAnswer: '' })).toThrow();
  });

  it('generator requires at least five lies', () => {
    expect(() => generatorSchema.parse({ rawLies: ['a', 'b', 'c', 'd'] })).toThrow();
    expect(generatorSchema.parse({ rawLies: ['a', 'b', 'c', 'd', 'e'] }).rawLies).toHaveLength(5);
  });

  it('editor accepts exactly five lies', () => {
    expect(editorSchema.parse({ fixedLies: ['a', 'b', 'c', 'd', 'e'] }).fixedLies).toHaveLength(5);
  });

  it('localization requires a blank-preserving payload', () => {
    expect(() =>
      localizationSchema.parse({
        fact: 'Ένα <BLANK>.',
        answer: 'λιοντάρι',
        lies: ['α', 'β', 'γ', 'δ', 'ε'],
      }),
    ).not.toThrow();
  });

  it('parse accepts an array of facts', () => {
    const parsed = parseSchema.parse([
      { fact: 'A <BLANK>.', answer: 'x', category: 'General', lies: ['y'] },
    ]);
    expect(parsed).toHaveLength(1);
  });
});
