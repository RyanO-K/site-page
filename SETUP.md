# Setup

## 1. Create a GitHub OAuth App

Go to: https://github.com/settings/developers → "New OAuth App"

- Application name: Portfolio
- Homepage URL: https://www.okeefe.work
- Authorization callback URL: https://www.okeefe.work/auth/callback

Copy the **Client ID** and generate a **Client Secret**.

## 2. Database (Neon Postgres)

Project data is stored in Postgres so it survives redeploys and restarts (Render's
filesystem is ephemeral). Use a Neon database and copy its **connection string**
(the pooled `...-pooler...` URL, including `?sslmode=require`). The `projects` table
is created automatically on first write — no migration step needed.

> If `DATABASE_URL` is **not** set, the server falls back to a local `projects.json`
> file. That's only for local dev / the offline test suite — never rely on it in
> production, where the file would be wiped on every deploy.

## 3. Render Environment Variables

Set these in your Render service → Environment (or via `render.yaml`):

| Variable               | Value                                                          |
|------------------------|----------------------------------------------------------------|
| `GITHUB_CLIENT_ID`     | from your OAuth app                                             |
| `GITHUB_CLIENT_SECRET` | from your OAuth app                                             |
| `GITHUB_OWNER`         | `RyanO-K` (only this account can log in)                       |
| `BASE_URL`             | https://www.okeefe.work                                        |
| `DATABASE_URL`         | Neon connection string (with `?sslmode=require`)               |
| `NODE_ENV`             | `production`                                                    |
| `GITHUB_TOKEN`         | optional — raises GitHub API rate limit / allows private repos |
| `KANBAN_CLOUD_URL`     | base URL of the kanban-cloud service (for the `/board` proxy)  |
| `KANBAN_CLOUD_SECRET`  | shared secret the proxy sends as `X-Proxy-Secret`              |

Render sets `PORT` automatically — no need to add it.

### The `/board` reverse proxy

`/board/` serves the kanban-cloud shared board through a reverse proxy built on
`node:http`/`node:https` (no extra dependencies). `/board/<rest>` is rewritten to
`/<rest>` on `KANBAN_CLOUD_URL`, preserving method, query string, body, and content
headers; hop-by-hop headers and dot-dot path segments are rejected. If either
`KANBAN_CLOUD_*` var is unset the route answers 503 instead of proxying.

Auth model — the upstream trusts headers only this proxy can set:

- Every forwarded request carries `X-Proxy-Secret: $KANBAN_CLOUD_SECRET`, so the
  upstream can refuse traffic that didn't come through the proxy.
- Logged-in owner: requests carry `X-Proxy-User: <github login>` and any method
  is forwarded (full interactive access).
- Everyone else spectates read-only: `X-Proxy-Readonly: 1`, only `GET`/`HEAD`
  are forwarded, and other methods get a 401 asking them to log in.
- All cookies (including the site `session` cookie) are stripped before
  forwarding, and client-supplied `X-Proxy-*` headers are discarded, so callers
  cannot spoof identity to the upstream.

## 4. Deploy

The repo ships a `render.yaml` blueprint. Either create a **Blueprint** in Render
pointed at this repo, or configure a **Web Service** manually with:

- Build command: `npm install --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/`

`--include=dev` is required: `NODE_ENV=production` also applies at build time, and a
plain `npm install` would then skip devDependencies (TypeScript), breaking the build.

## 5. Custom Domain

In Render → Settings → Custom Domains, add `www.okeefe.work`. Render shows a CNAME
target; set your `www` CNAME in Route 53 to that target (it differs from Railway's).
Keep Railway running until DNS propagates and Render has issued the TLS cert, then
decommission it. The GitHub OAuth callback URL stays `https://www.okeefe.work/auth/callback`.

## Adding projects

Once deployed, click **Login** (top-right), authorize with GitHub, then use the
form in the Projects section to add a repo by `owner/repo` plus its hosted URL.
Name, description, and language are pulled automatically from the GitHub API.
Project data is stored in the Postgres `projects` table.
