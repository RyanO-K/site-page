// Integration tests for /p/<id>, the iframe shell for separately-hosted projects.
//
// One static shell serves every project id: it reads the id from the url and
// resolves the embed target from /api/projects at runtime, so adding a project
// is a database row rather than a deploy. These tests cover the server side of
// that contract — the shell is served for any id, unknown ids included (the
// client renders the not-found state), and the bare /p redirects home.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4115;
const BASE = `http://localhost:${PORT}`;

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

test('GET /p/<id> serves the embed shell', async () => {
  const res = await fetch(`${BASE}/p/03afcb9529a78219`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /id="embed-frame"/);
  assert.match(html, /project\/embed\.js/);
});

test('the shell ships no project data — the id is resolved client-side', async () => {
  // The same bytes must serve every project; baking a project list into the
  // shell would put us back to redeploying for a database change.
  const res = await fetch(`${BASE}/p/03afcb9529a78219`);
  const html = await res.text();
  assert.doesNotMatch(html, /03afcb9529a78219/);
});

test('an unknown id still serves the shell (client renders not-found)', async () => {
  const res = await fetch(`${BASE}/p/does-not-exist`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /id="embed-frame"/);
});

test('GET /p redirects to the projects section', async () => {
  const res = await fetch(`${BASE}/p`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#projects');
});

test('GET /p/ redirects to the projects section', async () => {
  const res = await fetch(`${BASE}/p/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/#projects');
});

test('the embed script is served as JavaScript', async () => {
  const res = await fetch(`${BASE}/project/embed.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});

// Not every project row is separately hosted: /kanban and /discord are pages of
// this site, and one row points at the site itself. Framing those would nest
// okeefe.work inside okeefe.work, so the shell navigates instead of embedding.
test('the embed shell redirects same-origin targets instead of framing them', async () => {
  const res = await fetch(`${BASE}/project/embed.js`);
  const js = await res.text();
  assert.match(js, /target\.origin === window\.location\.origin/);
  assert.match(js, /location\.replace/);
});

test('the embed shell keeps the frame hidden until load', async () => {
  // The cold-start status panel is the whole point of the shell: a bare iframe
  // pointed at a sleeping free instance is a blank white box for 12-50s.
  const res = await fetch(`${BASE}/project/embed.js`);
  const js = await res.text();
  assert.match(js, /addEventListener\('load'/);
  assert.match(js, /ready/);
});
