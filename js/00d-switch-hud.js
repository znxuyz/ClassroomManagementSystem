/* ============================================
   切換班級的進度提示
   ────────────────────────────────────────────
   換班不是瞬間的事:要先把沒送出的變更寫回雲端、中斷上一班的即時連線、
   讀新班級的資料、重新接上監聽。中間若沒有任何回饋,老師會以為當掉了,
   然後在切到一半時又去點別的地方。

   這裡把每一步攤開來給老師看,並且在完成前擋住畫面 ——
   擋住本身就是功能:切換期間的點擊會落在還沒換完的資料上。
============================================ */

const SwitchHUD = {
  el: null,
  active: false,
  steps: [],

  /* 這幾步對應 Session.switchClass() / openClass() 的實際流程 */
  PLAN: [
    { key: 'save',   label: '儲存尚未送出的變更' },
    { key: 'detach', label: '中斷上一個班級的連線' },
    { key: 'load',   label: '讀取班級資料' },
    { key: 'apply',  label: '套用名單與設定' },
    { key: 'attach', label: '重新接上即時同步' },
    { key: 'render', label: '更新畫面' }
  ],

  show(className) {
    this.active = true;
    this.steps = this.PLAN.map(s => ({ ...s, state: 'wait' }));

    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'hud is-switch';
      document.body.appendChild(this.el);
    }
    this.el.innerHTML = `
      <div class="hud-panel" role="status" aria-live="polite">
        <div class="hud-scan"></div>
        <div class="hud-kicker">切換班級</div>
        <div class="hud-title" id="switchHudTitle">${escapeHtml(className || '')}</div>
        <div class="hud-bar"><i id="switchHudBar"></i></div>
        <ul class="hud-steps" id="switchHudSteps"></ul>
        <div class="hud-error" id="switchHudError" hidden></div>
      </div>`;
    this.el.classList.add('is-open');
    this.paint();
  },

  /* 標記某一步的狀態。HUD 沒開的時候整個是空操作,
     所以 openClass() 不管是正常開班還是換班都可以照呼叫。 */
  mark(key, state) {
    if (!this.active) return;
    const i = this.steps.findIndex(s => s.key === key);
    if (i < 0) return;
    // 走到這一步,代表前面的都過了
    for (let j = 0; j < i; j++) {
      if (this.steps[j].state !== 'done') this.steps[j].state = 'done';
    }
    this.steps[i].state = state || 'doing';
    this.paint();
  },

  /* 標記之後讓瀏覽器真的畫一次。
     套用資料、重新掛監聽這些是同步跑完的,不讓出去的話畫面會從
     「讀取中」直接跳到「完成」,中間幾步老師根本看不到。
     只讓出一個影格,不是刻意拖慢。 */
  async step(key) {
    this.mark(key, 'doing');
    if (!this.active) return;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  },

  paint() {
    if (!this.el) return;
    const list = this.el.querySelector('#switchHudSteps');
    const bar = this.el.querySelector('#switchHudBar');
    if (!list || !bar) return;

    list.innerHTML = this.steps.map(s => {
      const icon = s.state === 'done' ? '✓'
                 : s.state === 'fail' ? '✕'
                 : s.state === 'doing' ? '<span class="hud-spin"></span>'
                 : '';
      return `<li class="is-${s.state}"><span class="hud-dot">${icon}</span>${s.label}</li>`;
    }).join('');

    const done = this.steps.filter(s => s.state === 'done').length;
    bar.style.width = Math.round(done / this.steps.length * 100) + '%';
  },

  async finish(className) {
    if (!this.active) return;
    this.steps.forEach(s => { if (s.state !== 'fail') s.state = 'done'; });
    this.paint();

    const title = this.el.querySelector('#switchHudTitle');
    if (title) title.textContent = `已切換到 ${className}`;

    // 停一下讓老師看到「全部完成」,不然會以為根本沒做事
    await new Promise(r => setTimeout(r, 420));
    this.hide();
  },

  fail(message) {
    if (!this.active) return;
    const doing = this.steps.find(s => s.state === 'doing');
    if (doing) doing.state = 'fail';
    this.paint();

    const box = this.el.querySelector('#switchHudError');
    if (box) {
      box.hidden = false;
      box.innerHTML = `${escapeHtml(message)}
        <button class="btn btn-ghost btn-small" onclick="SwitchHUD.hide()">關閉</button>`;
    }
  },

  hide() {
    this.active = false;
    if (this.el) this.el.classList.remove('is-open');
  }
};
