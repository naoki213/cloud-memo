/* ======================================================
 * 消費税法 暗記アプリ（拡張版）
 * - 3種類の問題形式
 *   ① マスク問題（従来）
 *   ② 文章問題（Q&A）
 *   ③ ○×問題
 * - 出題条件：カテゴリ／問題形式／スコア条件（+3,+5,+7以下）
 * - Aタブ「すべてから出題」は完全無条件（全問題＋重み＋forcedQueue）
 * - Dタブグラフ：カテゴリごとの「スコアが閾値以上の問題数」
 * - サマリー：先頭20文字（○×問題は「（○×）」付き）
 * ====================================================== */
(() => {
  /* ===== LocalStorage Keys ===== */
  const LS_KEYS = {
    PROBLEMS: 'problems_v1',
    APPSTATE: 'app_state_v1',
    DAILYSTATS: 'daily_stats_v1',
    CATEGORY_STATS: 'category_stats_v1',
  };

  /* ===== 便利関数 ===== */
  /* ===== マスクHTML簡略化（改行は残す） ===== */
function compactMaskHTML(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  // ① script 等は念のため削除
  container.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());

  // ② 不要な属性を削除（class は mask のみ残す）
  container.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name === 'class') {
        if (!el.classList.contains('mask')) {
          el.removeAttribute('class');
        } else {
          el.className = 'mask'; // mask のみに正規化
        }
      } else {
        el.removeAttribute(attr.name);
      }
    });
  });

  // ③ テキストノード整理（改行は残す）
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  const texts = [];
  while (walker.nextNode()) {
    texts.push(walker.currentNode);
  }

  texts.forEach(node => {
    // 改行を含む空白は保持、それ以外の連続空白だけ圧縮
    node.textContent = node.textContent
      .replace(/[ \t]+/g, ' ')   // 半角空白・タブだけ圧縮
      .replace(/ \n/g, '\n')
      .replace(/\n /g, '\n');
  });

  return container.innerHTML.trim();
}
/* ===== 赤文字（span-red）を自動でマスクに変換 ===== */
function convertRedSpanToMask(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  // 赤文字（span-red）をすべて mask に変換
  container.querySelectorAll('.span-red').forEach(red => {
    const mask = document.createElement('span');
    mask.className = 'mask';
    mask.textContent = red.textContent;

    red.replaceWith(mask);
  });

  return container.innerHTML;
}
  const loadJSON = (k, fb) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fb;
    } catch {
      return fb;
    }
  };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  const uuid = () =>
    'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const parseCategories = (s) =>
    s
      ? String(s)
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

  const extractAnswersFrom = (el) =>
    Array.from(el.querySelectorAll('.mask'))
      .map((m) => (m.textContent || '').trim())
      .filter(Boolean);

  const unmaskAllIn = (el) =>
    el.querySelectorAll('.mask').forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
    });

  const summaryFromHTML = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    const t = (d.textContent || '').replace(/\s+/g, '');
    if (!t) return '(空)';
    return t.slice(0, 20);
  };

  const summaryFromText = (text, suffix = '') => {
    const t = String(text || '').replace(/\s+/g, '');
    if (!t) return '(空)';
    return t.slice(0, 20) + suffix;
  };

  const escapeHTML = (str) =>
    String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const sanitizeHTML = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    d.querySelectorAll('script,style,iframe,object,embed').forEach((n) =>
      n.remove()
    );
    d.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      });
    });
    return d.innerHTML;
  };

  const ensureProblemSummary = (p) => {
    if (p.type === 'qa') {
      if (!p.summary) p.summary = summaryFromText(p.question || '');
    } else if (p.type === 'ox') {
      if (!p.summary) p.summary = summaryFromText(p.question || '', '（○×）');
    } else {
      if (!p.summary) p.summary = summaryFromHTML(p.html || '');
    }
  };

  const normalizeProblem = (p) => {
    if (!p.type) p.type = 'mask';
    if (typeof p.score !== 'number') p.score = 0;
    if (typeof p.answerCount !== 'number') p.answerCount = 0;
    if (typeof p.correctCount !== 'number') p.correctCount = 0;
    if (!Array.isArray(p.categories)) {
      p.categories = p.categories ? [].concat(p.categories) : [];
    }
    ensureProblemSummary(p);
    return p;
  };

  /* ===== 状態 ===== */
  let problems = loadJSON(LS_KEYS.PROBLEMS, []).map(normalizeProblem);
  let appState = loadJSON(LS_KEYS.APPSTATE, {
    recentQueue: [],
    forcedQueue: [],
    lastPastedHTML: '',
    lastPastedCats: '',
    lastSavedHTML: '',
    lastSavedCats: [],
  });
  let dailyStats = loadJSON(LS_KEYS.DAILYSTATS, {});
  let categoryStats = loadJSON(LS_KEYS.CATEGORY_STATS, {});

  /* ===== DOM 取得 ===== */
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // タブ
  const tabButtons = $$('.tab-btn');
  const pages      = $$('.page');

  // A
  const startAllBtn       = $('#startAllBtn');
  const startByCatBtn     = $('#startByCatBtn');
  const questionContainer = $('#questionContainer');
  const revealBtn         = $('#revealBtn');
  const judgeBtns         = $('#judgeBtns');

  // B 共通
  const bTypeButtons = $$('.btype-btn');
  const bPaneMask    = $('#bPaneMask');
  const bPaneQa      = $('#bPaneQa');
  const bPaneOx      = $('#bPaneOx');

  // B: マスク
  const editor        = $('#editor');
  const maskBtn       = $('#maskBtn');
  const unmaskAllBtn  = $('#unmaskAllBtn');
  const repeatBtn     = $('#repeatBtn');
  const clearDraftBtn = $('#clearDraftBtn');
  const catInput      = $('#catInput');
  const saveMaskProblemBtn = $('#saveMaskProblemBtn');

  // B: QA
  const qaQuestionInput   = $('#qaQuestionInput');
  const qaAnswerInput     = $('#qaAnswerInput');
  const qaCatInput        = $('#qaCatInput');
  const saveQaProblemBtn  = $('#saveQaProblemBtn');

  // B: OX
  const oxQuestionInput     = $('#oxQuestionInput');
  const oxCorrectInput      = $('#oxCorrectInput');
  const oxExplanationInput  = $('#oxExplanationInput');
  const oxCatInput          = $('#oxCatInput');
  const saveOxProblemBtn    = $('#saveOxProblemBtn');

  // C
  const problemList        = $('#problemList');
  const catChips           = $('#catChips');
  const clearCatFilterBtn  = $('#clearCatFilterBtn');
  const exportJsonBtn      = $('#exportJsonBtn');
  const importJsonInput    = $('#importJsonInput');
  const purgeDeletedBtn = $('#purgeDeletedBtn');
  const storageInfoEl      = $('#storageInfo');
  const cTypeButtons       = $$('.ctype-btn');

  // D
  const progressCanvas      = $('#progressChart');
  const dailyList           = $('#dailyList');
  const scoreFilterButtons  = $$('.score-filter-btn');

  // 出題条件モーダル
  const catModal        = $('#catModal');
  const catModalBody    = $('#catModalBody');
  const catModalCancel  = $('#catModalCancel');
  const catModalStart   = $('#catModalStart');
  const modalTypeChips  = $('#modalTypeChips');
  const modalScoreChips = $('#modalScoreChips');

  // 編集モーダル
  const editModal        = $('#editModal');
  const editTypeLabel    = $('#editTypeLabel');
  const editEditor       = $('#editEditor');
  const editMaskArea     = $('#editMaskArea');
  const editQaArea       = $('#editQaArea');
  const editOxArea       = $('#editOxArea');
  const editQaQuestion   = $('#editQaQuestion');
  const editQaAnswer     = $('#editQaAnswer');
  const editOxQuestion   = $('#editOxQuestion');
  const editOxCorrect    = $('#editOxCorrect');
  const editOxExplanation= $('#editOxExplanation');
  const editCatInput     = $('#editCatInput');
  const editMaskBtn      = $('#editMaskBtn');
  const editUnmaskAllBtn = $('#editUnmaskAllBtn');
  const editCancelBtn    = $('#editCancelBtn');
  const editSaveBtn      = $('#editSaveBtn');
  const editMeta         = $('#editMeta');

  /* ===== LocalStorage 保存関数 ===== */
  const saveProblems      = () => saveJSON(LS_KEYS.PROBLEMS, problems);
  const saveAppState      = () => saveJSON(LS_KEYS.APPSTATE, appState);
  const saveDailyStats    = () => saveJSON(LS_KEYS.DAILYSTATS, dailyStats);
  const saveCategoryStats = () => saveJSON(LS_KEYS.CATEGORY_STATS, categoryStats);
  const saveStats = () => {
    saveDailyStats();
    saveCategoryStats();
  };

  /* ===== 自動マスク付与（選択しただけで） ===== */
  function autoMaskOnSelection(rootEditable) {
    if (!rootEditable) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    if (!rootEditable.contains(range.commonAncestorContainer)) return;

    let anc =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest && anc.closest('.mask');

    // 既に mask 内ならマスク解除
    if (inMask) {
      const t = inMask;
      const p = t.parentNode;
      while (t.firstChild) p.insertBefore(t.firstChild, t);
      p.removeChild(t);
      sel.removeAllRanges();
      return;
    }

    // 新規マスク
    try {
      const span = document.createElement('span');
      span.className = 'mask';
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      const wrap = document.createElement('span');
      wrap.className = 'mask';
      wrap.appendChild(frag);
      range.insertNode(wrap);
    }
    sel.removeAllRanges();
  }

  function toggleMaskSelection(rootEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    if (!rootEditable.contains(range.commonAncestorContainer)) return;

    let anc =
      range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest && anc.closest('.mask');

    if (inMask) {
      const t = inMask;
      const p = t.parentNode;
      while (t.firstChild) p.insertBefore(t.firstChild, t);
      p.removeChild(t);
      return;
    }

    try {
      const span = document.createElement('span');
      span.className = 'mask';
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      const wrap = document.createElement('span');
      wrap.className = 'mask';
      wrap.appendChild(frag);
      range.insertNode(wrap);
    }
  }
　　/* ===== 選択範囲内のマスクをすべて解除 ===== */
function unmaskInSelection(rootEditable) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  if (!rootEditable.contains(range.commonAncestorContainer)) return;

  const masks = Array.from(rootEditable.querySelectorAll('.mask')).filter(m =>
    range.intersectsNode(m)
  );

  if (masks.length === 0) return;

  masks.forEach(mask => {
    const parent = mask.parentNode;
    while (mask.firstChild) {
      parent.insertBefore(mask.firstChild, mask);
    }
    parent.removeChild(mask);
  });

  sel.removeAllRanges();
}

  /* ===== タブ切替 ===== */
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-target');
      pages.forEach((p) => p.classList.remove('show'));
      const page = document.querySelector(target);
      if (page) page.classList.add('show');

      if (target === '#tab-c') renderC();
      if (target === '#tab-d') renderD();
    });
  });

  const rerenderCIfVisible = () => {
    const pageC = document.querySelector('#tab-c');
    if (pageC && pageC.classList.contains('show')) {
      renderC();
    }
  };

  /* ===== B：問題形式切り替え ===== */
  let currentBType = 'mask';
  function setBType(type) {
    currentBType = type;
    bTypeButtons.forEach((btn) => {
      const t = btn.getAttribute('data-btype');
      btn.classList.toggle('primary', t === type);
    });
    if (bPaneMask) bPaneMask.classList.toggle('hidden', type !== 'mask');
    if (bPaneQa)   bPaneQa.classList.toggle('hidden', type !== 'qa');
    if (bPaneOx)   bPaneOx.classList.toggle('hidden', type !== 'ox');
  }
  bTypeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-btype');
      if (t) setBType(t);
    });
  });

  /* ===== B：マスク問題 ===== */
  if (editor) {
    editor.addEventListener('paste', () => {
  setTimeout(() => {
    let html = editor.innerHTML;

    // ★ 自動マスク発動ポイント
    html = convertRedSpanToMask(html);

    editor.innerHTML = html;

    appState.lastPastedHTML = html;
    if (catInput && catInput.value.trim()) {
      appState.lastPastedCats = catInput.value.trim();
    }
    saveAppState();
  }, 0);
});


    if (maskBtn) {
      maskBtn.addEventListener('click', () => toggleMaskSelection(editor));
    }
    if (unmaskAllBtn) {
      unmaskAllBtn.addEventListener('click', () => unmaskAllIn(editor));
    }

    ['mouseup', 'keyup', 'touchend'].forEach((ev) => {
      editor.addEventListener(ev, () =>
        setTimeout(() => autoMaskOnSelection(editor), 10)
      );
    });
  }

  if (repeatBtn) {
    repeatBtn.addEventListener('click', () => {
      if (appState.lastSavedHTML) {
        if (editor) editor.innerHTML = appState.lastSavedHTML;
        if (catInput)
          catInput.value = (appState.lastSavedCats || []).join(', ');
      } else if (appState.lastPastedHTML) {
        if (editor) editor.innerHTML = appState.lastPastedHTML;
        if (catInput) catInput.value = appState.lastPastedCats || '';
      } else {
        alert(
          '繰り返しできる直前データがありません。長文をペーストして保存してください。'
        );
      }
    });
  }

  if (clearDraftBtn) {
    clearDraftBtn.addEventListener('click', () => {
      if (editor) editor.innerHTML = '';
      if (catInput) catInput.value = '';
    });
  }

  if (catInput) {
    catInput.addEventListener('change', () => {
      appState.lastPastedCats = catInput.value.trim();
      saveAppState();
    });
  }

  // マスク問題保存
  const saveMaskProblemBtnEl = saveMaskProblemBtn;
  if (saveMaskProblemBtnEl) {
    saveMaskProblemBtnEl.addEventListener('click', () => {
      if (!editor) return;
      let html = editor.innerHTML.trim();
      if (!html) {
        alert('長文を入力してください。');
        return;
      }
      html = sanitizeHTML(html);
      html = convertRedSpanToMask(html); // ★追加：赤文字→マスク
      html = compactMaskHTML(html); // ★追加

      const answers = extractAnswersFrom(editor);
      if (answers.length === 0 && !confirm('マスクがありません。保存しますか？'))
        return;

      const categories = parseCategories(catInput ? catInput.value : '');
      const now = Date.now();
      const id = uuid();

      const p = normalizeProblem({
        id,
        type: 'mask',
        html,
        answers,
        categories,
        summary: summaryFromHTML(html),
        score: 0,
        answerCount: 0,
        correctCount: 0,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      });

      problems.push(p);

      appState.lastSavedHTML = html;
      appState.lastSavedCats = categories;
      saveProblems();
      saveAppState();

      editor.innerHTML = '';
      if (catInput) catInput.value = '';
      alert('保存しました。（Cタブに反映）');

      rerenderCIfVisible();
    });
  }

  /* ===== B：文章問題保存 ===== */
  if (saveQaProblemBtn) {
    saveQaProblemBtn.addEventListener('click', () => {
      const q = (qaQuestionInput?.value || '').trim();
      const a = (qaAnswerInput?.value || '').trim();
      if (!q || !a) {
        alert('問題と解答を入力してください。');
        return;
      }
      const categories = parseCategories(qaCatInput ? qaCatInput.value : '');
      const now = Date.now();
      const id = uuid();

      const p = normalizeProblem({
        id,
        type: 'qa',
        question: q,
        answer: a,
        categories,
        summary: summaryFromText(q),
        score: 0,
        answerCount: 0,
        correctCount: 0,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      });

      problems.push(p);
      saveProblems();

      if (qaQuestionInput) qaQuestionInput.value = '';
      if (qaAnswerInput) qaAnswerInput.value = '';
      if (qaCatInput) qaCatInput.value = '';
      alert('文章問題を保存しました。（Cタブに反映）');

      rerenderCIfVisible();
    });
  }

  /* ===== B：○×問題保存 ===== */
  if (saveOxProblemBtn) {
    saveOxProblemBtn.addEventListener('click', () => {
      const q = (oxQuestionInput?.value || '').trim();
      const correct = oxCorrectInput?.value === 'x' ? 'x' : 'o';
      const explanation = (oxExplanationInput?.value || '').trim();
      if (!q) {
        alert('問題を入力してください。');
        return;
      }
      const categories = parseCategories(oxCatInput ? oxCatInput.value : '');
      const now = Date.now();
      const id = uuid();

      const p = normalizeProblem({
        id,
        type: 'ox',
        question: q,
        correct,
        explanation,
        categories,
        summary: summaryFromText(q, '（○×）'),
        score: 0,
        answerCount: 0,
        correctCount: 0,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      });

      problems.push(p);
      saveProblems();

      if (oxQuestionInput) oxQuestionInput.value = '';
      if (oxExplanationInput) oxExplanationInput.value = '';
      if (oxCatInput) oxCatInput.value = '';
      alert('○×問題を保存しました。（Cタブに反映）');

      rerenderCIfVisible();
    });
  }

  /* ===== C：編集/確認 ===== */
  /* ===== deleted 問題を完全削除 ===== */
function purgeDeletedProblems() {
  const beforeCount = problems.length;
  const beforeSize = JSON.stringify(problems).length;

  const deletedCount = problems.filter(p => p.deleted).length;

  if (deletedCount === 0) {
    alert('完全削除できる問題はありません。');
    return;
  }

  if (
    !confirm(
      `削除済み問題を完全に削除します。\n` +
      `対象：${deletedCount} 件\n` +
      `※ この操作は元に戻せません`
    )
  ) {
    return;
  }

  problems = problems.filter(p => !p.deleted);

  const afterCount = problems.length;
  const afterSize = JSON.stringify(problems).length;

  saveProblems();

  alert(
    `完全削除が完了しました。\n\n` +
    `問題数：${beforeCount} → ${afterCount}\n` +
    `容量：${beforeSize} → ${afterSize} bytes\n` +
    `削減：${beforeSize - afterSize} bytes`
  );

  renderC();
}

  let currentCatFilter = [];
  let currentTypeFilter = 'all';
  const MAX_LIST_ITEMS = 200; // 一覧に表示する最大件数（負荷軽減）

  function updateStorageInfo() {
    if (!storageInfoEl) return;
    const bytes = getLocalStorageUsage();
    const percent = (bytes / LOCALSTORAGE_LIMIT) * 100;
    storageInfoEl.textContent =
      `localStorage使用容量：${formatBytes(bytes)}（約 ${percent.toFixed(1)}% ）`;
  }

  function renderC() {
    renderCategoryChips();
    renderProblemList();
    updateStorageInfo();
  }

  function renderCategoryChips() {
    if (!catChips) return;
    const all = new Set();
    problems
      .filter((p) => !p.deleted)
      .forEach((p) => (p.categories || []).forEach((c) => all.add(c)));
    const cats = Array.from(all).sort((a, b) => a.localeCompare(b, 'ja'));

    catChips.innerHTML = '';
    cats.forEach((cat) => {
      const label = document.createElement('label');
      label.className = 'chip';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cat;
      cb.checked = currentCatFilter.includes(cat);
      cb.addEventListener('change', () => {
        if (cb.checked) currentCatFilter.push(cat);
        else currentCatFilter = currentCatFilter.filter((c) => c !== cat);
        renderProblemList();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(cat));
      catChips.appendChild(label);
    });
  }

  if (clearCatFilterBtn) {
    clearCatFilterBtn.addEventListener('click', () => {
      currentCatFilter = [];
      renderCategoryChips();
      renderProblemList();
    });
  }

  // 形式フィルタボタン
  cTypeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-ctype') || 'all';
      currentTypeFilter = t;
      cTypeButtons.forEach((b) => b.classList.toggle('primary', b === btn));
      renderProblemList();
    });
  });

  function problemMatchesFilter(p) {
    if (p.deleted) return false;

    // 形式フィルタ
    const t = p.type || 'mask';
    if (currentTypeFilter !== 'all' && t !== currentTypeFilter) return false;

    // カテゴリフィルタ
    if (currentCatFilter.length === 0) return true;
    if (!p.categories || !p.categories.length) return false;
    return p.categories.some((c) => currentCatFilter.includes(c));
  }

  function renderProblemList() {
    if (!problemList) return;
    problemList.innerHTML = '';

    const filtered = problems.filter(problemMatchesFilter);
    const display  = filtered.slice(0, MAX_LIST_ITEMS);

    const frag = document.createDocumentFragment();

    display.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'problem-item';

      const t = document.createElement('div');
      t.className = 'item-title';

      ensureProblemSummary(p);

      let typeLabel = '';
      if (p.type === 'qa') typeLabel = '【文章】';
      else if (p.type === 'ox') typeLabel = '【○×】';
      else typeLabel = '【マスク】';

      t.textContent = `No.${i + 1} ${typeLabel} ${p.summary}`;

      const sub = document.createElement('div');
      sub.className = 'item-sub';

      const s1 = document.createElement('span');
      s1.textContent = `スコア: ${(p.score || 0).toFixed(1)}`;

      const s2 = document.createElement('span');
      s2.textContent = `正答/回答: ${p.correctCount || 0}/${p.answerCount || 0}`;

      const bEdit = document.createElement('button');
      bEdit.className = 'btn small';
      bEdit.textContent = '編集';
      bEdit.addEventListener('click', () => openEditModal(p.id));

      const bDel = document.createElement('button');
      bDel.className = 'btn small';
      bDel.textContent = '削除';
      bDel.addEventListener('click', () => {
        if (!confirm('この問題を削除（ソフト）しますか？')) return;
        p.deleted = true;
        p.updatedAt = Date.now();
        saveProblems();
        renderC();
      });

      sub.appendChild(s1);
      sub.appendChild(s2);
      sub.appendChild(bEdit);
      sub.appendChild(bDel);

      item.appendChild(t);
      item.appendChild(sub);
      frag.appendChild(item);
    });

    problemList.appendChild(frag);

    if (!filtered.length) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = '該当する問題がありません。';
      problemList.appendChild(div);
    } else if (filtered.length > MAX_LIST_ITEMS) {
      const info = document.createElement('div');
      info.className = 'muted';
      info.textContent = `※${MAX_LIST_ITEMS}件まで表示しています（全${filtered.length}件）。カテゴリで絞り込むとさらに表示できます。`;
      problemList.appendChild(info);
    }
  }

  /* ===== Cタブ：カテゴリ選択エクスポート ===== */
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      if (!catChips) return;

      const selectedCats = Array.from(
        catChips.querySelectorAll('input[type=checkbox]:checked')
      ).map((cb) => cb.value);

      if (selectedCats.length === 0) {
        if (
          !confirm('カテゴリが選択されていません。全ての問題をエクスポートしますか？')
        )
          return;
      }

      const filteredProblems = problems.filter(
        (p) =>
          !p.deleted &&
          (selectedCats.length === 0
            ? true
            : (p.categories || []).some((c) => selectedCats.includes(c)))
      );

      const blob = new Blob(
        [
          JSON.stringify(
            { problems: filteredProblems, dailyStats, categoryStats },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      );

      const d = new Date();
      const name = `export_${d.getFullYear()}${String(
        d.getMonth() + 1
      ).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);

      alert(
        `選択したカテゴリ（${selectedCats.join(', ') || '全て'}）の問題をエクスポートしました。`
      );
    });
  }

  if (importJsonInput) {
    importJsonInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (Array.isArray(data.problems)) {
          const map = new Map(problems.map((p) => [p.id, p]));
          data.problems.forEach((np) => {
            normalizeProblem(np);
            const old = map.get(np.id);

            if (old) {
              // スコア関連は既存を優先
              np.score = old.score;
              np.answerCount = old.answerCount;
              np.correctCount = old.correctCount;
              np.updatedAt = Date.now(); // 更新日時だけ新しく

              // カテゴリは統合して重複除去
              np.categories = Array.from(
                new Set([...(old.categories || []), ...(np.categories || [])])
              );
            }

            map.set(np.id, np);
          });

          problems = Array.from(map.values()).map(normalizeProblem);
        }
        if (data.dailyStats && typeof data.dailyStats === 'object') {
          dailyStats = { ...dailyStats, ...data.dailyStats };
        }
        if (data.categoryStats && typeof data.categoryStats === 'object') {
          categoryStats = { ...categoryStats, ...data.categoryStats };
        }

        saveProblems();
        saveStats();

        rerenderCIfVisible();
        alert('インポートしました。');
      } catch (err) {
        console.error(err);
        alert('JSONの読み込みに失敗しました。');
      } finally {
        importJsonInput.value = '';
      }
    });
  }

  　　　if (purgeDeletedBtn) {
 　　　 purgeDeletedBtn.addEventListener('click', () => {
   　　 purgeDeletedProblems();
  });
}

  /* ===== 編集モーダル ===== */
  let editingId = null;
  let editUnmaskMode = false; // ★ 解除モードON/OFF


  function getProblemById(id) {
    return problems.find((x) => x.id === id) || null;
  }

  function openEditModal(id) {
    const p = getProblemById(id);
    if (!p || !editModal) return;

    editingId = id;
    editModal.classList.remove('hidden');
    editModal.setAttribute('aria-hidden', 'false');

    // 形式ラベル
    if (editTypeLabel) {
      if (p.type === 'qa') editTypeLabel.textContent = '文章問題';
      else if (p.type === 'ox') editTypeLabel.textContent = '○×問題';
      else editTypeLabel.textContent = 'マスク問題';
    }

    if (editCatInput) {
      editCatInput.value = (p.categories || []).join(', ');
    }

    // 各エリアの表示切替
    const isMask = p.type === 'mask';
    const isQa   = p.type === 'qa';
    const isOx   = p.type === 'ox';

    if (editMaskArea) editMaskArea.style.display = isMask ? '' : 'none';
    if (editQaArea)   editQaArea.style.display   = isQa   ? '' : 'none';
    if (editOxArea)   editOxArea.style.display   = isOx   ? '' : 'none';

    if (isMask && editEditor) {
      editEditor.innerHTML = sanitizeHTML(p.html || '');
      editEditor.classList.add('editing');
      requestAnimationFrame(() => {
        const r = document.createRange();
        r.selectNodeContents(editEditor);
        r.collapse(false);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        editEditor.focus();
      });
    } else if (editEditor) {
      editEditor.classList.remove('editing');
      editEditor.innerHTML = '';
    }

    if (isQa) {
      if (editQaQuestion) editQaQuestion.value = p.question || '';
      if (editQaAnswer) editQaAnswer.value = p.answer || '';
    } else {
      if (editQaQuestion) editQaQuestion.value = '';
      if (editQaAnswer) editQaAnswer.value = '';
    }

    if (isOx) {
      if (editOxQuestion) editOxQuestion.value = p.question || '';
      if (editOxCorrect) editOxCorrect.value = p.correct === 'x' ? 'x' : 'o';
      if (editOxExplanation) editOxExplanation.value = p.explanation || '';
    } else {
      if (editOxQuestion) editOxQuestion.value = '';
      if (editOxExplanation) editOxExplanation.value = '';
    }

    if (editMeta) {
      editMeta.textContent = `正答: ${p.correctCount || 0} / 回答: ${
        p.answerCount || 0
      } / スコア: ${(p.score || 0).toFixed(1)}`;
    }
  }

  function closeEditModal() {
  editingId = null;
  editUnmaskMode = false; // ★ 必須：解除モード解除
  if (!editModal) return;
  editModal.classList.add('hidden');
  editModal.setAttribute('aria-hidden', 'true');
  if (editEditor) {
    editEditor.classList.remove('editing');
    editEditor.innerHTML = '';
  }
  document.querySelector('[data-target="#tab-c"]')?.focus();
}


  if (editMaskBtn && editEditor) {
    editMaskBtn.addEventListener('click', () => toggleMaskSelection(editEditor));
  }
  if (editUnmaskAllBtn && editEditor) {
    editUnmaskAllBtn.addEventListener('click', () => unmaskAllIn(editEditor));
  }
  const editUnmaskModeBtn = $('#editUnmaskModeBtn');

if (editUnmaskModeBtn) {
  editUnmaskModeBtn.addEventListener('click', () => {
    editUnmaskMode = !editUnmaskMode;

    // 見た目でON/OFFを分かりやすく
    editUnmaskModeBtn.classList.toggle('primary', editUnmaskMode);
    editUnmaskModeBtn.textContent = editUnmaskMode
      ? '解除モード中'
      : '解除モード';
  });
}

  if (editCancelBtn) {
    editCancelBtn.addEventListener('click', () => closeEditModal());
  }
  if (editSaveBtn) {
    editSaveBtn.addEventListener('click', () => {
      const p = getProblemById(editingId);
      if (!p) return;

      p.categories = parseCategories(editCatInput ? editCatInput.value : '');
      const now = Date.now();

      if (p.type === 'qa') {
        const q = (editQaQuestion?.value || '').trim();
        const a = (editQaAnswer?.value || '').trim();
        if (!q || !a) {
          alert('問題と解答を入力してください。');
          return;
        }
        p.question = q;
        p.answer = a;
        p.summary = summaryFromText(q);
      } else if (p.type === 'ox') {
        const q = (editOxQuestion?.value || '').trim();
        if (!q) {
          alert('問題を入力してください。');
          return;
        }
        p.question = q;
        p.correct = editOxCorrect?.value === 'x' ? 'x' : 'o';
        p.explanation = (editOxExplanation?.value || '').trim();
        p.summary = summaryFromText(q, '（○×）');
      } else {
        // マスク
        if (!editEditor) return;
        let html = sanitizeHTML(editEditor.innerHTML.trim());
        html = compactMaskHTML(html); // ★追加

        p.html = html;
        p.answers = extractAnswersFrom(editEditor);
        p.summary = summaryFromHTML(html);
      }

      p.updatedAt = now;
      saveProblems();
      closeEditModal();
      renderC();
    });
  }

 if (editEditor) {
  ['mouseup', 'keyup', 'touchend'].forEach(ev => {
    editEditor.addEventListener(ev, () => {
      setTimeout(() => {
        if (editUnmaskMode) {
          // ★ 複数マスク一括解除
          unmaskInSelection(editEditor);
        } else {
          // ★ 通常のマスク作成
          autoMaskOnSelection(editEditor);
        }
      }, 10);
    });
  });
}



  document.querySelectorAll('.modal .modal-backdrop').forEach((bg) => {
    bg.addEventListener('click', () => {
      if (catModal && !catModal.classList.contains('hidden')) {
        catModal.classList.add('hidden');
        catModal.setAttribute('aria-hidden', 'true');
      }
      if (editModal && !editModal.classList.contains('hidden')) {
        closeEditModal();
      }
    });
  });

  /* ===== A：出題・採点 ===== */
  let revealedMaskStack = [];
  let currentPool = [];
  let currentId   = null;
  let isRevealed  = false;
  let oxAnswered  = false; // ○×問題用

  function getCurrentProblem() {
    return getProblemById(currentId);
  }

  // すべてから出題：完全無条件（全問題＋重み付け＋forcedQueue）
  if (startAllBtn) {
    startAllBtn.addEventListener('click', () => {
      startSession({});
    });
  }

  // 条件付き出題
  if (startByCatBtn) {
    startByCatBtn.addEventListener('click', () => openConditionModal());
  }

  function openConditionModal() {
    if (!catModal || !catModalBody) return;
    catModalBody.innerHTML = '';

    const set = new Set();
    problems
      .filter((p) => !p.deleted)
      .forEach((p) => (p.categories || []).forEach((c) => set.add(c)));
    const cats = Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));

    if (!cats.length) {
      const div = document.createElement('div');
      div.className = 'muted';
      div.textContent = 'カテゴリがありません。Bタブで作成してください。';
      catModalBody.appendChild(div);
    } else {
      cats.forEach((cat) => {
        const label = document.createElement('label');
        label.className = 'chip';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = cat;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(cat));
        catModalBody.appendChild(label);
      });
    }

    catModal.classList.remove('hidden');
    catModal.setAttribute('aria-hidden', 'false');
  }

  if (catModalCancel) {
    catModalCancel.addEventListener('click', () => {
      if (catModal) {
        catModal.classList.add('hidden');
        catModal.setAttribute('aria-hidden', 'true');
      }
    });
  }

  if (catModalStart) {
    catModalStart.addEventListener('click', () => {
      if (!catModalBody) return;

      // カテゴリ
      const categories = Array.from(
        catModalBody.querySelectorAll('input[type=checkbox]:checked')
      ).map((c) => c.value);

      // 問題形式（チェックなしなら全形式）
      let types = Array.from(
        modalTypeChips?.querySelectorAll('input[type=checkbox]:checked') || []
      ).map((cb) => cb.value);
      if (!types.length) {
        types = ['mask', 'qa', 'ox'];
      }

      // スコア条件
      let maxScore = null;
      const checkedScore = modalScoreChips?.querySelector(
        'input[name="scoreFilter"]:checked'
      );
      if (checkedScore && checkedScore.value) {
        maxScore = Number(checkedScore.value);
        if (Number.isNaN(maxScore)) maxScore = null;
      }

      if (catModal) {
        catModal.classList.add('hidden');
        catModal.setAttribute('aria-hidden', 'true');
      }

      startSession({ categories, types, maxScore });
    });
  }

  function startSession({ categories, types, maxScore } = {}) {
    let ids = problems
      .filter((p) => {
        if (p.deleted) return false;

        // カテゴリ
        if (categories && categories.length) {
          if (!p.categories || !p.categories.length) return false;
          if (!p.categories.some((c) => categories.includes(c))) return false;
        }

        // タイプ
        const t = p.type || 'mask';
        if (types && types.length && !types.includes(t)) return false;

        // スコア条件
        if (typeof maxScore === 'number') {
          const s = typeof p.score === 'number' ? p.score : 0;
          if (s > maxScore) return false;
        }

        return true;
      })
      .map((p) => p.id);

    if (!ids.length) {
      alert('出題できる問題がありません。条件を変えて再度お試しください。');
      return;
    }

    currentPool = ids;
    currentId = null;
    appState.recentQueue = [];
    appState.forcedQueue = [];
    saveAppState();

    const firstId = nextQuestionId();
    renderQuestion(firstId);
  }

  if (questionContainer) {
    questionContainer.addEventListener('click', (e) => {
      // ○×回答ボタン
      const oxBtn = e.target.closest && e.target.closest('.ox-answer');
      if (oxBtn) {
        const ans = oxBtn.getAttribute('data-answer');
        if (ans === 'o' || ans === 'x') handleOxAnswer(ans);
        return;
      }

      // マスククリックで一時表示
      const m = e.target.closest && e.target.closest('.mask');
      if (!m) return;
      if (isRevealed) return;
      m.classList.toggle('peek');
    });
  }

  function updateAnswerBarForType(type) {
    if (!revealBtn || !judgeBtns) return;
    if (type === 'ox') {
      // ○×問題は自動採点なのでバーは非表示
      revealBtn.style.display = 'none';
      judgeBtns.classList.add('hidden');
    } else {
      revealBtn.style.display = '';
      judgeBtns.classList.add('hidden');
      revealBtn.textContent = '解答確認';
    }
  }

  function setReveal(show) {
    isRevealed = show;
    const p = getCurrentProblem();
    const type = p?.type || 'mask';

    if (!questionContainer) return;

    // 一時表示をリセット
    questionContainer
      .querySelectorAll('.mask.peek')
      .forEach((m) => m.classList.remove('peek'));

    if (type === 'ox') {
      // ○×問題は reveal 機能を使わない
      updateAnswerBarForType('ox');
      return;
    }

    updateAnswerBarForType(type);

    if (show) {
      revealBtn.textContent = '解答を隠す';
      judgeBtns.classList.remove('hidden');
    } else {
      revealBtn.textContent = '解答確認';
      judgeBtns.classList.add('hidden');
    }

    if (type === 'mask') {
      questionContainer
        .querySelectorAll('.mask')
        .forEach((m) =>
          m.classList.toggle('revealed', show)
        );
    } else if (type === 'qa') {
      const ans = questionContainer.querySelector('.qa-answer');
      if (ans) ans.style.display = show ? 'block' : 'none';
    }
  }

  if (revealBtn) {
    revealBtn.addEventListener('click', () => setReveal(!isRevealed));
  }

  if (judgeBtns) {
    judgeBtns.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button[data-mark]');
      if (!btn) return;
      gradeCurrent(btn.getAttribute('data-mark'));
    });
  }

  function renderQuestion(id) {
    const p = getProblemById(id);
    if (!p || !questionContainer) return;
    revealedMaskStack = []; // ★追加：直前に外したマスク履歴をリセット
    currentId = id;
    oxAnswered = false;

    const type = p.type || 'mask';

    if (type === 'qa') {
      questionContainer.innerHTML = `
        <div class="qa-question">${escapeHTML(p.question || '')}</div>
        <div class="qa-answer" style="display:none;">
          <span class="muted">解答：</span>${escapeHTML(p.answer || '')}
        </div>
      `;
    } else if (type === 'ox') {
      questionContainer.innerHTML = `
        <div class="ox-question">${escapeHTML(p.question || '')}</div>
        <div class="row gap ox-buttons">
          <button class="btn good ox-answer" data-answer="o">〇</button>
          <button class="btn bad ox-answer" data-answer="x">×</button>
        </div>
        <div id="oxExplanation" class="ox-explanation muted"></div>
      `;
    } else {
      // マスク（従来）
      questionContainer.innerHTML =
        p.html || '<div class="placeholder">本文なし</div>';
    }

    questionContainer.scrollTop = 0;
    updateAnswerBarForType(type);
    if (type === 'ox') {
      isRevealed = false;
    } else {
      setReveal(false);
    }
  }

  const weightOf = (p) => 1 / (1 + Math.max(0, p.score || 0));

  function nextQuestionId() {
    // 強制出題キューの delay 更新
    appState.forcedQueue.forEach((it) => (it.delay--));
    // delay <= 0 のものを先に出題
    const idx = appState.forcedQueue.findIndex((it) => it.delay <= 0);
    if (idx >= 0) {
      const ready = appState.forcedQueue.splice(idx, 1)[0];
      if (currentPool.includes(ready.id)) {
        appState.recentQueue.push(ready.id);
        appState.recentQueue = appState.recentQueue.slice(-5);
        saveAppState();
        return ready.id;
      }
    }

    const recent = new Set(appState.recentQueue);
    const cand   = currentPool.filter((id) => !recent.has(id));
    const list   = cand.length ? cand : currentPool;
    const items  = list.map((id) => ({
      id,
      w: weightOf(getProblemById(id) || {}),
    }));
    const total = items.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;

    for (const it of items) {
      if ((r -= it.w) <= 0) {
        appState.recentQueue.push(it.id);
        appState.recentQueue = appState.recentQueue.slice(-5);
        saveAppState();
        return it.id;
      }
    }

    const fb = items[0]?.id ?? currentPool[0];
    appState.recentQueue.push(fb);
    appState.recentQueue = appState.recentQueue.slice(-5);
    saveAppState();
    return fb;
  }

  /* ===== 採点共通処理 ===== */
  function applyMark(p, mark) {
    if (!p) return;

    let d = 0;
    if (mark === 'o') d = +1;
    else if (mark === 'd') d = -0.5;
    else if (mark === 'x') d = -1;

    p.score = clamp((p.score || 0) + d, -5, +10);
    p.answerCount = (p.answerCount || 0) + 1;
    if (mark === 'o') p.correctCount = (p.correctCount || 0) + 1;
    p.updatedAt = Date.now();

    if (mark === 'x') {
      appState.forcedQueue.push({ id: p.id, delay: 5 });
    }

    const dk = todayKey();
    if (!dailyStats[dk]) dailyStats[dk] = { correct: 0, total: 0 };
    dailyStats[dk].total += 1;
    if (mark === 'o') dailyStats[dk].correct += 1;

    (p.categories || []).forEach((cat) => {
      if (!categoryStats[cat]) categoryStats[cat] = { correct: 0, total: 0 };
      categoryStats[cat].total += 1;
      if (mark === 'o') categoryStats[cat].correct += 1;
    });

    saveProblems();
    saveStats();
    saveAppState();

    renderD();
  }

  function gradeCurrent(mark) {
    const p = getCurrentProblem();
    if (!p) return;

    // マスク＆文章問題のみ手動採点
    if (p.type === 'ox') return;

    applyMark(p, mark);

    renderQuestion(nextQuestionId());
  }

  function handleOxAnswer(userMark) {
    const p = getCurrentProblem();
    if (!p || p.type !== 'ox' || !questionContainer) return;
    if (oxAnswered) return;
    oxAnswered = true;

    const correctMark = p.correct === 'x' ? 'x' : 'o';
    const isCorrect = userMark === correctMark;

    applyMark(p, isCorrect ? 'o' : 'x');

    // ボタンを無効化
    questionContainer
      .querySelectorAll('.ox-answer')
      .forEach((btn) => (btn.disabled = true));

    // 解説表示
    const expEl = questionContainer.querySelector('#oxExplanation');
    if (expEl) {
      let msg = isCorrect ? '正解です。' : '不正解です。';
      if (p.explanation) msg += ' ' + p.explanation;
      expEl.textContent = msg;

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn primary small';
      nextBtn.style.marginTop = '8px';
      nextBtn.textContent = '次の問題へ';
      nextBtn.addEventListener('click', () => {
        renderQuestion(nextQuestionId());
      });
      expEl.appendChild(document.createElement('br'));
      expEl.appendChild(nextBtn);
    }
  }

  /* ===== D：記録 ===== */
  let progressChart = null;
  let currentScoreThreshold = 3; // +3以上がデフォルト

  // スコアthresholdボタン
  scoreFilterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const th = Number(btn.getAttribute('data-threshold') || '3');
      currentScoreThreshold = th;
      scoreFilterButtons.forEach((b) => b.classList.toggle('primary', b === btn));
      renderCategoryChart();
    });
  });

  function renderD() {
    renderCategoryChart();
    renderDailyList();
  }

  function renderCategoryChart() {
    if (!progressCanvas || !window.Chart) return;

    // カテゴリごとに「score >= currentScoreThreshold」の問題数を数える
    const counts = {};
    problems
      .filter((p) => !p.deleted)
      .forEach((p) => {
        const s = typeof p.score === 'number' ? p.score : 0;
        if (s < currentScoreThreshold) return;
        (p.categories || []).forEach((cat) => {
          if (!cat) return;
          counts[cat] = (counts[cat] || 0) + 1;
        });
      });

    const cats = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'ja'));
    const labels = cats.length ? cats : ['(データなし)'];
    const dataValues = cats.length ? cats.map((c) => counts[c]) : [0];

    const data = {
      labels,
      datasets: [
        {
          label: `スコア${currentScoreThreshold}以上の問題数`,
          data: dataValues,
        },
      ],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
      },
    };

    if (progressChart) {
      progressChart.destroy();
      progressChart = null;
    }
    progressChart = new Chart(progressCanvas, {
      type: 'bar',
      data,
      options,
    });
  }

  function renderDailyList() {
    if (!dailyList) return;
    dailyList.innerHTML = '';

    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getDate()).padStart(2, '0')}`;

      const v = dailyStats[key] || { correct: 0, total: 0 };

      const row = document.createElement('div');
      row.className = 'daily-item';

      const left = document.createElement('div');
      left.textContent = key;

      const right = document.createElement('div');
      right.textContent = `${v.correct} / ${v.total}`;

      row.appendChild(left);
      row.appendChild(right);
      dailyList.appendChild(row);
    }
  }

/* ===== マスク問題：キーボード操作（完成版） ===== */
document.addEventListener('keydown', (e) => {

  // 入力中は無効
  const tag = document.activeElement.tagName.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  if (document.activeElement.isContentEditable) return;

  // モーダル中は無効
  if (!catModal.classList.contains('hidden') || !editModal.classList.contains('hidden')) {
    return;
  }

  const p = getCurrentProblem();
  if (!p || p.type !== 'mask') return;
  if (!questionContainer) return;

/* ===== P：すべて再マスク ===== */
if (e.key === 'p' || e.key === 'P') {

    questionContainer.querySelectorAll('.mask')
      .forEach(m => m.classList.remove('revealed'));

    revealedMaskStack = [];
    isRevealed = false;
    if (revealBtn) revealBtn.textContent = '解答確認';
    if (judgeBtns) judgeBtns.classList.add('hidden');

    e.preventDefault();
    return;
  }

  /* ===== Backspace / Delete：直前に外したマスクを戻す ===== */
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (revealedMaskStack.length > 0) {
      const last = revealedMaskStack.pop();
      last.classList.remove('revealed');
      e.preventDefault();
    }
    return;
  }

  /* ===== Enter：マスクを1つ外す ===== */
  if (e.key === 'Enter') {
    const masks = questionContainer.querySelectorAll('.mask:not(.revealed)');
    if (masks.length > 0) {
      const m = masks[0];
      m.classList.add('revealed');
      revealedMaskStack.push(m);
      e.preventDefault();
      return;
    }

    // 全部外し終わったら解答表示
    if (!isRevealed) {
      setReveal(true);
      e.preventDefault();
      return;
    }

    // 次の問題へ
    renderQuestion(nextQuestionId());
    e.preventDefault();
    return;
  }

  /* ===== O / D / X：キーボード採点 ===== */
  if (!isRevealed) return; // 解答表示中のみ有効

  if (e.key === 'o' || e.key === 'O') {
    gradeCurrent('o'); // 〇
    e.preventDefault();
    return;
  }

  if (e.key === 'd' || e.key === 'D') {
    gradeCurrent('d'); // △
    e.preventDefault();
    return;
  }

  if (e.key === 'x' || e.key === 'X') {
    gradeCurrent('x'); // ×
    e.preventDefault();
    return;
  }
});




  /* ===== 初期描画 ===== */
  window.addEventListener('beforeunload', () => {
    // 念のため全体を保存
    saveProblems();
    saveStats();
    saveAppState();
  });

  // Bタブ初期表示はマスク
  setBType('mask');
})();

/* ===== localStorage 使用量ユーティリティ ===== */
function getLocalStorageUsage() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    total += (key ? key.length : 0) + (val ? val.length : 0);
  }
  return total;
}

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(2) + ' KB';
  return (kb / 1024).toFixed(2) + ' MB';
}

// 一般的な localStorage 容量の目安（5MB）
const LOCALSTORAGE_LIMIT = 5 * 1024 * 1024;
