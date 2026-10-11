import { db } from './db.ts';
import { daysBetween } from './csv.ts';
import { appToday } from './db.ts';
import { isEmailEligible } from './eligibility.ts';
import {
  cohortKey,
  inAbandonedWindow,
  inDormantWindow,
  inFirstOrderWindow,
  inRepurchaseWindow,
  quoteCost,
} from './audience-rules.ts';

export type AudienceCustomer = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  country: string | null;
  language: string;
  email_consent: number;
  unsubscribed_at: string | null;
  order_count: number;
  spend_tier: string;
  top_category: string | null;
  last_order_at: string | null;
};

export type AudienceFilters = {
  language?: string;
  category?: string;
  spendTier?: string;
  hasNotes?: boolean;
};

export function hasConfirmedFact(customerId: string) {
  return Boolean(
    db.prepare("SELECT 1 AS ok FROM facts WHERE customer_id=? AND status='confirmed' LIMIT 1").get(customerId),
  );
}

export function isPersonalized(row: { id: string; order_count: number }) {
  return row.order_count >= 2 || hasConfirmedFact(row.id);
}

function matchesRepurchase(customerId: string, today: string) {
  const rows = db
    .prepare(
      `SELECT i.category, MAX(o.created_at_shop) AS last_at
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id=? AND o.financial_status='paid'
       GROUP BY i.category`,
    )
    .all(customerId) as { category: string; last_at: string }[];
  return rows.some((row) => inRepurchaseWindow(row.category, daysBetween(row.last_at, today)));
}

function matchesAbandoned(customerId: string, today: string) {
  const checkouts = db
    .prepare('SELECT created_at_shop FROM abandoned_checkouts WHERE customer_id=?')
    .all(customerId) as { created_at_shop: string }[];
  const laterOrder = db.prepare(
    `SELECT 1 AS ok FROM orders
     WHERE customer_id=? AND financial_status='paid' AND substr(created_at_shop, 1, 10) > substr(?, 1, 10)
     LIMIT 1`,
  );
  return checkouts.some((checkout) => {
    const days = daysBetween(checkout.created_at_shop, today);
    if (!inAbandonedWindow(days)) return false;
    return !laterOrder.get(customerId, checkout.created_at_shop);
  });
}

export function selectAudience(storeId: string, scenario: string, filters: AudienceFilters = {}) {
  const abandoned = db.prepare('SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE store_id=?').get(storeId) as {
    n: number;
  };
  if (scenario === 'abandoned_checkout' && abandoned.n === 0) {
    return { missingAbandoned: true, rows: [] as AudienceCustomer[] };
  }
  let rows = db.prepare('SELECT * FROM customers WHERE store_id=?').all(storeId) as AudienceCustomer[];
  if (filters.language) rows = rows.filter((row) => row.language === filters.language);
  if (filters.category) rows = rows.filter((row) => row.top_category === filters.category);
  if (filters.spendTier) rows = rows.filter((row) => row.spend_tier === filters.spendTier);
  if (filters.hasNotes === true) {
    rows = rows.filter((row) =>
      db.prepare('SELECT 1 FROM customer_notes WHERE customer_id=? LIMIT 1').get(row.id),
    );
  }
  if (filters.hasNotes === false) {
    rows = rows.filter((row) => !db.prepare('SELECT 1 FROM customer_notes WHERE customer_id=? LIMIT 1').get(row.id));
  }
  const today = appToday();
  if (scenario === 'winback_dormant') {
    rows = rows.filter((row) => row.last_order_at != null && inDormantWindow(daysBetween(row.last_order_at, today)));
  } else if (scenario === 'first_to_second') {
    rows = rows.filter(
      (row) => row.last_order_at != null && inFirstOrderWindow(row.order_count, daysBetween(row.last_order_at, today)),
    );
  } else if (scenario === 'repurchase') {
    rows = rows.filter((row) => matchesRepurchase(row.id, today));
  } else if (scenario === 'abandoned_checkout') {
    rows = rows.filter((row) => matchesAbandoned(row.id, today));
  }
  return { missingAbandoned: false, rows };
}

export function customersByIds(storeId: string, ids: string[]) {
  const found = new Map<string, AudienceCustomer>();
  for (let index = 0; index < ids.length; index += 400) {
    const slice = ids.slice(index, index + 400);
    const marks = slice.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM customers WHERE store_id=? AND id IN (${marks})`)
      .all(storeId, ...slice) as AudienceCustomer[];
    for (const row of rows) found.set(row.id, row);
  }
  return ids.map((id) => found.get(id)).filter((row): row is AudienceCustomer => Boolean(row));
}

export function summarizeAudience(rows: AudienceCustomer[], scenario: string) {
  const eligible = rows.filter((row) => isEmailEligible(row));
  const personalizedRows = eligible.filter((row) => isPersonalized(row));
  const cohortRows = eligible.filter((row) => !isPersonalized(row));
  const groups = new Set(
    cohortRows.map((row) =>
      cohortKey({
        language: row.language,
        country: row.country,
        scenario,
        spendTier: row.spend_tier,
        topCategory: row.top_category,
      }),
    ),
  );
  const languages = { en: 0, es: 0 };
  for (const row of eligible) {
    if (row.language === 'es') languages.es += 1;
    else languages.en += 1;
  }
  const cost = quoteCost(personalizedRows.length, groups.size);
  return {
    total: rows.length,
    reachable: eligible.length,
    excluded: rows.length - eligible.length,
    languages,
    personalized: personalizedRows.length,
    cohort: cohortRows.length,
    cohortGroups: groups.size,
    calls: cost.calls,
    unitPriceCents: cost.unitPriceCents,
    costCents: cost.costCents,
    costConfigured: cost.configured,
  };
}
