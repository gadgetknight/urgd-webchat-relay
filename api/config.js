// GET  /api/config           -> current settings (admin key required)
// POST /api/config { patch }  -> update settings (admin key required)
// Used by the control panel. Protected by the ADMIN_KEY env var.
'use strict';
const { sendJson, readBody, preflight } = require('../lib/http');
const { getSettings, saveSettings } = require('../lib/settings');

function authed(req) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return true; // no key set (local dev) -> open
  return (req.headers['x-admin-key'] || '') === key;
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;
  if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET') return sendJson(res, 200, await getSettings());
  if (req.method === 'POST') {
    const { json } = await readBody(req);
    const patch = json && typeof json === 'object' ? json : {};
    // Only allow known keys to be patched.
    const allowed = ['channelId', 'channelName', 'botName', 'greeting', 'waitingMessage',
      'timeoutSeconds', 'afterHoursAI', 'aiDraftToSlack', 'aiFallback', 'leadCapture', 'businessHours'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    return sendJson(res, 200, await saveSettings(clean));
  }
  return sendJson(res, 405, { error: 'GET or POST' });
};
