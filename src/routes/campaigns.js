'use strict';

const express = require('express');
const db      = require('../db/index');
const router  = express.Router();

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
          email_subject, email_body, batch_size, batch_interval_min } = req.body;
  if (!name) {
    const smtpProfiles = db.prepare('SELECT id, name FROM smtp_profiles ORDER BY name').all();
    const templates    = db.prepare('SELECT id, name FROM templates ORDER BY name').all();
    return res.render('campaigns/new', {
      title: 'Nueva campaña', currentPath: '/campaigns',
      smtpProfiles, templates, error: 'El nombre es obligatorio',
    });
  }
  const info = db.prepare(`
    INSERT INTO campaigns (name, event_date, smtp_profile_id, template_id, email_subject, email_body, batch_size, batch_interval_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    event_date || null,
    smtp_profile_id || null,
    template_id || null,
    email_subject || 'Tu certificado de participación',
    email_body || 'Estimado/a {nombre},\n\nAdjunto tu certificado de participación.',
    parseInt(batch_size) || 30,
    parseInt(batch_interval_min) || 10,
  );
  res.redirect(`/campaigns/${info.lastInsertRowid}`);
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
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
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
  });
});

// POST /campaigns/:id — update campaign settings
router.post('/:id', (req, res) => {
  const { name, event_date, smtp_profile_id, template_id,
          email_subject, email_body, batch_size, batch_interval_min } = req.body;
  db.prepare(`
    UPDATE campaigns SET name=?, event_date=?, smtp_profile_id=?, template_id=?,
    email_subject=?, email_body=?, batch_size=?, batch_interval_min=?
    WHERE id=?
  `).run(
    name, event_date || null,
    smtp_profile_id || null, template_id || null,
    email_subject, email_body,
    parseInt(batch_size) || 30, parseInt(batch_interval_min) || 10,
    req.params.id,
  );
  res.redirect(`/campaigns/${req.params.id}`);
});

// POST /campaigns/:id/delete
router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.redirect('/campaigns');
});

module.exports = router;
