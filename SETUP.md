# Setup

## 1. Create a GitHub OAuth App

Go to: https://github.com/settings/developers → "New OAuth App"

- Application name: Portfolio
- Homepage URL: https://www.okeefe.work
- Authorization callback URL: https://www.okeefe.work/auth/callback

Copy the **Client ID** and generate a **Client Secret**.

## 2. Railway Environment Variables

Set these in your Railway service → Variables:

| Variable               | Value                                                 |
|------------------------|-------------------------------------------------------|
| `GITHUB_CLIENT_ID`     | from your OAuth app                                    |
| `GITHUB_CLIENT_SECRET` | from your OAuth app                                    |
| `GITHUB_OWNER`         | `RyanO-K` (only this account can log in)              |
| `BASE_URL`             | https://www.okeefe.work                               |

Railway sets `PORT` automatically — no need to add it.

## 3. Deploy

Push to GitHub and connect the repo to Railway. The build and start commands are
already defined in `railway.toml` (nixpacks → `npm run build`, then `npm start`),
so no manual command configuration is needed.

## 4. Custom Domain

In Railway → Settings → Networking → Custom Domain: `www.okeefe.work`

In Route 53, set your `www` CNAME to the Railway-provided target.

## Adding projects

Once deployed, click **Login** (top-right), authorize with GitHub, then use the
form in the Projects section to add a repo by `owner/repo` plus its hosted URL.
Name, description, and language are pulled automatically from the GitHub API.
Project data is stored in `projects.json` (gitignored, lives on the Railway disk).
