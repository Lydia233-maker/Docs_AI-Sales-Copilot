import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatedTitlePhrases } from './phrases.ts';

test('a phrase has to show up on two paid titles', () => {
  assert.deepEqual(repeatedTitlePhrases(['Dust-free Cat Litter 10L']), []);
  assert.deepEqual(repeatedTitlePhrases(['Dust-free Cat Litter 10L', 'Dust-free Cat Litter 5L']), [
    'Dust-free',
    'Litter',
  ]);
});
