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

const generated = await call('POST', `/api/v1/outreach/${created.body.id}/generate`, {}, cookie);
if (generated.body.drafts.length !== 27) throw new Error(`drafts ${generated.body.drafts.length}`);
const langs = new Set(generated.body.drafts.map((d: { language: string }) => d.language));
if (!langs.has('en') || !langs.has('es')) throw new Error('missing languages');
const texts = generated.body.drafts.map((d: { body: string }) => d.body);
if (new Set(texts).size < 5) throw new Error('drafts too similar');

const blocked = generated.body.drafts[0];
const patched = await call('PATCH', `/api/v1/drafts/${blocked.id}`, { body: 'Hola {{first_name}}' }, cookie);
const approve = await call('POST', `/api/v1/drafts/${blocked.id}/review`, { decision: 'approve' }, cookie);
if (approve.status !== 409) throw new Error('should block missing unsubscribe');

await call('PATCH', `/api/v1/drafts/${blocked.id}`, { body: patched.body.body || blocked.body }, cookie);
const bulk = await call('POST', `/api/v1/outreach/${created.body.id}/drafts/bulk-approve`, {}, cookie);
if (bulk.body.approved < 20) throw new Error('bulk approve too few');

const sent = await call('POST', `/api/v1/outreach/${created.body.id}/send`, {}, cookie);
if (sent.body.sent < 20) throw new Error(`sent ${sent.body.sent}`);

const rendered = await call('GET', `/api/v1/drafts/${generated.body.drafts[1].id}/rendered`, undefined, cookie);
if (rendered.body.body.includes('{{')) throw new Error('placeholders left');

console.log('smoke ok', {
  customers: customers.body.total,
  dormant: preview.body,
  drafts: generated.body.drafts.length,
  sent: sent.body.sent,
});
await app.close();
