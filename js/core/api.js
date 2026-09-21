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
    let lastTokenAt = Date.now();
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + opts.apiKey,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    }).then(function (resp) {
      if (!resp.ok) {
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
          if (r.done) return full;
          lastTokenAt = Date.now();
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
          // 超过 60 秒没有任何 token 视为卡死
          if (Date.now() - lastTokenAt > 60000) {
            const err = new Error('响应超时');
            err.timeout = true;
            throw err;
          }
          return pump();
        });
      }
      function finish() { return full; }
      return pump();
    });
  };

  G.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
