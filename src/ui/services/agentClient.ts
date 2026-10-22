import type { AgentResult, TriviaFact } from '../../core/types';
import type { ExtractedFact, SynthesisResult } from '../../core/llm/schemas';

async function callAgent<T>(name: string, args: unknown[]): Promise<T> {
  const response = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Agent "${name}" failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function parseRawInput(rawText: string): Promise<TriviaFact[]> {
  try {
    const parsed = JSON.parse(rawText);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      parsed[0] !== null &&
      'fact' in parsed[0] &&
      'answer' in parsed[0]
    ) {
      return parsed as TriviaFact[];
    }
  } catch {
    // The server will try to parse it with the LLM.
  }

  return callAgent<TriviaFact[]>('parse', [rawText]);
}

export function synthesizeFact(input: {
  question: string;
  choices: string[];
  answer: string;
  category: string;
}): Promise<AgentResult<SynthesisResult>> {
  return callAgent('synthesize', [input]);
}

export function extractBookFacts(
  section: { heading: string; text: string },
  language = 'English',
): Promise<AgentResult<{ facts: ExtractedFact[] }>> {
  return callAgent('extract', [section, language]);
}

export function triageFact(
  fact: TriviaFact,
  language = 'English',
): Promise<AgentResult<{ action: 'KEEP_ALL' | 'GENERATE_LIES' | 'FULL_OPTIMIZE' }>> {
  return callAgent('triage', [fact, language]);
}

export function scoreFact(
  statement: string,
  category: string,
): Promise<AgentResult<{
  funScore: number;
  blankScore: number;
  difficulty: 'easy' | 'medium' | 'hard';
  timeless: boolean;
  tone: 'wholesome' | 'edgy' | 'dark';
  reason?: string;
}>> {
  return callAgent('score', [statement, category]);
}

export function optimizePlacement(
  currentFact: TriviaFact,
  avoidSentences: string[] = [],
  criticFeedback = '',
  language = 'English',
): Promise<AgentResult<{ newFact: string; newAnswer: string }>> {
  return callAgent('architect', [currentFact, avoidSentences, criticFeedback, language]);
}

export function critiquePlacement(
  factWithBlank: string,
  answer: string,
  language = 'English',
): Promise<AgentResult<{ score: number; feedback?: string }>> {
  return callAgent('critic', [factWithBlank, answer, language]);
}

export function generateRawLies(
  factWithBlank: string,
  answer: string,
  category: string,
  language = 'English',
): Promise<AgentResult<{ rawLies: string[] }>> {
  return callAgent('generate', [factWithBlank, answer, category, language]);
}

export function refineLies(
  factWithBlank: string,
  rawLies: string[],
  language = 'English',
): Promise<AgentResult<{ fixedLies: string[] }>> {
  return callAgent('refine', [factWithBlank, rawLies, language]);
}

export function localizeContent(
  fact: TriviaFact,
  targetLanguage: string,
  feedback?: string,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  return callAgent('localize', [fact, targetLanguage, feedback]);
}

export function localizeLies(
  factContext: string,
  answerContext: string,
  sourceLies: string[],
  targetLanguage: string,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  return callAgent('localize-lies', [factContext, answerContext, sourceLies, targetLanguage]);
}

export function checkGrammar(
  factWithBlank: string,
  answer: string,
  lies: string[],
  targetLanguage: string,
): Promise<AgentResult<{ score: number; issues: string[] }>> {
  return callAgent('linguist', [factWithBlank, answer, lies, targetLanguage]);
}

export function fixTranslation(
  factWithBlank: string,
  answer: string,
  lies: string[],
  issues: string[],
  targetLanguage: string,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  return callAgent('fixer', [factWithBlank, answer, lies, issues, targetLanguage]);
}
