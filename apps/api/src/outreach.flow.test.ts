import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-flow-')), 'app.db');
process.env.APP_NOW = '2026-11-01';

const { db, nowIso, uuid } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

test('login through simulated send uses the shared brief and draft rules', async () => {
  const now = nowIso();
  const storeId = uuid();
  const userId = uuid();
  const customerId = uuid();
  db.prepare(
    'INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(storeId, 'Paws Demo', '123 Demo St, Austin, TX 78701', 'warm', now);
  db.prepare('INSERT INTO users (id, store_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    storeId,
    'demo@example.com',
    hashPassword('demo1234'),
    now,
  );
  db.prepare(
    `INSERT INTO customers (id, store_id, external_id, email, first_name, last_name, country, language, tags, email_consent, order_count, total_spent_cents, last_order_at, spend_tier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    customerId,
    storeId,
    '1001',
    'anna.cole@example.com',
    'Anna',
    'Cole',
    'US',
    'en',
    '[]',
    1,
    2,
    8000,
    '2026-08-01',
    'mid',
  );
  db.prepare('INSERT INTO customer_notes (id, store_id, customer_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(
    uuid(),
    storeId,
    customerId,
    '联系 ann@example.com，喜欢无尘猫砂',
    now,
  );
  db.prepare(
    `INSERT INTO facts (id, store_id, customer_id, kind, status, source, quote, created_at)
     VALUES (?, ?, ?, 'preference', 'confirmed', 'note', ?, ?)`,
  ).run(uuid(), storeId, customerId, '联系 [已隐藏]，喜欢无尘猫砂', now);

  const app = await buildApp();
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'demo@example.com', password: 'demo1234' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']).split(';')[0];

  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
  assert.equal(me.json().store.name, 'Paws Demo');

  const customers = await app.inject({ method: 'GET', url: '/api/v1/customers', headers: { cookie } });
  assert.equal(customers.json().total, 1);
  assert.equal(customers.json().items[0].firstName, 'Anna');

  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers: { cookie },
    payload: { scenario: 'winback_dormant' },
  });
  assert.equal(preview.json().reachable, 1);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers: { cookie },
    payload: { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折', discountCode: 'SAVE20' },
  });
  assert.equal(created.statusCode, 200);
  const outreachId = created.json().id as string;

  const startedAt = Date.now();
  const generated = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/generate`,
    headers: { cookie },
  });
  assert.equal(generated.statusCode, 200);
  assert.ok(Date.now() - startedAt < 2000);
  let draft = generated.json().drafts[0];
  const waitStarted = Date.now();
  while (!draft) {
    if (Date.now() - waitStarted > 10000) throw new Error('generation did not finish');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await app.inject({ method: 'GET', url: `/api/v1/outreach/${outreachId}`, headers: { cookie } });
    draft = again.json().drafts[0];
    if (again.json().job?.status === 'done') draft = again.json().drafts[0];
  }
  assert.equal(draft.email, 'anna.cole@example.com');
  assert.equal(String(draft.zhBody).includes('ann@example.com'), false);
  assert.equal(String(draft.zhBody).includes('[已隐藏]'), true);
  assert.equal(String(draft.body).includes('{{unsubscribe_url}}'), true);
  assert.equal(String(draft.body).includes('{{company_address}}'), true);

  const blocked = await app.inject({
    method: 'POST',
    url: `/api/v1/drafts/${draft.id}/review`,
    headers: { cookie },
    payload: { decision: 'approve' },
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/v1/drafts/${draft.id}`,
    headers: { cookie },
    payload: { body: 'Hi {{first_name}} {{not_a_field}} {{unsubscribe_url}} {{company_address}}' },
  });
  const unknown = await app.inject({
    method: 'POST',
    url: `/api/v1/drafts/${draft.id}/review`,
    headers: { cookie },
    payload: { decision: 'approve' },
  });
  assert.equal(unknown.statusCode, 409);
  assert.equal(blocked.statusCode, 200);

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/drafts/bulk-approve`,
    headers: { cookie },
  });
  assert.equal(approved.json().approved, 0);

  await app.inject({
    method: 'PATCH',
    url: `/api/v1/drafts/${draft.id}`,
    headers: { cookie },
    payload: { body: draft.body },
  });
  const restored = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/drafts/bulk-approve`,
    headers: { cookie },
  });
  assert.equal(restored.json().approved, 1);

  const sent = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/send`,
    headers: { cookie },
  });
  assert.equal(sent.json().sent, 1);
  assert.equal(sent.json().status, 'sent');

  const rendered = await app.inject({
    method: 'GET',
    url: `/api/v1/drafts/${draft.id}/rendered`,
    headers: { cookie },
  });
  assert.equal(rendered.statusCode, 200);
  assert.equal(String(rendered.json().body).includes('{{'), false);
  assert.equal(String(rendered.json().body).includes('Anna'), true);
  assert.equal(String(rendered.json().body).includes('123 Demo St, Austin, TX 78701'), true);
  assert.equal(String(rendered.json().body).includes('ann@example.com'), false);

  await app.close();
});
