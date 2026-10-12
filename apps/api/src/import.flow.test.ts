import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-import-')), 'app.db');
process.env.APP_NOW = '2026-11-01';

const { db, nowIso, uuid } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo-pet');
const customersCsv = readFileSync(join(fixtureDir, 'customers.csv'), 'utf8');
const ordersCsv = readFileSync(join(fixtureDir, 'orders.csv'), 'utf8');

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

test('preview does not write, confirm imports, and keeps an overridden language', async () => {
  const now = nowIso();
  const storeId = uuid();
  db.prepare('INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)').run(
    storeId,
    'Paws Demo',
    '123 Demo St, Austin, TX 78701',
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
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(denied.statusCode, 401);
  const deniedClear = await app.inject({ method: 'POST', url: '/api/v1/imports/clear' });
  assert.equal(deniedClear.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'demo@example.com', password: 'demo1234' },
  });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const headers = { cookie };

  const before = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/preview',
    headers,
    payload: { customersCsv, ordersCsv, email: 'ann@example.com' },
  });
  assert.equal(preview.statusCode, 400);
  const previewOk = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/preview',
    headers,
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(previewOk.statusCode, 200);
  assert.equal(previewOk.json().customers, 40);
  assert.equal(previewOk.json().spanish, 16);
  assert.equal(previewOk.json().storeCustomers, 0);
  const afterPreview = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  assert.equal(afterPreview.n, before.n);

  const saved = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().customers, 40);
  assert.equal(saved.json().spanish, 16);

  const listed = await app.inject({ method: 'GET', url: '/api/v1/customers', headers });
  assert.equal(listed.json().total, 40);
  const spanish = await app.inject({ method: 'GET', url: '/api/v1/customers?language=es', headers });
  assert.equal(spanish.json().total, 16);
  const anna = listed.json().items.find((item: { email: string }) => item.email === 'anna.cole@example.com');
  const detail = await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers });
  assert.ok(detail.json().orders.some((order: { totalCents: number }) => order.totalCents > 0));
  assert.ok(detail.json().notes.some((note: { text: string }) => /布偶猫|无尘猫砂/.test(note.text)));

  const mona = listed.json().items.find((item: { email: string }) => item.email === 'mona.hart@example.com');
  const monaDetail = await app.inject({ method: 'GET', url: `/api/v1/customers/${mona.id}`, headers });
  assert.equal(monaDetail.json().notes.some((note: { text: string }) => note.text.includes('hidden@example.com')), false);
  assert.ok(monaDetail.json().notes.some((note: { text: string }) => note.text.includes('[已隐藏]')));

  db.prepare("UPDATE customers SET language='es', language_overridden=1 WHERE email='cara.nguyen@example.com'").run();
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv, ordersCsv },
  });
  assert.equal(again.json().customers, 40);
  const cara = db.prepare("SELECT language FROM customers WHERE email='cara.nguyen@example.com'").get() as {
    language: string;
  };
  const blake = db.prepare("SELECT language FROM customers WHERE email='blake.young@example.com'").get() as {
    language: string;
  };
  assert.equal(cara.language, 'es');
  assert.equal(blake.language, 'en');
  const noteCount = db.prepare('SELECT COUNT(*) AS n FROM customer_notes WHERE customer_id=?').get(anna.id) as { n: number };
  assert.equal(noteCount.n, 1);

  const badCustomers = [
    'Email,First Name,Last Name,Default Address Country Code,Accepts Email Marketing',
    'noname@example.com,,,US,yes',
    'nocountry@example.com,No,Country,,yes',
    'ada.stone@example.com,Ada,Stone,US,yes',
  ].join('\n');
  const badOrders = [
    'Name,Email,Financial Status,Created at,Total,Lineitem name',
    '#1,noname@example.com,paid,2026-08-01,20.00,Salmon Cat Food',
    '#2,ada.stone@example.com,paid,2026-08-01,20.00,Salmon Cat Food',
  ].join('\n');
  const badPreview = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/preview',
    headers,
    payload: { customersCsv: badCustomers, ordersCsv: badOrders },
  });
  assert.equal(badPreview.json().customers, 1);
  assert.equal(badPreview.json().skippedCustomers, 2);
  const badSaved = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv: badCustomers, ordersCsv: badOrders },
  });
  assert.equal(badSaved.statusCode, 200);
  const unnamed = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE email='noname@example.com'").get() as { n: number };
  assert.equal(unnamed.n, 0);
  const overview = await app.inject({ method: 'GET', url: '/api/v1/overview', headers });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().incomplete, 0);
  const winback = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'winback_dormant' },
  });
  assert.equal(
    winback.json().items.some((item: { email: string }) => item.email === 'noname@example.com'),
    false,
  );

  const cleared = await app.inject({ method: 'POST', url: '/api/v1/imports/clear', headers });
  assert.equal(cleared.statusCode, 200);
  assert.ok(cleared.json().customers >= 40);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n, 0);
  const still = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
  assert.equal(still.statusCode, 200);
  assert.equal(still.json().store.company_address, '123 Demo St, Austin, TX 78701');
  const empty = await app.inject({ method: 'GET', url: '/api/v1/overview', headers });
  assert.equal(empty.json().total, 0);
  assert.equal(empty.json().incomplete, 0);

  const batchDir = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/abandoned-300');
  const batchCustomers = readFileSync(join(batchDir, 'customers.csv'), 'utf8');
  const batchOrders = readFileSync(join(batchDir, 'orders.csv'), 'utf8');
  const batchAbandoned = readFileSync(join(batchDir, 'abandoned.csv'), 'utf8');
  const batchPreview = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/preview',
    headers,
    payload: { customersCsv: batchCustomers, ordersCsv: batchOrders },
  });
  assert.equal(batchPreview.json().customers, 300);
  assert.equal(batchPreview.json().skippedCustomers, 0);
  const batchSaved = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv: batchCustomers, ordersCsv: batchOrders },
  });
  assert.equal(batchSaved.statusCode, 200);
  assert.equal(batchSaved.json().customers, 300);
  const abandonedSaved = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/abandoned',
    headers,
    payload: { abandonedCsv: batchAbandoned },
  });
  assert.equal(abandonedSaved.statusCode, 200, JSON.stringify(abandonedSaved.json()));
  assert.equal(abandonedSaved.json().matched, 300);
  assert.equal(abandonedSaved.json().unmatched, 0);
  const abandonedAudience = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'abandoned_checkout' },
  });
  assert.equal(abandonedAudience.json().total, 86);
  assert.equal(
    abandonedAudience.json().items.some((item: { firstName: string }) => !String(item.firstName || '').trim()),
    false,
  );

  await app.close();
});
