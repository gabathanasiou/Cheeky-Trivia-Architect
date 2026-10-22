import {
  checkGrammar,
  critiquePlacement,
  fixTranslation,
  generateRawLies,
  localizeContent,
  optimizePlacement,
  refineLies,
  scoreFact,
  triageFact,
} from '../core/agents/index';
import { answerTooLong, stableId, validateQuestion } from '../core/agents/validate';
import type { TokenUsage, TriageAction, TriviaFact } from '../core/types';
import { EMPTY_USAGE, addUsage } from '../core/llm/usage';
import type { Candidate, RunOptions, UsageSink } from './types';

export class SkipError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkipError';
  }
}

function skip(reason: string): never {
  throw new SkipError(reason);
}

function sourceForInput(index: number) {
  return {
    name: 'Manual input',
    url: '',
    license: 'user-provided',
    sourceId: `fact-${index}`,
  };
}

/**
 * The interactive optimizer, ported out of the browser. One fact in, zero or
 * one candidate out. Triage decides whether to keep, re-lie, or fully rewrite.
 */
export async function processFact(
  fact: TriviaFact,
  options: RunOptions,
  onUsage: UsageSink,
  index: number,
): Promise<Candidate[]> {
  let total: TokenUsage = { ...EMPTY_USAGE };
  const track = (stage: string, usage: TokenUsage) => {
    total = addUsage(total, usage);
    onUsage(stage, usage);
  };

  const category = fact.category || 'General';
  const scored = await scoreFact(fact.fact, category);
  track('score', scored.usage);

  const base = {
    id: stableId('input', `${fact.fact}-${fact.answer}`),
    status: 'question' as const,
    statement: fact.fact,
    answer: fact.answer,
    category,
    funScore: scored.data.funScore,
    difficulty: scored.data.difficulty,
    timeless: scored.data.timeless,
    tone: scored.data.tone,
    language: options.language,
    source: sourceForInput(index),
  };

  if (options.mode === 'localization') {
    const bridge = await localizeContent(fact, options.language);
    track('localize', bridge.usage);

    let localized = bridge.data;

    // Deterministic checks first (blank/answer/lies, Greek article trap).
    const preGate = validateQuestion(
      {
        fact: localized.fact,
        answer: localized.answer,
        category,
        lies: localized.lies,
      },
      { minLies: 5, language: options.language, maxAnswerWords: 8, maxAnswerChars: 60 },
    );
    if (!preGate.ok) {
      const fixed = await fixTranslation(
        localized.fact,
        localized.answer,
        localized.lies,
        preGate.errors,
        options.language,
        fact,
      );
      track('fixer', fixed.usage);
      localized = fixed.data;
    }

    const linguist = await checkGrammar(
      localized.fact,
      localized.answer,
      localized.lies,
      options.language,
      fact,
    );
    track('linguist', linguist.usage);

    if (linguist.data.score < 9 && linguist.data.issues.length > 0) {
      const fixed = await fixTranslation(
        localized.fact,
        localized.answer,
        localized.lies,
        linguist.data.issues,
        options.language,
        fact,
      );
      track('fixer', fixed.usage);
      localized = fixed.data;
    }

    const gate = validateQuestion(
      {
        fact: localized.fact,
        answer: localized.answer,
        category,
        lies: localized.lies,
      },
      { minLies: 5, language: options.language, maxAnswerWords: 8, maxAnswerChars: 60 },
    );
    if (!gate.ok) skip(`localization gate: ${gate.errors.join('; ')}`);

    return [
      {
        ...base,
        fact: localized.fact,
        answer: localized.answer,
        lies: localized.lies,
        blankScore: scored.data.blankScore,
        usage: total,
      },
    ];
  }

  let current: TriviaFact = {
    fact: fact.fact,
    answer: fact.answer,
    category,
    lies: fact.lies ?? [],
  };
  let blankScore = scored.data.blankScore;

  // A bare statement has no blank yet: force the Architect path and skip triage.
  const hasBlank = /<blank>/i.test(current.fact);
  let action: TriageAction;
  if (!hasBlank || answerTooLong(current.answer)) {
    action = 'FULL_OPTIMIZE';
  } else {
    const triage = await triageFact(current, options.language);
    track('triage', triage.usage);
    action = current.lies.length >= 5 ? triage.data.action : 'GENERATE_LIES';
  }

  if (action === 'FULL_OPTIMIZE') {
    let placement = await optimizePlacement(current, [], '', options.language);
    track('architect', placement.usage);
    let critique = await critiquePlacement(
      placement.data.newFact,
      placement.data.newAnswer,
      options.language,
    );
    track('critic', critique.usage);

    const tooLong = answerTooLong(placement.data.newAnswer);
    if (critique.data.score < 8 || tooLong) {
      const feedback = [
        critique.data.feedback ?? '',
        tooLong
          ? `The answer "${placement.data.newAnswer}" is too long; it must be at most 5 words and 45 characters. Choose a shorter blank.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');

      placement = await optimizePlacement(
        current,
        [placement.data.newFact],
        feedback,
        options.language,
      );
      track('architect', placement.usage);
      critique = await critiquePlacement(
        placement.data.newFact,
        placement.data.newAnswer,
        options.language,
      );
      track('critic', critique.usage);
    }

    if (answerTooLong(placement.data.newAnswer)) {
      skip(`answer too long: "${placement.data.newAnswer}"`);
    }
    if (critique.data.score < 7) skip(`comedy score ${critique.data.score}`);

    current = {
      ...current,
      fact: placement.data.newFact,
      answer: placement.data.newAnswer,
    };
    blankScore = critique.data.score;
  }

  if (action !== 'KEEP_ALL') {
    const generated = await generateRawLies(
      current.fact,
      current.answer,
      current.category,
      options.language,
    );
    track('generate', generated.usage);

    const edited = await refineLies(current.fact, generated.data.rawLies, options.language);
    track('refine', edited.usage);

    current = { ...current, lies: edited.data.fixedLies };
  }

  const gate = validateQuestion(current, { minLies: 5 });
  if (!gate.ok) skip(`question gate: ${gate.errors.join('; ')}`);

  return [
    {
      ...base,
      fact: current.fact,
      answer: current.answer,
      lies: current.lies,
      blankScore,
      usage: total,
    },
  ];
}
