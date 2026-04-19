'use strict';

const express = require('express');
const db      = require('../db/index');
const { generateCertificate } = require('../services/pdf');
const { addCampaignJobs, pauseCampaign, resumeCampaign } = require('../services/queue');

const router  = express.Router();

// GET /send/:campaignId/preview-pdf — generate PDF for the longest name and return it
router.get('/:campaignId/preview-pdf', async (req, res, next) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
    if (!campaign || !campaign.template_id) {
      return res.status(400).send('La campaña no tiene plantilla asignada');
    }

    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
    if (!tmpl) return res.status(404).send('Plantilla no encontrada');

    // Use longest name from attendees, or a sample name
    const longestRow = db.prepare(`
      SELECT name FROM attendees WHERE campaign_id = ? ORDER BY LENGTH(name) DESC LIMIT 1
    `).get(req.params.campaignId);
    const previewName = longestRow ? longestRow.name : 'Nombre de Asistente de Ejemplo';

    const { buffer: pdfBuffer, sizeKb, dimensions } = await generateCertificate(tmpl, previewName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-PDF-Size-KB', String(sizeKb));
    res.setHeader('X-PDF-Dimensions', `${dimensions.widthIn}x${dimensions.heightIn}in`);
    res.setHeader('Content-Disposition', `inline; filename="preview-certificado.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /send/:campaignId/time-estimate — calculate queue time estimate
router.get('/:campaignId/time-estimate', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const pending     = db.prepare(`SELECT COUNT(*) AS n FROM attendees WHERE campaign_id = ? AND status = 'pending'`).get(req.params.campaignId).n;
  const batchSize   = campaign.batch_size || 30;
  const intervalMin = campaign.batch_interval_min || 10;
  const batches     = Math.ceil(pending / batchSize) || 0;
  const thisMinutes = batches * intervalMin;

  // Other campaigns currently sending
  const otherRunning = db.prepare(`
    SELECT c.batch_size, c.batch_interval_min, COUNT(a.id) AS pending_count
    FROM campaigns c
    JOIN attendees a ON a.campaign_id = c.id AND a.status = 'pending'
    WHERE c.status = 'sending' AND c.id != ?
    GROUP BY c.id
  `).all(req.params.campaignId);

  const otherMinutes = otherRunning.reduce((sum, c) => {
    return sum + Math.ceil(c.pending_count / (c.batch_size || 30)) * (c.batch_interval_min || 10);
  }, 0);

  const totalMinutes = thisMinutes + otherMinutes;

  const fmt = m => {
    if (m === 0) return '0 min';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), min = m % 60;
    return min > 0 ? `${h}h ${min}min` : `${h}h`;
  };

  res.json({
    pending, batchSize, intervalMin, batches,
    thisMinutes, otherCampaigns: otherRunning.length, otherMinutes, totalMinutes,
    thisEstimate:  fmt(thisMinutes),
    totalEstimate: fmt(totalMinutes),
  });
});

// POST /send/:campaignId/test — send a test certificate to a given email (no DB writes)
router.post('/:campaignId/test', express.json(), async (req, res) => {
  try {
    const { email, name: testName } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ ok: false, error: 'Email inválido' });
    }

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
    if (!campaign)                  return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
    if (!campaign.smtp_profile_id)  return res.status(400).json({ ok: false, error: 'Sin perfil SMTP configurado' });
    if (!campaign.template_id)      return res.status(400).json({ ok: false, error: 'Sin plantilla asignada' });

    const [tmpl, smtpProfile] = [
      db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id),
      db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(campaign.smtp_profile_id),
    ];
    if (!tmpl)        return res.status(404).json({ ok: false, error: 'Plantilla no encontrada' });
    if (!smtpProfile) return res.status(404).json({ ok: false, error: 'Perfil SMTP no encontrado' });

    // Name: use provided, else longest attendee, else default sample
    let name = testName?.trim();
    if (!name) {
      const row = db.prepare(
        'SELECT name FROM attendees WHERE campaign_id = ? ORDER BY LENGTH(name) DESC LIMIT 1'
      ).get(req.params.campaignId);
      name = row?.name || 'Asistente de Prueba';
    }

    const { sendCertificate } = require('../services/email');
    const { buffer: pdfBuffer, sizeKb } = await generateCertificate(tmpl, name);
    await sendCertificate(smtpProfile, campaign, { name, email: email.trim() }, pdfBuffer);

    res.json({ ok: true, sizeKb, name });
  } catch (err) {
    console.error('[send/test]', err.message);
    res.json({ ok: false, error: err.message });
  }
});

// POST /send/:campaignId/start — enqueue all pending attendees
router.post('/:campaignId/start', async (req, res, next) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });
    if (!campaign.smtp_profile_id) return res.status(400).json({ error: 'Falta perfil SMTP' });
    if (!campaign.template_id)    return res.status(400).json({ error: 'Falta plantilla SVG' });

    const pending = db.prepare(`
      SELECT COUNT(*) AS n FROM attendees WHERE campaign_id = ? AND status = 'pending'
    `).get(req.params.campaignId);

    if (pending.n === 0) {
      return res.status(400).json({ error: 'No hay asistentes pendientes' });
    }

    await addCampaignJobs(campaign);

    db.prepare("UPDATE campaigns SET status = 'sending' WHERE id = ?").run(campaign.id);

    res.redirect(`/campaigns/${campaign.id}`);
  } catch (err) {
    next(err);
  }
});

// POST /send/:campaignId/pause
router.post('/:campaignId/pause', async (req, res, next) => {
  try {
    await pauseCampaign(req.params.campaignId);
    db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(req.params.campaignId);
    res.redirect(`/campaigns/${req.params.campaignId}`);
  } catch (err) {
    next(err);
  }
});

// GET /send/:campaignId/status — JSON status for polling
router.get('/:campaignId/status', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='sent'    THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
    FROM attendees WHERE campaign_id = ?
  `).get(req.params.campaignId);

  const campaign = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(req.params.campaignId);

  res.json({ ...stats, campaignStatus: campaign?.status });
});

// GET /send/:campaignId/progress — SSE stream for real-time progress
router.get('/:campaignId/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const campaignId = req.params.campaignId;

  const send = () => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='sent'    THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
      FROM attendees WHERE campaign_id = ?
    `).get(campaignId);
    const campaign = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId);
    res.write(`data: ${JSON.stringify({ ...stats, campaignStatus: campaign?.status })}\n\n`);
  };

  send();
  const interval = setInterval(send, 5000);
  req.on('close', () => clearInterval(interval));
});

module.exports = router;
