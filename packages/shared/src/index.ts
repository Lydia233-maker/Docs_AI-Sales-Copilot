import { z } from 'zod';

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

// 当前挑选页仍用这一组，含「全部」。四个新场景见 AUDIENCE_SCENARIOS，接上页面前不要互换。
export const SCENARIOS = ['winback_dormant', 'all'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const AUDIENCE_SCENARIOS = [
  'winback_dormant',
  'repurchase',
  'first_to_second',
  'abandoned_checkout',
] as const;
export type AudienceScenario = (typeof AUDIENCE_SCENARIOS)[number];

export const AudienceScenarioSchema = z.enum(AUDIENCE_SCENARIOS);

export const FactDecisionBody = z
  .object({
    decision: z.enum(['confirm', 'dismiss']),
  })
  .strict();

export const UpdateLanguageBody = z
  .object({
    language: z.enum(LANGUAGES),
  })
  .strict();

export const UpdateCompanyAddressBody = z
  .object({
    companyAddress: z.string().trim().min(1, '请填写公司地址').max(300),
  })
  .strict();

const EMAIL_SOURCE = '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';
const PHONE_SOURCE = '\\+?\\d[\\d\\s()-]{7,}\\d';

export function containsEmail(text: string) {
  return new RegExp(EMAIL_SOURCE, 'i').test(text);
}

export function containsPhone(text: string) {
  return new RegExp(PHONE_SOURCE).test(text);
}

export function containsContactDetail(text: string) {
  return containsEmail(text) || containsPhone(text);
}

export function redactContact(text: string) {
  return text
    .replace(new RegExp(EMAIL_SOURCE, 'gi'), '[已隐藏]')
    .replace(new RegExp(PHONE_SOURCE, 'g'), '[已隐藏]');
}

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

export function draftIssues(body: string): { level: 'block'; message: string }[] {
  const issues: { level: 'block'; message: string }[] = [];
  if (!body.includes('{{unsubscribe_url}}')) {
    issues.push({ level: 'block', message: '缺少退订链接 {{unsubscribe_url}}' });
  }
  if (!body.includes('{{company_address}}')) {
    issues.push({ level: 'block', message: '缺少公司地址 {{company_address}}' });
  }
  for (const name of extractPlaceholders(body)) {
    if (!isAllowedPlaceholder(name)) {
      issues.push({ level: 'block', message: `未知的占位符 ${name}` });
    }
  }
  return issues;
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
    notes: z.array(
      z.string().refine((note) => !containsContactDetail(note), '备注里的邮箱或电话要先遮盖'),
    ),
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
  tag: z.string().trim().min(1, '标签不能为空').max(40, '标签最多 40 个字'),
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
