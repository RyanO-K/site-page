import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { createStore, Project } from './store';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const store = createStore();
const sessions = new Map<string, string>();
const oauthStates = new Set<string>();

/** Accept "owner/name", a full github.com URL, or a trailing .git — return "owner/name". */
function normalizeRepo(input: string): string {
  let s = input.trim();
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/^\/+|\/+$/g, '');
  const parts = s.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
}

function getSessionUser(req: http.IncomingMessage): string | null {
  // Test-only auth bypass: opt-in via env, never set in production (Railway).
  if (process.env.TEST_AUTH_BYPASS && process.env.NODE_ENV !== 'production') {
    return process.env.TEST_AUTH_BYPASS;
  }
  const match = (req.headers.cookie ?? '').match(/session=([a-f0-9]+)/);
  if (!match) return null;
  return sessions.get(match[1]) ?? null;
}

/** Safely parse a request body as JSON. Returns null on empty/invalid input. */
function parseJsonBody(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function setCookie(res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`);
}

function clearCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
}

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

// Static showcases served out of public/<slug>/. Each entry gets a bare-path
// 301 to the trailing-slash form plus file serving; the loop in the request
// handler is the single implementation. Adding a showcase = add the slug here
// and commit public/<slug>/, which is why this is a code table and not a
// database lookup: the assets ship with the deploy, so the set of real routes
// is fixed at build time. (Slugs also index the filesystem — sourcing them from
// user-writable rows would turn a project insert into a file-read primitive.)
const SHOWCASES = ['kanban', 'discord'];

// Retired showcases. snake and stacker used to be committed copies under
// public/; they are now separately-hosted Render services reached through the
// /p/<slug> embed page. The old paths were linkable, so they redirect rather
// than 404 — and the redirect target is the slug, not a project id, so it keeps
// working if the row is ever recreated.
const RETIRED_SHOWCASES: Record<string, string> = {
  snake: 'snake-game',
  stacker: 'stacker-game',
};

/**
 * Join untrusted url segments under `root`, or return null if the result
 * escapes it. `path.join` alone is NOT safe here: it resolves '..', so a raw
 * request for /kanban/../../package.json reads outside public/. Browsers and
 * Cloudflare normalize such paths, but the origin must not depend on that.
 */
function safeJoin(root: string, ...parts: string[]): string | null {
  const abs = path.resolve(root, '.' + path.posix.join('/', ...parts));
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/** Read `abs` and respond, with shared MIME handling and a clean 404. */
function serveFile(res: http.ServerResponse, abs: string): void {
  const ext = path.extname(abs);
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const abs = safeJoin(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
  if (abs === null) { res.writeHead(404); res.end('Not found'); return; }
  serveFile(res, abs);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const [urlPath, queryString] = (req.url ?? '/').split('?');
  const params = new URLSearchParams(queryString ?? '');

  try {
    if (method === 'GET' && urlPath === '/auth/github') {
      const state = randomBytes(16).toString('hex');
      oauthStates.add(state);
      setTimeout(() => oauthStates.delete(state), 10 * 60 * 1000);
      res.writeHead(302, { Location: `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user&state=${state}` });
      res.end(); return;
    }

    if (method === 'GET' && urlPath === '/auth/callback') {
      const code = params.get('code'), state = params.get('state');
      if (!code || !state || !oauthStates.has(state)) { res.writeHead(400); res.end('Invalid OAuth state'); return; }
      oauthStates.delete(state);

      const tokenData = await fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code }),
      });
      const ghUser = await fetchJson('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'portfolio' },
      });
      if (ghUser.login !== GITHUB_OWNER) { res.writeHead(403); res.end('Forbidden'); return; }

      const token = randomBytes(32).toString('hex');
      sessions.set(token, ghUser.login);
      setCookie(res, token);
      res.writeHead(302, { Location: '/#projects' });
      res.end(); return;
    }

    if (method === 'POST' && urlPath === '/auth/logout') {
      const match = (req.headers.cookie ?? '').match(/session=([a-f0-9]+)/);
      if (match) sessions.delete(match[1]);
      clearCookie(res);
      json(res, 200, { ok: true }); return;
    }

    if (method === 'GET' && urlPath === '/api/me') {
      json(res, 200, { user: getSessionUser(req) }); return;
    }

    if (method === 'GET' && urlPath === '/api/about') {
      json(res, 200, { content: await store.getAbout() }); return;
    }

    if (method === 'PUT' && urlPath === '/api/about') {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body || typeof body.content !== 'string') {
        json(res, 400, { error: 'content field required' }); return;
      }
      await store.setAbout(body.content as string);
      json(res, 200, { ok: true }); return;
    }

    if (method === 'GET' && urlPath === '/api/contact') {
      json(res, 200, { content: await store.getContact() }); return;
    }

    if (method === 'PUT' && urlPath === '/api/contact') {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body || typeof body.content !== 'string') {
        json(res, 400, { error: 'content field required' }); return;
      }
      await store.setContact(body.content as string);
      json(res, 200, { ok: true }); return;
    }

    if (method === 'GET' && urlPath === '/api/projects') {
      json(res, 200, await store.list()); return;
    }

    if (method === 'POST' && urlPath === '/api/projects') {
      const user = getSessionUser(req);
      if (!user) {
        console.warn('[projects] POST rejected: unauthenticated');
        json(res, 401, { error: 'Unauthorized' }); return;
      }

      const raw = await readBody(req);
      console.log(`[projects] POST by ${user} — content-type=${req.headers['content-type'] ?? 'none'} body=${raw.length} bytes`);

      const body = parseJsonBody(raw);
      if (!body) {
        console.warn(`[projects] POST rejected: body is not valid JSON (got: ${raw.slice(0, 80)})`);
        json(res, 400, { error: 'Request body must be JSON with "repo" and "url" fields' });
        return;
      }

      const repo = normalizeRepo(typeof body.repo === 'string' ? body.repo : '');
      const hostedUrl = typeof body.url === 'string' ? body.url.trim() : '';
      console.log(`[projects] parsed repo="${repo}" url="${hostedUrl}"`);
      if (!repo || !hostedUrl) {
        console.warn('[projects] POST rejected: missing repo or url after parsing');
        json(res, 400, { error: 'repo (owner/name) and url are required' }); return;
      }

      const ghHeaders: Record<string, string> = { 'User-Agent': 'portfolio', Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

      console.log(`[projects] fetching GitHub metadata for ${repo}`);
      const ghRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders });
      if (!ghRes.ok) {
        const detail = ghRes.status === 404
          ? `Repo "${repo}" not found (check owner/name, or it may be private — set GITHUB_TOKEN to allow private repos)`
          : ghRes.status === 403
            ? 'GitHub API rate limit hit (set GITHUB_TOKEN to raise it)'
            : `GitHub API error ${ghRes.status}`;
        console.warn(`[projects] GitHub lookup failed (${ghRes.status}): ${detail}`);
        json(res, 400, { error: detail });
        return;
      }
      const ghRepo = await ghRes.json() as any;
      const project: Project = {
        id: randomBytes(8).toString('hex'),
        repo,
        name: ghRepo.name,
        description: ghRepo.description ?? '',
        language: ghRepo.language ?? '',
        url: hostedUrl,
        githubUrl: ghRepo.html_url,
        addedAt: Date.now(),
      };
      await store.add(project);
      console.log(`[projects] added "${project.name}" (id=${project.id})`);
      json(res, 201, project); return;
    }

    if (method === 'PUT' && urlPath === '/api/projects/reorder') {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body || !Array.isArray(body.ids) || !(body.ids as unknown[]).every(x => typeof x === 'string')) {
        json(res, 400, { error: 'ids (string[]) required' }); return;
      }
      await store.reorder(body.ids as string[]);
      json(res, 200, { ok: true }); return;
    }

    if (method === 'PATCH' && urlPath.startsWith('/api/projects/')) {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const id = urlPath.split('/').pop();
      if (!id) { json(res, 400, { error: 'id required' }); return; }
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      if (!body) { json(res, 400, { error: 'JSON body required' }); return; }
      const patch: Record<string, string> = {};
      for (const key of ['name', 'description', 'language', 'url', 'githubUrl'] as const) {
        if (typeof body[key] === 'string') patch[key] = (body[key] as string).trim();
      }
      await store.update(id, patch);
      json(res, 200, { ok: true }); return;
    }

    if (method === 'DELETE' && urlPath.startsWith('/api/projects/')) {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const id = urlPath.split('/').pop();
      if (id) await store.remove(id);
      json(res, 200, { ok: true }); return;
    }

    // Project pages: /p/<slug> embeds a separately-hosted project in an iframe.
    // One static shell for every project — it reads the slug from the url and
    // looks the embed target up in /api/projects, so adding a project is a
    // database row, not a deploy. Any /p/... path serves the same shell; the
    // client 404s an unknown slug itself.
    if (urlPath === '/p' || urlPath === '/p/') {
      res.writeHead(302, { Location: '/#projects' });
      res.end(); return;
    }

    if (urlPath.startsWith('/p/')) {
      serveFile(res, path.join(PUBLIC_DIR, 'project', 'index.html')); return;
    }

    // Retired showcases (see RETIRED_SHOWCASES) — permanently moved to their
    // own hosts. Sub-paths collapse to the project page too: nothing under the
    // old prefix exists on this origin any more.
    for (const [old, slug] of Object.entries(RETIRED_SHOWCASES)) {
      if (urlPath === `/${old}` || urlPath.startsWith(`/${old}/`)) {
        res.writeHead(301, { Location: `/p/${slug}` });
        res.end(); return;
      }
    }

    // Static showcase routes (see SHOWCASES).
    for (const slug of SHOWCASES) {
      if (urlPath === `/${slug}`) {
        res.writeHead(301, { Location: `/${slug}/` });
        res.end(); return;
      }

      if (urlPath.startsWith(`/${slug}/`)) {
        const sub = urlPath.slice(slug.length + 2) || 'index.html';
        const abs = safeJoin(PUBLIC_DIR, slug, sub);
        if (abs === null) { res.writeHead(404); res.end('Not found'); return; }
        serveFile(res, abs); return;
      }
    }

    serveStatic(res, urlPath);
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end('Internal server error');
  }
});

server.listen(PORT, () => console.log(`Site running at ${BASE_URL}`));
