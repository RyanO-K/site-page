import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PROJECTS_PATH = path.resolve(__dirname, '../projects.json');

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_OWNER = process.env.GITHUB_OWNER!;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const sessions = new Map<string, string>();
const oauthStates = new Set<string>();

interface Project {
  id: string;
  repo: string;
  name: string;
  description: string;
  language: string;
  url: string;
  githubUrl: string;
  addedAt: number;
}

/** Accept "owner/name", a full github.com URL, or a trailing .git — return "owner/name". */
function normalizeRepo(input: string): string {
  let s = input.trim();
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/^\/+|\/+$/g, '');
  const parts = s.split('/');
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
}

function readProjects(): Project[] {
  try { return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf-8')); }
  catch { return []; }
}

function writeProjects(projects: Project[]): void {
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2));
}

function getSessionUser(req: http.IncomingMessage): string | null {
  const match = (req.headers.cookie ?? '').match(/session=([a-f0-9]+)/);
  if (!match) return null;
  return sessions.get(match[1]) ?? null;
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

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const abs = path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);
  const ext = path.extname(abs);
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
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

    if (method === 'GET' && urlPath === '/api/projects') {
      json(res, 200, readProjects()); return;
    }

    if (method === 'POST' && urlPath === '/api/projects') {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const body = JSON.parse(await readBody(req));
      const repo = normalizeRepo(body.repo ?? '');
      const hostedUrl: string = body.url?.trim();
      if (!repo || !hostedUrl) { json(res, 400, { error: 'repo (owner/name) and url are required' }); return; }

      const ghHeaders: Record<string, string> = { 'User-Agent': 'portfolio', Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

      const ghRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders });
      if (!ghRes.ok) {
        const detail = ghRes.status === 404
          ? `Repo "${repo}" not found (check owner/name, or it may be private — set GITHUB_TOKEN to allow private repos)`
          : ghRes.status === 403
            ? 'GitHub API rate limit hit (set GITHUB_TOKEN to raise it)'
            : `GitHub API error ${ghRes.status}`;
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
      const projects = readProjects();
      projects.unshift(project);
      writeProjects(projects);
      json(res, 201, project); return;
    }

    if (method === 'DELETE' && urlPath.startsWith('/api/projects/')) {
      if (!getSessionUser(req)) { json(res, 401, { error: 'Unauthorized' }); return; }
      const id = urlPath.split('/').pop();
      writeProjects(readProjects().filter(p => p.id !== id));
      json(res, 200, { ok: true }); return;
    }

    serveStatic(res, urlPath);
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end('Internal server error');
  }
});

server.listen(PORT, () => console.log(`Site running at ${BASE_URL}`));
