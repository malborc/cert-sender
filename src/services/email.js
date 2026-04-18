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
  return nodemailer.createTransport({
    host:   profile.host,
    port:   profile.port,
    secure: profile.secure === 1,
    auth:   { user: profile.user, pass: password },
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
 * @param {Object} campaign     - Campaign record
 * @param {Object} attendee     - Attendee record
 * @param {Buffer} pdfBuffer    - PDF binary
 */
async function sendCertificate(profile, campaign, attendee, pdfBuffer) {
  const transporter = createTransporter(profile);

  const body = campaign.email_body.replace(/{nombre}/gi, attendee.name);
  const filename = `certificado-${attendee.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

  await transporter.sendMail({
    from:    `"${profile.from_name}" <${profile.from_email}>`,
    to:      attendee.email,
    subject: campaign.email_subject,
    text:    body,
    html:    body.replace(/\n/g, '<br>'),
    attachments: [{
      filename,
      content:     pdfBuffer,
      contentType: 'application/pdf',
    }],
  });
}

module.exports = { encrypt, decrypt, testSmtp, sendCertificate };
