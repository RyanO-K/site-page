const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', HTML: '#e34c26', CSS: '#563d7c',
  'C++': '#f34b7d', C: '#555555', Java: '#b07219',
};

let currentUser = null;

async function init() {
  const me = await apiFetch('/api/me');
  currentUser = me.user;
  renderAuth();
  await loadProjects();
  if (currentUser) setupAdminPanel();
}

function renderAuth() {
  const item = document.getElementById('auth-item');
  if (currentUser) {
    item.innerHTML = `<button id="logout-btn">Log out</button>`;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await apiFetch('/auth/logout', { method: 'POST' });
      currentUser = null;
      renderAuth();
      document.getElementById('admin-panel').hidden = true;
      await loadProjects();
    });
  } else {
    item.innerHTML = `<a href="/auth/github">Login</a>`;
  }
}

function setupAdminPanel() {
  const panel = document.getElementById('admin-panel');
  panel.hidden = false;
  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const repo = document.getElementById('input-repo').value.trim();
    const url = document.getElementById('input-url').value.trim();
    const btn = e.target.querySelector('button');
    const errEl = document.getElementById('add-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, url }),
      });
      document.getElementById('input-repo').value = '';
      document.getElementById('input-url').value = '';
      await loadProjects();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Project';
    }
  });
}

async function loadProjects() {
  const grid = document.getElementById('project-grid');
  const projects = await apiFetch('/api/projects');
  grid.innerHTML = '';
  if (!projects.length) {
    grid.innerHTML = '<p class="empty-state">No projects yet.</p>';
    return;
  }
  for (const p of projects) grid.appendChild(buildCard(p));
}

function buildCard(p) {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.id = p.id;
  card.addEventListener('click', () => window.open(p.url, '_blank'));

  const langColor = LANG_COLORS[p.language] ?? '#888';
  const langBadge = p.language
    ? `<span class="lang-dot" style="background:${langColor}"></span>${p.language}`
    : '';

  card.innerHTML = `
    <div class="project-preview">
      <iframe src="${p.url}" title="${p.name}" scrolling="no" tabindex="-1" aria-hidden="true"></iframe>
      <div class="preview-overlay"><span class="play-label">Open →</span></div>
    </div>
    <div class="project-info">
      <h3>${p.name}</h3>
      ${langBadge ? `<div class="project-meta">${langBadge}</div>` : ''}
      <p>${p.description || ''}</p>
      <div style="margin-top:.75rem">
        <a class="btn" href="${p.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open</a>
        <a class="btn btn-ghost" href="${p.githubUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">GitHub</a>
      </div>
    </div>
  `;

  if (currentUser) {
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.title = 'Remove';
    del.textContent = '×';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Remove "${p.name}"?`)) return;
      await apiFetch(`/api/projects/${p.id}`, { method: 'DELETE' });
      await loadProjects();
    });
    card.appendChild(del);
  }

  return card;
}

async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.headers.get('content-type')?.includes('application/json')) return res.json();
  return null;
}

init();
