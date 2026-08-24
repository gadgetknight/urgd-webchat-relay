// redact.js — scrub PII from chat text before it's added to the vector DB.
// Mirrors the Python pipeline's approach: emails, 10+ digit numbers (phones/
// tracking/IMEI), and inline name introductions ("my name is X"). Chat users
// are mostly new prospects, so name-intro coverage matters more than a
// customer-name list.
'use strict';

const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const LONGNUM = /\+?\(?\d[\d\s().\-]{7,}\d/g;             // runs with >=10 digits
const NAME_INTRO = /\b(my name is|i am|i'?m|this is|it'?s|call me)\s+([A-Za-z][A-Za-z]+(?:\s+[A-Za-z][A-Za-z]+)?)/gi;

function redact(text) {
  if (!text) return '';
  text = text.replace(EMAIL, '[email]');
  text = text.replace(LONGNUM, function (m) {
    return (m.replace(/\D/g, '').length >= 10) ? '[phone]' : m;
  });
  // Only redact the introduced name when it's actually capitalized (a name),
  // so "I'm having trouble" keeps "having".
  text = text.replace(NAME_INTRO, function (full, intro, name) {
    return /^[A-Z]/.test(name) ? full.replace(name, '[name]') : full;
  });
  return text;
}

module.exports = { redact };
