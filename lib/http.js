// http.js — small helpers shared by the API handlers (CORS, JSON in/out).
'use strict';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // public website widget
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
}

function sendJson(res, code, obj) {
  cors(res);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Read the raw + parsed JSON body. Works both under Vercel and the local server.
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const json = typeof req.body === 'string' ? safeParse(req.body) : req.body;
      return resolve({ raw, json });
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve({ raw, json: safeParse(raw) }));
    req.on('error', () => resolve({ raw: '', json: {} }));
  });
}

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch (_) { return {}; } }

function preflight(req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; res.end(); return true; }
  return false;
}

module.exports = { cors, sendJson, readBody, preflight };
