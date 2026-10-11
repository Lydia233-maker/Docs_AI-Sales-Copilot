import { db, nowIso, uuid } from '../db.ts';
import { repeatedTitlePhrases } from './phrases.ts';

export function syncCustomerFacts(storeId: string, customerId: string) {
  const titles = db
    .prepare(
      `SELECT i.title FROM order_items i
       JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id=? AND o.financial_status='paid'`,
    )
    .all(customerId) as { title: string }[];
  const phrases = repeatedTitlePhrases(titles.map((row) => row.title));
  const existingTitle = db.prepare(
    "SELECT quote FROM facts WHERE customer_id=? AND source='title'",
  );
  const known = new Set((existingTitle.all(customerId) as { quote: string }[]).map((row) => row.quote.toLowerCase()));
  const insert = db.prepare(
    `INSERT INTO facts (id, store_id, customer_id, kind, status, source, quote, created_at)
     VALUES (?, ?, ?, 'preference', 'suggested', 'title', ?, ?)`,
  );
  const now = nowIso();
  for (const phrase of phrases) {
    if (known.has(phrase.toLowerCase())) continue;
    insert.run(uuid(), storeId, customerId, phrase, now);
  }

  const notes = db.prepare('SELECT text FROM customer_notes WHERE customer_id=?').all(customerId) as { text: string }[];
  const existingNote = db.prepare("SELECT quote FROM facts WHERE customer_id=? AND source='note' AND quote=?");
  const insertNote = db.prepare(
    `INSERT INTO facts (id, store_id, customer_id, kind, status, source, quote, created_at)
     VALUES (?, ?, ?, 'preference', 'confirmed', 'note', ?, ?)`,
  );
  for (const note of notes) {
    const quote = note.text.trim();
    if (!quote || existingNote.get(customerId, quote)) continue;
    insertNote.run(uuid(), storeId, customerId, quote, now);
  }
}

export function syncStoreFacts(storeId: string) {
  const customers = db.prepare('SELECT id FROM customers WHERE store_id=?').all(storeId) as { id: string }[];
  for (const customer of customers) syncCustomerFacts(storeId, customer.id);
}
