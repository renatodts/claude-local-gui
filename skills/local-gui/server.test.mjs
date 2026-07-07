import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const SERVER = new URL('./server.mjs', import.meta.url).pathname;
const children = [];

after(() => { for (const c of children) c.kill('SIGKILL'); });

export async function waitFor(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('waitFor: timeout');
}

export async function startServer(extraArgs = [], initialState = { title: 'T', blocks: [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localgui-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(initialState));
  const child = spawn(process.execPath, [SERVER, '--dir', dir, '--port', '0', ...extraArgs]);
  children.push(child);
  await waitFor(() => fs.existsSync(path.join(dir, 'server.info')));
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'server.info'), 'utf8'));
  return { dir, child, info, base: `http://127.0.0.1:${info.port}` };
}

export async function readSse(url, count = 1, timeout = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const events = [];
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
        if (data) events.push(JSON.parse(data));
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return events;
}

test('starts, writes server.info with port and pid, serves shell', async () => {
  const { info, base, child } = await startServer();
  assert.equal(typeof info.port, 'number');
  assert.equal(info.pid, child.pid);
  assert.equal(info.url, base);
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<main id="app">/);
  assert.match(html, /id="banner"/);
  assert.match(html, /\/assets\/base\.css/);
  assert.match(html, /\/assets\/base\.js/);
});

test('serves assets and denies path traversal', async () => {
  const { base } = await startServer();
  const css = await fetch(base + '/assets/base.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(base + '/assets/base.js');
  assert.equal(js.status, 200);
  const evil = await fetch(base + '/assets/../server.mjs');
  assert.notEqual(evil.status, 200);
});

test('unknown route returns 404', async () => {
  const { base } = await startServer();
  const res = await fetch(base + '/nada');
  assert.equal(res.status, 404);
});

test('SSE sends initial state on connect', async () => {
  const { base } = await startServer([], { title: 'Initial', blocks: [] });
  const [ev] = await readSse(base + '/events', 1);
  assert.equal(ev.title, 'Initial');
});

test('change to state.json is pushed via SSE', async () => {
  const { base, dir } = await startServer([], { title: 'V1', blocks: [] });
  const eventsP = readSse(base + '/events', 2);
  await new Promise(r => setTimeout(r, 300)); // ensure connection before write
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ title: 'V2', blocks: [] }));
  const events = await eventsP;
  assert.equal(events[0].title, 'V1');
  assert.equal(events[1].title, 'V2');
});

test('invalid JSON is ignored; last good state remains', async () => {
  const { base, dir } = await startServer([], { title: 'Good', blocks: [] });
  fs.writeFileSync(path.join(dir, 'state.json'), '{broken');
  await new Promise(r => setTimeout(r, 300)); // > 100ms debounce
  const [ev] = await readSse(base + '/events', 1);
  assert.equal(ev.title, 'Good'); // server alive, good state preserved
});

test('POST /submit appends a line to inbox.jsonl', async () => {
  const { base, dir } = await startServer();
  const res = await fetch(base + '/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ block: 'confirm', kind: 'choice', value: 'yes' }),
  });
  assert.equal(res.status, 204);
  await fetch(base + '/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ block: 'data', kind: 'form', value: { amount: 2000 } }),
  });
  const lines = fs.readFileSync(path.join(dir, 'inbox.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.block, 'confirm');
  assert.equal(first.kind, 'choice');
  assert.equal(first.value, 'yes');
  assert.equal(typeof first.ts, 'number');
  assert.deepEqual(JSON.parse(lines[1]).value, { amount: 2000 });
});

test('POST /submit malformed returns 400 and does not write', async () => {
  const { base, dir } = await startServer();
  const bad1 = await fetch(base + '/submit', { method: 'POST', body: 'not json' });
  assert.equal(bad1.status, 400);
  const bad2 = await fetch(base + '/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'choice', value: 'x' }), // missing block
  });
  assert.equal(bad2.status, 400);
  assert.equal(fs.existsSync(path.join(dir, 'inbox.jsonl')), false);
});

test('POST /submit without content-type application/json returns 400 and does not write', async () => {
  const { base, dir } = await startServer();
  const res = await fetch(base + '/submit', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ block: 'x', kind: 'choice', value: 'v' }),
  });
  assert.equal(res.status, 400);
  assert.equal(fs.existsSync(path.join(dir, 'inbox.jsonl')), false);
});

function rawRequest(base, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: opts.path ?? '/',
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

test('forged Host header is rejected with 403', async () => {
  const { base } = await startServer();
  const res = await rawRequest(base, { path: '/', headers: { Host: 'evil.example' } });
  assert.equal(res.status, 403);
});

test('correct Host header (127.0.0.1:port) is accepted', async () => {
  const { base, info } = await startServer();
  const res = await rawRequest(base, { path: '/', headers: { Host: `127.0.0.1:${info.port}` } });
  assert.equal(res.status, 200);
});

test('invalid --port exits with code 2 quickly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localgui-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ title: 'T', blocks: [] }));
  const child = spawn(process.execPath, [SERVER, '--dir', dir, '--port', 'abc']);
  children.push(child);
  const code = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for process exit')), 3000);
    child.on('exit', c => { clearTimeout(t); resolve(c); });
  });
  assert.equal(code, 2);
});

test('idle-timeout shuts down the server with no clients', async () => {
  const { child } = await startServer(['--idle-timeout', '1']);
  const code = await new Promise(resolve => {
    const t = setTimeout(() => resolve('TIMEOUT'), 5000);
    child.on('exit', c => { clearTimeout(t); resolve(c); });
  });
  assert.equal(code, 0);
});

test('page.html replaces the content and sets __customPage', async () => {
  const { base, dir } = await startServer();
  fs.writeFileSync(path.join(dir, 'page.html'), '<h2 id="custom">My page</h2>');
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<h2 id="custom">My page<\/h2>/);
  assert.match(html, /window\.__customPage = true/);
});

test('without page.html does not set __customPage', async () => {
  const { base } = await startServer();
  const html = await (await fetch(base + '/')).text();
  assert.doesNotMatch(html, /__customPage/);
});
