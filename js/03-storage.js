/* ============================================
   儲存模組
   ────────────────────────────────────────────
   兩種模式:
   · cloud — 已登入,資料存在 Firestore,localStorage 只當離線快取
   · local — 未登入或 Firebase 無法連線,行為與舊版完全相同

   對外只暴露 save() / Storage.load(),所有 feature-*.js 不需要修改。
============================================ */

const Storage = {
  KEY: 'guardian-classroom-v1',

  /* 每個班級各自的快取鍵,切班時不會互相覆蓋 */
  cacheKey(classId) {
    return classId ? `${this.KEY}:${classId}` : this.KEY;
  },

  load(classId) {
    try {
      const raw = localStorage.getItem(this.cacheKey(classId));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Load failed:', e);
      return null;
    }
  },

  save(data, classId) {
    try {
      localStorage.setItem(this.cacheKey(classId), JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  },

  clear(classId) {
    localStorage.removeItem(this.cacheKey(classId));
  }
};

/* ============================================
   把 state 抽成可儲存的純資料
   (排除 timer intervalId 這類執行期物件)
============================================ */

/* ============================================
   分組資料的格式轉換
   ────────────────────────────────────────────
   分組在記憶體裡是「陣列的陣列」:[[學生id, 學生id], [學生id]]。
   但 Firestore 不允許陣列裡再放陣列,整份儲存會被拒絕。
   所以寫出去時包成 [{members:[...]}, ...],讀回來再拆開。
   記憶體中的形狀維持不變,分組相關的程式都不用改。
============================================ */

function encodeGroups(groups) {
  return (groups || []).map(g => ({ members: Array.isArray(g) ? g : (g.members || []) }));
}

function decodeGroups(list) {
  return (list || []).map(g => Array.isArray(g) ? g : (g.members || []));
}

/* 存檔格式的版本。
   欄位有增減時就 +1 —— 下面的「比雲端舊就不准寫」靠它判斷。 */
const BLOB_SCHEMA = 1;

/* serializeState() 認得的欄位。
   不在這份清單裡、但雲端上有的東西會被原封不動帶回去(見 _carryOver)。 */
const KNOWN_BLOB_KEYS = [
  'schema', 'className', 'teacherName', 'students', 'rules', 'attendance',
  'seatingLayouts', 'groupSets', 'currentGroups', 'contactBook', 'homework',
  'classTasks', 'shopHistory', 'shopItems', 'territoryQuestions', 'quizzes'
];

function serializeState() {
  return {
    /* 先鋪上「這個版本不認得的欄位」。
       存檔是整份覆蓋 blob,如果只寫自己認得的欄位,那麼一個還沒更新的
       分頁(瀏覽器快取舊的 JS)存一次,新版本才有的資料就永遠消失了。
       原封不動帶回去,舊版本就不會傷到新版本的資料。 */
    ...(state._carryOver || {}),
    schema: BLOB_SCHEMA,
    className: state.className,
    teacherName: state.teacherName,
    students: state.students,
    rules: state.rules,
    attendance: state.attendance,
    seatingLayouts: state.seatingLayouts,
    groupSets: (state.groupSets || []).map(gs => ({
      ...gs,
      groups: encodeGroups(gs.groups)
    })),
    // 未命名儲存的分組也要存,老師按過「產生分組」學生就看得到小組榜
    currentGroups: encodeGroups(state.currentGroups),
    contactBook: state.contactBook,
    homework: state.homework,
    classTasks: state.classTasks,
    shopHistory: state.shopHistory,
    shopItems: state.shopItems,
    territoryQuestions: state.territoryQuestions,
    quizzes: state.quizzes
  };
}

/* ============================================
   Firestore 相容性檢查
   ────────────────────────────────────────────
   Firestore 對資料形狀有幾條硬性限制,違反時整份寫入會被拒絕,
   而 SDK 只回一句籠統的錯誤,不會告訴你是哪個欄位。
   儲存失敗時跑這個檢查,把確切路徑印到 Console。
============================================ */

const FIRESTORE_LIMITS = {
  MAX_DEPTH: 20,          // 巢狀深度上限
  MAX_DOC_BYTES: 1048576  // 單一文件 1 MiB
};

function validateForFirestore(value, path, depth, problems) {
  path = path || '(root)';
  depth = depth || 0;
  problems = problems || [];

  if (depth > FIRESTORE_LIMITS.MAX_DEPTH) {
    problems.push({ path, issue: `巢狀超過 ${FIRESTORE_LIMITS.MAX_DEPTH} 層` });
    return problems;
  }

  if (value === undefined) {
    problems.push({ path, issue: 'undefined(Firestore 不接受,請改用 null)' });
    return problems;
  }
  if (typeof value === 'number' && !isFinite(value)) {
    problems.push({ path, issue: `${value}(NaN / Infinity 不被接受)` });
    return problems;
  }
  if (typeof value === 'function') {
    problems.push({ path, issue: '函式無法儲存' });
    return problems;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (Array.isArray(item)) {
        problems.push({ path: `${path}[${i}]`, issue: '陣列裡不能直接放陣列' });
        return;
      }
      validateForFirestore(item, `${path}[${i}]`, depth + 1, problems);
    });
    return problems;
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.keys(value).forEach(key => {
      // 欄位名稱不能為空,也不能含這些字元
      if (key === '') {
        problems.push({ path, issue: '有空字串的欄位名稱' });
      } else if (/[~*/[\]]/.test(key)) {
        problems.push({ path: `${path}.${key}`, issue: '欄位名稱含 ~ * / [ ] 其中之一' });
      }
      validateForFirestore(value[key], `${path}.${key}`, depth + 1, problems);
    });
  }

  return problems;
}

/* 儲存失敗時呼叫,把問題印成人看得懂的樣子 */
function diagnoseSaveFailure(data) {
  const problems = validateForFirestore(data);
  const bytes = new Blob([JSON.stringify(data)]).size;

  console.group('[Cloud] 儲存失敗診斷');
  console.log(`資料大小約 ${(bytes / 1024).toFixed(0)} KB(上限 1024 KB)`);
  if (bytes > FIRESTORE_LIMITS.MAX_DOC_BYTES) {
    console.error('超過單一文件大小上限');
  }
  if (problems.length === 0) {
    console.log('資料形狀沒有問題,失敗原因可能是權限規則或網路');
  } else {
    console.error(`找到 ${problems.length} 處不合法的資料:`);
    problems.slice(0, 30).forEach(p => console.error(`  ${p.path} — ${p.issue}`));
    if (problems.length > 30) console.error(`  …另有 ${problems.length - 30} 處`);
  }
  console.groupEnd();

  return { problems, bytes };
}

/* ============================================
   save() — 全系統唯一的儲存進入點

   雲端模式下寫入會 debounce 800ms。老師連續點五次發分時,
   只會產生一次 Firestore 寫入,省額度也避免競態。
   localStorage 則每次都立即寫,當機也不會掉資料。
============================================ */

let _cloudSaveTimer = null;
let _cloudSavePending = false;
let _staleWarned = false;

/* 只吵一次,但吵得夠清楚 —— 這種狀況老師不重新整理就會一直存不了 */
function warnStaleVersion() {
  if (_staleWarned) return;
  _staleWarned = true;
  updateSyncStatus('error');
  toast('這個分頁的版本比雲端舊,已暫停儲存以免蓋掉資料。請重新整理頁面(Ctrl+F5)');
}

function save() {
  const data = serializeState();

  // 本機快取一律立即寫入
  Storage.save(data, state.classId);

  if (!isCloudMode()) return;

  /* 這個分頁比雲端舊,寫上去會把新版本的資料弄壞。
     寧可不存也不要存錯 —— 存錯是救不回來的,不存至少資料還在雲端。 */
  if (state._blobNewer) {
    warnStaleVersion();
    return;
  }

  _cloudSavePending = true;
  updateSyncStatus('saving');

  clearTimeout(_cloudSaveTimer);
  _cloudSaveTimer = setTimeout(flushCloudSave, 800);
}

async function flushCloudSave(isRetry) {
  if (!isCloudMode() || !_cloudSavePending) return;
  if (state._blobNewer) { _cloudSavePending = false; return; }
  const classId = state.classId;
  const data = serializeState();
  try {
    await Cloud.saveClassBlob(classId, data, {
      className: state.className,
      teacherName: state.teacherName
    });
    _cloudSavePending = false;
    updateSyncStatus('saved');
  } catch (e) {
    console.error('[Cloud] 儲存失敗:', e.code || '', e.message, e);
    updateSyncStatus('error');

    const { problems, bytes } = diagnoseSaveFailure(data);

    // 資料形狀有問題的話重試幾次都一樣,直接講清楚
    if (problems.length > 0) {
      _cloudSavePending = false;
      toast(`資料格式有誤(${problems[0].path}),詳情請看 Console。資料已存在本機`);
      return;
    }
    if (bytes > FIRESTORE_LIMITS.MAX_DOC_BYTES) {
      _cloudSavePending = false;
      toast(`班級資料已達 ${(bytes / 1024).toFixed(0)}KB,超過雲端單筆上限`);
      return;
    }

    if (!isRetry) {
      // 網路瞬斷之類的暫時性錯誤,再試一次通常就過了
      setTimeout(() => flushCloudSave(true), 3000);
      return;
    }

    // 兩次都失敗。資料還在 localStorage,但這個旗標不能一直留著 ——
    // 它會擋住班級的即時監聽,讓整個 App 之後都收不到任何更新。
    _cloudSavePending = false;
    toast('雲端儲存失敗(' + (e.code || e.message) + '),資料已暫存在本機');
  }
}

/* 關閉分頁前把還沒送出的寫入補送 */
window.addEventListener('beforeunload', () => {
  if (_cloudSavePending) flushCloudSave();
});

function isCloudMode() {
  return !!(Cloud.ready && Cloud.uid && state.classId);
}

/* 同步狀態指示燈 — 元素不存在時安靜略過 */
function updateSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const map = {
    saving: { text: '同步中…', cls: 'syncing' },
    saved:  { text: '已同步',   cls: 'synced' },
    error:  { text: '同步失敗', cls: 'error' },
    local:  { text: '單機模式', cls: 'local' }
  };
  const s = map[status] || map.local;
  el.textContent = s.text;
  el.className = 'sync-status ' + s.cls;
}
