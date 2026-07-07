#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    port: { type: 'string', default: '0' },
    'idle-timeout': { type: 'string', default: '1800' },
  },
});

const USAGE = 'usage: node server.mjs --dir <workdir> [--port N] [--idle-timeout seconds]';

if (!args.dir) {
  console.error(USAGE);
  process.exit(2);
}

const portNum = Number(args.port);
if (!Number.isInteger(portNum) || portNum < 0) {
  console.error(USAGE);
  process.exit(2);
}

const idleTimeoutNum = Number(args['idle-timeout']);
if (!Number.isFinite(idleTimeoutNum) || idleTimeoutNum <= 0) {
  console.error(USAGE);
  process.exit(2);
}

const DIR = path.resolve(args.dir);
const ASSETS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets');
const IDLE_MS = idleTimeoutNum * 1000;
fs.mkdirSync(DIR, { recursive: true });

function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

let state = readState() ?? { title: 'local-gui', blocks: [] };
let lastActivity = Date.now();

const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) res.write(payload);
}

let watchDebounce = null;
fs.watch(DIR, (_event, filename) => {
  if (filename !== 'state.json') return;
  clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => {
    const next = readState();
    if (next !== null) {
      state = next;
      broadcast();
    }
  }, 100);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shell() {
  let custom = null;
  try {
    custom = fs.readFileSync(path.join(DIR, 'page.html'), 'utf8');
  } catch {}
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(state.title ?? 'local-gui')}</title>
<link rel="stylesheet" href="/assets/base.css">
</head>
<body>
<div id="banner" hidden>connection lost — reconnecting…</div>
<main id="app">${custom ?? ''}</main>
${custom !== null ? '<script>window.__customPage = true</script>' : ''}
<script src="/assets/base.js"></script>
</body>
</html>`;
}

const ASSET_TYPES = { 'base.css': 'text/css; charset=utf-8', 'base.js': 'text/javascript; charset=utf-8' };

function serveAsset(res, name) {
  if (!Object.hasOwn(ASSET_TYPES, name)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': ASSET_TYPES[name] });
  res.end(fs.readFileSync(path.join(ASSETS_DIR, name)));
}

const server = http.createServer((req, res) => {
  lastActivity = Date.now();
  const boundPort = server.address()?.port;
  const hostHeader = req.headers.host;
  if (
    hostHeader &&
    boundPort != null &&
    hostHeader !== `127.0.0.1:${boundPort}` &&
    hostHeader !== `localhost:${boundPort}`
  ) {
    res.writeHead(403);
    res.end();
    req.resume();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell());
  } else if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    req.on('close', () => {
      clients.delete(res);
      lastActivity = Date.now();
    });
  } else if (req.method === 'POST' && url.pathname === '/submit') {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.startsWith('application/json')) {
      res.writeHead(400);
      res.end();
      req.resume();
      return;
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('error', () => {});
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        if (typeof msg.block !== 'string' || typeof msg.kind !== 'string' || !('value' in msg)) {
          throw new Error('invalid payload');
        }
        const line = JSON.stringify({ ts: Date.now(), block: msg.block, kind: msg.kind, value: msg.value });
        fs.appendFileSync(path.join(DIR, 'inbox.jsonl'), line + '\n');
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  } else if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
    serveAsset(res, url.pathname.slice('/assets/'.length));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(portNum, '127.0.0.1', () => {
  const { port } = server.address();
  const info = { port, pid: process.pid, url: `http://127.0.0.1:${port}` };
  fs.writeFileSync(path.join(DIR, 'server.info'), JSON.stringify(info));
  console.log(`LISTENING ${port}`);
});

const IDLE_CHECK_MS = Math.min(15_000, Math.max(250, IDLE_MS / 4));
setInterval(() => {
  if (clients.size === 0 && Date.now() - lastActivity > IDLE_MS) {
    process.exit(0);
  }
}, IDLE_CHECK_MS).unref();
