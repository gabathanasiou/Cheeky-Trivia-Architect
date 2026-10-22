import { z } from 'zod';

export const triageSchema = z.object({
  action: z.enum(['KEEP_ALL', 'GENERATE_LIES', 'FULL_OPTIMIZE']),
});

export const architectSchema = z.object({
  newFact: z.string().min(1),
  newAnswer: z.string().min(1),
});

export const criticSchema = z.object({
  score: z.number().min(1).max(10),
  feedback: z.string().optional(),
});

export const generatorSchema = z.object({
  rawLies: z.array(z.string().min(1)).min(5).max(20),
});

export const editorSchema = z.object({
  fixedLies: z.array(z.string().min(1)).min(5).max(20),
});

export const localizationSchema = z.object({
  fact: z.string().min(1),
  answer: z.string().min(1),
  lies: z.array(z.string().min(1)).min(5).max(20),
});

export const linguistSchema = z.object({
  score: z.number().min(1).max(10),
  issues: z.array(z.string()),
});

export const scoreSchema = z.object({
  funScore: z.number().min(1).max(10),
  blankScore: z.number().min(1).max(10),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  timeless: z.boolean(),
  tone: z.enum(['wholesome', 'edgy', 'dark']),
  reason: z.string().optional(),
});

export const parseSchema = z.array(
  z.object({
    fact: z.string().min(1),
    answer: z.string().min(1),
    category: z.string().min(1),
    lies: z.array(z.string().min(1)).min(1),
  }),
);

export const synthesisSchema = z.object({
  status: z.enum(['ok', 'reject']),
  statement: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export const extractionSchema = z.object({
  facts: z
    .array(
      z.object({
        statement: z.string().min(1),
        answer: z.string().min(1),
        quote: z.string().min(1),
        category: z.string().min(1),
        period: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(5),
});

export type SynthesisResult = z.infer<typeof synthesisSchema>;
export type ExtractedFact = z.infer<typeof extractionSchema>['facts'][number];
