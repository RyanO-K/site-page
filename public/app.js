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
  await loadContact();
  await loadProjects();
  if (currentUser) {
    setupAdminPanel();
    setupAboutEdit();
    setupContactEdit();
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

async function loadContact() {
  const { content } = await apiFetch('/api/contact');
  document.getElementById('contact-content').innerHTML = content;
}

function setupContactEdit() {
  const editBtn = document.getElementById('contact-edit-btn');
  const editPanel = document.getElementById('contact-edit');
  const contentDiv = document.getElementById('contact-content');
  const editor = document.getElementById('contact-editor');
  const saveBtn = document.getElementById('contact-save');
  const cancelBtn = document.getElementById('contact-cancel');
  const errEl = document.getElementById('contact-error');

  editBtn.hidden = false;

  editBtn.addEventListener('click', () => {
    editor.innerHTML = contentDiv.innerHTML;
    editBtn.hidden = true;
    contentDiv.hidden = true;
    editPanel.hidden = false;
    errEl.hidden = true;
    editor.focus();
  });

  editPanel.querySelectorAll('.rtf-toolbar [data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      editor.focus();
    });
  });

  document.getElementById('contact-link-btn').addEventListener('click', () => {
    const url = prompt('Enter URL:');
    if (url) document.execCommand('createLink', false, url);
    editor.focus();
  });

  cancelBtn.addEventListener('click', () => {
    editPanel.hidden = true;
    contentDiv.hidden = false;
    editBtn.hidden = false;
    errEl.hidden = true;
  });

  saveBtn.addEventListener('click', async () => {
    const content = editor.innerHTML;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errEl.hidden = true;
    try {
      await apiFetch('/api/contact', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      contentDiv.innerHTML = content;
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

// Number of projects to feature up top with rich preview cards; the rest fall
// into the compact gallery below.
const FEATURED_COUNT = 3;

// Canonical ordered list, kept in sync with the server after each load/reorder.
let projectsList = [];
// ID of the card currently being dragged (null when no drag in progress).
let dragSrcId = null;

async function loadProjects() {
  projectsList = await apiFetch('/api/projects');
  renderProjects(projectsList);
}

function renderProjects(projects) {
  const grid = document.getElementById('project-grid');
  const galleryWrap = document.getElementById('gallery-wrap');
  const gallery = document.getElementById('project-gallery');
  grid.innerHTML = '';
  gallery.innerHTML = '';
  galleryWrap.hidden = true;
  if (!projects.length) {
    grid.innerHTML = '<p class="empty-state">No projects yet.</p>';
    return;
  }

  const featured = projects.slice(0, FEATURED_COUNT);
  const rest = projects.slice(FEATURED_COUNT);
  for (const p of featured) grid.appendChild(buildCard(p));
  if (rest.length) {
    for (const p of rest) gallery.appendChild(buildGalleryCard(p));
    galleryWrap.hidden = false;
  }
}

/** Attach HTML5 drag-and-drop handlers to a card element (admin-only). */
function addDragHandlers(card, p) {
  card.draggable = true;

  card.addEventListener('dragstart', e => {
    dragSrcId = p.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to initiate drag
    e.dataTransfer.setData('text/plain', p.id);
  });

  card.addEventListener('dragend', () => {
    dragSrcId = null;
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  card.addEventListener('dragover', e => {
    if (!dragSrcId || dragSrcId === p.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });

  card.addEventListener('dragleave', e => {
    // Only clear if leaving to outside this card (not into a child element)
    if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  });

  card.addEventListener('drop', async e => {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === p.id) return;
    card.classList.remove('drag-over');

    const fromIdx = projectsList.findIndex(x => x.id === dragSrcId);
    if (fromIdx === -1) return;

    const newOrder = [...projectsList];
    const [removed] = newOrder.splice(fromIdx, 1);
    // Find target in the updated array (indices may have shifted after removal)
    const toIdx = newOrder.findIndex(x => x.id === p.id);
    if (toIdx === -1) return;
    newOrder.splice(toIdx, 0, removed);

    projectsList = newOrder;
    renderProjects(projectsList);

    try {
      await apiFetch('/api/projects/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: newOrder.map(x => x.id) }),
      });
    } catch (err) {
      console.error('[reorder] failed:', err.message);
      // Revert to server state on failure
      await loadProjects();
    }
  });
}

/** A delete button for admins; shared by both card styles. */
function buildDeleteBtn(p) {
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
  return del;
}

/** Compact card for the "More projects" gallery — no preview iframe, so the
 *  featured three stay the visual focus while everything remains visible. */
function buildGalleryCard(p) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.dataset.id = p.id;
  card.addEventListener('click', () => { window.location.href = `/p/${p.id}`; });

  const langColor = LANG_COLORS[p.language] ?? '#888';
  const langBadge = p.language
    ? `<span class="lang-dot" style="background:${langColor}"></span>${p.language}`
    : '';

  card.innerHTML = `
    <div class="gallery-info">
      <h4>${p.name}</h4>
      ${langBadge ? `<div class="project-meta">${langBadge}</div>` : ''}
      <p>${p.description || ''}</p>
    </div>
    <div class="gallery-actions">
      <a class="btn" href="${p.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open</a>
      <a class="btn btn-ghost" href="${p.githubUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">GitHub</a>
    </div>
  `;

  if (currentUser) {
    card.appendChild(buildDeleteBtn(p));
    addDragHandlers(card, p);
  }
  return card;
}

function buildCard(p) {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.id = p.id;
  card.addEventListener('click', () => { window.location.href = `/p/${p.id}`; });

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
    card.appendChild(buildDeleteBtn(p));
    addDragHandlers(card, p);
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
