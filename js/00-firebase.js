/* ============================================
   Firebase 設定與初始化
   ────────────────────────────────────────────
   使用 compat 版 SDK,因為本專案沒有 build 步驟,
   compat 版會掛上全域的 firebase.*,可直接用 <script> 引入。

   如果你要換成自己的 Firebase 專案,只需要改下面這一段。
   這段設定可以公開,安全性是由 firestore.rules 控管。
============================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBXyQ4OwD2f_dxDmb6X32i4CQw_Dc_q3k4",
  authDomain: "classroom-management-sys-26f97.firebaseapp.com",
  projectId: "classroom-management-sys-26f97",
  storageBucket: "classroom-management-sys-26f97.firebasestorage.app",
  messagingSenderId: "584347256149",
  appId: "1:584347256149:web:1439f46ff4dd7e908cdbdc"
};

/* 雲端模組 - 所有 Firebase 操作的單一入口 */
const Cloud = {
  ready: false,
  db: null,
  auth: null,

  /* 初始化。SDK 沒載入成功時回傳 false,系統會退回單機模式 */
  init() {
    if (typeof firebase === 'undefined') {
      console.warn('[Cloud] Firebase SDK 未載入,退回單機模式');
      return false;
    }
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      // 離線快取:網路斷線時仍可讀取先前資料
      this.db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        console.warn('[Cloud] 離線快取無法啟用:', err.code);
      });
      this.ready = true;
      return true;
    } catch (e) {
      console.error('[Cloud] 初始化失敗:', e);
      return false;
    }
  },

  /* ---------- 身份驗證 ---------- */

  signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return this.auth.signInWithPopup(provider);
  },

  signOut() {
    return this.auth.signOut();
  },

  onAuthChanged(callback) {
    return this.auth.onAuthStateChanged(callback);
  },

  get uid() {
    return this.auth && this.auth.currentUser ? this.auth.currentUser.uid : null;
  },

  /* ---------- 使用者檔案 ---------- */

  /* 取得使用者資料;第一次登入會自動建立。role 預設為 student,
     老師身份由「建立班級」這個動作升級,或由既有班級的 teacherUid 認定 */
  async getOrCreateUser(user) {
    const ref = this.db.collection('users').doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) {
      // 每次登入更新顯示名稱,老師改暱稱時才不會卡在舊的
      await ref.update({
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        lastLogin: Date.now()
      });
      return { uid: user.uid, ...snap.data() };
    }
    const profile = {
      email: (user.email || '').toLowerCase(),
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      role: 'student',
      createdAt: Date.now(),
      lastLogin: Date.now()
    };
    await ref.set(profile);
    return { uid: user.uid, ...profile };
  },

  async promoteToTeacher(uid) {
    await this.db.collection('users').doc(uid).update({ role: 'teacher' });
  },

  /* ---------- 班級 ---------- */

  /* 列出這位老師的所有班級(不含 blob,只取清單需要的欄位) */
  async listTeacherClasses(uid) {
    const snap = await this.db.collection('classes')
      .where('teacherUid', '==', uid)
      .get();
    return snap.docs
      .map(d => ({
        id: d.id,
        className: d.data().className,
        teacherName: d.data().teacherName,
        joinCode: d.data().joinCode,
        studentCount: (d.data().blob && d.data().blob.students || []).length,
        updatedAt: d.data().updatedAt || 0
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'zh-Hant'));
  },

  async createClass(uid, className, teacherName, blob) {
    const joinCode = this.generateJoinCode();
    const ref = await this.db.collection('classes').add({
      teacherUid: uid,
      className,
      teacherName,
      joinCode,
      blob,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return { id: ref.id, joinCode };
  },

  async loadClass(classId) {
    const snap = await this.db.collection('classes').doc(classId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  },

  /* 只有老師寫這份文件,所以直接覆寫即可,不需要 transaction。
     學生的作答寫在 submissions 子集合,不會和這裡衝突。 */
  async saveClassBlob(classId, blob, meta) {
    const payload = { blob, updatedAt: Date.now() };
    if (meta && meta.className) payload.className = meta.className;
    if (meta && meta.teacherName) payload.teacherName = meta.teacherName;
    await this.db.collection('classes').doc(classId).update(payload);
  },

  /* ---------- 每日備份 ----------
     班級資料是一份文件、存檔是整份覆蓋,所以只要有一次寫壞就沒了。
     每天第一次開班時留一份當天的快照 —— 刻意「只在不存在時才寫」:
     如果今天已經弄壞了又重開班,不能讓壞掉的狀態蓋掉今天的備份。 */
  async saveDailyBackup(classId, blob) {
    const day = new Date();
    const id = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const ref = this.db.collection('classes').doc(classId).collection('backups').doc(id);

    const snap = await ref.get();
    if (snap.exists) return false;

    await ref.set({
      blob,
      at: Date.now(),
      studentCount: (blob && blob.students || []).length
    });
    return true;
  },

  /* 指定 id 的備份。還原前先存一份現況用的,id 不能和每日快照撞在一起。 */
  async saveBackup(classId, backupId, blob) {
    await this.db.collection('classes').doc(classId)
      .collection('backups').doc(backupId)
      .set({ blob, at: Date.now(), studentCount: (blob && blob.students || []).length });
  },

  async listBackups(classId, limit = 20) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('backups').orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, at: d.data().at, studentCount: d.data().studentCount || 0 }));
  },

  async loadBackup(classId, backupId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('backups').doc(backupId).get();
    return snap.exists ? snap.data().blob : null;
  },

  /* 只留最近幾份,免得一學年累積出幾百份 */
  async pruneBackups(classId, keep = 30) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('backups').orderBy('at', 'desc').get();
    const old = snap.docs.slice(keep);
    if (old.length === 0) return 0;
    const batch = this.db.batch();
    old.forEach(d => batch.delete(d.ref));
    await batch.commit();
    return old.length;
  },

  /* 刪除班級。必須連同名冊索引一起清掉,否則學生登入時
     還會看到已經不存在的班級。 */
  async deleteClass(classId) {
    const doc = await this.loadClass(classId);
    const students = (doc && doc.blob && doc.blob.students) || [];
    await this.removeFromRosterIndex(classId, students.map(s => s.email));
    await this.db.collection('classes').doc(classId).delete();
  },

  /* 把某個班級從這些 email 的索引中移除 */
  async removeFromRosterIndex(classId, emails) {
    const list = (emails || []).filter(Boolean);
    if (list.length === 0) return;

    const del = firebase.firestore.FieldValue.delete();
    // 一次批次上限 500 筆,班級規模不會超過,但還是切一下比較保險
    for (let i = 0; i < list.length; i += 400) {
      const batch = this.db.batch();
      list.slice(i, i + 400).forEach(email => {
        const ref = this.db.collection('rosterIndex').doc(this.emailKey(email));
        // update 才支援用點號指定巢狀欄位;文件不存在時會拋錯,所以個別容錯
        batch.update(ref, { [`classes.${classId}`]: del });
      });
      await batch.commit().catch(e => {
        console.warn('[Cloud] 清理名冊索引時有部分失敗:', e.message);
      });
    }
  },

  /* 六碼班級代碼,排除容易看錯的 0/O/1/I */
  generateJoinCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  },

  /* ---------- 學生名冊索引 ----------
     學生用 Google 登入後,靠 email 找到自己屬於哪些班級。
     老師匯入名單時會同步寫入這份索引。 */

  emailKey(email) {
    return (email || '').trim().toLowerCase();
  },

  /* 老師端:把整班的 email 索引寫進去。
     同時比對上次同步的名單,把已經不在這個班的學生索引清掉 ——
     重新匯入名單換掉整批學生時,舊學生才不會還看得到這個班。 */
  async syncRosterIndex(classId, className, students) {
    const withEmail = students.filter(s => s.email);
    const currentEmails = withEmail.map(s => this.emailKey(s.email));

    const classRef = this.db.collection('classes').doc(classId);
    const snap = await classRef.get();
    const previousEmails = (snap.exists && snap.data().rosterEmails) || [];
    const removed = previousEmails.filter(e => !currentEmails.includes(e));
    if (removed.length > 0) {
      await this.removeFromRosterIndex(classId, removed);
    }

    if (withEmail.length === 0) {
      await classRef.update({ rosterEmails: [] });
      return 0;
    }

    const batch = this.db.batch();
    withEmail.forEach(s => {
      const ref = this.db.collection('rosterIndex').doc(this.emailKey(s.email));
      // merge:true 對 map 欄位是深層合併,學生同時在多個班也不會互相蓋掉
      batch.set(ref, {
        classes: {
          [classId]: {
            classId,
            className,
            studentId: s.id,
            name: s.name,
            seatNumber: s.seatNumber || ''
          }
        }
      }, { merge: true });
    });
    await batch.commit();
    // 記下這次的名單,下次同步時才知道誰被移除了
    await classRef.update({ rosterEmails: currentEmails });
    return withEmail.length;
  },

  /* 學生端:用自己的 email 查出所屬班級。
     索引可能殘留已刪除的班級,所以逐一確認班級真的還在,
     並順手把失效的索引清掉(學生有權限改自己那一筆)。 */
  async findMyClasses(email) {
    const key = this.emailKey(email);
    const snap = await this.db.collection('rosterIndex').doc(key).get();
    if (!snap.exists) return [];

    const entries = Object.values(snap.data().classes || {});
    const alive = [];
    const dead = [];

    await Promise.all(entries.map(async entry => {
      try {
        const cls = await this.db.collection('classes').doc(entry.classId).get();
        if (cls.exists) alive.push(entry);
        else dead.push(entry.classId);
      } catch (e) {
        // 讀不到就當作還在,避免暫時性錯誤讓學生進不去
        alive.push(entry);
      }
    }));

    if (dead.length > 0) {
      const del = firebase.firestore.FieldValue.delete();
      const patch = {};
      dead.forEach(id => { patch[`classes.${id}`] = del; });
      this.db.collection('rosterIndex').doc(key).update(patch)
        .catch(e => console.warn('[Cloud] 清理失效索引失敗:', e.message));
    }

    return alive;
  },

  /* ---------- 測驗 ----------
     題目放在 classes/{classId}/quizzes/{quizId},學生只能讀不能寫。
     注意:發布給學生的版本會抽掉正確答案,避免學生從開發者工具偷看。
     批改在老師端做,學生只送出自己的答案。 */

  async publishQuiz(classId, quiz) {
    const forStudents = {
      id: quiz.id,
      title: quiz.title,
      dueDate: quiz.dueDate || '',
      pointsPerQuestion: quiz.pointsPerQuestion,
      scoreMode: quiz.scoreMode || 'all',
      topN: quiz.topN || 0,
      status: 'open',
      publishedAt: Date.now(),
      questions: quiz.questions.map(q => ({
        id: q.id,
        type: q.type,
        text: q.text,
        options: q.type === 'choice' ? q.options : []
        // answer 刻意不寫進來
      }))
    };
    await this.db.collection('classes').doc(classId)
      .collection('quizzes').doc(quiz.id).set(forStudents);
  },

  async setQuizStatus(classId, quizId, status) {
    await this.db.collection('classes').doc(classId)
      .collection('quizzes').doc(quizId).update({ status });
  },

  async listOpenQuizzes(classId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('quizzes').where('status', '==', 'open').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /* 學生端要的不只是開放中的測驗 —— 已結束的也要看得到自己的成績,
     否則老師一按「結束」,學生的答題結果就從畫面上消失了。
     只取最近幾份,免得一整個學期的測驗全部撈回來。 */
  async listQuizzesForStudent(classId, recent = 8) {
    const col = this.db.collection('classes').doc(classId).collection('quizzes');
    const [openSnap, closedSnap] = await Promise.all([
      col.where('status', '==', 'open').get(),
      // 這裡刻意不加 where('status','==','closed') —— 等值加排序要另外建
      // 複合索引,老師得去 Console 點一次。改成只依時間取最近幾份再自己篩。
      col.orderBy('createdAt', 'desc').limit(recent).get()
    ]);
    const map = new Map();
    [...openSnap.docs, ...closedSnap.docs]
      .filter(d => ['open', 'closed'].includes(d.data().status))
      .forEach(d => map.set(d.id, { id: d.id, ...d.data() }));
    return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  /* ---------- 逐題搶答 ----------
     每一題各自是一份文件,id 固定為 {quizId}__{uid}__{題目id},
     時間戳由伺服器蓋(規則會驗 at == request.time),而且只能建立不能修改。

     為什麼不寫進同一份作答文件?因為「每題誰最快」要比的是每一題各自的
     時間。時間如果放在同一份文件裡由學生更新,學生就能把時間改早;
     一題一份、只准建立,順序才偽造不了。 */
  async sendQuizAnswer(classId, quizId, uid, payload) {
    await this.db.collection('classes').doc(classId)
      .collection('qanswers').doc(`${quizId}__${uid}__${payload.questionId}`)
      .set({
        ...payload,
        quizId,
        uid,
        at: firebase.firestore.FieldValue.serverTimestamp()
      });
  },

  /* 學生自己答過哪幾題(重新整理、換裝置都算數) */
  async listMyQuizAnswers(classId, quizId, uid) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('qanswers')
      .where('quizId', '==', quizId).where('uid', '==', uid).get();
    const out = {};
    snap.docs.forEach(d => { out[d.data().questionId] = d.data(); });
    return out;
  },

  /* 老師端結算與即時人數用。依伺服器時間排序,先後由伺服器認定。 */
  watchQuizAnswers(classId, quizId, cb, onError) {
    return this.db.collection('classes').doc(classId)
      .collection('qanswers').where('quizId', '==', quizId)
      .onSnapshot(snap => {
        const list = [];
        snap.docs.forEach(d => {
          const data = d.data();
          if (!data.at || typeof data.at.toMillis !== 'function') return;
          list.push({ id: d.id, ...data, at: data.at.toMillis() });
        });
        list.sort((a, b) => a.at - b.at);
        cb(list);
      }, err => {
        console.warn('[測驗] 逐題作答監聽中斷:', err.message);
        if (onError) onError(err);
      });
  },

  async listQuizAnswers(classId, quizId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('qanswers').where('quizId', '==', quizId).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.at && typeof a.at.toMillis === 'function')
      .map(a => ({ ...a, at: a.at.toMillis() }))
      .sort((a, b) => a.at - b.at);
  },

  /* 學生交卷。文件 id 固定為 quizId__uid,
     所以同一位學生重交也只會蓋掉自己那一份,不影響別人。

     serverAt 用伺服器時間戳。搶答模式要比誰先交卷,不能用學生裝置的
     時鐘 —— 手機時間各自偏差幾秒甚至幾分鐘,名次會判錯。
     submittedAt 仍然保留,只作為伺服器時間拿不到時的備援。 */
  async submitAnswers(classId, quizId, uid, payload) {
    await this.db.collection('classes').doc(classId)
      .collection('submissions').doc(`${quizId}__${uid}`)
      .set({
        ...payload,
        quizId,
        uid,
        submittedAt: Date.now(),
        serverAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  },

  async getMySubmission(classId, quizId, uid) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('submissions').doc(`${quizId}__${uid}`).get();
    return snap.exists ? snap.data() : null;
  },

  /* ---------- 學生自選守護獸 ----------
     學生沒有權限改班級資料,所以改寫成「選擇單」:
     學生寫自己那一份,老師端開班時自動收進班級資料。
     和交卷用同一套模式,同樣不會有寫入衝突。 */

  async savePetChoice(classId, uid, choice) {
    await this.db.collection('classes').doc(classId)
      .collection('petChoices').doc(uid)
      .set({ ...choice, uid, at: Date.now() });
  },

  async getMyPetChoice(classId, uid) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('petChoices').doc(uid).get();
    return snap.exists ? snap.data() : null;
  },

  async listPetChoices(classId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('petChoices').get();
    return snap.docs.map(d => d.data());
  },

  async listSubmissions(classId, quizId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('submissions').where('quizId', '==', quizId).get();
    return snap.docs.map(d => this.normalizeSubmission(d.data()));
  },

  /* 把伺服器時間戳轉成毫秒。伺服器還沒回填時退回本機時間。 */
  normalizeSubmission(data) {
    const server = data.serverAt && typeof data.serverAt.toMillis === 'function'
      ? data.serverAt.toMillis()
      : null;
    return { ...data, orderAt: server || data.submittedAt || 0 };
  },

  /* ---------- 獎品兌換 ----------
     學生只能建立自己的兌換申請,不能自己扣點數 ——
     扣點與庫存都由老師端執行,學生改前端也動不了分數。 */

  async createPurchase(classId, uid, payload) {
    const ref = await this.db.collection('classes').doc(classId)
      .collection('purchases').add({
        ...payload,
        uid,
        status: 'pending',
        at: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: Date.now()
      });
    return ref.id;
  },

  async updatePurchase(classId, purchaseId, patch) {
    await this.db.collection('classes').doc(classId)
      .collection('purchases').doc(purchaseId).update(patch);
  },

  watchPurchases(classId, cb) {
    return this.db.collection('classes').doc(classId)
      .collection('purchases')
      .onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => console.warn('[Cloud] 兌換監聽中斷:', err.message));
  },

  watchMyPurchases(classId, uid, cb) {
    return this.db.collection('classes').doc(classId)
      .collection('purchases').where('uid', '==', uid)
      .onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, err => console.warn('[Cloud] 兌換監聽中斷:', err.message));
  },

  /* ---------- 領地佔領戰 ----------
     地圖不存在任何地方 —— 它是由 tevents 重播出來的。
     所以這裡只有三種資料:設定、題目、作答事件。

     答案存在 territory/answers,學生讀不到,但安全規則讀得到,
     用來擋掉答錯的事件。 */

  async saveTerritoryConfig(classId, config) {
    await this.db.collection('classes').doc(classId)
      .collection('territory').doc('config').set(config);
  },

  watchTerritoryConfig(classId, cb) {
    return this.db.collection('classes').doc(classId)
      .collection('territory').doc('config')
      .onSnapshot(snap => cb(snap.exists ? snap.data() : null),
        err => console.warn('[領地戰] 設定監聽中斷:', err.message));
  },

  /* 一次寫兩份:給學生看的(不含答案)與給規則核對的(含答案) */
  async publishTerritoryQuestions(classId, questions) {
    const forStudents = questions.map(q => ({
      id: q.id, text: q.text, options: q.options, difficulty: q.difficulty
    }));
    const key = {};
    questions.forEach(q => {
      key[q.id] = { a: q.answer, p: DIFFICULTY[q.difficulty].points };
    });

    const batch = this.db.batch();
    const base = this.db.collection('classes').doc(classId).collection('territory');
    batch.set(base.doc('questions'), { questions: forStudents, updatedAt: Date.now() });
    batch.set(base.doc('answers'), { key, updatedAt: Date.now() });
    await batch.commit();
  },

  watchTerritoryQuestions(classId, cb) {
    return this.db.collection('classes').doc(classId)
      .collection('territory').doc('questions')
      .onSnapshot(snap => cb(snap.exists ? (snap.data().questions || []) : []),
        err => console.warn('[領地戰] 題庫監聽中斷:', err.message));
  },

  /* 送出一次攻擊。答錯的話會被安全規則擋下來,
     丟出 permission-denied,呼叫端據此判定答錯。 */
  /* 文件 id 固定為 {uid}_{題目id}:同一題每個人只能答一次。
     用隨機 id 的話,學生記住答案後可以對同一題重複作答刷分,
     而且規則擋不住(每一次送出看起來都是合法的新事件)。 */
  async sendTerritoryEvent(classId, uid, payload) {
    await this.db.collection('classes').doc(classId)
      .collection('tevents').doc(`${uid}_${payload.questionId}`).set({
        ...payload,
        uid,
        at: firebase.firestore.FieldValue.serverTimestamp()
      });
  },

  /* 依伺服器時間排序 —— 先後由伺服器認定,不受學生裝置時鐘影響 */
  watchTerritoryEvents(classId, cb) {
    return this.db.collection('classes').doc(classId)
      .collection('tevents').orderBy('at')
      .onSnapshot(snap => {
        const list = [];
        snap.docs.forEach(d => {
          const data = d.data();
          // serverTimestamp 尚未回填時先跳過,下一次快照就會有了
          if (!data.at || typeof data.at.toMillis !== 'function') return;
          list.push({ id: d.id, ...data, at: data.at.toMillis() });
        });
        cb(list);
      }, err => console.warn('[領地戰] 事件監聽中斷:', err.message));
  },

  /* 重新開局時清掉上一局的事件 */
  async clearTerritoryEvents(classId) {
    const snap = await this.db.collection('classes').doc(classId)
      .collection('tevents').get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = this.db.batch();
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  },

  /* ---------- 即時監聽 ----------
     回傳 unsubscribe 函式,切換班級或登出時要記得呼叫。 */

  watchClass(classId, cb) {
    return this.db.collection('classes').doc(classId).onSnapshot(snap => {
      if (!snap.exists) return;
      // 自己剛送出、還沒被伺服器確認的寫入不用理會,否則會自己蓋自己
      if (snap.metadata.hasPendingWrites) return;
      cb({ id: snap.id, ...snap.data() });
    }, err => console.warn('[Cloud] 班級監聽中斷:', err.message));
  },

  watchSubmissions(classId, quizId, cb, onError) {
    return this.db.collection('classes').doc(classId)
      .collection('submissions').where('quizId', '==', quizId)
      .onSnapshot(snap => {
        cb(snap.docs.map(d => this.normalizeSubmission(d.data())));
      }, err => {
        console.warn('[Cloud] 作答監聽中斷:', err.message);
        if (onError) onError(err);
      });
  }
};
