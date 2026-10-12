import { db, nowIso, uuid } from '../db.ts';
import { getField, parseCsv } from '../csv.ts';
import { redactNote } from '../templates.ts';
import { classifyQuote } from '../generation/model.ts';

export type ChatSourceId = 'gorgias';

export type GorgiasPreview = {
  rows: number;
  withText: number;
  matched: number;
  unmatched: number;
  skipped: number;
};

type GorgiasRow = { email: string; text: string };

export function parseGorgiasCsv(csv: string) {
  const parsed = parseCsv(csv);
  let skipped = 0;
  const messages: GorgiasRow[] = [];
  for (const row of parsed) {
    const email = getField(row, 'customer email').toLowerCase();
    const text = getField(row, 'message text');
    if (!text) {
      skipped += 1;
      continue;
    }
    if (!email) {
      skipped += 1;
      continue;
    }
    messages.push({ email, text });
  }
  return { rows: parsed.length, skipped, messages };
}

export function previewGorgias(storeId: string, csv: string): GorgiasPreview {
  const parsed = parseGorgiasCsv(csv);
  const known = new Set(
    (db.prepare('SELECT email FROM customers WHERE store_id=?').all(storeId) as { email: string }[]).map((row) =>
      row.email.toLowerCase(),
    ),
  );
  let matched = 0;
  let unmatched = 0;
  for (const message of parsed.messages) {
    if (known.has(message.email)) matched += 1;
    else unmatched += 1;
  }
  return { rows: parsed.rows, withText: parsed.messages.length, matched, unmatched, skipped: parsed.skipped };
}

export async function applyGorgias(storeId: string, csv: string) {
  const parsed = parseGorgiasCsv(csv);
  const customers = db.prepare('SELECT id, email FROM customers WHERE store_id=?').all(storeId) as {
    id: string;
    email: string;
  }[];
  const byEmail = new Map(customers.map((row) => [row.email.toLowerCase(), row.id]));
  const insert = db.prepare(
    `INSERT INTO facts (id, store_id, customer_id, kind, status, source, quote, created_at)
     VALUES (?, ?, ?, ?, 'suggested', 'gorgias', ?, ?)`,
  );
  const existing = db.prepare("SELECT id FROM facts WHERE customer_id=? AND source='gorgias' AND quote=?");
  let matched = 0;
  let unmatched = 0;
  let created = 0;
  const now = nowIso();
  for (const message of parsed.messages) {
    const customerId = byEmail.get(message.email);
    if (!customerId) {
      unmatched += 1;
      continue;
    }
    matched += 1;
    const quote = redactNote(message.text).trim();
    if (!quote || existing.get(customerId, quote)) continue;
    const kind = await classifyQuote(quote);
    insert.run(uuid(), storeId, customerId, kind, quote, now);
    created += 1;
  }
  return { rows: parsed.rows, matched, unmatched, skipped: parsed.skipped, created };
}
