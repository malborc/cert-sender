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
  `ALTER TABLE campaigns ADD COLUMN email_is_html INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE attendees ADD COLUMN resent_at TEXT`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (_) { /* column already exists */ }
}

module.exports = db;
