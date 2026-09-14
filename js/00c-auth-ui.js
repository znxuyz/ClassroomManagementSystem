/* ============================================
   登入 / 班級選擇 的畫面
   ────────────────────────────────────────────
   全部共用 #gateView 這個容器,依狀態換內容。
============================================ */

function hideAllTopViews() {
  ['gateView', 'setupView', 'appView', 'studentView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function showGate(html) {
  hideAllTopViews();
  const gate = document.getElementById('gateView');
  gate.classList.remove('hidden');
  gate.innerHTML = html;
}

/* ---------- 1. 登入畫面 ---------- */

function showAuthView() {
  showGate(`
    <div class="gate-card">
      <div class="gate-title">守護獸學園</div>
      <div class="gate-subtitle">— 班 級 養 成 系 統 —</div>
      <div class="gate-desc">
        請使用你的 Google 帳號登入。<br>
        老師登入後可建立班級,學生登入後會自動進入老師已安排好的班級。
      </div>
      <button class="btn btn-primary btn-block btn-large" onclick="Session.signIn()">
        使用 Google 帳號登入
      </button>
      <div class="gate-foot">
        沒有網路也想用?<a href="#" onclick="useLocalMode(); return false;">切換為單機模式</a>
      </div>
    </div>
  `);
}

/* 讓老師在沒網路的場合仍能使用(資料只存在這台電腦) */
function useLocalMode() {
  updateSyncStatus('local');
  initLocalMode();
}

/* ---------- 2. 首次登入:選擇身份 ---------- */

function showRoleChoice() {
  showGate(`
    <div class="gate-card">
      <div class="gate-title">歡迎,${escapeHtml(state.user.displayName || state.user.email)}</div>
      <div class="gate-desc">
        系統還不認識你的身份。
      </div>

      <div class="gate-section">
        <div class="gate-section-title">我是老師</div>
        <div class="gate-section-desc">建立你的第一個班級,之後可以再新增(最多不限)。</div>
        <input type="text" id="gateClassName" class="setup-input" placeholder="班級名稱,例如:四年二班" />
        <input type="text" id="gateTeacherName" class="setup-input" placeholder="老師稱呼,例如:張老師"
               value="${escapeHtml(state.user.displayName || '')}" style="margin-top:10px;" />
        <button class="btn btn-primary btn-block" style="margin-top:12px;"
                onclick="gateCreateClass()">建立班級</button>
      </div>

      <div class="gate-section">
        <div class="gate-section-title">我是學生</div>
        <div class="gate-section-desc">
          你的信箱 <strong>${escapeHtml(state.user.email)}</strong> 還沒被加入任何班級。<br>
          請老師用 Excel 匯入名單(需包含這個信箱),然後重新整理此頁。
        </div>
        <button class="btn btn-ghost btn-block" onclick="location.reload()">重新整理</button>
      </div>

      <div class="gate-foot">
        <a href="#" onclick="Session.signOut(); return false;">登出</a>
      </div>
    </div>
  `);
}

async function gateCreateClass() {
  const className = document.getElementById('gateClassName').value.trim();
  const teacherName = document.getElementById('gateTeacherName').value.trim();
  if (!className || !teacherName) {
    toast('請填寫班級名稱與老師稱呼');
    return;
  }
  try {
    toast('建立中…');
    await Session.createClass(className, teacherName);
  } catch (e) {
    console.error(e);
    toast('建立失敗:' + e.message);
  }
}

/* ---------- 3. 老師:班級選擇 ---------- */

function showClassPicker() {
  const cards = state.myClasses.map(c => `
    <div class="class-card">
      <div onclick="Session.openClass('${c.id}')">
        <div class="class-card-name">${escapeHtml(c.className)}</div>
        <div class="class-card-meta">${c.studentCount} 位學生</div>
        <div class="class-card-code">加入代碼 ${escapeHtml(c.joinCode || '—')}</div>
      </div>
      <button class="class-card-delete" title="刪除這個班級"
              onclick="gateDeleteClass('${c.id}', '${escapeHtml(c.className)}')">✕</button>
    </div>
  `).join('');

  showGate(`
    <div class="gate-card gate-card-wide">
      <div class="gate-title">選擇班級</div>
      <div class="gate-subtitle">${escapeHtml(state.teacherName || state.user.displayName)}</div>

      <div class="class-card-grid">
        ${cards || '<div class="gate-desc">還沒有班級,先建立一個吧。</div>'}
      </div>

      <div class="gate-section">
        <div class="gate-section-title">新增班級</div>
        <input type="text" id="gateClassName" class="setup-input" placeholder="班級名稱,例如:五年一班" />
        <input type="hidden" id="gateTeacherName"
               value="${escapeHtml(state.myClasses[0]?.teacherName || state.user.displayName || '老師')}" />
        <button class="btn btn-primary btn-block" style="margin-top:12px;"
                onclick="gateCreateClass()">＋ 建立</button>
      </div>

      <div class="gate-foot">
        <a href="#" onclick="Session.signOut(); return false;">登出</a>
      </div>
    </div>
  `);
}

async function gateDeleteClass(classId, className) {
  if (!confirm(`確定刪除「${className}」?\n\n學生的守護獸、積分、測驗成績都會一併消失,無法復原。`)) return;
  if (!confirm(`最後確認:真的要刪除「${className}」嗎?`)) return;

  try {
    toast('刪除中…');
    await Cloud.deleteClass(classId);        // 會一併清掉學生的名冊索引
    Storage.clear(classId);
    state.myClasses = await Cloud.listTeacherClasses(state.user.uid);
    showClassPicker();
    toast(`已刪除「${className}」`);
  } catch (e) {
    console.error(e);
    toast('刪除失敗:' + e.message);
  }
}

/* ---------- 4. 學生:所屬班級 ---------- */

// 學生登入後直接進畫面,不用選班級。
// 極少數情況(同一個 email 出現在多個班的名冊)會有多個班,
// 這時仍然直接進第一個,切換的入口放在學生端頁首,不擋在登入路上。
function showStudentClassPicker() {
  enterStudentView(state.myClasses[0]);
}

/* 學生端頁首的班級切換(只有跨班時才會出現) */
function switchStudentClass(id) {
  const target = state.myClasses.find(c => c.classId === id);
  if (target) enterStudentView(target);
}

/* 學生端主畫面在 feature-student-view.js */
async function enterStudentView(classInfo) {
  try {
    await StudentApp.enter(classInfo);
  } catch (e) {
    console.error(e);
    toast('載入失敗:' + e.message);
  }
}

/* ---------- 老師端頂部的班級切換器 ---------- */

/* 頁首的班級控制。
   原本是「班級名稱 + 下拉選單 + 全部班級按鈕」三個東西講同一件事,
   收成一個下拉:選單本身就顯示目前班級,最後一項進班級管理。 */
function renderClassSwitcher() {
  const el = document.getElementById('classSwitcher');
  if (!el) return;
  if (!state.classId) { el.innerHTML = ''; return; }

  const many = state.myClasses.length > 1;
  const options = state.myClasses.map(c =>
    `<option value="${c.id}" ${c.id === state.classId ? 'selected' : ''}>${escapeHtml(c.className)}</option>`
  ).join('');

  el.innerHTML = `
    <select class="class-switcher-select" title="切換班級"
            onchange="onClassSwitcherChange(this)">
      ${options}
      ${many ? '<option disabled>──────────</option>' : ''}
      <option value="__manage">管理班級…</option>
    </select>
    <span id="syncStatus" class="sync-status synced">已同步</span>
  `;
}

function onClassSwitcherChange(sel) {
  if (sel.value === '__manage') {
    sel.value = state.classId;        // 選單自己彈回目前班級
    showClassPicker();
    return;
  }
  if (sel.value === state.classId) return;
  Session.switchClass(sel.value);
}

/* 基本的 HTML 逸出,避免學生姓名含特殊字元時破版 */
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
