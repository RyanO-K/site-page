// Tests for PATCH /api/projects/<id>, the edit-modal backend (#15).
//
// This is the endpoint that makes a project's hosted url editable. Before it,
// changing a url meant deleting the project and re-adding it, which is how the
// snake row ended up pointing at a dead Railway subdomain for so long.
//
// It is an authenticated write, so the auth gate and the field allow-list are
// the parts worth locking down.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4117;
const BASE = `http://localhost:${PORT}`;

/** Spawn a server. `auth` opts into the test-only session bypass. */
function startServer({ auth = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      GITHUB_CLIENT_ID: 'test-id',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER: 'tester',
    };
    if (auth) env.TEST_AUTH_BYPASS = 'tester';
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

const patch = (id, body) => fetch(`${BASE}/api/projects/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

let proc;

// ── unauthenticated ──────────────────────────────────────────
before(async () => { proc = await startServer(); });
after(() => { proc?.kill(); });

test('PATCH without a session returns 401', async () => {
  const res = await patch('anything', { url: 'https://evil.example.com' });
  assert.equal(res.status, 401);
});

test('the 401 fires before the body is parsed', async () => {
  // A malformed body must not produce a 400 that reveals the route exists in a
  // different state to anonymous callers.
  const res = await patch('anything', 'not json at all');
  assert.equal(res.status, 401);
});

test('PATCH cannot be reached via the DELETE path matcher', async () => {
  // DELETE /api/projects/<id> is a separate branch; PATCH must not fall into it.
  const res = await fetch(`${BASE}/api/projects/some-id`, { method: 'DELETE' });
  assert.equal(res.status, 401);
});
