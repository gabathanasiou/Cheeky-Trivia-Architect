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
10. Prefer facts whose answer is a short phrase of at most 5 words; the Architect must be able to blank it cleanly.
11. Only extract a fact if it has a clear surprising, ironic, or absurd detail. Reject dry biography, tributes, and "X was born" facts.
12. Prefer concrete, visual details over dates, numbers, and rankings. If the only interesting thing is a year, skip it.

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
4b. The answer should be a short phrase (at most 5 words / 45 characters).
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

export const ARCHITECT_SYSTEM = `You are a comedy architect for a bluffing trivia game. You place the <BLANK> wherever a wrong answer creates the funniest semantic shift — the subject, the object, the action, the consequence, the setup, or the punchline. Position is not the rule; the lie test is.`;

export function architectPrompt(
  currentFact: TriviaFact,
  avoidSentences: string[] = [],
  criticFeedback = '',
  language = 'English',
): string {
  const context = [
    avoidSentences.length > 0 ? `Previously rejected: ${JSON.stringify(avoidSentences)}` : '',
    criticFeedback ? `Comedy feedback: "${criticFeedback}"` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `Language: ${language}
Original input: "${currentFact.fact}"
Original answer: "${currentFact.answer}"
${context}

Task: rewrite the true statement so the <BLANK> hides the funniest detail.

Comedy rules (the whole point):
1. Blank the funniest replaceable detail. It can be the subject, the absurd object, the action, the consequence, the setup, or the punchline. A setup/subject blank can be the joke.
2. The lie test: imagine two concrete wrong answers. If they make you smile, keep the blank even if it is early in the sentence. If they are only synonyms or random numbers, move the blank.
3. High-risk positions: dates, years, numbers, percentages, bare connectors, vague nouns. They can work if the lies are specific and funny; otherwise move the blank. A long descriptive clause is almost always wrong.
4. Keep the sentence short, specific and factual. Remove throat-clearing and biography. Do not explain the joke.
5. Prefer the answer near the end when it is the punchline, but do not force it. A subject/setup blank can score 9.
6. The new answer must be at most 5 words / 45 characters and must be the exact text that fills the blank.
7. The rewrite must stay factually correct.

Examples:
- Good: "In Switzerland, it is illegal to own just one <BLANK>." -> "Guinea Pig". The blank is the absurd object.
- Good: "The inventor of the microwave only received <BLANK> for his discovery." -> "$2". The blank is the ironic reward.
- Good setup blank: "A group of <BLANK> is called a murder." -> "crows". The blank is the subject; lies "accountants", "lawyers", "teenagers" are funny.
- Good subject blank: "The fear of <BLANK> is called Lachanophobia." -> "vegetables". Lies "laughing", "shoelaces", "lunch" make the setup pay off.
- Bad: "In 1828, the river filled the tunnel in <BLANK>." -> "fifteen minutes". A number is not a joke.
- Bad: "Dr. Darwin projected a steam-carriage that was to use <BLANK>." -> "bird-like wings driven by high-pressure steam". A long technical clause; the funny object is the carriage.
- Better: "Dr. Darwin projected an <BLANK> that was to use bird-like wings powered by steam." -> "aerial steam-carriage".

Return JSON: { "newFact": "...", "newAnswer": "..." }`;
}

export const SCORE_SYSTEM = `You are a ruthless party-trivia curator. Rate whether a fact has a funny core before anyone writes a blank or a lie. Dry biography is not funny.`;

export function scorePrompt(statement: string, category: string): string {
  return `Fact: "${statement}"
Category: "${category}"

Is this worth retelling at a party? Would a wrong answer create a concrete, funny image?

funScore (1-10):
- 9-10: absurd, ironic, or "I can't believe that's true"; you would retell it.
- 7-8: surprising and specific; a strong lie can land.
- 5-6: mildly interesting or dry; needs a great lie to carry it.
- 1-4: biography, tribute, technical, obscure, dates, or no funny detail.

blankScore (1-10): can a well-placed blank hide a concrete, absurd detail?

difficulty: easy, medium or hard for an average adult.
timeless: false if it depends on "current", "recently", or a dated office-holder.
tone: wholesome, edgy or dark.

Return JSON: { "funScore": 1-10, "blankScore": 1-10, "difficulty": "...", "timeless": true, "tone": "...", "reason": "short reason only if funScore < 7" }`;
}

export const CRITIC_SYSTEM = `You are a ruthless comedy editor. Score the joke, not the grammar. A blank is only good if a wrong answer creates a concrete, funny image. Most blanks are mediocre; be strict.`;

export function criticPrompt(
  factWithBlank: string,
  answer: string,
  language = 'English',
): string {
  return `Language: ${language}
Candidate fact: "${factWithBlank}"
Answer: "${answer}"

You are the last gate before a party game. A blank is GOOD only when:
1. The fact has a surprising, ironic, or absurd core. A dry biography is not a joke.
2. The blank can be in the subject, setup, object or punchline. Do not penalise a blank just for being early. A date/number/connector/vague noun is high-risk, not an automatic reject; it passes only if the lies are concrete and funny.
3. You can immediately imagine two concrete, visual, plausible-but-absurd lies.
4. The sentence is short and specific; no throat-clearing.
5. The answer is the reveal; it can be early if the lies make the setup pay off.

Calibration examples:
- "In 1828, the river filled the tunnel in <BLANK>." / "fifteen minutes" -> number, no image; score 2.
- "Dr. Darwin projected a steam-carriage that was to use <BLANK>." / "bird-like wings driven by high-pressure steam" -> long technical clause; the funny object is the carriage; score 3.
- "The first cup of tea in England was drunk in <BLANK>." / "1660" -> date; score 2.
- "Dr. Darwin projected an <BLANK> that was to use bird-like wings powered by steam." / "aerial steam-carriage" -> the blank is the absurd object; score 9.
- "In Switzerland, it is illegal to own just one <BLANK>." / "Guinea Pig" -> the blank is the absurd thing; score 9.
- "The inventor of the microwave only received <BLANK> for his discovery." / "$2" -> ironic reward; score 9.
- "A group of <BLANK> is called a murder." / "crows" -> subject blank; lies "accountants", "lawyers", "teenagers" are funny; score 9.
- "The fear of <BLANK> is called Lachanophobia." / "vegetables" -> subject blank; the lies carry the joke; score 9.

Score 1-10:
- 9-10: retell-at-a-party; two funny lies are obvious, wherever the blank sits.
- 7-8: strong; a good lie can land; the blank is a real detail.
- 5-6: mildly interesting; the blank is okay but not the funniest place.
- 3-4: dry fact, or a date/number/connector/vague noun whose lies are just synonyms or random values.
- 1-2: no joke possible.

Also reject if the answer is longer than 5 words or 45 characters.
Return JSON: { "score": 1-10, "feedback": "if score < 8, name the funnier place to blank or say reject: dry fact" }`;
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
7. Each lie should create a concrete, visual image. Avoid generic alternatives like "a different animal" or "something else".

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
4. Keep them distinct: at least one plausible, one absurd image, and one with wordplay.
5. Reject lies that are generic, near-duplicates, or only a different number/date.

Return JSON: { "fixedLies": ["...", "..."] } with exactly 5 strings.`;
}

export const LOCALIZE_SYSTEM = `You are an expert cultural localization specialist. Translate trivia while preserving the <BLANK> tag and making every answer and lie pass the substitution test. In gendered languages, never leave an article directly before <BLANK>.`;

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
3. SUBSTITUTION TEST: replace <BLANK> with the answer, then with each lie. Every resulting sentence must be grammatical and natural.
4. Gendered languages: do NOT leave an article directly before <BLANK> (Greek: ένα/έναν/μία/μια/ο/η/το/τον/την/της/του/των + <BLANK>). Move the article INSIDE the answer and each lie instead. The fact should have a bare <BLANK>; every option must be a complete phrase with its own article. Examples: <BLANK> -> "ένα ινδικό χοιρίδιο", "μία σοκολάτα", "ο μονόκερος", "η γκάιντα", "το τέρας του Λοχ Νες".
5. If the source fact uses "the <BLANK>" or "a/an/one <BLANK>", remove the article from the fact and give every option its own natural article. Preserve quantity: "just one" must remain "μόνο ένα" when the answer is substituted.
6. Adapt puns and idioms so they sound natural and funny in ${targetLanguage}.
7. Keep lies under 30 characters.

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
2. Make every lie a complete phrase with its own article/determiner, and pass the substitution test in the localized fact. Do not leave bare nouns when the source had an article before the blank.
3. For Greek, bare noun phrases are preferred; do not leave an article directly before <BLANK>.
4. Adapt rather than translate literally when needed.
5. Keep the fact and answer unchanged.

Return JSON: { "fact": "${factContext}", "answer": "${answerContext}", "lies": ["..."] }`;
}

export const LINGUIST_SYSTEM = `You are a strict linguistic critic. Substitute every option into the blank and check whether the resulting sentence is grammatical. Score 9+ only if all substitutions read naturally.`;

export function linguistPrompt(
  factWithBlank: string,
  answer: string,
  lies: string[],
  targetLanguage: string,
  source?: TriviaFact,
): string {
  const sourceBlock = source
    ? `Source (English):
- Fact: "${source.fact}"
- Answer: "${source.answer}"

`
    : '';

  return `Language: ${targetLanguage}
${sourceBlock}Localized fact: "${factWithBlank}"
Answer: "${answer}"
Lies: ${JSON.stringify(lies)}

Check:
0. FIDELITY: does the localized answer mean exactly the same thing as the source answer? If it names a different animal, person, object, number or relationship, score <5 and list it. The localized fact must preserve the source claim.
1. SUBSTITUTION TEST: replace <BLANK> with the answer, then with each lie. Does every sentence read naturally?
2. Case agreement: do the answer and lies match the case required by the blank?
3. Gender agreement: do adjectives and articles match the context?
4. Number agreement: singular/plural consistency.
5. Greek article check: an article directly before <BLANK> ("ένα <BLANK>", "ο <BLANK>") is a red flag. If the options disagree in gender, report it and recommend removing the article.
6. Natural flow: does it sound like a native speaker wrote it?

Score 1-10:
- 10 = every substitution is perfect native grammar.
- 8-9 = minor awkwardness.
- below 8 = at least one substitution is wrong.
- below 5 = grammatical errors.

Return JSON: { "score": 1-10, "issues": ["..."] }`;
}

export const FIXER_SYSTEM = `You are a linguistic surgeon. Repair every reported grammar issue so every answer and lie passes the substitution test. You may remove an article before the blank or restructure the sentence.`;

export function fixerPrompt(
  factWithBlank: string,
  answer: string,
  lies: string[],
  issues: string[],
  targetLanguage: string,
  source?: TriviaFact,
): string {
  const sourceBlock = source
    ? `Source (English):
- Fact: "${source.fact}"
- Answer: "${source.answer}"

`
    : '';

  return `Language: ${targetLanguage}
${sourceBlock}Problematic input:
- Fact: "${factWithBlank}"
- Answer: "${answer}"
- Lies: ${JSON.stringify(lies)}
Reported issues: ${JSON.stringify(issues)}

Task: rewrite the content to fix every issue. Preserve the source meaning exactly: never substitute a different animal, person, object, number or relationship. You may change the sentence structure around the <BLANK> so the options fit better.
Return JSON: { "fact": "...", "answer": "...", "lies": ["..."] }`;
}
