// Tests for readable project urls and the retired showcase routes.
//
// Cards used to link to /p/<hex id>, which is unreadable in a shared link and
// leaks an internal identifier. They now link to /p/<repo name>. Ids still
// resolve, because links made before the switch are already out in the world.
//
// snake and stacker used to ship as committed copies under public/. They are
// separately-hosted services now, so their old paths must land somewhere useful
// rather than 404 — anyone holding an /snake/ link should end up at the project.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '../dist/server.js');

const PORT = 4118;
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
let slug;   // the real served slug.js, evaluated

before(async () => {
  proc = await startServer();
  const src = await fetch(`${BASE}/slug.js`).then((r) => r.text());
  // Evaluate the file the browser actually receives, so these assertions cannot
  // drift from what ships.
  slug = new Function(`${src}\nreturn { slugify, projectSlug, projectPath, findProjectByKey };`)();
});
after(() => { proc?.kill(); });

const project = (over = {}) => ({
  id: 'c6bb287d69a4673b',
  repo: 'RyanO-K/snake-game',
  name: 'snake-game',
  url: 'https://snake-game.onrender.com',
  ...over,
});

// ── slug derivation ──────────────────────────────────────────

test('the slug is the repo name, not the owner or the id', () => {
  assert.equal(slug.projectSlug(project()), 'snake-game');
  assert.equal(slug.projectPath(project()), '/p/snake-game');
});

test('slugs are url-safe even when the repo name is not', () => {
  assert.equal(slug.projectSlug(project({ repo: 'me/My Repo.v2' })), 'my-repo-v2');
  assert.doesNotMatch(slug.projectSlug(project({ repo: 'me/--odd--' })), /^-|-$/);
});

test('a project with no repo falls back to its name, then its id', () => {
  assert.equal(slug.projectSlug(project({ repo: '', name: 'Site Page' })), 'site-page');
  assert.equal(slug.projectSlug(project({ repo: '', name: '' })), 'c6bb287d69a4673b');
  assert.equal(slug.projectSlug(project({ repo: undefined, name: undefined })), 'c6bb287d69a4673b');
});

// ── resolution ───────────────────────────────────────────────

test('a slug link resolves to its project', () => {
  const rows = [project(), project({ id: 'other', repo: 'RyanO-K/stacker-game' })];
  assert.equal(slug.findProjectByKey(rows, 'stacker-game').id, 'other');
});

test('an old id link still resolves', () => {
  // The reason ids stay in the lookup at all: links shared before the switch.
  const rows = [project()];
  assert.equal(slug.findProjectByKey(rows, 'c6bb287d69a4673b').repo, 'RyanO-K/snake-game');
});

test('an unknown key resolves to nothing', () => {
  assert.equal(slug.findProjectByKey([project()], 'nope'), undefined);
});

// ── wiring ───────────────────────────────────────────────────

test('both pages load the shared slug helper', async () => {
  // The grid writes the links and the shell reads them back; if only one of them
  // loaded slug.js the two would disagree about what a link means.
  const home = await fetch(`${BASE}/`).then((r) => r.text());
  const shell = await fetch(`${BASE}/p/snake-game`).then((r) => r.text());
  assert.match(home, /slug\.js/);
  assert.match(shell, /slug\.js/);
});

test('cards link by slug rather than by id', async () => {
  const js = await fetch(`${BASE}/app.js`).then((r) => r.text());
  assert.match(js, /projectPath\(p\)/);
  assert.doesNotMatch(js, /`\/p\/\$\{p\.id\}`/, 'no id-based hrefs should remain');
  assert.doesNotMatch(js, /href="\/p\/\$\{p\.id\}"/, 'no id-based hrefs should remain');
});

test('the shell resolves by key and canonicalizes the url', async () => {
  const js = await fetch(`${BASE}/project/embed.js`).then((r) => r.text());
  assert.match(js, /findProjectByKey/);
  assert.match(js, /replaceState/);
});

// ── retired showcases ────────────────────────────────────────

for (const [from, to] of [
  ['/snake', '/p/snake-game'],
  ['/snake/', '/p/snake-game'],
  ['/snake/index.html', '/p/snake-game'],
  ['/stacker', '/p/stacker-game'],
  ['/stacker/', '/p/stacker-game'],
]) {
  test(`GET ${from} redirects to ${to}`, async () => {
    const res = await fetch(`${BASE}${from}`, { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), to);
  });
}

test('the committed copies are gone from public/', async () => {
  // The point of the move: the games are hosted separately, so their assets must
  // not also ship with this deploy and drift out of date.
  for (const asset of ['/snake/bundle.js', '/stacker/bundle.js', '/snake/style.css']) {
    const res = await fetch(`${BASE}${asset}`, { redirect: 'manual' });
    assert.notEqual(res.status, 200, `${asset} should no longer be served`);
  }
});

test('the per-game score APIs are gone', async () => {
  // They wrote to a file on an ephemeral disk and belonged to the games, which
  // now keep their own scores.
  for (const api of ['/snake/api/scores', '/stacker/api/scores']) {
    const res = await fetch(`${BASE}${api}`, { redirect: 'manual' });
    assert.equal(res.status, 301, `${api} should redirect, not answer with a scoreboard`);
  }
});

test('the surviving showcases still serve', async () => {
  for (const p of ['/kanban/', '/discord/']) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(res.status, 200, `${p} should still serve`);
  }
});
