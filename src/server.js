'use strict';

const path    = require('path');
const express = require('express');
const fs      = require('fs');

// Init DB (runs schema migrations)
require('./db/index');

const app = express();

// ── View engine ──────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('view cache'); // templates se releen del disco en cada request

// ── Middleware ────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Ensure data dirs exist
['data/db','data/templates','data/uploads','data/logos'].forEach(d => {
  fs.mkdirSync(path.join(__dirname, '..', d), { recursive: true });
});

// ── Routes ────────────────────────────────────────────
app.use('/verify',       require('./routes/verify'));   // público — sin Authentik
app.use('/',             require('./routes/dashboard'));
app.use('/campaigns',    require('./routes/campaigns'));
app.use('/templates',    require('./routes/templates'));
app.use('/attendees',    require('./routes/attendees'));
app.use('/smtp',         require('./routes/smtp'));
app.use('/send',         require('./routes/send'));

// ── Error handler ─────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  if (req.accepts('json')) {
    return res.status(status).json({ error: err.message });
  }
  res.status(status).render('error', { title: 'Error', message: err.message, status });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`cert-sender web escuchando en :${PORT}`));
