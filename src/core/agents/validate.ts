export interface FactCandidate {
  statement: string;
  answer: string;
  category: string;
  quote?: string;
  confidence?: number;
}

export interface QuestionCandidate {
  fact: string;
  answer: string;
  category: string;
  lies: string[];
}

export interface GateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const BANNED_ANSWERS = new Set(['none of these', 'all of these', 'true', 'false']);

export const MAX_ANSWER_WORDS = 5;
export const MAX_ANSWER_CHARS = 45;

export function answerWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function answerTooLong(text: string): boolean {
  return answerWordCount(text) > MAX_ANSWER_WORDS || text.trim().length > MAX_ANSWER_CHARS;
}

export function normalize(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function dedupeKey(statement: string): string {
  return normalize(statement).replace(/[^\p{L}\p{N} ]/gu, '');
}

export function isDuplicate(statement: string, seen: Set<string>): boolean {
  return seen.has(dedupeKey(statement));
}

export function remember(statement: string, seen: Set<string>): void {
  seen.add(dedupeKey(statement));
}

export function validateFact(
  fact: FactCandidate,
  options: {
    sectionText?: string;
    minLength?: number;
    maxLength?: number;
    rejectNumericAnswers?: boolean;
  } = {},
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minLength = options.minLength ?? 20;
  const maxLength = options.maxLength ?? 260;

  const statement = fact.statement.trim();
  const answer = fact.answer.trim();

  if (statement.length < minLength) errors.push(`statement too short (${statement.length})`);
  if (statement.length > maxLength) errors.push(`statement too long (${statement.length})`);
  if (statement.endsWith('?')) errors.push('statement is a question');
  if (!answer) errors.push('answer is empty');
  if (BANNED_ANSWERS.has(normalize(answer))) errors.push(`banned answer "${answer}"`);
  if (answer && !normalize(statement).includes(normalize(answer))) {
    errors.push('answer does not appear in the statement');
  }
  if (/^\d[\d.,%/-]*$/.test(answer)) {
    if (options.rejectNumericAnswers) errors.push('answer is a number/date');
    else warnings.push('answer is a number/date');
  }
  if (!fact.category.trim()) errors.push('category is empty');

  if (fact.quote !== undefined && options.sectionText !== undefined) {
    const section = normalize(options.sectionText);
    if (!section.includes(normalize(fact.quote))) {
      errors.push('quote is not an exact substring of the section');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateQuestion(
  question: QuestionCandidate,
  options: {
    minLies?: number;
    maxLies?: number;
    maxLieLength?: number;
    maxAnswerWords?: number;
    maxAnswerChars?: number;
  } = {},
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const minLies = options.minLies ?? 5;
  const maxLies = options.maxLies ?? 15;
  const maxLieLength = options.maxLieLength ?? 30;
  const maxAnswerWords = options.maxAnswerWords ?? MAX_ANSWER_WORDS;
  const maxAnswerChars = options.maxAnswerChars ?? MAX_ANSWER_CHARS;

  const fact = question.fact.trim();
  const answer = question.answer.trim();
  const blankCount = (fact.match(/<blank>/gi) ?? []).length;

  if (blankCount !== 1) errors.push(`expected exactly one <BLANK>, found ${blankCount}`);
  if (!answer) errors.push('answer is empty');
  if (answerWordCount(answer) > maxAnswerWords) {
    errors.push(`answer too long (${answerWordCount(answer)} words, max ${maxAnswerWords})`);
  }
  if (answer.length > maxAnswerChars) {
    errors.push(`answer too long (${answer.length} chars, max ${maxAnswerChars})`);
  }
  if (normalize(fact).includes(normalize(answer))) {
    errors.push('answer is leaked in the fact');
  }
  if (/<blank>/i.test(answer)) errors.push('answer contains <BLANK>');
  if (!fact.includes('<BLANK>')) warnings.push('blank is not uppercase <BLANK>');
  if (!question.category.trim()) errors.push('category is empty');

  if (question.lies.length < minLies) {
    errors.push(`expected at least ${minLies} lies, found ${question.lies.length}`);
  }
  if (question.lies.length > maxLies) {
    errors.push(`expected at most ${maxLies} lies, found ${question.lies.length}`);
  }

  const normalizedLies = new Set<string>();
  for (const lie of question.lies) {
    const value = lie.trim();
    if (!value) {
      errors.push('empty lie');
      continue;
    }
    if (value.length > maxLieLength) {
      errors.push(`lie too long (${value.length}): "${value}"`);
    }
    if (/<blank>/i.test(value)) errors.push(`lie contains <BLANK>: "${value}"`);
    if (normalize(value) === normalize(answer)) errors.push(`lie equals the answer: "${value}"`);
    const key = normalize(value);
    if (normalizedLies.has(key)) errors.push(`duplicate lie: "${value}"`);
    normalizedLies.add(key);
  }

  if (question.lies.length > 0 && normalizedLies.size !== question.lies.length) {
    warnings.push('lies are not unique');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function stableId(prefix: string, text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
