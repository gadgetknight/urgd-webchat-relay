// POST /api/slack/events  — Slack Events API webhook.
// A technician's reply in a thread maps back to the waiting customer via the
// thread timestamp. Auth: Slack signature (HMAC over the raw body) OR the
// verification token — the latter survives Vercel's automatic body re-parsing,
// which otherwise breaks HMAC.
//
// IMPORTANT (Vercel serverless): do ALL the work BEFORE responding. Vercel
// freezes the function the moment you call res.end(), so any "ack fast then
// process" work after the response is silently dropped. The processing here is
// a few fast Upstash calls, well inside Slack's 3-second window.
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

  const sigOk = verifySignature(raw, req.headers);
  const tokenOk = Boolean(process.env.SLACK_VERIFICATION_TOKEN) &&
    json.token === process.env.SLACK_VERIFICATION_TOKEN;
  const authed = sigOk || tokenOk;
  const e = json.event || {};

  const route = { at: new Date().toISOString(), threadTs: e.thread_ts || null, step: 'start' };
  try {
    // Diagnostic snapshot (no secrets) — visible at /api/health.
    await store.set('debug:lastSlackEvent', {
      at: route.at, type: json.type,
      hasSigHeader: Boolean(req.headers['x-slack-signature']),
      sigOk, tokenOk, authed, bodyPreParsed: typeof req.body === 'object' && req.body !== null,
      eventType: e.type || null, subtype: e.subtype || null, isBot: Boolean(e.bot_id),
      isThreadReply: Boolean(e.thread_ts && e.thread_ts !== e.ts),
      threadTs: e.thread_ts || null, msgTs: e.ts || null,
    }, 3600);

    if (authed) {
      if (json.event_id && (await store.get(`evt:${json.event_id}`))) {
        route.step = 'duplicate';
      } else if (e.type !== 'message' || e.subtype || e.bot_id || !e.thread_ts || e.thread_ts === e.ts) {
        route.step = 'filtered-out';
      } else {
        if (json.event_id) await store.set(`evt:${json.event_id}`, 1, 60 * 30);
        const sessionId = await store.get(`thread:${e.thread_ts}`);
        route.sessionId = sessionId || null;
        const sess = sessionId ? await store.get(`sess:${sessionId}`) : null;
        const answer = String(e.text || '').trim();
        if (!sessionId) route.step = 'no-session-for-this-thread';
        else if (!sess || sess.status === 'answered') route.step = 'no-session-or-already-answered';
        else if (!answer) route.step = 'empty-answer';
        else {
          sess.status = 'answered'; sess.answer = answer; sess.answeredBy = 'human';
          await store.set(`sess:${sessionId}`, sess);
          await store.listPush('conversations', {
            id: sessionId, question: sess.question, answer, answered_by: 'human', ts: new Date().toISOString(),
          });
          route.step = 'ROUTED';
          await store.set('debug:lastRouted', { at: route.at, sessionId }, 3600);
        }
      }
      await store.set('debug:route', route, 3600);
    }
  } catch (err) {
    try { route.step = 'error: ' + err.message; await store.set('debug:route', route, 3600); } catch (_) {}
    console.error('slack events error:', err.message);
  }

  // Respond LAST, after all work is done.
  res.statusCode = 200; res.end('ok');
};
