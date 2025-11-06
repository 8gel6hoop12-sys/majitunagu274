/**
 * マジつなぐ - 就活支援Webアプリ（サイド3項目を確実に開く＋CSV4種連携）
 * 置き換え先：いま使っている一枚JS（このファイル丸ごと差し替え）
 *
 * ★使い方（最上部の設定だけ編集）———————————————
 * 1) CSV（読み込み元）
 *    Googleスプレッドシート → [ファイル]→[ウェブに公開]→形式: CSV のURLを
 *    CSV_CONFIG.*Url に入れる（4タブ分すべて任意。使わないなら空文字 "" でOK）
 *
 *   想定ヘッダ（横一行）※シートタブ名は自由：
 *   - submissions: id,title,company,year,jobType,mode,place,dateStart,dateEnd,tags,desc,applyUrl,image,approved,createdAt
 *   - participants: id,email,company,jobId,date
 *   - profiles:    email,name,university,password,createdAt,updatedAt
 *   - contacts:    id,company,person,tel,email,body,agreed,createdAt
 *
 * 2) 書き込み（参加/プロフィール/お問い合わせ/投稿/承認/却下/削除）
 *    WRITE_ENDPOINTS.execBase に Apps Script の Web アプリURLを入れる。
 *    送信ボディは { type, action?, payload }。GAS側で type を見て各シートに追記・更新。
 *
 * 3) サイドボタンは id="termsBtn" / "privacyBtn" / "companyBtn" でOK。
 *    もしIDが合わなくても data-open="terms|privacy|company" をつければ委譲で開きます。
 */

/* ==============================
   □ 設定（ここだけ編集）
   ============================== */

// LINE設定
const LINE_ADD_URL = "https://lin.ee/GrVcrFQ";
const LINE_PROFILE_URL = "https://lin.ee/EV5Fni9";

// CSV（読み込み元）— 未使用は "" のままでOK
const CSV_CONFIG = {
  submissionsUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTDTAz4fPAp0VmIIztyUIQm_FpZ_eheGV0J8qtrfoFSDvunLdeSA6JQZehgRphXgcmgJHXG14FFI0WD/pub?gid=1560204186&single=true&output=csv",
  participantsUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTDTAz4fPAp0VmIIztyUIQm_FpZ_eheGV0J8qtrfoFSDvunLdeSA6JQZehgRphXgcmgJHXG14FFI0WD/pub?gid=0&single=true&output=csv",
  profilesUrl:     "https://docs.google.com/spreadsheets/d/e/2PACX-1vTDTAz4fPAp0VmIIztyUIQm_FpZ_eheGV0J8qtrfoFSDvunLdeSA6JQZehgRphXgcmgJHXG14FFI0WD/pub?gid=248404262&single=true&output=csv",
  contactsUrl:     "https://docs.google.com/spreadsheets/d/e/2PACX-1vTDTAz4fPAp0VmIIztyUIQm_FpZ_eheGV0J8qtrfoFSDvunLdeSA6JQZehgRphXgcmgJHXG14FFI0WD/pub?gid=1978782348&single=true&output=csv",
};

// 書き込み（GAS 1本）
const WRITE_ENDPOINTS = {
  execBase: "https://script.google.com/macros/s/AKfycbwq29tb8eRhFeg96JB5Jsvwz4vOHWRbVCwSUhUIuuM5Gr-eSEiaN9FwkE0h4SlAqpr0/exec"
};

/* ==============================
   □ ユーティリティ
   ============================== */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const g  = (id) => document.getElementById(id);

function ensureBind(id, handler) {
  const el = g(id);
  if (el) {
    el.addEventListener('click', (e) => { e.preventDefault(); handler(); });
    return true;
  }
  return false;
}
function lockScroll(lock){ document.body.classList.toggle('scroll-locked', lock); }

function toCSV(rows, headers){
  const csvRows=[headers];
  rows.forEach(row=>{
    const vals=headers.map(h=>{
      let v = (row[h] ?? "").toString();
      if (v.includes(',') || v.includes('"') || v.includes('\n')) v = `"${v.replace(/"/g,'""')}"`;
      return v;
    });
    csvRows.push(vals);
  });
  return csvRows.map(r=>r.join(',')).join('\n');
}
function downloadCSV(rows, headers, base){
  const csv = toCSV(rows, headers);
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base}_${ymd}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}
function parseCsvToObjects(text){
  if (!text) return [];
  if (text.charCodeAt(0)===0xFEFF) text=text.slice(1);
  const rows=[]; let cur='', q=false, row=[];
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c==='"'&&q&&n==='"'){ cur+='"'; i++; continue;}
    if(c==='"'){ q=!q; continue;}
    if(c===','&&!q){ row.push(cur); cur=''; continue;}
    if((c==='\n'||c==='\r')&&!q){ if(cur!==''||row.length){row.push(cur);rows.push(row); row=[];cur='';} if(c==='\r'&&n==='\n') i++; continue;}
    cur+=c;
  }
  if(cur!==''||row.length){ row.push(cur); rows.push(row); }
  if(!rows.length) return [];
  const headers=rows[0].map(h=>h.trim());
  return rows.slice(1).map(r=>{
    const o={}; headers.forEach((h,i)=>o[h]=(r[i]??'').trim()); return o;
  });
}
function formatDate(s){
  if(!s) return "";
  const d=new Date(s); return Number.isNaN(d)? s : `${d.getMonth()+1}/${d.getDate()}`;
}

// GASへPOST（type, action?, payload）
async function postWrite(type, payload, action){
  if (!WRITE_ENDPOINTS.execBase) return;
  try{
    await fetch(WRITE_ENDPOINTS.execBase,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ type, action: action||'', payload })
    });
  }catch(e){ console.warn('postWrite failed:', e); }
}

/* ==============================
   □ 状態
   ============================== */

let activeYear='all';
let filters={
  q:'', jobType:'', mode:'', startDate:'', endDate:'', onlyOpen:false, favOnly:false, activeYear:'all'
};
const heroTexts=[
  "就活相談、ゆるっと受け付けてます",
  "まずは話そ。就活の相談口、ここです",
  "進路相談（個別対応）受付中"
];

/* ==============================
   □ 初期化
   ============================== */

document.addEventListener('DOMContentLoaded', () => { init().catch(console.error); });

async function init(){
  if (!localStorage.getItem('firstPopupDismissed')) g('firstPopup')?.classList.remove('hidden');
  else g('firstPopup')?.classList.add('hidden');

  const t = heroTexts[Math.floor(Math.random()*heroTexts.length)];
  g('heroText') && (g('heroText').textContent = t);

  setupEventListeners();

  // ★CSV → ローカルへ一括同期（4種）
  await syncAllFromCSV();

  renderYearChips();
  loadAndRender();
}

/* ==============================
   □ イベント
   ============================== */

function setupEventListeners(){
  // 卒年チップ
  $$('.year-chip').forEach(chip=>{
    chip.addEventListener('click',(e)=>{
      activeYear = e.currentTarget.dataset.year;
      filters.activeYear = activeYear;
      renderYearChips(); loadAndRender();
    });
  });

  // ヘッダー／ドロワー
  g('searchBtn')?.addEventListener('click', openSearchModal);
  g('loginBtn')?.addEventListener('click', openLoginModal);
  g('registerBtn')?.addEventListener('click', openRegisterModal);
  g('menuBtn')?.addEventListener('click', openDrawer);
  g('closeDrawer')?.addEventListener('click', closeDrawer);

  // ドロワーメニュー
  if (g('homeBtn')) g('homeBtn').addEventListener('click', () => { closeDrawer(); resetFilters(); loadAndRender(); });
  g('profileBtn')?.addEventListener('click', openProfileModal);
  g('contactBtn')?.addEventListener('click', openContactModal);
  g('adminBtn')?.addEventListener('click', openAdminModal);
  g('lineBtn')?.addEventListener('click', openLineProfile);

  // ←ここ重要：ID直付けで確実に開く
  ensureBind('termsBtn',   () => { closeDrawer(); openTermsModal();   });
  ensureBind('privacyBtn', () => { closeDrawer(); openPrivacyModal(); });
  ensureBind('companyBtn', () => { closeDrawer(); openCompanyModal(); });

  // 保険：data-open="terms|privacy|company"
  document.addEventListener('click', (e)=>{
    const t = e.target.closest?.('[data-open]');
    if (!t) return;
    const k = t.getAttribute('data-open');
    if (k==='terms')   { e.preventDefault(); closeDrawer(); openTermsModal(); }
    if (k==='privacy') { e.preventDefault(); closeDrawer(); openPrivacyModal(); }
    if (k==='company') { e.preventDefault(); closeDrawer(); openCompanyModal(); }
  });

  // 検索ランチャー
  g('searchLauncher')?.addEventListener('click', openSearchModal);

  // 初回ポップ
  g('closeFirstPopup')?.addEventListener('click', closeFirstPopup);
  g('lineAddBtn')?.addEventListener('click', ()=>{ window.open(LINE_ADD_URL,'_blank'); closeFirstPopup(); });

  // モーダルまわり
  g('modalBackdrop')?.addEventListener('click', closeModal);
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closeModal(); closeDrawer(); }});
}

/* ==============================
   □ レンダリング
   ============================== */

function renderYearChips(){
  $$('.year-chip').forEach(chip=>{
    chip.classList.toggle('active', chip.dataset.year===activeYear);
  });
}
function loadAndRender(){
  const jobs = loadSubmits();
  const filtered = applyFilters(jobs);
  renderJobs(filtered);
}
function renderJobs(list){
  const wrap=g('jobList'), cnt=g('resultsCount');
  if (cnt) cnt.textContent = `${list.length}件の求人`;
  if (!wrap) return;

  if (!list.length){
    wrap.innerHTML = '<div class="text-center" style="padding:2rem;color:var(--mut);">該当する求人が見つかりませんでした</div>';
    return;
  }

  wrap.innerHTML = list.map(job=>`
    <div class="job-card" data-job-id="${job.id}">
      <div class="job-image">
        ${job.image ? `<img src="${job.image}" alt="${job.title}" style="width:100%;height:100%;object-fit:cover;">` : '📷 画像なし'}
      </div>
      <div class="job-content">
        <div class="job-header">
          <h3 class="job-title">${job.title}</h3>
          <button class="job-favorite ${isFavorite(job.id)?'active':''}" data-job-id="${job.id}">★</button>
        </div>
        <div class="job-company">${job.company}</div>
        <div class="job-tags">${(job.tags||[]).map(t=>`<span class="job-tag">${t}</span>`).join('')}</div>
        <div class="job-date">${formatDate(job.dateStart)} - ${formatDate(job.dateEnd)}</div>
      </div>
    </div>
  `).join('');

  $$('.job-card').forEach(card=>{
    card.addEventListener('click',(e)=>{
      if (!e.target.classList.contains('job-favorite')){
        const id=+card.dataset.jobId;
        const job=list.find(j=>j.id===id);
        if (job) openJobModal(job);
      }
    });
  });
  $$('.job-favorite').forEach(btn=>{
    btn.addEventListener('click',(e)=>{
      e.stopPropagation();
      const id=+btn.dataset.jobId;
      toggleFavorite(id);
      btn.classList.toggle('active');
    });
  });
}
function applyFilters(jobs){
  return jobs.filter(job=>{
    if (!job.approved) return false;
    if (filters.activeYear!=='all' && job.year!==filters.activeYear) return false;
    if (filters.q){
      const q=filters.q.toLowerCase();
      const body=`${job.title} ${job.company} ${job.desc} ${(job.tags||[]).join(' ')}`.toLowerCase();
      if (!body.includes(q)) return false;
    }
    if (filters.jobType && job.jobType!==filters.jobType) return false;
    if (filters.mode && job.mode!==filters.mode) return false;
    if (filters.startDate && filters.endDate){
      const s1=new Date(job.dateStart), e1=new Date(job.dateEnd);
      const s2=new Date(filters.startDate), e2=new Date(filters.endDate);
      if (!(s1<=e2 && e1>=s2)) return false;
    }
    if (filters.favOnly && !isFavorite(job.id)) return false;
    return true;
  });
}

/* ==============================
   □ モーダル・ドロワー
   ============================== */

function openModal(){
  g('modal')?.classList.add('open');
  lockScroll(true);
  const first=g('modalContent')?.querySelector('input,textarea,select,button');
  if(first) setTimeout(()=>first.focus(),50);
}
function closeModal(){
  g('modal')?.classList.remove('open');
  g('modalDialog')?.classList.remove('is-job-detail');
  lockScroll(false);
}
function openDrawer(){ g('drawer')?.classList.add('open'); lockScroll(true); }
function closeDrawer(){ g('drawer')?.classList.remove('open'); lockScroll(false); }

/* ==============================
   □ 詳細/検索/ログイン/登録/プロフィール/問い合わせ
   ============================== */

function openJobModal(job){
  const html=`
    <div class="flex-between mb-md">
      <h2 style="margin:0;font-size:var(--font-xl);">${job.title}</h2>
      <button class="btn-close" onclick="closeModal()">×</button>
    </div>
    <div class="job-detail">
      <div class="job-image" style="height:300px;margin-bottom:var(--spacing-md);">
        ${job.image?`<img src="${job.image}" alt="${job.title}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius);">`:'📷 画像なし'}
      </div>
      <div class="mb-md"><strong>企業名:</strong> ${job.company}</div>
      <div class="mb-md"><strong>対象:</strong> ${job.year}年卒</div>
      <div class="mb-md"><strong>種別:</strong> ${job.jobType}</div>
      <div class="mb-md"><strong>開催形式:</strong> ${job.mode}</div>
      <div class="mb-md"><strong>場所:</strong> ${job.place}</div>
      <div class="mb-md"><strong>開催期間:</strong> ${formatDate(job.dateStart)} - ${formatDate(job.dateEnd)}</div>
      <div class="mb-md"><strong>タグ:</strong> ${(job.tags||[]).map(t=>`<span class="job-tag">${t}</span>`).join(' ')}</div>
      <div class="mb-md"><strong>詳細:</strong><p style="margin-top:var(--spacing-xs);line-height:1.6;">${job.desc||''}</p></div>
      <div class="flex gap-sm" style="margin-top:var(--spacing-lg);">
        <button class="btn-primary" onclick="participate(${job.id}, '${job.company.replace(/'/g,"\\'")}', '${(job.applyUrl||'').replace(/'/g,"\\'")}')">参加申込</button>
        <button class="btn-secondary ${isFavorite(job.id)?'active':''}" onclick="toggleFavorite(${job.id}); this.classList.toggle('active')">
          ${isFavorite(job.id)?'★ お気に入り済み':'☆ お気に入り'}
        </button>
      </div>
    </div>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.add('is-job-detail');
  openModal();
}

function openSearchModal(){
  const html=`
    <div class="flex-between mb-md">
      <h2 style="margin:0;">条件で検索</h2>
      <button class="btn-close" onclick="closeModal()">×</button>
    </div>
    <form id="searchForm">
      <div class="form-group"><label class="form-label">キーワード</label>
        <input type="text" class="form-input" id="searchQuery" value="${filters.q}" placeholder="企業名、職種、内容など"></div>
      <div class="form-group"><label class="form-label">職種</label>
        <select class="form-select" id="searchJobType">
          <option value="">すべて</option>
          <option value="セミナー" ${filters.jobType==='セミナー'?'selected':''}>セミナー</option>
          <option value="インターン" ${filters.jobType==='インターン'?'selected':''}>インターン</option>
          <option value="座談会" ${filters.jobType==='座談会'?'selected':''}>座談会</option>
          <option value="説明会" ${filters.jobType==='説明会'?'selected':''}>説明会</option>
        </select></div>
      <div class="form-group"><label class="form-label">開催形式</label>
        <select class="form-select" id="searchMode">
          <option value="">すべて</option>
          <option value="オンライン" ${filters.mode==='オンライン'?'selected':''}>オンライン</option>
          <option value="対面" ${filters.mode==='対面'?'selected':''}>対面</option>
        </select></div>
      <div class="form-group"><label class="form-label">開催期間</label>
        <div class="flex gap-sm">
          <input type="date" class="form-input" id="searchStartDate" value="${filters.startDate}">
          <span style="align-self:center;">〜</span>
          <input type="date" class="form-input" id="searchEndDate" value="${filters.endDate}">
        </div></div>
      <div class="form-checkbox">
        <input type="checkbox" id="searchFavOnly" ${filters.favOnly?'checked':''}>
        <label for="searchFavOnly">お気に入りのみ</label>
      </div>
      <div class="flex gap-sm" style="margin-top:var(--spacing-lg);">
        <button type="submit" class="btn-primary">検索</button>
        <button type="button" class="btn-secondary" onclick="resetSearch()">リセット</button>
      </div>
    </form>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();
  g('searchForm').addEventListener('submit',(e)=>{
    e.preventDefault();
    filters.q=g('searchQuery').value;
    filters.jobType=g('searchJobType').value;
    filters.mode=g('searchMode').value;
    filters.startDate=g('searchStartDate').value;
    filters.endDate=g('searchEndDate').value;
    filters.favOnly=g('searchFavOnly').checked;
    saveFilters(); closeModal(); loadAndRender();
  });
}
function resetSearch(){
  g('searchQuery').value='';
  g('searchJobType').value='';
  g('searchMode').value='';
  g('searchStartDate').value='';
  g('searchEndDate').value='';
  g('searchFavOnly').checked=false;
}

/* ログイン/登録/プロフィール */

function openLoginModal(){
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">ログイン</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <form id="loginForm">
      <div class="form-group"><label class="form-label">メールアドレス</label><input type="email" class="form-input" id="loginEmail" required></div>
      <div class="form-group"><label class="form-label">パスワード</label><input type="password" class="form-input" id="loginPassword" required></div>
      <button type="submit" class="btn-primary" style="width:100%;">ログイン</button>
    </form>
    <div class="text-center mt-md"><button class="btn-secondary" onclick="openRegisterModal()">新規登録はこちら</button></div>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();
  g('loginForm').addEventListener('submit',(e)=>{
    e.preventDefault();
    const email=g('loginEmail').value, pass=g('loginPassword').value;
    const list=JSON.parse(localStorage.getItem('profiles')||'[]');
    const u=list.find(p=>p.email===email&&p.password===pass);
    if(u){ localStorage.setItem('me_email',email); alert('ログインしました'); closeModal(); }
    else alert('メールアドレスまたはパスワードが間違っています');
  });
}
function openRegisterModal(){
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">新規登録</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <form id="registerForm">
      <div class="form-group"><label class="form-label">氏名</label><input type="text" class="form-input" id="registerName" required></div>
      <div class="form-group"><label class="form-label">大学</label><input type="text" class="form-input" id="registerUniversity" required></div>
      <div class="form-group"><label class="form-label">メールアドレス</label><input type="email" class="form-input" id="registerEmail" required></div>
      <div class="form-group"><label class="form-label">パスワード</label><input type="password" class="form-input" id="registerPassword" required></div>
      <button type="submit" class="btn-primary" style="width:100%;">登録</button>
    </form>
    <div class="text-center mt-md"><button class="btn-secondary" onclick="openLoginModal()">ログインはこちら</button></div>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();
  g('registerForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const profile={
      email:g('registerEmail').value,
      name:g('registerName').value,
      university:g('registerUniversity').value,
      password:g('registerPassword').value,
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    upsertProfile(profile);
    localStorage.setItem('me_email', profile.email);
    await postWrite('profiles', profile);  // GASへも送る
    alert('登録が完了しました'); closeModal();
  });
}
function openProfileModal(){
  closeDrawer(); resetFilters();
  const email=currentUserEmail(); if(!email){ openLoginModal(); return; }
  const list=JSON.parse(localStorage.getItem('profiles')||'[]');
  const u=list.find(p=>p.email===email);
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">プロフィール</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <form id="profileForm">
      <div class="form-group"><label class="form-label">氏名</label><input type="text" class="form-input" id="profileName" value="${u?.name||''}" required></div>
      <div class="form-group"><label class="form-label">大学</label><input type="text" class="form-input" id="profileUniversity" value="${u?.university||''}" required></div>
      <div class="form-group"><label class="form-label">メールアドレス</label><input type="email" class="form-input" id="profileEmail" value="${email}" readonly></div>
      <div class="flex gap-sm" style="margin-top:var(--spacing-lg);">
        <button type="submit" class="btn-primary">更新</button>
        <button type="button" class="btn-secondary" onclick="logout()">ログアウト</button>
      </div>
    </form>
    <hr style="margin:var(--spacing-lg) 0;border:none;border-top:1px solid var(--bd);">
    <h3 style="margin-bottom:var(--spacing-md);">参加履歴</h3>
    <div id="participationHistory"></div>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();
  g('profileForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const newProf={
      email,
      name:g('profileName').value,
      university:g('profileUniversity').value,
      password:u?.password||'',
      createdAt:u?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    upsertProfile(newProf);
    await postWrite('profiles', newProf); // GASへ
    alert('プロフィールを更新しました');
  });
  renderHistory();
}
function renderHistory(){
  const email=currentUserEmail(); if(!email) return;
  const parts=JSON.parse(localStorage.getItem('participants')||'[]').filter(p=>p.email===email);
  const el=g('participationHistory'); if(!el) return;
  if(!parts.length){ el.innerHTML='<p style="color:var(--mut);">参加履歴がありません</p>'; return; }
  const jobs=loadSubmits();
  el.innerHTML=parts.map(p=>{
    const job=jobs.find(j=>j.id===p.jobId);
    return `<div style="padding:var(--spacing-sm);border:1px solid var(--bd);border-radius:var(--radius);margin-bottom:var(--spacing-sm);">
      <div style="font-weight:500;">${job?.title||'削除された求人'}</div>
      <div style="color:var(--mut);font-size:var(--font-sm);">${p.company} - ${p.date}</div>
    </div>`;
  }).join('');
}

function openContactModal(){
  closeDrawer(); resetFilters();
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">資料請求・お問い合わせ</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <form id="contactForm">
      <div class="form-group"><label class="form-label">企業名</label><input type="text" class="form-input" id="contactCompany" required></div>
      <div class="form-group"><label class="form-label">担当者名</label><input type="text" class="form-input" id="contactPerson" required></div>
      <div class="form-group"><label class="form-label">電話番号</label><input type="tel" class="form-input" id="contactTel"></div>
      <div class="form-group"><label class="form-label">メールアドレス</label><input type="email" class="form-input" id="contactEmail" required></div>
      <div class="form-group"><label class="form-label">お問い合わせ内容</label>
        <textarea class="form-textarea" id="contactBody" maxlength="500" required></textarea>
        <div style="text-align:right;font-size:var(--font-sm);color:var(--mut);"><span id="contactBodyCount">0</span>/500文字</div>
      </div>
      <div class="form-checkbox"><input type="checkbox" id="contactAgreed" required>
        <label for="contactAgreed">プライバシーポリシーに同意する</label></div>
      <button type="submit" class="btn-primary" style="width:100%;">送信</button>
    </form>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();
  g('contactBody').addEventListener('input',(e)=>{ g('contactBodyCount').textContent=e.target.value.length; });
  g('contactForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const contact={
      id:Date.now(),
      company:g('contactCompany').value,
      person:g('contactPerson').value,
      tel:g('contactTel').value,
      email:g('contactEmail').value,
      body:g('contactBody').value,
      agreed:g('contactAgreed').checked,
      createdAt:new Date().toISOString()
    };
    const list=JSON.parse(localStorage.getItem('contacts')||'[]'); list.push(contact);
    localStorage.setItem('contacts', JSON.stringify(list));
    await postWrite('contacts', contact); // GASへ
    alert('お問い合わせを送信しました'); closeModal();
  });
}

/* 利用規約/プライバシー/会社情報 */

function openTermsModal(){
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">利用規約</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <div style="line-height:1.8;max-height:70vh;overflow:auto;">
      <h3>第1条（適用）</h3><p>本規約は、当サービスの利用条件を定めるものです。</p>
      <h3>第2条（利用登録）</h3><p>利用希望者は本規約に同意のうえ申請します。</p>
      <h3>第3条（禁止事項）</h3><ul><li>法令・公序良俗に反する行為</li><li>犯罪行為</li><li>運営の妨害</li></ul>
      <h3>第4条（免責）</h3><p>当サービスは損害につき責任を負いません。</p>
    </div>`;
  g('modalContent').innerHTML=html; g('modalDialog').classList.remove('is-job-detail'); openModal();
}
function openPrivacyModal(){
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">プライバシーポリシー</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <div style="line-height:1.8;max-height:70vh;overflow:auto;">
      <h3>個人情報の収集</h3><p>サービス提供に必要な範囲で収集します。</p>
      <h3>利用目的</h3><ul><li>提供・運営</li><li>問合せ対応</li><li>改善・開発</li></ul>
      <h3>第三者提供</h3><p>法令を除き同意なく提供しません。</p>
      <h3>管理</h3><p>適切な安全管理措置を講じます。</p>
    </div>`;
  g('modalContent').innerHTML=html; g('modalDialog').classList.remove('is-job-detail'); openModal();
}
function openCompanyModal(){
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">会社情報</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>
    <div style="line-height:1.8;max-height:70vh;overflow:auto;">
      <h3>マジつなぐ運営会社</h3>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid var(--bd);"><td style="padding:8px;font-weight:500;">会社名</td><td style="padding:8px;">株式会社マジつなぐ</td></tr>
        <tr style="border-bottom:1px solid var(--bd);"><td style="padding:8px;font-weight:500;">代表者</td><td style="padding:8px;">代表取締役 山田太郎</td></tr>
        <tr style="border-bottom:1px solid var(--bd);"><td style="padding:8px;font-weight:500;">所在地</td><td style="padding:8px;">〒100-0001 東京都千代田区千代田1-1-1</td></tr>
        <tr style="border-bottom:1px solid var(--bd);"><td style="padding:8px;font-weight:500;">設立</td><td style="padding:8px;">2020年4月1日</td></tr>
        <tr><td style="padding:8px;font-weight:500;">お問い合わせ</td><td style="padding:8px;">info@majitsunagu.com</td></tr>
      </table>
    </div>`;
  g('modalContent').innerHTML=html; g('modalDialog').classList.remove('is-job-detail'); openModal();
}

/* ==============================
   □ LINE
   ============================== */

function openLineProfile(){
  if (LINE_PROFILE_URL){
    const iframe=document.createElement('iframe');
    iframe.src=LINE_PROFILE_URL; iframe.style.width='100%'; iframe.style.height='500px'; iframe.style.border='none';
    iframe.onerror=()=>window.open(LINE_PROFILE_URL,'_blank');
    const html=`
      <div class="flex-between mb-md"><h2 style="margin:0;">LINE友だち追加</h2>
        <button class="btn-close" onclick="closeModal()">×</button></div>
      <div class="text-center mb-md"><p>LINEで最新の就活情報をお届けします！</p></div>
      <div id="lineIframeContainer"></div>
      <div class="text-center mt-md"><button class="btn-primary" onclick="window.open('${LINE_ADD_URL}','_blank')">LINEで友だち追加</button></div>`;
    g('modalContent').innerHTML=html;
    g('lineIframeContainer').appendChild(iframe);
    openModal();
  } else {
    window.open(LINE_ADD_URL,'_blank');
  }
  closeDrawer();
}
function closeFirstPopup(){ g('firstPopup')?.classList.add('hidden'); localStorage.setItem('firstPopupDismissed','1'); }

/* ==============================
   □ 参加・お気に入り
   ============================== */

async function participate(jobId, company, applyUrl){
  const email=currentUserEmail();
  if(!email){ alert('参加申込にはログインが必要です'); closeModal(); openLoginModal(); return; }
  addParticipation(email, company, jobId);
  await postWrite('participants', {email, company, jobId, date:new Date().toISOString().slice(0,10)}); // GASへ
  alert('参加申込を記録しました');
  if (applyUrl) window.open(applyUrl,'_blank');
}
function addParticipation(email, company, jobId){
  const list=JSON.parse(localStorage.getItem('participants')||'[]');
  list.push({id:Date.now(), email, company, jobId, date:new Date().toISOString().slice(0,10)});
  localStorage.setItem('participants', JSON.stringify(list));
}
function toggleFavorite(id){
  const fav=JSON.parse(localStorage.getItem('favIds')||'[]');
  const i=fav.indexOf(id); if(i===-1) fav.push(id); else fav.splice(i,1);
  localStorage.setItem('favIds', JSON.stringify(fav));
}
function isFavorite(id){ return (JSON.parse(localStorage.getItem('favIds')||'[]')).includes(id); }

/* ==============================
   □ 認証・プロフィール
   ============================== */

function currentUserEmail(){ return localStorage.getItem('me_email'); }
function upsertProfile(p){
  const list=JSON.parse(localStorage.getItem('profiles')||'[]');
  const i=list.findIndex(x=>x.email===p.email);
  if(i===-1) list.push(p); else list[i]=p;
  localStorage.setItem('profiles', JSON.stringify(list));
}
function logout(){ localStorage.removeItem('me_email'); alert('ログアウトしました'); closeModal(); }

/* ==============================
   □ 管理：投稿/承認/削除/画像アップ
   ============================== */

function openAdminModal(){
  closeDrawer(); resetFilters();
  const html=`
    <div class="flex-between mb-md"><h2 style="margin:0;">管理（承認・投稿・CSV）</h2>
      <button class="btn-close" onclick="closeModal()">×</button></div>

    <div style="margin-bottom:var(--spacing-lg);">
      <h3 style="margin-bottom:var(--spacing-md);">新規投稿</h3>
      <form id="submitForm">
        <div class="form-group"><label class="form-label">タイトル</label><input type="text" class="form-input" id="submitTitle" required></div>
        <div class="form-group"><label class="form-label">企業名</label><input type="text" class="form-input" id="submitCompany" required></div>
        <div class="form-group"><label class="form-label">対象年度</label>
          <select class="form-select" id="submitYear" required>
            <option value="2026">2026年卒</option><option value="2027">2027年卒</option><option value="2028">2028年卒</option>
          </select></div>
        <div class="form-group"><label class="form-label">職種</label>
          <select class="form-select" id="submitJobType" required>
            <option value="セミナー">セミナー</option><option value="インターン">インターン</option>
            <option value="座談会">座談会</option><option value="説明会">説明会</option>
          </select></div>
        <div class="form-group"><label class="form-label">開催形式</label>
          <select class="form-select" id="submitMode" required>
            <option value="オンライン">オンライン</option><option value="対面">対面</option>
          </select></div>
        <div class="form-group"><label class="form-label">場所</label><input type="text" class="form-input" id="submitPlace" required></div>
        <div class="form-group"><label class="form-label">開始日</label><input type="date" class="form-input" id="submitDateStart" required></div>
        <div class="form-group"><label class="form-label">終了日</label><input type="date" class="form-input" id="submitDateEnd" required></div>
        <div class="form-group"><label class="form-label">タグ（カンマ区切り）</label><input type="text" class="form-input" id="submitTags" placeholder="例: IT,エンジニア,初心者歓迎"></div>
        <div class="form-group"><label class="form-label">詳細説明</label><textarea class="form-textarea" id="submitDesc" required></textarea></div>
        <div class="form-group"><label class="form-label">応募URL</label><input type="url" class="form-input" id="submitApplyUrl" required></div>

        <div class="form-group"><label class="form-label">画像ファイル（任意）</label>
          <input type="file" class="form-input" id="submitImageFile" accept="image/*">
          <div id="submitImagePreview" style="margin-top:8px;display:none;">
            <img id="submitImagePreviewImg" alt="preview" style="max-width:160px;border:1px solid var(--bd);border-radius:8px;">
          </div>
        </div>

        <button type="submit" class="btn-primary">投稿</button>
      </form>
    </div>

    <hr style="margin:var(--spacing-lg) 0;border:none;border-top:1px solid var(--bd);">

    <div style="margin-bottom:var(--spacing-lg);">
      <h3 style="margin-bottom:var(--spacing-md);">承認待ち</h3>
      <div id="pendingSubmissions"></div>
    </div>

    <hr style="margin:var(--spacing-lg) 0;border:none;border-top:1px solid var(--bd);">

    <div style="margin-bottom:var(--spacing-lg);">
      <h3 style="margin-bottom:var(--spacing-md);">公開中の投稿</h3>
      <div id="publishedSubmissions"></div>
    </div>

    <hr style="margin:var(--spacing-lg) 0;border:none;border-top:1px solid var(--bd);">

    <div>
      <h3 style="margin-bottom:var(--spacing-md);">データ管理</h3>
      <div class="flex gap-sm" style="flex-wrap:wrap;">
        <button class="btn-secondary" onclick="exportParticipants()">参加者データDL</button>
        <button class="btn-secondary" onclick="exportProfiles()">プロフィールDL</button>
        <button class="btn-secondary" onclick="exportContacts()">お問い合わせDL</button>
        <button class="btn-secondary" onclick="exportSubmissions()">投稿データDL</button>
        <button class="btn-secondary" onclick="reloadCsvNow()">CSV再読込</button>
      </div>
    </div>
  `;
  g('modalContent').innerHTML=html;
  g('modalDialog').classList.remove('is-job-detail');
  openModal();

  // 画像プレビュー
  let imageDataURL='';
  const fileInput=g('submitImageFile');
  fileInput.addEventListener('change',()=>{
    const f=fileInput.files?.[0];
    if(!f){ imageDataURL=''; g('submitImagePreview').style.display='none'; return; }
    const r=new FileReader();
    r.onload=()=>{ imageDataURL=r.result; g('submitImagePreview').style.display='block'; g('submitImagePreviewImg').src=imageDataURL; };
    r.readAsDataURL(f);
  });

  g('submitForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const job={
      id:Date.now(),
      title:g('submitTitle').value,
      company:g('submitCompany').value,
      year:g('submitYear').value,
      jobType:g('submitJobType').value,
      mode:g('submitMode').value,
      place:g('submitPlace').value,
      dateStart:g('submitDateStart').value,
      dateEnd:g('submitDateEnd').value,
      tags:g('submitTags').value.split(',').map(s=>s.trim()).filter(Boolean),
      desc:g('submitDesc').value,
      applyUrl:g('submitApplyUrl').value,
      image:imageDataURL||'',
      approved:false,
      createdAt:new Date().toISOString()
    };
    const jobs=loadSubmits(); jobs.push(job); saveSubmits(jobs);
    await postWrite('submissions', job, 'create'); // GASへ
    alert('投稿しました。承認をお待ちください。');
    g('submitForm').reset(); g('submitImagePreview').style.display='none';
    renderPendingSubmissions();
  });

  renderPendingSubmissions();
  renderPublishedSubmissions();
}
function renderPendingSubmissions(){
  const jobs=loadSubmits().filter(j=>!j.approved);
  const c=g('pendingSubmissions'); if(!c) return;
  if(!jobs.length){ c.innerHTML='<p style="color:var(--mut);">承認待ちの投稿はありません</p>'; return; }
  c.innerHTML=jobs.map(job=>`
    <div style="padding:var(--spacing-md);border:1px solid var(--bd);border-radius:var(--radius);margin-bottom:var(--spacing-sm);">
      <h4 style="margin:0 0 8px 0;">${job.title}</h4>
      <div style="color:var(--mut);font-size:var(--font-sm);margin-bottom:8px;">${job.company} - ${job.year}年卒 - ${job.jobType}</div>
      <div class="flex gap-sm">
        <button class="btn-primary" onclick="approveJob(${job.id})">承認</button>
        <button class="btn-secondary" onclick="rejectJob(${job.id})">却下</button>
      </div>
    </div>`).join('');
}
function renderPublishedSubmissions(){
  const jobs=loadSubmits().filter(j=>j.approved);
  const c=g('publishedSubmissions'); if(!c) return;
  if(!jobs.length){ c.innerHTML='<p style="color:var(--mut);">公開中の投稿はありません</p>'; return; }
  c.innerHTML=jobs.map(job=>`
    <div style="padding:var(--spacing-md);border:1px solid var(--bd);border-radius:var(--radius);margin-bottom:var(--spacing-sm);display:flex;gap:12px;align-items:center;">
      <div style="flex:1;">
        <div style="font-weight:600;">${job.title}</div>
        <div style="color:var(--mut);font-size:var(--font-sm);">${job.company} - ${job.year}年卒 - ${job.jobType}</div>
      </div>
      <button class="btn-secondary" onclick="deleteJob(${job.id})">削除</button>
    </div>`).join('');
}
async function approveJob(id){
  const jobs=loadSubmits(); const target=jobs.find(j=>j.id===id);
  if(target){ target.approved=true; saveSubmits(jobs); await postWrite('submissions',{id},'approve'); alert('承認しました'); renderPendingSubmissions(); renderPublishedSubmissions(); loadAndRender(); }
}
async function rejectJob(id){
  const jobs=loadSubmits().filter(j=>j.id!==id);
  saveSubmits(jobs); await postWrite('submissions',{id},'reject'); alert('却下しました'); renderPendingSubmissions();
}
async function deleteJob(id){
  if(!confirm('この投稿を削除します。よろしいですか？')) return;
  const jobs=loadSubmits().filter(j=>j.id!==id);
  saveSubmits(jobs); await postWrite('submissions',{id},'delete'); alert('削除しました'); renderPublishedSubmissions(); loadAndRender();
}

