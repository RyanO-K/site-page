const LANG_COLORS = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', HTML: '#e34c26', CSS: '#563d7c',
  'C++': '#f34b7d', C: '#555555', Java: '#b07219',
};

let currentUser = null;

async function init() {
  setupNav();
  const me = await apiFetch('/api/me');
  currentUser = me.user;
  renderAuth();
  await loadAbout();
  await loadProjects();
  if (currentUser) {
    setupAdminPanel();
    setupAboutEdit();
  }
}

/** Wire the mobile hamburger toggle; collapses the menu after a nav choice. */
function setupNav() {
  const toggle = document.getElementById('nav-toggle');
  const links = document.getElementById('nav-links');
  if (!toggle || !links) return;
  const close = () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', e => {
    if (e.target.closest('a, #auth-item button')) close();
  });
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
      document.getElementById('about-edit-btn').hidden = true;
      await loadProjects();
    });
  } else {
    item.innerHTML = `<a href="/auth/github">Login</a>`;
  }
}

/** Minimal markdown → HTML: paragraphs, bold, italic, links, inline code. */
function renderMarkdown(md) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const paragraphs = escaped.split(/\n\n+/).map(block => {
    const inline = block
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
    return `<p>${inline}</p>`;
  });

  return paragraphs.join('\n');
}

async function loadAbout() {
  const { content } = await apiFetch('/api/about');
  document.getElementById('about-content').innerHTML = renderMarkdown(content);
  const ta = document.getElementById('about-textarea');
  if (ta) ta.value = content;
}

function setupAboutEdit() {
  const editBtn = document.getElementById('about-edit-btn');
  const editPanel = document.getElementById('about-edit');
  const contentDiv = document.getElementById('about-content');
  const saveBtn = document.getElementById('about-save');
  const cancelBtn = document.getElementById('about-cancel');
  const errEl = document.getElementById('about-error');

  editBtn.hidden = false;

  editBtn.addEventListener('click', () => {
    editBtn.hidden = true;
    contentDiv.hidden = true;
    editPanel.hidden = false;
    errEl.hidden = true;
  });

  cancelBtn.addEventListener('click', () => {
    editPanel.hidden = true;
    contentDiv.hidden = false;
    editBtn.hidden = false;
    errEl.hidden = true;
  });

  saveBtn.addEventListener('click', async () => {
    const content = document.getElementById('about-textarea').value;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errEl.hidden = true;
    try {
      await apiFetch('/api/about', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      contentDiv.innerHTML = renderMarkdown(content);
      editPanel.hidden = true;
      contentDiv.hidden = false;
      editBtn.hidden = false;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

function setupAdminPanel() {
  const panel = document.getElementById('admin-panel');
  panel.hidden = false;
  document.getElementById('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const repo = document.getElementById('input-repo').value.trim();
    const url = document.getElementById('input-url').value.trim();
    const payload = { repo, url };
    console.log('[add-project] submit intercepted; payload =', payload);
    const btn = e.target.querySelector('button');
    const errEl = document.getElementById('add-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      const created = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[add-project] success:', created);
      document.getElementById('input-repo').value = '';
      document.getElementById('input-url').value = '';
      await loadProjects();
    } catch (err) {
      console.error('[add-project] failed:', err.message);
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
