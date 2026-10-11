import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDraft, generateTemplate, redactNote } from './templates.ts';

const brief = {
  language: 'es' as const,
  country: 'MX',
  orderCount: 3,
  spendTier: 'high',
  daysSinceLastOrder: 80,
  purchases: [{ title: 'Arena sin polvo 10L', category: 'cat_litter', daysAgo: 80 }],
  preferenceTags: [],
  notes: ['喜欢无尘猫砂'],
};

test('spanish template uses product and required placeholders', () => {
  const copy = generateTemplate(brief, '黑五老客专享 8 折', 'SAVE20');
  assert.match(copy.body, /Arena sin polvo 10L/);
  assert.equal(copy.body.includes('黑五老客专享 8 折'), false);
  assert.match(copy.body, /20% de descuento/);
  assert.equal(checkDraft(copy.body).length, 0);
  assert.match(copy.zhBody, /无尘猫砂/);
});

test('confirmed facts show up in the Chinese copy and the customization notes', () => {
  const copy = generateTemplate(brief, '黑五老客专享 8 折');
  assert.match(copy.zhBody, /喜欢无尘猫砂/);
  assert.equal(copy.body.includes('喜欢无尘猫砂'), false);
  assert.ok(copy.points.some((point) => point.includes('喜欢无尘猫砂')));
});

test('missing unsubscribe is blocking', () => {
  const issues = checkDraft('Hola {{first_name}}');
  assert.ok(issues.some((i) => i.message.includes('退订')));
});

test('redact hides email and phone', () => {
  assert.equal(
    redactNote('联系我 ann@example.com 或 +1 555 010 2000'),
    '联系我 [已隐藏] 或 [已隐藏]',
  );
});
