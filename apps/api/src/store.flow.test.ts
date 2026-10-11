import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-store-')), 'app.db');
process.env.APP_NOW = '2026-11-01';

const { db, nowIso, uuid } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo-pet');
const customersCsv = readFileSync(join(fixtureDir, 'customers.csv'), 'utf8');
const ordersCsv = readFileSync(join(fixtureDir, 'orders.csv'), 'utf8');
const demoAddress = '123 Demo St, Austin, TX 78701';

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

test('language override survives reimport and copy uses the saved company address', async () => {
  const now = nowIso();
  const storeId = uuid();
  db.prepare('INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)').run(
    storeId,
    'Paws Demo',
    demoAddress,
    'warm',
    now,
  );
  db.prepare('INSERT INTO users (id, store_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    uuid(),
    storeId,
    'demo@example.com',
    hashPassword('demo1234'),
    now,
  );

  const app = await buildApp();
  await app.ready();

  const deniedStore = await app.inject({
    method: 'PATCH',
    url: '/api/v1/store',
    payload: { companyAddress: '456 Market St' },
  });
  assert.equal(deniedStore.statusCode, 401);
  const deniedLanguage = await app.inject({
    method: 'PATCH',
    url: '/api/v1/customers/missing/language',
    payload: { language: 'es' },
  });
  assert.equal(deniedLanguage.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'demo@example.com', password: 'demo1234' },
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const headers = { cookie };

  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(imported.statusCode, 200);

  const listed = await app.inject({ method: 'GET', url: '/api/v1/customers', headers });
  const anna = listed.json().items.find((item: { email: string }) => item.email === 'anna.cole@example.com');
  assert.equal(anna.language, 'en');

  const badLanguage = await app.inject({
    method: 'PATCH',
    url: `/api/v1/customers/${anna.id}/language`,
    headers,
    payload: { language: 'fr' },
  });
  assert.equal(badLanguage.statusCode, 400);
  const extraLanguage = await app.inject({
    method: 'PATCH',
    url: `/api/v1/customers/${anna.id}/language`,
    headers,
    payload: { language: 'es', country: 'MX' },
  });
  assert.equal(extraLanguage.statusCode, 400);

  const switched = await app.inject({
    method: 'PATCH',
    url: `/api/v1/customers/${anna.id}/language`,
    headers,
    payload: { language: 'es' },
  });
  assert.equal(switched.statusCode, 200);
  assert.equal(switched.json().language, 'es');
  const detail = await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers });
  assert.equal(detail.json().language, 'es');
  const overridden = db.prepare('SELECT language, language_overridden FROM customers WHERE id=?').get(anna.id) as {
    language: string;
    language_overridden: number;
  };
  assert.equal(overridden.language, 'es');
  assert.equal(overridden.language_overridden, 1);

  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(again.statusCode, 200);
  const annaAfter = db.prepare('SELECT language, language_overridden FROM customers WHERE email=?').get(
    'anna.cole@example.com',
  ) as { language: string; language_overridden: number };
  const blake = db.prepare('SELECT language, language_overridden FROM customers WHERE email=?').get(
    'blake.young@example.com',
  ) as { language: string; language_overridden: number };
  assert.equal(annaAfter.language, 'es');
  assert.equal(annaAfter.language_overridden, 1);
  assert.equal(blake.language, 'en');
  assert.equal(blake.language_overridden, 0);

  const blank = await app.inject({
    method: 'PATCH',
    url: '/api/v1/store',
    headers,
    payload: { companyAddress: '   ' },
  });
  assert.equal(blank.statusCode, 400);
  const extraAddress = await app.inject({
    method: 'PATCH',
    url: '/api/v1/store',
    headers,
    payload: { companyAddress: '456 Market St', name: 'Other' },
  });
  assert.equal(extraAddress.statusCode, 400);

  const saved = await app.inject({
    method: 'PATCH',
    url: '/api/v1/store',
    headers,
    payload: { companyAddress: '  456 Market St  ' },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().companyAddress, '456 Market St');
  const store = await app.inject({ method: 'GET', url: '/api/v1/store', headers });
  assert.equal(store.json().companyAddress, '456 Market St');
  assert.equal(store.json().name, 'Paws Demo');

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折', discountCode: 'SAVE20' },
  });
  assert.equal(created.statusCode, 200);
  const outreachId = created.json().id as string;
  const generated = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/generate`,
    headers,
  });
  assert.equal(generated.statusCode, 200);
  let finished = generated.json();
  const waitStarted = Date.now();
  while (finished.job?.status !== 'done') {
    if (Date.now() - waitStarted > 10000) throw new Error('generation did not finish');
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = (await app.inject({ method: 'GET', url: `/api/v1/outreach/${outreachId}`, headers })).json();
  }
  const draft = finished.drafts.find((item: { email: string }) => item.email === 'anna.cole@example.com');
  assert.equal(draft.language, 'es');
  assert.equal(String(draft.body).includes('{{company_address}}'), true);
  assert.equal(String(draft.subject).startsWith('Te extrañamos'), true);

  const approved = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/drafts/bulk-approve`,
    headers,
  });
  assert.ok(approved.json().approved >= 1);

  const rendered = await app.inject({
    method: 'GET',
    url: `/api/v1/drafts/${draft.id}/rendered`,
    headers,
  });
  assert.equal(rendered.statusCode, 200);
  assert.equal(String(rendered.json().body).includes('456 Market St'), true);
  assert.equal(String(rendered.json().body).includes('{{'), false);

  const sent = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${outreachId}/send`,
    headers,
  });
  assert.ok(sent.json().sent >= 1);
  const message = db
    .prepare('SELECT rendered_body FROM messages WHERE customer_id=?')
    .get(anna.id) as { rendered_body: string };
  assert.equal(message.rendered_body.includes('456 Market St'), true);
  assert.equal(message.rendered_body.includes('{{'), false);

  const restored = await app.inject({
    method: 'PATCH',
    url: '/api/v1/store',
    headers,
    payload: { companyAddress: demoAddress },
  });
  assert.equal(restored.json().companyAddress, demoAddress);
  const copiedAgain = await app.inject({
    method: 'GET',
    url: `/api/v1/drafts/${draft.id}/rendered`,
    headers,
  });
  assert.equal(String(copiedAgain.json().body).includes(demoAddress), true);
  assert.equal(String(copiedAgain.json().body).includes('456 Market St'), false);
  assert.equal(String(copiedAgain.json().body).includes('{{'), false);

  await app.close();
});
