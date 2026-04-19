'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db/index');
const router  = express.Router();

const LOGO_DIR = path.join(__dirname, '../../data/logos');

// GET /verify/:token — public certificate verification page (no auth required)
router.get('/:token', (req, res) => {
  const row = db.prepare(`
    SELECT a.name, a.email, a.status, a.sent_at,
           c.id AS campaign_id, c.name AS campaign_name, c.event_date,
           c.institution_name, c.institution_logo
    FROM attendees a
    JOIN campaigns c ON c.id = a.campaign_id
    WHERE a.verify_token = ?
  `).get(req.params.token);

  if (!row) {
    return res.status(404).render('verify', {
      valid: false, attendee: null, institution: null,
      title: 'Certificado no encontrado',
    });
  }

  // Embed logo as base64 so the public page doesn't need an authenticated request
  let logoDataUrl = null;
  if (row.institution_logo) {
    const logoPath = path.join(LOGO_DIR, row.institution_logo);
    if (fs.existsSync(logoPath)) {
      const ext  = path.extname(row.institution_logo).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const b64  = fs.readFileSync(logoPath).toString('base64');
      logoDataUrl = `data:${mime};base64,${b64}`;
    }
  }

  const institution = row.institution_name
    ? { name: row.institution_name, logoDataUrl }
    : null;

  res.render('verify', {
    valid: row.status === 'sent',
    attendee: row,
    institution,
    title: institution ? `Certificado — ${institution.name}` : 'Verificación de Certificado',
  });
});

module.exports = router;
