/* ============================================
   學生端
   ────────────────────────────────────────────
   學生看得到:自己的守護獸、自己的積分、待作答的測驗。
   學生只能寫入自己的那份 submission,不能改班級資料,
   所以 30 個人同時操作也不會互相影響。
============================================ */

const StudentApp = {
  classInfo: null,      // { classId, className, studentId, name, seatNumber }
  student: null,        // 從班級 blob 取出的自己那筆資料(唯讀)
  quizzes: [],
  submissions: {},      // { quizId: submissionDoc }
  activeQuiz: null,
  draftAnswers: {},
  petChoice: null,        // 已送出但老師還沒收進班級資料的選擇
  pickedPet: null,        // 挑選畫面上目前點選的物種
  draftNickname: '',
  tab: 'pet',             // pet | rank | quiz
  rankTab: 'individual',  // individual | group
  allStudents: [],        // 全班資料,排行榜用
  groups: [],             // 目前使用的分組(id 陣列的陣列)
  groupsName: null,       // 分組名稱,老師存過才有
  shopItems: [],          // 老師上架的獎品
  myPurchases: [],        // 自己的兌換申請
  unsub: null,            // 班級即時監聽
  unsubPurchases: null,
  lastScore: undefined,   // 用來偵測加分,跳出提示

  async enter(classInfo) {
    // 跨班切換時要把上一班的殘留狀態清掉,否則會看到別班的作答畫面
    this.activeQuiz = null;
    this.myPurchases = [];
    this.lastScore = undefined;
    this._warTabShown = false;
    this._warSig = null;
    this.tTried = new Set();
    this.classInfo = classInfo;
    hideAllTopViews();
    document.getElementById('studentView').classList.remove('hidden');
    document.getElementById('studentView').innerHTML =
      '<div class="student-loading">載入中…</div>';

    await this.refresh();
    this.watch();
    this.watchPurchases();
    this.watchTerritory();
  },

  /* 老師結算兌換後,狀態會即時反映在學生畫面上 */
  watchPurchases() {
    if (this.unsubPurchases) this.unsubPurchases();
    this.unsubPurchases = Cloud.watchMyPurchases(
      this.classInfo.classId, Cloud.uid, list => {
        this.myPurchases = list;
        if (!this.activeQuiz && this.tab === 'shop') this.render();
      });
  },

  /* 找出「我」是名單上的哪一位。
     老師重新整理名單時學生的 id 會換掉,登入索引卻還指著舊的 id ——
     那時只用 id 找會找不到人,畫面一片空白。改成找不到就用信箱再找一次,
     找到了就把 classInfo 的 id 補正,後續的作答、兌換才會寫到對的人身上。 */
  findMe(list) {
    const byId = list.find(s => s.id === this.classInfo.studentId);
    if (byId) return byId;

    const mail = (state.user && state.user.email || '').trim().toLowerCase();
    const byMail = mail && list.find(s => (s.email || '').trim().toLowerCase() === mail);
    if (byMail) {
      console.warn('[學生端] 名冊索引的 studentId 已失效,改用信箱比對');
      this.classInfo.studentId = byMail.id;
      return byMail;
    }
    return null;
  },

  /* 老師一發分、一結算成績,學生畫面就跟著動。
     排行榜是即時的,搶答結果馬上看得到名次變化。 */
  watch() {
    if (this.unsub) this.unsub();
    this.unsub = Cloud.watchClass(this.classInfo.classId, doc => {
      const blob = doc.blob || {};
      this.allStudents = blob.students || [];
      this.student = this.findMe(this.allStudents);

      this.shopItems = blob.shopItems || [];
      this.readGroups(blob);

      // 正在作答時不要重繪,會把已經選好的答案清掉
      if (this.activeQuiz) return;

      const before = this.lastScore;
      const now = this.student ? this.student.totalPoints : 0;
      this.lastScore = now;

      this.render();
      if (before !== undefined && now > before) {
        toast(`✦ 獲得 ${now - before} 分!`);
      }
    });
  },

  async refresh() {
    const { classId } = this.classInfo;   // studentId 由 findMe() 決定(可能需要用信箱補正)

    const doc = await Cloud.loadClass(classId);
    if (!doc) {
      toast('找不到班級資料');
      return;
    }
    const blob = doc.blob || {};
    this.allStudents = blob.students || [];
    this.student = this.findMe(this.allStudents);
    this.classRules = blob.rules || [];
    this.shopItems = blob.shopItems || [];

    this.readGroups(blob);

    // 老師還沒把選擇收進班級資料前,先用學生自己的選擇單顯示
    this.petChoice = this.student && this.student.pet
      ? null
      : await Cloud.getMyPetChoice(classId, Cloud.uid);

    this.quizzes = await Cloud.listQuizzesForStudent(classId);

    // 逐份查自己交過沒 — 開放中的測驗通常不多,這裡的查詢量很小
    this.submissions = {};
    this.qProgress = {};
    for (const q of this.quizzes) {
      if (q.scoreMode === 'perQuestion') {
        // 逐題搶答沒有交卷動作,進度看的是自己答過幾題
        const mine = await Cloud.listMyQuizAnswers(classId, q.id, Cloud.uid);
        this.qProgress[q.id] = Object.keys(mine).length;
      } else {
        const sub = await Cloud.getMySubmission(classId, q.id, Cloud.uid);
        if (sub) this.submissions[q.id] = sub;
      }
    }

    this.render();
  },

  /* ---------- 主畫面 ---------- */

  render() {
    if (this.activeQuiz) {
      this.renderQuizPage();
      return;
    }

    const pending = this.quizzes.filter(q => !this.submissions[q.id]).length;

    document.getElementById('studentView').innerHTML = `
      <header class="student-header">
        <div>
          <div class="student-class">${
            (state.myClasses || []).length > 1
              ? `<select class="student-class-switch" onchange="switchStudentClass(this.value)">${
                  state.myClasses.map(c =>
                    `<option value="${c.classId}" ${c.classId === this.classInfo.classId ? 'selected' : ''}>${escapeHtml(c.className)}</option>`
                  ).join('')
                }</select>`
              : escapeHtml(this.classInfo.className)
          }</div>
          <div class="student-name">${escapeHtml(this.classInfo.name)}
            ${this.classInfo.seatNumber ? ' · ' + escapeHtml(this.classInfo.seatNumber) + ' 號' : ''}</div>
        </div>
        <div class="student-header-actions">
          <button class="btn btn-ghost btn-small" onclick="StudentApp.refresh()">重新整理</button>
          <button class="btn btn-ghost btn-small" onclick="Session.signOut()">登出</button>
        </div>
      </header>

      <nav class="student-tabs">
        <button class="student-tab ${this.tab === 'pet' ? 'active' : ''}"
                onclick="StudentApp.setTab('pet')">我的守護獸</button>
        <button class="student-tab ${this.tab === 'rank' ? 'active' : ''}"
                onclick="StudentApp.setTab('rank')">排行榜</button>
        <button class="student-tab ${this.tab === 'quiz' ? 'active' : ''}"
                onclick="StudentApp.setTab('quiz')">
          測驗${pending > 0 ? `<span class="student-tab-badge">${pending}</span>` : ''}
        </button>
        <button class="student-tab ${this.tab === 'shop' ? 'active' : ''}"
                onclick="StudentApp.setTab('shop')">兌換</button>
        ${TerritoryGame.config && TerritoryGame.config.status === 'running' ? `
        <button class="student-tab war ${this.tab === 'war' ? 'active' : ''}"
                onclick="StudentApp.setTab('war')">領地戰</button>` : ''}
      </nav>

      <main class="student-main">
        ${this.tab === 'pet'  ? this.renderPetTab()  : ''}
        ${this.tab === 'rank' ? this.renderRankTab() : ''}
        ${this.tab === 'quiz' ? this.renderQuizTab() : ''}
        ${this.tab === 'shop' ? this.renderShopTab() : ''}
        ${this.tab === 'war'  ? this.renderWarTab()  : ''}
      </main>
    `;
  },

  setTab(tab) {
    this.tab = tab;
    this.render();
  },

  /* ---------- 分頁:我的守護獸 ---------- */

  renderPetTab() {
    const s = this.student;
    const petHtml = s && s.pet
      ? this.renderPet(s)
      : this.petChoice
        ? this.renderPendingPet()
        : this.renderPetPicker();

    return `
      <section class="student-pet-section">${petHtml}</section>
      <section class="student-section">
        <div class="student-section-title">最近的積分紀錄</div>
        ${this.renderHistory()}
      </section>`;
  },

  /* ---------- 分頁:測驗 ---------- */

  renderQuizTab() {
    if (this.quizzes.length === 0) {
      return '<div class="student-empty">目前沒有待作答的測驗</div>';
    }
    const results = (this.student && this.student.quizResults) || {};

    return this.quizzes.map(q => {
      const race = q.scoreMode === 'perQuestion';
      const answered = race ? (this.qProgress[q.id] || 0) : 0;
      const done = race ? answered >= q.questions.length : !!this.submissions[q.id];
      const r = results[q.id];
      const waiting = !!q.settleAt && Date.now() < q.settleAt;

      let action;
      if (r) {
        action = `<span class="student-quiz-score">+${r.awarded} 分</span>`;
      } else if (race && !done && q.status === 'open') {
        action = `<button class="btn btn-accent btn-small"
                    onclick="StudentApp.openQuiz('${q.id}')">${
                      answered > 0 ? `繼續作答 (${answered}/${q.questions.length})` : '開始作答'
                    }</button>`;
      } else if (done) {
        action = `<span class="student-quiz-done">✓ ${race ? '已答完' : '已交卷'}${
          waiting ? '<br><small>' + formatSettleAt(q.settleAt) + ' 公布</small>' : ''}</span>`;
      } else if (q.status !== 'open') {
        action = '<span class="student-quiz-done">已結束</span>';
      } else {
        action = `<button class="btn btn-accent btn-small"
                    onclick="StudentApp.openQuiz('${q.id}')">開始作答</button>`;
      }

      return `
      <div class="student-quiz-card ${done ? 'done' : ''}">
        <div class="student-quiz-main">
          <div class="student-quiz-title">${escapeHtml(q.title)}</div>
          <div class="student-quiz-meta">
            ${q.questions.length} 題${q.dueDate ? ' · 截止 ' + q.dueDate : ''}
            ${q.scoreMode === 'topN' ? ` · 前 ${q.topN} 名得分` : ''}
          </div>
          ${r ? this.renderMyQuizResult(q, r) : ''}
        </div>
        ${action}
      </div>`;
    }).join('');
  },

  /* 成績公布後,學生看得到自己每一題的對錯。
     marks 是老師端批改時存下來的 '1/0/-' 字串,裡面沒有正確答案。 */
  renderMyQuizResult(quiz, r) {
    const marks = r.marks || '';
    const ranks = (r.qRanks || '').split(',');     // 逐題搶答才有

    const dots = quiz.questions.map((q, i) => {
      const m = marks[i] || '-';
      const rank = Number(ranks[i] || 0);
      const label = m === '1' ? '✓' : m === '0' ? '✗' : '—';
      const cls = m === '1' ? 'ok' : m === '0' ? 'no' : 'skip';
      // 這一題搶到名次的話,把名次標在格子上
      return `<span class="qmark ${cls} ${rank ? 'won' : ''}"
                title="第 ${i + 1} 題${rank ? ':第 ' + rank + ' 個答對' : ''}"
              >${rank ? rank : label}</span>`;
    }).join('');

    const fast = ranks.filter(x => Number(x) > 0).length;

    return `
      <div class="student-quiz-result">
        <div class="sqr-line">
          答對 <strong>${r.score}/${r.total}</strong> 題
          ${quiz.scoreMode === 'perQuestion'
            ? ` · 搶到 <strong>${fast}</strong> 題的前 ${quiz.topN} 名`
            : ''}
          ${quiz.scoreMode === 'topN' && r.rank ? ` · 第 <strong>${r.rank}</strong> 名` : ''}
          ${r.awarded === 0 && quiz.scoreMode === 'topN'
            ? ' <span class="sqr-miss">(未進得分名額)</span>' : ''}
        </div>
        <div class="sqr-marks">${dots}</div>
        ${quiz.scoreMode === 'perQuestion'
          ? '<div class="sqr-legend">格子裡的數字 = 那一題你是第幾個答對的</div>' : ''}
      </div>`;
  },

  /* ---------- 分頁:兌換商店 ----------
     學生按下兌換只是送出一張申請單,實際扣點在老師端執行。
     所以這裡顯示的餘額純粹是給孩子參考,不是判斷的依據。 */

  renderShopTab() {
    const items = (this.shopItems || []).filter(i => i.active);
    const points = this.student ? this.student.currentPoints : 0;

    const pendingIds = (this.myPurchases || [])
      .filter(p => p.status === 'pending')
      .map(p => p.itemId);

    const cards = items.length === 0
      ? '<div class="student-empty">老師還沒上架任何獎品</div>'
      : items.map(item => {
          const soldOut  = item.stock !== null && item.stock <= 0;
          const tooPoor  = points < item.price;
          const waiting  = pendingIds.includes(item.id);
          const disabled = soldOut || tooPoor || waiting;

          return `
          <div class="prize-card ${disabled ? 'disabled' : ''}">
            <div class="prize-icon">${escapeHtml(item.icon || '🎁')}</div>
            <div class="prize-body">
              <div class="prize-name">${escapeHtml(item.name)}</div>
              ${item.description
                ? `<div class="prize-desc">${escapeHtml(item.description)}</div>` : ''}
              <div class="prize-meta">
                <span class="prize-price">${item.price} 點</span>
                ${item.stock !== null
                  ? `<span class="prize-stock">${soldOut ? '已兌完' : '剩 ' + item.stock + ' 份'}</span>`
                  : ''}
              </div>
            </div>
            <button class="btn btn-accent btn-small" ${disabled ? 'disabled' : ''}
                    onclick="StudentApp.buy('${item.id}')">
              ${waiting ? '處理中' : soldOut ? '已兌完' : tooPoor ? `還差 ${item.price - points} 點` : '兌換'}
            </button>
          </div>`;
        }).join('');

    return `
      <div class="prize-balance">
        <span>我的可用積分</span>
        <strong>${points}</strong>
      </div>
      ${cards}
      ${this.renderMyPurchases()}`;
  },

  renderMyPurchases() {
    const list = (this.myPurchases || [])
      .filter(p => p.status !== 'pending')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 10);
    if (list.length === 0) return '';

    const label = {
      paid: '已扣點,等老師發放',
      delivered: '已領取',
      rejected: '未成立',
      refunded: '已退點'
    };

    return `
      <section class="student-section">
        <div class="student-section-title">我的兌換紀錄</div>
        <div class="student-history">
          ${list.map(p => `
            <div class="student-history-row">
              <span class="student-history-reason">
                ${escapeHtml(p.itemIcon || '🎁')} ${escapeHtml(p.itemName)}
                <span class="prize-status ${p.status}">${label[p.status] || p.status}</span>
                ${p.status === 'rejected' && p.reason
                  ? `<span class="prize-reason">${escapeHtml(p.reason)}</span>` : ''}
              </span>
              <span class="student-history-points neg">
                ${p.settledPrice != null ? '-' + p.settledPrice : ''}
              </span>
            </div>`).join('')}
        </div>
      </section>`;
  },

  async buy(itemId) {
    const item = (this.shopItems || []).find(i => i.id === itemId);
    if (!item) return;
    if (!confirm(`用 ${item.price} 點兌換「${item.name}」嗎?`)) return;

    try {
      await Cloud.createPurchase(this.classInfo.classId, Cloud.uid, {
        studentId: this.classInfo.studentId,
        studentName: this.classInfo.name,
        itemId: item.id,
        itemName: item.name,
        itemIcon: item.icon || '🎁',
        requestedPrice: item.price
      });
      toast('✦ 已送出兌換,老師確認後就會扣點');
    } catch (e) {
      console.error(e);
      toast('兌換失敗:' + e.message);
    }
  },

  /* ---------- 分頁:排行榜 ---------- */

  /* 分組來源:老師存過的分組優先,否則用目前螢幕上那份(按過「產生分組」就有)。
     老師只按產生沒按儲存也看得到,不用多教一個步驟。 */
  readGroups(blob) {
    const sets = blob.groupSets || [];
    if (sets.length > 0) {
      const latest = sets[sets.length - 1];
      this.groups = decodeGroups(latest.groups);
      this.groupsName = latest.name;
    } else {
      this.groups = decodeGroups(blob.currentGroups);
      this.groupsName = null;
    }
  },

  renderRankTab() {
    const hasGroups = !!(this.groups && this.groups.length);
    const showGroup = this.rankTab === 'group' && hasGroups;

    const rows = showGroup
      ? Leaderboard.groups(this.allStudents, this.groups)
      : Leaderboard.individual(this.allStudents);

    // 小組榜要高亮的是「我所屬的那一組」
    const myId = showGroup ? this.myGroupId() : this.classInfo.studentId;

    const switcher = hasGroups ? `
      <div class="rank-switch">
        <button class="rank-switch-btn ${!showGroup ? 'active' : ''}"
                onclick="StudentApp.setRankTab('individual')">個人榜</button>
        <button class="rank-switch-btn ${showGroup ? 'active' : ''}"
                onclick="StudentApp.setRankTab('group')">小組榜</button>
      </div>` : '';

    // 前三名沒變動就不重播動畫
    const sig = this.rankTab + '::' + Leaderboard.signature(rows);
    const animate = sig !== this.lastPodiumSig;
    this.lastPodiumSig = sig;

    return `
      ${switcher}
      ${showGroup && this.groupsName
        ? `<div class="rank-groupset-name">依「${escapeHtml(this.groupsName)}」分組</div>` : ''}
      ${Leaderboard.renderPodium(rows, { highlightId: myId, animate })}
      ${Leaderboard.renderMyRank(rows, myId, showGroup ? '我這組的名次' : '我的名次')}
    `;
  },

  setRankTab(tab) {
    this.rankTab = tab;
    this.render();
  },

  /* 找出自己在哪一組 */
  myGroupId() {
    if (!this.groups) return null;
    const idx = this.groups.findIndex(members =>
      (members || []).some(m => Leaderboard.memberId(m) === this.classInfo.studentId));
    return idx >= 0 ? 'g' + idx : null;
  },

  renderPet(s) {
    const stage = PetEngine.getStage(s.totalPoints);
    const species = PET_SPECIES.find(p => p.id === s.pet);
    const nextThreshold = STAGE_THRESHOLDS[stage + 1];
    const pct = nextThreshold
      ? Math.min(100, Math.round(s.totalPoints / nextThreshold * 100))
      : 100;

    return `
      <div class="student-pet-card">
        <div class="student-pet-icon">${PetEngine.getIcon(s)}</div>
        <div class="student-pet-name">${escapeHtml(s.petName || (species ? species.name : '守護獸'))}</div>
        <div class="student-pet-stage">${STAGE_NAMES[stage]}</div>
        <div class="student-points">
          <div><span class="student-points-num">${s.totalPoints}</span><span>累積經驗</span></div>
          <div><span class="student-points-num">${s.currentPoints}</span><span>可用積分</span></div>
        </div>
        <div class="student-progress">
          <div class="student-progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="student-progress-label">
          ${nextThreshold
            ? `再 ${nextThreshold - s.totalPoints} 分進化到下一階段`
            : '已達最高階段'}
        </div>
      </div>`;
  },

  /* ---------- 自選守護獸 ---------- */

  renderPetPicker() {
    const cards = PET_SPECIES.map(p => `
      <div class="pet-choice ${this.pickedPet === p.id ? 'selected' : ''}"
           onclick="StudentApp.pickPet('${p.id}')">
        <div class="pet-choice-icon">${p.icon}</div>
        <div class="pet-choice-name">${escapeHtml(p.name)}</div>
        <div class="pet-choice-desc">${escapeHtml(p.desc)}</div>
      </div>`).join('');

    return `
      <div class="pet-picker">
        <div class="pet-picker-title">選擇你的守護獸</div>
        <div class="pet-picker-sub">— 台 灣 山 林 八 神 —</div>
        <div class="pet-picker-desc">
          牠們都是台灣特有種,真實住在這座島上。<br>
          選好之後就不能更換了,慢慢挑。
        </div>
        <div class="pet-choice-grid">${cards}</div>
        <input type="text" id="petNickname" class="student-short-input"
               placeholder="幫牠取個名字(可留空)" style="margin-top:16px;" />
        <button class="btn btn-primary btn-block btn-large" style="margin-top:14px;"
                ${this.pickedPet ? '' : 'disabled'}
                onclick="StudentApp.confirmPet()">
          ${this.pickedPet ? '就選牠了' : '請先選一隻'}
        </button>
      </div>`;
  },

  pickPet(petId) {
    this.pickedPet = petId;
    // 保留使用者已經打好的名字,重繪不要清掉
    const input = document.getElementById('petNickname');
    this.draftNickname = input ? input.value : (this.draftNickname || '');
    this.render();
    const restored = document.getElementById('petNickname');
    if (restored) restored.value = this.draftNickname || '';
  },

  async confirmPet() {
    if (!this.pickedPet) return;
    const species = PET_SPECIES.find(p => p.id === this.pickedPet);
    const input = document.getElementById('petNickname');
    const nickname = (input ? input.value : '').trim();

    if (!confirm(`確定選擇「${species.name}」嗎?選好之後就不能更換了。`)) return;

    try {
      await Cloud.savePetChoice(this.classInfo.classId, Cloud.uid, {
        studentId: this.classInfo.studentId,
        studentName: this.classInfo.name,
        pet: this.pickedPet,
        petName: nickname || null
      });
      toast('✦ 守護獸已選定!');
      this.pickedPet = null;
      this.draftNickname = '';
      await this.refresh();
    } catch (e) {
      console.error(e);
      toast('選擇失敗:' + e.message);
    }
  },

  /* 已送出選擇,但老師還沒開過班級後台,尚未收進正式資料 */
  renderPendingPet() {
    const species = PET_SPECIES.find(p => p.id === this.petChoice.pet);
    if (!species) return '<div class="student-pet-empty">守護獸資料有誤,請告訴老師</div>';
    return `
      <div class="student-pet-card">
        <div class="student-pet-icon">🥚</div>
        <div class="student-pet-name">${escapeHtml(this.petChoice.petName || species.name)}</div>
        <div class="student-pet-stage">${escapeHtml(species.name)} · 靈卵</div>
        <div class="student-progress-label" style="margin-top:16px;">
          你選好了 ${species.icon} ${escapeHtml(species.name)}。<br>
          老師下次打開班級後台時,牠就會正式住進來。
        </div>
      </div>`;
  },

  renderHistory() {
    const h = (this.student && this.student.history) || [];
    if (h.length === 0) return '<div class="student-empty">還沒有積分紀錄</div>';
    return `<div class="student-history">` +
      h.slice(-10).reverse().map(r => `
        <div class="student-history-row">
          <span class="student-history-reason">${escapeHtml(r.reason)}</span>
          <span class="student-history-points ${r.points >= 0 ? 'pos' : 'neg'}">
            ${r.points >= 0 ? '+' : ''}${r.points}
          </span>
        </div>`).join('') + `</div>`;
  },

  /* ---------- 作答 ---------- */

  async openQuiz(quizId) {
    const quiz = this.quizzes.find(q => q.id === quizId);
    if (!quiz) return;
    this.activeQuiz = quiz;
    this.draftAnswers = {};

    // 逐題搶答:先查自己已經答過哪幾題,重新整理或換裝置都接得回去
    if (quiz.scoreMode === 'perQuestion') {
      this.qAnswered = await Cloud.listMyQuizAnswers(
        this.classInfo.classId, quiz.id, Cloud.uid);
      this.qPicked = null;
    }
    this.render();
  },

  async closeQuiz() {
    const quiz = this.activeQuiz;
    this.activeQuiz = null;
    this.draftAnswers = {};
    this.qPicked = null;
    // 逐題搶答離開時把進度更新回列表,不然還是顯示舊的題數
    if (quiz && quiz.scoreMode === 'perQuestion') {
      this.qProgress[quiz.id] = Object.keys(this.qAnswered).length;
    }
    this.qAnswered = {};
    this.render();
  },

  setAnswer(qId, value) {
    this.draftAnswers[qId] = value;
  },

  /* ---------- 逐題搶答 ----------
     一次只看一題,送出才看得到下一題,不能回頭改。
     每一題的時間戳由伺服器蓋,所以「誰最快答對這一題」是伺服器認定的。
     對錯不會當場告訴學生 —— 正確答案留在老師那裡,結算時才批改,
     否則先答的人可以把答案傳給還沒答的人。 */

  currentQIndex() {
    const quiz = this.activeQuiz;
    const i = quiz.questions.findIndex(q => !this.qAnswered[q.id]);
    return i;                                  // -1 = 全部答完
  },

  pickQAnswer(value) {
    this.qPicked = value;
    this.render();
  },

  /* 簡答題邊打字邊切換送出鈕。這裡不整頁重繪 —— 會把游標踢掉。 */
  syncQSendBtn() {
    const btn = document.getElementById('qSendBtn');
    if (btn) btn.disabled = !String(this.qPicked || '').trim();
  },

  async sendQAnswer() {
    if (this.qPicked === null || this.qPicked === undefined || this.qSending) return;
    const quiz = this.activeQuiz;
    const q = quiz.questions[this.currentQIndex()];
    if (!q) return;

    this.qSending = true;
    this.render();
    try {
      await Cloud.sendQuizAnswer(this.classInfo.classId, quiz.id, Cloud.uid, {
        studentId: this.classInfo.studentId,
        studentName: this.classInfo.name,
        questionId: q.id,
        answer: this.qPicked
      });
      this.qAnswered[q.id] = { answer: this.qPicked };
      this.qPicked = null;
    } catch (e) {
      console.error(e);
      toast(e.code === 'permission-denied'
        ? '這一題已經答過了,或測驗已經結束'
        : '送出失敗:' + e.message);
    } finally {
      this.qSending = false;
      this.render();
    }
  },

  renderPerQuestionPage() {
    const quiz = this.activeQuiz;
    const idx = this.currentQIndex();
    const total = quiz.questions.length;
    const doneCount = total - quiz.questions.filter(q => !this.qAnswered[q.id]).length;

    const head = `
      <header class="student-header">
        <div class="student-class">${escapeHtml(quiz.title)}</div>
        <button class="btn btn-ghost btn-small" onclick="StudentApp.closeQuiz()">← 返回</button>
      </header>`;

    if (idx < 0) {
      return `${head}
        <main class="student-main">
          <div class="qrace-done">
            <div class="qrace-done-mark">✓</div>
            <div class="qrace-done-text">${total} 題都答完了</div>
            <div class="qrace-done-note">
              ${quiz.settleAt && Date.now() < quiz.settleAt
                ? formatSettleAt(quiz.settleAt) + ' 公布成績'
                : '老師結算後就會看到成績'}
            </div>
          </div>
          <button class="btn btn-primary btn-block btn-large"
                  onclick="StudentApp.closeQuiz()">回到測驗列表</button>
        </main>`;
    }

    const q = quiz.questions[idx];
    const picked = this.qPicked;

    let options = '';
    if (q.type === 'choice') {
      options = q.options.map((opt, oi) => opt ? `
        <div class="student-option ${picked === oi ? 'picked' : ''}"
             onclick="StudentApp.pickQAnswer(${oi})">
          <span class="student-option-letter">${'ABCD'[oi]}</span>
          <span>${escapeHtml(opt)}</span>
        </div>` : '').join('');
    } else if (q.type === 'truefalse') {
      options = `
        <div class="student-option ${picked === true ? 'picked' : ''}"
             onclick="StudentApp.pickQAnswer(true)">○ 正確</div>
        <div class="student-option ${picked === false ? 'picked' : ''}"
             onclick="StudentApp.pickQAnswer(false)">✕ 錯誤</div>`;
    } else {
      options = `<input type="text" class="student-short-input" placeholder="在這裡作答"
                   value="${picked ? escapeHtml(String(picked)) : ''}"
                   oninput="StudentApp.qPicked = this.value; StudentApp.syncQSendBtn()" />`;
    }

    return `${head}
      <main class="student-main">
        <div class="qrace-bar">
          <div class="qrace-progress">第 ${idx + 1} / ${total} 題</div>
          <div class="qrace-hint">每題各自比快 · 前 ${quiz.topN} 名答對得分</div>
        </div>
        <div class="qrace-track">
          ${quiz.questions.map((_, i) =>
            `<span class="qrace-dot ${i < doneCount ? 'done' : i === idx ? 'now' : ''}"></span>`
          ).join('')}
        </div>

        <div class="student-question">
          <div class="student-question-text">${escapeHtml(q.text)}</div>
          ${options}
        </div>

        <button class="btn btn-primary btn-block btn-large" id="qSendBtn"
                ${this.qSending || picked === null || picked === undefined || picked === '' ? 'disabled' : ''}
                onclick="StudentApp.sendQAnswer()">
          ${this.qSending ? '送出中…' : idx + 1 === total ? '送出最後一題' : '送出,下一題'}
        </button>
        <div class="student-note">送出後不能修改,也不會馬上告訴你對不對。</div>
      </main>`;
  },

  renderQuizPage() {
    const quiz = this.activeQuiz;
    if (quiz.scoreMode === 'perQuestion') {
      document.getElementById('studentView').innerHTML = this.renderPerQuestionPage();
      return;
    }
    const questions = quiz.questions.map((q, i) => `
      <div class="student-question">
        <div class="student-question-text">
          <span class="student-question-num">${i + 1}</span>${escapeHtml(q.text)}
        </div>

        ${q.type === 'choice' ? q.options.map((opt, oi) => `
          <label class="student-option">
            <input type="radio" name="sq_${q.id}" value="${oi}"
                   onchange="StudentApp.setAnswer('${q.id}', ${oi})" />
            <span class="student-option-letter">${'ABCD'[oi]}</span>
            <span>${escapeHtml(opt)}</span>
          </label>`).join('') : ''}

        ${q.type === 'truefalse' ? `
          <label class="student-option">
            <input type="radio" name="sq_${q.id}"
                   onchange="StudentApp.setAnswer('${q.id}', true)" /> ○ 正確
          </label>
          <label class="student-option">
            <input type="radio" name="sq_${q.id}"
                   onchange="StudentApp.setAnswer('${q.id}', false)" /> ✕ 錯誤
          </label>` : ''}

        ${q.type === 'short' ? `
          <input type="text" class="student-short-input" placeholder="在這裡作答"
                 oninput="StudentApp.setAnswer('${q.id}', this.value)" />` : ''}
      </div>
    `).join('');

    document.getElementById('studentView').innerHTML = `
      <header class="student-header">
        <div class="student-class">${escapeHtml(quiz.title)}</div>
        <button class="btn btn-ghost btn-small" onclick="StudentApp.closeQuiz()">← 返回</button>
      </header>
      <main class="student-main">
        ${questions}
        <button class="btn btn-primary btn-block btn-large" id="submitQuizBtn"
                onclick="StudentApp.submit()">交 卷</button>
        <div class="student-note">交卷後無法修改,請確認每題都作答了。</div>
      </main>
    `;
  },

  async submit() {
    const quiz = this.activeQuiz;
    const unanswered = quiz.questions.filter(q => {
      const a = this.draftAnswers[q.id];
      return a === undefined || a === null || a === '';
    });

    if (unanswered.length > 0) {
      if (!confirm(`還有 ${unanswered.length} 題沒作答,確定要交卷嗎?`)) return;
    }

    const btn = document.getElementById('submitQuizBtn');
    if (btn) { btn.disabled = true; btn.textContent = '送出中…'; }

    try {
      await Cloud.submitAnswers(this.classInfo.classId, quiz.id, Cloud.uid, {
        studentId: this.classInfo.studentId,
        studentName: this.classInfo.name,
        answers: this.draftAnswers
      });
      toast(quiz.settleAt && Date.now() < quiz.settleAt
        ? `✦ 已交卷!交卷順序已記錄,成績 ${formatSettleAt(quiz.settleAt)} 公布`
        : '✦ 已交卷!老師結算後積分會加到你的守護獸');
      this.activeQuiz = null;
      await this.refresh();
    } catch (e) {
      console.error(e);
      toast('交卷失敗:' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '交 卷'; }
    }
  }
};

/* ============================================
   學生端:領地佔領戰
   ────────────────────────────────────────────
   地圖和老師端跑同一份重播,所以兩邊看到的必然一致。
   答錯時安全規則會擋下寫入(permission-denied),據此判定對錯 ——
   正確答案從頭到尾沒有離開伺服器。
============================================ */

Object.assign(StudentApp, {
  tQuestions: [],
  tTargetHex: null,
  tQuestion: null,
  tPickedAnswer: null,
  tSubmitting: false,
  tResult: null,
  unsubTQuestions: null,
  _warTabShown: false,
  _warSig: null,
  tTried: new Set(),      // 這次登入已經作答過的題目(含答錯的)
  qProgress: {},          // { quizId: 已答題數 } 逐題搶答用
  qAnswered: {},          // 目前這份測驗自己答過的題目
  qPicked: null,
  qSending: false,

  watchTerritory() {
    // 重播引擎由老師端與學生端共用,這裡只是掛上自己的重繪
    // 老師開戰/收工時,分頁列本身要跟著出現或消失 —— 不能只在已經站在
    // 領地戰分頁時才重繪,否則學生會一直看不到那個分頁。
    TerritoryGame.start(() => {
      const running = !!(TerritoryGame.config && TerritoryGame.config.status === 'running');
      if (running !== this._warTabShown) {
        this._warTabShown = running;
        if (!running && this.tab === 'war') this.tab = 'pet';
        this.render();
        return;
      }
      // 重播引擎每秒重算一次(倒數與階段開放靠它),但戰況沒變就不該重畫
      // 上千格的地圖 —— 那會讓學生正在看的位置一直被打斷。
      if (this.tab === 'war' && !this.tQuestion) {
        const sig = TerritoryGame.config
          ? Territory.signature(TerritoryGame.config, TerritoryGame.map) : 'none';
        if (sig === this._warSig) { this.tickWarCountdown(); return; }
        this._warSig = sig;
        this.render();
      }
    }, this.classInfo.classId);

    if (this.unsubTQuestions) this.unsubTQuestions();
    this.unsubTQuestions = Cloud.watchTerritoryQuestions(
      this.classInfo.classId, qs => { this.tQuestions = qs; });
  },

  /* 戰況沒變時只更新倒數文字,不動地圖 */
  tickWarCountdown() {
    const el = document.getElementById('warCountdown');
    if (!el || !TerritoryGame.config) return;
    const nextAt = Territory.nextStageAt(TerritoryGame.config);
    if (nextAt) el.textContent = formatCountdown(nextAt - Date.now());
  },

  myGroupIdx() {
    const c = TerritoryGame.config;
    if (!c || !c.memberGroup) return null;
    const g = c.memberGroup[this.classInfo.studentId];
    return g == null ? null : g;
  },

  renderWarTab() {
    const c = TerritoryGame.config;
    if (!c) return '<div class="student-empty">老師還沒開始領地戰</div>';

    const map = TerritoryGame.map;
    const groupIdx = this.myGroupIdx();

    if (c.status !== 'running') {
      return `${renderStandings(c, map, groupIdx)}
              <div class="student-empty">這一局已經結束了</div>
              ${renderHexMap(c, map, { zoom: _territoryZoom })}`;
    }
    if (groupIdx == null) {
      return '<div class="student-empty">你不在這一局的任何一組,請找老師確認分組</div>';
    }
    if (this.tQuestion) return this.renderWarQuestion();

    const targets = Territory.targetsFor(c, map, groupIdx);
    const color = GROUP_COLORS[groupIdx % GROUP_COLORS.length];
    const nextAt = Territory.nextStageAt(c);

    return `
      <div class="war-header" style="border-color:${color}">
        <div class="war-my-group" style="color:${color}">我是第 ${groupIdx + 1} 組</div>
        <div class="war-hint">
          點選<strong>亮起來</strong>的地塊發動攻擊(有 ${targets.size} 格可打)<br>
          ${nextAt
            ? `下一圈地圖在 <strong id="warCountdown">${formatCountdown(nextAt - Date.now())}</strong> 後開放`
            : '地圖已全部開放'}
        </div>
      </div>
      ${this.tResult ? `<div class="war-result ${this.tResult.ok ? 'ok' : 'no'}">${escapeHtml(this.tResult.msg)}</div>` : ''}
      ${renderStandings(c, map, groupIdx)}
      ${renderHexMap(c, map, { groupIdx, onClick: 'StudentApp.attackHex', zoom: _territoryZoom })}
      <div class="war-legend">
        每塊地被攻擊後會展開 ${c.battleSeconds} 秒的爭奪,
        時間內分數最高且達到 ${c.threshold} 分的那一組拿下。<br>
        灰色是尚未開放的區域,★ 是各組基地,不能被攻佔。
      </div>`;
  },

  /* 已經答過的題目不再出現。答過的名單直接從戰況事件推出來,
     重新整理或換裝置都算數,不靠瀏覽器記憶。 */
  unusedQuestions() {
    // 答錯不會留下事件(規則直接擋掉),所以本機也要記一份,
    // 否則同一題可以一直猜到對為止。
    const used = new Set([
      ...(TerritoryGame.events || [])
        .filter(e => e.uid === Cloud.uid)
        .map(e => e.questionId),
      ...this.tTried
    ]);
    return this.tQuestions.filter(q => !used.has(q.id));
  },

  attackHex(hexKey) {
    if (this.tQuestions.length === 0) { toast('題庫是空的,請找老師'); return; }
    const pool = this.unusedQuestions();
    if (pool.length === 0) { toast('題庫的題目你都答過了,請找老師再出題'); return; }
    this.tTargetHex = hexKey;
    this.tQuestion = pool[Math.floor(Math.random() * pool.length)];
    this.tPickedAnswer = null;
    this.tResult = null;
    this.render();
  },

  cancelWarQuestion() {
    this.tQuestion = null;
    this.tTargetHex = null;
    this.tPickedAnswer = null;
    this.render();
  },

  pickWarAnswer(i) {
    this.tPickedAnswer = i;
    this.render();
  },

  renderWarQuestion() {
    const q = this.tQuestion;
    const d = DIFFICULTY[q.difficulty] || DIFFICULTY.easy;
    const c = TerritoryGame.config;
    const cell = TerritoryGame.map[this.tTargetHex] || {};
    const mine = cell.battle ? (cell.battle.points[String(this.myGroupIdx())] || 0) : 0;

    return `
      <div class="war-question">
        <div class="war-q-head">
          <span class="war-q-diff" style="background:${d.color}">
            ${d.label} · 答對 +${d.points} 佔領分</span>
          <button class="btn btn-ghost btn-small" onclick="StudentApp.cancelWarQuestion()">放棄</button>
        </div>

        <div class="war-q-target">
          <span>攻打:${cell.owner === null || cell.owner === undefined
            ? '空白地塊' : '第 ' + (cell.owner + 1) + ' 組的地'}</span>
          <span class="war-q-progress">
            ${cell.battle
              ? `我方 ${mine} 分 · 剩 ${formatCountdown(cell.battle.endsAt - Date.now())}`
              : `尚未開戰 · 需 ${c.threshold} 分`}
          </span>
        </div>

        <div class="war-q-text">${escapeHtml(q.text)}</div>

        ${q.options.map((opt, i) => opt ? `
          <label class="student-option ${this.tPickedAnswer === i ? 'picked' : ''}"
                 onclick="StudentApp.pickWarAnswer(${i})">
            <span class="student-option-letter">${'ABCD'[i]}</span>
            <span>${escapeHtml(opt)}</span>
          </label>` : '').join('')}

        <button class="btn btn-primary btn-block btn-large" style="margin-top:14px;"
                ${this.tPickedAnswer === null || this.tSubmitting ? 'disabled' : ''}
                onclick="StudentApp.submitWarAnswer()">
          ${this.tSubmitting ? '送出中…'
            : this.tPickedAnswer === null ? '請先選一個答案' : '送 出'}
        </button>
      </div>`;
  },

  /* 答錯時規則會拒絕寫入。這不是錯誤,而是判定結果 ——
     正確答案不需要送到學生端,也就無從偷看。 */
  async submitWarAnswer() {
    if (this.tPickedAnswer === null || this.tSubmitting) return;
    this.tSubmitting = true;
    this.render();

    const groupIdx = this.myGroupIdx();
    const points = DIFFICULTY[this.tQuestion.difficulty].points;
    this.tTried.add(this.tQuestion.id);

    try {
      await Cloud.sendTerritoryEvent(this.classInfo.classId, Cloud.uid, {
        studentId: this.classInfo.studentId,
        studentName: this.classInfo.name,
        groupIdx,
        hexKey: this.tTargetHex,
        questionId: this.tQuestion.id,
        answer: this.tPickedAnswer,
        points
      });
      this.tResult = { ok: true, msg: `✦ 答對!為第 ${groupIdx + 1} 組拿下 ${points} 佔領分` };
    } catch (e) {
      if (e.code === 'permission-denied') {
        this.tResult = { ok: false, msg: '答錯了,再挑一格試試' };
      } else {
        console.error(e);
        this.tResult = { ok: false, msg: '送出失敗:' + e.message };
      }
    } finally {
      this.tSubmitting = false;
      this.tQuestion = null;
      this.tTargetHex = null;
      this.render();
    }
  }
});
