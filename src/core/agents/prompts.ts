import type { TriviaFact } from '../types';

export const PARSE_SYSTEM = `You are a data parser. Extract trivia facts from raw input into JSON.`;

export function parsePrompt(rawText: string): string {
  return `Extract a JSON array of trivia facts from this input. Each item needs fact, answer, category, lies.

Input:
${rawText}`;
}

export const SYNTHESIZE_SYSTEM = `You are a fact editor. You receive a multiple-choice trivia question, its choices, and the correct answer.
Your job is to write ONE self-contained, declarative, true statement that contains the correct answer.
Do not write a question. Do not mention the choices. Do not add jokes or commentary.
If the source cannot be turned into a clean standalone fact, reject it.`;

export const EXTRACT_SYSTEM = `You are a historical fact extractor for a bluffing trivia game.
You receive one section of a public-domain 19th-century book about inventions and discoveries.
Extract 0-3 atomic, standalone, declarative facts that are surprising, ironic, or absurd enough for a party game.

Rules:
1. Each fact must be supported by an EXACT quote copied from the section. Do not paraphrase the quote.
2. The statement must be a complete sentence that contains the answer.
3. Do not invent facts, dates, names, or numbers.
4. Do not present outdated 19th-century science as current truth. Prefer historical events, patents, deaths, failures, prices, and odd incidents.
5. Skip opinions, tributes, and long narrative passages with no checkable fact.
6. If nothing qualifies, return an empty facts array.
7. Allowed categories: History, Science, Tech Oops, Irony, Bizarre Records, People, General.
8. Keep each quote under 300 characters, but copy it exactly.
9. Do not use a pure number or date as the answer; pick a fact whose answer is a person, object, place, or phrase.

Return JSON: { "facts": [{ "statement": "...", "answer": "...", "quote": "...", "category": "...", "period": "historical", "confidence": 0.9 }] }`;

export function extractPrompt(section: {
  heading: string;
  text: string;
}): string {
  return `Section heading: ${section.heading}

Section text:
${section.text}

Extract 0-3 facts. The quote must be an exact substring of the section text.`;
}

export function synthesizePrompt(input: {
  question: string;
  choices: string[];
  answer: string;
  category: string;
}): string {
  return `Source:
- Question: ${input.question}
- Choices: ${JSON.stringify(input.choices)}
- Correct answer: ${input.answer}
- Category: ${input.category}

Rules:
1. The statement must be a complete, standalone sentence.
2. The correct answer must appear verbatim (case-insensitive) in the statement.
3. Do not include the other choices.
4. Do not write "None of these", "All of these", "True", or "False" as the answer.
5. If the source is ambiguous, disputed, or cannot be stated as one clean fact, return status "reject" with a short reason.
6. Set confidence from 0 to 1.

Return JSON with status, statement, answer, category, confidence, reason (only when rejecting).`;
}

export const TRIAGE_SYSTEM = `You are a senior comedy editor for a bluffing trivia game. Decide how much work an item needs.`;

export function triagePrompt(fact: TriviaFact, language = 'English'): string {
  return `Language: ${language}

Input:
- Fact: "${fact.fact}"
- Answer: "${fact.answer}"
- Current lies: ${JSON.stringify(fact.lies)}

Task: evaluate the item against these rules.

Checklist:
1. LENGTH: all lies must be strictly under 20 characters.
2. COMEDY: the <BLANK> must sit where a word or phrase can completely change the meaning and create a WTF or funny moment.
3. GRAMMAR: the answer and every lie must fit the blank grammatically and contextually.
4. QUALITY: lies should be cheeky and plausible, not just wrong numbers, dates, snarky comments, or near-truths.
5. The truth must not be a number.

Decision:
- KEEP_ALL: passes every check.
- GENERATE_LIES: the fact and blank are good, but the lies are weak, too long, or ungrammatical.
- FULL_OPTIMIZE: the fact is boring, the blank is in a boring place, or the concept needs a rewrite.

Return JSON: { "action": "KEEP_ALL" | "GENERATE_LIES" | "FULL_OPTIMIZE" }`;
}

export const ARCHITECT_SYSTEM = `You are a comedy architect. Rewrite a true fact and place a <BLANK> where the funniest, most surprising lies become possible.`;

export function architectPrompt(
  currentFact: TriviaFact,
  avoidSentences: string[] = [],
  criticFeedback = '',
  language = 'English',
): string {
  const context = [
    avoidSentences.length > 0 ? `Previously rejected: ${JSON.stringify(avoidSentences)}` : '',
    criticFeedback ? `Critic feedback: "${criticFeedback}"` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `Language: ${language}
Original input: "${currentFact.fact}"
Original answer: "${currentFact.answer}"
${context}

Task:
1. Understand the full true statement by combining the input and the answer.
2. Rewrite the sentence and place a <BLANK> where it invites the funniest, most WTF lies that can take the fact in a different direction. The blank may be more than one word.
3. The blank does not have to be where the original input put it.
4. Extract the new true answer that fills your new <BLANK>.
5. The new composition must remain factually correct.

Guidelines:
- The sentence must be grammatically correct with the blank.
- newAnswer must be the exact text that fills the blank to make the sentence true.
- Return JSON: { "newFact": "...", "newAnswer": "..." }`;
}

export const CRITIC_SYSTEM = `You are a strict senior critic. Blindly score the comedic potential of a blank placement.`;

export const SCORE_SYSTEM = `You are a party trivia curator. Rate a fact's inherent entertainment value before anyone writes a blank or a lie.`;

export function scorePrompt(statement: string, category: string): string {
  return `Fact: "${statement}"
Category: "${category}"

Rate this fact for a bluffing party game.

funScore (1-10):
- 9-10: absurd, ironic, or "I can't believe that's true"
- 7-8: surprising and easy to understand
- 5-6: mildly interesting; needs a great lie to carry it
- 1-4: dry, technical, obscure, or a name nobody knows

blankScore (1-10): how much comedic potential a well-placed blank could have, even if the current wording has no blank.

difficulty: easy, medium or hard for an average adult.
timeless: false if it depends on "current", "recently", or a dated office-holder.
tone: wholesome, edgy or dark.

Return JSON: { "funScore": 1-10, "blankScore": 1-10, "difficulty": "...", "timeless": true, "tone": "...", "reason": "short reason only if funScore < 6" }`;
}export function criticPrompt(
  factWithBlank: string,
  answer: string,
  language = 'English',
): string {
  return `Language: ${language}
Candidate fact: "${factWithBlank}"
Answer: "${answer}"

Rate the comedic potential of this setup from 1 to 10.

Scoring:
- Does hiding this specific word or phrase create curiosity and many possible wrong answers?
- Does it allow WTF-style lies that take the fact in a totally different direction?
- Is the grammar seamless?
- Score below 7 if the blank hides a boring number or date.
- Score above 8 if the blank hides the punchline or the irony.

Return JSON: { "score": 1-10, "feedback": "short feedback, only when score < 7" }`;
}

export const GENERATOR_SYSTEM = `You are a deceptive trivia master. Generate funny, plausible lies that fit a blank.`;

export function generatorPrompt(
  factWithBlank: string,
  answer: string,
  category: string,
  language = 'English',
): string {
  return `Language: ${language}
Context: "${factWithBlank}"
Truth: "${answer}"
Category: "${category}"

Task: generate 8 funny, cheeky lies that fill the <BLANK>.
The lies should make sense with the sentence and sound plausible, not random. They should fool a human player into believing them. They can take the fact in a different WTF or funny direction while still sounding plausible.

Constraints:
1. Aim for at most 25 characters per lie.
2. Must fit grammatically into the blank.
3. No comments or meta-text.
4. Cheeky but plausible syntax.
5. They cannot be the truth, or very close to it.
6. Mix single words and short phrases. Be creative.

Return JSON: { "rawLies": ["...", "..."] } with exactly 8 strings.`;
}

export const EDITOR_SYSTEM = `You are a senior editor. Select and trim the best lies, keeping them short and grammatically seamless.`;

export function editorPrompt(
  factWithBlank: string,
  rawLies: string[],
  language = 'English',
): string {
  return `Language: ${language}
Context: "${factWithBlank}"
Candidates: ${JSON.stringify(rawLies)}

Task:
1. Select the 5 funniest and most plausible lies.
2. Rewrite any lie longer than 25 characters to be under 25 characters.
3. Ensure every lie fits the blank grammatically.
4. Keep them distinct in angle and wording.

Return JSON: { "fixedLies": ["...", "..."] } with exactly 5 strings.`;
}

export const LOCALIZE_SYSTEM = `You are an expert cultural localization specialist. Translate trivia while preserving the <BLANK> tag and grammatical fit.`;

export function localizePrompt(
  fact: TriviaFact,
  targetLanguage: string,
  feedback?: string,
): string {
  const guidance = feedback
    ? `\nUser feedback: "${feedback}". Adjust the translation to address it.`
    : '';

  return `Source language: English
Target language: ${targetLanguage}
Input:
- Fact: "${fact.fact}" (contains <BLANK>)
- Answer: "${fact.answer}"
- Lies: ${JSON.stringify(fact.lies)}
${guidance}

Task:
1. Translate the fact, answer, and lies into ${targetLanguage}.
2. Preserve <BLANK> exactly.
3. Make the answer and every lie fit the blank grammatically (case, gender, number).
4. Adapt puns and idioms so they sound natural and funny in ${targetLanguage}.
5. Keep lies under 30 characters.

Return JSON: { "fact": "...", "answer": "...", "lies": ["..."] }`;
}

export const LOCALIZE_LIES_SYSTEM = `You are a localization expert. Translate only the lies so they fit an already-localized fact.`;

export function localizeLiesPrompt(
  factContext: string,
  answerContext: string,
  sourceLies: string[],
  targetLanguage: string,
): string {
  return `Target language: ${targetLanguage}
Localized context:
- Fact: "${factContext}"
- Answer: "${answerContext}"
Source lies (English): ${JSON.stringify(sourceLies)}

Task:
1. Translate the lies into ${targetLanguage}.
2. Make them fit the blank grammatically and semantically.
3. Adapt rather than translate literally when needed.
4. Keep the fact and answer unchanged.

Return JSON: { "fact": "${factContext}", "answer": "${answerContext}", "lies": ["..."] }`;
}

export const LINGUIST_SYSTEM = `You are a strict linguistic critic. Check grammar, case, gender, and number agreement.`;

export function linguistPrompt(
  factWithBlank: string,
  answer: string,
  lies: string[],
  targetLanguage: string,
): string {
  return `Language: ${targetLanguage}
Fact: "${factWithBlank}"
Answer: "${answer}"
Lies: ${JSON.stringify(lies)}

Check:
1. Case agreement: do the answer and lies match the case required by the blank?
2. Gender agreement: do adjectives and articles match the context?
3. Number agreement: singular/plural consistency.
4. Natural flow: does it sound native?

Score 1-10:
- 10 = perfect native grammar.
- below 8 = minor awkwardness.
- below 5 = grammatical errors.

Return JSON: { "score": 1-10, "issues": ["..."] }`;
}

export const FIXER_SYSTEM = `You are a linguistic surgeon. Repair every reported grammar issue without changing the fact.`;

export function fixerPrompt(
  factWithBlank: string,
  answer: string,
  lies: string[],
  issues: string[],
  targetLanguage: string,
): string {
  return `Language: ${targetLanguage}
Problematic input:
- Fact: "${factWithBlank}"
- Answer: "${answer}"
- Lies: ${JSON.stringify(lies)}
Reported issues: ${JSON.stringify(issues)}

Task: rewrite the content to fix every issue. You may change the sentence structure around the <BLANK> so the options fit better.
Return JSON: { "fact": "...", "answer": "...", "lies": ["..."] }`;
}
