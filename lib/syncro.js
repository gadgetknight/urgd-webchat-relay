// syncro.js — thin read-only client for the Syncro MSP REST API.
// Used only by the "Check my ticket" path. Never writes. Never logs phone digits.
//
// Version 1.1.0  2026-08-24
//
// CHANGELOG
// 1.1.0  2026-08-24  Initial. Bearer auth, configured flag, findTicketByNumber
//                    (GET /tickets?number= then GET /tickets?query= + exact
//                    number match), getCustomer. One retry on 429/5xx, 10s
//                    timeout. Returns result objects — never throws raw.
//
// USAGE
//   const syncro = require('./lib/syncro');
//   if (!syncro.configured) { /* degrade */ }
//   const found = await syncro.findTicketByNumber('4471');
'use strict';

const TIMEOUT_MS = 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function creds() {
  const subdomain = (process.env.SYNCRO_SUBDOMAIN || '').trim();
  const key = (process.env.SYNCRO_API_KEY || '').trim();
  return {
    subdomain,
    key,
    base: subdomain ? `https://${subdomain}.syncromsp.com/api/v1` : '',
  };
}

function isConfigured() {
  const c = creds();
  return Boolean(c.subdomain && c.key);
}

// GET path (with query string). One retry + backoff on 429/5xx / network, 10s timeout.
// Never throws — { ok, json?, error? }.
async function request(pathAndQuery) {
  const c = creds();
  if (!c.subdomain || !c.key) return { ok: false, error: 'not-configured' };
  let lastErr = 'request-failed';
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${c.base}${pathAndQuery}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${c.key}`, Accept: 'application/json' },
        signal: ac.signal,
      });
      if ((r.status === 429 || r.status >= 500) && attempt < 1) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      if (!r.ok) return { ok: false, error: 'http-' + r.status };
      let json;
      try { json = await r.json(); } catch (_) { return { ok: false, error: 'bad-json' }; }
      return { ok: true, json };
    } catch (e) {
      lastErr = e && e.name === 'AbortError' ? 'timeout' : 'network';
      if (attempt < 1) await sleep(200 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastErr };
}

function ticketsFrom(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.tickets)) return payload.tickets;
  if (payload.ticket && typeof payload.ticket === 'object') return [payload.ticket];
  if (Array.isArray(payload)) return payload;
  return [];
}

function exactNumberMatch(ticket, n) {
  return Boolean(ticket) && String(ticket.number) === String(n);
}

function pickExact(list, n) {
  const hits = (list || []).filter((t) => exactNumberMatch(t, n));
  return hits.length === 1 ? hits[0] : null;
}

// Look up one ticket by its number. Tries ?number= first; if that is not a
// single exact match, falls back to ?query= and filters client-side. Never
// accepts a fuzzy / partial match.
async function findTicketByNumber(number) {
  const n = String(number || '').replace(/\D/g, '');
  if (!n) return { ok: false, error: 'bad-number' };

  const byNumber = await request(`/tickets?number=${encodeURIComponent(n)}`);
  if (byNumber.ok) {
    const list = ticketsFrom(byNumber.json);
    if (list.length === 1 && exactNumberMatch(list[0], n)) {
      return { ok: true, ticket: list[0], via: 'number' };
    }
  }

  const byQuery = await request(`/tickets?query=${encodeURIComponent(n)}`);
  if (!byQuery.ok) return { ok: false, error: byQuery.error || 'not-found' };
  const ticket = pickExact(ticketsFrom(byQuery.json), n);
  if (!ticket) return { ok: false, error: 'not-found' };
  return { ok: true, ticket, via: 'query' };
}

async function getCustomer(customerId) {
  const id = String(customerId || '').replace(/\D/g, '');
  if (!id) return { ok: false, error: 'bad-customer-id' };
  const r = await request(`/customers/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, error: r.error || 'not-found' };
  const payload = r.json;
  const customer = (payload && payload.customer && typeof payload.customer === 'object')
    ? payload.customer
    : (payload && payload.id ? payload : null);
  if (!customer) return { ok: false, error: 'not-found' };
  return { ok: true, customer };
}

module.exports = {
  get configured() { return isConfigured(); },
  findTicketByNumber,
  getCustomer,
};
