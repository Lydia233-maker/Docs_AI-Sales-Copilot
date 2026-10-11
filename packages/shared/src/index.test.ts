import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AudienceScenarioSchema,
  CustomerBriefSchema,
  FactDecisionBody,
  PreviewAudienceBody,
  UpdateCompanyAddressBody,
  UpdateLanguageBody,
  extractPlaceholders,
  draftIssues,
  isAllowedPlaceholder,
  redactContact,
} from './index.ts';

test('placeholder whitelist', () => {
  assert.equal(isAllowedPlaceholder('unsubscribe_url'), true);
  assert.equal(isAllowedPlaceholder('frist_name'), false);
  assert.deepEqual(extractPlaceholders('Hi {{first_name}}, {{discount_code}}'), [
    'first_name',
    'discount_code',
  ]);
  const issues = draftIssues('Hi {{first_name}} {{not_a_field}}');
  assert.equal(issues.some((issue) => issue.message.includes('退订')), true);
  assert.equal(issues.some((issue) => issue.message.includes('公司地址')), true);
  assert.equal(issues.some((issue) => issue.message.includes('not_a_field')), true);
  assert.equal(draftIssues('Hi {{first_name}}\n{{unsubscribe_url}}\n{{company_address}}').length, 0);
});

test('customer brief rejects personal fields', () => {
  const ok = CustomerBriefSchema.safeParse({
    language: 'en',
    country: 'US',
    orderCount: 2,
    spendTier: 'high',
    daysSinceLastOrder: 80,
    purchases: [{ title: 'Cat Litter', category: 'litter', daysAgo: 80 }],
    preferenceTags: [],
    notes: ['likes dust-free litter'],
  });
  assert.equal(ok.success, true);

  const bad = CustomerBriefSchema.safeParse({
    language: 'en',
    country: 'US',
    orderCount: 2,
    spendTier: 'high',
    daysSinceLastOrder: 80,
    purchases: [],
    preferenceTags: [],
    notes: [],
    email: 'ann@example.com',
  });
  assert.equal(bad.success, false);

  const withName = CustomerBriefSchema.safeParse({
    language: 'en',
    country: 'US',
    orderCount: 1,
    spendTier: 'low',
    daysSinceLastOrder: null,
    purchases: [],
    preferenceTags: [],
    notes: [],
    firstName: 'Anna',
  });
  assert.equal(withName.success, false);

  const withPhone = CustomerBriefSchema.safeParse({
    language: 'es',
    country: 'MX',
    orderCount: 1,
    spendTier: 'low',
    daysSinceLastOrder: null,
    purchases: [],
    preferenceTags: [],
    notes: [],
    phone: '+15551212',
  });
  assert.equal(withPhone.success, false);

  const noteWithEmail = CustomerBriefSchema.safeParse({
    language: 'en',
    country: 'US',
    orderCount: 1,
    spendTier: 'low',
    daysSinceLastOrder: null,
    purchases: [],
    preferenceTags: [],
    notes: ['联系 ann@example.com'],
  });
  assert.equal(noteWithEmail.success, false);

  const redacted = CustomerBriefSchema.safeParse({
    language: 'en',
    country: 'US',
    orderCount: 1,
    spendTier: 'low',
    daysSinceLastOrder: null,
    purchases: [],
    preferenceTags: [],
    notes: [redactContact('联系 ann@example.com 或 +1 555 010 2000')],
  });
  assert.equal(redacted.success, true);
});

test('audience scenario allows only the four scenes', () => {
  for (const scenario of ['winback_dormant', 'repurchase', 'first_to_second', 'abandoned_checkout']) {
    assert.equal(AudienceScenarioSchema.safeParse(scenario).success, true);
  }
  assert.equal(AudienceScenarioSchema.safeParse('all').success, false);
  assert.equal(AudienceScenarioSchema.safeParse('holiday').success, false);
});

test('preview and create use the four audience scenes', () => {
  assert.equal(PreviewAudienceBody.safeParse({ scenario: 'winback_dormant' }).success, true);
  assert.equal(PreviewAudienceBody.safeParse({ scenario: 'repurchase' }).success, true);
  assert.equal(PreviewAudienceBody.safeParse({ scenario: 'all' }).success, false);
  assert.equal(PreviewAudienceBody.safeParse({ scenario: 'winback_dormant', email: 'a@example.com' }).success, false);
});

test('fact, language, and address bodies', () => {
  assert.equal(FactDecisionBody.safeParse({ decision: 'confirm' }).success, true);
  assert.equal(FactDecisionBody.safeParse({ decision: 'dismiss' }).success, true);
  assert.equal(FactDecisionBody.safeParse({ decision: 'reject' }).success, false);
  assert.equal(UpdateLanguageBody.safeParse({ language: 'es' }).success, true);
  assert.equal(UpdateLanguageBody.safeParse({ language: 'fr' }).success, false);
  assert.equal(UpdateCompanyAddressBody.safeParse({ companyAddress: '456 Market St' }).success, true);
  assert.equal(UpdateCompanyAddressBody.safeParse({ companyAddress: '   ' }).success, false);
  assert.equal(UpdateCompanyAddressBody.safeParse({ companyAddress: 'a'.repeat(301) }).success, false);
  assert.equal(FactDecisionBody.safeParse({ decision: 'confirm', email: 'ann@example.com' }).success, false);
  assert.equal(UpdateLanguageBody.safeParse({ language: 'en', scenario: 'all' }).success, false);
  assert.equal(
    UpdateCompanyAddressBody.safeParse({ companyAddress: '456 Market St', email: 'ann@example.com' }).success,
    false,
  );
});
