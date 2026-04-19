'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const db       = require('../db/index');
const { parseSvgDimensions, estimatePdfSize, SYSTEM_FONTS } = require('../services/pdf');

const router   = express.Router();
const TMPL_DIR = path.join(__dirname, '../../data/templates');

fs.mkdirSync(TMPL_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: TMPL_DIR,
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, unique);
  },
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/svg+xml' || file.originalname.endsWith('.svg')) cb(null, true);
    else cb(new Error('Solo se aceptan archivos SVG'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// GET /templates
router.get('/', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  res.render('templates/index', { title: 'Plantillas', currentPath: '/templates', templates });
});

// GET /templates/new
router.get('/new', (req, res) => {
  res.render('templates/new', { title: 'Nueva plantilla', currentPath: '/templates', error: null });
});

// POST /templates — upload SVG
router.post('/', upload.single('svg'), (req, res) => {
  if (!req.file) {
    return res.render('templates/new', {
      title: 'Nueva plantilla', currentPath: '/templates',
      error: 'Debes subir un archivo SVG'
    });
  }
  const { name } = req.body;
  const info = db.prepare(`
    INSERT INTO templates (name, filename) VALUES (?, ?)
  `).run(name || req.file.originalname, req.file.filename);

  res.redirect(`/templates/${info.lastInsertRowid}/edit`);
});

// GET /templates/:id/edit — previsualizador interactivo
router.get('/:id/edit', (req, res) => {
  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!tmpl) return res.status(404).render('error', { title: 'Error', message: 'Plantilla no encontrada', status: 404 });

  // Load the longest name available across all campaigns (for preview)
  const longestRow = db.prepare(`
    SELECT name FROM attendees ORDER BY LENGTH(name) DESC LIMIT 1
  `).get();
  const previewName = longestRow ? longestRow.name : 'Nombre de Ejemplo Largo';

  // PDF size analysis
  const svgPath = path.join(TMPL_DIR, tmpl.filename);
  let pdfEstimate = null;
  let pdfDimensions = null;
  if (fs.existsSync(svgPath)) {
    const svgContent = fs.readFileSync(svgPath, 'utf8');
    pdfEstimate  = estimatePdfSize(svgContent);
    pdfDimensions = parseSvgDimensions(svgContent);
  }

  res.render('templates/edit', {
    title: `Editar: ${tmpl.name}`,
    currentPath: '/templates',
    tmpl,
    previewName,
    pdfEstimate,
    pdfDimensions,
    systemFonts: [...SYSTEM_FONTS],
  });
});

// GET /templates/:id/preview-pdf — generate PDF preview with the longest attendee name
router.get('/:id/preview-pdf', async (req, res, next) => {
  try {
    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
    if (!tmpl) return res.status(404).send('Plantilla no encontrada');

    const longestRow = db.prepare('SELECT name FROM attendees ORDER BY LENGTH(name) DESC LIMIT 1').get();
    const previewName = longestRow ? longestRow.name : 'Nombre de Asistente de Ejemplo';

    const { generateCertificate } = require('../services/pdf');
    const APP_URL   = process.env.APP_URL || 'https://certs.manuelalbor.com';
    const verifyUrl = tmpl.qr_enabled ? `${APP_URL}/verify/preview-sample` : null;
    const { buffer, sizeKb } = await generateCertificate(tmpl, previewName, verifyUrl);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="preview-certificado.pdf"');
    res.setHeader('X-PDF-Size-KB', String(sizeKb));
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// GET /templates/:id/svg — serve the raw SVG file
router.get('/:id/svg', (req, res) => {
  const tmpl = db.prepare('SELECT filename FROM templates WHERE id = ?').get(req.params.id);
  if (!tmpl) return res.sendStatus(404);
  const svgPath = path.join(TMPL_DIR, tmpl.filename);
  if (!fs.existsSync(svgPath)) return res.sendStatus(404);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.sendFile(svgPath);
});

// PUT /templates/:id — save positioning config
router.post('/:id/config', (req, res) => {
  const { text_x, text_y, text_align, font_family, font_size, font_color, font_weight, font_style,
          qr_enabled, qr_x, qr_y, qr_size, name_uppercase } = req.body;
  db.prepare(`
    UPDATE templates SET
      text_x = ?, text_y = ?, text_align = ?,
      font_family = ?, font_size = ?, font_color = ?,
      font_weight = ?, font_style = ?,
      qr_enabled = ?, qr_x = ?, qr_y = ?, qr_size = ?,
      name_uppercase = ?
    WHERE id = ?
  `).run(text_x, text_y, text_align, font_family, font_size, font_color, font_weight, font_style,
         qr_enabled ? 1 : 0, qr_x || 90, qr_y || 90, qr_size || 80,
         name_uppercase ? 1 : 0, req.params.id);

  if (req.accepts('json')) return res.json({ ok: true });
  res.redirect(`/templates/${req.params.id}/edit`);
});

// DELETE /templates/:id
router.post('/:id/delete', (req, res) => {
  const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (tmpl) {
    const svgPath = path.join(TMPL_DIR, tmpl.filename);
    if (fs.existsSync(svgPath)) fs.unlinkSync(svgPath);
    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  }
  res.redirect('/templates');
});

module.exports = router;
