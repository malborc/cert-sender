'use strict';

const { Queue } = require('bullmq');
const IORedis   = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Shared Redis connection for the Queue
let connection;

function getConnection() {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

let emailQueue;

function getQueue() {
  if (!emailQueue) {
    emailQueue = new Queue('cert-email', { connection: getConnection() });
  }
  return emailQueue;
}

/**
 * Enqueue all pending attendees for a campaign.
 * Uses BullMQ's built-in rate limiter to enforce batch size + interval.
 */
async function addCampaignJobs(campaign) {
  const db = require('../db/index');
  const queue = getQueue();

  const attendees = db.prepare(`
    SELECT * FROM attendees WHERE campaign_id = ? AND status = 'pending' ORDER BY id
  `).all(campaign.id);

  const batchSize     = campaign.batch_size     || 30;
  const intervalMs    = (campaign.batch_interval_min || 10) * 60 * 1000;

  // Remove existing jobs for this campaign (in case of restart)
  // We'll use campaignId as part of the job name for idempotency

  const jobs = attendees.map((attendee, index) => {
    // Calculate delay: which batch this attendee falls into
    const batchIndex = Math.floor(index / batchSize);
    const delay      = batchIndex * intervalMs;

    return {
      name: `cert-${campaign.id}-${attendee.id}`,
      data: {
        campaignId:  campaign.id,
        attendeeId:  attendee.id,
      },
      opts: {
        delay,
        jobId:     `cert-${campaign.id}-${attendee.id}`, // idempotent
        attempts:   3,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: { age: 86400 },  // keep 24h
        removeOnFail:     { age: 86400 * 7 },
      },
    };
  });

  // Add in bulk
  await queue.addBulk(jobs);

  console.log(`[queue] Enqueued ${jobs.length} jobs for campaign ${campaign.id} in ${Math.ceil(jobs.length / batchSize)} batches`);
}

async function pauseCampaign(campaignId) {
  // Mark jobs as paused by draining is complex; simplest is to pause the queue
  // and let the worker respect campaign status flag in DB
  console.log(`[queue] Pause requested for campaign ${campaignId}`);
}

async function resumeCampaign(campaignId) {
  console.log(`[queue] Resume requested for campaign ${campaignId}`);
}

module.exports = { getQueue, getConnection, addCampaignJobs, pauseCampaign, resumeCampaign };
