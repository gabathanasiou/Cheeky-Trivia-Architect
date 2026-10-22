import { describe, expect, it } from 'vitest';
import {
  answerTooLong,
  answerWordCount,
  dedupeKey,
  normalize,
  stableId,
  validateFact,
  validateLocalizationOptions,
  validateQuestion,
} from './validate';

describe('normalize', () => {
  it('collapses whitespace, case and smart quotes', () => {
    expect(normalize('  The  “Thames”\nTunnel ')).toBe('the "thames" tunnel');
  });
});

describe('validateFact', () => {
  const fact = {
    statement: 'The Thames Tunnel flooded in 1828 and six workmen were killed.',
    answer: 'six workmen',
    category: 'History',
  };

  it('accepts a clean fact', () => {
    const result = validateFact(fact);
    expect(result.ok).toBe(true);
  });

  it('rejects an answer that is missing from the statement', () => {
    const result = validateFact({ ...fact, answer: 'seven workmen' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not appear');
  });

  it('rejects a question', () => {
    const result = validateFact({ ...fact, statement: 'Did the Thames Tunnel flood?' });
    expect(result.ok).toBe(false);
  });

  it('rejects banned answers', () => {
    const result = validateFact({
      statement: 'The answer is None of these.',
      answer: 'None of these',
      category: 'General',
    });
    expect(result.ok).toBe(false);
  });

  it('checks the quote against the section when provided', () => {
    const section = 'The river broke in a second time; six of the workmen were lost.';
    expect(validateFact({ ...fact, quote: 'six of the workmen were lost' }, { sectionText: section }).ok).toBe(true);
    expect(validateFact({ ...fact, quote: 'seven workmen died' }, { sectionText: section }).ok).toBe(false);
  });

  it('warns on numeric answers', () => {
    const result = validateFact({
      statement: 'The tunnel cost 600,000 pounds.',
      answer: '600,000',
      category: 'History',
    });
    expect(result.warnings.join(' ')).toContain('number');
  });

  it('can reject numeric answers for the game bank', () => {
    const result = validateFact(
      {
        statement: 'The tunnel cost 600,000 pounds.',
        answer: '600,000',
        category: 'History',
      },
      { rejectNumericAnswers: true },
    );
    expect(result.ok).toBe(false);
  });
});

describe('validateQuestion', () => {
  const question = {
    fact: 'The Thames Tunnel flooded <BLANK> in 1828.',
    answer: 'twice',
    category: 'History',
    lies: ['once', 'three times', 'never', 'on a Tuesday', 'during a party'],
  };

  it('accepts a clean question', () => {
    expect(validateQuestion(question).ok).toBe(true);
  });

  it('requires exactly one blank', () => {
    expect(validateQuestion({ ...question, fact: 'The Thames Tunnel flooded in 1828.' }).ok).toBe(false);
    expect(validateQuestion({ ...question, fact: 'The <BLANK> Tunnel <BLANK> in 1828.' }).ok).toBe(false);
  });

  it('rejects a leaked answer', () => {
    expect(validateQuestion({ ...question, fact: 'The Thames Tunnel flooded twice, in <BLANK>.' }).ok).toBe(false);
  });

  it('rejects answers longer than five words', () => {
    const result = validateQuestion({
      ...question,
      answer: 'a very long answer with too many words',
      fact: 'Something happened in <BLANK>.',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('answer too long');
  });

  it('accepts an answer at the five-word boundary', () => {
    const result = validateQuestion({
      ...question,
      answer: 'one two three four five',
      fact: 'Something happened in <BLANK>.',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects answers longer than the character cap', () => {
    const result = validateQuestion({
      ...question,
      answer: 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz',
      fact: 'Something happened in <BLANK>.',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('answer too long');
  });

  it('rejects a Greek article directly before the blank', () => {
    const result = validateQuestion(
      {
        fact: 'Στην Ελβετία, είναι παράνομο να έχεις μόνο ένα <BLANK>.',
        answer: 'Ινδικό χοιρίδιο',
        category: 'Laws',
        lies: ['Σοκολάτα', 'Κούκος ρολόι', 'Τραπεζικός λογαριασμός', 'Ουδέτερη γνώμη', 'Τρόπαιο σκι'],
      },
      { language: 'Greek' },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('Greek article');
  });

  it('accepts a Greek bare blank', () => {
    const result = validateQuestion(
      {
        fact: 'Στην Ελβετία, είναι παράνομο να έχεις μόνο <BLANK>.',
        answer: 'Ινδικό χοιρίδιο',
        category: 'Laws',
        lies: ['σοκολάτα', 'κούκο ρολόι', 'τραπεζικό λογαριασμό', 'ουδέτερη γνώμη', 'τρόπαιο σκι'],
      },
      { language: 'Greek' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate and overlong lies', () => {
    expect(
      validateQuestion({
        ...question,
        lies: ['once', 'Once', 'three times', 'never', 'on a Tuesday'],
      }).ok,
    ).toBe(false);
    expect(
      validateQuestion({
        ...question,
        lies: ['a very long lie that definitely exceeds the thirty character cap', 'once', 'twice', 'never', 'x'],
      }).ok,
    ).toBe(false);
  });
});

describe('answer length helpers', () => {
  it('counts words and flags long answers', () => {
    expect(answerWordCount('one two three')).toBe(3);
    expect(answerWordCount('  one   two  ')).toBe(2);
    expect(answerTooLong('one two three four five')).toBe(false);
    expect(answerTooLong('one two three four five six')).toBe(true);
  });
});

describe('validateLocalizationOptions', () => {
  it('requires the article inside Greek options when the source had one before the blank', () => {
    const result = validateLocalizationOptions(
      { fact: 'In Switzerland, it is illegal to own just one <BLANK>.', answer: 'Guinea Pig' },
      {
        fact: 'Στην Ελβετία είναι παράνομο να έχεις μόνο <BLANK>.',
        answer: 'ινδικό χοιρίδιο',
        lies: ['σοκολάτα', 'ρολόι με κούκο', 'τραπεζικό λογαριασμό', 'ουδέτερη γνώμη', 'τρόπαιο σκι'],
      },
      'Greek',
    );
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts Greek options with their own articles', () => {
    const result = validateLocalizationOptions(
      { fact: 'In Switzerland, it is illegal to own just one <BLANK>.', answer: 'Guinea Pig' },
      {
        fact: 'Στην Ελβετία είναι παράνομο να έχεις μόνο <BLANK>.',
        answer: 'ένα ινδικό χοιρίδιο',
        lies: ['μία σοκολάτα', 'ένα ρολόι με κούκο', 'έναν τραπεζικό λογαριασμό', 'μία ουδέτερη γνώμη', 'ένα τρόπαιο σκι'],
      },
      'Greek',
    );
    expect(result.ok).toBe(true);
  });

  it('does not force an article when the source blank is a verb phrase', () => {
    const result = validateLocalizationOptions(
      { fact: 'The inventor of the Pringles can is now <BLANK>.', answer: 'Buried in a Pringles can' },
      {
        fact: 'Ο εφευρέτης του κουτιού Pringles τώρα <BLANK>.',
        answer: 'είναι θαμμένος σε ένα κουτί Pringles',
        lies: ['αποφεύγει τους σωλήνες', 'είναι αλλεργικός στο αλάτι', 'είναι επιθεωρητής υγείας', 'ζει σε μια γιούρτα', 'είναι τσάρος του ποπ κορν'],
      },
      'Greek',
    );
    expect(result.ok).toBe(true);
  });
});

describe('dedupe helpers', () => {
  it('produces the same key for punctuation/case variants', () => {
    expect(dedupeKey('A group of lions is called a pride.')).toBe(
      dedupeKey('a group of lions is called a pride'),
    );
  });

  it('produces a stable id', () => {
    expect(stableId('book', 'same text')).toBe(stableId('book', 'same text'));
    expect(stableId('book', 'same text')).not.toBe(stableId('book', 'different text'));
  });
});
