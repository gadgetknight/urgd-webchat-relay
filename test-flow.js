// test-flow.js — exercises the full relay flow in-process with a MOCK Slack.
//   node test-flow.js
// No server, no ports, no external services. Proves: customer asks -> relayed to
// Slack -> technician replies in-thread -> answer routed back to the customer;
// plus the timeout -> fallback path.
'use strict';
const fs = require('fs');
const path = require('path');

// Force local/mock mode BEFORE requiring anything.
process.env.STORE_DIR = path.join(__dirname, '.data-test');
process.env.MOCK_SLACK = '1';
delete process.env.OPENAI_API_KEY;   // AI returns null -> canned fallback (keeps test offline)
delete process.env.PINECONE_API_KEY;
try { fs.rmSync(path.join(__dirname, '.data-test'), { recursive: true, force: true }); } catch (_) {}

const askH = require('./api/ask');
const pollH = require('./api/poll');
const eventsH = require('./api/slack/events');
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

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  try { fs.rmSync(path.join(__dirname, '.data-test'), { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})();
