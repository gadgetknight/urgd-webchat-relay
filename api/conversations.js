// GET /api/conversations   (admin key required)
// Returns all logged Q&A as JSONL, for the Python ingester (ingest_conversations.py)
// to fold back into the vector database. GET /api/conversations?leads=1 returns leads.
'use strict';
const { cors, preflight } = require('../lib/http');
const { store } = require('../lib/store');

function authed(req) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return true;
  return (req.headers['x-admin-key'] || '') === key;
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (!authed(req)) { res.statusCode = 401; return res.end('unauthorized'); }

  const url = new URL(req.url, 'http://localhost');
  const key = url.searchParams.get('leads') ? 'leads' : 'conversations';
  const rows = await store.listAll(key);
  cors(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.end(rows.map((r) => JSON.stringify(r)).join('\n'));
};
