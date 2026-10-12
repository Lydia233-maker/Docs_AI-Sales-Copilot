import { buildApp } from './app.ts';

const app = await buildApp();
await app.ready();

async function call(method: string, url: string, payload?: unknown, cookies = '') {
  const res = await app.inject({
    method,
    url,
    payload,
    headers: cookies ? { cookie: cookies } : {},
  });
  const setCookie = res.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { status: res.statusCode, body: res.json(), cookie };
}

const bad = await call('POST', '/api/v1/auth/login', { email: 'demo@example.com', password: 'nope' });
if (bad.status !== 401) throw new Error('bad login should 401');

const login = await call('POST', '/api/v1/auth/login', { email: 'demo@example.com', password: 'demo1234' });
if (login.status !== 200) throw new Error('login failed');
const cookie = String(login.cookie).split(';')[0];
if (!String(login.cookie).toLowerCase().includes('httponly')) throw new Error('cookie not httpOnly');

const customers = await call('GET', '/api/v1/customers', undefined, cookie);
if (customers.body.total !== 40) throw new Error(`expected 40 customers, got ${customers.body.total}`);
const anna = customers.body.items.find((c: { email: string }) => c.email === 'anna.cole@example.com');
if (!anna) throw new Error('anna missing');
const detail = await call('GET', `/api/v1/customers/${anna.id}`, undefined, cookie);
const order = detail.body.orders?.[0];
if (!order?.createdAtShop || typeof order.totalCents !== 'number') throw new Error('order fields not camelCase');
if ('created_at_shop' in order || 'total_cents' in order) throw new Error('order response still snake_case');

const es = await call('GET', '/api/v1/customers?language=es', undefined, cookie);
if (es.body.total < 10) throw new Error('too few spanish customers');

const preview = await call('POST', '/api/v1/audience/preview', { scenario: 'winback_dormant' }, cookie);
if (preview.body.total !== 32) throw new Error(`dormant total ${preview.body.total}`);
if (preview.body.reachable !== 27) throw new Error(`reachable ${preview.body.reachable}`);

const created = await call(
  'POST',
  '/api/v1/outreach',
  { scenario: 'winback_dormant', intentZh: '黑五老客专享 8 折，主推猫砂和猫粮', discountCode: 'SAVE20' },
  cookie,
);
if (created.body.reachable !== 27) throw new Error('create reachable');
if (!created.body.intentZh) throw new Error('create response missing intentZh');

const listed = await call('GET', '/api/v1/outreach', undefined, cookie);
const row = listed.body.items.find((item: { id: string }) => item.id === created.body.id);
if (!row?.intentZh || row.intent_zh) throw new Error('outreach list is not camelCase');

const startedAt = Date.now();
const generated = await call('POST', `/api/v1/outreach/${created.body.id}/generate`, undefined, cookie);
if (Date.now() - startedAt > 2000) throw new Error('generate did not return immediately');
if (generated.body.job?.status !== 'writing' && generated.body.job?.status !== 'done') {
  throw new Error(`job status ${generated.body.job?.status}`);
}

let finished = generated.body;
const waitStarted = Date.now();
while (finished.job?.status !== 'done') {
  if (Date.now() - waitStarted > 30000) throw new Error(`job stayed ${finished.job?.status}`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  finished = (await call('GET', `/api/v1/outreach/${created.body.id}`, undefined, cookie)).body;
}
if (finished.job.completedCount !== 27) throw new Error(`completed ${finished.job.completedCount}`);
if (finished.drafts.length !== 27) throw new Error(`drafts ${finished.drafts.length}`);
const langs = new Set(finished.drafts.map((d: { language: string }) => d.language));
if (!langs.has('en') || !langs.has('es')) throw new Error('missing languages');
const annaDraft = finished.drafts.find((d: { email: string }) => d.email === 'anna.cole@example.com');
if (!annaDraft) throw new Error('anna draft missing');
if (!String(annaDraft.zhBody).includes('已确认事实') && !String(annaDraft.zhBody).includes('无尘猫砂')) {
  throw new Error('anna chinese copy missing confirmed fact');
}
if (!String(annaDraft.body).includes('{{first_name}}')) throw new Error('draft should keep placeholders until render');
if (String(annaDraft.body).includes('黑五老客专享')) throw new Error('chinese intent leaked into the foreign body');

const blocked = finished.drafts[0];
const patched = await call('PATCH', `/api/v1/drafts/${blocked.id}`, { body: 'Hola {{first_name}}' }, cookie);
if (patched.status !== 200 || patched.body.canApprove !== false) throw new Error('patched draft should not be approvable');
const approve = await call('POST', `/api/v1/drafts/${blocked.id}/review`, { decision: 'approve' }, cookie);
if (approve.status !== 409) throw new Error('should block missing unsubscribe');

await call('PATCH', `/api/v1/drafts/${blocked.id}`, { body: blocked.body }, cookie);
const bulk = await call('POST', `/api/v1/outreach/${created.body.id}/drafts/bulk-approve`, {}, cookie);
if (bulk.body.approved !== 27 || bulk.body.skipped !== 0) {
  throw new Error(`bulk approve ${bulk.body.approved} skipped ${bulk.body.skipped}`);
}

const sent = await call('POST', `/api/v1/outreach/${created.body.id}/send`, {}, cookie);
if (sent.body.sent !== 27 || sent.body.status !== 'sent') throw new Error(`sent ${sent.body.sent} status ${sent.body.status}`);

const rendered = await call('GET', `/api/v1/drafts/${annaDraft.id}/rendered`, undefined, cookie);
if (rendered.status !== 200) throw new Error('render failed');
if (rendered.body.body.includes('{{')) throw new Error('placeholders left');
if (!rendered.body.body.includes('Anna')) throw new Error('rendered body missing first name');

const messages = await call('GET', `/api/v1/outreach/${created.body.id}/messages`, undefined, cookie);
if (!messages.body.items?.[0]?.renderedSubject || messages.body.items[0].rendered_subject) {
  throw new Error('messages list is not camelCase');
}

console.log('smoke ok', {
  customers: customers.body.total,
  dormant: preview.body,
  drafts: finished.drafts.length,
  sent: sent.body.sent,
});
await app.close();
