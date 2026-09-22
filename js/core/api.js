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

  /* TTS：OpenAI 兼容 /audio/speech（语音回复用）。失败返回 {err: '原因'}，绝不抛错影响聊天 */
  api.tts = function (opts) {
    const base = api.normalizeBase(opts.baseURL);
    if (!base || !opts.apiKey) return Promise.resolve({ err: '没填 Key' });
    const vm = (opts.voice && opts.voice.indexOf(':') >= 0) ? opts.voice.split(':')[0] : null;
    const model = vm || opts.model;
    return fetch(base + '/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + opts.apiKey },
      body: JSON.stringify({
        model: model,
        input: (opts.instruction && /CosyVoice/i.test(model)) ? (String(opts.instruction) + '<|endofprompt|>') + String(opts.text || '').slice(0, 500) : String(opts.text || '').slice(0, 500),
        voice: opts.voice,
        response_format: 'mp3',
      }),
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          let detail = '';
          try { detail = (JSON.parse(t).message || JSON.parse(t).error || ''); } catch (e) { detail = t.slice(0, 120); }
          return { err: 'HTTP ' + r.status + ' ' + detail };
        });
      }
      return r.blob().then(function (b) { return { blob: b }; });
    }).catch(function (e) { return { err: String(e && e.message || e).slice(0, 120) }; });
  };

  /* 火山豆包语音 V3（语音技术产品线，浏览器直连跨域已实测放行）：
   * X-Api-Key 鉴权；返回 NDJSON 流（每行 JSON，含 base64 音频段），组装成 mp3 Blob。
   * voice 传原生 voice_type（如 zh_male_wenrouxuezhang_uranus_bigtts）。 */
  api.ttsVolc = function (opts) {
    if (!opts.apiKey) return Promise.resolve({ err: '没填火山语音 Key' });
    return fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': opts.apiKey,
        'X-Api-Resource-Id': opts.resourceId || 'seed-tts-2.0',
      },
      body: JSON.stringify({
        user: { uid: 'schat-web-app' },
        req_params: {
          text: String(opts.text || '').slice(0, 900),
          speaker: opts.voice,
          audio_params: { format: 'mp3', sample_rate: 24000 },
        },
      }),
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          let d = '';
          try { const j = JSON.parse(t); d = (j.header && j.header.message) || j.message || ''; } catch (e) { d = t.slice(0, 100); }
          return { err: 'HTTP ' + r.status + ' ' + d };
        });
      }
      return r.text().then(function (txt) {
        const parts = [];
        let errMsg = '';
        txt.split(/\r?\n/).forEach(function (line) {
          line = line.trim();
          if (!line) return;
          let j = null;
          try { j = JSON.parse(line); } catch (e) { return; }
          const h = j.header || {};
          const code = (j.code != null ? j.code : h.code);
          if (code === 20000000 || code === 20000001) return; // 合成结束标志
          if (code != null && code !== 0) { errMsg = h.message || j.message || ('code ' + code); return; }
          const data = (j.payload && j.payload.data) || j.data;
          if (typeof data === 'string' && data) parts.push(data);
        });
        if (errMsg) return { err: '火山语音：' + errMsg };
        if (!parts.length) return { err: '火山语音返回空音频' };
        let bin;
        try { bin = atob(parts.join('')); } catch (e) { return { err: '音频解码失败' }; }
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { blob: new Blob([bytes], { type: 'audio/mpeg' }) };
      });
    }).catch(function (e) { return { err: String(e && e.message || e).slice(0, 120) }; });
  };

  G.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
