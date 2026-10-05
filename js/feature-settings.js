/* ============================================
   設定頁
============================================ */
function renderSettings() {
  document.getElementById('settingsClassName').value = state.className;
  document.getElementById('settingsTeacherName').value = state.teacherName;
  document.getElementById('settingsStudents').value =
    state.students.map(s => [s.seatNumber || '', s.name, s.email || ''].join(',')).join('\n');
  loadApiKeyToUI();
  renderThemeChoice();
}

function saveSettings() {
  state.className = document.getElementById('settingsClassName').value.trim() || state.className;
  state.teacherName = document.getElementById('settingsTeacherName').value.trim() || state.teacherName;
  save();
  renderAll();
  toast('已儲存');
}

/* 一行 = 一位學生:座號,姓名,信箱
   分隔符號逗號、全形逗號、Tab 都接受;只填姓名也可以。

   空白也當分隔符號 —— 但只在「切開後真的像是座號/信箱」時才算。
   不這樣限制的話,「李 欣怡」這種名字中間有空格的會被拆成兩個人;
   但如果完全不接受空白,老師把「1 王小明 s1@ms.chc.edu.tw」貼進來,
   整行會被當成一個名字,全班因此變成沒有信箱的新學生,登入就壞了。

   回傳的 seatNumber / email 有三種值:
     字串  = 這一行有填
     ''    = 這一行用逗號明確留白,代表要清空
     null  = 這一行根本沒提供這個欄位,套用時要保留原值
   分不開的話,老師貼一份「座號 姓名」就會把全班的信箱洗掉。 */
function parseRosterLine(line) {
  const explicit = /[,、\t]/.test(line);
  let parts = line.split(/[,、\t]/).map(s => s.trim());

  if (!explicit) {
    const loose = line.split(/\s+/).map(s => s.trim()).filter(Boolean);
    const looksStructured = loose.length > 1 &&
      loose.some(p => p.includes('@') || /^\d{1,3}$/.test(p));
    parts = looksStructured ? loose : [line.trim()];
  }

  if (parts.length === 1) return { seatNumber: null, name: parts[0], email: null };

  // 有些人習慣把姓名放前面。哪一格看起來像信箱就當信箱,
  // 純數字的那格就是座號,剩下的是姓名 —— 順序寫反也不會壞。
  const emailPart = parts.find(p => p.includes('@'));
  const rest = parts.filter(p => p !== emailPart && p !== '');
  const seatPart = rest.find(p => /^\d{1,3}$/.test(p));
  const name = rest.filter(p => p !== seatPart).join(' ') || rest[0] || '';

  // 沒用逗號的那種寫法,沒出現的欄位算「沒提供」,不是「要清空」
  const miss = explicit ? '' : null;
  return {
    seatNumber: seatPart !== undefined ? seatPart : miss,
    name,
    email: emailPart !== undefined ? emailPart : miss
  };
}

function updateStudents() {
  const text = document.getElementById('settingsStudents').value.trim();
  const rows = text.split('\n').map(l => l.trim()).filter(l => l).map(parseRosterLine)
    .filter(r => r.name);

  if (rows.length === 0) { toast('名單是空的'); return; }

  const dupSeat = rows.map(r => r.seatNumber).filter(Boolean);
  if (new Set(dupSeat).size !== dupSeat.length) {
    if (!confirm('有重複的座號,還是要更新嗎?')) return;
  }

  /* 比對順序:信箱 → 座號 → 姓名。
     這樣改名字的學生仍然接得回原本的守護獸與積分 ——
     只用姓名比對的話,改個字就等於變成新學生,積分全部歸零。 */
  const byEmail = new Map(), bySeat = new Map(), byName = new Map();
  state.students.forEach(s => {
    if (s.email) byEmail.set(s.email.trim().toLowerCase(), s);
    if (s.seatNumber) bySeat.set(String(s.seatNumber), s);
    byName.set(s.name, s);
  });

  const used = new Set();
  const pick = r => {
    const hit = (r.email && byEmail.get(r.email.toLowerCase()))
             || (r.seatNumber && bySeat.get(String(r.seatNumber)))
             || byName.get(r.name);
    if (!hit || used.has(hit.id)) return null;
    used.add(hit.id);
    return hit;
  };

  const updated = rows.map((r, i) => {
    const s = pick(r);
    if (!s) {
      const fresh = createStudent(r.name, Date.now() + i);
      fresh.seatNumber = r.seatNumber || '';
      fresh.email = r.email || '';
      return fresh;
    }
    s.name = r.name;
    if (r.seatNumber !== null) s.seatNumber = r.seatNumber;
    if (r.email !== null) s.email = r.email;
    return s;
  });

  const added = updated.length - used.size;
  const dropped = state.students.filter(s => !used.has(s.id));

  /* 被移除的學生如果身上有資料,一定要先問過。
     之前這裡是直接刪掉再跳個提示 —— 老師把名單貼錯格式時,
     全班的積分、守護獸、測驗成績就這樣無聲消失,連同登入權限。 */
  const withData = dropped.filter(s => (s.totalPoints || 0) > 0 || s.pet);
  if (withData.length > 0) {
    const names = withData.slice(0, 8).map(s => s.name).join('、') +
                  (withData.length > 8 ? ` 等 ${withData.length} 位` : '');
    if (!confirm(
      `這份名單會移除 ${dropped.length} 位學生,其中 ${withData.length} 位已經有積分或守護獸:\n\n` +
      `${names}\n\n` +
      `他們的積分、守護獸、測驗成績會一併消失,也會無法再登入。\n` +
      `確定要這樣更新嗎?`
    )) return;
  }

  const removed = dropped.length;
  state.students = updated;
  save();
  renderAll();

  toast(`名單已更新:${updated.length} 位` +
        (added > 0 ? `,新增 ${added}` : '') +
        (removed > 0 ? `,移除 ${removed}` : ''));

  // 信箱可能改了,學生的登入對應要跟著更新
  syncRosterAfterImport();
}

async function resetAll() {
  const target = state.classId
    ? `班級「${state.className}」的雲端資料`
    : '本機的所有資料';
  if (!confirm(`確定要清除${target}嗎?此動作無法復原。`)) return;

  // 雲端模式下再確認一次 — 這會刪掉整個班,不只是這台電腦的資料
  if (state.classId) {
    if (!confirm('這會連同其他裝置上的資料一起刪除,包含學生的守護獸與所有測驗成績。真的要刪除嗎?')) return;
    try {
      await Cloud.deleteClass(state.classId);
    } catch (e) {
      console.error(e);
      toast('刪除失敗:' + e.message);
      return;
    }
  }

  Storage.clear(state.classId);
  location.reload();
}

/* ============================================
   外觀主題
   ────────────────────────────────────────────
   只是換 <html data-theme>,樣式全在 css/theme-aurora.css 裡,
   所以切換不需要重新載入,也不會動到任何資料。
============================================ */
function setTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem('guardian_theme', name);
  renderThemeChoice();
  toast(name === 'aurora' ? '已切換為「極光」' : '已切換為「紙感」');
}

function renderThemeChoice() {
  const now = document.documentElement.dataset.theme || 'aurora';
  document.querySelectorAll('[data-theme-pick]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themePick === now);
  });
}

/* ============================================
   資料備份與還原
   ────────────────────────────────────────────
   班級資料是一份文件、存檔是整份覆蓋,所以誤刪或貼錯名單都是一瞬間的事。
   每日快照讓那件事變成可以還原的。
============================================ */

async function renderBackupList() {
  const el = document.getElementById('backupList');
  if (!el) return;

  if (!isCloudMode()) {
    el.innerHTML = '<div class="backup-empty">單機模式沒有雲端備份,請用「下載完整備份」留存。</div>';
    return;
  }

  el.innerHTML = '<div class="backup-empty">讀取中…</div>';
  let list;
  try {
    list = await Cloud.listBackups(state.classId);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="backup-empty">讀取備份失敗:${escapeHtml(e.message)}</div>`;
    return;
  }

  if (list.length === 0) {
    el.innerHTML = '<div class="backup-empty">還沒有備份。明天開啟這個班級時就會留下第一份。</div>';
    return;
  }

  el.innerHTML = list.map(b => `
    <div class="backup-row">
      <span class="backup-date">${escapeHtml(b.id)}</span>
      <span class="backup-meta">${b.studentCount} 位學生</span>
      <button class="btn btn-ghost btn-small"
              onclick="restoreBackup('${escapeHtml(b.id)}')">還原到這一天</button>
    </div>`).join('');
}

async function restoreBackup(backupId) {
  if (!confirm(
    `要把「${state.className}」還原成 ${backupId} 的樣子嗎?\n\n` +
    `學生名單、積分、點名、分組、聯絡簿、作業、商店、測驗題目都會回到那一天。\n` +
    `那天之後的這些異動會消失。\n\n` +
    `(學生的交卷、逐題作答、領地戰紀錄是分開存的,不受影響)`
  )) return;
  if (!confirm(`最後確認:真的要還原到 ${backupId} 嗎?`)) return;

  try {
    toast('還原中…');
    const blob = await Cloud.loadBackup(state.classId, backupId);
    if (!blob) { toast('找不到這份備份'); return; }

    /* 還原前先把現況另存一份,按錯了還有退路。
       不能用 saveDailyBackup —— 它「今天已經有就不寫」,
       今天的快照通常早就存在了,等於這層保險不會生效。 */
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const stamp = `還原前-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    await Cloud.saveBackup(state.classId, stamp, serializeState()).catch(() => {});

    await Cloud.saveClassBlob(state.classId, blob, {
      className: blob.className, teacherName: blob.teacherName
    });
    applyBlobToState(blob);
    await Cloud.syncRosterIndex(state.classId, state.className, state.students)
      .catch(e => console.warn('[備份] 名冊索引同步失敗:', e.message));

    renderAll();
    renderActiveView();
    toast(`✦ 已還原到 ${backupId}`);
  } catch (e) {
    console.error(e);
    toast('還原失敗:' + e.message);
  }
}

/* 下載一份完整備份。老師手上有一份檔案,比什麼機制都可靠。 */
function exportClassBackup() {
  const data = {
    匯出時間: new Date().toISOString(),
    班級: state.className,
    老師: state.teacherName,
    說明: '這是班級資料的完整備份。學生的交卷與領地戰紀錄存在雲端的子集合,不在這個檔案裡。',
    blob: serializeState()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  a.href = url;
  a.download = `${state.className || '班級'}_備份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('備份已下載');
}
