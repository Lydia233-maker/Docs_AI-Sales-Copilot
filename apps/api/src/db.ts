import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.env.DATABASE_PATH || 'data/app.db';
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_address TEXT NOT NULL DEFAULT '123 Demo St, Austin, TX 78701',
  brand_voice TEXT NOT NULL DEFAULT 'warm',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  country TEXT,
  language TEXT NOT NULL,
  language_overridden INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  preference_tags TEXT NOT NULL DEFAULT '[]',
  email_consent INTEGER NOT NULL,
  unsubscribed_at TEXT,
  order_count INTEGER NOT NULL DEFAULT 0,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  last_order_at TEXT,
  spend_tier TEXT NOT NULL DEFAULT 'low',
  top_category TEXT,
  UNIQUE(store_id, external_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_id TEXT,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at_shop TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  financial_status TEXT NOT NULL,
  UNIQUE(store_id, external_id)
);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  intent_zh TEXT NOT NULL,
  scenario TEXT NOT NULL,
  discount_code TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outreach_recipients (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  language TEXT NOT NULL,
  eligible INTEGER NOT NULL,
  exclusion_reason TEXT,
  mode TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  language TEXT NOT NULL,
  mode TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  zh_subject TEXT NOT NULL,
  zh_body TEXT NOT NULL,
  personalization_points TEXT NOT NULL,
  status TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  last_product TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  rendered_subject TEXT NOT NULL,
  rendered_body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

export function uuid() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function appToday() {
  return process.env.APP_NOW || '2026-11-01';
}
