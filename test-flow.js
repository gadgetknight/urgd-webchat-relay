// test-flow.js — exercises the full relay flow in-process with a MOCK Slack.
//   node test-flow.js
// No server, no ports, no external services. Proves: customer asks -> relayed to
// Slack -> technician replies in-thread -> answer routed back to the customer;
// plus the timeout -> fallback path; plus ticket lookup (Syncro mocked).
//
// Version 1.1.0  2026-08-24
//
// CHANGELOG
// 1.1.0  2026-08-24  Added mock-mode ticket lookup tests (malformed, wrong
//                    last4, rate limit, status-only success). No API key needed.
// 1.0.0              Initial ask → Slack → poll / timeout flow.
'use strict';
const fs = require('fs');
const path = require('path');

// Force local/mock mode BEFORE requiring anything.
process.env.STORE_DIR = path.join(__dirname, '.data-test');
process.env.MOCK_SLACK = '1';
delete process.env.OPENAI_API_KEY;   // AI returns null -> canned fallback (keeps test offline)
delete process.env.PINECONE_API_KEY;
delete process.env.SYNCRO_API_KEY;
delete process.env.SYNCRO_SUBDOMAIN;
try { fs.rmSync(path.join(__dirname, '.data-test'), { recursive: true, force: true }); } catch (_) {}

const askH = require('./api/ask');
const pollH = require('./api/poll');
const eventsH = require('./api/slack/events');
const ticketH = require('./api/ticket');
const syncro = require('./lib/syncro');
const { store } = require('./lib/store');
const { saveSettings } = require('./lib/settings');

function res() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.end = (d) => { r.body = d; };
  return r;
}
const call = async (h, req) => { const r = res(); await h(req, r); return { code: r.statusCode, json: safe(r.body) }; };
const safe = (s) => { try { return JSON.parse(s); } catch (_) { return s; } };
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await saveSettings({ channelId: 'C_TEST', afterHoursAI: false, aiDraftToSlack: false, timeoutSeconds: 1 });

  console.log('\n1) Customer asks -> relayed to Slack, widget told to wait');
  let a = await call(askH, { method: 'POST', url: '/api/ask', headers: {}, body: { sessionId: 'S1', question: 'Do you fix PS5 HDMI ports and how much?' } });
  ok(a.code === 200 && a.json.status === 'waiting', 'ask returns waiting');
  const sess = await store.get('sess:S1');
  ok(sess && sess.threadTs, 'session stored with a Slack thread ts');
  const posts = await store.listAll('mock:slack:posts');
  ok(posts.some((p) => p.text.includes('New website question')), 'question posted to #website-chat (mock)');

  console.log('\n2) Poll before any reply -> still waiting');
  let p = await call(pollH, { method: 'GET', url: '/api/poll?sessionId=S1', headers: {} });
  ok(p.json.status === 'waiting', 'poll says waiting');

  console.log("3) Technician replies in the thread -> routed back to the customer");
  await call(eventsH, {
    method: 'POST', url: '/api/slack/events', headers: {},
    body: { event_id: 'E1', event: { type: 'message', text: 'Yes! PS5 HDMI port repair is $175, about 2-3 days.', thread_ts: sess.threadTs, ts: sess.threadTs + '1' } },
  });
  p = await call(pollH, { method: 'GET', url: '/api/poll?sessionId=S1', headers: {} });
  ok(p.json.status === 'answered' && p.json.answeredBy === 'human', 'poll now answered by human');
  ok(p.json.answer.includes('$175'), 'customer gets the technician\'s exact answer');

  console.log('4) That Q&A is logged for the vector DB');
  const convos = await store.listAll('conversations');
  ok(convos.some((c) => c.id === 'S1' && c.answered_by === 'human'), 'conversation logged (human)');

  console.log('5) A bot/app message in-thread is IGNORED (not treated as the answer)');
  await call(eventsH, { method: 'POST', url: '/api/slack/events', headers: {}, body: { event_id: 'E2', event: { type: 'message', text: 'suggested draft', thread_ts: sess.threadTs, ts: sess.threadTs + '2', bot_id: 'B1' } } });
  const s1b = await store.get('sess:S1');
  ok(s1b.answer.includes('$175'), 'human answer preserved, bot message ignored');

  console.log('6) Timeout with no human reply -> fallback answer');
  await call(askH, { method: 'POST', url: '/api/ask', headers: {}, body: { sessionId: 'S2', question: 'Do you unlock phones?' } });
  await sleep(1100); // exceed the 1s test timeout
  p = await call(pollH, { method: 'GET', url: '/api/poll?sessionId=S2', headers: {} });
  ok(p.json.status === 'answered' && p.json.answeredBy === 'ai', 'timeout produced a fallback answer');

  const GENERIC = 'I could not match that ticket number and phone. Double-check them, or ask a question and a technician will help.';
  const convosBeforeTicket = (await store.listAll('conversations')).length;

  // Dummy env so syncro.configured is true; functions below are stubbed so
  // nothing hits the live API (no real key is set).
  process.env.SYNCRO_SUBDOMAIN = 'test';
  process.env.SYNCRO_API_KEY = 'test';
  syncro.findTicketByNumber = async (n) => ({
    ok: true,
    ticket: {
      number: Number(n) || n,
      status: 'In Progress',
      updated_at: '2026-08-21T12:00:00-04:00',
      customer_id: 99,
    },
  });
  syncro.getCustomer = async () => ({
    ok: true,
    customer: { phone: '6095554567', mobile: '' },
  });

  console.log('7) Ticket lookup: malformed input → generic failure (HTTP 200)');
  let t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST1', ticketNumber: '4471', last4: '12' } });
  ok(t.code === 200 && t.json.ok === false && t.json.message === GENERIC, 'short last4 rejected with generic message');
  t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST1', ticketNumber: '4471', last4: 'abcd' } });
  ok(t.code === 200 && t.json.message === GENERIC, 'non-digit last4 rejected with generic message');
  t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST1', ticketNumber: '', last4: '4567' } });
  ok(t.code === 200 && t.json.message === GENERIC, 'empty ticket number rejected with generic message');
  t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST1', ticketNumber: '123456789012345678901', last4: '4567' } });
  ok(t.code === 200 && t.json.message === GENERIC, 'overlong ticket number rejected with generic message');

  console.log('8) Ticket lookup: wrong last4 → generic message (does not reveal the ticket exists)');
  t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST2', ticketNumber: '4471', last4: '0000' } });
  ok(t.code === 200 && t.json.ok === false && t.json.message === GENERIC, 'wrong last4 returns generic message');
  ok(!('status' in t.json) && !('number' in t.json), 'wrong last4 does not leak ticket fields');

  console.log('9) Ticket lookup: rate limit trips after 5 attempts on one session');
  let sixth;
  for (let i = 0; i < 6; i++) {
    sixth = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST3', ticketNumber: '4471', last4: '0000' } });
  }
  ok(sixth.code === 200 && sixth.json.message === GENERIC, '6th attempt still generic (rate limited, not a Syncro error)');
  const rl = await store.get('ticket:rl:sess:ST3');
  ok(rl && rl.hits && rl.hits.length === 5, 'session counter stops at 5 (6th did not call Syncro)');

  console.log('10) Ticket lookup: success returns status only; not logged to conversations');
  t = await call(ticketH, { method: 'POST', url: '/api/ticket', headers: {}, body: { sessionId: 'ST4', ticketNumber: '4471', last4: '4567' } });
  ok(t.code === 200 && t.json.ok === true, 'success ok');
  ok(t.json.number === 4471 && t.json.status === 'In Progress', 'returns number + mapped status');
  ok(t.json.updatedAt === 'last updated Friday', 'friendly last-updated date');
  ok(Object.keys(t.json).sort().join(',') === 'number,ok,status,updatedAt', 'status-only payload (no comments/phone/name)');
  const convosAfterTicket = (await store.listAll('conversations')).length;
  ok(convosAfterTicket === convosBeforeTicket, 'ticket lookup not logged to conversations');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  try { fs.rmSync(path.join(__dirname, '.data-test'), { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})();
