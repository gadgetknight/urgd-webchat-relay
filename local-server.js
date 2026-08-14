// local-server.js — run the relay locally for testing (no Vercel needed).
//   node local-server.js
// Serves the API handlers in ./api and static files in ./public.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const routes = {
  '/api/ask': require('./api/ask'),
  '/api/poll': require('./api/poll'),
  '/api/slack/events': require('./api/slack/events'),
  '/api/config': require('./api/config'),
  '/api/lead': require('./api/lead'),
  '/api/conversations': require('./api/conversations'),
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  const handler = routes[pathname];
  if (handler) return handler(req, res);

  // static
  let file = pathname === '/' ? '/embed.html' : pathname;
  const full = path.join(__dirname, 'public', file);
  if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full)) {
    res.setHeader('Content-Type', MIME[path.extname(full)] || 'text/plain');
    return fs.createReadStream(full).pipe(res);
  }
  res.statusCode = 404; res.end('not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`webchat-relay local server on http://localhost:${port}`));
