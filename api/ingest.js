// GET/POST /api/ingest — fold answered chats into the Pinecone knowledge base.
// Runs on a weekly Vercel Cron, and can be triggered manually with the admin key.
// Only HUMAN-answered conversations are ingested (that's the authoritative
// knowledge), PII-scrubbed first. Ingested ids are remembered so re-runs skip them.
'use strict';
const { sendJson, preflight } = require('../lib/http');
const { store } = require('../lib/store');
const { redact } = require('../lib/redact');
const ai = require('../lib/ai');

function authed(req) {
  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const admin = process.env.ADMIN_KEY ? (req.headers['x-admin-key'] === process.env.ADMIN_KEY) : true;
  return Boolean(cron || admin);
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const convos = await store.listAll('conversations');
    const ingested = new Set((await store.get('ingested:ids')) || []);
    const fresh = convos.filter((c) =>
      c && c.answered_by === 'human' && c.id && c.question && c.answer && !ingested.has(c.id));

    if (!fresh.length) return sendJson(res, 200, { ingested: 0, message: 'nothing new to ingest' });

    const texts = fresh.map((c) => redact(`Customer question: ${c.question}\nAnswer: ${c.answer}`));
    const embeddings = await ai.embedBatch(texts);
    const vectors = fresh.map((c, i) => ({
      id: `conversation-${c.id}`,
      values: embeddings[i],
      metadata: { source: 'conversation', type: 'conversation', ts: c.ts || '', text: texts[i].slice(0, 8000) },
    }));

    // Upsert in batches of 100.
    for (let i = 0; i < vectors.length; i += 100) {
      await ai.upsertVectors(vectors.slice(i, i + 100));
    }

    fresh.forEach((c) => ingested.add(c.id));
    await store.set('ingested:ids', Array.from(ingested));
    await store.set('debug:lastIngest', { at: new Date().toISOString(), count: fresh.length }, 60 * 60 * 24 * 60);

    return sendJson(res, 200, { ingested: fresh.length });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
};
