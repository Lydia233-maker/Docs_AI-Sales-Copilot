import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'copilot-profile-')), 'app.db');
process.env.APP_NOW = '2026-11-01';
delete process.env.UNIT_PRICE_CENTS;
delete process.env.DEEPSEEK_API_KEY;

const { db, nowIso, uuid } = await import('./db.ts');
const { buildApp } = await import('./app.ts');
const { interruptWritingJobs } = await import('./generation/run.ts');
const { setModelClientForTests } = await import('./generation/model.ts');

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo-pet');
const customersCsv = readFileSync(join(fixtureDir, 'customers.csv'), 'utf8');
const ordersCsv = readFileSync(join(fixtureDir, 'orders.csv'), 'utf8');
const abandonedCsv = readFileSync(join(fixtureDir, 'abandoned.csv'), 'utf8');

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

async function waitJob(app: Awaited<ReturnType<typeof buildApp>>, headers: { cookie: string }, outreachId: string) {
  const started = Date.now();
  let body: { job?: { status?: string }; drafts: { id: string; email: string; body: string; zhBody: string; personalizationPoints: string[]; writer?: string }[] } = {
    drafts: [],
  };
  while (body.job?.status !== 'done' && body.job?.status !== 'interrupted') {
    if (Date.now() - started > 20000) throw new Error(`job ${body.job?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    body = (await app.inject({ method: 'GET', url: `/api/v1/outreach/${outreachId}`, headers })).json();
  }
  return body;
}

test('scenes, facts, gorgias, resume, and one-letter rewrite', async () => {
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
  const insertCustomer = db.prepare(
    `INSERT INTO customers (id, store_id, external_id, email, first_name, last_name, country, language, tags, email_consent, order_count, last_order_at, spend_tier, top_category)
     VALUES (?, ?, ?, ?, ?, ?, 'US', 'en', '[]', 1, ?, ?, 'low', 'cat_food')`,
  );
  const ada = uuid();
  const ben = uuid();
  insertCustomer.run(ada, storeId, 'ada', 'ada.none@example.com', 'Ada', 'None', 0, null);
  insertCustomer.run(ben, storeId, 'ben', 'ben.paid@example.com', 'Ben', 'Paid', 1, '2026-10-31');
  db.prepare(
    `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
     VALUES (?, ?, ?, 'o-ben', '#9', 'ben.paid@example.com', '2026-10-31', 1000, 'paid')`,
  ).run(uuid(), storeId, ben);

  const app = await buildApp();
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'demo@example.com', password: 'demo1234' },
  });
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0] };
  const denied = await app.inject({ method: 'POST', url: '/api/v1/imports/abandoned', payload: { abandonedCsv: 'Email,Created at,Lineitem name\na@example.com,2026-10-30,Litter' } });
  assert.equal(denied.statusCode, 401);

  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'abandoned_checkout' },
  });
  assert.equal(missing.json().message, '还没有弃单数据');
  assert.equal(missing.json().total, null);

  const sample = [
    'Email,Created at,Lineitem name,Lineitem quantity,Id',
    'ada.none@example.com,2026-10-30,Dust-free Cat Litter,1,c1',
    'ben.paid@example.com,2026-10-28,Salmon Cat Food,1,c2',
  ].join('\n');
  const previewOnly = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/abandoned/preview',
    headers,
    payload: { abandonedCsv: sample },
  });
  assert.equal(previewOnly.json().checkouts, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM abandoned_checkouts').get() as { n: number }).n, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports/abandoned', headers, payload: { abandonedCsv: sample } })).statusCode, 200);
  const abandonedPreview = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'abandoned_checkout' },
  });
  assert.equal(abandonedPreview.json().total, 1);
  assert.equal(abandonedPreview.json().items[0].email, 'ada.none@example.com');

  db.prepare('DELETE FROM abandoned_checkout_items').run();
  db.prepare('DELETE FROM abandoned_checkouts').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM customers').run();

  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/imports/customers-orders', headers, payload: { customersCsv, ordersCsv } })).statusCode,
    200,
  );
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/imports/abandoned', headers, payload: { abandonedCsv } })).statusCode, 200);

  const winback = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'winback_dormant' },
  });
  assert.equal(winback.json().total, 32);
  assert.equal(winback.json().reachable, 27);
  assert.equal(winback.json().excluded, 5);
  assert.equal(winback.json().languages.es, 13);
  assert.equal(winback.json().calls, winback.json().personalized + winback.json().cohortGroups);
  assert.equal(winback.json().costConfigured, false);
  const spanish = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'winback_dormant', language: 'es' },
  });
  assert.equal(spanish.json().reachable, winback.json().languages.es);
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'first_to_second' },
  });
  assert.equal(first.json().total, 5);
  assert.equal(first.json().reachable, 5);
  const repurchase = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'repurchase' },
  });
  assert.equal(repurchase.json().total, 6);
  assert.equal(repurchase.json().reachable, 6);
  const abandoned = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'abandoned_checkout' },
  });
  assert.equal(abandoned.json().total, 4);
  assert.equal(abandoned.json().reachable, 3);
  process.env.UNIT_PRICE_CENTS = '3';
  const priced = await app.inject({
    method: 'POST',
    url: '/api/v1/audience/preview',
    headers,
    payload: { scenario: 'winback_dormant' },
  });
  assert.equal(priced.json().costCents, priced.json().calls * 3);
  delete process.env.UNIT_PRICE_CENTS;

  const anna = winback.json().items.find((item: { email: string }) => item.email === 'anna.cole@example.com');
  const withoutAnna = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: {
      scenario: 'winback_dormant',
      intentZh: '黑五老客专享 8 折',
      customerIds: winback.json().items.filter((item: { email: string }) => item.email !== 'anna.cole@example.com').map((item: { id: string }) => item.id),
    },
  });
  const annaRecipient = db
    .prepare(
      `SELECT 1 AS ok FROM outreach_recipients r JOIN customers c ON c.id=r.customer_id
       WHERE r.outreach_id=? AND c.email='anna.cole@example.com'`,
    )
    .get(withoutAnna.json().id);
  assert.equal(annaRecipient, undefined);
  const withAnna = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: {
      scenario: 'winback_dormant',
      intentZh: '黑五老客专享 8 折',
      discountCode: 'SAVE20',
      customerIds: [anna.id],
    },
  });
  assert.deepEqual(
    db
      .prepare(
        `SELECT c.email FROM outreach_recipients r JOIN customers c ON c.id=r.customer_id WHERE r.outreach_id=?`,
      )
      .get(withAnna.json().id),
    { email: 'anna.cole@example.com' },
  );

  const detail = await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers });
  assert.ok(detail.json().notes.some((note: { text: string }) => /布偶猫|无尘猫砂/.test(note.text)));
  const dust = detail.json().facts.find((fact: { quote: string; source: string }) => fact.source === 'title' && fact.quote === 'Dust-free');
  assert.equal(dust.status, 'suggested');
  const confirmed = await app.inject({
    method: 'POST',
    url: `/api/v1/facts/${dust.id}/decision`,
    headers,
    payload: { decision: 'confirm' },
  });
  assert.equal(confirmed.json().status, 'confirmed');
  const again = await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers });
  assert.equal(again.json().facts.find((fact: { id: string }) => fact.id === dust.id).status, 'confirmed');
  const litter = again.json().facts.find((fact: { quote: string; source: string }) => fact.source === 'title' && fact.quote === 'Litter');
  await app.inject({
    method: 'POST',
    url: `/api/v1/facts/${litter.id}/decision`,
    headers,
    payload: { decision: 'dismiss' },
  });
  const afterDismiss = await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers });
  assert.equal(afterDismiss.json().facts.some((fact: { id: string }) => fact.id === litter.id), false);

  const onceId = uuid();
  insertCustomer.run(onceId, storeId, 'once', 'once.title@example.com', 'Once', 'Title', 1, '2026-08-01');
  const orderId = uuid();
  db.prepare(
    `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
     VALUES (?, ?, ?, 'once-1', '#once', 'once.title@example.com', '2026-08-01', 1000, 'paid')`,
  ).run(orderId, storeId, onceId);
  db.prepare('INSERT INTO order_items (id, order_id, title, category, quantity, price_cents) VALUES (?, ?, ?, ?, 1, 1000)').run(
    uuid(),
    orderId,
    'Dust-free Cat Litter 10L',
    'cat_litter',
  );
  const { syncCustomerFacts } = await import('./facts/sync.ts');
  syncCustomerFacts(storeId, onceId);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM facts WHERE customer_id=? AND source='title'").get(onceId) as { n: number }).n,
    0,
  );

  const gorgias = [
    'Ticket ID,Customer email,Customer name,Created at,Channel,Message text',
    '1,anna.cole@example.com,Anna Cole,2026-10-01,chat,I only want dust-free litter',
    '2,nobody-missing@example.com,Nope,2026-10-01,email,hello there',
    '3,anna.cole@example.com,Anna Cole,2026-10-02,chat,',
    '4,anna.cole@example.com,Anna Cole,2026-10-03,chat,please skip the squeaky toy',
  ].join('\n');
  const gorgiasPreview = await app.inject({
    method: 'POST',
    url: '/api/v1/imports/gorgias/preview',
    headers,
    payload: { csv: gorgias },
  });
  assert.equal(gorgiasPreview.json().unmatched, 1);
  assert.equal(gorgiasPreview.json().skipped, 1);
  const gorgiasSaved = await app.inject({ method: 'POST', url: '/api/v1/imports/gorgias', headers, payload: { csv: gorgias } });
  assert.equal(gorgiasSaved.json().unmatched, 1);
  const annaFacts = (
    await app.inject({ method: 'GET', url: `/api/v1/customers/${anna.id}`, headers })
  ).json().facts.filter((fact: { source: string }) => fact.source === 'gorgias');
  assert.equal(annaFacts.length, 2);
  assert.ok(annaFacts.every((fact: { status: string; kind: string }) => fact.status === 'suggested' && fact.kind === 'unclassified'));
  const dustChat = annaFacts.find((fact: { quote: string }) => fact.quote.includes('dust-free litter'));
  const toyChat = annaFacts.find((fact: { quote: string }) => fact.quote.includes('squeaky toy'));
  await app.inject({
    method: 'POST',
    url: `/api/v1/facts/${dustChat.id}/decision`,
    headers,
    payload: { decision: 'confirm' },
  });

  const annaOnly = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折', discountCode: 'SAVE20', customerIds: [anna.id] },
  });
  const started = Date.now();
  const generated = await app.inject({ method: 'POST', url: `/api/v1/outreach/${annaOnly.json().id}/generate`, headers });
  assert.ok(Date.now() - started < 2000);
  const annaJob = await waitJob(app, headers, annaOnly.json().id);
  assert.equal(annaJob.job?.status, 'done');
  assert.equal(annaJob.drafts.length, 1);
  const annaDraft = annaJob.drafts[0];
  assert.equal(annaDraft.body.includes('黑五老客专享 8 折'), false);
  assert.match(annaDraft.body, /20% off/);
  assert.match(`${annaDraft.zhBody} ${annaDraft.personalizationPoints.join(' ')}`, /dust-free litter/);
  assert.equal(`${annaDraft.body} ${annaDraft.zhBody} ${annaDraft.personalizationPoints.join(' ')}`.includes('squeaky toy'), false);

  const cohortA = uuid();
  const cohortB = uuid();
  insertCustomer.run(cohortA, storeId, 'cohort-a', 'cohort.a@example.com', 'Amy', 'Cohort', 1, '2026-08-01');
  insertCustomer.run(cohortB, storeId, 'cohort-b', 'cohort.b@example.com', 'Bea', 'Cohort', 1, '2026-07-01');
  for (const [id, email, title, external] of [
    [cohortA, 'cohort.a@example.com', 'Salmon Cat Food 2kg', 'ca'],
    [cohortB, 'cohort.b@example.com', 'Turkey Cat Food 3kg', 'cb'],
  ] as const) {
    const idOrder = uuid();
    db.prepare(
      `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-01', 2000, 'paid')`,
    ).run(idOrder, storeId, id, external, external, email);
    db.prepare('INSERT INTO order_items (id, order_id, title, category, quantity, price_cents) VALUES (?, ?, ?, ?, 1, 2000)').run(
      uuid(),
      idOrder,
      title,
      'cat_food',
    );
  }
  const cohort = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折', discountCode: 'SAVE20', customerIds: [cohortA, cohortB] },
  });
  await app.inject({ method: 'POST', url: `/api/v1/outreach/${cohort.json().id}/generate`, headers });
  const shared = await waitJob(app, headers, cohort.json().id);
  assert.equal(shared.drafts[0].body, shared.drafts[1].body);
  const renderedA = await app.inject({ method: 'GET', url: `/api/v1/drafts/${shared.drafts.find((d) => d.email.startsWith('cohort.a'))!.id}/rendered`, headers });
  const renderedB = await app.inject({ method: 'GET', url: `/api/v1/drafts/${shared.drafts.find((d) => d.email.startsWith('cohort.b'))!.id}/rendered`, headers });
  assert.match(renderedA.json().body, /Amy/);
  assert.match(renderedB.json().body, /Bea/);
  assert.match(renderedA.json().body, /Salmon Cat Food 2kg/);
  assert.match(renderedB.json().body, /Turkey Cat Food 3kg/);
  assert.equal(renderedA.json().body.includes('{{'), false);

  const secondBefore = shared.drafts[1].body;
  await app.inject({ method: 'POST', url: `/api/v1/drafts/${shared.drafts[0].id}/regenerate`, headers });
  const afterRewrite = (await app.inject({ method: 'GET', url: `/api/v1/outreach/${cohort.json().id}`, headers })).json();
  assert.equal(afterRewrite.drafts.find((draft: { id: string }) => draft.id === shared.drafts[1].id).body, secondBefore);

  const reject = await app.inject({
    method: 'POST',
    url: `/api/v1/drafts/${shared.drafts[0].id}/review`,
    headers,
    payload: { decision: 'reject' },
  });
  assert.equal(reject.statusCode, 400);
  await app.inject({
    method: 'POST',
    url: `/api/v1/drafts/${shared.drafts[0].id}/review`,
    headers,
    payload: { decision: 'approve' },
  });
  const sent = await app.inject({ method: 'POST', url: `/api/v1/outreach/${cohort.json().id}/send`, headers });
  assert.equal(sent.json().sent, 1);
  const unsent = db.prepare('SELECT status FROM drafts WHERE id=?').get(shared.drafts[1].id) as { status: string };
  assert.equal(unsent.status, 'ready');
  const message = db.prepare('SELECT rendered_body FROM messages WHERE outreach_id=?').get(cohort.json().id) as {
    rendered_body: string;
  };
  assert.match(message.rendered_body, /Amy|Bea/);
  assert.match(message.rendered_body, /123 Demo St, Austin, TX 78701/);
  assert.match(message.rendered_body, /http:\/\/localhost:3000\/u\//);
  assert.equal(message.rendered_body.includes('{{'), false);
  const unsub = await app.inject({ method: 'GET', url: '/u/preview-token' });
  assert.equal(unsub.statusCode, 404);
  assert.equal(JSON.stringify(unsub.json()).includes('退订成功'), false);

  const five = winback.json().items.filter((item: { eligible: boolean }) => item.eligible).slice(0, 5);
  const partial = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: { scenario: 'winback_dormant', intentZh: '继续写', customerIds: five.map((item: { id: string }) => item.id) },
  });
  const partialId = partial.json().id as string;
  const recipients = db
    .prepare(
      `SELECT r.id, r.customer_id, r.language, r.mode, c.first_name FROM outreach_recipients r
       JOIN customers c ON c.id=r.customer_id WHERE r.outreach_id=? AND r.eligible=1 ORDER BY c.last_name, c.first_name`,
    )
    .all(partialId) as { id: string; customer_id: string; language: string; mode: string; first_name: string }[];
  assert.equal(recipients.length, 5);
  const insertDraft = db.prepare(
    `INSERT INTO drafts (id, outreach_id, recipient_id, customer_id, language, mode, subject, body, zh_subject, zh_body, personalization_points, status, last_product, writer, generation_ok)
     VALUES (?, ?, ?, ?, ?, ?, 's', ?, 'z', 'z', '[]', 'ready', 'Old Product', 'template', 1)`,
  );
  insertDraft.run(uuid(), partialId, recipients[0].id, recipients[0].customer_id, recipients[0].language, recipients[0].mode, 'KEEP-ONE');
  insertDraft.run(uuid(), partialId, recipients[1].id, recipients[1].customer_id, recipients[1].language, recipients[1].mode, 'KEEP-TWO');
  db.prepare(
    `INSERT INTO generation_jobs (id, store_id, outreach_id, status, planned_count, completed_count, failed_count, next_customer_id, writer, updated_at)
     VALUES (?, ?, ?, 'writing', 5, 2, 0, ?, 'template', ?)`,
  ).run(uuid(), storeId, partialId, recipients[2].customer_id, nowIso());
  interruptWritingJobs();
  const listed = await app.inject({ method: 'GET', url: '/api/v1/outreach', headers });
  const row = listed.json().items.find((item: { id: string }) => item.id === partialId);
  assert.equal(row.job.status, 'interrupted');
  const paused = await app.inject({ method: 'GET', url: `/api/v1/outreach/${partialId}`, headers });
  assert.equal(paused.json().job.completedCount, 2);
  assert.equal(paused.json().job.nextCustomerName.includes(recipients[2].first_name), true);
  assert.equal(paused.json().drafts.length, 2);
  await app.inject({ method: 'POST', url: `/api/v1/outreach/${partialId}/continue`, headers });
  const resumed = await waitJob(app, headers, partialId);
  assert.equal(resumed.job?.status, 'done');
  assert.equal(resumed.drafts.length, 5);
  const bodies = new Map(resumed.drafts.map((draft) => [draft.id, draft.body]));
  const kept = db.prepare("SELECT id, body FROM drafts WHERE outreach_id=? AND body IN ('KEEP-ONE', 'KEEP-TWO')").all(partialId) as {
    id: string;
    body: string;
  }[];
  assert.equal(kept.length, 2);
  assert.equal(bodies.get(kept[0].id), kept[0].body);

  await app.close();
});

test('a failed model call falls back to the template for that letter only', async () => {
  const seen: string[] = [];
  let calls = 0;
  setModelClientForTests(async (_system, user) => {
    seen.push(user);
    calls += 1;
    if (calls === 2) throw new Error('boom');
    return JSON.stringify({
      subject: 'Model subject',
      body: 'Model note for {{first_name}} about {{last_product}}\n{{unsubscribe_url}}\n{{company_address}}',
      zhSubject: '模型标题',
      zhBody: '模型对照 {{first_name}}',
    });
  });
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
    'other@example.com',
    hashPassword('demo1234'),
    now,
  );
  const app = await buildApp();
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'other@example.com', password: 'demo1234' },
  });
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0] };
  const ids: string[] = [];
  for (const [email, first, last] of [
    ['amy.model@example.com', 'Amy', 'Model'],
    ['zoe.model@example.com', 'Zoe', 'Model'],
  ] as const) {
    const id = uuid();
    ids.push(id);
    db.prepare(
      `INSERT INTO customers (id, store_id, external_id, email, first_name, last_name, country, language, tags, email_consent, order_count, total_spent_cents, last_order_at, spend_tier, top_category)
       VALUES (?, ?, ?, ?, ?, ?, 'US', 'en', '[]', 1, 2, 8000, '2026-08-01', 'mid', 'cat_food')`,
    ).run(id, storeId, email, email, first, last);
    const orderId = uuid();
    db.prepare(
      `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
       VALUES (?, ?, ?, ?, ?, ?, '2026-08-01', 8000, 'paid')`,
    ).run(orderId, storeId, id, email, email, email);
    db.prepare('INSERT INTO order_items (id, order_id, title, category, quantity, price_cents) VALUES (?, ?, ?, ?, 1, 4000)').run(
      uuid(),
      orderId,
      first === 'Amy' ? 'Salmon Cat Food 2kg' : 'Turkey Cat Food 3kg',
      'cat_food',
    );
  }
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/outreach',
    headers,
    payload: { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折', discountCode: 'SAVE20', customerIds: ids },
  });
  await app.inject({ method: 'POST', url: `/api/v1/outreach/${created.json().id}/generate`, headers });
  const done = await waitJob(app, headers, created.json().id);
  assert.equal(done.drafts.length, 2);
  assert.equal(seen.length, 2);
  for (const prompt of seen) {
    assert.equal(prompt.includes('Amy'), false);
    assert.equal(prompt.includes('Zoe'), false);
    assert.equal(prompt.includes('amy.model@example.com'), false);
    assert.equal(prompt.includes('zoe.model@example.com'), false);
  }
  const modelDraft = done.drafts.find((draft) => draft.writer === 'model');
  const templateDraft = done.drafts.find((draft) => draft.writer === 'template');
  assert.ok(modelDraft);
  assert.match(modelDraft!.body, /Model note/);
  assert.ok(templateDraft);
  assert.equal(templateDraft!.body.includes('Model note'), false);
  assert.match(templateDraft!.body, /20% off/);
  setModelClientForTests(null);
  await app.close();
});
