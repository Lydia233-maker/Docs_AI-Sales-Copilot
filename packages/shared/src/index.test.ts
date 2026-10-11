import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CustomerBriefSchema,
  extractPlaceholders,
  isAllowedPlaceholder,
} from './index.ts';

test('placeholder whitelist', () => {
  assert.equal(isAllowedPlaceholder('unsubscribe_url'), true);
  assert.equal(isAllowedPlaceholder('frist_name'), false);
  assert.deepEqual(extractPlaceholders('Hi {{first_name}}, {{discount_code}}'), [
    'first_name',
    'discount_code',
  ]);
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
});
