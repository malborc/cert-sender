'use strict';

const { Worker } = require('bullmq');
const IORedis    = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Init DB
const db = require('./db/index');
const { generateCertificate } = require('./services/pdf');
const { sendCertificate }     = require('./services/email');

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker('cert-email', async (job) => {
  const { campaignId, attendeeId } = job.data;

  // Fetch latest data
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  const attendee = db.prepare('SELECT * FROM attendees WHERE id = ?').get(attendeeId);

  if (!campaign || !attendee) {
    throw new Error(`Campaign ${campaignId} or attendee ${attendeeId} not found`);
  }

  // Respect pause: if campaign is paused, skip (will not be retried automatically)
  if (campaign.status === 'paused') {
    console.log(`[worker] Campaign ${campaignId} is paused — skipping attendee ${attendeeId}`);
    db.prepare("UPDATE attendees SET status='skipped' WHERE id=?").run(attendeeId);
    return { skipped: true };
  }

  // Already sent?
  if (attendee.status === 'sent') {
    return { alreadySent: true };
  }

  // Get template and SMTP profile
  const tmpl    = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
  const profile = db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(campaign.smtp_profile_id);

  if (!tmpl) throw new Error(`Template ${campaign.template_id} not found`);
  if (!profile) throw new Error(`SMTP profile ${campaign.smtp_profile_id} not found`);

  // Generate PDF
  console.log(`[worker] Generating PDF for: ${attendee.name} <${attendee.email}>`);
  const pdfBuffer = await generateCertificate(tmpl, attendee.name);

  // Send email
  await sendCertificate(profile, campaign, attendee, pdfBuffer);

  // Mark as sent
  db.prepare("UPDATE attendees SET status='sent', sent_at=datetime('now') WHERE id=?").run(attendeeId);
  console.log(`[worker] Sent to ${attendee.email}`);

  return { sent: true };

}, {
  connection,
  concurrency: 3,      // Process 3 emails in parallel (safe for most SMTP providers)
  limiter: {
    max:      100,     // BullMQ global rate limit safety valve
    duration: 1000,
  },
});

worker.on('completed', (job, result) => {
  if (result?.sent) {
    console.log(`[worker] Job ${job.id} completed: email sent`);
  }
  // Check if campaign is done
  const { campaignId } = job.data;
  const pending = db.prepare(`
    SELECT COUNT(*) AS n FROM attendees WHERE campaign_id = ? AND status = 'pending'
  `).get(campaignId);
  if (pending.n === 0) {
    const errCount = db.prepare(`
      SELECT COUNT(*) AS n FROM attendees WHERE campaign_id = ? AND status = 'error'
    `).get(campaignId);
    const newStatus = errCount.n > 0 ? 'error' : 'done';
    db.prepare(`UPDATE campaigns SET status = ? WHERE id = ? AND status = 'sending'`).run(newStatus, campaignId);
    console.log(`[worker] Campaign ${campaignId} finished with status: ${newStatus}`);
  }
});

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);
  if (job && job.attemptsMade >= job.opts.attempts) {
    // Final failure — mark attendee as error
    const { attendeeId } = job.data;
    db.prepare(`
      UPDATE attendees SET status='error', error_msg=? WHERE id=?
    `).run(err.message.slice(0, 500), attendeeId);
  }
});

worker.on('error', err => console.error('[worker] Worker error:', err));

console.log('[worker] cert-sender worker started, listening on queue cert-email');
console.log('[worker] Redis:', REDIS_URL);
console.log('[worker] Gotenberg:', process.env.GOTENBERG_URL);
