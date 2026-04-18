'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const db       = require('../db/index');

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

  res.render('templates/edit', {
    title: `Editar: ${tmpl.name}`,
    currentPath: '/templates',
    tmpl,
    previewName,
  });
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
  const { text_x, text_y, text_align, font_family, font_size, font_color, font_weight, font_style } = req.body;
  db.prepare(`
    UPDATE templates SET
      text_x = ?, text_y = ?, text_align = ?,
      font_family = ?, font_size = ?, font_color = ?,
      font_weight = ?, font_style = ?
    WHERE id = ?
  `).run(text_x, text_y, text_align, font_family, font_size, font_color, font_weight, font_style, req.params.id);

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
