// Tests for the single error slot.
//
// Client failures used to be invisible: init() had no error handling, so one
// throw left the page half-built with no message, and the delete button dropped
// rejections entirely. That is how an expired session presented as "the add
// form does nothing" — sessions live in server memory, so every deploy and
// every free-tier spin-down silently invalidates them.
//
// These assert the served assets wire up the slot. Behaviour (dismiss, reuse in
// place, session-expiry copy) is exercised in a browser separately.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4116;
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

const html = () => fetch(`${BASE}/`).then((r) => r.text());
const appJs = () => fetch(`${BASE}/app.js`).then((r) => r.text());

test('the page ships one error slot, hidden by default', async () => {
  const doc = await html();
  const matches = doc.match(/id="error-banner"/g) ?? [];
  assert.equal(matches.length, 1, 'exactly one banner element');
  assert.match(doc, /id="error-banner"[^>]*hidden/);
  assert.match(doc, /id="error-banner-text"/);
  assert.match(doc, /id="error-banner-dismiss"/);
});

test('the banner is announced to assistive tech', async () => {
  const doc = await html();
  assert.match(doc, /role="alert"/);
  assert.match(doc, /aria-live="assertive"/);
});

test('the old per-form error elements are gone', async () => {
  // Three separate inline slots were what made repeated failures clutter the
  // page; the single banner replaces them.
  const doc = await html();
  assert.doesNotMatch(doc, /id="add-error"/);
  assert.doesNotMatch(doc, /id="about-error"/);
  assert.doesNotMatch(doc, /id="contact-error"/);
});

test('errors go to the console as well as the banner', async () => {
  const js = await appJs();
  assert.match(js, /console\.error\(`\[\$\{context\}\]`/);
});

test('every startup step is guarded so one failure cannot blank the page', async () => {
  const js = await appJs();
  for (const step of ['Checking sign-in', 'Loading About', 'Loading Contact', 'Loading projects']) {
    assert.ok(js.includes(step), `init should guard: ${step}`);
  }
});

test('unhandled rejections and script errors reach the banner', async () => {
  const js = await appJs();
  assert.match(js, /unhandledrejection/);
  assert.match(js, /addEventListener\('error'/);
});

test('a 401 reports an expired session rather than the raw body', async () => {
  const js = await appJs();
  assert.match(js, /session expired/i);

  // And the API really does answer 401 for an unauthenticated write, which is
  // the response that copy describes.
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'a/b', url: 'https://example.com' }),
  });
  assert.equal(res.status, 401);
});

test('the delete button no longer drops its rejection', async () => {
  const js = await appJs();
  assert.match(js, /guard\(`Removing/);
});
