// ticket-summary.js — rewrite the latest customer-visible Syncro comment
// into plain English for the widget. Never used by the Slack/KB AI path.
//
// Version 1.2.0  2026-08-24
//
// CHANGELOG
// 1.2.0  2026-08-24  Initial. pickComment() keeps hidden===false only
//                    (verified against live extract: hidden:true is internal).
//                    summarise() rephrases via CHAT_MODEL, 8s timeout, NONE
//                    or any failure → null. Caches by ticket+comment id, 10 min.
//
// USAGE
//   const { pickComment, summarise } = require('./lib/ticket-summary');
'use strict';
const { store } = require('./store');

// Verified 2026-08-24 from extracted ticket #25262: hidden:true = internal
// tech note ("ordering a switch 2 charger."); hidden:false = customer-visible
// update ("Your device is currently on our workbench..."). Do not invert.
function isCustomerVisible(c) {
  return Boolean(c) && c.hidden === false;
}

function commentText(c) {
  if (!c) return '';
  return String(c.body || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createdMs(c) {
  const t = Date.parse(c && c.created_at);
  return Number.isNaN(t) ? 0 : t;
}

// Filter to customer-visible comments, newest first. Return the latest; if it
// is under 40 characters, include the previous public comment too. null if none.
function pickComment(ticket) {
  const comments = (ticket && Array.isArray(ticket.comments)) ? ticket.comments.slice() : [];
  const publicOnes = comments.filter((c) => isCustomerVisible(c) && commentText(c));
  publicOnes.sort((a, b) => createdMs(b) - createdMs(a));
  if (!publicOnes.length) return null;
  const latest = publicOnes[0];
  const latestAny = comments.slice().sort((a, b) => createdMs(b) - createdMs(a))[0];
  const skippedInternalLatest = Boolean(latestAny && latestAny.hidden === true);
  const latestText = commentText(latest);
  let text = latestText;
  if (latestText.length < 40 && publicOnes[1]) {
    text = commentText(publicOnes[1]) + '\n\n' + latestText;
  }
  return {
    text,
    commentId: latest.id,
    skippedInternalLatest,
  };
}

const SYSTEM_PROMPT = 'You rewrite repair-shop ticket notes for the customer who owns the device. Write at most two sentences, in plain English, addressed to the customer as "we" and "your". Explain only what the note actually says. Never add information that is not in the note — no causes, no parts, no dates, no completion estimates, no prices. Never mention technician names or internal processes. If the note is too short or too vague to explain anything, reply with exactly: NONE';

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = 8000;
const CACHE_TTL = 10 * 60;

function hasDollarAmount(s) {
  return /\$\s*\d/.test(s) || /\d+(?:\.\d{2})?\s*(?:dollars|usd)\b/i.test(s);
}

// One chat-model call. 8s timeout. null on any failure, NONE, or a leaked price
// when opts.showPrices is false. Never throws.
async function summarise(text, opts) {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  const src = String(text || '').trim();
  if (!key || !src) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: src },
        ],
      }),
      signal: ac.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const out = j.choices && j.choices[0] && j.choices[0].message
      ? String(j.choices[0].message.content || '').trim()
      : '';
    if (!out || /^NONE$/i.test(out)) return null;
    if (!(opts && opts.showPrices) && hasDollarAmount(out)) return null;
    return out;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function cachedSummarise(ticket, opts) {
  const picked = pickComment(ticket);
  if (!picked) return { summary: null, skippedInternalLatest: false };
  const cacheKey = `ticket:sum:${ticket.id}:${picked.commentId}`;
  try {
    const hit = await store.get(cacheKey);
    if (hit && Object.prototype.hasOwnProperty.call(hit, 'summary')) {
      return { summary: hit.summary, skippedInternalLatest: picked.skippedInternalLatest };
    }
  } catch (_) {}
  const summary = await summarise(picked.text, opts);
  try { await store.set(cacheKey, { summary }, CACHE_TTL); } catch (_) {}
  return { summary, skippedInternalLatest: picked.skippedInternalLatest };
}

module.exports = { pickComment, summarise, cachedSummarise };
