import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import {
  AddNoteBody,
  AddPreferenceTagBody,
  CreateOutreachBody,
  CustomerBriefSchema,
  ErrorCodes,
  LoginBody,
  ImportCustomerOrdersBody,
  PreviewAudienceBody,
  ReviewDraftBody,
  UpdateCompanyAddressBody,
  UpdateDraftBody,
  UpdateLanguageBody,
  errorBody,
} from '@copilot/shared';
import { appToday, db, nowIso, uuid } from './db.ts';
import { daysBetween } from './csv.ts';
import { applyCustomerOrders, previewCustomerOrders } from './imports/index.ts';
import { exclusionReason, isEmailEligible } from './eligibility.ts';
import { checkDraft, detectPrivacy, generateTemplate, redactNote, renderCopy } from './templates.ts';

type Authed = { userId: string; storeId: string };

class BriefRejected extends Error {}

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

function audienceFilter(storeId: string, scenario: string, language?: string, hasNotes?: boolean) {
  let sql = 'SELECT c.* FROM customers c WHERE c.store_id = ?';
  const params: unknown[] = [storeId];
  if (scenario === 'winback_dormant') {
    sql += " AND c.last_order_at IS NOT NULL AND c.last_order_at <= date(?, '-60 days')";
    params.push(appToday());
  }
  if (language) {
    sql += ' AND c.language = ?';
    params.push(language);
  }
  if (hasNotes === true) {
    sql += ' AND EXISTS (SELECT 1 FROM customer_notes n WHERE n.customer_id=c.id)';
  }
  if (hasNotes === false) {
    sql += ' AND NOT EXISTS (SELECT 1 FROM customer_notes n WHERE n.customer_id=c.id)';
  }
  return db.prepare(sql).all(...params) as CustomerRow[];
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

function generationMode(row: CustomerRow) {
  const notes = notesOf(row.id);
  const tags = JSON.parse(row.preference_tags || '[]') as string[];
  return row.order_count >= 2 || notes.length > 0 || tags.length > 0 ? 'personalized' : 'cohort';
}

function issuesFor(body: string) {
  return checkDraft(body);
}

export async function buildApp() {
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
    };
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
    const rows = audienceFilter(auth.storeId, parsed.data.scenario, parsed.data.language, parsed.data.hasNotes);
    const eligible = rows.filter((r) => isEmailEligible(r));
    const languages = { en: 0, es: 0 };
    for (const row of eligible) languages[row.language as 'en' | 'es'] += 1;
    return {
      total: rows.length,
      reachable: eligible.length,
      excluded: rows.length - eligible.length,
      languages,
      personalized: eligible.filter((r) => generationMode(r) === 'personalized').length,
      cohort: eligible.filter((r) => generationMode(r) === 'cohort').length,
    };
  });

  app.post('/api/v1/outreach', async (req, reply) => {
    const auth = (req as typeof req & { auth: Authed }).auth;
    const parsed = CreateOutreachBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, parsed.error.issues[0]?.message || '创建失败'));
    }
    const rows = audienceFilter(auth.storeId, parsed.data.scenario, parsed.data.language, parsed.data.hasNotes);
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
      const eligible = isEmailEligible(row);
      insert.run(
        uuid(),
        id,
        row.id,
        row.language,
        eligible ? 1 : 0,
        eligible ? null : exclusionReason(row),
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
    const outreach = getOutreach((req.params as { id: string }).id, auth.storeId);
    if (!outreach) return reply.code(404).send(errorBody(ErrorCodes.NOT_FOUND, '推广不存在'));
    const recipients = db
      .prepare('SELECT * FROM outreach_recipients WHERE outreach_id=? AND eligible=1')
      .all(outreach.id) as { id: string; customer_id: string; language: string; mode: string }[];
    if (recipients.length === 0) {
      return reply.code(409).send(errorBody(ErrorCodes.NO_ELIGIBLE_RECIPIENTS, '没有可发送的客户'));
    }
    const insert = db.prepare(
      `INSERT INTO drafts (id, outreach_id, recipient_id, customer_id, language, mode, subject, body, zh_subject, zh_body, personalization_points, status, last_product)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    );
    const writeDrafts = db.transaction(() => {
      db.prepare('DELETE FROM drafts WHERE outreach_id=?').run(outreach.id);
      for (const recipient of recipients) {
        const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(recipient.customer_id) as CustomerRow;
        const purchases = customerPurchases(customer.id).map((p) => ({
          title: p.title,
          category: p.category,
          daysAgo: daysBetween(p.created_at_shop, appToday()),
        }));
        const notes = notesOf(customer.id).slice(0, 5).map((n) => redactNote(n.text));
        const parsedBrief = CustomerBriefSchema.safeParse({
          language: customer.language,
          country: customer.country || '',
          orderCount: customer.order_count,
          spendTier: customer.spend_tier,
          daysSinceLastOrder: customer.last_order_at ? daysBetween(customer.last_order_at, appToday()) : null,
          purchases,
          preferenceTags: JSON.parse(customer.preference_tags || '[]'),
          notes,
        });
        if (!parsedBrief.success) {
          throw new BriefRejected(parsedBrief.error.issues[0]?.message || '客户简报无效');
        }
        const copy = generateTemplate(parsedBrief.data, outreach.intentZh, outreach.discountCode || undefined);
        insert.run(
          uuid(),
          outreach.id,
          recipient.id,
          customer.id,
          customer.language,
          recipient.mode,
          copy.subject,
          copy.body,
          copy.zhSubject,
          copy.zhBody,
          JSON.stringify(copy.points),
          purchases[0]?.title || '',
        );
      }
      db.prepare("UPDATE outreach SET status='reviewing' WHERE id=?").run(outreach.id);
    });
    try {
      writeDrafts();
    } catch (err) {
      if (!(err instanceof BriefRejected)) throw err;
      return reply.code(400).send(errorBody(ErrorCodes.VALIDATION_FAILED, err.message));
    }
    return getOutreach(outreach.id, auth.storeId);
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
    db.prepare('UPDATE drafts SET status=? WHERE id=?').run(
      parsed.data.decision === 'approve' ? 'approved' : 'rejected',
      draft.id,
    );
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
      unsubscribe_url: `http://localhost:3000/u/${token}`,
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
      if (!isEmailEligible(customer)) continue;
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
