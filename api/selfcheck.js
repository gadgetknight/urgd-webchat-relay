// GET/POST /api/selfcheck — runs on a Vercel Cron. Checks the relay's vital
// signs and posts an alert to Slack ONLY if something is wrong. Alerts go to
// SLACK_ALERT_CHANNEL_ID if set, otherwise the main #website-chat channel.
//
// Note: this catches partial failures (memory down, keys missing/invalid) while
// the relay itself is up. For a full-outage alarm, also point a free external
// monitor (e.g. UptimeRobot) at /api/health.
//
// Version 1.1.0  2026-08-24
//
// CHANGELOG
// 1.1.0  2026-08-24  Added a Ticket lookup problem line when SYNCRO_API_KEY
//                    is missing.
// 1.0.0              Initial cron self-check with state-change Slack alerts.
'use strict';
const { sendJson } = require('../lib/http');
const { store, usingUpstash } = require('../lib/store');
const { postMessage } = require('../lib/slack');
const ai = require('../lib/ai');

function authed(req) {
  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const admin = process.env.ADMIN_KEY ? (req.headers['x-admin-key'] === process.env.ADMIN_KEY) : true;
  return Boolean(cron || admin);
}

module.exports = async (req, res) => {
  if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const problems = [];

  // Memory (Upstash) — write/read round trip.
  if (!usingUpstash) {
    problems.push('Memory not connected (Upstash env vars missing) — chats will not work.');
  } else {
    try {
      const m = 'sc-' + Date.now();
      await store.set('debug:sc', m, 120);
      if ((await store.get('debug:sc')) !== m) problems.push('Upstash read/write failed — chats will not work.');
    } catch (e) { problems.push('Upstash error: ' + e.message); }
  }

  // Slack + AI configuration.
  if (!process.env.SLACK_BOT_TOKEN) problems.push('Slack bot token missing — replies cannot post.');
  if (!process.env.SLACK_VERIFICATION_TOKEN) problems.push('Slack verification token missing — technician replies will not route back.');
  if (!process.env.OPENAI_API_KEY) problems.push('OpenAI key missing — AI fallback/draft is off.');
  if (!process.env.PINECONE_API_KEY) problems.push('Pinecone key missing — no knowledge base.');
  else if (!(await ai.pineconeReachable())) problems.push('Pinecone unreachable (bad key or index gone).');
  if (!process.env.SYNCRO_API_KEY) problems.push('Ticket lookup problem: SYNCRO_API_KEY missing — ticket status checks are off.');

  const channel = process.env.SLACK_ALERT_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
  const healthy = problems.length === 0;

  // Only notify on a CHANGE of state: down when it was up, or recovered when it was down.
  let prev = null;
  try { prev = await store.get('monitor:state'); } catch (_) {}
  const wasHealthy = prev ? prev.healthy : true;

  if (channel) {
    if (!healthy && wasHealthy) {
      await postMessage(channel,
        ':rotating_light: *Website chat is DOWN*\n' + problems.map((p) => '• ' + p).join('\n') +
        "\nTransient issues auto-recover; if this persists it needs a fix. You'll get an all-clear when it's back.");
    } else if (healthy && !wasHealthy) {
      await postMessage(channel, ':white_check_mark: *Website chat has RECOVERED* — everything is back to normal.');
    }
  }

  try {
    await store.set('monitor:state', { healthy: healthy, problems: problems, at: new Date().toISOString() });
    await store.set('debug:lastSelfcheck', { at: new Date().toISOString(), ok: healthy, problems: problems }, 60 * 60 * 24);
  } catch (_) {}
  return sendJson(res, 200, { ok: healthy, problems: problems });
};
