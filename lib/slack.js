// slack.js — post to Slack + verify inbound Slack event signatures.
// If SLACK_BOT_TOKEN is missing (local dev), runs in MOCK mode: "posts" are
// recorded in the store so the test harness can simulate a technician reply.
'use strict';
const crypto = require('crypto');
const { store } = require('./store');

const TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const MOCK = !TOKEN || process.env.MOCK_SLACK === '1';

// Post a message. Returns { ok, ts } where ts is the message/thread timestamp.
async function postMessage(channel, text, thread_ts) {
  if (MOCK) {
    const ts = `${Date.now() / 1000}`;
    await store.listPush('mock:slack:posts', { channel, text, thread_ts: thread_ts || null, ts });
    return { ok: true, ts, mock: true };
  }
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, thread_ts, unfurl_links: false, unfurl_media: false }),
  });
  const j = await r.json();
  if (!j.ok) console.error('slack postMessage error:', j.error);
  return { ok: j.ok, ts: j.ts, error: j.error };
}

// Verify the request really came from Slack (guards the events webhook).
function verifySignature(rawBody, headers) {
  if (MOCK) return true; // no signature in local mock mode
  if (!SIGNING_SECRET) return false;
  const ts = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false; // replay guard
  const base = `v0:${ts}:${rawBody}`;
  const mine = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig)); } catch (_) { return false; }
}

module.exports = { postMessage, verifySignature, MOCK };
