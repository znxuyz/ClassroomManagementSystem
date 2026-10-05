/* ============================================
   排行榜
   ────────────────────────────────────────────
   個人榜與小組榜共用同一套頒獎台。

   頒獎台高度是照「分數差距」等比例畫的,不是固定的三階。
   第一名遙遙領先時,台階就會拉得很開;分數咬得很緊時,
   三個台階幾乎一樣高 —— 讓孩子一眼看出差距,而不只是名次。
============================================ */

const Leaderboard = {

  PODIUM_MAX: 170,   // 第一名的台階高度(px)
  PODIUM_MIN: 40,    // 零分時的台階高度,留一點才看得到

  /* ---------- 資料 ---------- */

  /* 個人排名。同分者並列,名次跳號(1,2,2,4) */
  individual(students) {
    const ranked = [...students]
      .filter(s => s.pet || s.totalPoints > 0)
      .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, 'zh-Hant'));

    let lastScore = null;
    let lastRank = 0;
    return ranked.map((s, i) => {
      const rank = s.totalPoints === lastScore ? lastRank : i + 1;
      lastScore = s.totalPoints;
      lastRank = rank;
      return {
        id: s.id,
        name: s.name,
        score: s.totalPoints,
        icon: PetEngine.getIcon(s),
        rank
      };
    });
  },

  /* 分組資料存的是學生 id 字串,分數一律回頭查目前的學生資料,
     不用分組當下的快照。舊資料可能存成物件,所以兩種都接受。 */
  memberId(m) {
    return typeof m === 'string' ? m : (m && m.id);
  },

  groups(students, groupList) {
    const list = Array.isArray(groupList) ? groupList : null;
    if (!list || list.length === 0) return [];

    const byId = new Map(students.map(s => [s.id, s]));

    const rows = list.map((members, i) => {
      const live = (members || [])
        .map(m => byId.get(this.memberId(m)))
        .filter(Boolean);
      const score = live.reduce((sum, s) => sum + s.totalPoints, 0);
      return {
        id: 'g' + i,
        name: `第 ${i + 1} 組`,
        score,
        memberCount: live.length,
        memberNames: live.map(s => s.name),
        // 平均分並列出來,人數不同的組別才有可比性
        average: live.length > 0 ? Math.round(score / live.length) : 0
      };
    }).filter(g => g.memberCount > 0);

    rows.sort((a, b) => b.score - a.score);

    let lastScore = null;
    let lastRank = 0;
    rows.forEach((g, i) => {
      g.rank = g.score === lastScore ? lastRank : i + 1;
      lastScore = g.score;
      lastRank = g.rank;
    });
    return rows;
  },

  /* ---------- 頒獎台 ---------- */

  /* 台階高度與分數等比。以第一名為滿高,零分為最低。 */
  podiumHeight(score, topScore) {
    if (topScore <= 0) return this.PODIUM_MIN;
    const ratio = Math.max(0, score) / topScore;
    return Math.round(this.PODIUM_MIN + ratio * (this.PODIUM_MAX - this.PODIUM_MIN));
  },

  /* 名次的指紋。即時更新時用來判斷要不要重播動畫 ——
     排名沒變還一直重播,孩子會看得很煩。 */
  signature(rows) {
    return rows.slice(0, 3).map(r => `${r.id}:${r.score}`).join('|');
  },

  renderPodium(rows, opts) {
    const o = opts || {};
    if (rows.length === 0) {
      return '<div class="student-empty">還沒有人得分,快去努力吧</div>';
    }

    const top3 = rows.slice(0, 3);
    const topScore = top3[0].score;

    // 版面順序是 2 1 3,第一名擺中間
    const order = [top3[1], top3[0], top3[2]].filter(Boolean);
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };

    const columns = order.map(row => {
      const height = this.podiumHeight(row.score, topScore);
      const isMe = o.highlightId && row.id === o.highlightId;
      // 由中間往外延遲,第一名先站上去
      const delay = row.rank === 1 ? 0 : row.rank === 2 ? 0.18 : 0.36;

      return `
        <div class="podium-column ${isMe ? 'is-me' : ''}">
          <div class="podium-figure" style="animation-delay:${delay + 0.5}s">
            ${row.icon ? `<div class="podium-icon">${row.icon}</div>` : ''}
            <div class="podium-medal">${medals[row.rank] || ''}</div>
            <div class="podium-name">${escapeHtml(row.name)}</div>
            <div class="podium-score">${row.score} 分</div>
          </div>
          <div class="podium-block podium-rank-${row.rank}"
               style="height:${height}px; animation-delay:${delay}s">
            <span class="podium-rank-num">${row.rank}</span>
          </div>
        </div>`;
    }).join('');

    return `<div class="podium ${o.animate === false ? 'no-anim' : ''}">${columns}</div>`;
  },

  /* 自己的名次卡。就算沒進前三也看得到自己在哪。 */
  renderMyRank(rows, myId, label) {
    const me = rows.find(r => r.id === myId);
    if (!me) return '';
    const total = rows.length;
    const beaten = total - me.rank;

    return `
      <div class="my-rank-card">
        <div class="my-rank-label">${label}</div>
        <div class="my-rank-body">
          <div class="my-rank-place">
            <span class="my-rank-num">${me.rank}</span>
            <span class="my-rank-of">/ ${total}</span>
          </div>
          <div class="my-rank-detail">
            <div class="my-rank-score">${me.score} 分</div>
            <div class="my-rank-note">${
              me.rank === 1 ? '目前第一名,守住它!'
              : beaten > 0 ? `領先 ${beaten} 位,再加油可以往前`
              : '從這裡開始往上爬'
            }</div>
          </div>
        </div>
      </div>`;
  }
};

/* ============================================
   老師端的排行榜
   ────────────────────────────────────────────
   和學生看到的是同一份排名(同一個 Leaderboard 模組算出來的),
   所以不會出現「老師講的名次和學生看到的不一樣」。
   差別只在老師多了完整名次 —— 學生端刻意只給前三名加自己,
   避免後段班每天被攤在全班面前。
============================================ */

let _teacherRankMode = 'individual';

function setTeacherRankMode(mode) {
  _teacherRankMode = mode;
  document.querySelectorAll('[data-rankmode]').forEach(b =>
    b.classList.toggle('active', b.dataset.rankmode === mode));
  renderTeacherRank();
}

function renderTeacherRank() {
  const el = document.getElementById('teacherRankBody');
  if (!el) return;

  const showAll = document.getElementById('rankShowAll');
  const full = !showAll || showAll.checked;

  const isGroup = _teacherRankMode === 'group';
  const rows = isGroup
    ? Leaderboard.groups(state.students, state.currentGroups)
    : Leaderboard.individual(state.students);

  if (rows.length === 0) {
    el.innerHTML = isGroup
      ? '<div class="empty-state"><div class="empty-state-icon">⌗</div><div>還沒有分組。到「班級管理 → 隨機分組」分好組就會出現小組排名</div></div>'
      : '<div class="empty-state"><div class="empty-state-icon">🏆</div><div>還沒有人得分</div></div>';
    return;
  }

  // 投影給全班看的時候,頒獎台動畫才有意思;老師自己查名次時不用等
  const podium = Leaderboard.renderPodium(rows, { animate: true });

  const table = full ? `
    <div class="panel-card" style="margin-top:18px;">
      <div class="panel-title">完整名次</div>
      <table class="rank-table">
        <thead><tr><th>名次</th><th>${isGroup ? '組別' : '座號'}</th>
          <th>${isGroup ? '成員' : '姓名'}</th><th>累積經驗</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const s = isGroup ? null : state.students.find(x => x.id === r.id);
            return `<tr>
              <td class="rank-no">${r.rank}</td>
              <td>${isGroup ? '' : escapeHtml((s && s.seatNumber) || '')}</td>
              <td>${escapeHtml(r.name)}${isGroup
                   ? `<span class="rank-members">${escapeHtml((r.memberNames || []).join('、'))}</span>` : ''}</td>
              <td class="rank-score">${r.score}${isGroup
                   ? `<span class="rank-avg">平均 ${r.average}</span>` : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  el.innerHTML = podium + table;
}
