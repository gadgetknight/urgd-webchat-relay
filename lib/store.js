// store.js — tiny key/value store used by the relay.
// Local/dev: a JSON file (persists across restarts, good for testing).
// Production (Vercel): Upstash Redis via REST, if UPSTASH_REDIS_REST_URL is set.
// The interface is the same either way: get/set/del + listPush/listAll.
'use strict';
const fs = require('fs');
const path = require('path');

const TTL_DEFAULT = 60 * 60 * 24; // 1 day for session keys

function makeFileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const flush = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  };
  const alive = (e) => !e.exp || e.exp > Date.now();
  return {
    async get(key) { const e = data[key]; return e && alive(e) ? e.v : null; },
    async set(key, val, ttl) { data[key] = { v: val, exp: ttl ? Date.now() + ttl * 1000 : 0 }; flush(); },
    async del(key) { delete data[key]; flush(); },
    async listPush(key, val) { const e = data[key] && alive(data[key]) ? data[key].v : []; e.push(val); data[key] = { v: e, exp: 0 }; flush(); },
    async listAll(key) { const e = data[key]; return e && alive(e) ? e.v : []; },
  };
}

function makeUpstashStore(url, token) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Auto-retry transient failures (network hiccups, 429 rate spikes, 5xx) so a
  // brief Upstash blip self-heals instead of breaking a chat.
  const call = async (cmd) => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cmd),
        });
        if (!r.ok) {
          if ((r.status === 429 || r.status >= 500) && attempt < 2) { await sleep(200 * (attempt + 1)); continue; }
          throw new Error('upstash HTTP ' + r.status);
        }
        const j = await r.json();
        return j.result;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await sleep(200 * (attempt + 1));
      }
    }
    throw lastErr;
  };
  return {
    async get(key) { const v = await call(['GET', key]); return v == null ? null : JSON.parse(v); },
    async set(key, val, ttl) { const c = ['SET', key, JSON.stringify(val)]; if (ttl) c.push('EX', String(ttl)); await call(c); },
    async del(key) { await call(['DEL', key]); },
    async listPush(key, val) { await call(['RPUSH', key, JSON.stringify(val)]); },
    async listAll(key) { const v = await call(['LRANGE', key, '0', '-1']); return (v || []).map((s) => JSON.parse(s)); },
  };
}

// Accept either the Upstash-native names or the Vercel-integration (KV_*) names,
// so it works whether you add Upstash directly or via Vercel's Storage tab.
const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

let store;
const usingUpstash = Boolean(REST_URL && REST_TOKEN);
if (usingUpstash) {
  store = makeUpstashStore(REST_URL, REST_TOKEN);
} else {
  store = makeFileStore(path.join(process.env.STORE_DIR || '/tmp', 'webchat-store.json'));
}

module.exports = { store, TTL_DEFAULT, usingUpstash };
