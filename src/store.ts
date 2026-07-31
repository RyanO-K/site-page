// Project storage with two interchangeable backends, selected at startup by the
// presence of DATABASE_URL:
//   - PgStore   (production): a Neon Postgres table; survives redeploys/restarts.
//   - FileStore (local/CI):   projects.json on disk; zero external dependencies,
//                             which keeps the offline test suite green.
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export interface Project {
  id: string;
  repo: string;
  name: string;
  description: string;
  language: string;
  url: string;
  githubUrl: string;
  addedAt: number;
}

export interface Store {
  /** Newest-first (or user-defined order after reorder). */
  list(): Promise<Project[]>;
  add(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
  /** Persist a full reorder; ids must contain all project ids in the desired order. */
  reorder(ids: string[]): Promise<void>;
  getAbout(): Promise<string>;
  setAbout(content: string): Promise<void>;
  getContact(): Promise<string>;
  setContact(content: string): Promise<void>;
}

const DEFAULT_ABOUT = `Currently exploring CI/CD pipelines and infrastructure as code.

I build software with a focus on test driven development and user driven configuration.`;

const DEFAULT_CONTACT = `<p>Reach me at <a href="mailto:rokeefe@okeefe.work">rokeefe@okeefe.work</a> or find me on <a href="https://github.com/RyanO-K" target="_blank" rel="noopener">GitHub</a>.</p>`;

/** JSON-file backend. Newest-first is maintained by unshifting on add. */
class FileStore implements Store {
  private readonly aboutFile: string;
  private readonly contactFile: string;

  constructor(private readonly file: string) {
    this.aboutFile = file.replace(/projects\.json$/, 'about.md');
    this.contactFile = file.replace(/projects\.json$/, 'contact.html');
  }

  async list(): Promise<Project[]> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async add(project: Project): Promise<void> {
    const all = await this.list();
    all.unshift(project);
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  async remove(id: string): Promise<void> {
    const all = (await this.list()).filter(p => p.id !== id);
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }

  async reorder(ids: string[]): Promise<void> {
    const all = await this.list();
    const map = new Map(all.map(p => [p.id, p]));
    const inIds = new Set(ids);
    const ordered = ids.map(id => map.get(id)).filter((p): p is Project => p !== undefined);
    const rest = all.filter(p => !inIds.has(p.id));
    fs.writeFileSync(this.file, JSON.stringify([...ordered, ...rest], null, 2));
  }

  async getAbout(): Promise<string> {
    try {
      return fs.readFileSync(this.aboutFile, 'utf-8');
    } catch {
      return DEFAULT_ABOUT;
    }
  }

  async setAbout(content: string): Promise<void> {
    fs.writeFileSync(this.aboutFile, content);
  }

  async getContact(): Promise<string> {
    try {
      return fs.readFileSync(this.contactFile, 'utf-8');
    } catch {
      return DEFAULT_CONTACT;
    }
  }

  async setContact(content: string): Promise<void> {
    fs.writeFileSync(this.contactFile, content);
  }
}

/** Postgres (Neon) backend. Table is created lazily on first use. */
class PgStore implements Store {
  private readonly ready: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id          text PRIMARY KEY,
        repo        text NOT NULL,
        name        text NOT NULL,
        description text NOT NULL DEFAULT '',
        language    text NOT NULL DEFAULT '',
        url         text NOT NULL,
        github_url  text NOT NULL,
        added_at    bigint NOT NULL
      )
    `);
    await this.pool.query(`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT -1
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key   text PRIMARY KEY,
        value text NOT NULL
      )
    `);
  }

  async list(): Promise<Project[]> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT id, repo, name, description, language, url,
              github_url AS "githubUrl", added_at AS "addedAt"
         FROM projects
        ORDER BY CASE WHEN sort_order >= 0 THEN sort_order ELSE NULL END ASC NULLS LAST,
                 added_at DESC`,
    );
    // bigint arrives as a string from node-postgres; addedAt (ms) fits in a JS number.
    return rows.map(r => ({ ...r, addedAt: Number(r.addedAt) })) as Project[];
  }

  async add(project: Project): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO projects
         (id, repo, name, description, language, url, github_url, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [project.id, project.repo, project.name, project.description,
       project.language, project.url, project.githubUrl, project.addedAt],
    );
  }

  async remove(id: string): Promise<void> {
    await this.ready;
    await this.pool.query('DELETE FROM projects WHERE id = $1', [id]);
  }

  async reorder(ids: string[]): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE projects SET sort_order = -1');
      if (ids.length) {
        await client.query(
          `UPDATE projects SET sort_order = v.ord
             FROM (SELECT unnest($1::text[]) AS id,
                          generate_subscripts($1::text[], 1) - 1 AS ord) AS v
            WHERE projects.id = v.id`,
          [ids],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getAbout(): Promise<string> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT value FROM settings WHERE key = 'about'`,
    );
    return rows[0]?.value ?? DEFAULT_ABOUT;
  }

  async setAbout(content: string): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO settings (key, value) VALUES ('about', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [content],
    );
  }

  async getContact(): Promise<string> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT value FROM settings WHERE key = 'contact'`,
    );
    return rows[0]?.value ?? DEFAULT_CONTACT;
  }

  async setContact(content: string): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO settings (key, value) VALUES ('contact', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [content],
    );
  }
}

/** Pick the backend based on DATABASE_URL. */
export function createStore(): Store {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    return new PgStore(pool);
  }
  return new FileStore(path.resolve(__dirname, '../projects.json'));
}
