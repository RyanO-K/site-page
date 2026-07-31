// Readable project urls: /p/snake-game rather than /p/c6bb287d69a4673b.
//
// The repository name is the one identifier a project already carries that is
// stable, unique among an owner's repos, and meaningful in a shared link. Ids
// remain valid as a fallback so links made before this change still resolve.
//
// Shared by the project grid (app.js) and the embed shell (project/embed.js) —
// both pages must agree on how a link maps back to a row, so the mapping lives
// in one file loaded by both rather than being written twice.

/** Lowercase, hyphenate, and strip anything that is not url-safe. */
function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The url segment for a project: its repo name, falling back to its display
 * name, falling back to its id. Never empty, always url-safe.
 */
function projectSlug(project) {
  const repoName = String(project.repo ?? '').split('/').pop();
  return slugify(repoName) || slugify(project.name) || project.id;
}

/** The path a project's card links to. */
function projectPath(project) {
  return `/p/${projectSlug(project)}`;
}

/**
 * Resolve a /p/<key> segment back to a project. Slug first, then id — so old
 * id links keep working, and a slug always wins over a coincidentally equal id.
 */
function findProjectByKey(projects, key) {
  const wanted = slugify(key);
  return projects.find((p) => projectSlug(p) === wanted)
      ?? projects.find((p) => p.id === key);
}
