// GET /api/health — public diagnostic (no secrets). Shows what's wired up so we
// can tell at a glance whether Slack, AI, and the Upstash "memory" are connected.
//
// Version 1.1.0  2026-08-24
//
// CHANGELOG
// 1.1.0  2026-08-24  Added syncroKeySet and syncroSubdomainSet (booleans only).
// 1.0.0              Initial public diagnostic (no secrets).
'use strict';
const { sendJson, preflight } = require('../lib/http');
const { store, usingUpstash } = require('../lib/store');

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  let persists = false;
  try {
    const marker = `health-${Date.now()}`;
    await store.set('health:ping', marker, 60);
    persists = (await store.get('health:ping')) === marker;
  } catch (_) {}

  let lastSlackEvent = null, lastRouted = null, lastRoute = null;
  try { lastSlackEvent = await store.get('debug:lastSlackEvent'); } catch (_) {}
  try { lastRouted = await store.get('debug:lastRouted'); } catch (_) {}
  try { lastRoute = await store.get('debug:route'); } catch (_) {}

  return sendJson(res, 200, {
    ok: true,
    storage: usingUpstash ? 'upstash' : 'file (ephemeral — settings/sessions will NOT persist)',
    storeWriteWorks: persists,
    slackTokenSet: Boolean(process.env.SLACK_BOT_TOKEN),
    slackSigningSecretSet: Boolean(process.env.SLACK_SIGNING_SECRET),
    slackVerificationTokenSet: Boolean(process.env.SLACK_VERIFICATION_TOKEN),
    slackChannelSet: Boolean(process.env.SLACK_CHANNEL_ID),
    openaiKeySet: Boolean(process.env.OPENAI_API_KEY),
    pineconeKeySet: Boolean(process.env.PINECONE_API_KEY),
    adminKeySet: Boolean(process.env.ADMIN_KEY),
    syncroKeySet: Boolean(process.env.SYNCRO_API_KEY),
    syncroSubdomainSet: Boolean(process.env.SYNCRO_SUBDOMAIN),
    lastSlackEvent,   // what the last Slack event delivery looked like (no secrets)
    lastRoute,        // where the last reply got in the routing pipeline
    lastRouted,       // last answer successfully routed back to a customer
  });
};
