import type { AgentResult, TriviaFact } from '../types';
import { callDeepSeek, type Effort } from '../llm/deepseek';
import {
  architectSchema,
  criticSchema,
  editorSchema,
  extractionSchema,
  generatorSchema,
  linguistSchema,
  localizationSchema,
  parseSchema,
  scoreSchema,
  synthesisSchema,
  triageSchema,
  type ExtractedFact,
  type SynthesisResult,
} from '../llm/schemas';
import {
  ARCHITECT_SYSTEM,
  CRITIC_SYSTEM,
  EDITOR_SYSTEM,
  EXTRACT_SYSTEM,
  FIXER_SYSTEM,
  GENERATOR_SYSTEM,
  LINGUIST_SYSTEM,
  LOCALIZE_LIES_SYSTEM,
  LOCALIZE_SYSTEM,
  PARSE_SYSTEM,
  SCORE_SYSTEM,
  SYNTHESIZE_SYSTEM,
  TRIAGE_SYSTEM,
  architectPrompt,
  criticPrompt,
  editorPrompt,
  extractPrompt,
  fixerPrompt,
  generatorPrompt,
  linguistPrompt,
  localizeLiesPrompt,
  localizePrompt,
  parsePrompt,
  scorePrompt,
  synthesizePrompt,
  triagePrompt,
} from './prompts';

function configuredEffort(): Effort {
  const value = process.env.ARCHITECT_EFFORT;
  return value === 'low' || value === 'high' || value === 'max' ? value : 'high';
}

const JSON_EXAMPLES = {
  parse: '[{"fact":"...","answer":"...","category":"...","lies":["..."]}]',
  synthesize:
    '{"status":"ok","statement":"...","answer":"...","category":"...","confidence":0.95}',
  extract:
    '{"facts":[{"statement":"...","answer":"...","quote":"...","category":"History","period":"historical","confidence":0.9}]}',
  triage: '{"action":"KEEP_ALL"}',
  score:
    '{"funScore":8,"blankScore":7,"difficulty":"medium","timeless":true,"tone":"wholesome","reason":"..."}',
  architect: '{"newFact":"... <BLANK> ...","newAnswer":"..."}',
  critic: '{"score":8,"feedback":"..."}',
  generate: '{"rawLies":["...","...","...","...","...","...","...","..."]}',
  refine: '{"fixedLies":["...","...","...","...","..."]}',
  localize: '{"fact":"... <BLANK> ...","answer":"...","lies":["..."]}',
  linguist: '{"score":9,"issues":[]}',
  fixer: '{"fact":"... <BLANK> ...","answer":"...","lies":["..."]}',
} as const;

export async function parseRawInput(rawText: string): Promise<TriviaFact[]> {
  // Prefer a local parse: most inputs are already the app's JSON array.
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
      return parseSchema.parse(parsed) as TriviaFact[];
    }
  } catch {
    // Fall through to the LLM.
  }

  const result = await callDeepSeek({
    agent: 'parse',
    system: PARSE_SYSTEM,
    user: parsePrompt(rawText),
    schema: parseSchema,
    jsonExample: JSON_EXAMPLES.parse,
    thinking: false,
    temperature: 0,
    maxTokens: 4_096,
  });

  return result.data as TriviaFact[];
}

export async function synthesizeFact(input: {
  question: string;
  choices: string[];
  answer: string;
  category: string;
}): Promise<AgentResult<SynthesisResult>> {
  const result = await callDeepSeek({
    agent: 'synthesize',
    system: SYNTHESIZE_SYSTEM,
    user: synthesizePrompt(input),
    schema: synthesisSchema,
    jsonExample: JSON_EXAMPLES.synthesize,
    thinking: true,
    effort: configuredEffort(),
    maxTokens: 2_048,
  });

  return { data: result.data, usage: result.usage };
}

export async function extractBookFacts(
  section: { heading: string; text: string },
  language = 'English',
): Promise<AgentResult<{ facts: ExtractedFact[] }>> {
  const result = await callDeepSeek({
    agent: 'extract',
    system: EXTRACT_SYSTEM,
    user: `${extractPrompt(section)}\nLanguage of the output: ${language}.`,
    schema: extractionSchema,
    jsonExample: JSON_EXAMPLES.extract,
    thinking: true,
    effort: configuredEffort(),
    maxTokens: 4_096,
  });

  return { data: result.data, usage: result.usage };
}

export async function triageFact(  fact: TriviaFact,
  language = 'English',
): Promise<AgentResult<{ action: 'KEEP_ALL' | 'GENERATE_LIES' | 'FULL_OPTIMIZE' }>> {
  const result = await callDeepSeek({
    agent: 'triage',
    system: TRIAGE_SYSTEM,
    user: triagePrompt(fact, language),
    schema: triageSchema,
    jsonExample: JSON_EXAMPLES.triage,
    thinking: false,
    temperature: 0,
    maxTokens: 256,
  });

  return { data: result.data, usage: result.usage };
}

export async function scoreFact(
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
  const result = await callDeepSeek({
    agent: 'score',
    system: SCORE_SYSTEM,
    user: scorePrompt(statement, category),
    schema: scoreSchema,
    jsonExample: JSON_EXAMPLES.score,
    thinking: false,
    temperature: 0,
    maxTokens: 256,
  });

  return { data: result.data, usage: result.usage };
}

export async function optimizePlacement(
  currentFact: TriviaFact,
  avoidSentences: string[] = [],
  criticFeedback = '',
  language = 'English',
): Promise<AgentResult<{ newFact: string; newAnswer: string }>> {
  const result = await callDeepSeek({
    agent: 'architect',
    system: ARCHITECT_SYSTEM,
    user: architectPrompt(currentFact, avoidSentences, criticFeedback, language),
    schema: architectSchema,
    jsonExample: JSON_EXAMPLES.architect,
    thinking: true,
    effort: configuredEffort(),
    maxTokens: 3_072,
  });

  return { data: result.data, usage: result.usage };
}

export async function critiquePlacement(
  factWithBlank: string,
  answer: string,
  language = 'English',
): Promise<AgentResult<{ score: number; feedback?: string }>> {
  const result = await callDeepSeek({
    agent: 'critic',
    system: CRITIC_SYSTEM,
    user: criticPrompt(factWithBlank, answer, language),
    schema: criticSchema,
    jsonExample: JSON_EXAMPLES.critic,
    thinking: true,
    effort: configuredEffort(),
    maxTokens: 2_048,
  });

  return { data: result.data, usage: result.usage };
}

export async function generateRawLies(
  factWithBlank: string,
  answer: string,
  category: string,
  language = 'English',
): Promise<AgentResult<{ rawLies: string[] }>> {
  const result = await callDeepSeek({
    agent: 'generate',
    system: GENERATOR_SYSTEM,
    user: generatorPrompt(factWithBlank, answer, category, language),
    schema: generatorSchema,
    jsonExample: JSON_EXAMPLES.generate,
    thinking: true,
    effort: configuredEffort(),
    maxTokens: 4_096,
  });

  return { data: result.data, usage: result.usage };
}

export async function refineLies(
  factWithBlank: string,
  rawLies: string[],
  language = 'English',
): Promise<AgentResult<{ fixedLies: string[] }>> {
  const result = await callDeepSeek({
    agent: 'refine',
    system: EDITOR_SYSTEM,
    user: editorPrompt(factWithBlank, rawLies, language),
    schema: editorSchema,
    jsonExample: JSON_EXAMPLES.refine,
    thinking: false,
    temperature: 0.3,
    maxTokens: 1_024,
  });

  return { data: result.data, usage: result.usage };
}

export async function localizeContent(
  fact: TriviaFact,
  targetLanguage: string,
  feedback?: string,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  const result = await callDeepSeek({
    agent: 'localize',
    system: LOCALIZE_SYSTEM,
    user: localizePrompt(fact, targetLanguage, feedback),
    schema: localizationSchema,
    jsonExample: JSON_EXAMPLES.localize,
    thinking: false,
    temperature: 0.2,
    maxTokens: 2_048,
  });

  return { data: result.data, usage: result.usage };
}

export async function localizeLies(
  factContext: string,
  answerContext: string,
  sourceLies: string[],
  targetLanguage: string,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  const result = await callDeepSeek({
    agent: 'localize-lies',
    system: LOCALIZE_LIES_SYSTEM,
    user: localizeLiesPrompt(factContext, answerContext, sourceLies, targetLanguage),
    schema: localizationSchema,
    jsonExample: JSON_EXAMPLES.localize,
    thinking: false,
    temperature: 0.2,
    maxTokens: 2_048,
  });

  return { data: result.data, usage: result.usage };
}

export async function checkGrammar(
  factWithBlank: string,
  answer: string,
  lies: string[],
  targetLanguage: string,
  source?: TriviaFact,
): Promise<AgentResult<{ score: number; issues: string[] }>> {
  const result = await callDeepSeek({
    agent: 'linguist',
    system: LINGUIST_SYSTEM,
    user: linguistPrompt(factWithBlank, answer, lies, targetLanguage, source),
    schema: linguistSchema,
    jsonExample: JSON_EXAMPLES.linguist,
    thinking: false,
    temperature: 0,
    maxTokens: 512,
  });

  return { data: result.data, usage: result.usage };
}

export async function fixTranslation(
  factWithBlank: string,
  answer: string,
  lies: string[],
  issues: string[],
  targetLanguage: string,
  source?: TriviaFact,
): Promise<AgentResult<{ fact: string; answer: string; lies: string[] }>> {
  const result = await callDeepSeek({
    agent: 'fixer',
    system: FIXER_SYSTEM,
    user: fixerPrompt(factWithBlank, answer, lies, issues, targetLanguage, source),
    schema: localizationSchema,
    jsonExample: JSON_EXAMPLES.fixer,
    thinking: true,
    effort: 'low',
    maxTokens: 2_048,
  });

  return { data: result.data, usage: result.usage };
}

export type AgentName =
  | 'parse'
  | 'synthesize'
  | 'extract'
  | 'triage'
  | 'score'
  | 'architect'
  | 'critic'
  | 'generate'
  | 'refine'
  | 'localize'
  | 'localize-lies'
  | 'linguist'
  | 'fixer';
