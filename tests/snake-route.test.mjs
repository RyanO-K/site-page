// Integration tests for the /snake game route. Uses Node's built-in test
// runner: `node --test`.
//
// Snake is hosted here as a route of this site (migrated off its own Railway
// host at snake.okeefe.work, which went dead). Unlike /kanban and /discord it
// has a real backend — the scoreboard at /snake/api/scores — so this covers
// both the static page and the API.
//
// The bare-path 301 is the specific regression this locks: /snake/ served 200
// while /snake 404'd, out of step with every sibling route.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4113;
const BASE = `http://localhost:${PORT}`;

/** Spawn a server instance; resolve once it logs "running at". */
function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: 'test-id',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER: 'tester',
    };
    const proc = spawn(process.execPath, [SERVER], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`server on ${PORT} did not start in 5s. stderr:\n${stderr}`));
    }, 5000);
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('running at')) { clearTimeout(timer); resolve(proc); }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

let proc;
before(async () => { proc = await startServer(); });
after(() => { proc?.kill(); });

test('GET /snake/ returns 200 HTML with the game canvas', async () => {
  const res = await fetch(`${BASE}/snake/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /id="game-canvas"/);
  assert.match(html, /data-testid="start-btn"/);
});

test('GET /snake 301-redirects to /snake/', async () => {
  const res = await fetch(`${BASE}/snake`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/snake/');
});

test('GET /snake/bundle.js serves the game bundle as JavaScript', async () => {
  const res = await fetch(`${BASE}/snake/bundle.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});

// The bundle must call the API relatively so it resolves under /snake/. An
// absolute origin (e.g. http://localhost:3000/api/scores) works on a dev box
// but points at the visitor's own machine once deployed — that shipped once
// already on the standalone host.
test('the served bundle uses a relative scores url, not an absolute origin', async () => {
  const res = await fetch(`${BASE}/snake/bundle.js`);
  const js = await res.text();
  assert.ok(js.includes('api/scores'), 'bundle should reference the scores API');
  assert.doesNotMatch(
    js,
    /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/scores/,
    'bundle must not hardcode an absolute localhost scores url',
  );
});

test('GET /snake/api/scores returns a scoreboard', async () => {
  const res = await fetch(`${BASE}/snake/api/scores`);
  assert.equal(res.status, 200);
  const board = await res.json();
  assert.ok(Array.isArray(board.entries), 'entries should be an array');
  assert.equal(typeof board.highScore, 'number');
});

test('POST /snake/api/scores persists an entry and returns the updated board', async () => {
  const entry = { initials: 'ZZZ', score: 999999, timestamp: 1_700_000_000_000 };
  const res = await fetch(`${BASE}/snake/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  assert.equal(res.status, 200);
  const board = await res.json();
  // A 999999 score outranks anything real, so it must land at the top.
  assert.equal(board.entries[0].initials, 'ZZZ');
  assert.equal(board.highScore, 999999);
});

test('GET /snake/ asset 404s stay clean', async () => {
  const res = await fetch(`${BASE}/snake/nope.js`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});
