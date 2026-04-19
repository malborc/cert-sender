'use strict';

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');
const SCHEMA   = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/db/cert-sender.db');

// Ensure directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Apply schema (idempotent — CREATE IF NOT EXISTS)
db.exec(SCHEMA);

// Inline migrations for existing databases (ALTER TABLE IF NOT EXISTS equivalent)
const migrations = [
  `ALTER TABLE campaigns  ADD COLUMN email_is_html INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE campaigns  ADD COLUMN qr_enabled INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE campaigns  ADD COLUMN institution_name TEXT`,
  `ALTER TABLE campaigns  ADD COLUMN institution_logo TEXT`,
  `ALTER TABLE campaigns  ADD COLUMN verify_domain TEXT`,
  `ALTER TABLE campaigns  ADD COLUMN verify_domain_status TEXT`,
  `ALTER TABLE attendees  ADD COLUMN resent_at TEXT`,
  `ALTER TABLE attendees  ADD COLUMN verify_token TEXT`,
  `ALTER TABLE templates  ADD COLUMN qr_enabled INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE templates  ADD COLUMN qr_x REAL NOT NULL DEFAULT 90`,
  `ALTER TABLE templates  ADD COLUMN qr_y REAL NOT NULL DEFAULT 90`,
  `ALTER TABLE templates  ADD COLUMN qr_size INTEGER NOT NULL DEFAULT 80`,
  `ALTER TABLE templates  ADD COLUMN name_uppercase INTEGER NOT NULL DEFAULT 0`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// Generate verify_token for attendees that don't have one yet
const { randomUUID } = require('crypto');
const noToken = db.prepare(`SELECT id FROM attendees WHERE verify_token IS NULL`).all();
const setToken = db.prepare(`UPDATE attendees SET verify_token = ? WHERE id = ?`);
const fillTokens = db.transaction(() => noToken.forEach(a => setToken.run(randomUUID(), a.id)));
if (noToken.length > 0) fillTokens();

module.exports = db;
