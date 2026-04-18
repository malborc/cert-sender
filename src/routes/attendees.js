'use strict';

const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const csv        = require('csv-parser');
const db         = require('../db/index');

const router     = express.Router();
const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Solo se aceptan archivos CSV'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// POST /attendees/upload/:campaignId — CSV upload
router.post('/upload/:campaignId', upload.single('csv'), async (req, res) => {
  const { campaignId } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió el archivo CSV' });
  }

  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Campaña no encontrada' });
  }

  let imported = 0, skipped = 0, errors = [];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO attendees (campaign_id, email, name) VALUES (?, ?, ?)
  `);

  // Make unique constraint on (campaign_id, email) work gracefully
  try {
    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendee_unique ON attendees(campaign_id, email)
    `).run();
  } catch (_) {}

  await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(req.file.path)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
      .on('data', row => rows.push(row))
      .on('error', reject)
      .on('end', () => {
        const insertMany = db.transaction(() => {
          for (const row of rows) {
            const email = (row.email || '').trim();
            const name  = (row.asistente || row.name || row.nombre || '').trim();
            if (!email || !name) { skipped++; continue; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              errors.push(`Email inválido: ${email}`);
              skipped++;
              continue;
            }
            const info = insertStmt.run(campaignId, email, name);
            if (info.changes > 0) imported++; else skipped++;
          }
        });
        insertMany();
        resolve();
      });
  });

  // Clean up temp file
  fs.unlink(req.file.path, () => {});

  if (req.accepts('json')) {
    return res.json({ imported, skipped, errors: errors.slice(0, 20) });
  }
  res.redirect(`/campaigns/${campaignId}`);
});

// DELETE /attendees/campaign/:campaignId — clear all attendees
router.post('/clear/:campaignId', (req, res) => {
  db.prepare("DELETE FROM attendees WHERE campaign_id = ? AND status = 'pending'").run(req.params.campaignId);
  res.redirect(`/campaigns/${req.params.campaignId}`);
});

// GET /attendees/export/:campaignId — CSV export of results
router.get('/export/:campaignId', (req, res) => {
  const campaign = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(req.params.campaignId);
  if (!campaign) return res.sendStatus(404);

  const attendees = db.prepare(
    'SELECT email, name, status, sent_at, error_msg FROM attendees WHERE campaign_id = ? ORDER BY id'
  ).all(req.params.campaignId);

  const lines = ['email,asistente,estado,enviado_en,error'];
  for (const a of attendees) {
    lines.push([a.email, `"${a.name}"`, a.status, a.sent_at || '', `"${a.error_msg || ''}"`].join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="resultado-${req.params.campaignId}.csv"`);
  res.send(lines.join('\n'));
});

// POST /attendees/:id/update-email — edit attendee email (AJAX)
router.post('/:id/update-email', (req, res) => {
  const { email } = req.body;
  const attendee  = db.prepare('SELECT * FROM attendees WHERE id = ?').get(req.params.id);
  if (!attendee) return res.status(404).json({ ok: false, error: 'Asistente no encontrado' });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.json({ ok: false, error: 'Email inválido' });
  }

  db.prepare('UPDATE attendees SET email = ? WHERE id = ?').run(email.trim(), req.params.id);
  res.json({ ok: true, email: email.trim() });
});

// POST /attendees/:id/resend — reset status and enqueue immediate job
router.post('/:id/resend', async (req, res) => {
  const attendee = db.prepare('SELECT * FROM attendees WHERE id = ?').get(req.params.id);
  if (!attendee) return res.status(404).json({ ok: false, error: 'Asistente no encontrado' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(attendee.campaign_id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });

  // Reset attendee status to pending
  db.prepare(`
    UPDATE attendees SET status='pending', sent_at=NULL, error_msg=NULL, resent_at=datetime('now') WHERE id=?
  `).run(attendee.id);

  // Mark campaign as sending if it was done/error
  if (['done', 'error', 'paused', 'draft'].includes(campaign.status)) {
    db.prepare("UPDATE campaigns SET status='sending' WHERE id=?").run(campaign.id);
  }

  // Enqueue with no delay (immediate)
  const { getQueue } = require('../services/queue');
  const queue = getQueue();
  await queue.add(
    `cert-${campaign.id}-${attendee.id}-resend`,
    { campaignId: campaign.id, attendeeId: attendee.id },
    {
      jobId:   `cert-${campaign.id}-${attendee.id}-${Date.now()}`,
      delay:   0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: { age: 86400 },
      removeOnFail:     { age: 86400 * 7 },
    }
  );

  const redirectTo = req.get('Referer') || `/campaigns/${campaign.id}/log`;
  if (req.accepts('json')) return res.json({ ok: true });
  res.redirect(redirectTo);
});

module.exports = router;
