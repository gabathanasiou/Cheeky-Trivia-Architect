import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QUESTIONS_EN } from '../../bamboozle/i18n/questions/en.ts';
import { QUESTIONS_EL } from '../../bamboozle/i18n/questions/el.ts';

/**
 * Merge the Architect's exports into Bamboozle without reformatting the existing
 * hand-curated arrays. The script is idempotent: it dedupes by normalised fact,
 * so running it twice does not duplicate questions.
 *
 * Run after the English and Greek jobs finish:
 *   npm run merge:game
 *   npm run merge:game -- --dry-run
 */

interface Question {
  fact: string;
  answer: string;
  category: string;
  lies: string[];
}

interface Candidate extends Partial<Question> {
  status?: 'fact' | 'question';
  statement?: string;
  funScore?: number;
  blankScore?: number;
  language?: string;
}

const ROOT = resolve(import.meta.dirname, '..');
const BAMBOOZLE = resolve(ROOT, '../bamboozle/i18n/questions');
const BOOK_EN = resolve(ROOT, 'data/exports/book-questions-v4.jsonl');
const APP_EL = resolve(ROOT, 'data/exports/app-questions-el.jsonl');
const BOOK_EL = resolve(ROOT, 'data/exports/book-questions-el.jsonl');
const MAP = resolve(ROOT, 'data/inputs/el-to-en-map.json');

const dryRun = process.argv.includes('--dry-run');

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readJsonl(path: string): Candidate[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Candidate);
  } catch {
    return [];
  }
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function format(question: Question): string {
  return `    {
        fact: "${escape(question.fact)}",
        answer: "${escape(question.answer)}",
        category: "${escape(question.category)}",
        lies: [${question.lies.map((lie) => `"${escape(lie)}"`).join(', ')}]
    }`;
}

function append(file: string, questions: Question[]): void {
  if (questions.length === 0) return;
  const text = readFileSync(file, 'utf8');
  const index = text.lastIndexOf('];');
  if (index === -1) throw new Error(`Could not find the array end in ${file}`);

  const before = text.slice(0, index).replace(/\s+$/, '');
  const comma = before.endsWith(',') ? '' : ',';
  const block = questions.map(format).join(',\n');
  const next = `${before}${comma}\n${block}\n\n];\n`;

  if (dryRun) {
    console.log(`[dry] would append ${questions.length} to ${file}`);
    return;
  }
  writeFileSync(file, next, 'utf8');
  console.log(`appended ${questions.length} to ${file}`);
}

function valid(question: Candidate): question is Candidate & Question {
  const { fact, answer, category, lies } = question;
  if (question.status !== 'question') return false;
  if (!fact || !answer || !category || !Array.isArray(lies)) return false;
  if (lies.length < 5) return false;
  if (words(answer) > 8 || answer.length > 60) return false;
  if ((fact.match(/<blank>/gi) ?? []).length !== 1) return false;
  if (normalise(fact).includes(normalise(answer))) return false;
  if (lies.some((lie) => !lie.trim() || lie.length > 30)) return false;
  if (lies.some((lie) => normalise(lie) === normalise(answer))) return false;
  return true;
}

function toQuestion(candidate: Candidate & Question): Question {
  return {
    fact: candidate.fact,
    answer: candidate.answer,
    category: candidate.category,
    lies: candidate.lies,
  };
}

// 1. New English book questions.
const seenEn = new Set(QUESTIONS_EN.map((question) => normalise(question.fact)));
const bookEn: Question[] = [];
for (const candidate of readJsonl(BOOK_EN)) {
  if (!valid(candidate)) continue;
  if ((candidate.funScore ?? 0) < 7) continue;
  if ((candidate.blankScore ?? 0) < 7) continue;
  const key = normalise(candidate.fact);
  if (seenEn.has(key)) continue;
  seenEn.add(key);
  bookEn.push(toQuestion(candidate));
}

// 2. Greek translations for the existing English questions that are missing.
const mapping = JSON.parse(readFileSync(MAP, 'utf8')) as {
  missing_en: number[];
};
const missingEn = new Set(mapping.missing_en);
const appElByStatement = new Map<string, Candidate & Question>();
for (const candidate of readJsonl(APP_EL)) {
  if (!valid(candidate) || !candidate.statement) continue;
  appElByStatement.set(normalise(candidate.statement), candidate);
}

const seenEl = new Set(QUESTIONS_EL.map((question) => normalise(question.fact)));
const missingEl: Question[] = [];
for (const index of missingEn) {
  const source = QUESTIONS_EN[index];
  if (!source) continue;
  const candidate = appElByStatement.get(normalise(source.fact));
  if (!candidate) {
    console.warn(`missing Greek candidate for EN ${index}: ${source.fact.slice(0, 70)}`);
    continue;
  }
  const key = normalise(candidate.fact);
  if (seenEl.has(key)) continue;
  seenEl.add(key);
  missingEl.push(toQuestion(candidate));
}

// 3. Greek translations for the new book questions (third job).
const bookEl: Question[] = [];
for (const candidate of readJsonl(BOOK_EL)) {
  if (!valid(candidate)) continue;
  const key = normalise(candidate.fact);
  if (seenEl.has(key)) continue;
  seenEl.add(key);
  bookEl.push(toQuestion(candidate));
}

console.log(`new English book questions: ${bookEn.length}`);
console.log(`missing Greek existing questions: ${missingEl.length} / ${missingEn.size}`);
console.log(`new Greek book questions: ${bookEl.length}`);
console.log(`existing EN ${QUESTIONS_EN.length}, existing EL ${QUESTIONS_EL.length}`);

append(resolve(BAMBOOZLE, 'en.ts'), bookEn);
append(resolve(BAMBOOZLE, 'el.ts'), [...missingEl, ...bookEl]);
