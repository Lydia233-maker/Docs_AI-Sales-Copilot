import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exclusionReason, isEmailEligible } from './eligibility.ts';

test('only consented and not unsubscribed customers are eligible', () => {
  assert.equal(isEmailEligible({ emailConsent: 1 }), true);
  assert.equal(isEmailEligible({ emailConsent: 0 }), false);
  assert.equal(isEmailEligible({ emailConsent: 1, unsubscribedAt: '2026-01-01' }), false);
  assert.equal(exclusionReason({ emailConsent: 0 }), 'no_email_consent');
});
