import { z } from 'zod';

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const SCENARIOS = ['winback_dormant', 'all'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const PLACEHOLDERS = [
  'first_name',
  'last_product',
  'discount_code',
  'unsubscribe_url',
  'company_address',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export function isAllowedPlaceholder(name: string): boolean {
  return (PLACEHOLDERS as readonly string[]).includes(name);
}

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    found.add(match[1]);
  }
  return [...found];
}

export const CustomerBriefSchema = z
  .object({
    language: z.enum(LANGUAGES),
    country: z.string(),
    orderCount: z.number(),
    spendTier: z.enum(['high', 'mid', 'low']),
    daysSinceLastOrder: z.number().nullable(),
    purchases: z.array(
      z.object({
        title: z.string(),
        category: z.string(),
        daysAgo: z.number(),
      }),
    ),
    preferenceTags: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .strict();

export type CustomerBrief = z.infer<typeof CustomerBriefSchema>;

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const AddNoteBody = z.object({
  text: z.string().trim().min(1, '备注不能为空').max(2000),
});

export const AddPreferenceTagBody = z.object({
  tag: z.string().trim().min(1, '标签不能为空').max(40),
});

export const PreviewAudienceBody = z.object({
  scenario: z.enum(SCENARIOS),
  language: z.enum(LANGUAGES).optional(),
  hasNotes: z.boolean().optional(),
});

export const CreateOutreachBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  intentZh: z.string().trim().min(1, '请填写推广意图'),
  scenario: z.enum(SCENARIOS),
  language: z.enum(LANGUAGES).optional(),
  hasNotes: z.boolean().optional(),
  discountCode: z.string().trim().optional(),
});

export const ReviewDraftBody = z.object({
  decision: z.enum(['approve', 'reject']),
});

export const UpdateDraftBody = z.object({
  subject: z.string().optional(),
  body: z.string().optional(),
});

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  DRAFT_HAS_BLOCKING_ISSUES: 'DRAFT_HAS_BLOCKING_ISSUES',
  NO_ELIGIBLE_RECIPIENTS: 'NO_ELIGIBLE_RECIPIENTS',
  MISSING_UNSUBSCRIBE: 'MISSING_UNSUBSCRIBE',
} as const;
