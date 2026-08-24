// POST /api/ask  { sessionId, question, contact? }
// Customer asks -> post to #website-chat as a new thread -> (optional) AI draft
// in-thread for the tech -> tell the widget to wait. After-hours: AI answers now.
'use strict';
const { sendJson, readBody, preflight } = require('../lib/http');
const { store, TTL_DEFAULT } = require('../lib/store');
const { getSettings, isBusinessHours } = require('../lib/settings');
const { postMessage } = require('../lib/slack');
const { draftAnswer } = require('../lib/ai');

async function logConversation(rec) {
  await store.listPush('conversations', rec);
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });

  const { json } = await readBody(req);
  const sessionId = String(json.sessionId || '').slice(0, 80);
  const question = String(json.question || '').trim().slice(0, 2000);
  const contact = json.contact ? String(json.contact).slice(0, 300) : '';
  if (!sessionId || !question) return sendJson(res, 400, { error: 'sessionId and question required' });

  const s = await getSettings();

  // After hours (nobody watching Slack): answer with AI right away if enabled.
  if (s.afterHoursAI && !isBusinessHours(s)) {
    const ai = (await draftAnswer(question)) ||
      "Thanks for reaching out! We're closed right now, but leave your name and number and we'll get right back to you.";
    await logConversation({ id: sessionId, question, answer: ai, answered_by: 'ai', ts: new Date().toISOString() });
    return sendJson(res, 200, { status: 'answered', answer: ai, answeredBy: 'ai' });
  }

  // Business hours: relay to the technician in Slack.
  const header = `:speech_balloon: *New website question*\n>${question}` +
    (contact ? `\n_Contact: ${contact}_` : '') +
    `\n_Reply in this thread to answer the customer._`;
  const posted = await postMessage(s.channelId, header);
  if (!posted.ok) return sendJson(res, 502, { error: 'could not reach Slack', detail: posted.error });

  const threadTs = posted.ts;
  await store.set(`sess:${sessionId}`, {
    sessionId, question, contact, threadTs,
    status: 'waiting', answer: null, answeredBy: null, createdAt: Date.now(),
    timeoutSeconds: s.timeoutSeconds, aiFallback: s.aiFallback,  // snapshot so /api/poll needs no extra read
  }, TTL_DEFAULT);
  await store.set(`thread:${threadTs}`, sessionId, TTL_DEFAULT);

  // Suggest an answer to the tech (they can copy/tweak or ignore).
  if (s.aiDraftToSlack) {
    draftAnswer(question).then((d) => {
      if (d) postMessage(s.channelId, `:robot_face: *Suggested answer (edit or ignore):*\n${d}`, threadTs);
    }).catch(() => {});
  }

  return sendJson(res, 200, { status: 'waiting', message: s.waitingMessage });
};
