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
  const call = async (cmd) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const j = await r.json();
    return j.result;
  };
  return {
    async get(key) { const v = await call(['GET', key]); return v == null ? null : JSON.parse(v); },
    async set(key, val, ttl) { const c = ['SET', key, JSON.stringify(val)]; if (ttl) c.push('EX', String(ttl)); await call(c); },
    async del(key) { await call(['DEL', key]); },
    async listPush(key, val) { await call(['RPUSH', key, JSON.stringify(val)]); },
    async listAll(key) { const v = await call(['LRANGE', key, '0', '-1']); return (v || []).map((s) => JSON.parse(s)); },
  };
}

let store;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  store = makeUpstashStore(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN);
} else {
  store = makeFileStore(path.join(process.env.STORE_DIR || '/tmp', 'webchat-store.json'));
}

module.exports = { store, TTL_DEFAULT };
