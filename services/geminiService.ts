import { GoogleGenAI, Type, Schema, GenerateContentResponse } from "@google/genai";
import { TriviaFact, AgentResponseCheck, AgentResponseRawLies, AgentResponseLieCheck, AgentResponseArchitect, TriageResult, AgentResult, TokenUsage } from "../types";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY environment variable is missing");
  }
  return new GoogleGenAI({ apiKey });
};

// Cost for Gemini 1.5 Flash (approximate)
const COST_PER_1M_INPUT = 0.075;
const COST_PER_1M_OUTPUT = 0.30;

const calculateUsage = (response: GenerateContentResponse): TokenUsage => {
  const promptTokens = response.usageMetadata?.promptTokenCount || 0;
  const candidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;
  
  const cost = (
    (promptTokens / 1_000_000) * COST_PER_1M_INPUT + 
    (candidatesTokens / 1_000_000) * COST_PER_1M_OUTPUT
  );

  return {
    promptTokens,
    candidatesTokens,
    totalTokens: promptTokens + candidatesTokens,
    estimatedCost: cost
  };
};

// ---------------------------------------------------------
// Helper: API Caller with Exponential Backoff
// ---------------------------------------------------------
const generateContentWithRetry = async (
  model: string, 
  contents: any, 
  config: any, 
  retries = 3, 
  delay = 2000
): Promise<GenerateContentResponse> => {
  const ai = getAiClient();
  try {
    return await ai.models.generateContent({ model, contents, config });
  } catch (error: any) {
    const msg = error.message?.toLowerCase() || "";
    const isRetryable = 
        msg.includes("429") || 
        msg.includes("quota") || 
        msg.includes("exhausted") || 
        msg.includes("503") || 
        msg.includes("overloaded") || 
        msg.includes("unavailable");

    if (isRetryable && retries > 0) {
      const nextDelay = delay * 2 + Math.random() * 1000;
      console.warn(`API Busy/Quota (Error ${error.code || 'Unknown'}). Retrying in ${Math.round(nextDelay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, nextDelay));
      return generateContentWithRetry(model, contents, config, retries - 1, nextDelay);
    }
    throw error;
  }
};

// ---------------------------------------------------------
// Agent 0: Raw Input Parser
// ---------------------------------------------------------
export const parseRawInput = async (rawText: string): Promise<TriviaFact[]> => {
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
       if ('fact' in parsed[0] && 'answer' in parsed[0]) {
          return parsed as TriviaFact[];
       }
    }
  } catch (e) {
    // Fallback to AI
  }

  const model = "gemini-3-flash-preview";
  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        fact: { type: Type.STRING },
        answer: { type: Type.STRING },
        category: { type: Type.STRING },
        lies: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["fact", "answer", "category", "lies"]
    }
  };

  const response = await generateContentWithRetry(
    model,
    `Extract JSON Array. Input: ${rawText}`,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Failed to parse input");
  return JSON.parse(response.text) as TriviaFact[];
};

// ---------------------------------------------------------
// Agent 0.5: Triage Officer (The Bouncer)
// ---------------------------------------------------------
export const triageFact = async (fact: TriviaFact, language: string = "English"): Promise<AgentResult<TriageResult>> => {
  const model = "gemini-3-flash-preview";
  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      action: { type: Type.STRING, enum: ['KEEP_ALL', 'GENERATE_LIES', 'FULL_OPTIMIZE'] }
    },
    required: ["action"]
  };

  const prompt = `
    Role: Senior Comedy Editor. Context: ${language}.
    Input:
    - Fact: "${fact.fact}"
    - Answer: "${fact.answer}"
    - Current Lies: ${JSON.stringify(fact.lies)}
    
    Task: Evaluate quality against STRICT Master Guidelines. Prioritise the fact. It needs to be fun to play. Then the lies.

    Checklist:
    1. LENGTH: Are ALL lies strictly under 20 characters?
    2. COMEDY: Is the <BLANK> placed simewhere in the sentence where by inputing a word or phrase can totally change the meaning and create WTF moments or comedy??
    2.2 IS THE COMEDY BORING? Can the sentense be rewriten in a better way for more comedic value? (rare but check)
    3. GRAMMAR: Do the answer and lies fit the blank seamlessly contextualy and grammaticaly correct?
    4. QUALITY: Are the lies cheeky/ironic (Good) or just wrong numbers/dates/snarky comments/too close to the truth/similar to eachother (Bad)?
    5. The truth should not be a number. 

Regarding the lies:
The lies should try to make sense with the big sentense and be plausible, not stupid. This is to fool the human player to actually believe it's true.
    The lies could take the fact to a completely different WTF or funny direction that still sounds plausable.
    
    Constraints:
    1. Aim for MAX 20 CHARACTERS per lie. Mostly short & punchy.
    2. Must fit grammatically into the blank.
    3. No comments/meta-text.
    4. Cheeky but plausible syntax.
    5. They can't be the truth. Or very close to it.


    Decision Logic:
    - KEEP_ALL: Passes ALL checks above perfectly. 
    - GENERATE_LIES: Fact placement is great/ironic, but lies are >20 chars, boring, or grammatically weak.
    - FULL_OPTIMIZE: Fact is boring, blank is in a boring spot, or the concept needs a rewrite.
  `;

  const response = await generateContentWithRetry(
    model,
    prompt,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Triage failed");
  return {
    data: JSON.parse(response.text) as TriageResult,
    usage: calculateUsage(response)
  };
};

// ---------------------------------------------------------
// Agent 1: The Architect (The Setup Man)
// ---------------------------------------------------------
export const optimizePlacement = async (
  currentFact: TriviaFact, 
  avoidSentences: string[] = [], 
  criticFeedback: string = "",
  language: string = "English"
): Promise<AgentResult<AgentResponseArchitect>> => {
  const model = "gemini-3-flash-preview";

  let contextPrompt = "";
  if (avoidSentences.length > 0) contextPrompt += `\nPreviously Rejected: ${JSON.stringify(avoidSentences)}`;
  if (criticFeedback) contextPrompt += `\nCritic Feedback: "${criticFeedback}"`;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      newFact: { type: Type.STRING },
      newAnswer: { type: Type.STRING }
    },
    required: ["newFact", "newAnswer"]
  };

  const prompt = `
    Role: Comedy Architect. Language: ${language}.
    Original Input: "${currentFact.fact}"
    Original Answer: "${currentFact.answer}"
    
    Task: 
    1. Understand the full true statement by combining the input and answer.
    2. Rewrite the sentence and place a <BLANK> in a position that invites the funniest, most "WTF" lies that can take the fact to a different direction! The blank can be more than one word long.
    3. IMPORTANT: The <BLANK> can be a different part of the sentence than the original input. It does NOT have to be at the end. It must be where funny sentenses could be created.
    4. You MUST extract the new True Answer that corresponds to your new <BLANK> position.
    5. The new composition should be factual correct.
    
    Guidelines:
    - The sentence must be grammatically correct with the blank.
    - The 'newAnswer' must be the exact text that fills the blank to make the sentence true.
    ${contextPrompt}
  `;

  const response = await generateContentWithRetry(
    model,
    prompt,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Architect failed");
  return {
    data: JSON.parse(response.text) as AgentResponseArchitect,
    usage: calculateUsage(response)
  };
};

// ---------------------------------------------------------
// Agent 2: The Critic (The Judge)
// ---------------------------------------------------------
export const critiquePlacement = async (factWithBlank: string, answer: string, language: string = "English"): Promise<AgentResult<AgentResponseCheck>> => {
  const model = "gemini-3-flash-preview";
  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      score: { type: Type.NUMBER },
      feedback: { type: Type.STRING }
    },
    required: ["score"]
  };

  // NOTE: No prior context is passed here. Blind test.
  const prompt = `
    Role: Senior Critic. Context: ${language}.
    Candidate Fact: "${factWithBlank}" 
    Answer: "${answer}"

    Task: Rate the comedic potential of this setup (1-10).
    
    Scoring Criteria:
    - Does hiding this specific word/phrase create curiosity and endless possibilites??
    - Does it allow for "WTF" style wrong answers that take the fact to a totally different direction?
    - Is the grammar seamless?
    - Score < 7 if the blank hides a boring number or date.
    - Score > 8 if the blank hides the "punchline" or irony.

    Return { score, feedback }. Be strict.
  `;

  const response = await generateContentWithRetry(
    model,
    prompt,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Critic failed");
  return {
    data: JSON.parse(response.text) as AgentResponseCheck,
    usage: calculateUsage(response)
  };
};

// ---------------------------------------------------------
// Agent 3: The Generator (The Idea Factory)
// ---------------------------------------------------------
export const generateRawLies = async (factWithBlank: string, answer: string, category: string, language: string = "English"): Promise<AgentResult<AgentResponseRawLies>> => {
  const model = "gemini-3-flash-preview";
  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      rawLies: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["rawLies"]
  };

  const prompt = `
    Role: Deceptive Trivia Master.
    Context: "${factWithBlank}"
    Truth: "${answer}"
    Category: "${category}"
    Language: ${language}
    
    Task: Generate 8 funny, cheeky lies to fill the <BLANK>. 
    The lies should try to make sense with the big sentense and be plausible, not stupid. This is to fool the human player to actually believe it's true.
    The lies could take the fact to a completely different WTF or funny direction that still sounds plausable and not random. Read the Context in a different way if possible even.
    
    Constraints:
    1. Aim for MAX 25 CHARACTERS per lie.
    2. Must fit grammatically into the blank.
    3. No comments/meta-text.
    4. Cheeky but plausible syntax.
    5. They can't be the truth. Or very close to it.
    6. Some can be a single word others a phrase. Be creative.
    
    Return exactly 8 strings.
  `;

  const response = await generateContentWithRetry(
    model,
    prompt,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Generator failed");
  return {
    data: JSON.parse(response.text) as AgentResponseRawLies,
    usage: calculateUsage(response)
  };
};

// ---------------------------------------------------------
// Agent 4: The Editor (The Scalpel)
// ---------------------------------------------------------
export const refineLies = async (factWithBlank: string, rawLies: string[], language: string = "English"): Promise<AgentResult<AgentResponseLieCheck>> => {
  const model = "gemini-3-flash-preview";
  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      fixedLies: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["fixedLies"]
  };

  const prompt = `
    Role: Senior Editor. Language: ${language}.
    Context: "${factWithBlank}"
    Candidates: ${JSON.stringify(rawLies)}
    
    Task:
    1. Select the top 5 funniest/best lies from the candidates that can create sentences that make sense practically when put into the original fact.
    2. REWRITE any lie longer than 20 characters to be < 20 characters. This is CRITICAL.
    3. Ensure strict grammatical fit with the sentence.
    
    Return exactly 5 optimized strings. Do it fast.
  `;

  const response = await generateContentWithRetry(
    model,
    prompt,
    { responseMimeType: "application/json", responseSchema }
  );

  if (!response.text) throw new Error("Editor failed");
  return {
    data: JSON.parse(response.text) as AgentResponseLieCheck,
    usage: calculateUsage(response)
  };
};

export const generateOptimizedLies = async () => { throw new Error("Deprecated: Use generateRawLies + refineLies"); }