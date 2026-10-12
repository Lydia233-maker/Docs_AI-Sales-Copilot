import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-scale-')), 'app.db');
process.env.APP_NOW = '2026-11-01';
delete process.env.UNIT_PRICE_CENTS;
delete process.env.DEEPSEEK_API_KEY;

const { db, nowIso, uuid } = await import('./db.ts');
const { buildApp } = await import('./app.ts');

const COUNT = 3000;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function customersCsv() {
  const lines = [
    'Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Accepts SMS Marketing,Phone,Default Address Country Code,Tags,Note,Total Spent,Total Orders',
  ];
  for (let i = 1; i <= COUNT; i += 1) {
    const n = String(i).padStart(4, '0');
    lines.push(`${n},Sam,Buyer${n},buyer${n}@example.com,yes,no,,US,,,20.00,1`);
  }
  return lines.join('\n');
}

function ordersCsv() {
  const lines = [
    'Name,Id,Email,Financial Status,Created at,Currency,Total,Discount Code,Lineitem name,Lineitem sku,Lineitem quantity,Lineitem price,Shipping Country,Accepts Marketing',
  ];
  for (let i = 1; i <= COUNT; i += 1) {
    const n = String(i).padStart(4, '0');
    lines.push(`#${n},${n},buyer${n}@example.com,paid,2026-08-01,USD,20.00,,Salmon Cat Food 2kg,salmon,1,20.00,US,yes`);
  }
  return lines.join('\n');
}

test('three thousand consented customers finish on the local template', async () => {
  const now = nowIso();
  const storeId = uuid();
  db.prepare('INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)').run(
    storeId,
    'Scale Shop',
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
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'demo@example.com', password: 'demo1234' },
  });
  assert.equal(login.statusCode, 200);
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0] };

  const imported = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/customers-orders',
    headers,
    payload: { customersCsv: customersCsv(), ordersCsv: ordersCsv() },
  });
  assert.equal(imported.statusCode, 200, JSON.stringify(imported.json()));
  const listed = await app.inject({ method: 'GET', url: '/api/v1/customers', headers });
  assert.equal(listed.json().total, COUNT);

  const preview = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'winback_dormant' },
  });
  assert.equal(preview.json().reachable, COUNT);
  assert.equal(preview.json().calls, preview.json().personalized + preview.json().cohortGroups);

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: {
      scenario: 'winback_dormant',
      intentZh: '回访买过猫粮的人',
      discountCode: 'SAVE20',
      customerIds: preview.json().items.map((item: { id: string }) => item.id),
    },
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json()));
  assert.equal(created.json().reachable, COUNT);

  const started = Date.now();
  const generated = await app.inject({
    method: 'POST',
    url: `/api/v1/outreach/${created.json().id}/generate`,
    headers,
  });
  assert.ok(Date.now() - started < 2000, 'generate should return before every letter exists');
  assert.equal(generated.json().job.status, 'writing');

  let seenWriting = generated.json().job.status === 'writing';
  let job = generated.json().job as { status: string; completedCount: number; plannedCount: number };
  const waitStarted = Date.now();
  while (job.status !== 'done') {
    if (Date.now() - waitStarted > 120000) {
      throw new Error(`still ${job.status} after ${job.completedCount}/${job.plannedCount}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = await app.inject({ method: 'GET', url: '/api/v1/outreach', headers });
    job = again.json().items.find((item: { id: string }) => item.id === created.json().id).job;
    if (job.status === 'writing') seenWriting = true;
  }
  assert.equal(seenWriting, true);
  assert.equal(job.status, 'done');
  assert.equal(job.completedCount, COUNT);
  assert.equal(job.plannedCount, COUNT);
  const drafts = db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE outreach_id=? AND generation_ok=1').get(created.json().id) as {
    n: number;
  };
  assert.equal(drafts.n, COUNT);
  await app.close();
});
