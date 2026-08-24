// preview-summaries.js — local-only. Not an HTTP route. Not deployed.
// Pulls the 20 most recently listed Syncro tickets, writes raw public comments
// + generated summaries to preview-summaries.txt (gitignored).
//
// Version 1.2.0  2026-08-24
//
// CHANGELOG
// 1.2.0  2026-08-24  Initial preview of live comment → summary pairs.
//
// USAGE
//   node scripts/preview-summaries.js
'use strict';
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const k = m[1].trim();
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && !process.env[k]) process.env[k] = v;
    }
  } catch (_) {}
}

loadEnvFile(path.join(__dirname, '..', '.env'));

const syncro = require('../lib/syncro');
const { pickComment, summarise } = require('../lib/ticket-summary');

function latestComment(ticket) {
  const cs = (ticket && Array.isArray(ticket.comments)) ? ticket.comments.slice() : [];
  cs.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
  return cs[0] || null;
}

(async () => {
  if (!syncro.configured) {
    console.log('SYNCRO_SUBDOMAIN / SYNCRO_API_KEY not set. Stop.');
    process.exit(1);
  }
  const listed = await syncro.listTickets();
  if (!listed.ok || !listed.tickets.length) {
    console.log('Could not list tickets:', listed.error || 'empty');
    process.exit(1);
  }
  const batch = listed.tickets.slice(0, 20);
  const out = [];
  out.push('preview-summaries  ' + new Date().toISOString());
  out.push('tickets: ' + batch.length);
  out.push('');

  for (const stub of batch) {
    const det = stub.id ? await syncro.getTicket(stub.id) : { ok: false };
    const ticket = (det.ok && det.ticket) ? det.ticket : stub;
    const picked = pickComment(ticket);
    const newest = latestComment(ticket);
    const skippedInternal = Boolean(newest && newest.hidden === true);
    let summary = null;
    if (picked) summary = await summarise(picked.text, { showPrices: false });

    out.push('===== Ticket #' + ticket.number + '  status: ' + (ticket.status || '') + ' =====');
    out.push('SKIPPED_INTERNAL_LATEST: ' + (skippedInternal ? 'yes' : 'no'));
    out.push('RAW (latest customer-visible):');
    out.push(picked ? picked.text : '(none)');
    out.push('SUMMARY:');
    out.push(summary || '(none — status headline only)');
    out.push('');
    process.stdout.write('.');
  }

  const dest = path.join(__dirname, '..', 'preview-summaries.txt');
  fs.writeFileSync(dest, out.join('\n'), 'utf8');
  console.log('\nwrote ' + dest);
})().catch((e) => {
  console.log('preview failed:', e && e.message);
  process.exit(1);
});
