// POST /api/ticket  { sessionId, ticketNumber, last4 }
// Live Syncro lookup: ticket number + last 4 of the phone on file → status only.
// Never logs to the conversations list. Never logs phone digits.
//
// Version 1.2.0  2026-08-24
//
// CHANGELOG
// 1.2.0  2026-08-24  On a verified lookup, add firstName + updateSummary
//                    (public comment rewrite). Summary failure never fails
//                    the lookup. Still never logs to conversations.
// 1.1.0  2026-08-24  Initial. Validates input, rate-limits (5/session/15min,
//                    20/hour global), verifies last-4 against live Syncro
//                    ticket/customer phones, returns status only. Identical
//                    generic 200 for every failure mode.
'use strict';
const { sendJson, readBody, preflight } = require('../lib/http');
const { store } = require('../lib/store');
const syncro = require('../lib/syncro');
const { getSettings } = require('../lib/settings');
const { cachedSummarise } = require('../lib/ticket-summary');

const GENERIC = 'I could not match that ticket number and phone. Double-check them, or ask a question and a technician will help.';

// Raw Syncro status → plain English. Unrecognised statuses use the default.
const STATUS_TEXT = {
  'New': 'New',
  'In Progress': 'In Progress',
  'Waiting on Customer': 'Waiting on you',
  'Waiting for Parts': 'Waiting for parts',
  'Customer Reply': 'Waiting on our reply',
  'Resolved': 'Resolved',
  'Closed': 'Closed',
  'Invoiced': 'Invoiced',
  'On Hold': 'On hold',
  'Jon Projects': 'With our team',
};
const STATUS_DEFAULT = 'In progress';

const RL_SESS_MAX = 5;
const RL_SESS_WINDOW = 15 * 60;      // 15 minutes
const RL_GLOBAL_MAX = 20;
const RL_GLOBAL_WINDOW = 60 * 60;    // 1 hour

function fail(res) {
  return sendJson(res, 200, { ok: false, message: GENERIC });
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

// Length-independent last-4 equality: both sides must have ≥4 digits; compare
// the final 4 only. Never a substring search of the stored number.
function last4Equal(stored, given) {
  const a = digitsOnly(stored);
  const b = digitsOnly(given);
  if (a.length < 4 || b.length < 4) return false;
  const a4 = a.slice(-4);
  const b4 = b.slice(-4);
  return a4.length === 4 && b4.length === 4 && a4 === b4;
}

function takePhones(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.phone) out.push(obj.phone);
  if (obj.mobile) out.push(obj.mobile);
  if (Array.isArray(obj.contacts)) {
    for (const c of obj.contacts) takePhones(c, out);
  }
}

function phonesFromTicketAndCustomer(ticket, customer) {
  const out = [];
  takePhones(ticket, out);
  if (ticket && ticket.customer) takePhones(ticket.customer, out);
  if (ticket && ticket.contact) takePhones(ticket.contact, out);
  takePhones(customer, out);
  return out;
}

function statusText(raw) {
  if (raw == null || raw === '') return STATUS_DEFAULT;
  return Object.prototype.hasOwnProperty.call(STATUS_TEXT, raw) ? STATUS_TEXT[raw] : STATUS_DEFAULT;
}

function friendlyUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', timeZone: 'America/New_York',
  }).format(d);
  return 'last updated ' + day;
}

// First whitespace token of customer.firstname, title-cased. Omit if missing
// or it does not look like a name (never guess, never use business/full name).
function firstNameFrom(customer) {
  const raw = customer && customer.firstname != null ? String(customer.firstname) : '';
  const token = raw.trim().split(/\s+/)[0] || '';
  if (token.length < 2 || !/^[A-Za-z][A-Za-z'-]*$/.test(token)) return '';
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

async function takeSlot(key, max, windowSec) {
  const now = Date.now();
  const rec = (await store.get(key)) || { hits: [] };
  const hits = (rec.hits || []).filter((t) => now - t < windowSec * 1000);
  if (hits.length >= max) return false;
  hits.push(now);
  await store.set(key, { hits }, windowSec);
  return true;
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });

  const { json } = await readBody(req);
  const sessionId = String(json.sessionId || '').slice(0, 80);
  const rawNumber = String(json.ticketNumber || '').trim();
  const last4 = String(json.last4 || '').trim();

  if (!sessionId || rawNumber.length < 1 || rawNumber.length > 20 || !/^\d{4}$/.test(last4)) {
    return fail(res);
  }
  const ticketNumber = digitsOnly(rawNumber);
  if (!ticketNumber) return fail(res);

  if (!(await takeSlot(`ticket:rl:sess:${sessionId}`, RL_SESS_MAX, RL_SESS_WINDOW))) return fail(res);
  if (!(await takeSlot('ticket:rl:global', RL_GLOBAL_MAX, RL_GLOBAL_WINDOW))) return fail(res);

  if (!syncro.configured) {
    console.warn('ticket lookup: SYNCRO_SUBDOMAIN / SYNCRO_API_KEY not set');
    return fail(res);
  }

  const found = await syncro.findTicketByNumber(ticketNumber);
  if (!found.ok || !found.ticket) return fail(res);

  const ticket = found.ticket;
  let customer = null;
  let phones = phonesFromTicketAndCustomer(ticket, null);
  const hasUsable = phones.some((p) => digitsOnly(p).length >= 4);
  if (!hasUsable && ticket.customer_id) {
    const cust = await syncro.getCustomer(ticket.customer_id);
    if (cust.ok) customer = cust.customer;
    phones = phonesFromTicketAndCustomer(ticket, customer);
  }

  let matched = false;
  for (const p of phones) {
    if (last4Equal(p, last4)) { matched = true; break; }
  }
  if (!matched) return fail(res);

  let firstName = firstNameFrom(ticket.customer || customer);
  let updateSummary = null;
  try {
    const s = await getSettings();
    if (s.ticketSummary !== false) {
      let full = ticket;
      if (ticket.id && syncro.getTicket) {
        const det = await syncro.getTicket(ticket.id);
        if (det.ok && det.ticket) full = det.ticket;
      }
      if (!firstName) firstName = firstNameFrom(full.customer);
      const built = await cachedSummarise(full, { showPrices: !!s.ticketSummaryShowPrices });
      updateSummary = built && built.summary ? built.summary : null;
    }
  } catch (_) { /* lookup still succeeds with status headline only */ }

  return sendJson(res, 200, {
    ok: true,
    number: ticket.number,
    status: statusText(ticket.status),
    updatedAt: friendlyUpdated(ticket.updated_at),
    firstName: firstName || '',
    updateSummary,
  });
};
