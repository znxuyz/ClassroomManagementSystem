/* ============================================
   登入與班級切換
   ────────────────────────────────────────────
   啟動流程:
     1. Cloud.init() 成功 → 顯示登入畫面,等 Google 登入
     2. 登入後判斷身份:
        · 名下有班級 或 role=teacher → 老師,進入班級選擇
        · rosterIndex 查得到 email     → 學生,進入學生端
        · 兩者皆無                     → 顯示「請老師先匯入你的信箱」
     3. Cloud.init() 失敗 → 完全退回舊版單機模式
============================================ */

const Session = {

  /* 系統啟動點,取代舊版直接呼叫 init() */
  async boot() {
    const ok = Cloud.init();
    if (!ok) {
      // 沒有網路或 SDK 掛掉:維持舊行為,資料存本機
      updateSyncStatus('local');
      initLocalMode();
      return;
    }

    showAuthView();
    Cloud.onAuthChanged(async user => {
      if (!user) {
        showAuthView();
        return;
      }
      try {
        state.user = await Cloud.getOrCreateUser(user);
        await this.route();
      } catch (e) {
        console.error('[Session] 登入後處理失敗:', e);
        toast('讀取帳號資料失敗:' + e.message);
        showAuthView();
      }
    });
  },

  /* 依身份決定進入老師端或學生端 */
  async route() {
    const email = (state.user.email || '').toLowerCase();
    const myClasses = await Cloud.listTeacherClasses(state.user.uid);

    if (myClasses.length > 0 || state.user.role === 'teacher') {
      state.user.role = 'teacher';
      state.myClasses = myClasses;
      showClassPicker();
      return;
    }

    const studentClasses = await Cloud.findMyClasses(email);
    if (studentClasses.length > 0) {
      state.myClasses = studentClasses;
      showStudentClassPicker();
      return;
    }

    // 沒有任何身份 — 讓使用者自己選要建班(老師)還是等待被加入(學生)
    showRoleChoice();
  },

  async signIn() {
    try {
      await Cloud.signInWithGoogle();
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user') return;
      console.error(e);
      toast('登入失敗:' + e.message);
    }
  },

  async signOut() {
    await flushCloudSave();
    stopWatchingClass();
    if (typeof QuizWatch !== 'undefined') QuizWatch.stopAll();
    if (typeof PurchaseWatch !== 'undefined') PurchaseWatch.stop();
    if (typeof TerritoryGame !== 'undefined') TerritoryGame.stop();
    if (StudentApp.unsubPurchases) StudentApp.unsubPurchases();
    if (StudentApp.unsub) StudentApp.unsub();
    if (StudentApp.unsubTQuestions) StudentApp.unsubTQuestions();
    await Cloud.signOut();
    state.classId = null;
    state.user = null;
    location.reload();
  },

  /* ---------- 老師:建立與開啟班級 ---------- */

  async createClass(className, teacherName) {
    const blank = {
      className,
      teacherName,
      students: [],
      rules: [...DEFAULT_RULES],
      attendance: {},
      seatingLayouts: [],
      groupSets: [],
      contactBook: {},
      homework: [],
      classTasks: [],
      shopHistory: [],
      shopItems: [],
      territoryQuestions: [],
      quizzes: []
    };
    const { id } = await Cloud.createClass(
      state.user.uid, className, teacherName, blank
    );
    if (state.user.role !== 'teacher') {
      await Cloud.promoteToTeacher(state.user.uid);
      state.user.role = 'teacher';
    }
    state.myClasses = await Cloud.listTeacherClasses(state.user.uid);
    await this.openClass(id);
  },

  /* 載入某個班級的資料到 state,並進入主介面 */
  async openClass(classId) {
    const doc = await Cloud.loadClass(classId);
    if (!doc) {
      toast('找不到這個班級,可能已被刪除');
      return;
    }
    resetPerClassUiState();
    applyBlobToState(doc.blob || {});
    state.classId = classId;
    state.joinCode = doc.joinCode;
    state.className = doc.className || state.className;
    state.teacherName = doc.teacherName || state.teacherName;
    updateSyncStatus('saved');
    showApp();
    renderActiveView();      // 換班後,目前停留的那一頁也要換成新班級的內容

    watchCurrentClass();
    PurchaseWatch.start();
    TerritoryGame.start();
    // 到了統一結算時間的測驗,老師一開系統就算完,不必先切到測驗分頁
    QuizWatch.startDueTimer();

    // 收進學生自己挑好的守護獸(不擋畫面,收完再重繪)
    applyPendingPetChoices();
  },

  /* 切班前先把未送出的寫入補完,避免資料留在上一班 */
  async switchClass(classId) {
    await flushCloudSave();
    stopWatchingClass();
    QuizWatch.stopAll();
    PurchaseWatch.stop();
    TerritoryGame.stop();
    await this.openClass(classId);
  }
};

/* ============================================
   班級資料的即時同步
   ────────────────────────────────────────────
   老師可能同時開著電腦和平板,或是學生選了守護獸。
   監聽班級文件,別的地方改了就把畫面補上。
============================================ */

let _classUnsub = null;

function watchCurrentClass() {
  stopWatchingClass();
  if (!isCloudMode()) return;

  _classUnsub = Cloud.watchClass(state.classId, doc => {
    // 自己還有沒送出的變更時先不套用,否則會把還沒寫回雲端的操作蓋掉。
    // 那筆寫入送出後,伺服器會再推一次,屆時兩邊本來就一致。
    if (_cloudSavePending) return;

    const keepSelection = state.selectedStudentId;
    applyBlobToState(doc.blob || {});
    state.selectedStudentId = keepSelection;
    state.className = doc.className || state.className;

    renderAll();
    updateSyncStatus('saved');
  });
}

function stopWatchingClass() {
  if (_classUnsub) {
    _classUnsub();
    _classUnsub = null;
  }
}

/* ============================================
   換班時要清掉的暫存狀態
   ────────────────────────────────────────────
   這些不在雲端 blob 裡,但都屬於某一個班:座位表排到一半的樣子、
   抽籤紀錄、正在看的日期。不清掉的話,換班後座位表還擺著上一班的人
   (學生 id 對不上,格子會變成空的),抽籤紀錄也還是上一班的。

   只在開啟/切換班級時呼叫,不能放進 applyBlobToState() ——
   那個函式每次雲端推送都會跑,會把老師正在排的座位表洗掉。
============================================ */
function resetPerClassUiState() {
  state.currentLayout = null;
  state.pickerHistory = [];
  state.pickerLastResult = [];
  state.pendingPetSelection = null;
  state.pendingPetSpecies = null;
  state.currentAttendanceDate = null;
  state.currentContactDate = null;
}

/* ============================================
   把雲端 blob 套進 state,並補齊舊資料缺少的欄位
============================================ */
function applyBlobToState(blob) {
  state.className     = blob.className || '';
  state.teacherName   = blob.teacherName || '';
  state.students      = blob.students || [];
  state.rules         = blob.rules && blob.rules.length ? blob.rules : [...DEFAULT_RULES];
  state.attendance    = blob.attendance || {};
  state.seatingLayouts = blob.seatingLayouts || [];
  state.groupSets     = (blob.groupSets || []).map(gs => ({
    ...gs,
    groups: decodeGroups(gs.groups)
  }));
  state.currentGroups = decodeGroups(blob.currentGroups);
  state.contactBook   = blob.contactBook || {};
  state.homework      = blob.homework || [];
  state.classTasks    = blob.classTasks || [];
  state.shopHistory   = blob.shopHistory || [];
  state.shopItems     = blob.shopItems || [];
  state.territoryQuestions = blob.territoryQuestions || [];
  state.quizzes       = blob.quizzes || [];
  state.selectedStudentId = null;
  state.students.forEach(migrateStudent);

}

/* ============================================
   套用學生自選的守護獸
   ────────────────────────────────────────────
   老師端每次開班時自動執行。只填補「還沒有守護獸」的學生,
   老師已經指定過的不會被學生的選擇蓋掉。
============================================ */
async function applyPendingPetChoices() {
  if (!isCloudMode()) return;

  let choices;
  try {
    choices = await Cloud.listPetChoices(state.classId);
  } catch (e) {
    console.warn('[Cloud] 讀取守護獸選擇失敗:', e);
    return;
  }
  if (choices.length === 0) return;

  let applied = 0;
  choices.forEach(c => {
    const student = state.students.find(s => s.id === c.studentId);
    if (!student || student.pet) return;      // 已有守護獸就不動
    if (!PET_SPECIES.some(p => p.id === c.pet)) return;   // 防止偽造的物種 id

    student.pet = c.pet;
    if (c.petName) student.petName = c.petName;
    applied++;
  });

  if (applied > 0) {
    save();
    renderAll();
    toast(`✦ ${applied} 位學生已選好守護獸`);
  }
}

/* ============================================
   單機模式 — 與改版前行為相同
============================================ */
function initLocalMode() {
  const saved = Storage.load();
  if (saved) {
    applyBlobToState(saved);
    showApp();
  } else {
    showSetup();
  }
}
