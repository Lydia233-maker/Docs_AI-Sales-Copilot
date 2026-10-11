import { db, uuid } from '../db.ts';
import { getField, parseCsv } from '../csv.ts';

export type AbandonedPreview = {
  rows: number;
  checkouts: number;
  matched: number;
  unmatched: number;
  storeCheckouts: number;
};

type ParsedCheckout = {
  externalId: string;
  email: string;
  createdAt: string;
  items: { title: string; quantity: number }[];
};

export function parseAbandonedCsv(csv: string): ParsedCheckout[] {
  const rows = parseCsv(csv);
  const groups: Record<string, string>[][] = [];
  let current: Record<string, string>[] | null = null;
  let currentId = '';
  for (const row of rows) {
    const id = getField(row, 'id');
    const email = getField(row, 'email');
    const title = getField(row, 'lineitem name');
    if (id && id !== currentId) {
      current = [row];
      currentId = id;
      groups.push(current);
      continue;
    }
    if (!email && current && title) {
      current.push(row);
      continue;
    }
    if (email || title) {
      current = [row];
      currentId = id;
      groups.push(current);
    }
  }
  const checkouts: ParsedCheckout[] = [];
  for (const lines of groups) {
    const first = lines.find((line) => getField(line, 'email')) || lines[0];
    const email = getField(first, 'email').toLowerCase();
    const createdAt = getField(first, 'created at');
    const externalId = getField(first, 'id') || `${email}|${createdAt}`;
    if (!email || !createdAt) continue;
    const items = lines
      .map((line) => {
        const title = getField(line, 'lineitem name');
        if (!title) return null;
        const quantity = Number(getField(line, 'lineitem quantity') || '1') || 1;
        return { title, quantity: Math.max(1, quantity) };
      })
      .filter((item): item is { title: string; quantity: number } => item !== null);
    if (items.length === 0) continue;
    checkouts.push({ externalId, email, createdAt, items });
  }
  return checkouts;
}

export function previewAbandoned(storeId: string, csv: string): AbandonedPreview {
  const checkouts = parseAbandonedCsv(csv);
  const known = new Set(
    (db.prepare('SELECT email FROM customers WHERE store_id=?').all(storeId) as { email: string }[]).map((row) =>
      row.email.toLowerCase(),
    ),
  );
  const matched = checkouts.filter((checkout) => known.has(checkout.email)).length;
  const storeCheckouts = db.prepare('SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE store_id=?').get(storeId) as {
    n: number;
  };
  return {
    rows: parseCsv(csv).length,
    checkouts: checkouts.length,
    matched,
    unmatched: checkouts.length - matched,
    storeCheckouts: storeCheckouts.n,
  };
}

export function applyAbandoned(storeId: string, csv: string) {
  const checkouts = parseAbandonedCsv(csv);
  const customers = db.prepare('SELECT id, email FROM customers WHERE store_id=?').all(storeId) as {
    id: string;
    email: string;
  }[];
  const byEmail = new Map(customers.map((row) => [row.email.toLowerCase(), row.id]));
  const run = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM abandoned_checkouts WHERE store_id=?').all(storeId) as { id: string }[];
    const deleteItems = db.prepare('DELETE FROM abandoned_checkout_items WHERE checkout_id=?');
    for (const row of existing) deleteItems.run(row.id);
    db.prepare('DELETE FROM abandoned_checkouts WHERE store_id=?').run(storeId);
    const insertCheckout = db.prepare(
      `INSERT INTO abandoned_checkouts (id, store_id, customer_id, email, external_id, created_at_shop)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      'INSERT INTO abandoned_checkout_items (id, checkout_id, title, quantity) VALUES (?, ?, ?, ?)',
    );
    let matched = 0;
    for (const checkout of checkouts) {
      const customerId = byEmail.get(checkout.email) ?? null;
      if (customerId) matched += 1;
      const id = uuid();
      insertCheckout.run(id, storeId, customerId, checkout.email, checkout.externalId, checkout.createdAt);
      for (const item of checkout.items) insertItem.run(uuid(), id, item.title, item.quantity);
    }
    return { checkouts: checkouts.length, matched, unmatched: checkouts.length - matched };
  });
  return run();
}
