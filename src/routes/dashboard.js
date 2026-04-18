'use strict';

const express = require('express');
const db      = require('../db/index');
const router  = express.Router();

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
    LIMIT 10
  `).all();

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM campaigns) AS total_campaigns,
      (SELECT COUNT(*) FROM attendees WHERE status = 'sent') AS total_sent,
      (SELECT COUNT(*) FROM attendees WHERE status = 'error') AS total_errors,
      (SELECT COUNT(*) FROM smtp_profiles) AS total_smtp
  `).get();

  res.render('dashboard', { title: 'Dashboard', campaigns, stats });
});

module.exports = router;
