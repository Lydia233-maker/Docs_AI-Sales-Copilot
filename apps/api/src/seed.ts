import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appToday, db, nowIso, uuid } from './db.ts';
import {
  categoryOf,
  daysBetween,
  getField,
  groupOrderRows,
  inferLanguage,
  moneyToCents,
  parseCsv,
} from './csv.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDir = join(root, 'fixtures/demo-pet');

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function spendTier(cents: number) {
  if (cents >= 12000) return 'high';
  if (cents >= 5000) return 'mid';
  return 'low';
}

db.exec('DELETE FROM messages');
db.exec('DELETE FROM drafts');
db.exec('DELETE FROM outreach_recipients');
db.exec('DELETE FROM outreach');
db.exec('DELETE FROM customer_notes');
db.exec('DELETE FROM order_items');
db.exec('DELETE FROM orders');
db.exec('DELETE FROM customers');
db.exec('DELETE FROM sessions');
db.exec('DELETE FROM users');
db.exec('DELETE FROM stores');

const storeId = uuid();
const userId = uuid();
const created = nowIso();
db.prepare(
  'INSERT INTO stores (id, name, company_address, brand_voice, created_at) VALUES (?, ?, ?, ?, ?)',
).run(storeId, 'Paws Demo', '123 Demo St, Austin, TX 78701', 'warm', created);
db.prepare(
  'INSERT INTO users (id, store_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
).run(userId, storeId, 'demo@example.com', hashPassword('demo1234'), created);

const customerRows = parseCsv(readFileSync(join(fixtureDir, 'customers.csv'), 'utf8'));
const insertCustomer = db.prepare(
  `INSERT INTO customers (id, store_id, external_id, email, first_name, last_name, country, language, tags, email_consent)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const customerByEmail = new Map<string, string>();

for (const row of customerRows) {
  const id = uuid();
  const email = getField(row, 'email').toLowerCase();
  if (!email) continue;
  const tags = getField(row, 'tags');
  const country = getField(row, 'default address country code', 'country');
  insertCustomer.run(
    id,
    storeId,
    getField(row, 'customer id') || email,
    email,
    getField(row, 'first name'),
    getField(row, 'last name'),
    country,
    inferLanguage(tags, country),
    JSON.stringify(tags ? [tags] : []),
    /^(yes|true|1)$/i.test(getField(row, 'accepts email marketing')) ? 1 : 0,
  );
  customerByEmail.set(email, id);
}

const orderRows = parseCsv(readFileSync(join(fixtureDir, 'orders.csv'), 'utf8'));
const grouped = groupOrderRows(orderRows);

const insertOrder = db.prepare(
  `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertItem = db.prepare(
  `INSERT INTO order_items (id, order_id, title, category, quantity, price_cents) VALUES (?, ?, ?, ?, ?, ?)`,
);

for (const lines of grouped) {
  const first = lines[0];
  const name = getField(first, 'name');
  const email = getField(first, 'email').toLowerCase();
  const orderId = uuid();
  const total = moneyToCents(getField(first, 'total')) || lines.reduce((s, l) => s + moneyToCents(getField(l, 'lineitem price')), 0);
  insertOrder.run(
    orderId,
    storeId,
    customerByEmail.get(email) ?? null,
    getField(first, 'id') || name,
    name,
    email,
    getField(first, 'created at'),
    total,
    getField(first, 'financial status') || 'paid',
  );
  for (const line of lines) {
    const title = getField(line, 'lineitem name');
    insertItem.run(
      uuid(),
      orderId,
      title,
      categoryOf(title),
      Number(getField(line, 'lineitem quantity') || '1'),
      moneyToCents(getField(line, 'lineitem price')),
    );
  }
}

const customers = db.prepare('SELECT id FROM customers WHERE store_id = ?').all(storeId) as { id: string }[];
const updateProfile = db.prepare(
  `UPDATE customers SET order_count=?, total_spent_cents=?, last_order_at=?, spend_tier=?, top_category=? WHERE id=?`,
);
const paidOrders = db.prepare(
  `SELECT created_at_shop, total_cents FROM orders WHERE customer_id=? AND financial_status='paid' ORDER BY created_at_shop DESC`,
);
const itemsForCustomer = db.prepare(
  `SELECT i.title, i.category FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.customer_id=?`,
);

for (const c of customers) {
  const orders = paidOrders.all(c.id) as { created_at_shop: string; total_cents: number }[];
  const spent = orders.reduce((s, o) => s + o.total_cents, 0);
  const items = itemsForCustomer.all(c.id) as { title: string; category: string }[];
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  updateProfile.run(orders.length, spent, orders[0]?.created_at_shop ?? null, spendTier(spent), top, c.id);
}

const notes = JSON.parse(readFileSync(join(fixtureDir, 'notes.json'), 'utf8')) as {
  customerExternalId: string;
  text: string;
}[];
const findCustomer = db.prepare('SELECT id FROM customers WHERE store_id=? AND external_id=?');
const insertNote = db.prepare(
  'INSERT INTO customer_notes (id, store_id, customer_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
);
for (const note of notes) {
  const row = findCustomer.get(storeId, note.customerExternalId) as { id: string } | undefined;
  if (row) insertNote.run(uuid(), storeId, row.id, note.text, created);
}

const summary = db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
const today = appToday();
const dormant = (
  db
    .prepare("SELECT COUNT(*) AS n FROM customers WHERE last_order_at IS NOT NULL AND last_order_at <= date(?, '-60 days')")
    .get(today) as { n: number }
).n;
console.log(`seeded ${summary.n} customers, dormant=${dormant}, today=${today}`);
console.log('login: demo@example.com / demo1234');
