// POST /api/slack/events  — Slack Events API webhook.
// A technician's reply in a thread maps back to the waiting customer via the
// thread timestamp (this is why Slack beats SMS: routing is exact and handles
// many simultaneous conversations for free).
'use strict';
const { sendJson, readBody } = require('../../lib/http');
const { store } = require('../../lib/store');
const { verifySignature } = require('../../lib/slack');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
  const { raw, json } = await readBody(req);

  // Slack's one-time URL verification handshake.
  if (json.type === 'url_verification') {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end(json.challenge);
  }

  if (!verifySignature(raw, req.headers)) return sendJson(res, 401, { error: 'bad signature' });

  // Ack fast (Slack retries if we're slow), then process.
  res.statusCode = 200; res.end('ok');

  try {
    // De-dupe Slack retries.
    if (json.event_id) {
      const seen = await store.get(`evt:${json.event_id}`);
      if (seen) return;
      await store.set(`evt:${json.event_id}`, 1, 60 * 30);
    }

    const e = json.event || {};
    // Only human thread replies: has a thread_ts, isn't the parent, not from a bot/app.
    if (e.type !== 'message' || e.subtype || e.bot_id || !e.thread_ts || e.thread_ts === e.ts) return;

    const sessionId = await store.get(`thread:${e.thread_ts}`);
    if (!sessionId) return; // reply in some other thread we don't track

    const sess = await store.get(`sess:${sessionId}`);
    if (!sess || sess.status === 'answered') return;

    const answer = String(e.text || '').trim();
    if (!answer) return;

    sess.status = 'answered'; sess.answer = answer; sess.answeredBy = 'human';
    await store.set(`sess:${sessionId}`, sess);
    await store.listPush('conversations', {
      id: sessionId, question: sess.question, answer, answered_by: 'human', ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('slack events error:', err.message);
  }
};
