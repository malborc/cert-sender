'use strict';

const nodemailer = require('nodemailer');
const crypto     = require('crypto');

const ALGO = 'aes-256-cbc';
const KEY  = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');

// ── Encryption helpers ─────────────────────────────────
function encrypt(text) {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text), cipher.final()]).toString('hex');
}

function decrypt(enc) {
  const [ivHex, dataHex] = enc.split(':');
  const iv     = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString();
}

// ── Transporter factory ────────────────────────────────
function createTransporter(profile) {
  const password = decrypt(profile.password_enc);
  const secure   = profile.secure === 1;
  return nodemailer.createTransport({
    host:   profile.host,
    port:   profile.port,
    secure,
    auth:   { user: profile.user, pass: password },
    tls:    { rejectUnauthorized: false },
  });
}

/**
 * Verify SMTP connection.
 */
async function testSmtp(profile) {
  const transporter = createTransporter(profile);
  await transporter.verify();
}

/**
 * Send a certificate email to one attendee.
 * @param {Object} profile      - SMTP profile record
 * @param {Object} campaign     - Campaign record (email_body, email_is_html, email_subject)
 * @param {Object} attendee     - Attendee record
 * @param {Buffer} pdfBuffer    - PDF binary (attached as PDF)
 */
async function sendCertificate(profile, campaign, attendee, pdfBuffer) {
  const transporter = createTransporter(profile);

  const bodyRaw  = campaign.email_body.replace(/{nombre}/gi, attendee.name);
  const isHtml   = campaign.email_is_html === 1;
  const filename = `certificado-${attendee.name.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s]/g, '_').trim().replace(/\s+/g, '_')}.pdf`;

  const mailOptions = {
    from:    profile.from_name ? `"${profile.from_name}" <${profile.from_email}>` : profile.from_email,
    to:      attendee.email,
    subject: campaign.email_subject,
    attachments: [{
      filename,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }],
  };

  if (isHtml) {
    // HTML body: send both html and a plain-text fallback (strip tags)
    mailOptions.html = bodyRaw;
    mailOptions.text = bodyRaw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  } else {
    // Plain text: send as-is, also auto-generate html version
    mailOptions.text = bodyRaw;
    mailOptions.html = bodyRaw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  await transporter.sendMail(mailOptions);
}

module.exports = { encrypt, decrypt, testSmtp, sendCertificate };
