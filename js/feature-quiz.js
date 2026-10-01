/* ============================================
   作業測驗 — 老師端
   ────────────────────────────────────────────
   題目與設定存在班級 blob 的 state.quizzes,
   學生的作答存在 Firestore 的 submissions 子集合。

   為什麼要分開存?
   30 位學生同時交卷,如果都寫同一份文件會互相覆蓋。
   讓每位學生只寫自己那一份,寫入永遠不會衝突。
   老師端再把成績「收回來」結算成積分。
============================================ */

const QUESTION_TYPES = {
  choice: '選擇題',
  truefalse: '是非題',
  short: '簡答題'
};

/* 讀取建立表單的設定。手動建立與 Excel 匯入共用同一組設定,
   兩邊才不會有一邊支援結算時間、另一邊沒有的落差。 */
function readQuizForm() {
  const date = document.getElementById('quizSettleDate').value;
  const hh = document.getElementById('quizSettleHour').value || '00';
  const mm = document.getElementById('quizSettleMin').value || '00';
  const time = `${hh}:${mm}`;
  return {
    title: document.getElementById('quizTitle').value.trim(),
    dueDate: document.getElementById('quizDueDate').value || '',
    pointsPerQuestion: parseInt(document.getElementById('quizPoints').value) || 1,
    scoreMode: document.getElementById('quizScoreMode').value,
    topN: parseInt(document.getElementById('quizTopN').value) || 5,
    // 統一結算時間。設了之後,時間到之前一律不批改也不發分,
    // 學生只會看到「已交卷」。時間到、老師一開系統就自動算完。
    // 不帶 Z,所以是以老師電腦的當地時間解讀 —— 填 00:00 就是半夜十二點。
    settleAt: date ? new Date(`${date}T${time}`).getTime() : 0
  };
}

/* 小時與分鐘分開選,24 小時制。
   原本用 datetime-local,但它的上午/下午是瀏覽器介面語系決定的、改不掉,
   「下午 12:00」是中午還是半夜很容易看錯。 */
function fillSettleTimeOptions() {
  const hour = document.getElementById('quizSettleHour');
  const min = document.getElementById('quizSettleMin');
  if (!hour || !min || hour.options.length) return;

  const p = n => String(n).padStart(2, '0');

  let h = '';
  for (let i = 0; i < 24; i++) {
    // 最容易看錯的那兩個直接寫出來
    const note = i === 0 ? ' 半夜' : i === 12 ? ' 中午' : '';
    h += `<option value="${p(i)}">${p(i)}${note}</option>`;
  }
  hour.innerHTML = h;

  let m = '';
  for (let i = 0; i < 60; i++) m += `<option value="${p(i)}">${p(i)}</option>`;
  min.innerHTML = m;
}

function clearQuizForm() {
  document.getElementById('quizTitle').value = '';
  document.getElementById('quizDueDate').value = '';
  document.getElementById('quizSettleDate').value = '';
  document.getElementById('quizSettleHour').value = '00';
  document.getElementById('quizSettleMin').value = '00';
}

function newQuiz(form, questions) {
  return {
    ...form,
    id: 'qz_' + Date.now(),
    questions: questions || [],
    status: 'draft',          // draft(編輯中) / open(開放作答) / closed(已結束)
    createdAt: Date.now()
  };
}

function createQuiz() {
  const form = readQuizForm();
  if (!form.title) {
    toast('請輸入測驗名稱');
    return;
  }

  state.quizzes.unshift(newQuiz(form));
  clearQuizForm();
  save();
  renderQuizList();
  toast('測驗已建立,接著新增題目');
}

/* 一鍵匯入:選一個 Excel,直接建立整份測驗(設定用上方表單的)。
   測驗名稱留空就用檔名 —— 老師常把檔案取名成「國語第三課」,
   那本來就是測驗的名字。 */
function createQuizFromExcel() {
  const form = readQuizForm();

  ExcelImport.pickFile((rows, filename) => {
    const result = QuestionImport.parse(rows);
    if (result.error) { toast(result.error); return; }
    if (result.questions.length === 0) {
      toast('沒有讀到任何有效題目');
      if (result.warnings.length) alert('問題如下:\n\n' + result.warnings.join('\n'));
      return;
    }

    const now = Date.now();
    const questions = result.questions.map((q, i) => ({
      id: 'q_' + now + '_' + i,
      type: q.type,
      text: q.text,
      // 選擇題固定四個欄位,編輯畫面才不會少格
      options: q.type === 'choice'
        ? [q.options[0] || '', q.options[1] || '', q.options[2] || '', q.options[3] || '']
        : ['', '', '', ''],
      answer: q.answer
    }));

    form.title = form.title || filename.replace(/\.[^.]+$/, '');
    state.quizzes.unshift(newQuiz(form, questions));

    clearQuizForm();
    save();
    renderQuizList();
    toast(`✦ 已建立「${form.title}」,共 ${questions.length} 題`);

    if (result.warnings.length) {
      setTimeout(() => alert(`有 ${result.warnings.length} 列被略過:\n\n` +
        result.warnings.slice(0, 20).join('\n')), 800);
    }
  });
}

/* 今晚 12 點 = 明天 00:00(不是今天中午) */
function setSettleTonight() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  document.getElementById('quizSettleDate').value =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  document.getElementById('quizSettleHour').value = '00';
  document.getElementById('quizSettleMin').value = '00';
}

/* 選了「只有前幾名得分」才需要填名額 */
function toggleTopNInput() {
  const mode = document.getElementById('quizScoreMode').value;
  const mode2 = mode === 'topN' || mode === 'perQuestion';
  document.getElementById('quizTopNField').style.display = mode2 ? '' : 'none';
  document.getElementById('quizTopNLabel').textContent =
    mode === 'perQuestion' ? '每題前幾名' : '前幾名';
}

function getQuiz(quizId) {
  return state.quizzes.find(q => q.id === quizId);
}

function addQuestion(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;
  quiz.questions.push({
    id: 'q_' + Date.now(),
    type: 'choice',
    text: '',
    options: ['', '', '', ''],
    answer: 0            // 選擇題:選項索引 / 是非題:true|false / 簡答題:文字
  });
  save();
  renderQuizList();
}

function updateQuestion(quizId, qId, field, value) {
  const quiz = getQuiz(quizId);
  const q = quiz && quiz.questions.find(x => x.id === qId);
  if (!q) return;

  if (field === 'type') {
    q.type = value;
    // 換題型時把答案重設成該題型的合理預設,避免留下上一種題型的殘值
    if (value === 'choice')      { q.options = q.options && q.options.length ? q.options : ['', '', '', '']; q.answer = 0; }
    else if (value === 'truefalse') { q.answer = true; }
    else                          { q.answer = ''; }
  } else if (field.startsWith('option')) {
    const idx = parseInt(field.replace('option', ''));
    q.options[idx] = value;
  } else if (field === 'answer') {
    q.answer = q.type === 'choice' ? parseInt(value)
             : q.type === 'truefalse' ? (value === 'true')
             : value;
  } else {
    q[field] = value;
  }
  save();
}

function deleteQuestion(quizId, qId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;
  quiz.questions = quiz.questions.filter(x => x.id !== qId);
  save();
  renderQuizList();
}

function deleteQuiz(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;
  if (!confirm(`確定刪除「${quiz.title}」?學生已交的作答也會一併看不到。`)) return;
  state.quizzes = state.quizzes.filter(q => q.id !== quizId);
  save();
  renderQuizList();
  toast('已刪除');
}

/* 開放作答:題目寫進 Firestore,學生端才讀得到 */
async function publishQuiz(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;

  if (quiz.questions.length === 0) {
    toast('至少要有一題才能開放作答');
    return;
  }
  const incomplete = quiz.questions.filter(q => !q.text.trim());
  if (incomplete.length > 0) {
    toast(`有 ${incomplete.length} 題還沒填題目內容`);
    return;
  }

  quiz.status = 'open';
  save();

  if (isCloudMode()) {
    try {
      await Cloud.publishQuiz(state.classId, quiz);
      toast('✦ 已開放作答,學生登入後就會看到');
    } catch (e) {
      console.error(e);
      quiz.status = 'draft';
      save();
      toast('開放失敗:' + e.message);
    }
  } else {
    toast('單機模式下學生無法作答,請先登入雲端');
  }
  renderQuizList();
}

async function closeQuiz(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;
  quiz.status = 'closed';
  save();
  if (isCloudMode()) {
    try {
      await Cloud.setQuizStatus(state.classId, quizId, 'closed');
    } catch (e) {
      console.error(e);
    }
  }
  renderQuizList();
  toast('已結束作答');
}

/* ============================================
   收回成績並結算積分
   ────────────────────────────────────────────
   每位學生每份測驗只會加分一次(以 quizResults 為準),
   老師重複按「收回成績」不會重複加分。
============================================ */

/* 同一份測驗同時只能有一個結算在跑。
   即時計分下交卷會連續觸發,沒有這道鎖的話兩次結算會讀到同一份
   還沒寫回的 state,同一位學生被加兩次分。 */
const _settling = new Set();

async function collectQuizResults(quizId, opts) {
  const silent = opts && opts.silent;

  if (!isCloudMode()) {
    if (!silent) toast('需要登入雲端才能收回學生作答');
    return;
  }
  const quiz = getQuiz(quizId);
  if (!quiz) return;

  // 設了統一結算時間就等時間到。這樣搶答不必邊收邊算,
  // 所有人的名次一次算完,先後仍然以伺服器記下的交卷時間為準。
  const force = opts && opts.force;
  if (quiz.settleAt && Date.now() < quiz.settleAt && !force) {
    if (!silent) toast('還沒到結算時間:' + formatSettleAt(quiz.settleAt));
    return;
  }

  if (_settling.has(quizId)) return;
  _settling.add(quizId);
  try {
    await runCollect(quiz, quizId, silent);
  } finally {
    _settling.delete(quizId);
  }
}

async function runCollect(quiz, quizId, silent) {
  if (quiz.scoreMode === 'perQuestion') return runCollectPerQuestion(quiz, quizId, silent);

  if (!silent) toast('讀取中…');
  let submissions;
  try {
    submissions = await Cloud.listSubmissions(state.classId, quizId);
  } catch (e) {
    console.error(e);
    if (!silent) toast('讀取失敗:' + e.message);
    return;
  }

  // 先全部批改,才能排名次
  const graded = submissions.map(sub => ({
    sub,
    student: state.students.find(s => s.id === sub.studentId),
    score: gradeSubmission(quiz, sub.answers || {}),
    marks: markSubmission(quiz, sub.answers || {})
  })).filter(g => g.student);

  // 名次:答對多的在前,同分則先交卷的在前。
  // orderAt 用伺服器時間,不受學生裝置時鐘影響。
  graded.sort((a, b) => b.score - a.score || a.sub.orderAt - b.sub.orderAt);
  graded.forEach((g, i) => { g.rank = i + 1; });

  const isTopN = quiz.scoreMode === 'topN';

  // 前 N 名模式若開了即時計分,會分好幾次結算。名次每次都是就目前所有作答重算,
  // 但已經發出去的分數收不回來 —— 沒有這個名額上限的話,後來衝上前面的學生
  // 會再佔一個名額,最後得分人數超過 N 位。
  const alreadyAwarded = isTopN
    ? state.students.filter(s => (s.quizResults?.[quizId]?.awarded || 0) > 0).length
    : 0;
  let slots = (quiz.topN || 0) - alreadyAwarded;

  let newlyAwarded = 0;
  let totalPoints = 0;
  let missedCutoff = 0;

  graded.forEach(g => {
    const { student, score, sub, rank, marks } = g;

    if (!student.quizResults) student.quizResults = {};
    if (student.quizResults[quizId]) return;   // 已結算過,跳過

    // 前 N 名模式:沒答對任何一題就不算進名次,免得零分也佔名額
    const inTopN = rank <= (quiz.topN || 0) && score > 0 && slots > 0;
    const earns = isTopN ? inTopN : true;
    const points = earns ? score * quiz.pointsPerQuestion : 0;
    if (isTopN && points > 0) slots--;

    student.quizResults[quizId] = {
      score,
      total: quiz.questions.length,
      awarded: points,
      rank,
      marks,                  // 逐題對錯,學生端用來顯示自己的答題結果
      at: sub.orderAt
    };

    if (points > 0) {
      const reason = isTopN
        ? `測驗「${quiz.title}」第 ${rank} 名,答對 ${score}/${quiz.questions.length} 題`
        : `測驗「${quiz.title}」答對 ${score}/${quiz.questions.length} 題`;
      applyPointsToStudent(student.id, points, reason);
      totalPoints += points;
    } else if (isTopN && score > 0) {
      missedCutoff++;
    }
    newlyAwarded++;
  });

  save();
  renderAll();

  if (newlyAwarded === 0) {
    if (!silent) toast(`目前 ${submissions.length} 份作答都已結算過`);
  } else {
    toast(`✦ 結算 ${newlyAwarded} 位學生,共發出 ${totalPoints} 分` +
          (missedCutoff > 0 ? `(${missedCutoff} 位答對但未進前 ${quiz.topN} 名)` : ''));
  }
}

/* 逐題搶答的結算。
   和整份測驗排名的差別:名次是「每一題各自」算的 ——
   第 1 題最快答對的前 N 位得分,第 2 題重新比一次。
   每題各自有伺服器蓋的時間戳,所以先後不受學生裝置時鐘影響。 */
async function runCollectPerQuestion(quiz, quizId, silent) {
  if (!silent) toast('讀取中…');
  let answers;
  try {
    answers = await Cloud.listQuizAnswers(state.classId, quizId);   // 已依時間排序
  } catch (e) {
    console.error(e);
    if (!silent) toast('讀取失敗:' + e.message);
    return;
  }

  const topN = quiz.topN || 1;
  const per = {};      // { studentId: { score, marks[], ranks[], points } }
  const touch = id => (per[id] = per[id] || { score: 0, marks: [], ranks: [], points: 0 });
  state.students.forEach(s => {
    const p = touch(s.id);
    p.marks = quiz.questions.map(() => '-');
    p.ranks = quiz.questions.map(() => 0);
  });

  quiz.questions.forEach((q, qi) => {
    let winners = 0;
    answers.filter(a => a.questionId === q.id).forEach(a => {
      const p = per[a.studentId];
      if (!p) return;                                  // 已被刪除的學生
      const correct = isAnswerCorrect(q, a.answer);
      p.marks[qi] = correct ? '1' : '0';
      if (!correct) return;
      p.score++;
      winners++;
      if (winners <= topN) {                           // 這一題的前 N 名
        p.ranks[qi] = winners;
        p.points += quiz.pointsPerQuestion;
      }
    });
  });

  let newlyAwarded = 0;
  let totalPoints = 0;

  state.students.forEach(student => {
    const p = per[student.id];
    if (!p || p.marks.every(m => m === '-')) return;    // 完全沒作答
    if (!student.quizResults) student.quizResults = {};
    if (student.quizResults[quizId]) return;            // 已結算過

    student.quizResults[quizId] = {
      score: p.score,
      total: quiz.questions.length,
      awarded: p.points,
      marks: p.marks.join(''),
      qRanks: p.ranks.join(','),      // 每題各自的名次,0 = 沒進得分名額
      at: Date.now()
    };

    if (p.points > 0) {
      const fast = p.ranks.filter(r => r > 0).length;
      applyPointsToStudent(student.id, p.points,
        `測驗「${quiz.title}」有 ${fast} 題搶到前 ${topN} 名`);
      totalPoints += p.points;
    }
    newlyAwarded++;
  });

  save();
  renderAll();

  if (newlyAwarded === 0) {
    if (!silent) toast('目前的作答都已結算過');
  } else {
    toast(`✦ 逐題結算 ${newlyAwarded} 位學生,共發出 ${totalPoints} 分`);
  }
}

/* ============================================
   即時監聽開放中的測驗
   ────────────────────────────────────────────
   老師開著測驗頁時,學生一交卷畫面就更新。
   打開「即時計分」的話還會自動結算,搶答課堂上不用一直按按鈕。
============================================ */

/* 老師不想等到結算時間 */
async function settleNow(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;
  if (!confirm(`不等 ${formatSettleAt(quiz.settleAt)},現在就批改並發分?\n\n` +
               `之後補交的學生要再按一次「收回成績」才會計分。`)) return;
  quiz.settledDone = true;
  save();
  await collectQuizResults(quizId, { force: true });
  renderQuizList();
}

function scoreModeLabel(quiz) {
  if (quiz.scoreMode === 'perQuestion') {
    return `<strong>逐題搶答 · 每題前 ${quiz.topN} 名</strong>`;
  }
  if (quiz.scoreMode === 'topN') return `<strong>整份前 ${quiz.topN} 名得分</strong>`;
  return '答對就得分';
}

/* 結算時間顯示成「8/21 00:00」 */
function formatSettleAt(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const QuizWatch = {
  unsubs: {},          // { quizId: unsubscribe }
  live: {},            // { quizId: [submissions] }
  autoSettle: {},      // { quizId: true } 使用者開啟的即時計分
  dueTimer: null,

  /* 到了結算時間就自動算完。
     這是在老師的瀏覽器裡跑的 —— 純前端沒有伺服器可以半夜自己醒來,
     所以真正的動作發生在「時間已過,而且老師打開了系統」的那一刻。
     學生在那之前只會看到已交卷,名次與分數都還沒產生。 */
  checkDue() {
    if (!isCloudMode()) return;
    const now = Date.now();
    (state.quizzes || []).forEach(quiz => {
      if (!quiz.settleAt || now < quiz.settleAt) return;
      // 只自動跑一次。之後若有補交,老師按「收回成績」即可 ——
      // 不留這個記號的話,每分鐘都會再讀一次全班作答,白花額度。
      if (quiz.settledDone) return;
      quiz.settledDone = true;
      collectQuizResults(quiz.id, { silent: true }).then(() => {
        save();
        renderQuizList();
        toast(`✦ 測驗「${quiz.title}」已到結算時間,成績已公布`);
      });
    });
  },

  startDueTimer() {
    if (this.dueTimer) return;
    this.checkDue();
    this.dueTimer = setInterval(() => this.checkDue(), 60 * 1000);
  },

  /* 依目前的測驗狀態,同步該訂閱誰、該退訂誰 */
  sync() {
    if (!isCloudMode()) return;
    this.startDueTimer();

    const open = state.quizzes.filter(q => q.status === 'open').map(q => q.id);

    Object.keys(this.unsubs).forEach(id => {
      if (!open.includes(id)) this.stop(id);
    });

    open.forEach(id => {
      if (this.unsubs[id]) return;
      // 逐題搶答沒有「交卷」這個動作,進度看的是逐題作答的文件
      const quiz = getQuiz(id);
      const watch = quiz && quiz.scoreMode === 'perQuestion'
        ? Cloud.watchQuizAnswers : Cloud.watchSubmissions;

      this.unsubs[id] = watch.call(Cloud, state.classId, id, rows => {
        this.live[id] = rows;
        this.renderCount(id);
        if (this.autoSettle[id]) {
          collectQuizResults(id, { silent: true }).then(() => renderQuizList());
        }
      });
    });
  },

  stop(quizId) {
    if (this.unsubs[quizId]) {
      this.unsubs[quizId]();
      delete this.unsubs[quizId];
    }
    delete this.live[quizId];
  },

  stopAll() {
    Object.keys(this.unsubs).forEach(id => this.stop(id));
    this.autoSettle = {};
    if (this.dueTimer) { clearInterval(this.dueTimer); this.dueTimer = null; }
  },

  /* 只更新那一行數字,不重繪整個列表 —— 老師正在打字時不會被打斷 */
  renderCount(quizId) {
    const el = document.getElementById('liveCount_' + quizId);
    if (!el) return;
    const rows = this.live[quizId] || [];
    const quiz = getQuiz(quizId);
    let n, label;
    if (quiz && quiz.scoreMode === 'perQuestion') {
      n = new Set(rows.map(r => r.studentId)).size;
      label = n > 0 ? `${n} 人作答中 · 共 ${rows.length} 題次` : '尚無人作答';
    } else {
      n = rows.length;
      label = n > 0 ? `${n} 人已交卷` : '尚無人交卷';
    }
    el.textContent = label;
    el.classList.toggle('has-submissions', n > 0);
  },

  toggleAuto(quizId) {
    this.autoSettle[quizId] = !this.autoSettle[quizId];
    if (this.autoSettle[quizId]) {
      toast('即時計分已開啟,學生交卷後自動結算');
      collectQuizResults(quizId, { silent: true }).then(() => renderQuizList());
    } else {
      toast('即時計分已關閉');
      renderQuizList();
    }
  }
};

/* 逐題批改,回傳一串 '1'(對) / '0'(錯) / '-'(沒作答)。
   存進學生的成績紀錄後,學生自己看得到每一題的對錯,
   但正確答案不會出現在裡面。 */
function markSubmission(quiz, answers) {
  return quiz.questions.map(q => {
    const given = answers[q.id];
    if (given === undefined || given === null || given === '') return '-';
    return isAnswerCorrect(q, given) ? '1' : '0';
  }).join('');
}

/* 一題答得對不對。簡答題忽略大小寫、前後空白與全形空白。 */
function isAnswerCorrect(q, given) {
  if (given === undefined || given === null || given === '') return false;
  if (q.type === 'choice') return Number(given) === Number(q.answer);
  if (q.type === 'truefalse') return Boolean(given) === Boolean(q.answer);
  const norm = v => String(v).trim().replace(/\s+/g, '').toLowerCase();
  return norm(given) === norm(q.answer);
}

/* 批改一份作答,回傳答對題數 */
function gradeSubmission(quiz, answers) {
  let score = 0;
  quiz.questions.forEach(q => {
    const given = answers[q.id];
    if (given === undefined || given === null) return;

    if (q.type === 'choice') {
      if (Number(given) === Number(q.answer)) score++;
    } else if (q.type === 'truefalse') {
      if (Boolean(given) === Boolean(q.answer)) score++;
    } else {
      // 簡答題:忽略大小寫、前後空白與全形空白
      const norm = v => String(v).trim().replace(/\s+/g, '').toLowerCase();
      if (norm(given) === norm(q.answer)) score++;
    }
  });
  return score;
}

/* ============================================
   渲染
============================================ */

function renderQuizList() {
  fillSettleTimeOptions();        // 第一次進來才會真的填,之後是空操作
  const el = document.getElementById('quizList');
  if (!el) return;

  if (state.quizzes.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">✎</div>
      <div>還沒有測驗,用上方表單建立第一份</div>
    </div>`;
    return;
  }

  el.innerHTML = state.quizzes.map(quiz => {
    const submitted = state.students.filter(s => s.quizResults && s.quizResults[quiz.id]).length;
    const statusLabel = { draft: '編輯中', open: '開放作答', closed: '已結束' }[quiz.status];
    const waiting = !!quiz.settleAt && Date.now() < quiz.settleAt;   // 等統一結算中

    return `
    <div class="quiz-card quiz-${quiz.status}">
      <div class="quiz-card-head">
        <div>
          <div class="quiz-card-title">${escapeHtml(quiz.title)}</div>
          <div class="quiz-card-meta">
            ${quiz.questions.length} 題 · 每題 ${quiz.pointsPerQuestion} 分
            · ${scoreModeLabel(quiz)}
            ${quiz.dueDate ? ' · 截止 ' + quiz.dueDate : ''}
            ${quiz.settleAt
              ? ` · <strong class="quiz-settle-at">${Date.now() < quiz.settleAt
                    ? '⏳ ' + formatSettleAt(quiz.settleAt) + ' 統一結算'
                    : '已於 ' + formatSettleAt(quiz.settleAt) + ' 結算'}</strong>`
              : ''}
            · 已結算 ${submitted}/${state.students.length} 人
          </div>
        </div>
        <div class="quiz-card-actions">
          <span class="quiz-status quiz-status-${quiz.status}">${statusLabel}</span>
          ${quiz.status === 'draft'
            ? `<button class="btn btn-accent btn-small" onclick="publishQuiz('${quiz.id}')">開放作答</button>`
            : ''}
          ${quiz.status === 'open'
            ? `<span id="liveCount_${quiz.id}" class="quiz-live-count">連線中…</span>
               ${waiting
                 ? `<button class="btn btn-ghost btn-small"
                      onclick="settleNow('${quiz.id}')"
                      title="不等結算時間,現在就批改發分">提前結算</button>`
                 : `<label class="quiz-auto-toggle" title="學生交卷後自動結算,不用一直按收回成績">
                      <input type="checkbox" ${QuizWatch.autoSettle[quiz.id] ? 'checked' : ''}
                             onchange="QuizWatch.toggleAuto('${quiz.id}')" />
                      即時計分
                    </label>
                    <button class="btn btn-primary btn-small" onclick="collectQuizResults('${quiz.id}')">收回成績</button>`}
               <button class="btn btn-ghost btn-small" onclick="closeQuiz('${quiz.id}')">結束</button>`
            : ''}
          ${quiz.status === 'closed'
            ? `<button class="btn btn-primary btn-small" onclick="collectQuizResults('${quiz.id}')">收回成績</button>`
            : ''}
          <button class="btn btn-ghost btn-small" onclick="deleteQuiz('${quiz.id}')">刪除</button>
        </div>
      </div>

      ${quiz.status === 'draft' ? renderQuizEditor(quiz) : renderQuizResults(quiz)}
    </div>`;
  }).join('');

  // 列表重繪後,訂閱狀態與畫面上的即時人數要跟著對齊
  QuizWatch.sync();
  Object.keys(QuizWatch.live).forEach(id => QuizWatch.renderCount(id));
}

function renderQuizEditor(quiz) {
  const questions = quiz.questions.map((q, i) => `
    <div class="question-editor">
      <div class="question-editor-head">
        <span class="question-num">第 ${i + 1} 題</span>
        <select class="rule-editor-input" style="max-width:120px;"
                onchange="updateQuestion('${quiz.id}','${q.id}','type',this.value); renderQuizList()">
          ${Object.entries(QUESTION_TYPES).map(([k, v]) =>
            `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-small" onclick="deleteQuestion('${quiz.id}','${q.id}')">✕</button>
      </div>

      <input type="text" class="rule-editor-input" placeholder="題目內容"
             value="${escapeHtml(q.text)}"
             onchange="updateQuestion('${quiz.id}','${q.id}','text',this.value)" />

      ${q.type === 'choice' ? `
        <div class="option-list">
          ${q.options.map((opt, oi) => `
            <label class="option-row">
              <input type="radio" name="ans_${q.id}" ${q.answer === oi ? 'checked' : ''}
                     onchange="updateQuestion('${quiz.id}','${q.id}','answer','${oi}')" />
              <span class="option-letter">${'ABCD'[oi]}</span>
              <input type="text" class="rule-editor-input" placeholder="選項 ${'ABCD'[oi]}"
                     value="${escapeHtml(opt)}"
                     onchange="updateQuestion('${quiz.id}','${q.id}','option${oi}',this.value)" />
            </label>`).join('')}
        </div>
        <div class="question-hint">✦ 點左側圓圈標記正確答案</div>
      ` : ''}

      ${q.type === 'truefalse' ? `
        <div class="option-list">
          <label class="option-row">
            <input type="radio" name="ans_${q.id}" ${q.answer === true ? 'checked' : ''}
                   onchange="updateQuestion('${quiz.id}','${q.id}','answer','true')" /> 正確 ○
          </label>
          <label class="option-row">
            <input type="radio" name="ans_${q.id}" ${q.answer === false ? 'checked' : ''}
                   onchange="updateQuestion('${quiz.id}','${q.id}','answer','false')" /> 錯誤 ✕
          </label>
        </div>
      ` : ''}

      ${q.type === 'short' ? `
        <input type="text" class="rule-editor-input" placeholder="正確答案(比對時會忽略大小寫與前後空白)"
               value="${escapeHtml(q.answer || '')}"
               onchange="updateQuestion('${quiz.id}','${q.id}','answer',this.value)" />
      ` : ''}
    </div>
  `).join('');

  return `<div class="quiz-editor">
    ${questions}
    <div class="quiz-editor-actions">
      <button class="btn btn-ghost btn-small" onclick="addQuestion('${quiz.id}')">＋ 新增題目</button>
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-small"
              onclick="QuestionImport.downloadTemplate('quiz')">⤓ 下載 Excel 範本</button>
      <button class="btn btn-ghost btn-small"
              onclick="importQuizQuestionsFromExcel('${quiz.id}')">📊 從 Excel 匯入題目</button>
    </div>
  </div>`;
}

function renderQuizResults(quiz) {
  const race = quiz.scoreMode === 'perQuestion';

  const rows = state.students
    .filter(s => s.quizResults && s.quizResults[quiz.id])
    .map(s => ({ s, r: s.quizResults[quiz.id] }))
    // 逐題搶答沒有整份的名次,改用得分高低排
    .sort((a, b) => race
      ? (b.r.awarded - a.r.awarded || b.r.score - a.r.score)
      : (a.r.rank || 999) - (b.r.rank || 999))
    .map(({ s, r }) => {
      const pct = r.total > 0 ? Math.round(r.score / r.total * 100) : 0;
      const fast = (r.qRanks || '').split(',').filter(x => Number(x) > 0).length;
      return `<tr class="${r.awarded > 0 ? '' : 'no-award'}">
        <td>${race ? (fast > 0 ? fast + ' 題' : '—') : (r.rank || '—')}</td>
        <td>${escapeHtml(s.seatNumber || '')}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${r.score}/${r.total}</td>
        <td>${pct}%</td>
        <td>${r.awarded > 0 ? '+' + r.awarded + ' 分' : '—'}</td>
      </tr>`;
    }).join('');

  if (!rows) {
    return `<div class="quiz-results-empty">尚未收回任何成績。學生交卷後,按上方「收回成績」結算。</div>`;
  }

  return `<div class="quiz-results">
    <table class="quiz-results-table">
      <thead><tr><th>${race ? '搶到' : '名次'}</th><th>座號</th><th>姓名</th>
        <th>答對</th><th>正確率</th><th>獲得</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${race
      ? `<div class="quiz-results-note">「搶到」= 有幾題擠進該題的前 ${quiz.topN} 名答對者。
           每題各自比快,時間以伺服器記錄的作答時間為準。</div>`
      : ''}
    ${quiz.scoreMode === 'topN'
      ? `<div class="quiz-results-note">名次以答對題數排序,同分者先交卷的在前。只有前 ${quiz.topN} 名且有答對的學生得分。</div>`
      : ''}
  </div>`;
}
