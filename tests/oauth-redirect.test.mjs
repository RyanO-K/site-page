// Tests for the GitHub OAuth authorize redirect (GET /auth/github).
//
// Regression for ticket #3: the authorize URL must send an explicit
// `redirect_uri` derived from BASE_URL, instead of relying on the callback
// URL registered on the GitHub OAuth app. This keeps login domain-portable
// across onrender.com and okeefe.work — set BASE_URL and the same origin's
// /auth/callback on the app's allowlist, and login round-trips correctly.
//
// Uses Node's built-in test runner (no extra deps): `node --test`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4103;
const BASE_URL = 'https://portfolio-nifj.onrender.com';
const ORIGIN = `http://localhost:${PORT}`;

/** Spawn a server instance with an explicit BASE_URL; resolve once it logs "running at". */
function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      BASE_URL,
      GITHUB_CLIENT_ID: 'test-id',
      GITHUB_CLIENT_SECRET: 'test-secret',
      GITHUB_OWNER: 'tester',
    };
    delete env.TEST_AUTH_BYPASS;

    const proc = spawn(process.execPath, [SERVER], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`server on ${PORT} did not start in 5s. stderr:\n${stderr}`));
    }, 5000);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes('running at')) {
        clearTimeout(timer);
        resolve(proc);
      }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

let proc;

before(async () => { proc = await startServer(); });
after(() => { proc?.kill(); });

test('GET /auth/github redirects to GitHub authorize with an explicit redirect_uri from BASE_URL', async () => {
  const res = await fetch(`${ORIGIN}/auth/github`, { redirect: 'manual' });
  assert.equal(res.status, 302);

  const location = res.headers.get('location');
  assert.ok(location, 'expected a Location header');

  const url = new URL(location);
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'test-id');
  assert.equal(url.searchParams.get('scope'), 'read:user');
  assert.ok(url.searchParams.get('state'), 'expected a state param');

  // The core assertion for ticket #3: the callback is sent explicitly and is
  // BASE_URL-derived, so login no longer depends on the app's registered callback.
  assert.equal(url.searchParams.get('redirect_uri'), `${BASE_URL}/auth/callback`);
});
