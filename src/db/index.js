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

module.exports = db;
