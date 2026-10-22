import type { LlmCallOptions, LlmCallResult } from './deepseek';
import { EMPTY_USAGE } from './usage';

/**
 * Deterministic fixtures for tests and UI smoke runs. They satisfy the same
 * Zod schemas as live responses, so the whole UI can run without a key.
 */
const FIXTURES: Record<string, unknown> = {
  parse: [
    {
      fact: 'The inventor of the microwave only received <BLANK> for his discovery.',
      answer: '$2',
      category: 'Irony',
      lies: ['A frozen dinner', 'Radiation', 'A pat on the back', 'Third-degree burns', 'Nothing'],
    },
  ],
  synthesize: {
    status: 'ok',
    statement: 'The inventor of the microwave only received two dollars for his discovery.',
    answer: 'two dollars',
    category: 'Irony',
    confidence: 0.95,
  },
  extract: {
    facts: [
      {
        statement:
          'The Thames Tunnel flooded in 1828 and six workmen were killed.',
        answer: 'six workmen',
        quote: 'six of the workmen were lost',
        category: 'History',
        period: 'historical',
        confidence: 0.9,
      },
    ],
  },
  triage: { action: 'GENERATE_LIES' },
  score: {
    funScore: 8,
    blankScore: 7,
    difficulty: 'medium',
    timeless: true,
    tone: 'wholesome',
  },
  architect: {
    newFact: 'The inventor of the microwave only received <BLANK> for his discovery.',
    newAnswer: '$2',
  },
  critic: { score: 8, feedback: 'The blank hides the punchline.' },
  generate: {
    rawLies: [
      'A frozen dinner',
      'Radiation',
      'A pat on the back',
      'Third-degree burns',
      'Nothing',
      'A coupon',
      'A high five',
      'A lawsuit',
    ],
  },
  refine: {
    fixedLies: [
      'A frozen dinner',
      'Radiation',
      'A pat on the back',
      'Third-degree burns',
      'Nothing',
    ],
  },
  localize: {
    fact: 'Ο εφευρέτης του φούρνου μικροκυμάτων έλαβε μόνο <BLANK> για την ανακάλυψή του.',
    answer: '2 δολάρια',
    lies: ['Ένα κατεψυγμένο δείπνο', 'Ακτινοβολία', 'Ένα χτύπημα στην πλάτη', 'Εγκαύματα', 'Τίποτα'],
  },
  'localize-lies': {
    fact: 'Ο εφευρέτης του φούρνου μικροκυμάτων έλαβε μόνο <BLANK> για την ανακάλυψή του.',
    answer: '2 δολάρια',
    lies: ['Ένα κατεψυγμένο δείπνο', 'Ακτινοβολία', 'Ένα χτύπημα στην πλάτη', 'Εγκαύματα', 'Τίποτα'],
  },
  linguist: { score: 9, issues: [] },
  fixer: {
    fact: 'Ο εφευρέτης του φούρνου μικροκυμάτων έλαβε μόνο <BLANK> για την ανακάλυψή του.',
    answer: '2 δολάρια',
    lies: ['Ένα κατεψυγμένο δείπνο', 'Ακτινοβολία', 'Ένα χτύπημα στην πλάτη', 'Εγκαύματα', 'Τίποτα'],
  },
};

export async function mockCall<T>(options: LlmCallOptions<T>): Promise<LlmCallResult<T>> {
  const fixture = FIXTURES[options.agent];
  if (fixture === undefined) {
    throw new Error(`No mock fixture for agent "${options.agent}"`);
  }

  // Simulate a small amount of latency so the UI's progress states are visible.
  await new Promise((resolve) => setTimeout(resolve, 25));

  return {
    data: options.schema.parse(fixture),
    usage: { ...EMPTY_USAGE },
    raw: JSON.stringify(fixture),
  };
}
