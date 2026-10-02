async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return { ok: false }; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  return { ok: res.ok, status: res.status, data };
}

let papers = [], books = [];
let currentUser = null;
let questionsPage = 1;
let suggestionsPage = 1;
let usersPage = 1;
let usersSearch = '';
let materialsAdminPage = 1;
let materialsAdminSearch = '';
let materialsList = [];
const QUESTIONS_PAGE_SIZE = 10;

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'suggestions') renderSuggestionTable();
    if (btn.dataset.tab === 'users') renderUserTable();
    if (btn.dataset.tab === 'materials') renderMaterialTable();
    if (btn.dataset.tab === 'backups') renderBackupTable();
  });
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function init() {
  const me = await api('/api/auth/me');
  if (!me.ok || !['admin', 'master_admin'].includes(me.data.user.role)) { window.location.href = '/index.html'; return; }
  currentUser = me.data.user;
  document.getElementById('who').textContent = `${currentUser.role === 'master_admin' ? 'Master Admin' : 'Admin'}: ${currentUser.username}`;

  if (currentUser.role !== 'master_admin') {
    document.getElementById('materialForm').classList.add('hidden');
    document.getElementById('materialsImportExport').classList.add('hidden');
    document.getElementById('engagementTabBtn').classList.add('hidden');
    document.getElementById('backupsTabBtn').classList.add('hidden');
  }

  await refreshAll();
  await refreshSuggestionBadge();
  wireModal();
  wireImportExport();
  wireSuggestionsPagination();
  wireUsersPagination();
  wireCreateUser();
  wireMaterialsAdmin();
  wireAdminChangePassword();
  if (currentUser.role === 'master_admin') {
    wireEngagement();
    wireBackups();
  }
}

// ---------- IMPORT / EXPORT (Excel) ----------
function wireImportExport() {
  document.getElementById('exportQuestionsBtn').addEventListener('click', () => {
    const book_id = document.getElementById('questionFilterBook').value;
    const params = book_id ? `?book_id=${book_id}` : '';
    window.location.href = '/api/questions/export' + params;
  });

  document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
    window.location.href = '/api/questions/import-template';
  });

  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const msgBox = document.getElementById('importResultMsg');
    msgBox.classList.remove('hidden');
    msgBox.textContent = 'Importing...';

    const res = await fetch('/api/questions/import', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    e.target.value = '';

    if (!res.ok) { msgBox.textContent = data.error || 'Import failed'; return; }
    let text = `Imported ${data.created} question(s).`;
    if (data.errors && data.errors.length) text += ` ${data.errors.length} row(s) skipped: ${data.errors.slice(0, 5).join(' | ')}${data.errors.length > 5 ? ' ...' : ''}`;
    msgBox.textContent = text;
    questionsPage = 1;
    await renderQuestionTable();
  });
}

async function refreshAll() {
  papers = (await api('/api/papers')).data || [];
  books = (await api('/api/books')).data || [];
  renderPaperTable();
  renderBookTable();
  renderQuestionFilters();
  questionsPage = 1;
  await renderQuestionTable();
  await renderUserTable();
  await renderSuggestionTable();
  await renderMaterialTable();
}

// ---------- PAPERS ----------
function renderPaperTable() {
  const tbody = document.querySelector('#paperTable tbody');
  tbody.innerHTML = '';
  papers.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>
      <button onclick="editPaper(${p.id})">Edit</button>
      <button onclick="deletePaper(${p.id})">Delete</button></td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('paperForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('paperId').value;
  const name = document.getElementById('paperName').value.trim();
  await api(id ? `/api/papers/${id}` : '/api/papers', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
  });
  document.getElementById('paperForm').reset();
  document.getElementById('paperId').value = '';
  await refreshAll();
});
window.editPaper = (id) => {
  const p = papers.find(x => x.id === id);
  document.getElementById('paperId').value = p.id;
  document.getElementById('paperName').value = p.name;
};
window.deletePaper = async (id) => {
  if (!confirm('Delete this paper?')) return;
  await api(`/api/papers/${id}`, { method: 'DELETE' });
  await refreshAll();
};

// ---------- BOOKS ----------
function renderBookPaperCheckboxes(selectedIds = []) {
  const div = document.getElementById('bookPaperCheckboxes');
  div.innerHTML = '';
  papers.forEach(p => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.innerHTML = `<input type="checkbox" value="${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''}> ${escapeHtml(p.name)}`;
    div.appendChild(label);
  });
}
function renderBookTable() {
  renderBookPaperCheckboxes();
  const tbody = document.querySelector('#bookTable tbody');
  tbody.innerHTML = '';
  books.forEach(b => {
    const paperNames = b.paper_ids.map(pid => papers.find(p => p.id === pid)?.name).filter(Boolean).join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(b.name)}</td><td>${escapeHtml(paperNames)}</td><td>
      <button onclick="editBook(${b.id})">Edit</button>
      <button onclick="deleteBook(${b.id})">Delete</button></td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('bookId').value;
  const name = document.getElementById('bookName').value.trim();
  const paper_ids = Array.from(document.querySelectorAll('#bookPaperCheckboxes input:checked')).map(i => parseInt(i.value, 10));
  await api(id ? `/api/books/${id}` : '/api/books', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, paper_ids })
  });
  document.getElementById('bookForm').reset();
  document.getElementById('bookId').value = '';
  await refreshAll();
});
window.editBook = (id) => {
  const b = books.find(x => x.id === id);
  document.getElementById('bookId').value = b.id;
  document.getElementById('bookName').value = b.name;
  renderBookPaperCheckboxes(b.paper_ids);
};
window.deleteBook = async (id) => {
  if (!confirm('Delete this book and all its questions?')) return;
  await api(`/api/books/${id}`, { method: 'DELETE' });
  await refreshAll();
};

// ---------- QUESTIONS (paginated, ownership-scoped for regular admins) ----------
function renderQuestionFilters() {
  const bookSel = document.getElementById('questionBookSelect');
  const currentBook = bookSel.value;
  bookSel.innerHTML = '<option value="">-- select book --</option>';
  books.forEach(b => bookSel.append(new Option(b.name, b.id)));
  if (currentBook) bookSel.value = currentBook;

  const filterSel = document.getElementById('questionFilterBook');
  const currentFilter = filterSel.value;
  filterSel.innerHTML = '<option value="">-- All --</option>';
  books.forEach(b => filterSel.append(new Option(b.name, b.id)));
  if (currentFilter) filterSel.value = currentFilter;
  filterSel.onchange = () => { questionsPage = 1; renderQuestionTable(); };
}

async function renderQuestionTable() {
  const scopeNote = document.getElementById('questionsScopeNote');
  scopeNote.textContent = currentUser.role === 'master_admin'
    ? 'Showing all questions from every admin (master admin view).'
    : 'Showing only questions you created.';

  const book_id = document.getElementById('questionFilterBook').value;
  const params = new URLSearchParams({ paginate: 'true', page: questionsPage, pageSize: QUESTIONS_PAGE_SIZE });
  if (book_id) params.set('book_id', book_id);
  if (currentUser.role === 'admin') params.set('scope', 'mine');

  const res = await api('/api/questions?' + params.toString());
  const payload = res.data || { items: [], total: 0, page: 1, totalPages: 1 };
  const tbody = document.querySelector('#questionTable tbody');
  tbody.innerHTML = '';
  payload.items.forEach(q => {
    const tr = document.createElement('tr');
    const preview = (q.question.text || '').slice(0, 80);
    tr.innerHTML = `<td>${escapeHtml(preview)}</td><td>${escapeHtml(q.book_name || '')}</td><td>
      <button onclick="editQuestion(${q.id})">Edit</button>
      <button onclick="deleteQuestion(${q.id})">Delete</button></td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('questionsPageInfo').textContent = `Page ${payload.page} of ${payload.totalPages} (${payload.total} questions)`;
  document.getElementById('questionsPrevPage').disabled = payload.page <= 1;
  document.getElementById('questionsNextPage').disabled = payload.page >= payload.totalPages;
}
document.getElementById('questionsPrevPage').addEventListener('click', () => { if (questionsPage > 1) { questionsPage--; renderQuestionTable(); } });
document.getElementById('questionsNextPage').addEventListener('click', () => { questionsPage++; renderQuestionTable(); });

document.getElementById('questionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('questionId').value;
  const fd = new FormData();
  fd.append('book_id', document.getElementById('questionBookSelect').value);
  fd.append('question', document.getElementById('question').value);
  ['1', '2', '3', '4'].forEach(n => {
    fd.append(`option${n}`, document.getElementById(`option${n}`).value);
  });
  fd.append('correct_option', document.getElementById('correct_option').value);
  fd.append('explanation', document.getElementById('explanation').value);
  const file = document.getElementById('attachment').files[0];
  if (file) fd.append('attachment', file);

  const url = id ? `/api/questions/${id}` : '/api/questions';
  const res = await fetch(url, { method: id ? 'PUT' : 'POST', body: fd });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    alert(d.error || 'Error saving question');
    return;
  }
  document.getElementById('questionForm').reset();
  document.getElementById('questionId').value = '';
  document.getElementById('currentAttachment').innerHTML = '';
  await renderQuestionTable();
});

window.editQuestion = async (id) => {
  const res = await api(`/api/questions/${id}/raw`);
  if (!res.ok) { alert(res.data && res.data.error ? res.data.error : 'Could not open this question'); return; }
  const q = res.data;
  document.getElementById('questionId').value = q.id;
  document.getElementById('questionBookSelect').value = q.book_id;
  document.getElementById('question').value = q.question;
  q.options.forEach((opt, i) => {
    document.getElementById(`option${i + 1}`).value = opt;
  });
  document.getElementById('correct_option').value = q.correct_option;
  document.getElementById('explanation').value = q.explanation;
  const box = document.getElementById('currentAttachment');
  box.innerHTML = q.attachment_url ? `Current file: <a href="${q.attachment_url}" target="_blank">view</a>` : '';
  document.querySelector('.tab-btn[data-tab="questions"]').click();
};

window.deleteQuestion = async (id) => {
  if (!confirm('Delete this question?')) return;
  const res = await api(`/api/questions/${id}`, { method: 'DELETE' });
  if (!res.ok) { alert(res.data && res.data.error ? res.data.error : 'Could not delete this question'); return; }
  await renderQuestionTable();
};

// ---------- SUGGESTIONS ----------
document.getElementById('suggestionFilterStatus').addEventListener('change', () => { suggestionsPage = 1; renderSuggestionTable(); });

async function renderSuggestionTable() {
  const status = document.getElementById('suggestionFilterStatus').value;
  const params = new URLSearchParams({ page: String(suggestionsPage), pageSize: '10' });
  if (status) params.set('status', status);
  const res = await api('/api/suggestions?' + params.toString());
  const tbody = document.querySelector('#suggestionTable tbody');
  tbody.innerHTML = '';
  (res.data.items || []).forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.question_preview)}</td>
      <td>${escapeHtml(s.book_name || '')}</td>
      <td>${escapeHtml(s.username)}</td>
      <td>${escapeHtml(s.suggestion_text)}</td>
      <td class="status-${s.status}">${s.status}</td>
      <td>
        <button onclick="editQuestion(${s.question_id})">Open question</button>
        ${s.status !== 'reviewed' ? `<button onclick="setSuggestionStatus(${s.id}, 'reviewed')">Mark reviewed</button>` : ''}
        ${s.status !== 'resolved' ? `<button onclick="setSuggestionStatus(${s.id}, 'resolved')">Mark resolved</button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('suggestionsPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} suggestion${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('suggestionsPrevPage').disabled = res.data.page <= 1;
  document.getElementById('suggestionsNextPage').disabled = res.data.page >= res.data.totalPages;
  await refreshSuggestionBadge();
}
window.setSuggestionStatus = async (id, status) => {
  await api(`/api/suggestions/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  await renderSuggestionTable();
};
async function refreshSuggestionBadge() {
  const res = await api('/api/suggestions/pending-count');
  const badge = document.getElementById('suggestionCountBadge');
  badge.textContent = res.data && res.data.count ? `(${res.data.count})` : '';
}
function wireSuggestionsPagination() {
  document.getElementById('suggestionsPrevPage').addEventListener('click', () => { if (suggestionsPage > 1) { suggestionsPage--; renderSuggestionTable(); } });
  document.getElementById('suggestionsNextPage').addEventListener('click', () => { suggestionsPage++; renderSuggestionTable(); });
}

// ---------- USERS ----------
async function renderUserTable() {
  const params = new URLSearchParams({ page: String(usersPage), pageSize: '10' });
  if (usersSearch) params.set('q', usersSearch);
  const res = await api('/api/users?' + params.toString());
  const tbody = document.querySelector('#userTable tbody');
  tbody.innerHTML = '';
  (res.data.items || []).forEach(u => {
    const blocked = u.status === 'blocked';
    const tr = document.createElement('tr');
    const roleCell = (currentUser.role === 'master_admin' && u.role !== 'master_admin')
      ? `<select onchange="changeUserRole(${u.id}, this.value)">
           <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
           <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
         </select>`
      : escapeHtml(u.role);
    let trialCell = '—';
    if (u.role === 'user') {
      trialCell = u.unlimitedAccess ? 'Unlimited' : (u.trialRestricted ? '<span class="status-pending">Restricted (50 Qs)</span>' : 'In 24h trial');
    }
    tr.innerHTML = `
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.mobile || '')}</td>
      <td>${escapeHtml(u.email || '')}</td>
      <td>${roleCell}</td>
      <td class="${blocked ? 'badge-blocked' : 'badge-active'}">${blocked ? 'Blocked' : 'Active'}</td>
      <td>${trialCell}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td>
        ${u.role === 'master_admin' ? '' : `<button onclick="toggleBlock(${u.id}, ${!blocked})">${blocked ? 'Grant access' : 'Block'}</button>`}
        ${u.role === 'user' && !u.unlimitedAccess ? `<button onclick="grantUnlimited(${u.id})">Grant unlimited</button>` : ''}
        ${u.role === 'user' && u.unlimitedAccess ? `<button onclick="revokeUnlimited(${u.id})">Revoke unlimited</button>` : ''}
        <button onclick="openResetPassword(${u.id}, '${escapeHtml(u.username)}')">Reset password</button>
      </td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('usersPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} user${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('usersPrevPage').disabled = res.data.page <= 1;
  document.getElementById('usersNextPage').disabled = res.data.page >= res.data.totalPages;
}
function wireUsersPagination() {
  document.getElementById('usersPrevPage').addEventListener('click', () => { if (usersPage > 1) { usersPage--; renderUserTable(); } });
  document.getElementById('usersNextPage').addEventListener('click', () => { usersPage++; renderUserTable(); });
  let searchTimeout;
  document.getElementById('usersSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { usersSearch = e.target.value.trim(); usersPage = 1; renderUserTable(); }, 300);
  });
}
window.grantUnlimited = async (id) => {
  await api(`/api/users/${id}/unlimited-access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unlimitedAccess: true }) });
  await renderUserTable();
};
window.revokeUnlimited = async (id) => {
  if (!confirm('Revoke unlimited access? They will go back to the 24h/50-question trial limits.')) return;
  await api(`/api/users/${id}/unlimited-access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unlimitedAccess: false }) });
  await renderUserTable();
};
window.toggleBlock = async (id, shouldBlock) => {
  const res = await api(`/api/users/${id}/status`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: shouldBlock ? 'blocked' : 'active' })
  });
  if (!res.ok) { alert(res.data && res.data.error ? res.data.error : 'Could not update user'); return; }
  await renderUserTable();
};
window.changeUserRole = async (id, role) => {
  const res = await api(`/api/users/${id}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
  if (!res.ok) { alert(res.data && res.data.error ? res.data.error : 'Could not update role'); }
  await renderUserTable();
};

// Admin-created users: a temp password is generated and shown once (same pattern as reset-password)
function wireCreateUser() {
  if (currentUser.role === 'master_admin') {
    document.getElementById('newUserRoleAdminOption').classList.remove('hidden');
  }
  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('createUserMsg');
    const resultBox = document.getElementById('createUserResult');
    msg.textContent = '';
    resultBox.classList.add('hidden');

    const body = {
      name: document.getElementById('newUserName').value.trim(),
      username: document.getElementById('newUserUsername').value.trim(),
      mobile: document.getElementById('newUserMobile').value.trim(),
      email: document.getElementById('newUserEmail').value.trim(),
      role: document.getElementById('newUserRole').value
    };
    const res = await api('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { msg.textContent = (res.data && res.data.error) || 'Could not create user'; return; }

    document.getElementById('createUserForm').reset();
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `User created. Temporary password: <strong>${escapeHtml(res.data.tempPassword)}</strong><br>
      <span style="font-size:12px;color:#888">Shown once — copy it and share it with the user directly.</span>`;
    usersPage = 1;
    await renderUserTable();
  });
}

let resetPasswordUserId = null;
function wireModal() {
  document.getElementById('resetPasswordCancel').addEventListener('click', closeResetPassword);
  document.getElementById('resetPasswordConfirm').addEventListener('click', confirmResetPassword);
}
window.openResetPassword = (id, username) => {
  resetPasswordUserId = id;
  document.getElementById('resetPasswordUsername').textContent = username;
  document.getElementById('resetPasswordResult').classList.add('hidden');
  document.getElementById('resetPasswordConfirm').classList.remove('hidden');
  document.getElementById('resetPasswordModal').classList.remove('hidden');
};
function closeResetPassword() {
  document.getElementById('resetPasswordModal').classList.add('hidden');
  resetPasswordUserId = null;
}
async function confirmResetPassword() {
  const res = await api(`/api/users/${resetPasswordUserId}/reset-password`, { method: 'PUT' });
  if (!res.ok) { alert(res.data && res.data.error ? res.data.error : 'Could not reset password'); return; }
  document.getElementById('resetPasswordConfirm').classList.add('hidden');
  const resultBox = document.getElementById('resetPasswordResult');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = `New password: <strong>${escapeHtml(res.data.tempPassword)}</strong><br>
    <span style="font-size:12px;color:#888">Shown once — copy it and share it with the user directly. They should change it after logging in.</span>`;
}

// ---------- EXAM MATERIALS ----------
async function renderMaterialTable() {
  const sel = document.getElementById('materialPaperSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">-- None --</option>';
  papers.forEach(p => sel.append(new Option(p.name, p.id)));
  if (current) sel.value = current;

  const params = new URLSearchParams({ page: String(materialsAdminPage), pageSize: '10' });
  if (materialsAdminSearch) params.set('q', materialsAdminSearch);
  const res = await api('/api/exam-materials?' + params.toString());
  materialsList = res.data.items || [];

  const tbody = document.querySelector('#materialTable tbody');
  tbody.innerHTML = '';
  materialsList.forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.sr_no}</td>
      <td>${escapeHtml(m.paper_name)}</td>
      <td>${escapeHtml(m.material_name)}</td>
      <td>${escapeHtml(m.keywords)}</td>
      <td><a href="${m.download_url}" target="_blank" rel="noopener">Open link</a></td>
      <td>${currentUser.role === 'master_admin' ? `
        <button onclick="editMaterial(${m.id})">Edit</button>
        <button onclick="deleteMaterial(${m.id})">Delete</button>` : ''}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('materialsAdminPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} material${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('materialsAdminPrevPage').disabled = res.data.page <= 1;
  document.getElementById('materialsAdminNextPage').disabled = res.data.page >= res.data.totalPages;
}
document.getElementById('materialForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('materialId').value;
  const body = {
    paper_id: document.getElementById('materialPaperSelect').value || null,
    material_name: document.getElementById('materialName').value.trim(),
    keywords: document.getElementById('materialKeywords').value.trim(),
    download_url: document.getElementById('materialUrl').value.trim()
  };
  await api(id ? `/api/exam-materials/${id}` : '/api/exam-materials', {
    method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  document.getElementById('materialForm').reset();
  document.getElementById('materialId').value = '';
  await renderMaterialTable();
});
window.editMaterial = (id) => {
  const m = materialsList.find(x => x.id === id);
  if (!m) return;
  document.getElementById('materialId').value = m.id;
  document.getElementById('materialPaperSelect').value = m.paper_id || '';
  document.getElementById('materialName').value = m.material_name;
  document.getElementById('materialKeywords').value = m.keywords || '';
  document.getElementById('materialUrl').value = m.download_url;
};
window.deleteMaterial = async (id) => {
  if (!confirm('Delete this exam material entry?')) return;
  await api(`/api/exam-materials/${id}`, { method: 'DELETE' });
  await renderMaterialTable();
};
function wireMaterialsAdmin() {
  document.getElementById('exportMaterialsBtn').addEventListener('click', () => {
    window.location.href = '/api/exam-materials/export';
  });
  document.getElementById('downloadMaterialsTemplateBtn').addEventListener('click', () => {
    window.location.href = '/api/exam-materials/import-template';
  });
  document.getElementById('importMaterialsFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const msgBox = document.getElementById('materialsImportResultMsg');
    msgBox.classList.remove('hidden');
    msgBox.textContent = 'Importing...';

    const response = await fetch('/api/exam-materials/import', { method: 'POST', body: formData });
    const data = await response.json().catch(() => ({}));
    e.target.value = '';
    if (!response.ok) { msgBox.textContent = data.error || 'Import failed'; return; }

    let message = `Added ${data.created} material(s).`;
    if (data.errors && data.errors.length) {
      message += ` ${data.errors.length} row(s) skipped: ${data.errors.slice(0, 5).join(' | ')}${data.errors.length > 5 ? ' ...' : ''}`;
    }
    msgBox.textContent = message;
    materialsAdminPage = 1;
    await renderMaterialTable();
  });
  document.getElementById('materialsAdminPrevPage').addEventListener('click', () => { if (materialsAdminPage > 1) { materialsAdminPage--; renderMaterialTable(); } });
  document.getElementById('materialsAdminNextPage').addEventListener('click', () => { materialsAdminPage++; renderMaterialTable(); });
  let searchTimeout;
  document.getElementById('materialsAdminSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { materialsAdminSearch = e.target.value.trim(); materialsAdminPage = 1; renderMaterialTable(); }, 300);
  });
}

// ---------- CHANGE PASSWORD (admin/master admin) ----------
function wireAdminChangePassword() {
  document.getElementById('adminChangePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('adminPwMsg');
    msg.textContent = '';
    const currentPassword = document.getElementById('adminCurrentPassword').value;
    const newPassword = document.getElementById('adminNewPassword').value;
    const confirmPassword = document.getElementById('adminConfirmNewPassword').value;
    const res = await api('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    if (!res.ok) { msg.textContent = (res.data && res.data.error) || 'Could not update password'; return; }
    msg.style.color = '#2ecc71';
    msg.textContent = 'Password updated.';
    document.getElementById('adminChangePasswordForm').reset();
  });
}

// ---------- USER ENGAGEMENT (master admin only) ----------
let engagementPage = 1;
let userSessionsPage = 1;
let userSessionsUserId = null;

function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

async function renderEngagementTable() {
  const res = await api(`/api/users/engagement?page=${engagementPage}&pageSize=10`);
  if (!res.ok) return;
  const tbody = document.querySelector('#engagementTable tbody');
  tbody.innerHTML = '';
  res.data.items.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.name)}</td>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td>${u.totalSessions}</td>
      <td>${formatDuration(u.totalSeconds)}</td>
      <td>${formatDate(u.lastLoginAt)}</td>
      <td class="${u.online ? 'badge-active' : ''}">${u.online ? 'Online now' : ''}</td>
      <td><button onclick="viewUserSessions(${u.id}, '${escapeHtml(u.name)}')">View sessions</button></td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('engagementPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} user${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('engagementPrevPage').disabled = res.data.page <= 1;
  document.getElementById('engagementNextPage').disabled = res.data.page >= res.data.totalPages;
}

window.viewUserSessions = async (userId, name) => {
  userSessionsUserId = userId;
  userSessionsPage = 1;
  document.getElementById('userSessionsName').textContent = name;
  document.getElementById('userSessionsBox').classList.remove('hidden');
  await renderUserSessionsTable();
};

async function renderUserSessionsTable() {
  const res = await api(`/api/users/${userSessionsUserId}/sessions?page=${userSessionsPage}&pageSize=10`);
  if (!res.ok) return;
  const tbody = document.querySelector('#userSessionsTable tbody');
  tbody.innerHTML = '';
  res.data.items.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.login_at)}</td>
      <td>${s.logout_at ? formatDate(s.logout_at) : '—'}</td>
      <td>${formatDuration(s.duration_seconds)}</td>
      <td>${s.currently_online ? 'Online now' : (s.logout_at ? 'Logged out' : 'Not active')}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('userSessionsPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} session${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('userSessionsPrevPage').disabled = res.data.page <= 1;
  document.getElementById('userSessionsNextPage').disabled = res.data.page >= res.data.totalPages;
}

function wireEngagement() {
  document.getElementById('exportEngagementBtn').addEventListener('click', () => {
    window.location.href = '/api/users/engagement/export';
  });
  document.getElementById('engagementPrevPage').addEventListener('click', () => { if (engagementPage > 1) { engagementPage--; renderEngagementTable(); } });
  document.getElementById('engagementNextPage').addEventListener('click', () => { engagementPage++; renderEngagementTable(); });
  document.getElementById('userSessionsPrevPage').addEventListener('click', () => { if (userSessionsPage > 1) { userSessionsPage--; renderUserSessionsTable(); } });
  document.getElementById('userSessionsNextPage').addEventListener('click', () => { userSessionsPage++; renderUserSessionsTable(); });
  document.querySelector('.tab-btn[data-tab="engagement"]').addEventListener('click', renderEngagementTable);
}

async function renderBackupTable() {
  const status = document.getElementById('backupStatus');
  const tbody = document.querySelector('#backupTable tbody');
  const res = await api('/api/backups');
  if (!res || !res.ok) {
    status.textContent = (res && res.data && res.data.error) || 'Could not load backups.';
    return;
  }

  const backups = res.data.backups || [];
  tbody.innerHTML = '';
  backups.forEach(backup => {
    const row = document.createElement('tr');
    const type = document.createElement('td');
    const created = document.createElement('td');
    const size = document.createElement('td');
    const filename = document.createElement('td');
    const action = document.createElement('td');
    const typeBadge = document.createElement('span');
    const download = document.createElement('a');
    const remove = document.createElement('button');

    typeBadge.className = `backup-type backup-type-${backup.type.toLowerCase()}`;
    typeBadge.textContent = backup.type;
    type.appendChild(typeBadge);
    created.textContent = formatDate(backup.createdAt);
    size.textContent = formatBackupSize(backup.sizeBytes);
    filename.textContent = backup.filename;
    download.href = `/api/backups/${encodeURIComponent(backup.filename)}/download`;
    download.textContent = 'Download';
    action.appendChild(download);
    remove.type = 'button';
    remove.className = 'backup-delete-btn';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete backup "${backup.filename}"? This cannot be undone.`)) return;
      remove.disabled = true;
      const result = await api(`/api/backups/${encodeURIComponent(backup.filename)}`, { method: 'DELETE' });
      if (!result || !result.ok) {
        document.getElementById('backupStatus').textContent = (result && result.data && result.data.error) || 'Could not delete backup.';
        remove.disabled = false;
        return;
      }
      await renderBackupTable();
    });
    action.appendChild(remove);
    row.append(type, created, size, filename, action);
    tbody.appendChild(row);
  });

  document.getElementById('backupEmpty').classList.toggle('hidden', backups.length > 0);
  status.textContent = `${backups.length} backup${backups.length === 1 ? '' : 's'} available`;
}

function formatBackupSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wireBackups() {
  document.getElementById('createBackupBtn').addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = document.getElementById('backupStatus');
    button.disabled = true;
    status.textContent = 'Creating a consistent database snapshot...';

    try {
      const res = await api('/api/backups', { method: 'POST' });
      if (!res || !res.ok) {
        status.textContent = (res && res.data && res.data.error) || 'Could not create a backup.';
        return;
      }
      status.textContent = `Manual backup created: ${res.data.backup.filename}`;
      await renderBackupTable();
    } catch (error) {
      status.textContent = error.message || 'Could not create a backup.';
    } finally {
      button.disabled = false;
    }
  });
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

init();
