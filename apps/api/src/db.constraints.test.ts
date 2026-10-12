import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-db-')), 'app.db');

const { db, nowIso, uuid } = await import('./db.ts');

function seedParents() {
  const storeId = uuid();
  const customerId = uuid();
  const outreachId = uuid();
  const now = nowIso();
  db.prepare(
    'INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(storeId, 'S', '123 Demo St', 'warm', now);
  db.prepare(
    `INSERT INTO customers (id, store_id, external_id, email, first_name, last_name, country, language, tags, email_consent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(customerId, storeId, 'c1', 'ann@example.com', 'Ann', 'A', 'US', 'en', '[]', 1);
  db.prepare(
    `INSERT INTO outreach (id, store_id, name, intent_zh, scenario, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(outreachId, storeId, 'o', '唤醒', 'winback_dormant', 'draft', now);
  return { storeId, customerId, outreachId, now };
}

test('profile tables reject bad values and dangling rows', () => {
  const { storeId, customerId, outreachId, now } = seedParents();
  const insertFact = db.prepare(
    `INSERT INTO facts (id, store_id, customer_id, kind, status, source, quote, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  assert.throws(() => insertFact.run(uuid(), storeId, customerId, '随便', 'suggested', 'note', '喜欢无尘', now));
  assert.throws(() => insertFact.run(uuid(), storeId, customerId, 'preference', 'pending', 'note', '喜欢无尘', now));
  assert.throws(() => insertFact.run(uuid(), storeId, 'missing', 'preference', 'suggested', 'note', '喜欢无尘', now));
  assert.throws(() => insertFact.run(uuid(), storeId, customerId, 'preference', 'suggested', 'chat', '喜欢无尘', now));
  assert.throws(() => insertFact.run(uuid(), storeId, customerId, 'preference', 'suggested', 'note', '   ', now));

  const factId = uuid();
  insertFact.run(factId, storeId, customerId, 'preference', 'suggested', 'note', '喜欢无尘', now);

  const insertJob = db.prepare(
    `INSERT INTO generation_jobs
      (id, store_id, outreach_id, status, planned_count, completed_count, failed_count, next_customer_id, writer, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  assert.throws(() => insertJob.run(uuid(), storeId, outreachId, 'writing', -1, 0, 0, null, 'model', now));
  assert.throws(() => insertJob.run(uuid(), storeId, outreachId, 'paused', 1, 0, 0, null, 'model', now));
  assert.throws(() => insertJob.run(uuid(), storeId, 'missing-outreach', 'writing', 1, 0, 0, null, 'openai', now));
  const jobId = uuid();
  insertJob.run(jobId, storeId, outreachId, 'writing', 1, 0, 0, customerId, 'model', now);

  const checkoutId = uuid();
  db.prepare(
    `INSERT INTO abandoned_checkouts (id, store_id, customer_id, email, external_id, created_at_shop)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(checkoutId, storeId, customerId, 'ann@example.com', 'chk-1', now);
  db.prepare(
    `INSERT INTO abandoned_checkout_items (id, checkout_id, title, quantity) VALUES (?, ?, ?, ?)`,
  ).run(uuid(), checkoutId, 'Litter', 1);
  assert.throws(() =>
    db
      .prepare(`INSERT INTO abandoned_checkout_items (id, checkout_id, title, quantity) VALUES (?, ?, ?, ?)`)
      .run(uuid(), checkoutId, 'Litter', 0),
  );
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO abandoned_checkouts (id, store_id, customer_id, email, external_id, created_at_shop)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(uuid(), storeId, null, '   ', 'chk-2', now),
  );

  db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  assert.equal(db.prepare('SELECT id FROM facts WHERE id = ?').get(factId), undefined);
  assert.equal(db.prepare('SELECT id FROM abandoned_checkouts WHERE id = ?').get(checkoutId), undefined);
  assert.equal(
    (db.prepare('SELECT next_customer_id FROM generation_jobs WHERE id = ?').get(jobId) as { next_customer_id: string | null })
      .next_customer_id,
    null,
  );
});

test('company address length is enforced in the database', () => {
  const now = nowIso();
  const insertStore = db.prepare(
    'INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  assert.throws(() => insertStore.run(uuid(), 'Bad', '   ', 'warm', now));
  assert.throws(() => insertStore.run(uuid(), 'Bad', 'a'.repeat(301), 'warm', now));
  const id = uuid();
  insertStore.run(id, 'Ok', 'a'.repeat(300), 'warm', now);
  assert.throws(() => db.prepare('UPDATE stores SET company_address = ? WHERE id = ?').run('', id));
});
