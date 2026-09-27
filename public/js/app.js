async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  return { ok: res.ok, status: res.status, data };
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'materials') { materialsPage = 1; loadMaterials(); }
    if (btn.dataset.tab === 'mysuggestions') { mySuggestionsPage = 1; loadMySuggestions(); }
    if (btn.dataset.tab === 'testhistory') { testHistoryPage = 1; loadTestHistory(); }
    if (btn.dataset.tab === 'practicelog') loadPracticeLog();
  });
});

async function init() {
  const me = await api('/api/auth/me');
  if (!me || !me.ok) return;
  document.getElementById('who').textContent = `Hi, ${me.data.user.name || me.data.user.username}`;
  applyTrialBanner(me.data.trial);

  startLiveClock();
  await loadPracticeSelectors();
  await loadTestBookCheckboxes();

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  wirePracticeQuiz();
  wireTestMode();
  wireChangePassword();
  wireProfile();
  wireMaterials();
  wireMySuggestions();
  wireTestHistory();
}

/* ======================================================================
   LIVE CLOCK (India Standard Time) + TRIAL STATUS BANNER
   ====================================================================== */
function formatIST(date) {
  const dateStr = date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return `${dateStr}, ${timeStr} IST`;
}
function startLiveClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const tick = () => { el.textContent = formatIST(new Date()); };
  tick();
  setInterval(tick, 1000);
}
function applyTrialBanner(trial) {
  const banner = document.getElementById('trialBanner');
  if (!trial || !trial.restricted) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  banner.textContent = `Your account is on a limited trial (${trial.used}/${trial.limit} practice questions used). My Test Results and Practice Log are unavailable until an admin upgrades your account.`;
}

/* ======================================================================
   PROFILE (opened via the header icon)
   ====================================================================== */
function wireProfile() {
  document.getElementById('profileIconBtn').addEventListener('click', openProfile);
  document.getElementById('profileCancelBtn').addEventListener('click', closeProfile);
  document.getElementById('profileSaveBtn').addEventListener('click', saveProfile);
}
async function openProfile() {
  const res = await api('/api/auth/profile');
  if (!res.ok) { alert('Could not load profile'); return; }
  document.getElementById('profileName').value = res.data.name || '';
  document.getElementById('profileUsername').value = res.data.username || '';
  document.getElementById('profileMobile').value = res.data.mobile || '';
  document.getElementById('profileEmail').value = res.data.email || '';
  document.getElementById('profileMsg').textContent = '';
  document.getElementById('profileModal').classList.remove('hidden');
}
function closeProfile() {
  document.getElementById('profileModal').classList.add('hidden');
}
async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const mobile = document.getElementById('profileMobile').value.trim();
  const email = document.getElementById('profileEmail').value.trim();
  const res = await api('/api/auth/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mobile, email })
  });
  const msg = document.getElementById('profileMsg');
  if (!res.ok) { msg.textContent = (res.data && res.data.error) || 'Could not save profile'; return; }
  document.getElementById('who').textContent = `Hi, ${res.data.user.name}`;
  closeProfile();
}

/* ======================================================================
   MCQ PRACTICE (multi-select papers/books, instant feedback, self-paced)
   ====================================================================== */
let state = { questions: [], index: 0, answered: {} };
let allPapersForPractice = [];
let allBooksForPractice = [];
let hintExpanded = false;

async function loadPracticeSelectors() {
  const [papersRes, booksRes] = await Promise.all([api('/api/papers'), api('/api/books')]);
  allPapersForPractice = papersRes.data || [];
  allBooksForPractice = booksRes.data || [];

  const paperDiv = document.getElementById('paperCheckboxes');
  paperDiv.innerHTML = '';
  allPapersForPractice.forEach(p => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.innerHTML = `<input type="checkbox" class="paper-check" value="${p.id}"> ${escapeHtml(p.name)}`;
    paperDiv.appendChild(label);
  });
  renderBookCheckboxesForPractice();
}

function renderBookCheckboxesForPractice() {
  const selectedPaperIds = Array.from(document.querySelectorAll('.paper-check:checked')).map(c => parseInt(c.value, 10));
  const bookDiv = document.getElementById('bookCheckboxes');
  const previouslyChecked = Array.from(document.querySelectorAll('.book-check:checked')).map(c => parseInt(c.value, 10));
  bookDiv.innerHTML = '';

  if (!selectedPaperIds.length) {
    bookDiv.innerHTML = '<p class="hint-text">Select at least one paper above to see its books.</p>';
    return;
  }
  const relevantBooks = allBooksForPractice.filter(b => (b.paper_ids || []).some(pid => selectedPaperIds.includes(pid)));
  if (!relevantBooks.length) {
    bookDiv.innerHTML = '<p class="hint-text">No books are linked to the selected paper(s) yet.</p>';
    return;
  }
  relevantBooks.forEach(b => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    const checked = previouslyChecked.includes(b.id) ? 'checked' : '';
    label.innerHTML = `<input type="checkbox" class="book-check" value="${b.id}" ${checked}> ${escapeHtml(b.name)}`;
    bookDiv.appendChild(label);
  });
}

function wirePracticeQuiz() {
  document.getElementById('paperCheckboxes').addEventListener('change', renderBookCheckboxesForPractice);
  document.getElementById('selectAllPapersBtn').addEventListener('click', () => {
    const boxes = document.querySelectorAll('.paper-check');
    const allChecked = Array.from(boxes).every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
    renderBookCheckboxesForPractice();
  });
  document.getElementById('selectAllBooksBtn').addEventListener('click', () => {
    const boxes = document.querySelectorAll('.book-check');
    const allChecked = Array.from(boxes).every(b => b.checked);
    boxes.forEach(b => b.checked = !allChecked);
  });
  document.getElementById('startBtn').addEventListener('click', startQuiz);
  document.getElementById('prevBtn').addEventListener('click', () => go(-1));
  document.getElementById('nextBtn').addEventListener('click', () => go(1));
  document.getElementById('selectorsToggle').addEventListener('click', toggleSelectors);
  document.getElementById('hintBtn').addEventListener('click', toggleHint);
  document.getElementById('suggestToggleBtn').addEventListener('click', openSuggestForm);
  document.getElementById('suggestCancelBtn').addEventListener('click', closeSuggestForm);
  document.getElementById('suggestSubmitBtn').addEventListener('click', submitSuggestion);
}

function setSelectorsCollapsed(collapsed) {
  document.getElementById('selectorsBody').classList.toggle('hidden', collapsed);
  document.getElementById('selectorsToggle').textContent = collapsed ? 'Change ▼' : 'Hide ▲';
}
function toggleSelectors() {
  setSelectorsCollapsed(!document.getElementById('selectorsBody').classList.contains('hidden'));
}

async function startQuiz() {
  const bookIds = Array.from(document.querySelectorAll('.book-check:checked')).map(c => c.value);
  if (!bookIds.length) { alert('Select at least one book first.'); return; }

  const res = await api('/api/questions?book_ids=' + bookIds.join(','));
  const questions = res.data;
  if (!questions || !questions.length) { alert('No questions found for this selection.'); return; }

  state = { questions, index: 0, answered: {} };
  document.getElementById('quiz').classList.remove('hidden');
  setSelectorsCollapsed(true);
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.index];
  document.getElementById('progressBadge').textContent = `(${state.index + 1}/${state.questions.length})`;
  document.getElementById('qText').textContent = q.question.text;

  const optsDiv = document.getElementById('options');
  optsDiv.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt.text;
    btn.dataset.index = i + 1;
    btn.addEventListener('click', () => selectOption(i + 1));
    optsDiv.appendChild(btn);
  });

  hintExpanded = false;
  document.getElementById('explanationBox').classList.add('hidden');
  document.getElementById('attachmentBox').classList.add('hidden');
  document.getElementById('hintBtn').textContent = '💡 Hint';
  closeSuggestForm();

  const prevAnswer = state.answered[q.id];
  if (prevAnswer) showResult(q, prevAnswer);
}

// Selecting an option instantly grades it - no separate "check answer" step.
function selectOption(chosen) {
  const q = state.questions[state.index];
  if (state.answered[q.id]) return; // already graded, ignore further clicks on this question
  state.answered[q.id] = chosen;

  // Fire-and-forget: records this as a practiced question for the Practice Log /
  // trial cap. Server re-derives correctness itself, never trusts the client.
  api('/api/practice/attempt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id: q.id, chosen_option: chosen })
  }).then(res => {
    if (!res.ok && res.data && res.data.error) {
      // Most likely the 50-question trial cap was hit - surface it plainly.
      document.getElementById('trialBanner').classList.remove('hidden');
      document.getElementById('trialBanner').textContent = res.data.error;
    }
  });

  showResult(q, chosen);
}

function showResult(q, chosen) {
  document.querySelectorAll('#options .option-btn').forEach(b => {
    const idx = parseInt(b.dataset.index, 10);
    b.classList.remove('correct-light', 'incorrect-light');
    if (idx === q.correct_option) b.classList.add('correct-light');
    else if (idx === chosen) b.classList.add('incorrect-light');
  });
}

function renderAttachment(boxId, contentId, q) {
  document.getElementById(boxId).classList.remove('hidden');
  const box = document.getElementById(contentId);
  box.innerHTML = '';
  if (q.attachment_type === 'pdf') {
    const link = document.createElement('a');
    link.href = q.attachment_url; link.target = '_blank'; link.textContent = 'Open PDF reference';
    box.appendChild(link);
  } else {
    const img = document.createElement('img');
    img.src = q.attachment_url; img.className = 'attachment-img';
    box.appendChild(img);
  }
}

// Toggles: first click expands the explanation/attachment, second click collapses it again.
function toggleHint() {
  const q = state.questions[state.index];
  hintExpanded = !hintExpanded;
  document.getElementById('hintBtn').textContent = hintExpanded ? '💡 Hide Hint' : '💡 Hint';

  if (!hintExpanded) {
    document.getElementById('explanationBox').classList.add('hidden');
    document.getElementById('attachmentBox').classList.add('hidden');
    return;
  }
  if (!q.explanation.text) { alert('No explanation was added for this question.'); hintExpanded = false; document.getElementById('hintBtn').textContent = '💡 Hint'; return; }
  document.getElementById('explanationBox').classList.remove('hidden');
  document.getElementById('explanationText').textContent = q.explanation.text;
  if (q.attachment_url) renderAttachment('attachmentBox', 'attachmentContent', q);
}

function go(dir) {
  const newIndex = state.index + dir;
  if (newIndex < 0 || newIndex >= state.questions.length) return;
  state.index = newIndex;
  renderQuestion();
}

function openSuggestForm() {
  document.getElementById('suggestForm').classList.remove('hidden');
  document.getElementById('suggestToggleBtn').classList.add('hidden');
  document.getElementById('suggestMsg').classList.add('hidden');
}
function closeSuggestForm() {
  document.getElementById('suggestForm').classList.add('hidden');
  document.getElementById('suggestToggleBtn').classList.remove('hidden');
  document.getElementById('suggestText').value = '';
}
async function submitSuggestion() {
  const text = document.getElementById('suggestText').value.trim();
  if (!text) { alert('Please describe the correction first.'); return; }
  const q = state.questions[state.index];
  const res = await api('/api/suggestions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_id: q.id, suggestion_text: text })
  });
  if (!res.ok) { alert('Could not send suggestion, please try again.'); return; }
  document.getElementById('suggestForm').classList.add('hidden');
  document.getElementById('suggestToggleBtn').classList.remove('hidden');
  document.getElementById('suggestMsg').classList.remove('hidden');
  document.getElementById('suggestText').value = '';
}

/* ======================================================================
   TAKE A TEST (timed, randomized, multi-book)
   ====================================================================== */
let testState = null; // { questions, index, answers:{qid:opt}, visited:Set, timerInterval, secondsLeft }

async function loadTestBookCheckboxes() {
  const res = await api('/api/books');
  const div = document.getElementById('testBookCheckboxes');
  div.innerHTML = '';
  (res.data || []).forEach(b => {
    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.innerHTML = `<input type="checkbox" value="${b.id}"> ${escapeHtml(b.name)}`;
    div.appendChild(label);
  });
}

function wireTestMode() {
  document.getElementById('testStartBtn').addEventListener('click', startTest);
  document.getElementById('testPrevBtn').addEventListener('click', () => testGo(-1));
  document.getElementById('testNextBtn').addEventListener('click', () => testGo(1));
  document.getElementById('testSkipBtn').addEventListener('click', () => { testGo(1); });
  document.getElementById('testSubmitBtn').addEventListener('click', () => submitTest(false));
  document.getElementById('testReviewBtn').addEventListener('click', toggleReview);
  document.getElementById('testRetakeBtn').addEventListener('click', resetTestUI);
}

async function startTest() {
  const bookIds = Array.from(document.querySelectorAll('#testBookCheckboxes input:checked')).map(i => i.value);
  if (!bookIds.length) { alert('Select at least one book.'); return; }
  const count = parseInt(document.getElementById('testCount').value, 10) || 25;
  const minutes = parseInt(document.getElementById('testMinutes').value, 10) || 50;

  const params = new URLSearchParams({ book_ids: bookIds.join(','), count: String(count) });
  const res = await api('/api/test?' + params.toString());
  if (!res.ok || !res.data.questions.length) { alert('No questions found for the selected books.'); return; }

  testState = {
    questions: res.data.questions,
    index: 0,
    answers: {},
    visited: new Set(),
    secondsLeft: minutes * 60,
    startedAt: Date.now()
  };

  document.getElementById('testSetup').classList.add('hidden');
  document.getElementById('testResults').classList.add('hidden');
  document.getElementById('testRunner').classList.remove('hidden');

  buildTestNavGrid();
  renderTestQuestion();
  startTestTimer();
}

function startTestTimer() {
  updateTimerDisplay();
  testState.timerInterval = setInterval(() => {
    testState.secondsLeft--;
    updateTimerDisplay();
    if (testState.secondsLeft <= 0) {
      clearInterval(testState.timerInterval);
      submitTest(true);
    }
  }, 1000);
}
function updateTimerDisplay() {
  const m = Math.max(Math.floor(testState.secondsLeft / 60), 0);
  const s = Math.max(testState.secondsLeft % 60, 0);
  document.getElementById('testTimer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildTestNavGrid() {
  const grid = document.getElementById('testNavGrid');
  grid.innerHTML = '';
  testState.questions.forEach((q, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'nav-cell';
    cell.textContent = i + 1;
    cell.dataset.index = i;
    cell.addEventListener('click', () => { testState.index = i; renderTestQuestion(); });
    grid.appendChild(cell);
  });
}

function refreshTestNavGrid() {
  document.querySelectorAll('#testNavGrid .nav-cell').forEach(cell => {
    const i = parseInt(cell.dataset.index, 10);
    const q = testState.questions[i];
    cell.classList.remove('nav-answered', 'nav-skipped', 'nav-current');
    if (testState.answers[q.id]) cell.classList.add('nav-answered');
    else if (testState.visited.has(i)) cell.classList.add('nav-skipped');
    if (i === testState.index) cell.classList.add('nav-current');
  });
}

function renderTestQuestion() {
  testState.visited.add(testState.index);
  const q = testState.questions[testState.index];
  document.getElementById('testProgressBadge').textContent = `(${testState.index + 1}/${testState.questions.length})`;
  document.getElementById('testQText').textContent = q.question.text;

  const optsDiv = document.getElementById('testOptions');
  optsDiv.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt.text;
    btn.dataset.index = i + 1;
    if (testState.answers[q.id] === i + 1) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      testState.answers[q.id] = i + 1;
      renderTestQuestion();
    });
    optsDiv.appendChild(btn);
  });
  refreshTestNavGrid();
}

function testGo(dir) {
  const newIndex = testState.index + dir;
  if (newIndex < 0 || newIndex >= testState.questions.length) return;
  testState.index = newIndex;
  renderTestQuestion();
}

async function submitTest(auto) {
  if (testState.timerInterval) clearInterval(testState.timerInterval);
  if (!auto && !confirm('Submit the test now?')) return;

  let correct = 0, wrong = 0, unattempted = 0;
  testState.questions.forEach(q => {
    const chosen = testState.answers[q.id];
    if (!chosen) unattempted++;
    else if (chosen === q.correct_option) correct++;
    else wrong++;
  });

  document.getElementById('testRunner').classList.add('hidden');
  document.getElementById('testResults').classList.remove('hidden');
  document.getElementById('testResultSummary').innerHTML = `
    <p><strong>Score: ${correct} / ${testState.questions.length}</strong></p>
    <p>Correct: ${correct} &nbsp; Wrong: ${wrong} &nbsp; Not attempted: ${unattempted}</p>
    ${auto ? '<p><em>Time is up — the test was submitted automatically.</em></p>' : ''}
  `;
  document.getElementById('testReviewList').innerHTML = '';
  document.getElementById('testReviewList').classList.add('hidden');
  document.getElementById('testReviewBtn').textContent = 'Review Answers';

  // Save the result server-side (server re-scores from the correct answers on file,
  // it doesn't trust this client's tally) so it shows up under "My Test Results".
  const durationSeconds = Math.round((Date.now() - testState.startedAt) / 1000);
  const answers = testState.questions.map(q => ({ question_id: q.id, chosen_option: testState.answers[q.id] || null }));
  await api('/api/test/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, duration_seconds: durationSeconds, total_questions: testState.questions.length })
  });
}

function toggleReview() {
  const list = document.getElementById('testReviewList');
  const btn = document.getElementById('testReviewBtn');
  if (!list.classList.contains('hidden')) { list.classList.add('hidden'); btn.textContent = 'Review Answers'; return; }

  list.innerHTML = '';
  testState.questions.forEach((q, i) => {
    const chosen = testState.answers[q.id];
    const div = document.createElement('div');
    div.className = 'review-item';
    const chosenText = chosen ? q.options[chosen - 1].text : '(not attempted)';
    const correctText = q.options[q.correct_option - 1].text;
    div.innerHTML = `
      <p><strong>Q${i + 1}.</strong> ${escapeHtml(q.question.text)}</p>
      <p class="${chosen === q.correct_option ? 'answer-correct' : 'answer-wrong'}">Your answer: ${escapeHtml(chosenText)}</p>
      ${chosen !== q.correct_option ? `<p class="answer-correct">Correct answer: ${escapeHtml(correctText)}</p>` : ''}
      ${q.explanation.text ? `<p class="review-explanation">${escapeHtml(q.explanation.text)}</p>` : ''}
    `;
    list.appendChild(div);
  });
  list.classList.remove('hidden');
  btn.textContent = 'Hide Review';
}

function resetTestUI() {
  document.getElementById('testResults').classList.add('hidden');
  document.getElementById('testRunner').classList.add('hidden');
  document.getElementById('testSetup').classList.remove('hidden');
  testState = null;
}

/* ======================================================================
   EXAM MATERIALS (download links, master-admin managed, searchable)
   ====================================================================== */
let materialsPage = 1;
let materialsSearch = '';
let materialsPaperFilter = '';

async function loadMaterials() {
  const params = new URLSearchParams({ page: String(materialsPage), pageSize: '10' });
  if (materialsSearch) params.set('q', materialsSearch);
  if (materialsPaperFilter) params.set('paper_id', materialsPaperFilter);
  const res = await api('/api/exam-materials?' + params.toString());
  if (!res.ok) return;

  const tbody = document.querySelector('#materialsTable tbody');
  tbody.innerHTML = '';
  (res.data.items || []).forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.sr_no}</td>
      <td>${escapeHtml(m.paper_name)}</td>
      <td>${escapeHtml(m.material_name)}</td>
      <td>${escapeHtml(m.keywords)}</td>
      <td><a href="${m.download_url}" target="_blank" rel="noopener" title="Download">⬇️ Download</a></td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('materialsPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} material${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('materialsPrevPage').disabled = res.data.page <= 1;
  document.getElementById('materialsNextPage').disabled = res.data.page >= res.data.totalPages;
}

async function loadMaterialsPaperFilterOptions() {
  const res = await api('/api/papers');
  const sel = document.getElementById('materialsFilterPaper');
  (res.data || []).forEach(p => sel.append(new Option(p.name, p.id)));
}

function wireMaterials() {
  document.getElementById('materialsPrevPage').addEventListener('click', () => { if (materialsPage > 1) { materialsPage--; loadMaterials(); } });
  document.getElementById('materialsNextPage').addEventListener('click', () => { materialsPage++; loadMaterials(); });
  document.getElementById('materialsFilterPaper').addEventListener('change', (e) => { materialsPaperFilter = e.target.value; materialsPage = 1; loadMaterials(); });
  let searchTimeout;
  document.getElementById('materialsSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { materialsSearch = e.target.value.trim(); materialsPage = 1; loadMaterials(); }, 300);
  });
  loadMaterialsPaperFilterOptions();
}

/* ======================================================================
   MY SUGGESTIONS
   ====================================================================== */
let mySuggestionsPage = 1;

async function loadMySuggestions() {
  const res = await api(`/api/suggestions/mine?page=${mySuggestionsPage}&pageSize=10`);
  if (!res.ok) return;

  const tbody = document.querySelector('#mySuggestionsTable tbody');
  tbody.innerHTML = '';
  (res.data.items || []).forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.question_preview)}</td>
      <td>${escapeHtml(s.book_name)}</td>
      <td>${escapeHtml(s.suggestion_text)}</td>
      <td class="status-${s.status}">${s.status}</td>
      <td>${escapeHtml(s.admin_note || '')}</td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('mySuggestionsPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} suggestion${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('mySuggestionsPrevPage').disabled = res.data.page <= 1;
  document.getElementById('mySuggestionsNextPage').disabled = res.data.page >= res.data.totalPages;
}

function wireMySuggestions() {
  document.getElementById('mySuggestionsPrevPage').addEventListener('click', () => { if (mySuggestionsPage > 1) { mySuggestionsPage--; loadMySuggestions(); } });
  document.getElementById('mySuggestionsNextPage').addEventListener('click', () => { mySuggestionsPage++; loadMySuggestions(); });
}

/* ======================================================================
   MY TEST RESULTS (past "Take a Test" attempts)
   ====================================================================== */
let testHistoryPage = 1;

async function loadTestHistory() {
  document.getElementById('testHistoryReview').classList.add('hidden');
  const lockedBox = document.getElementById('testHistoryLocked');
  const res = await api(`/api/test/attempts?page=${testHistoryPage}&pageSize=10`);
  if (!res.ok) {
    lockedBox.textContent = (res.data && res.data.error) || 'Not available.';
    lockedBox.classList.remove('hidden');
    document.getElementById('testHistoryTable').classList.add('hidden');
    return;
  }
  lockedBox.classList.add('hidden');
  document.getElementById('testHistoryTable').classList.remove('hidden');

  const tbody = document.querySelector('#testHistoryTable tbody');
  tbody.innerHTML = '';
  (res.data.items || []).forEach(a => {
    const date = new Date(a.created_at).toLocaleString();
    const mins = Math.floor(a.duration_seconds / 60);
    const secs = a.duration_seconds % 60;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(date)}</td>
      <td><strong>${a.correct_count} / ${a.total_questions}</strong></td>
      <td>${a.attempted} / ${a.total_questions}</td>
      <td>${mins}m ${secs}s</td>
      <td>
        <button onclick="reviewTestAttempt(${a.id})">Review</button>
        <button onclick="deleteTestAttempt(${a.id})" class="secondary-btn">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('testHistoryPageInfo').textContent = `Page ${res.data.page} of ${res.data.totalPages} (${res.data.total} attempt${res.data.total === 1 ? '' : 's'})`;
  document.getElementById('testHistoryPrevPage').disabled = res.data.page <= 1;
  document.getElementById('testHistoryNextPage').disabled = res.data.page >= res.data.totalPages;
}

async function deleteTestAttempt(id) {
  if (!confirm('Delete this test result? This cannot be undone.')) return;
  const res = await api(`/api/test/attempts/${id}`, { method: 'DELETE' });
  if (!res.ok) { alert((res.data && res.data.error) || 'Could not delete this result.'); return; }
  await loadTestHistory();
}

async function reviewTestAttempt(id) {
  const res = await api(`/api/test/attempts/${id}`);
  if (!res.ok) { alert('Could not load that attempt.'); return; }
  const box = document.getElementById('testHistoryReview');
  const a = res.data;
  let html = `<h4>Result: ${a.correct_count} / ${a.total_questions}</h4>`;
  a.items.forEach((item, i) => {
    const chosenText = item.chosen_option ? (item.options[item.chosen_option - 1]?.text || '') : '(not attempted)';
    const correctText = item.options[item.correct_option - 1]?.text || '';
    html += `
      <div class="review-item">
        <p><strong>Q${i + 1}.</strong> ${escapeHtml(item.question.text)}</p>
        <p class="${item.is_correct ? 'answer-correct' : 'answer-wrong'}">Your answer: ${escapeHtml(chosenText)}</p>
        ${!item.is_correct ? `<p class="answer-correct">Correct answer: ${escapeHtml(correctText)}</p>` : ''}
        ${item.explanation.text ? `<p class="review-explanation">${escapeHtml(item.explanation.text)}</p>` : ''}
      </div>`;
  });
  box.innerHTML = html;
  box.classList.remove('hidden');
}

function wireTestHistory() {
  document.getElementById('testHistoryPrevPage').addEventListener('click', () => { if (testHistoryPage > 1) { testHistoryPage--; loadTestHistory(); } });
  document.getElementById('testHistoryNextPage').addEventListener('click', () => { testHistoryPage++; loadTestHistory(); });
}

/* ======================================================================
   CHANGE PASSWORD
   ====================================================================== */
function wireChangePassword() {
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pwMsg');
    msg.textContent = '';
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const res = await api('/api/auth/change-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
    if (!res.ok) { msg.textContent = res.data.error || 'Could not update password'; return; }
    msg.style.color = '#2ecc71';
    msg.textContent = 'Password updated.';
    document.getElementById('changePasswordForm').reset();
  });
}

/* ======================================================================
   PRACTICE LOG (how many of each book's questions have been practiced)
   ====================================================================== */
async function loadPracticeLog() {
  const lockedBox = document.getElementById('practiceLogLocked');
  const res = await api('/api/practice/log');
  if (!res.ok) {
    lockedBox.textContent = (res.data && res.data.error) || 'Not available.';
    lockedBox.classList.remove('hidden');
    document.getElementById('practiceLogTable').classList.add('hidden');
    return;
  }
  lockedBox.classList.add('hidden');
  document.getElementById('practiceLogTable').classList.remove('hidden');

  const tbody = document.querySelector('#practiceLogTable tbody');
  const tfoot = document.querySelector('#practiceLogTable tfoot');
  tbody.innerHTML = '';
  tfoot.innerHTML = '';

  (res.data.items || []).forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.sr_no}</td>
      <td>${escapeHtml(row.paper_name || '—')}</td>
      <td>${escapeHtml(row.book_name)}</td>
      <td>${row.total_questions}</td>
      <td>${row.attended_questions}</td>
      <td>${row.percentage}%</td>
    `;
    tbody.appendChild(tr);
  });

  const t = res.data.totals || { total_questions: 0, attended_questions: 0, percentage: 0 };
  const totalRow = document.createElement('tr');
  totalRow.className = 'practice-log-total-row';
  totalRow.innerHTML = `<td colspan="3"><strong>Total</strong></td><td><strong>${t.total_questions}</strong></td><td><strong>${t.attended_questions}</strong></td><td><strong>${t.percentage}%</strong></td>`;
  tfoot.appendChild(totalRow);
}

function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

init();
