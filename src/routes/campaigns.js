'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/index');
const router  = express.Router();

const LOGO_DIR = path.join(__dirname, '../../data/logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGO_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `campaign-${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se aceptan imágenes'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// GET /campaigns
router.get('/', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM attendees WHERE campaign_id = c.id) AS total,
           (SELECT COUNT(*) FROM attendees WHERE campaign_id = c.id AND status = 'sent') AS sent,
           (SELECT COUNT(*) FROM attendees WHERE campaign_id = c.id AND status = 'error') AS errors,
           s.name AS smtp_name,
           t.name AS template_name
    FROM campaigns c
    LEFT JOIN smtp_profiles s ON s.id = c.smtp_profile_id
    LEFT JOIN templates t ON t.id = c.template_id
    ORDER BY c.created_at DESC
  `).all();
  res.render('campaigns/index', { title: 'Campañas', currentPath: '/campaigns', campaigns });
});

// GET /campaigns/new
router.get('/new', (req, res) => {
  const smtpProfiles = db.prepare('SELECT id, name FROM smtp_profiles ORDER BY name').all();
  const templates    = db.prepare('SELECT id, name FROM templates ORDER BY name').all();
  res.render('campaigns/new', {
    title: 'Nueva campaña', currentPath: '/campaigns',
    smtpProfiles, templates, error: null,
  });
});

// POST /campaigns
router.post('/', (req, res) => {
  const { name, event_date, smtp_profile_id, template_id,
          email_subject, email_body, email_is_html, batch_size, batch_interval_min } = req.body;
  if (!name) {
    const smtpProfiles = db.prepare('SELECT id, name FROM smtp_profiles ORDER BY name').all();
    const templates    = db.prepare('SELECT id, name FROM templates ORDER BY name').all();
    return res.render('campaigns/new', {
      title: 'Nueva campaña', currentPath: '/campaigns',
      smtpProfiles, templates, error: 'El nombre es obligatorio',
    });
  }
  const info = db.prepare(`
    INSERT INTO campaigns (name, event_date, smtp_profile_id, template_id, email_subject, email_body, email_is_html, batch_size, batch_interval_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    event_date || null,
    smtp_profile_id || null,
    template_id || null,
    email_subject || 'Tu certificado de participación',
    email_body || 'Estimado/a {nombre},\n\nAdjunto tu certificado de participación.',
    email_is_html ? 1 : 0,
    parseInt(batch_size) || 30,
    parseInt(batch_interval_min) || 10,
  );
  res.redirect(`/campaigns/${info.lastInsertRowid}`);
});

// GET /campaigns/:id/email — email composer
router.get('/:id/email', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).render('error', { title: 'Error', message: 'Campaña no encontrada', status: 404 });
  const sampleName = db.prepare(`
    SELECT name FROM attendees WHERE campaign_id = ? ORDER BY LENGTH(name) DESC LIMIT 1
  `).get(req.params.id)?.name || 'Nombre de Asistente';
  res.render('campaigns/email', {
    title: `Email — ${campaign.name}`, currentPath: '/campaigns',
    campaign, sampleName, saved: req.query.saved === '1',
  });
});

// POST /campaigns/:id/email — save email config
router.post('/:id/email', (req, res) => {
  const { email_subject, email_body, email_is_html } = req.body;
  db.prepare(`
    UPDATE campaigns SET email_subject=?, email_body=?, email_is_html=? WHERE id=?
  `).run(email_subject, email_body, email_is_html ? 1 : 0, req.params.id);
  res.redirect(`/campaigns/${req.params.id}/email?saved=1`);
});

// GET /campaigns/:id/email/preview — iframe preview of rendered email
router.get('/:id/email/preview', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.sendStatus(404);
  const sampleName = db.prepare(`
    SELECT name FROM attendees WHERE campaign_id = ? ORDER BY LENGTH(name) DESC LIMIT 1
  `).get(req.params.id)?.name || 'Nombre de Asistente de Ejemplo';

  const body = campaign.email_body.replace(/{nombre}/gi, sampleName);

  if (campaign.email_is_html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:Arial,sans-serif;padding:24px;max-width:600px;margin:auto;color:#222}</style>
      </head><body>${body}</body></html>`);
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <style>body{font-family:monospace;padding:24px;white-space:pre-wrap;color:#222;background:#f9f9f9}</style>
      </head><body>${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`);
  }
});

// GET /campaigns/:id/log — full send log
router.get('/:id/log', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).render('error', { title: 'Error', message: 'Campaña no encontrada', status: 404 });

  const { status: filterStatus = 'all', page = 1 } = req.query;
  const PAGE_SIZE = 100;
  const offset    = (parseInt(page) - 1) * PAGE_SIZE;

  const whereStatus = filterStatus !== 'all' ? `AND status = '${filterStatus}'` : '';

  const attendees = db.prepare(`
    SELECT * FROM attendees
    WHERE campaign_id = ? ${whereStatus}
    ORDER BY id ASC
    LIMIT ? OFFSET ?
  `).all(req.params.id, PAGE_SIZE, offset);

  const totalCount = db.prepare(`
    SELECT COUNT(*) AS n FROM attendees WHERE campaign_id = ? ${whereStatus}
  `).get(req.params.id).n;

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='sent'    THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END), 0) AS errors,
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END), 0) AS skipped
    FROM attendees WHERE campaign_id = ?
  `).get(req.params.id);

  res.render('campaigns/log', {
    title: `Log — ${campaign.name}`, currentPath: '/campaigns',
    campaign, attendees, stats,
    filterStatus, page: parseInt(page), pageSize: PAGE_SIZE,
    totalCount, totalPages: Math.ceil(totalCount / PAGE_SIZE),
  });
});

// GET /campaigns/:id
router.get('/:id', (req, res) => {
  const campaign = db.prepare(`
    SELECT c.*,
           s.name AS smtp_name, s.from_email,
           t.name AS template_name, t.id AS tmpl_id
    FROM campaigns c
    LEFT JOIN smtp_profiles s ON s.id = c.smtp_profile_id
    LEFT JOIN templates t ON t.id = c.template_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!campaign) return res.status(404).render('error', { title: 'Error', message: 'Campaña no encontrada', status: 404 });

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='sent'    THEN 1 ELSE 0 END), 0) AS sent,
      COALESCE(SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END), 0) AS errors,
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0) AS pending
    FROM attendees WHERE campaign_id = ?
  `).get(req.params.id);

  const longestName = db.prepare(`
    SELECT name FROM attendees WHERE campaign_id = ? ORDER BY LENGTH(name) DESC LIMIT 1
  `).get(req.params.id);

  const recentAttendees = db.prepare(`
    SELECT * FROM attendees WHERE campaign_id = ? ORDER BY id DESC LIMIT 50
  `).all(req.params.id);

  const smtpProfiles = db.prepare('SELECT id, name FROM smtp_profiles ORDER BY name').all();
  const templates    = db.prepare('SELECT id, name FROM templates ORDER BY name').all();

  res.render('campaigns/show', {
    title: campaign.name, currentPath: '/campaigns',
    campaign, stats, longestName: longestName?.name || null,
    recentAttendees, smtpProfiles, templates,
    tunnelId: process.env.CLOUDFLARE_TUNNEL_ID || '',
  });
});

// POST /campaigns/:id/domain — configure or remove verify subdomain
router.post('/:id/domain', express.json(), async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });

  const BASE   = process.env.VERIFY_BASE_DOMAIN || 'manuelalbor.com';
  const SUFFIX = '-certs'; // produces e.g. svcardiologia-certs.manuelalbor.com
  const { addSubdomain, removeSubdomain } = require('../services/cloudflare');

  // ── Remove ──────────────────────────────────────────────────────────────────
  if (req.body.action === 'remove') {
    if (campaign.verify_domain) {
      try { await removeSubdomain(campaign.verify_domain); } catch (_) { /* best-effort */ }
    }
    db.prepare('UPDATE campaigns SET verify_domain=NULL, verify_domain_status=NULL WHERE id=?')
      .run(req.params.id);
    return res.json({ ok: true });
  }

  // ── Add ─────────────────────────────────────────────────────────────────────
  const slug = (req.body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug || slug.length < 2 || slug.length > 40) {
    return res.json({ ok: false, error: 'El slug debe tener entre 2 y 40 caracteres (letras, números y guiones)' });
  }

  const domain = `${slug}${SUFFIX}.${BASE}`;

  // Check if slug is already used by another campaign
  const conflict = db.prepare('SELECT id FROM campaigns WHERE verify_domain = ? AND id != ?').get(domain, req.params.id);
  if (conflict) return res.json({ ok: false, error: 'Este subdominio ya está en uso por otra campaña' });

  // Save as pending while DNS record is created
  db.prepare("UPDATE campaigns SET verify_domain=?, verify_domain_status='pending' WHERE id=?")
    .run(domain, req.params.id);

  try {
    await addSubdomain(domain);
    db.prepare("UPDATE campaigns SET verify_domain_status='configured' WHERE id=?").run(req.params.id);
    res.json({ ok: true, domain });
  } catch (err) {
    db.prepare("UPDATE campaigns SET verify_domain_status='error' WHERE id=?").run(req.params.id);
    res.json({ ok: false, error: err.message });
  }
});

// GET /campaigns/:id/logo — serve institution logo
router.get('/:id/logo', (req, res) => {
  const campaign = db.prepare('SELECT institution_logo FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign?.institution_logo) return res.sendStatus(404);
  const logoPath = path.join(LOGO_DIR, campaign.institution_logo);
  if (!fs.existsSync(logoPath)) return res.sendStatus(404);
  res.sendFile(logoPath);
});

// POST /campaigns/:id — update campaign settings (multipart for logo upload)
router.post('/:id', logoUpload.single('institution_logo'), (req, res) => {
  const { name, event_date, smtp_profile_id, template_id,
          email_subject, email_body, email_is_html, batch_size, batch_interval_min,
          qr_enabled, institution_name, remove_logo } = req.body;

  const current = db.prepare('SELECT institution_logo FROM campaigns WHERE id = ?').get(req.params.id);

  // Determine logo filename: new upload > keep existing > remove
  let logoFilename = current?.institution_logo || null;
  if (req.file) {
    // Delete old logo if it exists
    if (current?.institution_logo) {
      const old = path.join(LOGO_DIR, current.institution_logo);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    logoFilename = req.file.filename;
  } else if (remove_logo === '1') {
    if (current?.institution_logo) {
      const old = path.join(LOGO_DIR, current.institution_logo);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    logoFilename = null;
  }

  db.prepare(`
    UPDATE campaigns SET name=?, event_date=?, smtp_profile_id=?, template_id=?,
    email_subject=?, email_body=?, email_is_html=?, batch_size=?, batch_interval_min=?,
    qr_enabled=?, institution_name=?, institution_logo=?
    WHERE id=?
  `).run(
    name, event_date || null,
    smtp_profile_id || null, template_id || null,
    email_subject, email_body, email_is_html ? 1 : 0,
    parseInt(batch_size) || 30, parseInt(batch_interval_min) || 10,
    qr_enabled ? 1 : 0,
    institution_name?.trim() || null,
    logoFilename,
    req.params.id,
  );
  res.redirect(`/campaigns/${req.params.id}`);
});

// POST /campaigns/:id/rename — update campaign name (AJAX)
router.post('/:id/rename', express.json(), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.json({ ok: false, error: 'El nombre no puede estar vacío' });
  const campaign = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ ok: false, error: 'Campaña no encontrada' });
  db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json({ ok: true, name: name.trim() });
});

// POST /campaigns/:id/delete
router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.redirect('/campaigns');
});

module.exports = router;
