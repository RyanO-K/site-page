// Security regression tests: static file serving must not escape public/.
//
// `path.join(PUBLIC_DIR, urlPath)` resolves '..', so a RAW request for
// /kanban/../../package.json used to read files outside the public directory —
// on both the showcase routes and the serveStatic catch-all. Browsers and the
// Cloudflare edge normalize such paths before they reach the origin, which is
// why this was never exploitable on the live site, but the origin must hold on
// its own. safeJoin() now rejects anything resolving outside PUBLIC_DIR.
//
// These requests are sent with raw paths (no client-side normalization) via a
// hand-written request line, mimicking what a non-normalizing client sends.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4114;

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

/**
 * Send a request with the path EXACTLY as given — fetch() would normalize away
 * the '..' segments this test depends on, so write the request line directly.
 */
function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, '127.0.0.1', () => {
      socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: localhost:${PORT}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => {
      const status = Number(data.split(' ')[1]);
      const body = data.slice(data.indexOf('\r\n\r\n') + 4);
      resolve({ status, body });
    });
    socket.on('error', reject);
  });
}

let proc;
before(async () => { proc = await startServer(); });
after(() => { proc?.kill(); });

const ESCAPES = [
  '/kanban/../../package.json',
  '/snake/../../package.json',
  '/stacker/../../package.json',
  '/discord/../../package.json',
  '/../package.json',
  '/kanban/../../src/server.ts',
];

for (const rawPath of ESCAPES) {
  test(`raw GET ${rawPath} does not escape public/`, async () => {
    const { status, body } = await rawGet(rawPath);
    assert.equal(status, 404, `${rawPath} should 404, got ${status}`);
    assert.doesNotMatch(body, /"name":\s*"site-page"/, 'must not leak package.json');
    assert.doesNotMatch(body, /createServer/, 'must not leak server source');
  });
}

// The fix must not break ordinary nested asset serving.
test('normal showcase assets still serve', async () => {
  const { status } = await rawGet('/snake/bundle.js');
  assert.equal(status, 200);
});

test('normal root asset still serves', async () => {
  const { status } = await rawGet('/style.css');
  assert.equal(status, 200);
});
