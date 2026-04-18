'use strict';

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS smtp_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  host          TEXT    NOT NULL,
  port          INTEGER NOT NULL DEFAULT 587,
  secure        INTEGER NOT NULL DEFAULT 0,  -- 0=STARTTLS, 1=SSL
  user          TEXT    NOT NULL,
  password_enc  TEXT    NOT NULL,
  from_email    TEXT    NOT NULL,
  from_name     TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  filename      TEXT    NOT NULL,
  text_x        REAL    NOT NULL DEFAULT 50,   -- % horizontal
  text_y        REAL    NOT NULL DEFAULT 50,   -- % vertical
  text_align    TEXT    NOT NULL DEFAULT 'center', -- left|center|right
  font_family   TEXT    NOT NULL DEFAULT 'Arial',
  font_size     INTEGER NOT NULL DEFAULT 48,
  font_color    TEXT    NOT NULL DEFAULT '#1a1a1a',
  font_weight   TEXT    NOT NULL DEFAULT 'bold',  -- normal|bold
  font_style    TEXT    NOT NULL DEFAULT 'normal', -- normal|italic
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  event_date          TEXT,
  smtp_profile_id     INTEGER REFERENCES smtp_profiles(id) ON DELETE SET NULL,
  template_id         INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  email_subject       TEXT    NOT NULL DEFAULT 'Tu certificado de participación',
  email_body          TEXT    NOT NULL DEFAULT 'Estimado/a {nombre},\n\nAdjunto encontrarás tu certificado de participación.\n\nGracias por tu asistencia.',
  batch_size          INTEGER NOT NULL DEFAULT 30,
  batch_interval_min  INTEGER NOT NULL DEFAULT 10,
  status              TEXT    NOT NULL DEFAULT 'draft', -- draft|sending|paused|done|error
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending', -- pending|sent|error|skipped
  sent_at     TEXT,
  error_msg   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attendees_campaign ON attendees(campaign_id);
CREATE INDEX IF NOT EXISTS idx_attendees_status   ON attendees(campaign_id, status);
`;

module.exports = SCHEMA;
