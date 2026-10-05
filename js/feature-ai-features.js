/* ============================================
   設定頁 - API Key 管理
============================================ */
function loadApiKeyToUI() {
  const input = document.getElementById('apiKeyInput');
  const select = document.getElementById('aiModelSelect');
  if (input) {
    input.value = AI.getKey();
    input.type = 'password';
  }
  if (select) {
    select.value = AI.getModel();
  }
}

function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  if (!key) {
    toast('請輸入 API Key');
    return;
  }
  if (!key.startsWith('sk-')) {
    if (!confirm('這個 Key 看起來不像 Anthropic 的格式(應該以 sk- 開頭),確定要儲存嗎?')) return;
  }
  AI.setKey(key);
  toast('API Key 已儲存');
}

function clearApiKey() {
  if (!confirm('確定清除 API Key?清除後 AI 功能將無法使用。')) return;
  AI.clearKey();
  document.getElementById('apiKeyInput').value = '';
  toast('API Key 已清除');
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function saveAiModel() {
  const select = document.getElementById('aiModelSelect');
  AI.setModel(select.value);
  toast('已切換為:' + select.options[select.selectedIndex].text);
}

async function testApiKey() {
  if (!AI.hasKey()) {
    const inputKey = document.getElementById('apiKeyInput').value.trim();
    if (inputKey) AI.setKey(inputKey);
    else { toast('請先輸入 API Key'); return; }
  }
  toast('測試中...');
  try {
    const response = await AI.call(null, '請只回覆「連線成功」四個字。', 30);
    toast('✦ ' + response.substring(0, 30));
  } catch (e) {
    toast('連線失敗:' + e.message);
  }
}

/* ============================================
   AI 功能 1:評語生成
============================================ */
function renderAiCommentStudentList() {
  const select = document.getElementById('aiCommentStudent');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">— 選擇學生 —</option>' +
    state.students.map(s => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.name}</option>`).join('');
  renderAiCommentContext();
}

function renderAiCommentContext() {
  const id = document.getElementById('aiCommentStudent').value;
  const box = document.getElementById('aiCommentContext');
  if (!id) { box.innerHTML = ''; return; }
  
  const s = getStudent(id);
  if (!s) { box.innerHTML = ''; return; }
  
  const stage = s.pet ? PetEngine.getStage(s.totalPoints) : 0;
  const species = s.pet ? PET_SPECIES.find(p => p.id === s.pet) : null;
  
  // 統計近 14 天積分
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = (s.history || []).filter(h => h.time >= cutoff);
  const recentPts = recent.reduce((sum, h) => sum + h.points, 0);
  const recentReasons = {};
  recent.forEach(h => {
    if (!recentReasons[h.reason]) recentReasons[h.reason] = { count: 0, pts: 0 };
    recentReasons[h.reason].count++;
    recentReasons[h.reason].pts += h.points;
  });
  const topReasons = Object.entries(recentReasons).sort((a,b) => b[1].count - a[1].count).slice(0, 3);
  
  box.innerHTML = `
    <div class="ai-context-card">
      <strong>系統將自動帶入這些資料給 AI:</strong><br>
      ${PetEngine.getIcon(s)} 守護獸:${species ? species.name : '尚未選'} · ${STAGE_NAMES[stage]} · 累積經驗 ${s.totalPoints} 分<br>
      近兩週積分變動:${recentPts > 0 ? '+' : ''}${recentPts} 分 · 共 ${recent.length} 次發分<br>
      ${topReasons.length > 0 ? '主要得分理由:' + topReasons.map(r => r[0] + '(' + r[1].count + '次)').join('、') : ''}
    </div>
  `;
}

async function runAiComment() {
  const id = document.getElementById('aiCommentStudent').value;
  const obs = document.getElementById('aiCommentObservations').value.trim();
  const purpose = document.getElementById('aiCommentPurpose').value;
  const results = document.getElementById('aiCommentResults');
  
  if (!id) { toast('請選擇學生'); return; }
  if (!obs) { toast('請輸入觀察重點'); return; }
  
  const s = getStudent(id);
  if (!s) return;
  
  // 組 context
  const stage = s.pet ? PetEngine.getStage(s.totalPoints) : 0;
  const species = s.pet ? PET_SPECIES.find(p => p.id === s.pet) : null;
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = (s.history || []).filter(h => h.time >= cutoff);
  const recentPts = recent.reduce((sum, h) => sum + h.points, 0);
  
  const purposeMap = {
    parent: '給家長閱讀的聯絡簿評語',
    report: '學期成績單上的正式評語',
    encourage: '寫給學生本人的鼓勵話語'
  };
  
  const systemPrompt = `你是一位資深的台灣國小導師,擅長撰寫溫暖、具體、有教育意義的學生評語。請避免空洞的稱讚詞如「乖巧聽話」「表現良好」,要根據觀察給出具體、有畫面感的描述。語氣溫暖但不肉麻,專業但不冷漠。使用繁體中文。`;
  
  const userPrompt = `請為以下學生撰寫「${purposeMap[purpose]}」,提供三種不同風格的版本。

【學生資料】
姓名:${s.name}
守護獸:${species ? species.name : '尚未選擇'}(已養成至「${STAGE_NAMES[stage]}」階段)
近兩週積分變動:${recentPts > 0 ? '+' : ''}${recentPts} 分,共獲得 ${recent.length} 次發分

【老師的觀察重點】
${obs}

請輸出三個版本,格式如下(每版約 80-150 字):

【版本一:溫暖具體型】
(評語內容)

【版本二:著重成長型】
(評語內容)

【版本三:精簡專業型】
(評語內容)

注意:三個版本要有明顯不同的切入角度,不只是換詞而已。`;
  
  results.innerHTML = '';
  results.classList.add('active');
  
  try {
    const text = await runWithAiHUD('評語生成', s.name, 15000,
      signal => AI.call(systemPrompt, userPrompt, 2500, signal));
    if (text === null) { results.classList.remove('active'); return; }
    displayAiResults(results, text);
  } catch (e) {
    results.innerHTML = `<div class="ai-error">❌ ${e.message}</div>`;
  }
}

/* ============================================
   AI 功能 2:訊息潤飾
============================================ */
async function runAiPolish() {
  const draft = document.getElementById('aiPolishInput').value.trim();
  const audience = document.getElementById('aiPolishAudience').value;
  const context = document.getElementById('aiPolishContext').value;
  const results = document.getElementById('aiPolishResults');
  
  if (!draft) { toast('請輸入訊息草稿'); return; }
  
  const audienceMap = {
    parent: '學生家長', student: '學生本人', colleague: '同事老師', principal: '校長或主任'
  };
  const contextMap = {
    report: '日常聯絡與通知',
    concern: '關心或提醒問題',
    praise: '表揚或好消息',
    apology: '致歉或解釋誤會',
    refuse: '委婉拒絕'
  };
  
  const systemPrompt = `你是一位專業的台灣國小教師溝通顧問,擅長將老師的原始想法潤飾成專業、有溫度、符合教育情境的訊息。要注意:
- 收件人是${audienceMap[audience]},情境是「${contextMap[context]}」
- 保留老師想表達的核心訊息,不改變立場
- 用詞溫和但不軟弱,專業但不冷漠
- 避免敬語過度堆砌,要自然
- 使用繁體中文,符合台灣教育界用語習慣`;
  
  const userPrompt = `請將以下老師的原始訊息草稿,潤飾成可直接寄出的版本,提供三種不同語氣的選擇。

【原始草稿】
${draft}

請輸出三個版本,格式如下:

【版本一:溫和關懷型】
(訊息全文,可直接複製寄出)

【版本二:中性專業型】
(訊息全文)

【版本三:堅定明確型】
(訊息全文)

三個版本應該有明顯的語氣差異,讓老師根據情境選用。`;
  
  results.innerHTML = '';
  results.classList.add('active');
  
  try {
    const text = await runWithAiHUD('訊息潤飾', '', 15000,
      signal => AI.call(systemPrompt, userPrompt, 2500, signal));
    if (text === null) { results.classList.remove('active'); return; }
    displayAiResults(results, text);
  } catch (e) {
    results.innerHTML = `<div class="ai-error">❌ ${e.message}</div>`;
  }
}

/* ============================================
   AI 功能 3:行為觀察分析
============================================ */
function renderAiAnalyzeStudentList() {
  const select = document.getElementById('aiAnalyzeStudent');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">— 選擇學生 —</option>' +
    state.students.map(s => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.name}</option>`).join('');
  renderAiAnalyzeContext();
}

function renderAiAnalyzeContext() {
  const id = document.getElementById('aiAnalyzeStudent').value;
  const box = document.getElementById('aiAnalyzeContext');
  if (!id) { box.innerHTML = ''; return; }
  
  const s = getStudent(id);
  if (!s) return;
  
  const totalHistory = (s.history || []).length;
  box.innerHTML = `
    <div class="ai-context-card">
      <strong>${s.name}</strong> 目前累積 <strong>${totalHistory}</strong> 筆積分紀錄。<br>
      系統會將完整資料(含時間戳記)交給 AI 分析行為模式、變化趨勢與潛在隱憂。
    </div>
  `;
}

async function runAiAnalyze() {
  const id = document.getElementById('aiAnalyzeStudent').value;
  const range = document.getElementById('aiAnalyzeRange').value;
  const extra = document.getElementById('aiAnalyzeExtra').value.trim();
  const results = document.getElementById('aiAnalyzeResults');
  
  if (!id) { toast('請選擇學生'); return; }
  
  const s = getStudent(id);
  if (!s) return;
  
  // 計算範圍
  let cutoff = 0;
  if (range !== 'all') {
    cutoff = Date.now() - parseInt(range) * 24 * 60 * 60 * 1000;
  }
  
  // 蒐集資料
  const history = (s.history || []).filter(h => h.time >= cutoff).sort((a,b) => a.time - b.time);
  const dailyPoints = {};
  history.forEach(h => {
    const day = new Date(h.time).toISOString().slice(0, 10);
    if (!dailyPoints[day]) dailyPoints[day] = { pts: 0, items: [] };
    dailyPoints[day].pts += h.points;
    dailyPoints[day].items.push(`${h.points > 0 ? '+' : ''}${h.points}(${h.reason})`);
  });
  
  // 出席
  const attendance = [];
  Object.entries(state.attendance).forEach(([date, day]) => {
    if (day[s.id] && new Date(date).getTime() >= cutoff) {
      attendance.push(`${date}:${day[s.id]}`);
    }
  });
  
  // 作業
  const homeworkData = [];
  state.homework.forEach(hw => {
    if (hw.submissions && hw.submissions[s.id]) {
      homeworkData.push(`${hw.name}(${hw.dueDate}):${hw.submissions[s.id].status}`);
    }
  });
  
  // 商店
  const shopData = state.shopHistory
    .filter(h => h.studentId === s.id && h.time >= cutoff)
    .map(h => {
      const item = findShopItem(h.itemId);
      return item ? item.name : h.itemId;
    });
  
  const stage = s.pet ? PetEngine.getStage(s.totalPoints) : 0;
  const species = s.pet ? PET_SPECIES.find(p => p.id === s.pet) : null;
  const health = PetEngine.getHealth(s);
  
  const systemPrompt = `你是一位資深的教育心理諮商師與班級輔導經驗豐富的資深教師。請根據老師提供的學生資料,做出深入的行為模式分析。要點:
- 找出資料中隱含的模式(週期性、趨勢、異常)
- 提出可能的成因假設(不要過度斷言)
- 給出具體可行的教學/輔導建議
- 標出值得關注的警訊
- 使用繁體中文,保持專業與同理`;
  
  const userPrompt = `請對以下學生進行行為觀察分析,從積分紀錄、出席、作業繳交、商店消費等行為資料,找出值得老師注意的模式與建議。

【學生資料】
姓名:${s.name}
守護獸:${species ? species.name : '尚未選'} · ${STAGE_NAMES[stage]} · 累積經驗 ${s.totalPoints} 分
當前健康狀態:${health === 'healthy' ? '健康' : health === 'mild' ? '微恙(3 天未獲積分)' : '生病(7 天以上未獲積分)'}

【積分歷史紀錄】(按時間排序)
${history.length > 0 ? history.map(h => {
  const d = new Date(h.time).toISOString().slice(0, 10);
  return `${d}: ${h.points > 0 ? '+' : ''}${h.points}(${h.reason})`;
}).join('\n') : '此期間無積分紀錄'}

【每日累積】
${Object.entries(dailyPoints).map(([d, v]) => `${d}: 共 ${v.pts > 0 ? '+' : ''}${v.pts} 分`).join('\n') || '無'}

【出席紀錄】
${attendance.length > 0 ? attendance.join('\n') : '無紀錄'}

【作業繳交】
${homeworkData.length > 0 ? homeworkData.join('\n') : '無紀錄'}

【商店消費】
${shopData.length > 0 ? shopData.join('、') : '無'}

${extra ? '【老師補充說明】\n' + extra : ''}

請輸出以下格式的分析報告:

【觀察到的模式】
(列出 3-5 個明確的行為模式,每點 1-2 行,要具體不要空泛)

【可能的成因假設】
(提出 2-3 個可能的成因,保持假設語氣)

【需要關注的訊號】
(若有警訊請列出,沒有則寫「目前未見明顯警訊」)

【建議的後續行動】
(給老師 3-5 條具體可行的建議)`;
  
  results.innerHTML = '';
  results.classList.add('active');

  try {
    // 分析要讀整段歷程,是三個功能裡最久的,預估抓 25 秒
    const text = await runWithAiHUD('行為觀察分析', s.name, 25000,
      signal => AI.call(systemPrompt, userPrompt, 3000, signal));
    if (text === null) { results.classList.remove('active'); return; }   // 使用者取消
    displayAiResults(results, text, true);
  } catch (e) {
    results.innerHTML = `<div class="ai-error">❌ ${e.message}</div>`;
  }
}

/* ============================================
   AI 結果顯示與複製
============================================ */
function displayAiResults(container, text, single = false) {
  if (single) {
    container.innerHTML = `
      <div class="ai-result-card">
        <div class="ai-result-header">
          <div class="ai-result-tag">分析結果</div>
          <div class="ai-result-actions">
            <button class="btn btn-ghost btn-small" onclick="copyAiResult(this)">複製</button>
          </div>
        </div>
        <div class="ai-result-body">${text}</div>
      </div>
    `;
    return;
  }
  
  // 嘗試解析三個版本
  const sections = text.split(/【版本[一二三]：?([^】]*)】/);
  const parts = [];
  // 解析模式比較曖昧,先用簡單的字符串分割
  const m = text.match(/【版本一[^】]*】([\s\S]*?)【版本二[^】]*】([\s\S]*?)【版本三[^】]*】([\s\S]*)/);
  
  if (m) {
    const titles = ['溫和關懷 / 溫暖具體', '中性專業 / 著重成長', '堅定明確 / 精簡專業'];
    const bodies = [m[1].trim(), m[2].trim(), m[3].trim()];
    container.innerHTML = bodies.map((body, i) => `
      <div class="ai-result-card">
        <div class="ai-result-header">
          <div class="ai-result-tag">版本 ${['一','二','三'][i]} · ${titles[i]}</div>
          <div class="ai-result-actions">
            <button class="btn btn-ghost btn-small" onclick="copyAiResult(this)">複製</button>
          </div>
        </div>
        <div class="ai-result-body">${body}</div>
      </div>
    `).join('');
  } else {
    // 無法解析,直接顯示原文
    container.innerHTML = `
      <div class="ai-result-card">
        <div class="ai-result-header">
          <div class="ai-result-tag">AI 回應</div>
          <div class="ai-result-actions">
            <button class="btn btn-ghost btn-small" onclick="copyAiResult(this)">複製</button>
          </div>
        </div>
        <div class="ai-result-body">${text}</div>
      </div>
    `;
  }
}

function copyAiResult(btn) {
  const card = btn.closest('.ai-result-card');
  const body = card.querySelector('.ai-result-body').textContent;
  navigator.clipboard?.writeText(body).then(
    () => { toast('已複製到剪貼簿'); },
    () => { toast('複製失敗,請手動選取'); }
  );
}
