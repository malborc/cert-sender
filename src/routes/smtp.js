'use strict';

const express  = require('express');
const db       = require('../db/index');
const { encrypt, testSmtp } = require('../services/email');
const router   = express.Router();

// GET /smtp
router.get('/', (req, res) => {
  const profiles = db.prepare('SELECT id, name, host, port, secure, user, from_email, from_name, created_at FROM smtp_profiles ORDER BY name').all();
  res.render('smtp/index', { title: 'Perfiles SMTP', currentPath: '/smtp', profiles });
});

// GET /smtp/new
router.get('/new', (req, res) => {
  res.render('smtp/form', { title: 'Nuevo perfil SMTP', currentPath: '/smtp', profile: null, error: null });
});

// GET /smtp/:id/edit
router.get('/:id/edit', (req, res) => {
  const profile = db.prepare('SELECT id, name, host, port, secure, user, from_email, from_name FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).render('error', { title: 'Error', message: 'Perfil no encontrado', status: 404 });
  res.render('smtp/form', { title: 'Editar SMTP', currentPath: '/smtp', profile, error: null });
});

// POST /smtp — create
router.post('/', (req, res) => {
  const { name, host, port, secure, user, password, from_email, from_name } = req.body;
  if (!name || !host || !user || !password || !from_email) {
    return res.render('smtp/form', {
      title: 'Nuevo perfil SMTP', currentPath: '/smtp', profile: req.body,
      error: 'Todos los campos son obligatorios (excepto nombre remitente)',
    });
  }
  const password_enc = encrypt(password);
  db.prepare(`
    INSERT INTO smtp_profiles (name, host, port, secure, user, password_enc, from_email, from_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, host, parseInt(port) || 587, secure ? 1 : 0, user, password_enc, from_email, from_name || '');
  res.redirect('/smtp');
});

// POST /smtp/:id — update
router.post('/:id', (req, res) => {
  const { name, host, port, secure, user, password, from_email, from_name } = req.body;
  const existing = db.prepare('SELECT password_enc FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).render('error', { title: 'Error', message: 'Perfil no encontrado', status: 404 });

  const password_enc = password ? encrypt(password) : existing.password_enc;
  db.prepare(`
    UPDATE smtp_profiles SET name=?, host=?, port=?, secure=?, user=?, password_enc=?, from_email=?, from_name=?
    WHERE id=?
  `).run(name, host, parseInt(port) || 587, secure ? 1 : 0, user, password_enc, from_email, from_name || '', req.params.id);
  res.redirect('/smtp');
});

// POST /smtp/:id/delete
router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM smtp_profiles WHERE id = ?').run(req.params.id);
  res.redirect('/smtp');
});

// POST /smtp/:id/test — test SMTP connection
router.post('/:id/test', async (req, res) => {
  const profile = db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ ok: false, error: 'Perfil no encontrado' });
  try {
    await testSmtp(profile);
    res.json({ ok: true, message: 'Conexión SMTP verificada correctamente' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
