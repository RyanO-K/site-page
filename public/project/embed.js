// Project embed shell. Reads the project key from /p/<key>, looks the project
// up in /api/projects, and frames its url. The key is the repo-name slug; ids
// still resolve, so links shared before the switch keep working (see slug.js).
//
// The projects are hosted as separate Render services on the free plan, which
// spin down after ~15 minutes idle. A cold one takes roughly 12-50s to answer
// its first request, during which an unadorned iframe is just a blank white
// rectangle. So the frame stays hidden behind a status panel until it actually
// loads, and the copy escalates to name the wait rather than let it read as a
// broken page.

const WAKE_MS = 4000;    // past this, stop saying "loading" and admit it's waking
const SLOW_MS = 25000;   // past this, offer the escape hatch

const el = (id) => document.getElementById(id);

const frame        = el('embed-frame');
const status       = el('embed-status');
const statusTitle  = el('embed-status-title');
const statusDetail = el('embed-status-detail');
const spinner      = el('embed-spinner');

let settled = false;
const timers = [];

/** Show a terminal (non-loading) message: no spinner, no further escalation. */
function fail(title, detail) {
  settled = true;
  timers.forEach(clearTimeout);
  spinner.hidden = true;
  status.hidden = false;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function keyFromPath() {
  // /p/<key> — tolerate a trailing slash and any stray sub-path.
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] ?? '';
}

async function main() {
  const key = keyFromPath();
  if (!key) {
    fail('No project specified', 'This page needs a project, as in /p/<project>.');
    return;
  }

  let projects;
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    projects = await res.json();
  } catch {
    fail('Could not load projects', 'The project list is unavailable right now. Try again in a moment.');
    return;
  }

  const project = findProjectByKey(projects, key);
  if (!project) {
    fail('Project not found', 'No project matches this link. It may have been removed.');
    return;
  }

  // Canonicalize: an id link (or an odd-cased slug) rewrites to the slug url so
  // what gets copied out of the address bar is the readable form.
  const canonical = `/p/${projectSlug(project)}`;
  if (window.location.pathname !== canonical) {
    window.history.replaceState(null, '', canonical);
  }

  // Same-origin targets are pages of this site (the static /kanban and /discord
  // showcases, and the row that points at the site itself). Framing those would
  // nest okeefe.work inside okeefe.work to no benefit, so just go there. Only
  // separately-hosted projects are worth the shell.
  let target;
  try {
    target = new URL(project.url, window.location.href);
  } catch {
    fail('Invalid project url', `"${project.url}" is not a url this page can open.`);
    return;
  }

  if (target.origin === window.location.origin) {
    window.location.replace(target.href);
    return;
  }

  document.title = `${project.name} — okeefe.work`;
  el('embed-title').textContent = project.name;

  const open = el('embed-open');
  open.href = project.url;

  if (project.githubUrl) {
    const gh = el('embed-github');
    gh.href = project.githubUrl;
    gh.hidden = false;
  }

  statusTitle.textContent = `Loading ${project.name}…`;

  // Escalate the copy while the frame is still blank, so a 30s cold start reads
  // as a known cost rather than a hang.
  timers.push(setTimeout(() => {
    if (settled) return;
    statusTitle.textContent = 'Waking up the server…';
    statusDetail.textContent =
      'This project runs on a free instance that sleeps when idle. ' +
      'First load can take up to a minute — it is fast after that.';
  }, WAKE_MS));

  timers.push(setTimeout(() => {
    if (settled) return;
    statusDetail.textContent =
      'Still waking up. You can also open it directly in a new tab using the button above.';
  }, SLOW_MS));

  frame.addEventListener('load', () => {
    // Fires for the real page and for an error page the host may serve; either
    // way the frame now has something to show, so reveal it.
    settled = true;
    timers.forEach(clearTimeout);
    status.hidden = true;
    frame.classList.add('ready');

    // Hand the keyboard to the framed page. A project reads keys at its own
    // document, which never sees them while this shell holds focus — so the
    // games arrived dead and the first thing a visitor had to do was click the
    // canvas to wake them up. Focusing the frame skips that.
    frame.focus();
  });

  frame.addEventListener('error', () => {
    fail('Could not load this project', `${project.name} did not respond. Try opening it directly.`);
  });

  frame.src = target.href;
}

main();
