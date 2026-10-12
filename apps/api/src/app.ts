import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  AddNoteBody,
  AddPreferenceTagBody,
  CreateOutreachBody,
  ErrorCodes,
  LoginBody,
  ImportAbandonedBody,
  ImportCustomerOrdersBody,
  ImportGorgiasBody,
  PreviewAudienceBody,
  ReviewDraftBody,
  UpdateCompanyAddressBody,
  UpdateDraftBody,
  UpdateLanguageBody,
  FactDecisionBody,
  errorBody,
} from '@copilot/shared';
import { customersByIds, isPersonalized, selectAudience, storeOverview, summarizeAudience } from './audience.ts';
import { applyGorgias, previewGorgias } from './chat/gorgias.ts';
import { appToday, db, nowIso, uuid } from './db.ts';
import { daysBetween } from './csv.ts';
import { beginGeneration, continueGeneration, interruptWritingJobs, regenerateDraft } from './generation/run.ts';
import { applyAbandoned, applyCustomerOrders, previewAbandoned, previewCustomerOrders } from './imports/index.ts';
import { exclusionReason, hasMailingIdentity, isEmailEligible } from './eligibility.ts';
import { checkDraft, detectPrivacy, redactNote, renderCopy } from './templates.ts';

type Authed = { userId: string; storeId: string };

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function customerPurchases(customerId: string) {
  return db
    .prepare(
      `SELECT i.title, i.category, o.created_at_shop
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = ? ORDER BY o.created_at_shop DESC LIMIT 10`,
    )
    .all(customerId) as { title: string; category: string; created_at_shop: string }[];
}

function notesOf(customerId: string) {
  return db
    .prepare('SELECT id, text, created_at FROM customer_notes WHERE customer_id=? ORDER BY created_at DESC')
    .all(customerId) as { id: string; text: string; created_at: string }[];
}

type CustomerRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  language: string;
  email_consent: number;
  unsubscribed_at: string | null;
  order_count: number;
  total_spent_cents: number;
  last_order_at: string | null;
  spend_tier: string;
  top_category: string | null;
  preference_tags: string;
};

function serializeCustomer(row: CustomerRow) {
  const notes = notesOf(row.id);
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    country: row.country,
    language: row.language,
    emailConsent: Boolean(row.email_consent),
    orderCount: row.order_count,
    totalSpentCents: row.total_spent_cents,
    lastOrderAt: row.last_order_at,
    spendTier: row.spend_tier,
    topCategory: row.top_category,
    preferenceTags: JSON.parse(row.preference_tags || '[]'),
    hasNotes: notes.length > 0,
    daysSinceLastOrder: row.last_order_at ? daysBetween(row.last_order_at, appToday()) : null,
  };
}

function generationMode(row: { id: string; order_count: number }) {
  return isPersonalized(row) ? 'personalized' : 'cohort';
}

function jobView(outreachId: string) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE outreach_id=?').get(outreachId) as
    | {
        status: string;
        planned_count: number;
        completed_count: number;
        failed_count: number;
        next_customer_id: string | null;
        writer: string | null;
      }
    | undefined;
  if (!job) return null;
  const next = job.next_customer_id
    ? (db.prepare('SELECT first_name, last_name FROM customers WHERE id=?').get(job.next_customer_id) as
        | { first_name: string | null; last_name: string | null }
        | undefined)
    : undefined;
  return {
    status: job.status,
    plannedCount: job.planned_count,
    completedCount: job.completed_count,
    failedCount: job.failed_count,
    nextCustomerId: job.next_customer_id,
    nextCustomerName: next ? `${next.first_name || ''} ${next.last_name || ''}`.trim() : null,
    writer: job.writer,
  };
}

function issuesFor(body: string) {
  return checkDraft(body);
}

export async function buildApp() {
  interruptWritingJobs();
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);

  app.decorateRequest('auth', null as Authed | null);
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (
      url === '/health' ||
      url === '/api/v1/auth/login' ||
      url.startsWith('/u/')
    ) {
      return;
    }
    const token = req.cookies.session;
    if (!token) {
      return reply.code(401).send(errorBody(ErrorCodes.UNAUTHORIZED, '请先登录'));
    }
    const session = db
      .prepare(
        'SELECT u.id AS userId, u.store_id AS storeId FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?',
      )
      .get(token) as Authed | undefined;
    if (!session) {
      return reply.code(401).send(errorBody(ErrorCodes.UNAUTHORIZED, '请先登录'));
    }
    (req as typeof req & { auth: Authed }).auth = session;
  });

  app.get('/health', async () => ({
    status: 'ok',
    llm: {
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      doubao: Boolean(process.env.DOUBAO_API_KEY),
    },
    email: process.env.EMAIL_SENDER || 'mock',
  }));

  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请填写邮箱和密码'));
    }
    const user = db
      .prepare('SELECT id, store_id, password_hash FROM users WHERE email=?')
      .get(parsed.data.email) as { id: string; store_id: string; password_hash: string } | undefined;
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send(errorBody(ErrorCodes.UNAUTHORIZED, '邮箱或密码错误'));
    }
    const token = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, nowIso());
    reply.setCookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
    return { ok: true };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = req.cookies.session;
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (req) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const store = db.prepare('SELECT id, name, company_address FROM stores WHERE id=?').get(auth.storeId);
    return { user: { id: auth.userId }, store };
  });

  app.get('/api/v1/store', async (req) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const store = db.prepare('SELECT id, name, company_address FROM stores WHERE id=?').get(auth.storeId) as {
      id: string;
      name: string;
      company_address: string;
    };
    return { id: store.id, name: store.name, companyAddress: store.company_address };
  });

  app.patch('/api/v1/store', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = UpdateCompanyAddressBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '请填写公司地址'));
    }
    db.prepare('UPDATE stores SET company_address=? WHERE id=?').run(parsed.data.companyAddress, auth.storeId);
    return { companyAddress: parsed.data.companyAddress };
  });

  app.get('/api/v1/overview', async (req) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    return storeOverview(auth.storeId);
  });

  app.get('/api/v1/customers', async (req) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const q = req.query as { language?: string; q?: string };
    let sql = 'SELECT * FROM customers WHERE store_id=?';
    const params: unknown[] = [auth.storeId];
    if (q.language) {
      sql += ' AND language=?';
      params.push(q.language);
    }
    if (q.q) {
      sql += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
      params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
    }
    sql += ' ORDER BY last_name, first_name';
    const items = (db.prepare(sql).all(...params) as CustomerRow[]).map(serializeCustomer);
    return { items, total: items.length };
  });

  app.get('/api/v1/customers/:id', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    const row = db.prepare('SELECT * FROM customers WHERE id=? AND store_id=?').get(id, auth.storeId) as
      | CustomerRow
      | undefined;
    if (!row) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '客户不存在'));
    const orders = db
      .prepare('SELECT id, name, created_at_shop, total_cents FROM orders WHERE customer_id=? ORDER BY created_at_shop DESC')
      .all(id) as { id: string; name: string; created_at_shop: string; total_cents: number }[];
    return {
      ...serializeCustomer(row),
      notes: notesOf(id).map((note) => ({ id: note.id, text: note.text, createdAt: note.created_at })),
      orders: orders.map((order) => ({
        id: order.id,
        name: order.name,
        createdAtShop: order.created_at_shop,
        totalCents: order.total_cents,
      })),
      purchases: customerPurchases(id).map((purchase) => ({
        title: purchase.title,
        category: purchase.category,
        createdAtShop: purchase.created_at_shop,
      })),
      facts: (
        db
          .prepare('SELECT id, kind, status, source, quote FROM facts WHERE customer_id=? ORDER BY created_at')
          .all(id) as { id: string; kind: string; status: string; source: string; quote: string }[]
      ).map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        status: fact.status,
        source: fact.source,
        quote: fact.quote,
      })),
    };
  });

  app.post('/api/v1/facts/:id/decision', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = FactDecisionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请确认或忽略'));
    const fact = db
      .prepare('SELECT id FROM facts WHERE id=? AND store_id=?')
      .get((req.params as { id: string }).id, auth.storeId) as { id: string } | undefined;
    if (!fact) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '事实不存在'));
    if (parsed.data.decision === 'dismiss') {
      db.prepare('DELETE FROM facts WHERE id=?').run(fact.id);
      return { ok: true, status: 'dismissed' };
    }
    db.prepare("UPDATE facts SET status='confirmed' WHERE id=?").run(fact.id);
    return { ok: true, status: 'confirmed' };
  });

  app.post('/api/v1/imports/preview', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportCustomerOrdersBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '请上传客户和订单 CSV'));
    }
    return previewCustomerOrders(auth.storeId, parsed.data.customersCsv, parsed.data.ordersCsv);
  });

  app.post('/api/v1/imports/customers-orders', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportCustomerOrdersBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '请上传客户和订单 CSV'));
    }
    return applyCustomerOrders(auth.storeId, parsed.data.customersCsv, parsed.data.ordersCsv);
  });

  app.post('/api/v1/imports/abandoned/preview', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportAbandonedBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请上传弃单 CSV'));
    return previewAbandoned(auth.storeId, parsed.data.abandonedCsv);
  });

  app.post('/api/v1/imports/abandoned', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportAbandonedBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请上传弃单 CSV'));
    return applyAbandoned(auth.storeId, parsed.data.abandonedCsv);
  });

  app.post('/api/v1/imports/gorgias/preview', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportGorgiasBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请上传 Gorgias CSV'));
    return previewGorgias(auth.storeId, parsed.data.csv);
  });

  app.post('/api/v1/imports/gorgias', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ImportGorgiasBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请上传 Gorgias CSV'));
    return applyGorgias(auth.storeId, parsed.data.csv);
  });

  app.patch('/api/v1/customers/:id/language', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    const parsed = UpdateLanguageBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '请选择英语或西班牙语'));
    }
    const row = db.prepare('SELECT * FROM customers WHERE id=? AND store_id=?').get(id, auth.storeId) as CustomerRow | undefined;
    if (!row) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '客户不存在'));
    db.prepare('UPDATE customers SET language=?, language_overridden=1 WHERE id=?').run(parsed.data.language, id);
    const next = db.prepare('SELECT * FROM customers WHERE id=?').get(id) as CustomerRow;
    return serializeCustomer(next);
  });

  app.post('/api/v1/customers/:id/notes', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    const parsed = AddNoteBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '备注无效'));
    }
    const customer = db.prepare('SELECT id FROM customers WHERE id=? AND store_id=?').get(id, auth.storeId);
    if (!customer) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '客户不存在'));
    const noteId = uuid();
    db.prepare(
      'INSERT INTO customer_notes (id, store_id, customer_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(noteId, auth.storeId, id, parsed.data.text, nowIso());
    return { id: noteId, text: parsed.data.text, privacyWarnings: detectPrivacy(parsed.data.text) };
  });

  app.post('/api/v1/customers/:id/tags', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    const parsed = AddPreferenceTagBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '标签无效'));
    }
    const customer = db
      .prepare('SELECT id, preference_tags FROM customers WHERE id=? AND store_id=?')
      .get(id, auth.storeId) as { id: string; preference_tags: string } | undefined;
    if (!customer) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '客户不存在'));
    const tags = JSON.parse(customer.preference_tags || '[]') as string[];
    if (!tags.includes(parsed.data.tag)) tags.push(parsed.data.tag);
    db.prepare('UPDATE customers SET preference_tags=? WHERE id=?').run(JSON.stringify(tags), id);
    return { preferenceTags: tags };
  });

  app.post('/api/v1/audience/preview', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = PreviewAudienceBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '筛选条件无效'));
    }
    const selected = selectAudience(auth.storeId, parsed.data.scenario, parsed.data);
    if (selected.missingAbandoned) {
      return { missingAbandoned: true, message: '还没有弃单数据', total: null, reachable: null };
    }
    return {
      missingAbandoned: false,
      ...summarizeAudience(selected.rows, parsed.data.scenario),
      items: selected.rows.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        language: row.language,
        eligible: isEmailEligible(row),
        topCategory: row.top_category,
        spendTier: row.spend_tier,
      })),
    };
  });

  app.post('/api/v1/outreach', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = CreateOutreachBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '创建失败'));
    }
    const rows = parsed.data.customerIds
      ? customersByIds(auth.storeId, parsed.data.customerIds)
      : selectAudience(auth.storeId, parsed.data.scenario, parsed.data).rows;
    const id = uuid();
    db.prepare(
      'INSERT INTO outreach (id, store_id, name, intent_zh, scenario, discount_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      auth.storeId,
      parsed.data.name || parsed.data.intentZh.slice(0, 24),
      parsed.data.intentZh,
      parsed.data.scenario,
      parsed.data.discountCode || null,
      'draft',
      nowIso(),
    );
    const insert = db.prepare(
      'INSERT INTO outreach_recipients (id, outreach_id, customer_id, language, eligible, exclusion_reason, mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      const eligible = isEmailEligible(row) && hasMailingIdentity(row);
      insert.run(
        uuid(),
        id,
        row.id,
        row.language,
        eligible ? 1 : 0,
        eligible ? null : hasMailingIdentity(row) ? exclusionReason(row) : 'incomplete_profile',
        generationMode(row),
      );
    }
    return getOutreach(id, auth.storeId);
  });

  function getOutreach(id: string, storeId: string) {
    const outreach = db.prepare('SELECT * FROM outreach WHERE id=? AND store_id=?').get(id, storeId) as
      | {
          id: string;
          name: string;
          intent_zh: string;
          scenario: string;
          discount_code: string | null;
          status: string;
        }
      | undefined;
    if (!outreach) return null;
    const recipients = db
      .prepare('SELECT * FROM outreach_recipients WHERE outreach_id=?')
      .all(id) as {
      id: string;
      customer_id: string;
      language: string;
      eligible: number;
      exclusion_reason: string | null;
      mode: string;
    }[];
    const drafts = listDrafts(id);
    return {
      id: outreach.id,
      name: outreach.name,
      intentZh: outreach.intent_zh,
      scenario: outreach.scenario,
      discountCode: outreach.discount_code,
      status: outreach.status,
      recipientCount: recipients.length,
      reachable: recipients.filter((r) => r.eligible).length,
      excluded: recipients.filter((r) => !r.eligible).length,
      exclusionReasons: recipients
        .filter((r) => r.exclusion_reason)
        .reduce<Record<string, number>>((acc, r) => {
          acc[r.exclusion_reason!] = (acc[r.exclusion_reason!] || 0) + 1;
          return acc;
        }, {}),
      drafts,
      job: jobView(id),
    };
  }

  function listDrafts(outreachId: string) {
    const rows = db
      .prepare(
        `SELECT d.*, c.first_name, c.last_name, c.email, c.country
         FROM drafts d JOIN customers c ON c.id=d.customer_id
         WHERE d.outreach_id=?`,
      )
      .all(outreachId) as Array<{
      id: string;
      customer_id: string;
      language: string;
      mode: string;
      subject: string;
      body: string;
      zh_subject: string;
      zh_body: string;
      personalization_points: string;
      status: string;
      edited: number;
      last_product: string | null;
      writer: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string;
      country: string | null;
    }>;
    return rows.map((row) => {
      const issues = issuesFor(row.body);
      return {
        id: row.id,
        customerId: row.customer_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        country: row.country,
        language: row.language,
        mode: row.mode,
        subject: row.subject,
        body: row.body,
        zhSubject: row.zh_subject,
        zhBody: row.zh_body,
        personalizationPoints: JSON.parse(row.personalization_points),
        status: row.status,
        edited: Boolean(row.edited),
        lastProduct: row.last_product,
        writer: row.writer,
        issues,
        canApprove: issues.every((i) => i.level !== 'block') && row.status !== 'approved',
      };
    });
  }

  app.get('/api/v1/outreach', async (req) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const rows = db
      .prepare('SELECT id, name, intent_zh, status, created_at FROM outreach WHERE store_id=? ORDER BY created_at DESC')
      .all(auth.storeId) as {
      id: string;
      name: string;
      intent_zh: string;
      status: string;
      created_at: string;
    }[];
    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      intentZh: row.intent_zh,
      status: row.status,
      createdAt: row.created_at,
      job: jobView(row.id),
    }));
    return { items, total: items.length };
  });

  app.get('/api/v1/outreach/:id', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const data = getOutreach((req.params as { id: string }).id, auth.storeId);
    if (!data) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    return data;
  });

  app.post('/api/v1/outreach/:id/generate', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    const started = beginGeneration(id, auth.storeId);
    if (!started) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    if (started.empty) return reply.code(409).send(errorBody(ErrorCodes.NO_ELIGIBLE_RECIPIENTS, '没有可发送的客户'));
    return getOutreach(id, auth.storeId);
  });

  app.post('/api/v1/outreach/:id/continue', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = (req.params as { id: string }).id;
    if (!continueGeneration(id, auth.storeId)) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    return getOutreach(id, auth.storeId);
  });

  app.post('/api/v1/drafts/:id/regenerate', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const id = await regenerateDraft((req.params as { id: string }).id, auth.storeId);
    if (!id) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '草稿不存在'));
    const outreach = db.prepare('SELECT outreach_id FROM drafts WHERE id=?').get(id) as { outreach_id: string };
    return listDrafts(outreach.outreach_id).find((draft) => draft.id === id);
  });

  app.patch('/api/v1/drafts/:id', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = UpdateDraftBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '内容无效'));
    const draft = db
      .prepare(
        `SELECT d.* FROM drafts d JOIN outreach o ON o.id=d.outreach_id WHERE d.id=? AND o.store_id=?`,
      )
      .get((req.params as { id: string }).id, auth.storeId) as { id: string; body: string; subject: string } | undefined;
    if (!draft) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '草稿不存在'));
    db.prepare('UPDATE drafts SET subject=?, body=?, edited=1, status=? WHERE id=?').run(
      parsed.data.subject ?? draft.subject,
      parsed.data.body ?? draft.body,
      'ready',
      draft.id,
    );
    const outreach = db.prepare('SELECT outreach_id FROM drafts WHERE id=?').get(draft.id) as { outreach_id: string };
    return listDrafts(outreach.outreach_id).find((d) => d.id === draft.id);
  });

  app.post('/api/v1/drafts/:id/review', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = ReviewDraftBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, '决定无效'));
    const draft = db
      .prepare(
        `SELECT d.* FROM drafts d JOIN outreach o ON o.id=d.outreach_id WHERE d.id=? AND o.store_id=?`,
      )
      .get((req.params as { id: string }).id, auth.storeId) as { id: string; body: string; outreach_id: string } | undefined;
    if (!draft) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '草稿不存在'));
    if (parsed.data.decision === 'approve' && issuesFor(draft.body).some((i) => i.level === 'block')) {
      return reply.code(409).send(errorBody(ErrorCodes.DRAFT_HAS_BLOCKING_ISSUES, '存在阻止性问题，不能通过'));
    }
    db.prepare("UPDATE drafts SET status='approved' WHERE id=?").run(draft.id);
    return listDrafts(draft.outreach_id).find((d) => d.id === draft.id);
  });

  app.post('/api/v1/outreach/:id/drafts/bulk-approve', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const outreach = getOutreach((req.params as { id: string }).id, auth.storeId);
    if (!outreach) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    let approved = 0;
    let skipped = 0;
    for (const draft of outreach.drafts) {
      if (draft.status === 'approved') continue;
      if (draft.issues.some((i) => i.level === 'block')) {
        skipped += 1;
        continue;
      }
      db.prepare("UPDATE drafts SET status='approved' WHERE id=?").run(draft.id);
      approved += 1;
    }
    return { approved, skipped, ...getOutreach(outreach.id, auth.storeId) };
  });

  function renderValues(customer: CustomerRow, lastProduct: string | null, outreachId: string, token: string) {
    const outreach = db.prepare('SELECT discount_code FROM outreach WHERE id=?').get(outreachId) as {
      discount_code: string | null;
    };
    const storeRow = db
      .prepare('SELECT company_address FROM stores WHERE id=(SELECT store_id FROM outreach WHERE id=?)')
      .get(outreachId) as { company_address: string };
    const greeting = customer.language === 'es' ? 'hola' : 'there';
    return {
      first_name: customer.first_name || greeting,
      last_product: lastProduct || (customer.language === 'es' ? 'tu último pedido' : 'your last order'),
      discount_code: outreach.discount_code || '',
      unsubscribe_url: `${(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/u/${token}`,
      company_address: storeRow.company_address,
    };
  }

  app.get('/api/v1/drafts/:id/rendered', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const draft = db
      .prepare(
        `SELECT d.*, c.* FROM drafts d
         JOIN customers c ON c.id=d.customer_id
         JOIN outreach o ON o.id=d.outreach_id
         WHERE d.id=? AND o.store_id=?`,
      )
      .get((req.params as { id: string }).id, auth.storeId) as
      | (CustomerRow & { body: string; subject: string; last_product: string | null; outreach_id: string; customer_id: string })
      | undefined;
    if (!draft) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '草稿不存在'));
    if (!isEmailEligible(draft)) {
      return reply.code(409).send(errorBody(ErrorCodes.NO_ELIGIBLE_RECIPIENTS, '该客户未同意接收营销'));
    }
    const token = 'preview';
    const values = renderValues(draft, draft.last_product, draft.outreach_id, token);
    return {
      subject: renderCopy(draft.subject, values),
      body: renderCopy(draft.body, values),
    };
  });

  app.post('/api/v1/outreach/:id/send', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const outreach = getOutreach((req.params as { id: string }).id, auth.storeId);
    if (!outreach) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    const approved = outreach.drafts.filter((d) => d.status === 'approved');
    if (approved.length === 0) {
      return reply.code(409).send(errorBody(ErrorCodes.NO_ELIGIBLE_RECIPIENTS, '没有已通过的文案'));
    }
    db.prepare('DELETE FROM messages WHERE outreach_id=?').run(outreach.id);
    const insert = db.prepare(
      `INSERT INTO messages (id, outreach_id, draft_id, customer_id, unsubscribe_token, rendered_subject, rendered_body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'delivered', ?)`,
    );
    for (const draft of approved) {
      if (draft.issues.some((i) => i.level === 'block')) {
        return reply.code(409).send(errorBody(ErrorCodes.MISSING_UNSUBSCRIBE, '存在缺少退订链接的文案'));
      }
      const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(draft.customerId) as CustomerRow;
      if (!isEmailEligible(customer) || !hasMailingIdentity(customer)) continue;
      const token = randomBytes(24).toString('hex');
      const values = renderValues(customer, draft.lastProduct, outreach.id, token);
      insert.run(
        uuid(),
        outreach.id,
        draft.id,
        customer.id,
        token,
        renderCopy(draft.subject, values),
        renderCopy(draft.body, values),
        nowIso(),
      );
    }
    db.prepare("UPDATE outreach SET status='sent' WHERE id=?").run(outreach.id);
    const sent = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE outreach_id=?').get(outreach.id) as { n: number };
    return { sender: 'mock', sent: sent.n, ...getOutreach(outreach.id, auth.storeId) };
  });

  app.get('/api/v1/outreach/:id/messages', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const outreach = getOutreach((req.params as { id: string }).id, auth.storeId);
    if (!outreach) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    const rows = db
      .prepare('SELECT id, customer_id, rendered_subject, status, created_at FROM messages WHERE outreach_id=?')
      .all(outreach.id) as {
      id: string;
      customer_id: string;
      rendered_subject: string;
      status: string;
      created_at: string;
    }[];
    const items = rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      renderedSubject: row.rendered_subject,
      status: row.status,
      createdAt: row.created_at,
    }));
    return { items, total: items.length, sender: 'mock' };
  });

  return app;
}
