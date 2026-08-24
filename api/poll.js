// GET /api/poll?sessionId=...  -> { status: 'waiting'|'answered', answer?, answeredBy? }
// The widget calls this every few seconds. If the technician hasn't replied by
// the timeout, the AI answers (when enabled) so the visitor is never left hanging.
'use strict';
const { sendJson, preflight } = require('../lib/http');
const { store } = require('../lib/store');
const { draftAnswer } = require('../lib/ai');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId') || '';
  if (!sessionId) return sendJson(res, 400, { error: 'sessionId required' });

  const sess = await store.get(`sess:${sessionId}`);
  if (!sess) return sendJson(res, 404, { status: 'unknown' });

  if (sess.status === 'answered') {
    return sendJson(res, 200, { status: 'answered', answer: sess.answer, answeredBy: sess.answeredBy });
  }

  // Timed out waiting for a human? (uses the snapshot taken in /api/ask — no extra read)
  const waitedMs = Date.now() - sess.createdAt;
  const timeoutSeconds = sess.timeoutSeconds || 240;
  const aiFallback = sess.aiFallback !== false;
  if (aiFallback && waitedMs > timeoutSeconds * 1000) {
    const ai = (await draftAnswer(sess.question)) ||
      "Our technician is tied up at the moment — leave your name and number and we'll get right back to you.";
    sess.status = 'answered'; sess.answer = ai; sess.answeredBy = 'ai';
    await store.set(`sess:${sessionId}`, sess);
    await store.listPush('conversations', { id: sessionId, question: sess.question, answer: ai, answered_by: 'ai', ts: new Date().toISOString() });
    return sendJson(res, 200, { status: 'answered', answer: ai, answeredBy: 'ai' });
  }

  return sendJson(res, 200, { status: 'waiting' });
};
