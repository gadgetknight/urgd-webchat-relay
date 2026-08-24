// widget.js — UR Gadget Doctors website chat widget (self-contained, no deps).
// Rendered inside a Shadow DOM so the host site's theme CSS can't touch it.
// Embed:
//   <script>window.URGDChat={relayUrl:'https://YOUR-RELAY.vercel.app',botName:'UR Gadget Doctors'}</script>
//   <script src="https://YOUR-RELAY.vercel.app/widget.js" defer></script>
// Optional config: color (brand hex), greeting, leadCapture:false.
(function () {
  'use strict';
  var CFG = window.URGDChat || {};
  var RELAY = (CFG.relayUrl || '').replace(/\/$/, '');
  var api = function (p) { return RELAY + p; };
  var GREETING = CFG.greeting || "Hi! Ask us anything about a repair — a real technician will answer in a moment.";
  var COLOR = CFG.color || '#d6283b';           // brand red (override via URGDChat.color)
  var NAME = CFG.botName || 'UR Gadget Doctors';

  var sid = localStorage.getItem('urgd_sid');
  if (!sid) { sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('urgd_sid', sid); }

  // ---- host + shadow root (full isolation from the site theme) ----
  var host = document.createElement('div');
  host.id = 'urgd-chat-host';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var chatIcon = '<svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><path d="M12 3C6.48 3 2 6.94 2 11.5c0 2.28 1.13 4.33 2.97 5.79-.14 1.03-.5 2.2-1.2 3.21-.16.23.02.55.3.5 1.66-.29 3.02-.86 4.02-1.46 1.2.42 2.52.66 3.91.66 5.52 0 10-3.94 10-8.7S17.52 3 12 3zM7.5 12.75a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm4.5 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm4.5 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"/></svg>';
  var sendIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"><path d="M3 20.5l18-8.5L3 3.5v6.7l12 1.8-12 1.8z"/></svg>';

  var css =
  ':host{all:initial}' +
  '*{box-sizing:border-box;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:0}' +
  '.btn{position:fixed;right:20px;bottom:20px;width:62px;height:62px;border-radius:50%;background:' + COLOR + ';border:none;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center}' +
  '.btn:hover{filter:brightness(1.06)}' +
  '.panel{position:fixed;right:20px;bottom:96px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 130px);background:#fff;border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.30);display:none;flex-direction:column;overflow:hidden;z-index:2147483000}' +
  '.open .panel{display:flex}' +
  '.hd{background:' + COLOR + ';color:#fff;padding:15px 16px;font-weight:700;font-size:16px}' +
  '.hd small{display:block;font-weight:400;opacity:.9;font-size:12px;margin-top:2px}' +
  '.msgs{flex:1;overflow-y:auto;padding:14px;background:#f5f6f8}' +
  '.msg{margin:8px 0;max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
  '.them{background:#fff;border:1px solid #e4e7eb;color:#1a1a1a}' +
  '.me{background:' + COLOR + ';color:#fff;margin-left:auto}' +
  '.note{font-size:12px;color:#6b7280;text-align:center;margin:8px 0}' +
  '.inrow{display:flex;align-items:center;border-top:1px solid #e4e7eb;padding:8px;background:#fff}' +
  '.inrow input{flex:1;border:none;padding:10px;font-size:14px;outline:none;color:#111;background:#fff}' +
  '.send{background:' + COLOR + ';border:none;border-radius:9px;padding:9px 12px;cursor:pointer;display:flex;align-items:center}' +
  '.lead{background:#fff;border-top:1px solid #e4e7eb;padding:11px;font-size:13px;color:#111}' +
  '.lead input{width:100%;border:1px solid #d0d7de;border-radius:7px;padding:9px;margin:5px 0;font-size:13px;color:#111;background:#fff}' +
  '.lead button{width:100%;background:#1a7f37;color:#fff;border:none;border-radius:7px;padding:10px;cursor:pointer;font-size:14px}' +
  '.dots span{display:inline-block;width:6px;height:6px;margin:0 2px;background:#9aa4b2;border-radius:50%;animation:b 1s infinite}' +
  '.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}' +
  '@keyframes b{0%,60%,100%{opacity:.3}30%{opacity:1}}';

  var wrap = document.createElement('div');
  wrap.className = 'ui';
  wrap.innerHTML =
    '<style>' + css + '</style>' +
    '<button class="btn" aria-label="Chat with us">' + chatIcon + '</button>' +
    '<div class="panel">' +
      '<div class="hd">' + NAME + '<small>Ask about any repair</small></div>' +
      '<div class="msgs"></div>' +
      '<div class="leadwrap"></div>' +
      '<div class="inrow"><input type="text" placeholder="Type your question…"/><button class="send" aria-label="Send">' + sendIcon + '</button></div>' +
    '</div>';
  root.appendChild(wrap);

  var btn = root.querySelector('.btn');
  var msgs = root.querySelector('.msgs');
  var leadwrap = root.querySelector('.leadwrap');
  var input = root.querySelector('.inrow input');
  var sendBtn = root.querySelector('.send');

  var asked = false, polling = null;
  function bubble(t, who) { var d = document.createElement('div'); d.className = 'msg ' + (who === 'me' ? 'me' : 'them'); d.textContent = t; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
  function note(t) { var d = document.createElement('div'); d.className = 'note'; d.textContent = t; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
  function typing() { var d = document.createElement('div'); d.className = 'msg them dots'; d.innerHTML = '<span></span><span></span><span></span>'; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }

  btn.addEventListener('click', function () {
    wrap.classList.toggle('open');
    if (wrap.classList.contains('open') && !msgs.children.length) bubble(GREETING, 'them');
  });

  function send() {
    var q = input.value.trim(); if (!q) return; input.value = '';
    bubble(q, 'me');
    var t = typing();
    fetch(api('/api/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, question: q }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        t.remove();
        if (d.status === 'answered') bubble(d.answer, 'them');
        else { note(d.message || 'A technician is answering…'); startPoll(); }
        if (!asked) { asked = true; showLead(); }
      })
      .catch(function () { t.remove(); bubble("Sorry — something went wrong. Please call us and we'll help right away.", 'them'); });
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  function startPoll() {
    if (polling) return; var tries = 0;
    polling = setInterval(function () {
      tries++;
      fetch(api('/api/poll?sessionId=' + encodeURIComponent(sid))).then(function (r) { return r.json(); }).then(function (d) {
        if (d.status === 'answered') { clearInterval(polling); polling = null; bubble(d.answer, 'them'); }
        else if (tries > 120) { clearInterval(polling); polling = null; }
      }).catch(function () {});
    }, 5000);
  }

  function showLead() {
    if (CFG.leadCapture === false) return;
    leadwrap.innerHTML =
      '<div class="lead"><div>📱 Want a follow-up? Leave your info:</div>' +
      '<input class="ln" placeholder="Your name"/>' +
      '<input class="lc" placeholder="Phone or email"/>' +
      '<button>Send my info</button></div>';
    leadwrap.querySelector('button').addEventListener('click', function () {
      var name = leadwrap.querySelector('.ln').value.trim();
      var contact = leadwrap.querySelector('.lc').value.trim();
      if (!name && !contact) return;
      fetch(api('/api/lead'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, name: name, contact: contact }) }).catch(function () {});
      leadwrap.innerHTML = "<div class='lead'>✅ Thanks! We'll be in touch.</div>";
      setTimeout(function () { leadwrap.innerHTML = ''; }, 4000);
    });
  }
})();
