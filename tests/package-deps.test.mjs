// Regression guard for the Render build.
//
// Render builds with `npm install; npm run build` under NODE_ENV=production,
// which means `npm install` OMITS devDependencies. Anything the build (`tsc`)
// needs must therefore live in `dependencies`, not `devDependencies` — otherwise
// the production build fails with "Cannot find name 'process'/'http'/..." errors
// even though it compiles fine locally (where node_modules already has the types).
//
// This test locks that invariant so the deps can't silently slide back into
// devDependencies and break the deploy. See the 2026-06-30 build_failed incident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
);

const deps = pkg.dependencies ?? {};
const devDeps = pkg.devDependencies ?? {};

// Packages `tsc` needs at build time. Because Render's build runs a
// production-only install, each of these MUST be a production dependency.
const BUILD_TIME_DEPS = ['typescript', '@types/node', '@types/pg'];

for (const name of BUILD_TIME_DEPS) {
  test(`${name} is a production dependency (needed by tsc on Render)`, () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(deps, name),
      `${name} must be in "dependencies" — Render's prod-only install skips ` +
        `devDependencies, so a build-time package there fails the deploy.`,
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(devDeps, name),
      `${name} must NOT be in "devDependencies" (it is required by the build).`,
    );
  });
}
