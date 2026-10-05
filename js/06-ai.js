/* ============================================
   AI 模組 - 連接 Anthropic API
============================================ */
const AI = {
  KEY_STORAGE: 'guardian-claude-api-key',
  MODEL_STORAGE: 'guardian-claude-model',
  DEFAULT_MODEL: 'claude-sonnet-5',
  
  hasKey() { return !!localStorage.getItem(this.KEY_STORAGE); },
  getKey() { return localStorage.getItem(this.KEY_STORAGE) || ''; },
  setKey(key) { localStorage.setItem(this.KEY_STORAGE, key.trim()); },
  clearKey() { localStorage.removeItem(this.KEY_STORAGE); },
  
  getModel() { return localStorage.getItem(this.MODEL_STORAGE) || this.DEFAULT_MODEL; },
  setModel(model) { localStorage.setItem(this.MODEL_STORAGE, model); },
  
  /* signal 讓呼叫端可以中途取消 —— 等 30 秒卻不能喊停是很糟的體驗 */
  async call(systemPrompt, userPrompt, maxTokens = 2000, signal) {
    const key = this.getKey();
    if (!key) throw new Error('NO_KEY');
    
    const body = {
      model: this.getModel(),
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userPrompt }]
    };
    if (systemPrompt) body.system = systemPrompt;
    
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body),
      signal
    });
    
    if (!res.ok) {
      let errMsg = '請求失敗 (' + res.status + ')';
      try {
        const err = await res.json();
        errMsg = err.error?.message || errMsg;
      } catch(e) {}
      throw new Error(errMsg);
    }
    
    const data = await res.json();
    return data.content?.[0]?.text || '';
  }
};
