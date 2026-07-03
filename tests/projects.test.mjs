// Integration tests for the project-submission endpoint (POST /api/projects).
// Uses Node's built-in test runner (no extra deps): `node --test`.
//
// Each server is spawned from the compiled dist/server.js. The TEST_AUTH_BYPASS
// env var (honored only when NODE_ENV !== 'production') lets us exercise the
// auth-protected handler without going through GitHub OAuth.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');
const PROJECTS_PATH = path.resolve(__dirname, '../projects.json');

const AUTHED_PORT = 4101;
const UNAUTHED_PORT = 4102;
const AUTHED = `http://localhost:${AUTHED_PORT}`;
const UNAUTHED = `http://localhost:${UNAUTHED_PORT}`;

/** Spawn a server instance; resolve once it logs "running at". */
function startServer({ port, bypass }) {
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

    const proc = spawn(process.execPath, [SERVER], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`server on ${port} did not start in 5s. stderr:\n${stderr}`));
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

let authedProc;
let unauthedProc;
let savedProjects = null;

before(async () => {
  // Preserve any existing projects.json so tests don't clobber real data.
  if (fs.existsSync(PROJECTS_PATH)) savedProjects = fs.readFileSync(PROJECTS_PATH, 'utf-8');
  authedProc = await startServer({ port: AUTHED_PORT, bypass: 'tester' });
  unauthedProc = await startServer({ port: UNAUTHED_PORT });
});

after(() => {
  authedProc?.kill();
  unauthedProc?.kill();
  // Restore projects.json to its pre-test state.
  if (savedProjects !== null) fs.writeFileSync(PROJECTS_PATH, savedProjects);
  else if (fs.existsSync(PROJECTS_PATH)) fs.rmSync(PROJECTS_PATH);
});

// --- Auth ------------------------------------------------------------------

test('POST /api/projects without a session returns 401', async () => {
  const res = await fetch(`${UNAUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'octocat/Hello-World', url: 'https://example.com' }),
  });
  assert.equal(res.status, 401);
});

// --- Body validation (offline; GitHub is never reached) --------------------

test('empty-value JSON returns 400 with the field-required message', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: '', url: '' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /repo .* and url are required/);
});

test('missing url returns 400', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'octocat/Hello-World' }),
  });
  assert.equal(res.status, 400);
});

// Regression: a malformed/non-JSON body must NOT crash the server with a 500.
// This was the original bug — JSON.parse threw and the handler returned
// "Internal server error" instead of a clear 400.
test('malformed (non-JSON) body returns 400, not 500', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'this is not json',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /must be JSON/i);
});

// Regression: a native form submission sends application/x-www-form-urlencoded,
// which is not JSON. It must produce a clean 400, not a 500 crash.
test('urlencoded form body returns 400, not 500', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'repo=octocat/Hello-World&url=https://example.com',
  });
  assert.equal(res.status, 400);
});

test('empty body returns 400, not 500', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '',
  });
  assert.equal(res.status, 400);
});

// --- Listing ---------------------------------------------------------------

test('GET /api/projects returns a JSON array', async () => {
  const res = await fetch(`${AUTHED}/api/projects`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body));
});

// --- Happy path (hits the real GitHub API) ---------------------------------
// Tolerates GitHub rate-limiting (403) so the suite stays green offline / in CI
// without a token. When it does succeed, the created project shape is checked.

test('valid repo + url is accepted (201) or rate-limited (400)', async () => {
  const res = await fetch(`${AUTHED}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'octocat/Hello-World', url: 'https://example.com/demo' }),
  });
  assert.ok([201, 400].includes(res.status), `unexpected status ${res.status}`);
  const body = await res.json();
  if (res.status === 201) {
    assert.equal(body.repo, 'octocat/Hello-World');
    assert.equal(body.name, 'Hello-World');
    assert.equal(body.url, 'https://example.com/demo');
    assert.ok(body.id);
  } else {
    // Only acceptable 400 here is a GitHub rate-limit, not a validation failure.
    assert.match(body.error, /rate limit/i);
  }
});
