import { CustomerBriefSchema, type CustomerBrief } from '@copilot/shared';
import { appToday, db, nowIso, uuid } from '../db.ts';
import { daysBetween } from '../csv.ts';
import { redactNote } from '../templates.ts';
import { hasModelClient } from './model.ts';
import { composeLetter, type Letter } from './compose.ts';

type Recipient = {
  id: string;
  customer_id: string;
  language: string;
  mode: string;
  eligible: number;
};

type Customer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  language: string;
  order_count: number;
  spend_tier: string;
  top_category: string | null;
  last_order_at: string | null;
  preference_tags: string;
};

const running = new Set<string>();

export function interruptWritingJobs() {
  db.prepare("UPDATE generation_jobs SET status='interrupted', updated_at=? WHERE status='writing'").run(nowIso());
  running.clear();
}

function confirmedQuotes(customerId: string) {
  return (
    db
      .prepare("SELECT quote FROM facts WHERE customer_id=? AND status='confirmed' ORDER BY created_at")
      .all(customerId) as { quote: string }[]
  )
    .map((row) => redactNote(row.quote))
    .filter((quote) => quote.trim());
}

function purchasesOf(customerId: string) {
  return db
    .prepare(
      `SELECT i.title, i.category, o.created_at_shop
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id=? AND o.financial_status='paid'
       ORDER BY o.created_at_shop DESC LIMIT 8`,
    )
    .all(customerId) as { title: string; category: string; created_at_shop: string }[];
}

export function buildBrief(customer: Customer, shared: boolean): CustomerBrief {
  const today = appToday();
  const purchases = purchasesOf(customer.id).map((purchase) => ({
    title: shared ? '' : purchase.title,
    category: shared ? customer.top_category || purchase.category : purchase.category,
    daysAgo: daysBetween(purchase.created_at_shop, today),
  }));
  if (shared && purchases.length === 0) {
    purchases.push({ title: '', category: customer.top_category || 'cat_food', daysAgo: 0 });
  }
  return {
    language: customer.language === 'es' ? 'es' : 'en',
    country: customer.country || '',
    orderCount: customer.order_count,
    spendTier: customer.spend_tier === 'high' || customer.spend_tier === 'mid' ? customer.spend_tier : 'low',
    daysSinceLastOrder: shared || !customer.last_order_at ? null : daysBetween(customer.last_order_at, today),
    purchases: shared ? purchases.slice(0, 1) : purchases,
    preferenceTags: [],
    notes: shared ? [] : confirmedQuotes(customer.id),
  };
}

function lastProduct(customerId: string) {
  const row = db
    .prepare(
      `SELECT i.title FROM order_items i JOIN orders o ON o.id=i.order_id
       WHERE o.customer_id=? AND o.financial_status='paid'
       ORDER BY o.created_at_shop DESC LIMIT 1`,
    )
    .get(customerId) as { title: string } | undefined;
  return row?.title || '';
}

function queuedRecipients(outreachId: string) {
  return db
    .prepare(
      `SELECT r.* FROM outreach_recipients r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.outreach_id=? AND r.eligible=1
         AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.recipient_id=r.id)
       ORDER BY c.last_name, c.first_name, c.email`,
    )
    .all(outreachId) as Recipient[];
}

function nextUnfinished(outreachId: string) {
  return db
    .prepare(
      `SELECT r.customer_id FROM outreach_recipients r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.outreach_id=? AND r.eligible=1
         AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.recipient_id=r.id AND d.generation_ok=1)
       ORDER BY c.last_name, c.first_name, c.email
       LIMIT 1`,
    )
    .get(outreachId) as { customer_id: string } | undefined;
}

function rememberShared(
  outreachId: string,
  parts: { language: string; country: string | null; scenario: string; spendTier: string; topCategory: string | null },
) {
  return db
    .prepare(
      `SELECT d.subject, d.body, d.zh_subject, d.zh_body, d.personalization_points, d.writer
       FROM drafts d
       JOIN outreach_recipients r ON r.id=d.recipient_id
       JOIN customers c ON c.id=d.customer_id
       JOIN outreach o ON o.id=d.outreach_id
       WHERE d.outreach_id=? AND r.mode='cohort' AND d.generation_ok=1
         AND c.language=? AND IFNULL(c.country, '')=? AND o.scenario=? AND c.spend_tier=? AND IFNULL(c.top_category, '')=?
       LIMIT 1`,
    )
    .get(
      outreachId,
      parts.language,
      parts.country || '',
      parts.scenario,
      parts.spendTier,
      parts.topCategory || '',
    ) as
    | {
        subject: string;
        body: string;
        zh_subject: string;
        zh_body: string;
        personalization_points: string;
        writer: string | null;
      }
    | undefined;
}

async function letterFor(
  outreachId: string,
  recipient: Recipient,
  intentZh: string,
  discountCode: string | null,
  reuseShared = true,
) {
  const customer = db.prepare('SELECT * FROM customers WHERE id=?').get(recipient.customer_id) as Customer;
  const outreach = db.prepare('SELECT scenario FROM outreach WHERE id=?').get(outreachId) as { scenario: string };
  const shared = recipient.mode === 'cohort';
  if (shared && reuseShared) {
    const existing = rememberShared(outreachId, {
      language: customer.language,
      country: customer.country,
      scenario: outreach.scenario,
      spendTier: customer.spend_tier,
      topCategory: customer.top_category,
    });
    if (existing) {
      return {
        subject: existing.subject,
        body: existing.body,
        zhSubject: existing.zh_subject,
        zhBody: existing.zh_body,
        points: JSON.parse(existing.personalization_points) as string[],
        writer: (existing.writer === 'model' ? 'model' : 'template') as Letter['writer'],
        failed: false,
        copied: true,
      };
    }
  }
  const brief = buildBrief(customer, shared);
  const parsed = CustomerBriefSchema.safeParse(brief);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || '客户简报无效');
  const letter = await composeLetter(parsed.data, intentZh, discountCode || undefined, shared);
  return { ...letter, copied: false };
}

export async function writeSome(outreachId: string, limit = 25) {
  const job = db.prepare('SELECT * FROM generation_jobs WHERE outreach_id=?').get(outreachId) as
    | { status: string; failed_count: number }
    | undefined;
  if (!job || job.status !== 'writing') return false;
  const outreach = db.prepare('SELECT intent_zh, discount_code FROM outreach WHERE id=?').get(outreachId) as {
    intent_zh: string;
    discount_code: string | null;
  };
  const pending = queuedRecipients(outreachId);
  if (pending.length === 0) {
    db.prepare(
      "UPDATE generation_jobs SET status='done', completed_count=planned_count, next_customer_id=NULL, updated_at=? WHERE outreach_id=?",
    ).run(nowIso(), outreachId);
    db.prepare("UPDATE outreach SET status='reviewing' WHERE id=? AND status!='sent'").run(outreachId);
    return false;
  }
  const slice = pending.slice(0, limit);
  let failed = job.failed_count;
  const insert = db.prepare(
    `INSERT INTO drafts
      (id, outreach_id, recipient_id, customer_id, language, mode, subject, body, zh_subject, zh_body, personalization_points, status, last_product, writer, generation_ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
  );
  const replaceFailed = db.prepare('DELETE FROM drafts WHERE recipient_id=? AND generation_ok=0');
  for (const recipient of slice) {
    const still = db.prepare('SELECT status FROM generation_jobs WHERE outreach_id=?').get(outreachId) as {
      status: string;
    };
    if (still.status !== 'writing') return false;
    replaceFailed.run(recipient.id);
    const letter = await letterFor(outreachId, recipient, outreach.intent_zh, outreach.discount_code);
    const ok = letter.failed ? 0 : 1;
    if (letter.failed && !letter.copied) failed += 1;
    insert.run(
      uuid(),
      outreachId,
      recipient.id,
      recipient.customer_id,
      recipient.language,
      recipient.mode,
      letter.subject,
      letter.body,
      letter.zhSubject,
      letter.zhBody,
      JSON.stringify(letter.points),
      lastProduct(recipient.customer_id),
      letter.writer,
      ok,
    );
  }
  const remaining = queuedRecipients(outreachId);
  const completed = (
    db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE outreach_id=? AND generation_ok=1').get(outreachId) as {
      n: number;
    }
  ).n;
  const done = remaining.length === 0;
  db.prepare(
    `UPDATE generation_jobs
     SET status=?, completed_count=?, failed_count=?, next_customer_id=?, updated_at=?
     WHERE outreach_id=?`,
  ).run(done ? 'done' : 'writing', completed, failed, nextUnfinished(outreachId)?.customer_id ?? null, nowIso(), outreachId);
  if (done) db.prepare("UPDATE outreach SET status='reviewing' WHERE id=? AND status!='sent'").run(outreachId);
  return !done;
}

export function kickGeneration(outreachId: string) {
  if (running.has(outreachId)) return;
  running.add(outreachId);
  const loop = () => {
    void writeSome(outreachId)
      .then((more) => {
        if (more && running.has(outreachId)) setImmediate(loop);
        else running.delete(outreachId);
      })
      .catch(() => {
        db.prepare("UPDATE generation_jobs SET status='interrupted', updated_at=? WHERE outreach_id=? AND status='writing'").run(
          nowIso(),
          outreachId,
        );
        running.delete(outreachId);
      });
  };
  setImmediate(loop);
}

export function beginGeneration(outreachId: string, storeId: string) {
  const owns = db.prepare('SELECT id FROM outreach WHERE id=? AND store_id=?').get(outreachId, storeId);
  if (!owns) return null;
  const eligible = db
    .prepare(
      `SELECT r.customer_id FROM outreach_recipients r
       JOIN customers c ON c.id=r.customer_id
       WHERE r.outreach_id=? AND r.eligible=1
       ORDER BY c.last_name, c.first_name, c.email`,
    )
    .all(outreachId) as { customer_id: string }[];
  if (eligible.length === 0) return { empty: true as const };
  const now = nowIso();
  db.prepare('DELETE FROM generation_jobs WHERE outreach_id=?').run(outreachId);
  db.prepare('DELETE FROM drafts WHERE outreach_id=?').run(outreachId);
  db.prepare(
    `INSERT INTO generation_jobs
      (id, store_id, outreach_id, status, planned_count, completed_count, failed_count, next_customer_id, writer, updated_at)
     VALUES (?, ?, ?, 'writing', ?, 0, 0, ?, ?, ?)`,
  ).run(uuid(), storeId, outreachId, eligible.length, eligible[0].customer_id, hasModelClient() ? 'model' : 'template', now);
  kickGeneration(outreachId);
  return { empty: false as const };
}

export function continueGeneration(outreachId: string, storeId: string) {
  const job = db
    .prepare(
      `SELECT g.* FROM generation_jobs g JOIN outreach o ON o.id=g.outreach_id
       WHERE g.outreach_id=? AND o.store_id=?`,
    )
    .get(outreachId, storeId) as { id: string; planned_count: number } | undefined;
  if (!job) return false;
  db.prepare('DELETE FROM drafts WHERE outreach_id=? AND generation_ok=0').run(outreachId);
  const next = nextUnfinished(outreachId);
  db.prepare(
    "UPDATE generation_jobs SET status='writing', next_customer_id=?, updated_at=? WHERE id=?",
  ).run(next?.customer_id ?? null, nowIso(), job.id);
  kickGeneration(outreachId);
  return true;
}

export async function regenerateDraft(draftId: string, storeId: string) {
  const draft = db
    .prepare(
      `SELECT d.*, o.intent_zh, o.discount_code, o.id AS outreach_id
       FROM drafts d JOIN outreach o ON o.id=d.outreach_id
       WHERE d.id=? AND o.store_id=?`,
    )
    .get(draftId, storeId) as
    | {
        id: string;
        recipient_id: string;
        customer_id: string;
        language: string;
        mode: string;
        outreach_id: string;
        intent_zh: string;
        discount_code: string | null;
      }
    | undefined;
  if (!draft) return null;
  const before = db.prepare('SELECT body FROM drafts WHERE outreach_id=? AND id!=?').all(draft.outreach_id, draft.id) as {
    body: string;
  }[];
  const letter = await letterFor(
    draft.outreach_id,
    {
      id: draft.recipient_id,
      customer_id: draft.customer_id,
      language: draft.language,
      mode: draft.mode,
      eligible: 1,
    },
    draft.intent_zh,
    draft.discount_code,
    false,
  );
  db.prepare(
    `UPDATE drafts
     SET subject=?, body=?, zh_subject=?, zh_body=?, personalization_points=?, status='ready', edited=0, writer=?, generation_ok=1, last_product=?
     WHERE id=?`,
  ).run(
    letter.subject,
    letter.body,
    letter.zhSubject,
    letter.zhBody,
    JSON.stringify(letter.points),
    letter.writer,
    lastProduct(draft.customer_id),
    draft.id,
  );
  const after = db.prepare('SELECT body FROM drafts WHERE outreach_id=? AND id!=?').all(draft.outreach_id, draft.id) as {
    body: string;
  }[];
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('其他信被改写了');
  return draft.id;
}
