/* ======================================================
   消費税法 暗記アプリ
   - レイアウト/デザインは既存のまま
   - 修正点
     1) Aタブ：赤マスク(.mask)をタップでその部分だけ個別表示（peek）
     2) Bタブ/C編集モーダル：文字を選択しただけで自動マスク付与
     3) 繰り返し：直前に「保存」した本文＋カテゴリを復元
   - 同期UIはCタブに集約（既存のまま）
   ====================================================== */
(() => {
  /* ===== 設定（必要に応じて差し替え） ===== */
  const CONFIG = {
    OAUTH_CLIENT_ID: '727845914673-nmvo6be9cfd6rt8ijir6r14fnfhoqoo7.apps.googleusercontent.com',
    HARD_CODED_SHEET_ID: '1jQExW8ayeDhaDZ3E2PN7GWJRZ9TNCSTFFW0EFSoVn3M',          // 固定したい場合は Spreadsheet ID をここに
    SHEET_PROBLEMS: 'Problems',
    SHEET_DAILY: 'Daily',
  };

  /* ===== LocalStorage Keys ===== */
  const LS_KEYS = {
    PROBLEMS: 'problems_v1',
    APPSTATE: 'app_state_v1',
    DAILYSTATS: 'daily_stats_v1',
    DAILYTHRESH: 'daily_thresholds_v1',
    OUTBOX: 'outbox_v1',
    SYNC: 'sync_settings_v1',
    CLOUD_INDEX: 'cloud_index_v1',
  };

  /* ===== 便利関数 ===== */
  const loadJSON = (k, fb) => { try{const v=localStorage.getItem(k); return v?JSON.parse(v):fb;}catch{ return fb; } };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const saveAll = () => {
    saveJSON(LS_KEYS.PROBLEMS, problems);
    saveJSON(LS_KEYS.APPSTATE, appState);
    saveJSON(LS_KEYS.DAILYSTATS, dailyStats);
    saveJSON(LS_KEYS.DAILYTHRESH, dailyThresholds);
    saveJSON(LS_KEYS.OUTBOX, outbox);
    saveJSON(LS_KEYS.SYNC, syncSettings);
    saveJSON(LS_KEYS.CLOUD_INDEX, cloudIndex);
  };
  const uuid = ()=>'p-'+Math.random().toString(36).slice(2)+Date.now().toString(36);
  const todayKey=()=>{const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;};
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  const sanitizeHTML=(html)=>{ const d=document.createElement('div'); d.innerHTML=html; d.querySelectorAll('script,style,iframe,object,embed').forEach(n=>n.remove()); d.querySelectorAll('*').forEach(el=>{[...el.attributes].forEach(a=>{ if(/^on/i.test(a.name)) el.removeAttribute(a.name); });}); return d.innerHTML; };
  const parseCategories=s=>s.split(',').map(x=>x.trim()).filter(Boolean);
  const extractAnswersFrom=el=>Array.from(el.querySelectorAll('.mask')).map(m=>(m.textContent||'').trim()).filter(Boolean);
  const unmaskAllIn=el=>el.querySelectorAll('.mask').forEach(m=>{ const p=m.parentNode; while(m.firstChild)p.insertBefore(m.firstChild,m); p.removeChild(m); });
  const firstSentenceFromHTML = (html)=>{ const d=document.createElement('div'); d.innerHTML=html; const t=(d.textContent||'').replace(/\s+/g,' ').trim(); if(!t) return '(空)'; const i=t.indexOf('。'); if(i>=0) return t.slice(0,Math.min(i+1,120)); return t.slice(0,100)+(t.length>100?'…':''); };
  const safeParseJSON=(s,fb)=>{ try{ return s?JSON.parse(s):fb; }catch{ return fb; } };

  /* ===== 状態 ===== */
  let problems = loadJSON(LS_KEYS.PROBLEMS, []);
  let appState = loadJSON(LS_KEYS.APPSTATE, {
    recentQueue: [],
    forcedQueue: [],
    lastPastedHTML: "",
    lastPastedCats: "",
    lastSavedHTML: "",
    lastSavedCats: [],
  });
  let dailyStats = loadJSON(LS_KEYS.DAILYSTATS, {});
  let dailyThresholds = loadJSON(LS_KEYS.DAILYTHRESH, {});
  let outbox = loadJSON(LS_KEYS.OUTBOX, []);
  let cloudIndex = loadJSON(LS_KEYS.CLOUD_INDEX, { problems: {}, daily: {} });

  // 同期設定
  let syncSettings = loadJSON(LS_KEYS.SYNC, {
    clientId: CONFIG.OAUTH_CLIENT_ID,
    sheetId: '',
    sheetProblems: CONFIG.SHEET_PROBLEMS,
    sheetDaily: CONFIG.SHEET_DAILY,
  });
  if (CONFIG.HARD_CODED_SHEET_ID) syncSettings.sheetId = CONFIG.HARD_CODED_SHEET_ID;

  /* ===== DOM 取得（存在しない場合も想定して安全に） ===== */
  const $ = (s)=>document.querySelector(s);
  const $$ = (s)=>document.querySelectorAll(s);

  // タブ
  const tabButtons = $$('.tab-btn');
  const pages = $$('.page');

  // A
  const startAllBtn = $('#startAllBtn');
  const startByCatBtn = $('#startByCatBtn');
  const questionContainer = $('#questionContainer');
  const revealBtn = $('#revealBtn');
  const judgeBtns = $('#judgeBtns');

  // B
  const editor = $('#editor');
  const maskBtn = $('#maskBtn');
  const unmaskAllBtn = $('#unmaskAllBtn');
  const repeatBtn = $('#repeatBtn');
  const clearDraftBtn = $('#clearDraftBtn');
  const catInput = $('#catInput');
  const saveProblemBtn = $('#saveProblemBtn');

  // C
  const problemList = $('#problemList');
  const catChips = $('#catChips');
  const clearCatFilterBtn = $('#clearCatFilterBtn');
  const exportJsonBtn = $('#exportJsonBtn');
  const importJsonInput = $('#importJsonInput');

  // 同期UI（Cタブ）
  const syncBadge = $('#syncBadge');
  const loginBtn = $('#loginBtn');
  const logoutBtn = $('#logoutBtn');
  const syncNowBtn = $('#syncNowBtn');
  const syncSettingsDetails = $('#syncSettingsDetails');
  const sheetIdInput = $('#sheetIdInput');
  const sheetProblemsInput = $('#sheetProblemsInput');
  const sheetDailyInput = $('#sheetDailyInput');
  const saveSyncSettingsBtn = $('#saveSyncSettingsBtn');

  // D
  const progressCanvas = $('#progressChart');
  const dailyList = $('#dailyList');

  // モーダル
  const catModal = $('#catModal');
  const catModalBody = $('#catModalBody');
  const catModalCancel = $('#catModalCancel');
  const catModalStart = $('#catModalStart');

  const editModal = $('#editModal');
  const editEditor = $('#editEditor');
  const editCatInput = $('#editCatInput');
  const editMaskBtn = $('#editMaskBtn');
  const editUnmaskAllBtn = $('#editUnmaskAllBtn');
  const editCancelBtn = $('#editCancelBtn');
  const editSaveBtn = $('#editSaveBtn');
  const editMeta = $('#editMeta');

  /* ===== 自動マスク付与（選択しただけで） ===== */
  function autoMaskOnSelection(rootEditable){
    if (!rootEditable) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount===0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    if (!rootEditable.contains(range.commonAncestorContainer)) return;

    // 既存マスク上の選択なら解除（トグル）
    let anc = range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest && anc.closest('.mask');
    if (inMask) {
      const t=inMask, p=t.parentNode;
      while(t.firstChild) p.insertBefore(t.firstChild,t);
      p.removeChild(t);
      sel.removeAllRanges();
      return;
    }
    try {
      const span=document.createElement('span'); span.className='mask';
      range.surroundContents(span);
    } catch {
      const frag=range.extractContents();
      const wrap=document.createElement('span'); wrap.className='mask';
      wrap.appendChild(frag); range.insertNode(wrap);
    }
    sel.removeAllRanges();
  }

  function toggleMaskSelection(rootEditable){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount===0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    if (!rootEditable.contains(range.commonAncestorContainer)) return;

    let anc = range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    const inMask = anc && anc.closest && anc.closest('.mask');
    if (inMask) {
      const t=inMask, p=t.parentNode;
      while(t.firstChild) p.insertBefore(t.firstChild,t);
      p.removeChild(t);
      return;
    }
    try {
      const span=document.createElement('span'); span.className='mask';
      range.surroundContents(span);
    } catch {
      const frag=range.extractContents();
      const wrap=document.createElement('span'); wrap.className='mask';
      wrap.appendChild(frag); range.insertNode(wrap);
    }
  }

  /* ===== タブ切替 ===== */
  tabButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabButtons.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      const target=btn.getAttribute('data-target');
      pages.forEach(p=>p.classList.remove('show'));
      const page=document.querySelector(target); if(page) page.classList.add('show');
      if (target==='#tab-c') renderC();
      if (target==='#tab-d') renderD();
    });
  });

  /* ===== B：問題作成 ===== */
  if (editor){
    editor.addEventListener('paste', ()=>setTimeout(()=>{
      appState.lastPastedHTML = editor.innerHTML;
      if (catInput && catInput.value && catInput.value.trim()) appState.lastPastedCats = catInput.value.trim();
      saveAll();
    },0));

    // 既存ボタン（残す）
    if (maskBtn) maskBtn.addEventListener('click', ()=>toggleMaskSelection(editor));
    if (unmaskAllBtn) unmaskAllBtn.addEventListener('click', ()=>unmaskAllIn(editor));

    // 選択→即マスク（誤作動防止のため少し遅延）
    ['mouseup','keyup','touchend'].forEach(ev=>{
      editor.addEventListener(ev, ()=>setTimeout(()=>autoMaskOnSelection(editor), 10));
    });
  }

  if (repeatBtn){
    repeatBtn.addEventListener('click', ()=>{
      if (appState.lastSavedHTML) {
        if (editor) editor.innerHTML = appState.lastSavedHTML;
        if (catInput) catInput.value = (appState.lastSavedCats||[]).join(', ');
      } else if (appState.lastPastedHTML) {
        if (editor) editor.innerHTML = appState.lastPastedHTML;
        if (catInput) catInput.value = appState.lastPastedCats || '';
      } else {
        alert('繰り返しできる直前データがありません。長文をペーストして保存してください。');
      }
    });
  }
  if (clearDraftBtn) clearDraftBtn.addEventListener('click', ()=>{ if(editor) editor.innerHTML=''; if(catInput) catInput.value=''; });
  if (catInput) catInput.addEventListener('change', ()=>{ appState.lastPastedCats = catInput.value.trim(); saveAll(); });

  if (saveProblemBtn){
    saveProblemBtn.addEventListener('click', ()=>{
      if (!editor) return;
      const html = editor.innerHTML.trim();
      if (!html){ alert('長文を入力してください。'); return; }
      const answers = extractAnswersFrom(editor);
      if (answers.length===0 && !confirm('マスクがありません。保存しますか？')) return;
      const categories = parseCategories(catInput?catInput.value:'');
      const now=Date.now(); const id=uuid();
      problems.push({ id, html, answers, categories, score:0, answerCount:0, correctCount:0, deleted:false, createdAt:now, updatedAt:now });
      outbox.push({ kind:'problem', id, op:'upsert', updatedAt: now });

      // 繰り返し用に覚える
      appState.lastSavedHTML = html;
      appState.lastSavedCats = categories;

      saveAll();
      editor.innerHTML=''; if (catInput) catInput.value='';
      alert('保存しました。（Cタブに反映 & 同期キューに追加）');
    });
  }

  /* ===== C：編集/確認 + 同期 ===== */
  let currentCatFilter = [];
  function renderC(){
    renderCategoryChips();
    renderProblemList();
    setupSyncUIVisibility();
  }
  function setupSyncUIVisibility(){
    if (!sheetIdInput || !sheetProblemsInput || !sheetDailyInput) return;
    sheetIdInput.value = syncSettings.sheetId || '';
    sheetProblemsInput.value = syncSettings.sheetProblems || CONFIG.SHEET_PROBLEMS;
    sheetDailyInput.value = syncSettings.sheetDaily || CONFIG.SHEET_DAILY;
    if (CONFIG.HARD_CODED_SHEET_ID){
      sheetIdInput.disabled=true; sheetProblemsInput.disabled=true; sheetDailyInput.disabled=true;
      if (syncSettingsDetails) syncSettingsDetails.style.display='none';
    }
  }
  function renderCategoryChips(){
    if (!catChips) return;
    const all=new Set();
    problems.filter(p=>!p.deleted).forEach(p=>(p.categories||[]).forEach(c=>all.add(c)));
    const cats=Array.from(all).sort((a,b)=>a.localeCompare(b,'ja'));
    catChips.innerHTML='';
    cats.forEach(cat=>{
      const label=document.createElement('label'); label.className='chip';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.value=cat; cb.checked=currentCatFilter.includes(cat);
      cb.addEventListener('change', ()=>{
        if (cb.checked) currentCatFilter.push(cat);
        else currentCatFilter=currentCatFilter.filter(c=>c!==cat);
        renderProblemList();
      });
      label.appendChild(cb); label.appendChild(document.createTextNode(cat));
      catChips.appendChild(label);
    });
  }
  if (clearCatFilterBtn) clearCatFilterBtn.addEventListener('click', ()=>{ currentCatFilter=[]; renderCategoryChips(); renderProblemList(); });

  function problemMatchesFilter(p){
    if (p.deleted) return false;
    if (currentCatFilter.length===0) return true;
    if (!p.categories||!p.categories.length) return false;
    return p.categories.some(c=>currentCatFilter.includes(c));
  }
  function renderProblemList(){
    if (!problemList) return;
    problemList.innerHTML='';
    const filtered=problems.filter(problemMatchesFilter);
    filtered.forEach((p, i)=>{
      const item=document.createElement('div'); item.className='problem-item';
      const t=document.createElement('div'); t.className='item-title'; t.textContent=`No.${i+1}　${firstSentenceFromHTML(p.html)}`;
      const sub=document.createElement('div'); sub.className='item-sub';
      const s1=document.createElement('span'); s1.textContent=`スコア: ${(p.score||0).toFixed(1)}`;
      const s2=document.createElement('span'); s2.textContent=`正答/回答: ${p.correctCount||0}/${p.answerCount||0}`;
      const bEdit=document.createElement('button'); bEdit.className='btn'; bEdit.textContent='編集';
      bEdit.addEventListener('click', ()=>openEditModal(p.id));
      const bDel=document.createElement('button'); bDel.className='btn'; bDel.textContent='削除';
      bDel.addEventListener('click', ()=>{
        if(!confirm('この問題を削除（ソフト）しますか？')) return;
        p.deleted=true; p.updatedAt=Date.now();
        outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt:p.updatedAt });
        saveAll(); renderC();
      });
      sub.appendChild(s1); sub.appendChild(s2); sub.appendChild(bEdit); sub.appendChild(bDel);
      item.appendChild(t); item.appendChild(sub); problemList.appendChild(item);
    });
    if (!filtered.length){
      const div=document.createElement('div'); div.className='muted'; div.textContent='該当する問題がありません。';
      problemList.appendChild(div);
    }
  }

  if (exportJsonBtn) exportJsonBtn.addEventListener('click', ()=>{
    const blob=new Blob([JSON.stringify({problems,dailyStats,dailyThresholds},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const d=new Date(); const name=`anki_export_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}.json`;
    const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url);
  });
  if (importJsonInput) importJsonInput.addEventListener('change', async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    try{
      const text=await file.text(); const data=JSON.parse(text);
      if (Array.isArray(data.problems)){
        const map=new Map(problems.map(p=>[p.id,p])); data.problems.forEach(p=>map.set(p.id,p)); problems=Array.from(map.values());
      }
      if (data.dailyStats && typeof data.dailyStats==='object') dailyStats={...dailyStats,...data.dailyStats};
      if (data.dailyThresholds && typeof data.dailyThresholds==='object') dailyThresholds={...dailyThresholds,...data.dailyThresholds};
      saveAll(); renderC(); alert('インポートしました。');
    }catch(err){ console.error(err); alert('JSONの読み込みに失敗しました。'); }
    finally{ importJsonInput.value=''; }
  });

  /* ===== 編集モーダル ===== */
  let editingId=null;
  function openEditModal(id){
    const p=problems.find(x=>x.id===id); if(!p || !editModal) return;
    editingId=id;
    editModal.classList.remove('hidden'); editModal.setAttribute('aria-hidden','false');
    if (editEditor){
      editEditor.innerHTML = sanitizeHTML(p.html);
      editEditor.classList.add('editing');
      // キャレット末尾
      requestAnimationFrame(()=>{
        const r=document.createRange(); r.selectNodeContents(editEditor); r.collapse(false);
        const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); editEditor.focus();
      });
    }
    if (editCatInput) editCatInput.value = (p.categories||[]).join(', ');
    if (editMeta) editMeta.textContent=`正答: ${p.correctCount||0} / 回答: ${p.answerCount||0} / スコア: ${(p.score||0).toFixed(1)}`;
  }
  function closeEditModal(){
    editingId=null;
    if (!editModal) return;
    editModal.classList.add('hidden'); editModal.setAttribute('aria-hidden','true');
    if (editEditor){ editEditor.classList.remove('editing'); editEditor.innerHTML=''; }
  }
  if (editMaskBtn && editEditor) editMaskBtn.addEventListener('click', ()=>toggleMaskSelection(editEditor));
  if (editUnmaskAllBtn && editEditor) editUnmaskAllBtn.addEventListener('click', ()=>unmaskAllIn(editEditor));
  if (editCancelBtn) editCancelBtn.addEventListener('click', ()=>closeEditModal());
  if (editSaveBtn) editSaveBtn.addEventListener('click', ()=>{
    const p=problems.find(x=>x.id===editingId); if(!p || !editEditor) return;
    p.html=editEditor.innerHTML.trim();
    p.answers=extractAnswersFrom(editEditor);
    p.categories=parseCategories(editCatInput?editCatInput.value:'');
    p.updatedAt=Date.now();
    outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt:p.updatedAt });
    saveAll(); closeEditModal(); renderC();
  });
  // モーダル：自動マスク（編集画面）
  if (editEditor){
    ['mouseup','keyup','touchend'].forEach(ev=>{
      editEditor.addEventListener(ev, ()=>setTimeout(()=>autoMaskOnSelection(editEditor), 10));
    });
  }
  // バックドロップ閉じ
  document.querySelectorAll('.modal .modal-backdrop').forEach(bg=>{
    bg.addEventListener('click', ()=>{
      if (catModal && !catModal.classList.contains('hidden')){ catModal.classList.add('hidden'); catModal.setAttribute('aria-hidden','true'); }
      if (editModal && !editModal.classList.contains('hidden')){ closeEditModal(); }
    });
  });

  /* ===== A：出題・採点 ===== */
  let currentPool=[]; let currentId=null; let isRevealed=false;

  if (startAllBtn) startAllBtn.addEventListener('click', ()=>startSession(null));
  if (startByCatBtn) startByCatBtn.addEventListener('click', ()=>openCatPicker());

  function openCatPicker(){
    if (!catModal || !catModalBody) return;
    catModalBody.innerHTML='';
    const set=new Set(); problems.filter(p=>!p.deleted).forEach(p=>(p.categories||[]).forEach(c=>set.add(c)));
    const cats=Array.from(set).sort((a,b)=>a.localeCompare(b,'ja'));
    if (!cats.length){
      const div=document.createElement('div'); div.className='muted'; div.textContent='カテゴリがありません。Bタブで作成してください。';
      catModalBody.appendChild(div);
    } else {
      cats.forEach(cat=>{
        const label=document.createElement('label'); label.className='chip';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.value=cat;
        label.appendChild(cb); label.appendChild(document.createTextNode(cat));
        catModalBody.appendChild(label);
      });
    }
    catModal.classList.remove('hidden'); catModal.setAttribute('aria-hidden','false');
  }
  if (catModalCancel) catModalCancel.addEventListener('click', ()=>{ if(catModal){catModal.classList.add('hidden'); catModal.setAttribute('aria-hidden','true');} });
  if (catModalStart) catModalStart.addEventListener('click', ()=>{
    if (!catModalBody){ return; }
    const selected=Array.from(catModalBody.querySelectorAll('input[type=checkbox]:checked')).map(c=>c.value);
    if (catModal){ catModal.classList.add('hidden'); catModal.setAttribute('aria-hidden','true'); }
    if (!selected.length){ alert('カテゴリを1つ以上選択してください。'); return; }
      // ✅ 次の問題ロードなどでカテゴリ再利用されるように
  if (appState.lastSavedCats?.length && catsInput){
    catsInput.value = appState.lastSavedCats.join(', ');
  }

  
    startSession(selected);
  });

  function startSession(categories){
    let ids = problems.filter(p=>!p.deleted && (categories ? (p.categories||[]).some(c=>categories.includes(c)) : true)).map(p=>p.id);
    if (!ids.length){ alert('出題できる問題がありません。Bタブで作成してください。'); return; }
    currentPool=ids; currentId=null; appState.recentQueue=[];
    setReveal(false); renderQuestion(nextQuestionId());
  }

  // Aタブ：.mask 個別タップでその部分だけ表示（全体表示中は無効）
  if (questionContainer){
    questionContainer.addEventListener('click', (e)=>{
      const m = e.target.closest && e.target.closest('.mask');
      if (!m) return;
      if (isRevealed) return;       // 全表示中は個別トグルしない
      m.classList.toggle('peek');
    });
  }

  function setReveal(show){
    isRevealed = show;
    if (!questionContainer) return;
    // 個別 peek は毎回クリア
    questionContainer.querySelectorAll('.mask.peek').forEach(m=>m.classList.remove('peek'));
    if (show){
      if (revealBtn) revealBtn.textContent='解答を隠す';
      if (judgeBtns) judgeBtns.classList.remove('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m=>m.classList.add('revealed'));
    } else {
      if (revealBtn) revealBtn.textContent='解答確認';
      if (judgeBtns) judgeBtns.classList.add('hidden');
      questionContainer.querySelectorAll('.mask').forEach(m=>m.classList.remove('revealed'));
    }
  }
  if (revealBtn) revealBtn.addEventListener('click', ()=>setReveal(!isRevealed));

  if (judgeBtns) judgeBtns.addEventListener('click', (e)=>{
    const btn=e.target.closest && e.target.closest('button[data-mark]');
    if (!btn) return;
    gradeCurrent(btn.getAttribute('data-mark'));
  });

  function renderQuestion(id){
    const p=problems.find(x=>x.id===id); if(!p || !questionContainer) return;
    currentId=id; questionContainer.innerHTML=p.html||'<div class="placeholder">本文なし</div>';
    questionContainer.scrollTop=0; setReveal(false);
  }
  const weightOf = (p)=>1/(1+Math.max(0,p.score||0)); // シンプル重み
  function nextQuestionId(){
    // ×の5問後再出題
    appState.forcedQueue.forEach(it=>it.delay--);
    const idx=appState.forcedQueue.findIndex(it=>it.delay<=0);
    if (idx>=0){
      const ready=appState.forcedQueue.splice(idx,1)[0];
      if (currentPool.includes(ready.id)){
        appState.recentQueue.push(ready.id); appState.recentQueue=appState.recentQueue.slice(-5); saveAll(); return ready.id;
      }
    }
    const recent=new Set(appState.recentQueue);
    const cand=currentPool.filter(id=>!recent.has(id));
    const list=cand.length?cand:currentPool;
    const items=list.map(id=>({id, w: weightOf(problems.find(x=>x.id===id)||{})}));
    const total=items.reduce((s,x)=>s+x.w,0);
    let r=Math.random()*total;
    for(const it of items){ if((r-=it.w)<=0){ appState.recentQueue.push(it.id); appState.recentQueue=appState.recentQueue.slice(-5); saveAll(); return it.id; } }
    const fb=items[0]?.id ?? currentPool[0];
    appState.recentQueue.push(fb); appState.recentQueue=appState.recentQueue.slice(-5); saveAll(); return fb;
  }
  function gradeCurrent(mark){
    const p=problems.find(x=>x.id===currentId); if(!p) return;
    let d=0; if(mark==='o') d=+1; else if(mark==='d') d=-0.5; else if(mark==='x') d=-1;
    p.score=clamp((p.score||0)+d, -5, +10);
    p.answerCount=(p.answerCount||0)+1; if(mark==='o') p.correctCount=(p.correctCount||0)+1;
    p.updatedAt=Date.now();
    if (mark==='x') appState.forcedQueue.push({ id:p.id, delay:5 });

    const dk=todayKey();
    if (!dailyStats[dk]) dailyStats[dk]={ correct:0, total:0 };
    dailyStats[dk].total+=1; if (mark==='o') dailyStats[dk].correct+=1;

    const ge3=problems.filter(x=>!x.deleted && (x.score||0)>=3).length;
    const ge5=problems.filter(x=>!x.deleted && (x.score||0)>=5).length;
    const ge10=problems.filter(x=>!x.deleted && (x.score||0)>=10).length;
    dailyThresholds[dk]={ ge3, ge5, ge10 };

    outbox.push({ kind:'problem', id:p.id, op:'upsert', updatedAt:p.updatedAt });
    outbox.push({ kind:'daily', date:dk, op:'upsert', updatedAt:Date.now() });

    saveAll(); renderQuestion(nextQuestionId());
  }

  /* ===== D：記録 ===== */
  function renderD(){ renderDailyList(); renderProgress(); }
  function renderDailyList(){
    if (!dailyList) return;
    dailyList.innerHTML='';
    const entries=Object.entries(dailyStats).sort((a,b)=>a[0].localeCompare(b[0],'ja'));
    if (!entries.length){ const div=document.createElement('div'); div.className='muted'; div.textContent='まだ記録がありません。'; dailyList.appendChild(div); return; }
    for(const [k,v] of entries){
      const row=document.createElement('div'); row.className='daily-item';
      const left=document.createElement('div'); left.textContent=k;
      const right=document.createElement('div'); right.textContent=`${v.correct}/${v.total}`;
      row.appendChild(left); row.appendChild(right); dailyList.appendChild(row);
    }
  }
  // Chart.js あり/なし両対応（なければスキップ）
  let progressChart=null;
  function renderProgress(){
    if (!progressCanvas || !window.Chart) return;
    const labels=Array.from(new Set([...Object.keys(dailyThresholds), ...Object.keys(dailyStats)])).sort((a,b)=>a.localeCompare(b,'ja'));
    const ge3Arr=labels.map(k=>dailyThresholds[k]?.ge3??0);
    const ge5Arr=labels.map(k=>dailyThresholds[k]?.ge5??0);
    const ge10Arr=labels.map(k=>dailyThresholds[k]?.ge10??0);
    const only10=ge10Arr;
    const only5=ge5Arr.map((v,i)=>Math.max(0,v-ge10Arr[i]));
    const only3=ge3Arr.map((v,i)=>Math.max(0,v-ge5Arr[i]));
    const data={ labels, datasets:[
      { label:'スコア +3 以上（3〜4）', data: only3 },
      { label:'スコア +5 以上（5〜9）', data: only5 },
      { label:'スコア +10', data: only10 },
    ]};
    const opt={ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } };
    if (progressChart){ progressChart.destroy(); progressChart=null; }
    progressChart=new Chart(progressCanvas,{ type:'bar', data, options:opt });
  }

  /* ===== Google Sheets 同期（Cタブに集約。コードは最小変更） ===== */
  const SCOPES='https://www.googleapis.com/auth/spreadsheets';
  const DISCOVERY_DOC='https://sheets.googleapis.com/$discovery/rest?version=v4';
  let tokenClient=null, accessToken=null;

  if (saveSyncSettingsBtn){
    saveSyncSettingsBtn.addEventListener('click', ()=>{
      if (CONFIG.HARD_CODED_SHEET_ID){ alert('シートIDはコードに埋め込み済みです。'); return; }
      if (sheetIdInput) syncSettings.sheetId = sheetIdInput.value.trim();
      if (sheetProblemsInput) syncSettings.sheetProblems = sheetProblemsInput.value.trim()||CONFIG.SHEET_PROBLEMS;
      if (sheetDailyInput) syncSettings.sheetDaily = sheetDailyInput.value.trim()||CONFIG.SHEET_DAILY;
      saveAll(); updateSyncBadge('設定保存','yellow');
    });
  }
  function updateSyncBadge(text,color){
    if (!syncBadge) return;
    syncBadge.textContent=text;
    syncBadge.className='badge '+({green:'badge-green',yellow:'badge-yellow',red:'badge-red',gray:'badge-gray'}[color]||'badge-gray');
  }
  const gapiLoad=()=>new Promise((res,rej)=>{ if (window.gapi?.client) return res(); gapi.load('client',{callback:res,onerror:rej}); });
  const isSignedIn=()=>!!accessToken;

  if (loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      try{
        await gapiLoad(); await gapi.client.init({ discoveryDocs:[DISCOVERY_DOC] });
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: syncSettings.clientId,
          scope: SCOPES,
          callback: (resp)=>{
            if (resp && resp.access_token){
              accessToken=resp.access_token; gapi.client.setToken({access_token:accessToken});
              updateSyncBadge('ログイン済み','green');
              pullAndMerge().catch(console.error); // Pullのみ
            }else{
              updateSyncBadge('ログイン失敗','red'); alert('Googleログインに失敗しました。');
            }
          }
        });
        tokenClient.requestAccessToken({ prompt:'consent' });
      }catch(e){ console.error(e); updateSyncBadge('ログイン失敗','red'); alert('Googleログインに失敗しました。'); }
    });
  }
  if (logoutBtn){
    logoutBtn.addEventListener('click', ()=>{
      try{
        if (accessToken) google.accounts.oauth2.revoke(accessToken, ()=>{ accessToken=null; gapi.client.setToken(null); updateSyncBadge('ログアウト','gray'); });
        else updateSyncBadge('ログアウト','gray');
      }catch(e){ console.error(e); }
    });
  }
  if (syncNowBtn){
    syncNowBtn.addEventListener('click', async ()=>{
      try{
        await gapiLoad();
        if (!isSignedIn()){ alert('先にGoogleログインしてください。'); return; }
        if (!syncSettings.sheetId){ alert('Spreadsheet IDが未設定です。'); return; }
        updateSyncBadge('同期中…','yellow');
        await pullAndMerge();
        await pushOutbox();
        updateSyncBadge('同期完了','green');
      }catch(e){ console.error(e); updateSyncBadge('同期失敗','red'); alert('同期に失敗しました。'); }
    });
  }

  async function pullAndMerge(){
    const sid=syncSettings.sheetId; if(!sid){ updateSyncBadge('未設定','gray'); return; }
    const resP=await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId:sid, range:`${syncSettings.sheetProblems}!A1:Z` });
    const { rows:cp, indexMap:cpi } = parseSheetRows(resP.result.values||[]);
    const resD=await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId:sid, range:`${syncSettings.sheetDaily}!A1:Z` });
    const { rows:cd, indexMap:cdi } = parseSheetRows(resD.result.values||[]);

    const map=new Map(problems.map(p=>[p.id,p]));
    cp.forEach(r=>{
      const id=r.id; if(!id) return;
      const c=normalizeProblem(r); const l=map.get(id);
      if(!l) map.set(id,c);
      else{
        if (c.deleted && !l.deleted) map.set(id,c);
        else if (!c.deleted && l.deleted) { /* keep local deleted */ }
        else if (Number(c.updatedAt||0)>Number(l.updatedAt||0)) map.set(id,c);
      }
    });
    problems=Array.from(map.values());

    const localD={...dailyStats};
    cd.forEach(r=>{
      const k=r.date; if(!k) return;
      const c=normalizeDaily(r); const l=localD[k];
      if(!l) localD[k]=c;
      else if (Number(c.updatedAt||0)>Number(l.updatedAt||0)) localD[k]=c;
    });
    dailyStats=localD;

    cloudIndex={ problems:cpi, daily:cdi };
    saveAll(); renderC(); renderD();
  }
  async function pushOutbox(){
    if (!outbox.length) return;
    const sid=syncSettings.sheetId;
    const queue=[...outbox].sort((a,b)=>Number(a.updatedAt||0)-Number(b.updatedAt||0));
    for (const it of queue){
      if (it.kind==='problem'){
        const p=problems.find(x=>x.id===it.id); if(!p) continue;
        await upsertRow(sid, syncSettings.sheetProblems, 'id', cloudIndex.problems, p.id, denormalizeProblem(p));
      } else if (it.kind==='daily'){
        const k=it.date; const d=getDailyRow(k);
        await upsertRow(sid, syncSettings.sheetDaily, 'date', cloudIndex.daily, k, denormalizeDaily(k,d));
      }
    }
    outbox=[]; saveAll();
    await pullAndMerge();
  }
  function parseSheetRows(values){
    if (!values.length) return { rows:[], indexMap:{} };
    const header=values[0]; const rows=[]; const map={};
    for(let r=1; r<values.length; r++){
      const row=values[r]; const obj={}; header.forEach((k,i)=>obj[k]=row[i]);
      rows.push(obj); const pk=obj.id||obj.date; if(pk) map[pk]=r+1;
    }
    return { rows, indexMap:map };
  }
  function normalizeProblem(o){
    return {
      id:o.id, html:o.html||'',
      answers:safeParseJSON(o.answers,[]),
      categories:safeParseJSON(o.categories,[]),
      score:Number(o.score||0), answerCount:Number(o.answerCount||0), correctCount:Number(o.correctCount||0),
      deleted:String(o.deleted||'false')==='true',
      createdAt:Number(o.createdAt||Date.now()), updatedAt:Number(o.updatedAt||Date.now())
    };
  }
  function denormalizeProblem(p){
    return {
      id:p.id, html:p.html||'',
      answers:JSON.stringify(p.answers||[]),
      categories:JSON.stringify(p.categories||[]),
      score:String(p.score??0), answerCount:String(p.answerCount??0), correctCount:String(p.correctCount??0),
      deleted:String(!!p.deleted),
      createdAt:String(p.createdAt||0), updatedAt:String(p.updatedAt||0)
    };
  }
  function normalizeDaily(o){
    return { date:o.date, correct:Number(o.correct||0), total:Number(o.total||0), ge3:Number(o.ge3||0), ge5:Number(o.ge5||0), ge10:Number(o.ge10||0), updatedAt:Number(o.updatedAt||Date.now()) };
  }
  function denormalizeDaily(date, d){
    return {
      date, correct:String(d.correct||0), total:String(d.total||0),
      ge3:String((dailyThresholds[date]?.ge3)||0),
      ge5:String((dailyThresholds[date]?.ge5)||0),
      ge10:String((dailyThresholds[date]?.ge10)||0),
      updatedAt:String(d.updatedAt||Date.now())
    };
  }
  function getDailyRow(date){ return { correct: dailyStats[date]?.correct||0, total: dailyStats[date]?.total||0, updatedAt: Date.now() }; }
  async function upsertRow(sheetId, sheetName, pkName, indexMap, key, obj){
    const headers=Object.keys(obj), rowValues=headers.map(h=>obj[h]??''); const rowNum=indexMap[key];
    if (rowNum){
      const range=`${sheetName}!A${rowNum}:${colLetter(headers.length)}${rowNum}`;
      await gapi.client.sheets.spreadsheets.values.update({ spreadsheetId:sheetId, range, valueInputOption:'RAW', resource:{ values:[rowValues] }});
    } else {
      const res=await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId:sheetId, range:`${sheetName}!A1:Z1` });
      let header=(res.result.values && res.result.values[0])||[];
      if (!header.length || !header.includes(pkName)){
        header=headers;
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId:sheetId, range:`${sheetName}!A1:${colLetter(headers.length)}1`,
          valueInputOption:'RAW', resource:{ values:[header] }
        });
      }
      const ordered=header.map(h=>obj[h]??'');
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId:sheetId, range:`${sheetName}!A1`,
        valueInputOption:'RAW', insertDataOption:'INSERT_ROWS', resource:{ values:[ordered] }
      });
    }
  }
  function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }

  /* ===== 初期描画 ===== */
  // Cタブ初期レンダリング（既存の見た目そのまま）
  renderC();
  // Dタブのグラフは表示された時に都度描画
  document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible'){ /* 必要なら再描画 */ } });

})();
