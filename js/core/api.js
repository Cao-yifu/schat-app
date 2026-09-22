/* Schat v2 —— OpenAI 兼容接口客户端（SSE 流式 + 中止）
 * 直连用户自填的 baseURL，请求只发往该地址，绝不经过任何第三方。
 * baseURL 兼容两种写法：https://api.deepseek.com 或 https://api.deepseek.com/v1
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const api = {};

  api.normalizeBase = function (base) {
    base = (base || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    if (!/\/v\d+(\/)?$/.test(base)) base += '/v1';
    return base;
  };

  /* 发起流式对话。
   * opts: { baseURL, apiKey, model, temperature, messages, maxTokens, signal, onToken }
   * 返回 Promise<string>（完整文本）；onToken 每收到一个增量回调。 */
  api.chat = function (opts) {
    const base = api.normalizeBase(opts.baseURL);
    const url = base + '/chat/completions';
    const body = {
      model: opts.model,
      messages: opts.messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.8,
      stream: true,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;

    let full = '';
    /* 停滞看门狗：60 秒没有任何数据（含响应头、含 token）就中止连接。
     * 旧实现只在收到数据块时检查时间戳，连接彻底挂起时永远不会触发。 */
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl && opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    let stallTimer = null, stalled = false;
    function armStall() {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function () { stalled = true; if (ctrl) ctrl.abort(); }, 60000);
    }
    function clearStall() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }
    armStall();

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + opts.apiKey,
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : opts.signal,
    }).catch(function (err) {
      if (stalled) { const e = new Error('响应超时'); e.timeout = true; throw e; }
      throw err;
    }).then(function (resp) {
      armStall(); // 响应头已到，给首个 token 重新计 60 秒
      if (!resp.ok) {
        clearStall();
        return resp.text().then(function (t) {
          let msg = 'HTTP ' + resp.status;
          try { msg = JSON.parse(t).error.message || msg; } catch (e) { if (t) msg = t.slice(0, 200); }
          const err = new Error(msg);
          err.status = resp.status;
          throw err;
        });
      }
      if (!resp.body || !resp.body.getReader) {
        // 极个别环境没有流式 body：整体读
        return resp.text().then(function (t) {
          clearStall();
          const m = t.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (m) { full = JSON.parse('"' + m[1] + '"'); if (opts.onToken) opts.onToken(full); }
          return full;
        });
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { clearStall(); return full; }
          armStall();
          buf += dec.decode(r.value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const s = line.trim();
            if (!s.startsWith('data:')) continue;
            const payload = s.slice(5).trim();
            if (payload === '[DONE]') return finish();
            try {
              const j = JSON.parse(payload);
              const delta = j.choices && j.choices[0] && j.choices[0].delta;
              const piece = delta && delta.content;
              if (piece) { full += piece; if (opts.onToken) opts.onToken(piece); }
            } catch (e) { /* 半包 JSON，忽略 */ }
          }
          return pump();
        });
      }
      function finish() { clearStall(); return full; }
      return pump();
    });
  };

  /* TTS：OpenAI 兼容 /audio/speech（语音回复用）。失败返回 null，绝不抛错影响聊天 */
  api.tts = function (opts) {
    const base = api.normalizeBase(opts.baseURL);
    if (!base || !opts.apiKey) return Promise.resolve(null);
    return fetch(base + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + opts.apiKey },
      body: JSON.stringify({
        model: opts.model,
        input: String(opts.text || '').slice(0, 500),
        voice: opts.voice,
        response_format: 'mp3',
      }),
    }).then(function (r) {
      if (!r.ok) throw new Error('tts ' + r.status);
      return r.blob();
    }).catch(function () { return null; });
  };

  G.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
