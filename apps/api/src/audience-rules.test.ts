import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inAbandonedWindow, inDormantWindow, inRepurchaseWindow, quoteCost } from './audience-rules.ts';

test('dormant starts at day 60 and repurchase closes after the cycle plus 7 days', () => {
  assert.equal(inDormantWindow(59), false);
  assert.equal(inDormantWindow(60), true);
  assert.equal(inRepurchaseWindow('cat_litter', 21 + 7), true);
  assert.equal(inRepurchaseWindow('cat_litter', 21 + 8), false);
  assert.equal(inRepurchaseWindow('cat_food', 30 - 7), true);
  assert.equal(inRepurchaseWindow('cat_food', 30 - 8), false);
  assert.equal(inRepurchaseWindow('dog_food', 30 + 7), true);
  assert.equal(inRepurchaseWindow('treats', 14 + 7), true);
  assert.equal(inRepurchaseWindow('treats', 14 + 8), false);
  assert.equal(inAbandonedWindow(0), false);
  assert.equal(inAbandonedWindow(1), true);
  assert.equal(inAbandonedWindow(7), true);
  assert.equal(inAbandonedWindow(8), false);
});

test('missing unit price is not a number', () => {
  const previous = process.env.UNIT_PRICE_CENTS;
  delete process.env.UNIT_PRICE_CENTS;
  assert.equal(quoteCost(2, 3).configured, false);
  assert.equal(quoteCost(2, 3).calls, 5);
  process.env.UNIT_PRICE_CENTS = '4';
  assert.deepEqual(quoteCost(2, 3), { calls: 5, unitPriceCents: 4, costCents: 20, configured: true });
  if (previous == null) delete process.env.UNIT_PRICE_CENTS;
  else process.env.UNIT_PRICE_CENTS = previous;
});
