// widget.js — UR Gadget Doctors website chat widget (self-contained, no deps).
// Embed with:
//   <script>window.URGDChat={relayUrl:'https://YOUR-RELAY.vercel.app'}</script>
//   <script src="https://YOUR-RELAY.vercel.app/widget.js" defer></script>
// A real technician answers via Slack; if they're tied up, the AI answers.
(function () {
  'use strict';
  var CFG = window.URGDChat || {};
  var RELAY = (CFG.relayUrl || '').replace(/\/$/, ''); // same-origin if blank
  var api = function (p) { return RELAY + p; };
  var GREETING = CFG.greeting || "Hi! Ask us anything about a repair — a real technician will answer in a moment.";

  // ---- session id ----
  var sid = localStorage.getItem('urgd_sid');
  if (!sid) { sid = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('urgd_sid', sid); }

  // ---- styles ----
  var css = `
  .urgd-btn{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;background:#1f6feb;color:#fff;border:none;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;font-size:26px;z-index:2147483000}
  .urgd-panel{position:fixed;right:20px;bottom:92px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .urgd-open .urgd-panel{display:flex}
  .urgd-hd{background:#1f6feb;color:#fff;padding:14px 16px;font-weight:600}
  .urgd-hd small{display:block;font-weight:400;opacity:.85;font-size:12px;margin-top:2px}
  .urgd-msgs{flex:1;overflow-y:auto;padding:14px;background:#f6f8fa}
  .urgd-msg{margin:8px 0;max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}
  .urgd-them{background:#fff;border:1px solid #e2e6ea;color:#1a1a1a}
  .urgd-me{background:#1f6feb;color:#fff;margin-left:auto}
  .urgd-note{font-size:12px;color:#6a737d;text-align:center;margin:6px 0}
  .urgd-in{display:flex;border-top:1px solid #e2e6ea;padding:8px}
  .urgd-in input{flex:1;border:none;padding:10px;font-size:14px;outline:none}
  .urgd-in button{background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:0 14px;cursor:pointer;font-size:16px}
  .urgd-lead{background:#fff;border-top:1px solid #e2e6ea;padding:10px;font-size:13px}
  .urgd-lead input{width:100%;box-sizing:border-box;border:1px solid #d0d7de;border-radius:6px;padding:7px;margin:4px 0;font-size:13px}
  .urgd-lead button{width:100%;background:#1a7f37;color:#fff;border:none;border-radius:6px;padding:8px;cursor:pointer}
  .urgd-dots span{display:inline-block;width:6px;height:6px;margin:0 2px;background:#8b949e;border-radius:50%;animation:urgdb 1s infinite}
  .urgd-dots span:nth-child(2){animation-delay:.2s}.urgd-dots span:nth-child(3){animation-delay:.4s}
  @keyframes urgdb{0%,60%,100%{opacity:.3}30%{opacity:1}}`;
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---- dom ----
  var root = document.createElement('div');
  root.innerHTML =
    '<button class="urgd-btn" aria-label="Chat">💬</button>' +
    '<div class="urgd-panel">' +
      '<div class="urgd-hd">' + (CFG.botName || 'UR Gadget Doctors') + '<small>Ask about any repair</small></div>' +
      '<div class="urgd-msgs"></div>' +
      '<div class="urgd-leadwrap"></div>' +
      '<div class="urgd-in"><input type="text" placeholder="Type your question…"/><button>➤</button></div>' +
    '</div>';
  document.body.appendChild(root);

  var btn = root.querySelector('.urgd-btn');
  var panel = root.querySelector('.urgd-panel');
  var msgs = root.querySelector('.urgd-msgs');
  var leadwrap = root.querySelector('.urgd-leadwrap');
  var input = root.querySelector('.urgd-in input');
  var sendBtn = root.querySelector('.urgd-in button');

  var asked = false, polling = null;
  function bubble(text, who) { var d = document.createElement('div'); d.className = 'urgd-msg ' + (who === 'me' ? 'urgd-me' : 'urgd-them'); d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
  function note(text) { var d = document.createElement('div'); d.className = 'urgd-note'; d.textContent = text; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }
  function typing() { var d = document.createElement('div'); d.className = 'urgd-msg urgd-them urgd-dots'; d.innerHTML = '<span></span><span></span><span></span>'; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; }

  btn.addEventListener('click', function () {
    root.classList.toggle('urgd-open');
    if (root.classList.contains('urgd-open') && !msgs.children.length) bubble(GREETING, 'them');
  });

  function send() {
    var q = input.value.trim(); if (!q) return; input.value = '';
    bubble(q, 'me');
    var t = typing();
    fetch(api('/api/ask'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, question: q }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        t.remove();
        if (d.status === 'answered') { bubble(d.answer, 'them'); }
        else { note(d.message || 'A technician is answering…'); startPoll(); }
        if (!asked) { asked = true; showLead(); }
      })
      .catch(function () { t.remove(); bubble('Sorry — something went wrong. Please call us and we\'ll help right away.', 'them'); });
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
    }, 3000);
  }

  function showLead() {
    if (CFG.leadCapture === false) return;
    leadwrap.innerHTML =
      '<div class="urgd-lead"><div>📱 Want us to follow up? Leave your info:</div>' +
      '<input class="urgd-ln" placeholder="Your name"/>' +
      '<input class="urgd-lc" placeholder="Phone or email"/>' +
      '<button>Send my info</button></div>';
    leadwrap.querySelector('button').addEventListener('click', function () {
      var name = leadwrap.querySelector('.urgd-ln').value.trim();
      var contact = leadwrap.querySelector('.urgd-lc').value.trim();
      if (!name && !contact) return;
      fetch(api('/api/lead'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sid, name: name, contact: contact }) }).catch(function () {});
      leadwrap.innerHTML = '<div class="urgd-lead">✅ Thanks! We\'ll be in touch.</div>';
      setTimeout(function () { leadwrap.innerHTML = ''; }, 4000);
    });
  }
})();
