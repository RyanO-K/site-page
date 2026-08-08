// Integration tests for the /board reverse proxy (kanban-cloud shared board).
// Uses Node's built-in test runner: `node --test`.
//
// The upstream is stubbed with a throwaway in-process http server that records
// every request it receives (method, path, headers, body). Four site-server
// instances are spawned from the compiled dist/server.js:
//   - authed:       TEST_AUTH_BYPASS set → getSessionUser returns "tester"
//   - unauthed:     no bypass → spectator
//   - unconfigured: KANBAN_CLOUD_* env unset → 503
//   - deadUpstream: KANBAN_CLOUD_URL points at a closed port → 502

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const AUTHED_PORT = 4141;
const UNAUTHED_PORT = 4142;
const UNCONFIGURED_PORT = 4143;
const DEAD_UPSTREAM_PORT = 4144;
const STUB_PORT = 4145;
const CLOSED_PORT = 4146; // nothing listens here

const AUTHED = `http://localhost:${AUTHED_PORT}`;
const UNAUTHED = `http://localhost:${UNAUTHED_PORT}`;
const UNCONFIGURED = `http://localhost:${UNCONFIGURED_PORT}`;
const DEAD_UPSTREAM = `http://localhost:${DEAD_UPSTREAM_PORT}`;

const SECRET = 'test-proxy-secret';

/** Requests the stub upstream has received, in order. */
const seen = [];

function startStub() {
  return new Promise(resolve => {
    const stub = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Stub': 'yes' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    stub.listen(STUB_PORT, () => resolve(stub));
  });
}

/** Spawn a site server instance; resolve once it logs "running at". */
function startServer({ port, bypass, kanbanEnv = true, upstream = `http://localhost:${STUB_PORT}` }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: 'test-id',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER: 'tester',
    };
    if (bypass) env.TEST_AUTH_BYPASS = bypass;
    else delete env.TEST_AUTH_BYPASS;
    if (kanbanEnv) {
      env.KANBAN_CLOUD_URL = upstream;
      env.KANBAN_CLOUD_SECRET = SECRET;
    } else {
      delete env.KANBAN_CLOUD_URL;
      delete env.KANBAN_CLOUD_SECRET;
    }

    const proc = spawn(process.execPath, [SERVER], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`server on ${port} did not start in 5s. stderr:\n${stderr}`));
    }, 5000);
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('running at')) { clearTimeout(timer); resolve(proc); }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** fetch() normalizes dot-dot segments away, so traversal probes go raw. */
function rawRequest(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, path: rawPath, method }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

let stub, authedProc, unauthedProc, unconfiguredProc, deadUpstreamProc;

before(async () => {
  stub = await startStub();
  [authedProc, unauthedProc, unconfiguredProc, deadUpstreamProc] = await Promise.all([
    startServer({ port: AUTHED_PORT, bypass: 'tester' }),
    startServer({ port: UNAUTHED_PORT }),
    startServer({ port: UNCONFIGURED_PORT, kanbanEnv: false }),
    startServer({ port: DEAD_UPSTREAM_PORT, upstream: `http://localhost:${CLOSED_PORT}` }),
  ]);
});

after(() => {
  authedProc?.kill();
  unauthedProc?.kill();
  unconfiguredProc?.kill();
  deadUpstreamProc?.kill();
  stub?.close();
});

// --- Redirect --------------------------------------------------------------

test('bare /board 301-redirects to /board/', async () => {
  const res = await fetch(`${UNAUTHED}/board`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/board/');
});

// --- Spectator (logged-out) ------------------------------------------------

test('logged-out GET /board/ proxies read-only: secret + readonly, no user, cookies stripped', async () => {
  const res = await fetch(`${UNAUTHED}/board/`, {
    headers: { Cookie: 'session=abc123deadbeef', 'X-Proxy-User': 'spoofed' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-stub'), 'yes'); // upstream response headers pass through

  const r = seen.at(-1);
  assert.equal(r.method, 'GET');
  assert.equal(r.url, '/');                                // /board/ → /
  assert.equal(r.headers['x-proxy-secret'], SECRET);
  assert.equal(r.headers['x-proxy-readonly'], '1');
  assert.equal(r.headers['x-proxy-user'], undefined);      // no user header
  assert.equal(r.headers.cookie, undefined);               // site cookies never forwarded
});

test('logged-out POST /board/... is 401 and never reaches the upstream', async () => {
  const countBefore = seen.length;
  const res = await fetch(`${UNAUTHED}/board/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'nope' }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /log in/i);
  assert.equal(seen.length, countBefore);
});

// --- Owner (logged-in) -----------------------------------------------------

test('logged-in GET carries X-Proxy-User + secret, no readonly; path and query rewritten', async () => {
  const res = await fetch(`${AUTHED}/board/api/tickets?board=main&status=todo`, {
    headers: { Cookie: 'session=abc123deadbeef' },
  });
  assert.equal(res.status, 200);

  const r = seen.at(-1);
  assert.equal(r.url, '/api/tickets?board=main&status=todo');
  assert.equal(r.headers['x-proxy-secret'], SECRET);
  assert.equal(r.headers['x-proxy-user'], 'tester');
  assert.equal(r.headers['x-proxy-readonly'], undefined);
  assert.equal(r.headers.cookie, undefined);
});

test('logged-in POST streams the body through with its content headers', async () => {
  const payload = JSON.stringify({ title: 'new ticket', status: 'todo' });
  const res = await fetch(`${AUTHED}/board/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.equal(res.status, 200);

  const r = seen.at(-1);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, '/api/tickets');
  assert.equal(r.body, payload);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(r.headers['x-proxy-user'], 'tester');
});

// --- Hardening -------------------------------------------------------------

test('dot-dot traversal under /board/ is 404 and never reaches the upstream', async () => {
  const countBefore = seen.length;
  assert.equal(await rawRequest(AUTHED_PORT, '/board/../api/me'), 404);
  assert.equal(await rawRequest(AUTHED_PORT, '/board/%2e%2e/api/me'), 404);
  assert.equal(seen.length, countBefore);
});

// --- Failure modes ---------------------------------------------------------

test('503 with a friendly message when KANBAN_CLOUD_* env is unset', async () => {
  const res = await fetch(`${UNCONFIGURED}/board/`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /not configured/i);
});

test('502 when the upstream is unreachable', async () => {
  const res = await fetch(`${DEAD_UPSTREAM}/board/`);
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /unreachable/i);
});
