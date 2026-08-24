// settings.js — the config the control panel edits and the relay reads.
//
// Version 1.2.0  2026-08-24
//
// CHANGELOG
// 1.2.0  2026-08-24  Added ticketSummary (default true) and
//                    ticketSummaryShowPrices (default false).
// 1.0.0              Initial defaults + get/save + business-hours helper.
'use strict';
const { store } = require('./store');

const DEFAULTS = {
  channelId: process.env.SLACK_CHANNEL_ID || '',      // #website-chat channel id
  channelName: 'website-chat',
  botName: 'Website Chat',
  greeting: "Hi! Ask us anything about a repair — a real technician will answer in a moment.",
  waitingMessage: 'A technician is looking at your question now — hang tight, this usually takes a minute…',
  timeoutSeconds: 240,           // 4 min: after this, AI answers if no human replied
  afterHoursAI: true,            // outside business hours, answer with AI immediately
  aiDraftToSlack: true,          // post an AI-suggested answer in the Slack thread for the tech
  aiFallback: true,              // allow AI to answer on timeout
  leadCapture: true,             // ask for name + phone/email
  ticketSummary: true,           // rewrite latest public comment for "Check my ticket"
  ticketSummaryShowPrices: false, // off: discard a summary that still contains $
  businessHours: { tz: 'America/New_York', open: '09:00', close: '18:00', days: [1, 2, 3, 4, 5, 6] },
};

async function getSettings() {
  const saved = (await store.get('settings')) || {};
  return { ...DEFAULTS, ...saved };
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await store.set('settings', next);
  return next;
}

// Is the shop currently within the configured business hours (tech watching Slack)?
function isBusinessHours(s) {
  const bh = s.businessHours || {};
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: bh.tz || 'America/New_York', hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[parts.weekday];
    const cur = `${parts.hour}:${parts.minute}`;
    const days = bh.days || [1, 2, 3, 4, 5, 6];
    if (!days.includes(day)) return false;
    return cur >= (bh.open || '09:00') && cur <= (bh.close || '18:00');
  } catch (_) { return true; }
}

module.exports = { getSettings, saveSettings, isBusinessHours, DEFAULTS };
