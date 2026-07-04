// Integration tests for the /discord showcase route (a self-contained static
// Discord UI mockup of the discord-kanban-bot, no backend). Uses Node's built-in
// test runner: `node --test`.
//
// Spawns the compiled dist/server.js and asserts the trailing-slash form serves
// the mockup HTML (200) and the bare path 301-redirects to it — mirroring the
// kanban/stacker/snake routing.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4112;
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

test('GET /discord/ returns 200 HTML with a recognizable Discord marker', async () => {
  const res = await fetch(`${BASE}/discord/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /Discord Kanban Bot/);   // page title
  assert.match(html, /Kanban Mirror/);          // the bot's app name in the mockup
  assert.match(html, /\/status/);               // a real slash command in the palette
});

test('GET /discord 301-redirects to /discord/', async () => {
  const res = await fetch(`${BASE}/discord`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/discord/');
});

test('GET /discord/ serves the index (asset 404s stay clean)', async () => {
  const res = await fetch(`${BASE}/discord/nope.js`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});
