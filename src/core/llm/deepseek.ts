import type { ZodType } from 'zod';
import { usageFromResponse } from './usage';
import type { TokenUsage } from '../types';
import { mockCall } from './mock';

export type Effort = 'low' | 'high' | 'max';

export interface LlmCallOptions<T> {
  /** Used for logging and deterministic mock fixtures. */
  agent: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  jsonExample: string;
  /** Thinking mode is opt-in; mechanical agents run without it. */
  thinking?: boolean;
  effort?: Effort;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallResult<T> {
  data: T;
  usage: TokenUsage;
  raw: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 120_000;

function config() {
  return {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  };
}

export function isMockMode(): boolean {
  return process.env.DEEPSEEK_MOCK === '1';
}

export function hasApiKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseJson(text: string): unknown {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the outermost object/array. JSON mode should make this
    // unnecessary, but it turns a hard failure into a recoverable one.
    const start = Math.min(
      ...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0),
    );
    if (Number.isFinite(start)) {
      const candidate = cleaned.slice(start);
      return JSON.parse(candidate);
    }
    throw new Error(`Response was not JSON: ${cleaned.slice(0, 200)}`);
  }
}

function retryDelay(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 500);
}

export async function callDeepSeek<T>(options: LlmCallOptions<T>): Promise<LlmCallResult<T>> {
  if (isMockMode()) return mockCall(options);

  const { apiKey, baseUrl, model } = config();
  if (!apiKey && !isMockMode()) {
    throw new LlmError(
      'DEEPSEEK_API_KEY is not set. Add it to .env.local (CLI/server only) or set DEEPSEEK_MOCK=1.',
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content: `${options.system}\n\nRespond with a single JSON value and nothing else. JSON shape example:\n${options.jsonExample}`,
      },
      { role: 'user', content: options.user },
    ],
    response_format: { type: 'json_object' },
    max_tokens: options.maxTokens ?? 2_048,
  };

  if (options.thinking) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = options.effort ?? 'high';
  } else {
    body.thinking = { type: 'disabled' };
    body.temperature = options.temperature ?? 0.2;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const retryable = RETRYABLE_STATUS.has(response.status);
        throw new LlmError(
          `DeepSeek ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
          response.status,
          retryable,
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: Parameters<typeof usageFromResponse>[0];
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmError('DeepSeek returned an empty response', undefined, true);
      }

      let parsed: unknown;
      try {
        parsed = parseJson(content);
      } catch (error) {
        throw new LlmError(
          `Invalid JSON: ${error instanceof Error ? error.message : String(error)}\nRaw: ${content.slice(0, 800)}`,
          undefined,
          true,
        );
      }

      let data: T;
      try {
        data = options.schema.parse(parsed);
      } catch (error) {
        throw new LlmError(
          `Schema validation failed: ${error instanceof Error ? error.message : String(error)}\nRaw: ${content.slice(0, 800)}`,
          undefined,
          true,
        );
      }

      return {
        data,
        usage: usageFromResponse(json.usage),
        raw: content,
      };
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof LlmError ? error.retryable : true;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(retryDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new LlmError('DeepSeek request failed');
}
