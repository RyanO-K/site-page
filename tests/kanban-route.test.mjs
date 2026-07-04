// Integration tests for the /kanban showcase route (a self-contained static page,
// no backend). Uses Node's built-in test runner: `node --test`.
//
// Spawns the compiled dist/server.js and asserts the trailing-slash form serves
// the board HTML (200) and the bare path 301-redirects to it — mirroring the
// stacker/snake routing.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4111;
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

test('GET /kanban/ returns 200 HTML with a recognizable board marker', async () => {
  const res = await fetch(`${BASE}/kanban/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /📋 Task Board/);      // real board's topbar treatment
  assert.match(html, /In Progress/);         // one of the four columns
});

test('GET /kanban 301-redirects to /kanban/', async () => {
  const res = await fetch(`${BASE}/kanban`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/kanban/');
});

test('GET /kanban/ serves the index (asset 404s stay clean)', async () => {
  const res = await fetch(`${BASE}/kanban/nope.js`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});
