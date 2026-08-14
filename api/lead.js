// POST /api/lead  { sessionId, name, contact, note? }
// Captures a prospect's contact info so a website visitor is never a lost lead.
// Also drops a note into the Slack thread so the tech sees who they're talking to.
'use strict';
const { sendJson, readBody, preflight } = require('../lib/http');
const { store } = require('../lib/store');
const { getSettings } = require('../lib/settings');
const { postMessage } = require('../lib/slack');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });

  const { json } = await readBody(req);
  const sessionId = String(json.sessionId || '').slice(0, 80);
  const name = String(json.name || '').slice(0, 120);
  const contact = String(json.contact || '').slice(0, 200);
  const note = String(json.note || '').slice(0, 500);
  if (!contact && !name) return sendJson(res, 400, { error: 'name or contact required' });

  const lead = { sessionId, name, contact, note, ts: new Date().toISOString() };
  await store.listPush('leads', lead);

  // Surface it in the Slack thread if we have one.
  const sess = sessionId ? await store.get(`sess:${sessionId}`) : null;
  const s = await getSettings();
  if (sess && sess.threadTs) {
    await postMessage(s.channelId, `:bust_in_silhouette: *Lead:* ${name || '(no name)'} — ${contact || '(no contact)'}`, sess.threadTs);
  } else {
    await postMessage(s.channelId, `:bust_in_silhouette: *New lead (no active thread):* ${name || '(no name)'} — ${contact || '(no contact)'}`);
  }

  return sendJson(res, 200, { ok: true });
};
