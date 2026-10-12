import { db } from '../db.ts';

export function clearStoreData(storeId: string) {
  const count = (sql: string) => (db.prepare(sql).get(storeId) as { n: number }).n;
  const customers = count('SELECT COUNT(*) AS n FROM customers WHERE store_id=?');
  const orders = count('SELECT COUNT(*) AS n FROM orders WHERE store_id=?');
  const checkouts = count('SELECT COUNT(*) AS n FROM abandoned_checkouts WHERE store_id=?');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE outreach_id IN (SELECT id FROM outreach WHERE store_id=?)').run(storeId);
    db.prepare('DELETE FROM drafts WHERE outreach_id IN (SELECT id FROM outreach WHERE store_id=?)').run(storeId);
    db.prepare('DELETE FROM outreach_recipients WHERE outreach_id IN (SELECT id FROM outreach WHERE store_id=?)').run(storeId);
    db.prepare('DELETE FROM generation_jobs WHERE store_id=?').run(storeId);
    db.prepare('DELETE FROM facts WHERE store_id=?').run(storeId);
    db.prepare(
      'DELETE FROM abandoned_checkout_items WHERE checkout_id IN (SELECT id FROM abandoned_checkouts WHERE store_id=?)',
    ).run(storeId);
    db.prepare('DELETE FROM abandoned_checkouts WHERE store_id=?').run(storeId);
    db.prepare('DELETE FROM customer_notes WHERE store_id=?').run(storeId);
    db.prepare('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE store_id=?)').run(storeId);
    db.prepare('DELETE FROM orders WHERE store_id=?').run(storeId);
    db.prepare('DELETE FROM outreach WHERE store_id=?').run(storeId);
    db.prepare('DELETE FROM customers WHERE store_id=?').run(storeId);
  });
  run();
  return { customers, orders, checkouts };
}
