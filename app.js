/* =========================
   消費税法 暗記アプリ + Google Sheets 同期（GIS対応・安全同期）
   - 同期UIは C タブのみ
   - HARD_CODED_SHEET_ID があればそれを使用（設定UIは自動で隠す）
   - 起動（ログイン直後）は Pull→マージのみ
   - 変更は outbox に積んで「今すぐ同期」で Push
   - 削除は deleted:true のソフト削除
   ========================= */

(() => {
  /* ======= 埋め込み設定（ここだけ編集すればOK） ======= */
  const CONFIG = {
    OAUTH_CLIENT_ID: '727845914673-nmvo6be9cfd6rt8ijir6r14fnfhoqoo7.apps.googleusercontent.com',
    HARD_CODED_SHEET_ID: '1jQExW8ayeDhaDZ3E2PN7GWJRZ9TNCSTFFW0EFSoVn3M',  // ← ここに Spreadsheet ID を入れるとUIが隠れ、そのIDを使用します。空ならUI入力。
    SHEET_PROBLEMS: 'Problems',
    SHEET_DAILY: 'Daily',
  };

  // ======= ストレージ鍵
  const LS_KEYS = {
    PROBLEMS: 'problems_v1',
    APPSTATE: 'app_state_v1',
    DAILYSTATS: 'daily_stats_v1',
    DAILYTHRESH: 'daily_thresholds_v1',
    OUTBOX: 'outbox_v1',
    SYNC: 'sync_settings_v1',
    CLOUD_INDEX: 'cloud_index_v1',
  };

  // ======= 状態
  let problems = loadJSON(LS_KEYS.PROBLEMS, []);
  let appState = loadJSON(LS_KEYS.APPSTATE, {
    recentQueue: [],
    forcedQueue: [],
    lastPastedHTML: "",
  });
  let dailyStats = loadJSON(LS_KEYS.DAILYSTATS, {});
  let dailyThresholds = loadJSON(LS_KEYS.DAILYTHRESH, {});
  let outbox = loadJSON(LS_KEYS.OUTBOX, []);
  let cloudIndex = loadJSON(LS_KEYS.CLOUD_INDEX, { problems: {}, daily: {} });

  // 同期設定（ローカル設定＋CONFIGの上書き）
  let syncSettings = loadJSON(LS_KEYS.SYNC, {
    clientId: CONFIG.OAUTH_CLIENT_ID,
    sheetId: '',
    sheetProblems: CONFIG.SHEET_PROBLEMS,
    sheetDaily: CONFIG.SHEET_DAILY,
  });
  // ハードコードIDがあれば採用
  if (CONFIG.HARD_CODED_SHEET_ID) {
    syncSettings.sheetId = CONFIG.HARD_CODED_SHEET_ID;
  }

  // ======= DOM 参照
  const tabButtons = document.querySelectorAll('.tab-btn');
  const pages = document.querySelectorAll('.page');

  // A
  const startAllBtn = document.getElementById('startAllBtn');
  const startByCatBtn = document.getElementById('startByCatBtn');
  const questionContainer = document.getElementById('questionContainer');
  const revealBtn = document.getElementById('revealBtn');
  const judgeBtns = document.getElementById('judgeBtns');

  // B
  const editor = document.getElementById('editor');
  const maskBtn = document.getElementById('maskBtn');
  const unmaskAllBtn = document.getElementById('unmaskAllBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const clearDraftBtn = document.getElementById('clearDraftBtn');
  const catInput = document.getElementById('catInput');
  const saveProblemBtn = document.getElementById('saveProblemBtn');

  // C（同期UIもここ）
  const problemList = document.getElementById('problemList');
  const catChips = document.getElementById('catChips');
  const clearCatFilterBtn = document.getElementById('clearCatFilterBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const importJsonInput = document.getElementById('importJsonInput');

  const syncBadge = document.getElementById('syncBadge');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const syncNowBtn = document.getElementById('syncNowBtn');
  const syncSettingsDetails = document.getElementById('syncSettingsDetails');
  const sheetIdInput = document.getElementById('sheetIdInput');
  const sheetProblemsInput = document.getElementById('sheetProblemsInput');
  const sheetDailyInput = document.getElementById('sheetDailyInput');
  const saveSyncSettingsBtn = document.getElementById('saveSyncSettingsBtn');

  // D
  const progressCanvas = document.getElementById('progressChart');
  const dailyList = document.getElementById('dailyList');
  let progressChart = null;

  // モーダル
  const catModal = document.getElementById('catModal');
  const catModalBody = document.getElementById('catModalBody');
  const catModalCancel = document.getElementById('catModalCancel');
  const catModalStart = document.getElementById('catModalStart');

  const editModal = document.getElementById('editModal');
  const editEditor = document.getElementById('editEditor');
  const editCatInput = document.getElementById('editCatInput');
  const editMaskBtn = document.getElementById('editMaskBtn');
  const editUnmaskAllBtn = document.getElementById('editUnmaskAllBtn');
  const editCancelBtn = document.getElementById('editCancelBtn');
  const editSaveBtn = document.getElementById('editSaveBtn');
  const editMeta = document.getElementById('editMeta');

  // ======= ユーティリティ
  function saveAll() {
    saveJSON(LS_KEYS.PROBLEMS, problems);
    saveJSON(LS_KEYS.APPSTATE, appState);
    saveJSON(LS_KEYS.DAILYSTATS, dailyStats);
    saveJSON(LS_KEYS.DAILYTHRESH, dailyThresholds);
    saveJSON(LS_KEYS.OUTBOX, outbox);
    saveJSON(LS_KEYS.CLOUD_INDEX, cloudIndex);
    saveJSON(LS_KEYS.SYNC, syncSettings);
  }
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function uuid() { return 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    return `${yyyy}${mm}${dd}`;
  }
  function clamp(n, min, max){ return Math.min(max, Math.max(min, n)); }

  function firstSentenceFromHTML(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const t = (div.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) return '(空)';
    const dot = t.indexOf('。');
    if (dot >= 0) return t.slice(0, Math.min(dot+1, 120));
    return t.slice(0, 100) + (t.length > 100 ? '…' : '');
  }
  function parseCategories(inputStr){
    return inputStr.split(',').map(s => s.trim()).filter(Boolean);
  }
  function extractAnswersFrom(el) {
    return Array.from(el.querySelectorAll('.mask')).map(e => (e.textContent || '').trim()).filter(Boolean);
  }
  function unmaskAllIn(el) {
    el.querySelectorAll('.mask').forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
  }
  function toggleMaskSelection(rootEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!rootEditable.contains(range.commonAncestorContainer)) return;
    if (range.collapsed) return;
    let anc = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest('.mask');
    if (inMask) {
      const target = inMask; const parent = target.parentNode;
      while (target.firstChild) parent.insertBefore(target.firstChild, target);
      parent.removeChild(target); return;
    }
    try {
      const span = document.createElement('span'); span.className = 'mask';
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      const wrap = document.createElement('span'); wrap.className = 'mask';
      wrap.appendChild(frag); range.insertNode(wrap);
    }
  }
  function sanitizeHTML(html) {
    const div = document.createElement('div'); div.innerHTML = html;
    div.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
    div.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => { if (/^on/i.test(attr.name)) el.removeAttribute(attr.name); });
    });
    return div.innerHTML;
  }

  // ======= タブ切替
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      pages.forEach(p => p.classList.remove('show'));
      document.querySelector(target).classList.add('show');
      if (target === '#tab-c') renderC();
      if (target === '#tab-d') renderD();
    });
  });

  /* ======================
     B: 問題作成
     ====================== */
  editor.addEventListener('paste', () => {
    setTimeout(() => { appState.lastPastedHTML = editor.innerHTML; saveAll(); }, 0);
  });
  maskBtn.addEventListener('click', () => toggleMaskSelection(editor));
  unmaskAllBtn.addEventListener('click', () => unmaskAllIn(editor));
  repeatBtn.addEventListener('click', () => { if (appState.lastPastedHTML) editor.innerHTML = appState.lastPastedHTML; });
  clearDraftBtn.addEventListener('click', () => { editor.innerHTML = ''; catInput.value = ''; });

  saveProblemBtn.addEventListener('click', () => {
    const html = editor.innerHTML.trim();
    if (!html) { alert('長文を入力してください。'); return; }
    const answers = extractAnswersFrom(editor);
    if (answers.length === 0) { if (!confirm('マスクがありません。保存しますか？')) return; }
    const categories = parseCategories(catInput.value);
    const now = Date.now();
    const id = uuid();
    problems.push({
      id, html, answers, categories,
      score: 0, answerCount: 0, correctCount: 0,
      deleted: false, createdAt: now, updatedAt: now
    });
    outbox.push({ kind: 'problem', id, op: 'upsert', updatedAt: now });
    saveAll();
    editor.innerHTML = ''; catInput.value = '';
    alert('保存しました。（Cタブに反映 & 同期キューに追加）');
  });

  /* ======================
     C: 編集・確認（＋同期UI制御）
     ====================== */
  let currentCatFilter = [];
  function renderC(){ renderCategoryChips(); renderProblemList(); setupSyncUIVisibility(); }
  function setupSyncUIVisibility(){
    // HARD_CODED_SHEET_ID があれば設定UIを隠す＆入力欄に値を反映して disable
    if (CONFIG.HARD_CODED_SHEET_ID) {
      sheetIdInput.value = CONFIG.HARD_CODED_SHEET_ID;
      sheetIdInput.disabled = true;
      sheetProblemsInput.value = CONFIG.SHEET_PROBLEMS;
      sheetDailyInput.value = CONFIG.SHEET_DAILY;
      sheetProblemsInput.disabled = true;
      sheetDailyInput.disabled = true;
      // <details> 自体を非表示
      if (syncSettingsDetails) syncSettingsDetails.style.display = 'none';
    }
  }
  function renderCategoryChips(){
    const allCats = new Set();
    problems.filter(p=>!p.deleted).forEach(p => (p.categories || []).forEach(c => allCats.add(c)));
    const cats = Array.from(allCats).sort((a,b) => a.localeCompare(b, 'ja'));
    catChips.innerHTML = '';
    cats.forEach(cat => {
      const label = document.createElement('label'); label.className = 'chip';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = cat;
      cb.checked = currentCatFilter.includes(cat);
      cb.addEventListener('change', () => {
        if (cb.checked) currentCatFilter.push(cat);
        else currentCatFilter = currentCatFilter.filter(c => c !== cat);
        renderProblemList();
      });
      label.appendChild(cb); label.appendChild(document.createTextNode(cat));
      catChips.appendChild(label);
    });
  }
  clearCatFilterBtn.addEventListener('click', () => { currentCatFilter = []; renderCategoryChips(); renderProblemList(); });
  function problemMatchesFilter(p){
    if (p.deleted) return false;
    if (currentCatFilter.length === 0) return true;
    if (!p.categories || p.categories.length === 0) return false;
    return p.categories.some(c => currentCatFilter.includes(c));
  }
  function renderProblemList(){
    problemList.innerHTML = '';
    const filtered = problems.filter(problemMatchesFilter);
    filtered.forEach((p, idx) => {
      const div = document.createElement('div'); div.className = 'problem-item';
      const title = document.createElement('div'); title.className = 'item-title';
      title.textContent = `No.${idx+1}　${firstSentenceFromHTML(p.html)}`;
      const sub = document.createElement('div'); sub.className = 'item-sub';
      const s1 = document.createElement('span'); s1.textContent = `スコア: ${p.score.toFixed(1)}`;
      const s2 = document.createElement('span'); s2.textContent = `正答/回答: ${p.correctCount}/${p.answerCount}`;
      const btnEdit = document.createElement('button'); btnEdit.className = 'btn'; btnEdit.textContent = '編集';
      btnEdit.addEventListener('click', () => openEditModal(p.id));
      const btnDel = document.createElement('button'); btnDel.className = 'btn'; btnDel.textContent = '削除';
      btnDel.addEventListener('click', () => {
        if (!confirm('この問題を削除（ソフト）しますか？')) return;
        p.deleted = true; p.updatedAt = Date.now();
        outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt:p.updatedAt });
        saveAll(); renderC();
      });
      sub.appendChild(s1); sub.appendChild(s2); sub.appendChild(btnEdit); sub.appendChild(btnDel);
      div.appendChild(title); div.appendChild(sub); problemList.appendChild(div);
    });
    if (filtered.length === 0) {
      const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = '該当する問題がありません。';
      problemList.appendChild(empty);
    }
  }

  exportJsonBtn.addEventListener('click', () => {
    const payload = { problems, dailyStats, dailyThresholds };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    a.href = url; a.download = `anki_export_${stamp}.json`; a.click(); URL.revokeObjectURL(url);
  });

  importJsonInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text(); const data = JSON.parse(text);
      if (Array.isArray(data.problems)) {
        const map = new Map(problems.map(p => [p.id, p])); data.problems.forEach(p => map.set(p.id, p)); problems = Array.from(map.values());
      }
      if (data.dailyStats && typeof data.dailyStats === 'object') { dailyStats = {...dailyStats, ...data.dailyStats}; }
      if (data.dailyThresholds && typeof data.dailyThresholds === 'object') { dailyThresholds = {...dailyThresholds, ...data.dailyThresholds}; }
      saveAll(); renderC(); alert('インポートしました。');
    } catch (err) { console.error(err); alert('JSONの読み込みに失敗しました。'); }
    finally { importJsonInput.value = ''; }
  });

  // ====== C 詳細編集モーダル
  let editingId = null;
  function openEditModal(id){
    const p = problems.find(x => x.id === id); if (!p) return;
    editingId = id;
    editModal.classList.remove('hidden'); editModal.setAttribute('aria-hidden', 'false');
    editEditor.classList.add('editing');
    const sanitized = sanitizeHTML(p.html);
    requestAnimationFrame(() => {
      editEditor.innerHTML = sanitized;
      const range = document.createRange(); range.selectNodeContents(editEditor); range.collapse(false);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); editEditor.focus();
    });
    editCatInput.value = (p.categories || []).join(', ');
    editMeta.textContent = `正答: ${p.correctCount} / 回答: ${p.answerCount} / スコア: ${p.score.toFixed(1)}`;
  }
  function closeEditModal(){
    editingId = null; editModal.classList.add('hidden'); editModal.setAttribute('aria-hidden', 'true');
    editEditor.classList.remove('editing'); editEditor.innerHTML = '';
  }
  editMaskBtn.addEventListener('click', () => toggleMaskSelection(editEditor));
  editUnmaskAllBtn.addEventListener('click', () => unmaskAllIn(editEditor));
  editCancelBtn.addEventListener('click', () => closeEditModal());
  editSaveBtn.addEventListener('click', () => {
    const p = problems.find(x => x.id === editingId); if (!p) return;
    p.html = editEditor.innerHTML.trim();
    p.answers = extractAnswersFrom(editEditor);
    p.categories = parseCategories(editCatInput.value);
    p.updatedAt = Date.now();
    outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt:p.updatedAt });
    saveAll(); closeEditModal(); renderC();
  });
  document.querySelectorAll('.modal-backdrop').forEach(b => {
    b.addEventListener('click', () => {
      if (!catModal.classList.contains('hidden')) { catModal.classList.add('hidden'); catModal.setAttribute('aria-hidden','true'); }
      if (!editModal.classList.contains('hidden')) closeEditModal();
    });
  });
  editModal.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); editSaveBtn.click(); }
    if (e.key === 'Escape') { e.preventDefault(); editCancelBtn.click(); }
  });

  /* ======================
     A: 出題・採点
     ====================== */
  let currentPool = []; let currentId = null; let isRevealed = false;
  startAllBtn.addEventListener('click', () => { startSession(null); });
  startByCatBtn.addEventListener('click', () => { openCatModal(); });

  function openCatModal(){
    catModalBody.innerHTML = '';
    const allCats = new Set();
    problems.filter(p=>!p.deleted).forEach(p => (p.categories || []).forEach(c => allCats.add(c)));
    const cats = Array.from(allCats).sort((a,b)=>a.localeCompare(b,'ja'));
    if (cats.length === 0) {
      const div = document.createElement('div'); div.className = 'muted'; div.textContent = 'カテゴリがありません。まずはBタブで作成してください。'; catModalBody.appendChild(div);
    } else {
      cats.forEach(cat => {
        const label = document.createElement('label'); label.className = 'chip';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = cat;
        label.appendChild(cb); label.appendChild(document.createTextNode(cat)); catModalBody.appendChild(label);
      });
    }
    catModal.classList.remove('hidden'); catModal.setAttribute('aria-hidden', 'false');
  }
  function closeCatModal(){ catModal.classList.add('hidden'); catModal.setAttribute('aria-hidden', 'true'); }
  catModalCancel.addEventListener('click', () => closeCatModal());
  catModalStart.addEventListener('click', () => {
    const checks = catModalBody.querySelectorAll('input[type=checkbox]:checked');
    const selected = Array.from(checks).map(c => c.value);
    closeCatModal(); if (selected.length === 0) { alert('カテゴリを1つ以上選択してください。'); return; }
    startSession(selected);
  });

  function startSession(categories){
    let ids = problems.filter(p => !p.deleted && (categories ? (p.categories || []).some(c => categories.includes(c)) : true)).map(p => p.id);
    if (ids.length === 0) { alert('出題できる問題がありません。Bタブで作成してください。'); return; }
    currentPool = ids; currentId = null; appState.recentQueue = [];
    setReveal(false); renderQuestion(nextQuestionId());
  }
  function setReveal(show){
    isRevealed = show;
    if (show) {
      revealBtn.textContent = '解答を隠す';
      judgeBtns.classList.remove('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m => m.classList.add('revealed'));
    } else {
      revealBtn.textContent = '解答確認';
      judgeBtns.classList.add('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m => m.classList.remove('revealed'));
    }
  }
  revealBtn.addEventListener('click', () => setReveal(!isRevealed));
  judgeBtns.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mark]'); if (!btn) return;
    const mark = btn.getAttribute('data-mark'); gradeCurrent(mark);
  });

  function renderQuestion(id){
    const p = problems.find(x => x.id === id); if (!p) return;
    currentId = id; questionContainer.innerHTML = p.html || '<div class="placeholder">本文なし</div>';
    questionContainer.scrollTop = 0; setReveal(false);
  }
  function weightOf(p){ return 1 / (1 + Math.max(0, p.score)); }
  function nextQuestionId(){
    appState.forcedQueue.forEach(item => item.delay--);
    const readyIdx = appState.forcedQueue.findIndex(item => item.delay <= 0);
    if (readyIdx >= 0) {
      const ready = appState.forcedQueue.splice(readyIdx, 1)[0];
      if (currentPool.includes(ready.id)) {
        appState.recentQueue.push(ready.id); appState.recentQueue = appState.recentQueue.slice(-5); saveAll(); return ready.id;
      }
    }
    const recent = new Set(appState.recentQueue);
    const candidates = currentPool.filter(id => !recent.has(id));
    const cand = candidates.length ? candidates : currentPool;
    const items = cand.map(id => { const p = problems.find(x => x.id === id); return { id, w: weightOf(p) }; });
    const total = items.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const it of items) { if ((r -= it.w) <= 0) {
      appState.recentQueue.push(it.id); appState.recentQueue = appState.recentQueue.slice(-5); saveAll(); return it.id; } }
    const fallback = items[0]?.id ?? currentPool[0];
    appState.recentQueue.push(fallback); appState.recentQueue = appState.recentQueue.slice(-5); saveAll(); return fallback;
  }
  function gradeCurrent(mark){
    const p = problems.find(x => x.id === currentId); if (!p) return;
    let delta = 0; if (mark === 'o') delta = +1; else if (mark === 'd') delta = -0.5; else if (mark === 'x') delta = -1;
    p.score = clamp((p.score ?? 0) + delta, -5, +10);
    p.answerCount = (p.answerCount ?? 0) + 1; if (mark === 'o') p.correctCount = (p.correctCount ?? 0) + 1;
    p.updatedAt = Date.now(); if (mark === 'x') appState.forcedQueue.push({ id: p.id, delay: 5 });
    const dkey = todayKey(); if (!dailyStats[dkey]) dailyStats[dkey] = { correct: 0, total: 0 };
    dailyStats[dkey].total += 1; if (mark === 'o') dailyStats[dkey].correct += 1;
    const ge3 = problems.filter(x => !x.deleted && (x.score ?? 0) >= 3).length;
    const ge5 = problems.filter(x => !x.deleted && (x.score ?? 0) >= 5).length;
    const ge10 = problems.filter(x => !x.deleted && (x.score ?? 0) >= 10).length;
    dailyThresholds[dkey] = { ge3, ge5, ge10 };
    outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt: p.updatedAt });
    outbox.push({ kind:'daily', date:dkey, op:'upsert', updatedAt: Date.now() });
    saveAll(); renderQuestion(nextQuestionId());
  }

  /* ======================
     D: グラフ & 日別一覧
     ====================== */
  function renderD(){ renderDailyList(); renderProgressChart(); }
  function renderDailyList(){
    dailyList.innerHTML = '';
    const entries = Object.entries(dailyStats).sort((a,b) => a[0].localeCompare(b[0], 'ja'));
    if (entries.length === 0) { const div = document.createElement('div'); div.className='muted'; div.textContent='まだ記録がありません。'; dailyList.appendChild(div); return; }
    for (const [k, v] of entries) {
      const div = document.createElement('div'); div.className='daily-item';
      const left = document.createElement('div'); left.textContent = k;
      const right = document.createElement('div'); right.textContent = `${v.correct}/${v.total}`;
      div.appendChild(left); div.appendChild(right); dailyList.appendChild(div);
    }
  }
  function renderProgressChart(){
    const labels = Array.from(new Set([...Object.keys(dailyThresholds), ...Object.keys(dailyStats)])).sort((a,b)=>a.localeCompare(b,'ja'));
    const ge3Arr = labels.map(k => dailyThresholds[k]?.ge3 ?? 0);
    const ge5Arr = labels.map(k => dailyThresholds[k]?.ge5 ?? 0);
    const ge10Arr = labels.map(k => dailyThresholds[k]?.ge10 ?? 0);
    const only10 = ge10Arr;
    const only5 = ge5Arr.map((v,i) => Math.max(0, v - ge10Arr[i]));
    const only3 = ge3Arr.map((v,i) => Math.max(0, v - ge5Arr[i]));
    const data = { labels, datasets: [
      { label: 'スコア +3 以上（3〜4）', data: only3 },
      { label: 'スコア +5 以上（5〜9）', data: only5 },
      { label: 'スコア +10', data: only10 },
    ]};
    const options = {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#111827' } } },
      scales: {
        x: { stacked: true, ticks: { color: '#111827' }, grid: { color: 'rgba(0,0,0,0.08)' } },
        y: { stacked: true, beginAtZero: true, ticks: { color: '#111827' }, grid: { color: 'rgba(0,0,0,0.08)' } }
      }
    };
    if (progressChart) { progressChart.destroy(); progressChart = null; }
    progressChart = new Chart(progressCanvas, { type: 'bar', data, options });
  }

  /* ======================
     Google Sheets 同期（GIS）
     ====================== */
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
  const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

  let tokenClient = null;
  let accessToken = null;

  // 同期UIの初期値
  sheetIdInput.value = syncSettings.sheetId || '';
  sheetProblemsInput.value = syncSettings.sheetProblems || CONFIG.SHEET_PROBLEMS;
  sheetDailyInput.value = syncSettings.sheetDaily || CONFIG.SHEET_DAILY;

  // HARD_CODEDがあれば入力UIを隠す（Cタブで実行されるよう renderC側でも呼ぶ）
  setupSyncUIVisibility();

  saveSyncSettingsBtn.addEventListener('click', () => {
    if (CONFIG.HARD_CODED_SHEET_ID) { alert('シートIDはコードに埋め込まれているため変更できません。'); return; }
    syncSettings.sheetId = sheetIdInput.value.trim();
    syncSettings.sheetProblems = sheetProblemsInput.value.trim() || CONFIG.SHEET_PROBLEMS;
    syncSettings.sheetDaily = sheetDailyInput.value.trim() || CONFIG.SHEET_DAILY;
    saveAll();
    updateSyncBadge('設定保存', 'yellow');
  });

  function gapiLoad() {
    return new Promise((resolve, reject) => {
      if (gapi?.client) return resolve();
      gapi.load('client', { callback: resolve, onerror: reject });
    });
  }
  function isSignedIn(){ return !!accessToken; }
  function updateSyncBadge(text, color){
    syncBadge.textContent = text;
    syncBadge.className = 'badge ' + ({
      green: 'badge-green', yellow: 'badge-yellow', red: 'badge-red', gray: 'badge-gray'
    }[color] || 'badge-gray');
  }

  // ログイン（GIS）
  loginBtn.addEventListener('click', async () => {
    try {
      await gapiLoad();
      await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: syncSettings.clientId,
        scope: SCOPES,
        callback: (resp) => {
          if (resp && resp.access_token) {
            accessToken = resp.access_token;
            gapi.client.setToken({ access_token: accessToken });
            updateSyncBadge('ログイン済み', 'green');
            // 安全Pull（Pushしない）
            pullAndMerge().catch(console.error);
          } else {
            updateSyncBadge('ログイン失敗', 'red');
            alert('Googleログインに失敗しました。');
          }
        },
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) {
      console.error(e);
      updateSyncBadge('ログイン失敗', 'red');
      alert('Googleログインに失敗しました。');
    }
  });

  // ログアウト（トークン失効）
  logoutBtn.addEventListener('click', async () => {
    try {
      if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
          accessToken = null;
          gapi.client.setToken(null);
          updateSyncBadge('ログアウト', 'gray');
        });
      } else {
        updateSyncBadge('ログアウト', 'gray');
      }
    } catch (e) { console.error(e); }
  });

  // 手動同期
  syncNowBtn.addEventListener('click', async () => {
    try {
      await gapiLoad();
      if (!isSignedIn()) { alert('先にGoogleログインしてください。'); return; }
      if (!syncSettings.sheetId) { alert('Spreadsheet IDが未設定です。'); return; }
      updateSyncBadge('同期中…', 'yellow');
      await pullAndMerge(); // Pull→マージ
      await pushOutbox();   // Push
      updateSyncBadge('同期完了', 'green');
    } catch (e) {
      console.error(e);
      updateSyncBadge('同期失敗', 'red');
      alert('同期に失敗しました。コンソールを確認してください。');
    }
  });

  // Pull & Merge（安全：Pushしない）
  async function pullAndMerge(){
    const sheetId = syncSettings.sheetId; if (!sheetId) { updateSyncBadge('未設定', 'gray'); return; }
    const rangeProblems = `${syncSettings.sheetProblems}!A1:Z`;
    const resP = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeProblems });
    const { rows: cloudProblems, indexMap: cloudPIndex } = parseSheetRows(resP.result.values || []);

    const rangeDaily = `${syncSettings.sheetDaily}!A1:Z`;
    const resD = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeDaily });
    const { rows: cloudDaily, indexMap: cloudDIndex } = parseSheetRows(resD.result.values || []);

    // Problems マージ（deleted優先 → updatedAt新しい方）
    const localP = new Map(problems.map(p => [p.id, p]));
    cloudProblems.forEach(row => {
      const id = row.id; if (!id) return;
      const c = normalizeProblem(row);
      const l = localP.get(id);
      if (!l) localP.set(id, c);
      else {
        if (c.deleted && !l.deleted) localP.set(id, c);
        else if (!c.deleted && l.deleted) { /* keep local deleted */ }
        else { if (Number(c.updatedAt||0) > Number(l.updatedAt||0)) localP.set(id, c); }
      }
    });
    problems = Array.from(localP.values());

    // Daily マージ（dateキー）
    const localD = {...dailyStats};
    cloudDaily.forEach(row => {
      const k = row.date; if (!k) return;
      const c = normalizeDaily(row);
      const l = localD[k];
      if (!l) localD[k] = c;
      else {
        const cu = Number(c.updatedAt||0), lu = Number((l.updatedAt||0));
        if (cu > lu) localD[k] = c;
      }
    });
    dailyStats = localD;

    // インデックス保存（更新時の行番号用）
    cloudIndex = { problems: cloudPIndex, daily: cloudDIndex };

    saveAll(); renderC(); renderD();
  }

  // Push（outboxを反映）
  async function pushOutbox(){
    if (!outbox.length) return;
    const sheetId = syncSettings.sheetId;
    const pSheet = syncSettings.sheetProblems, dSheet = syncSettings.sheetDaily;

    const toPush = [...outbox].sort((a,b)=>Number(a.updatedAt||0)-Number(b.updatedAt||0));

    for (const item of toPush) {
      if (item.kind === 'problem') {
        const p = problems.find(x => x.id === item.id); if (!p) continue;
        await upsertRow(sheetId, pSheet, 'id', cloudIndex.problems, p.id, denormalizeProblem(p));
      } else if (item.kind === 'daily') {
        const k = item.date; const d = getDailyRow(k);
        await upsertRow(sheetId, dSheet, 'date', cloudIndex.daily, k, denormalizeDaily(k, d));
      }
    }
    outbox = []; saveAll();
    await pullAndMerge(); // 行番号の再取得も兼ねる
  }

  // Sheet <-> Object 変換
  function parseSheetRows(values){
    if (!values.length) return { rows: [], indexMap: {} };
    const header = values[0];
    const map = {}; const rows = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r]; const obj = {};
      header.forEach((key, i) => { obj[key] = row[i]; });
      rows.push(obj);
      const pk = obj.id || obj.date;
      if (pk) map[pk] = r + 1; // 1-based
    }
    return { rows, indexMap: map };
  }
  function normalizeProblem(o){
    return {
      id: o.id,
      html: o.html || '',
      answers: safeParseJSON(o.answers, []),
      categories: safeParseJSON(o.categories, []),
      score: Number(o.score||0),
      answerCount: Number(o.answerCount||0),
      correctCount: Number(o.correctCount||0),
      deleted: String(o.deleted||'false') === 'true',
      createdAt: Number(o.createdAt||Date.now()),
      updatedAt: Number(o.updatedAt||Date.now()),
    };
  }
  function denormalizeProblem(p){
    return {
      id: p.id,
      html: p.html || '',
      answers: JSON.stringify(p.answers||[]),
      categories: JSON.stringify(p.categories||[]),
      score: String(p.score??0),
      answerCount: String(p.answerCount??0),
      correctCount: String(p.correctCount??0),
      deleted: String(!!p.deleted),
      createdAt: String(p.createdAt||0),
      updatedAt: String(p.updatedAt||0),
    };
  }
  function normalizeDaily(o){
    return {
      date: o.date,
      correct: Number(o.correct||0),
      total: Number(o.total||0),
      ge3: Number(o.ge3||0),
      ge5: Number(o.ge5||0),
      ge10: Number(o.ge10||0),
      updatedAt: Number(o.updatedAt||Date.now()),
    };
  }
  function denormalizeDaily(date, d){
    const row = getDailyRow(date);
    return {
      date,
      correct: String(row.correct||0),
      total: String(row.total||0),
      ge3: String((dailyThresholds[date]?.ge3)||0),
      ge5: String((dailyThresholds[date]?.ge5)||0),
      ge10: String((dailyThresholds[date]?.ge10)||0),
      updatedAt: String(row.updatedAt||Date.now()),
    };
  }
  function getDailyRow(date){
    return { correct: dailyStats[date]?.correct||0, total: dailyStats[date]?.total||0, updatedAt: Date.now() };
  }
  function safeParseJSON(s, fallback){ try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }

  // 行の upsert（存在すれば update、無ければ append）
  async function upsertRow(sheetId, sheetName, pkName, indexMap, key, obj){
    const headers = Object.keys(obj);
    const rowValues = headers.map(h => obj[h] ?? '');

    const rowNum = indexMap[key]; // 1-based
    if (rowNum) {
      const range = `${sheetName}!A${rowNum}:${colLetter(headers.length)}${rowNum}`;
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: sheetId, range, valueInputOption: 'RAW',
        resource: { values: [rowValues] }
      });
    } else {
      const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${sheetName}!A1:Z1` });
      const header = (res.result.values && res.result.values[0]) || headers;
      const ordered = header.map(h => obj[h] ?? '');
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sheetId, range: `${sheetName}!A1`,
        valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
        resource: { values: [ordered] }
      });
    }
  }
  function colLetter(n){
    let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s;
  }

  /* ======================
     初期レンダリング
     ====================== */
  renderC(); setReveal(false);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (document.querySelector('#tab-d').classList.contains('show')) renderProgressChart();
    }
  });
})();
