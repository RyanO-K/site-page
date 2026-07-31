// Integration tests for the /api/contact endpoint.
// Uses Node's built-in test runner: `node --test`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');
const CONTACT_PATH = path.resolve(__dirname, '../contact.html');

const AUTHED_PORT = 4131;
const UNAUTHED_PORT = 4132;
const AUTHED = `http://localhost:${AUTHED_PORT}`;
const UNAUTHED = `http://localhost:${UNAUTHED_PORT}`;

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
      if (stdout.includes('running at')) { clearTimeout(timer); resolve(proc); }
    });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

let authedProc;
let unauthedProc;
let savedContact = null;

before(async () => {
  if (fs.existsSync(CONTACT_PATH)) savedContact = fs.readFileSync(CONTACT_PATH, 'utf-8');
  authedProc = await startServer({ port: AUTHED_PORT, bypass: 'tester' });
  unauthedProc = await startServer({ port: UNAUTHED_PORT });
});

after(() => {
  authedProc?.kill();
  unauthedProc?.kill();
  if (savedContact !== null) fs.writeFileSync(CONTACT_PATH, savedContact);
  else if (fs.existsSync(CONTACT_PATH)) fs.rmSync(CONTACT_PATH);
});

test('GET /api/contact returns 200 with content', async () => {
  const res = await fetch(`${AUTHED}/api/contact`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.content === 'string');
  assert.ok(body.content.length > 0);
});

test('PUT /api/contact without session returns 401', async () => {
  const res = await fetch(`${UNAUTHED}/api/contact`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '<p>Hello</p>' }),
  });
  assert.equal(res.status, 401);
});

test('PUT /api/contact with session updates content', async () => {
  const newContent = '<p>Updated contact <a href="mailto:test@test.com">test@test.com</a></p>';
  const putRes = await fetch(`${AUTHED}/api/contact`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: newContent }),
  });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json();
  assert.equal(putBody.ok, true);

  const getRes = await fetch(`${AUTHED}/api/contact`);
  const getBody = await getRes.json();
  assert.equal(getBody.content, newContent);
});

test('PUT /api/contact with missing content returns 400', async () => {
  const res = await fetch(`${AUTHED}/api/contact`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ other: 'field' }),
  });
  assert.equal(res.status, 400);
});
