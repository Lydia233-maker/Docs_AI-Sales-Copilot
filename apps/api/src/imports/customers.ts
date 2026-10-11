import { db, nowIso, uuid } from '../db.ts';
import {
  categoryOf,
  getField,
  groupOrderRows,
  inferLanguage,
  moneyToCents,
  parseCsv,
} from '../csv.ts';
import { redactNote } from '../templates.ts';

export type CustomerOrderPreview = {
  customerRows: number;
  customers: number;
  skippedCustomers: number;
  spanish: number;
  notes: number;
  orderRows: number;
  orders: number;
  unmatchedOrders: number;
  storeCustomers: number;
};

type ParsedCustomer = {
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  language: 'en' | 'es';
  tags: string;
  emailConsent: number;
  noteRaw: string;
  note: string;
};

type ParsedItem = {
  title: string;
  category: string;
  quantity: number;
  priceCents: number;
};

type ParsedOrder = {
  externalId: string;
  name: string;
  email: string;
  createdAt: string;
  totalCents: number;
  financialStatus: string;
  items: ParsedItem[];
  matchedInFile: boolean;
};

function spendTier(cents: number) {
  if (cents >= 12000) return 'high';
  if (cents >= 5000) return 'mid';
  return 'low';
}

export function parseCustomerOrderFiles(customersCsv: string, ordersCsv: string) {
  const customerRows = parseCsv(customersCsv);
  const customers: ParsedCustomer[] = [];
  let skippedCustomers = 0;
  for (const row of customerRows) {
    const email = getField(row, 'email').toLowerCase();
    if (!email) {
      skippedCustomers += 1;
      continue;
    }
    const tags = getField(row, 'tags');
    const country = getField(row, 'default address country code', 'country');
    const noteRaw = getField(row, 'note');
    customers.push({
      externalId: getField(row, 'customer id') || email,
      email,
      firstName: getField(row, 'first name'),
      lastName: getField(row, 'last name'),
      country,
      language: inferLanguage(tags, country),
      tags,
      emailConsent: /^(yes|true|1)$/i.test(getField(row, 'accepts email marketing')) ? 1 : 0,
      noteRaw,
      note: noteRaw ? redactNote(noteRaw) : '',
    });
  }
  const emails = new Set(customers.map((customer) => customer.email));
  const orderRows = parseCsv(ordersCsv);
  const orders: ParsedOrder[] = [];
  for (const lines of groupOrderRows(orderRows)) {
    const first = lines[0];
    const name = getField(first, 'name');
    const externalId = getField(first, 'id') || name;
    if (!externalId) continue;
    const email = getField(first, 'email').toLowerCase();
    const items = lines
      .map((line) => {
        const title = getField(line, 'lineitem name');
        if (!title) return null;
        return {
          title,
          category: categoryOf(title),
          quantity: Number(getField(line, 'lineitem quantity') || '1') || 1,
          priceCents: moneyToCents(getField(line, 'lineitem price')),
        };
      })
      .filter((item): item is ParsedItem => item !== null);
    const priced = lines.reduce((sum, line) => sum + moneyToCents(getField(line, 'lineitem price')), 0);
    orders.push({
      externalId,
      name: name || externalId,
      email,
      createdAt: getField(first, 'created at'),
      totalCents: moneyToCents(getField(first, 'total')) || priced,
      financialStatus: getField(first, 'financial status') || 'paid',
      items,
      matchedInFile: emails.has(email),
    });
  }
  return { customerRows: customerRows.length, customers, skippedCustomers, orderRows: orderRows.length, orders };
}

export function previewCustomerOrders(storeId: string, customersCsv: string, ordersCsv: string): CustomerOrderPreview {
  const parsed = parseCustomerOrderFiles(customersCsv, ordersCsv);
  const storeCustomers = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE store_id=?').get(storeId) as { n: number };
  return {
    customerRows: parsed.customerRows,
    customers: parsed.customers.length,
    skippedCustomers: parsed.skippedCustomers,
    spanish: parsed.customers.filter((customer) => customer.language === 'es').length,
    notes: parsed.customers.filter((customer) => customer.note).length,
    orderRows: parsed.orderRows,
    orders: parsed.orders.length,
    unmatchedOrders: parsed.orders.filter((order) => !order.matchedInFile).length,
    storeCustomers: storeCustomers.n,
  };
}

export function applyCustomerOrders(storeId: string, customersCsv: string, ordersCsv: string) {
  const parsed = parseCustomerOrderFiles(customersCsv, ordersCsv);
  const now = nowIso();
  const run = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, email FROM customers WHERE store_id=?')
      .all(storeId) as { id: string; email: string }[];
    const byEmail = new Map(existing.map((row) => [row.email.toLowerCase(), row.id]));
    const touched = new Set<string>();
    const insertCustomer = db.prepare(
      `INSERT INTO customers
        (id, store_id, external_id, email, first_name, last_name, country, language, language_overridden, tags, email_consent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    );
    const updateCustomer = db.prepare(
      `UPDATE customers
       SET external_id=?, first_name=?, last_name=?, country=?, tags=?, email_consent=?,
           language=CASE WHEN language_overridden=1 THEN language ELSE ? END
       WHERE id=?`,
    );
    const findNote = db.prepare('SELECT id FROM customer_notes WHERE customer_id=? AND text=?');
    const replaceNote = db.prepare('UPDATE customer_notes SET text=? WHERE customer_id=? AND text=?');
    const insertNote = db.prepare(
      'INSERT INTO customer_notes (id, store_id, customer_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const customer of parsed.customers) {
      let id = byEmail.get(customer.email);
      if (id) {
        updateCustomer.run(
          customer.externalId,
          customer.firstName,
          customer.lastName,
          customer.country,
          JSON.stringify(customer.tags ? [customer.tags] : []),
          customer.emailConsent,
          customer.language,
          id,
        );
      } else {
        id = uuid();
        insertCustomer.run(
          id,
          storeId,
          customer.externalId,
          customer.email,
          customer.firstName,
          customer.lastName,
          customer.country,
          customer.language,
          JSON.stringify(customer.tags ? [customer.tags] : []),
          customer.emailConsent,
        );
        byEmail.set(customer.email, id);
      }
      touched.add(id);
      if (customer.note && !findNote.get(id, customer.note)) {
        const replaced =
          customer.noteRaw !== customer.note ? replaceNote.run(customer.note, id, customer.noteRaw).changes : 0;
        if (!replaced) insertNote.run(uuid(), storeId, id, customer.note, now);
      }
    }

    const findOrder = db.prepare('SELECT id FROM orders WHERE store_id=? AND external_id=?');
    const insertOrder = db.prepare(
      `INSERT INTO orders (id, store_id, customer_id, external_id, name, email, created_at_shop, total_cents, financial_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateOrder = db.prepare(
      `UPDATE orders SET customer_id=?, name=?, email=?, created_at_shop=?, total_cents=?, financial_status=? WHERE id=?`,
    );
    const deleteItems = db.prepare('DELETE FROM order_items WHERE order_id=?');
    const insertItem = db.prepare(
      'INSERT INTO order_items (id, order_id, title, category, quantity, price_cents) VALUES (?, ?, ?, ?, ?, ?)',
    );

    for (const order of parsed.orders) {
      const customerId = byEmail.get(order.email) ?? null;
      if (customerId) touched.add(customerId);
      const found = findOrder.get(storeId, order.externalId) as { id: string } | undefined;
      const orderId = found?.id ?? uuid();
      if (found) {
        updateOrder.run(
          customerId,
          order.name,
          order.email,
          order.createdAt,
          order.totalCents,
          order.financialStatus,
          orderId,
        );
        deleteItems.run(orderId);
      } else {
        insertOrder.run(
          orderId,
          storeId,
          customerId,
          order.externalId,
          order.name,
          order.email,
          order.createdAt,
          order.totalCents,
          order.financialStatus,
        );
      }
      for (const item of order.items) {
        insertItem.run(uuid(), orderId, item.title, item.category, item.quantity, item.priceCents);
      }
    }

    const paidOrders = db.prepare(
      `SELECT created_at_shop, total_cents FROM orders WHERE customer_id=? AND financial_status='paid' ORDER BY created_at_shop DESC`,
    );
    const itemsForCustomer = db.prepare(
      `SELECT i.category FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.customer_id=?`,
    );
    const updateProfile = db.prepare(
      `UPDATE customers SET order_count=?, total_spent_cents=?, last_order_at=?, spend_tier=?, top_category=? WHERE id=?`,
    );
    for (const customerId of touched) {
      const orders = paidOrders.all(customerId) as { created_at_shop: string; total_cents: number }[];
      const spent = orders.reduce((sum, order) => sum + order.total_cents, 0);
      const counts = new Map<string, number>();
      for (const item of itemsForCustomer.all(customerId) as { category: string }[]) {
        counts.set(item.category, (counts.get(item.category) || 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      updateProfile.run(orders.length, spent, orders[0]?.created_at_shop ?? null, spendTier(spent), top, customerId);
    }

    const spanish = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE store_id=? AND language='es'").get(storeId) as {
      n: number;
    };
    const total = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE store_id=?').get(storeId) as { n: number };
    return { customers: total.n, spanish: spanish.n, orders: parsed.orders.length };
  });
  return run();
}
