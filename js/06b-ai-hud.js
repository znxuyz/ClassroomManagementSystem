/* ============================================
   AI 工作中的提示窗
   ────────────────────────────────────────────
   三個 AI 功能都要等 10~30 秒,原本只有結果區裡一個小轉圈,
   老師常以為沒反應而重按。改成和「切換班級」同一套提示窗,
   擋在畫面中央、講清楚現在在哪一步。

   進度條的誠實問題:Anthropic 的回應不是串流,前端無從得知真實進度。
   所以這裡的做法是 ——
     · 明確標示「預估」
     · 跑到 90% 就停住等真正的回覆,不會先衝到 100% 再空等
     · 另外顯示實際經過的秒數,那個數字是真的
============================================ */

const AiHUD = {
  el: null,
  active: false,
  timer: null,
  startedAt: 0,
  expect: 20000,      // 預估耗時,只用來推進度條
  abort: null,

  /* title 例如「行為觀察分析」,subject 例如學生姓名 */
  open(title, subject, opts) {
    const o = opts || {};
    this.active = true;
    this.startedAt = Date.now();
    this.expect = o.expect || 20000;
    this.abort = o.abort || null;

    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'hud is-ai';
      document.body.appendChild(this.el);
    }
    this.el.innerHTML = `
      <div class="hud-panel" role="status" aria-live="polite">
        <div class="hud-scan"></div>
        <div class="hud-kicker">AI 助手</div>
        <div class="hud-title">${escapeHtml(title)}</div>
        ${subject ? `<div class="hud-sub">${escapeHtml(subject)}</div>` : ''}
        <div class="hud-bar"><i id="aiHudBar"></i></div>
        <div class="hud-meta">
          <span id="aiHudStage">整理資料…</span>
          <span id="aiHudTime" class="hud-time">0 秒</span>
        </div>
        <div class="hud-note">分析期間請不要關掉這個分頁</div>
        ${this.abort ? `<div class="hud-foot">
          <button class="btn btn-ghost btn-small" onclick="AiHUD.cancel()">取消</button>
        </div>` : ''}
      </div>`;
    this.el.classList.add('is-open');

    this.stage('整理資料…');
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 200);
  },

  stage(text) {
    const el = this.el && this.el.querySelector('#aiHudStage');
    if (el) el.textContent = text;
  },

  tick() {
    if (!this.active) return;
    const ms = Date.now() - this.startedAt;

    const time = this.el.querySelector('#aiHudTime');
    if (time) time.textContent = Math.round(ms / 1000) + ' 秒';

    /* 先快後慢,逼近 90% 就不再前進 —— 剩下的 10% 留給真正的回覆。
       進度條衝到 100% 卻還在轉,比沒有進度條更讓人焦慮。 */
    const pct = Math.min(90, 90 * (1 - Math.exp(-ms / (this.expect * 0.55))));
    const bar = this.el.querySelector('#aiHudBar');
    if (bar) bar.style.width = pct.toFixed(1) + '%';

    if (ms > this.expect * 1.6) this.stage('還在等 AI 回覆,題目較長時會久一點…');
    else if (ms > 2500) this.stage('AI 正在閱讀這位學生的資料…');
  },

  async done() {
    if (!this.active) return;
    clearInterval(this.timer);
    const bar = this.el.querySelector('#aiHudBar');
    if (bar) bar.style.width = '100%';
    this.stage('完成');
    await new Promise(r => setTimeout(r, 320));
    this.close();
  },

  fail(message) {
    if (!this.active) return;
    clearInterval(this.timer);
    this.stage('');
    const panel = this.el.querySelector('.hud-panel');
    if (panel) {
      panel.insertAdjacentHTML('beforeend',
        `<div class="hud-error">${escapeHtml(message)}
           <button class="btn btn-ghost btn-small" onclick="AiHUD.close()">關閉</button>
         </div>`);
    }
  },

  cancel() {
    if (this.abort) this.abort.abort();
    this.close();
  },

  close() {
    this.active = false;
    clearInterval(this.timer);
    if (this.el) this.el.classList.remove('is-open');
  }
};

/* 把一次 AI 呼叫包起來:開提示窗 → 呼叫 → 收提示窗。
   三個功能共用,行為才會一致。 */
async function runWithAiHUD(title, subject, expect, fn) {
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  AiHUD.open(title, subject, { expect, abort: ctrl });
  try {
    const out = await fn(ctrl ? ctrl.signal : undefined);
    await AiHUD.done();
    return out;
  } catch (e) {
    if (e.name === 'AbortError') { AiHUD.close(); return null; }
    AiHUD.fail(e.message || String(e));
    throw e;
  }
}
