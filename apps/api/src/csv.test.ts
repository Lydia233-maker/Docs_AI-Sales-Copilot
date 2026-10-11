import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { daysBetween, getField, groupOrderRows, inferLanguage, moneyToCents, parseCsv } from './csv.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/shopify-public');

test('official customer template uses country, consent, and note columns', () => {
  const rows = parseCsv(readFileSync(join(dir, 'customer_template.csv'), 'utf8'));
  assert.equal(rows.length, 2);
  const john = rows[0];
  const jane = rows[1];
  assert.equal(getField(john, 'email'), 'john.doe@shopify.com');
  assert.equal(getField(john, 'customer id'), '');
  assert.equal(getField(john, 'default address country code'), 'CA');
  assert.equal(inferLanguage('', 'CA'), 'en');
  assert.equal(/^(yes|true|1)$/i.test(getField(john, 'accepts email marketing')), false);
  assert.equal(/^(yes|true|1)$/i.test(getField(jane, 'accepts email marketing')), true);
  assert.equal(getField(jane, 'note'), 'Very nice customer');
  assert.equal(getField(jane, 'accepts sms marketing'), 'yes');
});

test('public order export keeps extra line items on the same order', () => {
  const rows = parseCsv(readFileSync(join(dir, 'orders_export_sample.csv'), 'utf8'));
  const groups = groupOrderRows(rows);
  assert.equal(groups.length, 8);
  const first = groups[0];
  assert.equal(getField(first[0], 'name'), '#1001');
  assert.deepEqual(
    first.map((row) => getField(row, 'lineitem name')),
    ['Cotton Tee - M', 'Ceramic Mug'],
  );
  assert.equal(moneyToCents(getField(first[0], 'total')), 7680);
  assert.equal(daysBetween(getField(first[0], 'created at'), '2025-03-12'), 10);
  const fourth = groups.find((group) => getField(group[0], 'name') === '#1004');
  assert.equal(fourth?.length, 3);
  assert.equal(getField(groups[2][0], 'financial status'), 'partially_refunded');
  assert.equal(getField(first[0], 'lineitem sku'), 'SKU-TEE-M');
});

test('demo orders that repeat the order name stay one order', () => {
  const demo = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo-pet/orders.csv');
  const groups = groupOrderRows(parseCsv(readFileSync(demo, 'utf8')));
  assert.equal(groups.length, 87);
  const anna = groups.find((group) => getField(group[0], 'name') === '#1000');
  assert.equal(anna?.length, 2);
});
