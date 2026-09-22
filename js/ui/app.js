/* Schat v2 —— UI 层：列表页 / 聊天页 / 设置页 / 人设页 / 帮助
 * 与引擎通过 engine.hooks 单向通信；所有数据仍从 store 读写，UI 不直接调 API。
 */
(function () {
  const G = window.SCHAT = window.SCHAT || {};
  const util = G.util, store = G.store, engine = G.engine, sync = G.sync, tp = G.timeparse, api = G.api;

  const $ = function (id) { return document.getElementById(id); };
  const MY_AVATAR = 'data:image/jpeg;base64,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'; // 我的头像
  const ui = G.ui = {};
  let currentLover = null;
  let quoteTarget = null;
  let lastRenderKey = ''; // 避免重复渲染

  /* ---------- 基础 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  ui.toast = toast;

  function avatarHtml(p, cls) {
    // 头像只认 data:image，防止脏数据走 src 属性注入
    if (p.avatar && p.avatar.indexOf('data:image/') === 0) return '<div class="' + cls + '"><img src="' + p.avatar + '" alt=""></div>';
    return '<div class="' + cls + '" style="background:' + (p.avatarColor || '#8AA88F') + '">' + esc(p.name[0]) + '</div>';
  }

  function showPage(id) {
    const pages = document.querySelectorAll('.page');
    for (const pg of pages) pg.classList.remove('active');
    $(id).classList.add('active');
  }

  function sheet(id, show) {
    $(id).classList.toggle('show', show);
    // 遮罩配对：sheetMsg -> maskSheet, sheetChat -> maskChat
    const mask = id === 'sheetMsg' ? $('maskSheet') : id === 'sheetChat' ? $('maskChat') : null;
    if (mask) mask.classList.toggle('show', show);
  }

  /* ---------- 联系人列表 ---------- */
  function previewOf(msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'sys') continue;
      if (m.type === 'image') return '[图片]';
      return (m.text || '').slice(0, 40);
    }
    return '开始聊天吧';
  }

  function renderList() {
    const list = sync.list();
    const box = $('homeList');
    $('verLine').textContent = 'Schat v2 · 人设版本 v' + (window.SCHAT_PERSONAS_VER || '?') + ' · 数据只存在这台设备上';
    box.innerHTML = '';
    // 并发读取每个角色的最新消息，全部就绪后按列表顺序一次性插入（顺序稳定且首屏更快）
    return Promise.all(list.map(function (item) {
      return Promise.all([store.msgs(item.id), sync.unread(item.id)]).then(function (r) {
        const msgs = r[0], unread = r[1] || 0;
        const last = msgs[msgs.length - 1];
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML =
          avatarHtml(item, 'avatar') +
          '<div class="mid"><div class="nm">' + esc(item.nickname || item.name) + '</div>' +
          '<div class="pv">' + esc(previewOf(msgs)) + '</div></div>' +
          '<div class="tm">' + (last ? esc(util.listTime(last.ts)) : '') + '</div>';
        const dot = document.createElement('span');
        dot.className = 'udot';
        dot.style.display = unread > 0 ? 'block' : 'none';
        row.querySelector('.avatar').appendChild(dot);
        row.addEventListener('click', function () { openChat(item.id); });
        return row;
      });
    })).then(function (rows) {
      for (const row of rows) box.appendChild(row);
    });
  }
  /* 流式打字期间每 100ms 一次 onMsg，列表重渲染必须防抖，否则每 tick 全员读库 */
  const refreshListSoon = util.debounce(function () { renderList(); }, 300);
  ui.refreshList = function () { renderList(); };

  /* ---------- 聊天页 ---------- */
  function scrollBottom(force) {
    const sc = $('chatScroll');
    const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
    if (force || nearBottom) sc.scrollTop = sc.scrollHeight;
  }

  function bubbleHtml(msg, persona) {
    if (msg.role === 'sys') {
      return '<div class="sysline">' + esc(msg.text) + '</div>';
    }
    const me = msg.role === 'me';
    let inner = '';
    if (msg.quote && msg.quote.text) {
      inner += '<div class="qq">' + esc((msg.quote.who === 'me' ? '我：' : (persona.nickname || persona.name) + '：') + msg.quote.text.slice(0, 80)) + '</div>';
    }
    if (msg.type === 'image') {
      // 照片只渲染本地 dataURL，脏 src 走文本兜底（防属性注入）
      inner += (msg.src && msg.src.indexOf('data:image/') === 0)
        ? '<img class="ph" src="' + msg.src + '" alt="照片">'
        : esc('[图片]');
    } else {
      inner += esc(msg.text || '');
    }
    if (msg.audioUrl) {
      inner += '<audio controls preload="none" src="' + msg.audioUrl + '" style="max-width:230px;height:32px;margin-top:6px"></audio>';
    }
    const ava = me
      ? '<div class="ava"><img src="' + MY_AVATAR + '" alt=""></div>'
      : avatarHtml(persona, 'ava');
    return '<div class="msg ' + (me ? 'me' : 'you') + '" data-id="' + msg.id + '">' + ava +
      '<div class="wrap"><div class="bub">' + inner + '</div></div></div>';
  }

  let renderedMsgs = [];
  function renderChat(persona) {
    return store.msgs(persona.id).then(function (msgs) {
      renderedMsgs = msgs;
      const box = $('chatScroll');
      let html = '';
      let lastTs = 0;
      for (const m of msgs) {
        if (m.ts - lastTs > 5 * 60 * 1000) {
          html += '<div class="dayline"><span>' + esc(util.chatTime(m.ts)) + '</span></div>';
        }
        html += bubbleHtml(m, persona);
        lastTs = m.ts;
      }
      box.innerHTML = html;
      bindBubbleEvents(box, persona);
      scrollBottom(true);
    });
  }

  function appendMsgDom(persona, msg) {
    const box = $('chatScroll');
    const last = renderedMsgs[renderedMsgs.length - 1];
    if (!last || msg.ts - last.ts > 5 * 60 * 1000) {
      const d = document.createElement('div');
      d.className = 'dayline';
      d.innerHTML = '<span>' + esc(util.chatTime(msg.ts)) + '</span>';
      box.appendChild(d);
    }
    renderedMsgs.push(msg);
    const tmp = document.createElement('div');
    tmp.innerHTML = bubbleHtml(msg, persona);
    const node = tmp.firstChild;
    box.appendChild(node);
    bindBubbleEvents(node, persona, msg);
    scrollBottom(true);
    return node;
  }

  function updateMsgDom(persona, msg) {
    const old = document.querySelector('.msg[data-id="' + msg.id + '"]');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = bubbleHtml(msg, persona);
    const node = tmp.firstChild;
    old.parentNode.replaceChild(node, old);
    bindBubbleEvents(node, persona, msg);
    scrollBottom(false);
  }

  /* 打字中：流式气泡加光标 */
  function showCursor() {
    const cur = document.querySelector('.msg.streaming .cursor');
    if (cur) cur.remove();
    const el = document.querySelector('.msg.streaming .bub');
    if (el) {
      const c = document.createElement('span');
      c.className = 'cursor';
      el.appendChild(c);
      scrollBottom(false);
    }
  }
  function markStreaming(id, on) {
    const el = document.querySelector('.msg[data-id="' + id + '"]');
    if (el) el.classList.toggle('streaming', on);
  }

  let typingRow = null;
  /* 只撤掉输入指示行和头部提示；不动发送按钮（流式进行中仍需显示"停止"） */
  function hideTypingIndicator() {
    if (typingRow) { typingRow.remove(); typingRow = null; }
    $('chatSub').textContent = '';
  }
  function showTyping(on) {
    if (on) {
      hideTypingIndicator();
      $('chatSub').textContent = '对方正在输入…';
      const btn = $('sendBtn');
      btn.textContent = '停止';
      btn.classList.add('stop');
    } else {
      hideTypingIndicator();
      const btn = $('sendBtn');
      btn.textContent = '发送';
      btn.classList.remove('stop');
    }
    const box = $('chatScroll');
    if (on) {
      if (!typingRow) {
        typingRow = document.createElement('div');
        typingRow.className = 'msg you typingrow';
        typingRow.innerHTML = avatarHtml(sync.get(currentLover), 'ava') +
          '<div class="wrap"><div class="bub"><span class="dots"><span></span><span></span><span></span></span></div></div>';
        box.appendChild(typingRow);
        scrollBottom(true);
      }
    }
  }

  /* 长按/右键气泡 → 引用、复制 */
  let pressTimer = null, pressMsg = null;
  function bindBubbleEvents(root, persona, knownMsg) {
    const nodes = root.querySelectorAll ? root.querySelectorAll('.msg') : [];
    const list = nodes.length ? nodes : (root.classList && root.classList.contains('msg') ? [root] : []);
    for (const node of list) {
      const id = node.getAttribute('data-id');
      const msg = knownMsg && knownMsg.id === id ? knownMsg : renderedMsgs.find(function (m) { return m.id === id; });
      if (!msg || msg.role === 'sys') continue;
      node.addEventListener('touchstart', function () {
        pressTimer = setTimeout(function () { pressMsg = msg; sheet('sheetMsg', true); }, 480);
      }, { passive: true });
      node.addEventListener('touchend', function () { clearTimeout(pressTimer); });
      node.addEventListener('touchmove', function () { clearTimeout(pressTimer); });
      node.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        pressMsg = msg;
        sheet('sheetMsg', true);
      });
    }
  }

  function setQuote(msg) {
    quoteTarget = msg;
    const persona = sync.get(currentLover);
    $('quoteText').textContent = (msg.role === 'me' ? '我：' : (persona.nickname || persona.name) + '：') + (msg.type === 'image' ? '[图片]' : msg.text).slice(0, 60);
    $('quoteBar').classList.add('show');
    $('inp').focus();
  }
  function clearQuote() {
    quoteTarget = null;
    $('quoteBar').classList.remove('show');
  }

  function openChat(loverId) {
    const persona = sync.get(loverId);
    if (!persona) return;
    currentLover = loverId;
    engine.activeLover = loverId;
    lastRenderKey = loverId;
    sync.setUnread(loverId, 0);
    $('chatName').textContent = persona.nickname || persona.name;
    showPage('page-chat');
    renderChat(persona).then(function () {
      renderList();
    });
  }
  function closeChat() {
    if (engine.isRunning(currentLover)) { /* 离开不停止，继续生成 */ }
    currentLover = null;
    engine.activeLover = null;
    clearQuote();
    showTyping(false);
    showPage('page-home');
    renderList();
  }
  ui.openChat = openChat;

  function doSend() {
    const inp = $('inp');
    const text = inp.value.trim();
    if (!text || !currentLover) return;
    const q = quoteTarget ? { text: quoteTarget.type === 'image' ? '[图片]' : quoteTarget.text, who: quoteTarget.role } : null;
    clearQuote();
    inp.value = '';
    inp.style.height = 'auto';
    engine.send(currentLover, text, q);
  }

  /* ---------- 云端音色库（试听 = 直接调云接口播放） ---------- */
  /* CosyVoice2-0.5B 实测可用男声（2026-09 用真实 Key 逐一验证；david 与 james 等已淘汰） */
  const CLOUD_VOICES = [
    { id: 'FunAudioLLM/CosyVoice2-0.5B:alex', label: 'Alex · 沉稳青年' },
    { id: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', label: 'Benjamin · 温柔暖男' },
    { id: 'FunAudioLLM/CosyVoice2-0.5B:charles', label: 'Charles · 磁性低沉' },
  ];
  const VOICE_SAMPLE = '是我。想我了吗？今晚想见你。';
  function playCloud(text, voiceId, key, baseURL, model, onErr) {
    if (!key) { if (onErr) onErr('先在上方填语音 Key 才能试听'); return; }
    api.tts({
      baseURL: baseURL,
      apiKey: key,
      model: model || 'FunAudioLLM/CosyVoice2-0.5B',
      voice: voiceId,
      instruction: '用自然放松的日常口语语气说，不要播音腔，像发微信语音一样随意',
      text: text,
    }).then(function (res) {
      if (!res || res.err) { if (onErr) onErr('试听失败：' + (res && res.err ? res.err : '接口无响应')); return; }
      const blob = res.blob;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = function () { URL.revokeObjectURL(url); };
      a.play().catch(function () { /* 自动播放被拦截则无动作 */ });
    });
  }
  function voiceRowsHtml() {
    /* 每角色一个音色下拉（云端男声库） */
    let h = '';
    sync.list().forEach(function (p) {
      let opts = '';
      CLOUD_VOICES.forEach(function (v) {
        opts += '<option value="' + esc(v.id) + '">' + esc(v.label) + '</option>';
      });
      h += '<div class="fld"><label>' + esc(p.name) + '</label>' +
        '<select id="vsel_' + p.id + '" style="max-width:52%">' + opts + '</select></div>';
    });
    /* 音色库试听列表：一行一个男声，点试听直接云端合成播放 */
    CLOUD_VOICES.forEach(function (v, i) {
      h += '<div class="fld"><label>' + esc(v.label) + '</label>' +
        '<button id="vtry_' + i + '" style="margin-left:6px;padding:4px 12px;border-radius:12px;border:1px solid #d8d8d8;background:#fff;font-size:12px">▶ 试听</button></div>';
    });
    return h;
  }

  /* 引擎挂钩 */
  engine.hooks.onMsg = function (loverId, msg, kind) {
    if (loverId === currentLover && lastRenderKey === loverId) {
      const persona = sync.get(loverId);
      if (document.getElementById('page-chat').classList.contains('active')) {
        if (kind === 'append') { hideTypingIndicator(); appendMsgDom(persona, msg); }
        else updateMsgDom(persona, msg);
      }
      scrollBottom(false);
    }
    refreshListSoon(); // 防抖：打字 tick 太密，逐条渲染列表会每 100ms 全员读库
  };
  engine.hooks.onTyping = function (loverId, on) {
    if (loverId === currentLover) showTyping(on);
  };
  engine.hooks.onSys = function (loverId, text) {
    toast(text);
    if (loverId !== currentLover) renderList();
  };

  /* ---------- 聊天页事件 ---------- */
  function bindChatEvents() {
    $('chatBackBtn').addEventListener('click', closeChat);
    $('sendBtn').addEventListener('click', function () {
      if (engine.isRunning(currentLover)) engine.stop(currentLover);
      else doSend();
    });
    const inp = $('inp');
    inp.addEventListener('input', function () {
      inp.style.height = 'auto';
      inp.style.height = Math.min(96, inp.scrollHeight) + 'px';
    });
    inp.addEventListener('keydown', function (e) {
      // 回车即发送（含手机虚拟键盘），Shift+Enter 换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    $('quoteClose').addEventListener('click', clearQuote);
    $('maskSheet').addEventListener('click', function () { sheet('sheetMsg', false); });
    $('siQuote').addEventListener('click', function () {
      sheet('sheetMsg', false);
      if (pressMsg) setQuote(pressMsg);
    });
    $('siCopy').addEventListener('click', function () {
      sheet('sheetMsg', false);
      if (pressMsg && navigator.clipboard) {
        navigator.clipboard.writeText(pressMsg.type === 'image' ? '[图片]' : pressMsg.text || '').then(function () {
          toast('已复制');
        }, function () { toast('复制失败'); });
      }
    });

    /* ⋯ 菜单 */
    $('chatMenuBtn').addEventListener('click', function () { sheet('sheetChat', true); });
    $('maskChat').addEventListener('click', function () { sheet('sheetChat', false); });
    $('miProfile').addEventListener('click', function () {
      sheet('sheetChat', false);
      openProfile(currentLover);
    });
    $('miClearChat').addEventListener('click', function () {
      sheet('sheetChat', false);
      if (!confirm('清空和 TA 的全部聊天记录？（RS 永久设定保留）')) return;
      store.clearMsgs(currentLover).then(function () {
        return sync.setLS(currentLover, '');
      }).then(function () {
        renderedMsgs = [];
        $('chatScroll').innerHTML = '';
        toast('已清空');
        renderList();
      });
    });
    $('miResetTime').addEventListener('click', function () {
      sheet('sheetChat', false);
      sync.resetOffset(currentLover).then(function () { toast('时间快进已重置'); });
    });
    $('miDelete').addEventListener('click', function () {
      sheet('sheetChat', false);
      const persona = sync.get(currentLover);
      if (!confirm('删除「' + (persona.nickname || persona.name) + '」？删除后不会再出现在列表里（聊天记录保留在本地）。')) return;
      sync.remove(currentLover).then(function () {
        closeChat();
        toast('已删除；更新版本也不会复活这个角色');
      });
    });
  }

  /* ---------- 人设详情页 ---------- */
  function openProfile(loverId) {
    const p = sync.get(loverId);
    if (!p) return;
    $('profileName').textContent = p.nickname || p.name;
    const bd = $('profileBody');
    let html = '<div class="profile">' +
      (p.avatar ? '<div class="bava"><img src="' + p.avatar + '"></div>' : '<div class="bava" style="background:' + p.avatarColor + '">' + esc(p.name[0]) + '</div>') +
      '<div class="pname">' + esc(p.name) + '</div>' +
      '<div class="pid2">' + esc((p.card && (p.card['身份'] || p.card.job)) || '') + '</div></div>';

    html += '<div class="card"><div class="ct">档案</div><div class="cb">';
    if (p.card) for (const k of Object.keys(p.card)) {
      html += '<div class="kvrow"><div class="k">' + esc(k) + '</div><div class="v">' + esc(p.card[k]) + '</div></div>';
    }
    html += '</div></div>';

    if (p.voice) {
      html += '<div class="card"><div class="ct">声音指纹</div><div class="cb">';
      if (p.voice.dict) html += '<div class="subt">口头禅</div><div class="chips">' + p.voice.dict.map(function (d) { return '<span class="chip">' + esc(d) + '</span>'; }).join('') + '</div>';
      if (p.voice.never) html += '<div class="subt">绝不做</div>' + p.voice.never.map(function (d) { return '<div class="lirow">· ' + esc(d) + '</div>'; }).join('');
      if (p.voice.rhythm) html += '<div class="subt">节奏</div><div class="lirow">' + esc(p.voice.rhythm) + '</div>';
      if (p.voice.thinking) html += '<div class="subt">思维</div><div class="lirow">' + esc(p.voice.thinking) + '</div>';
      if (p.voice.values) html += '<div class="subt">在乎</div>' + p.voice.values.map(function (d) { return '<div class="lirow">· ' + esc(d) + '</div>'; }).join('');
      html += '</div></div>';
    }
    if (p.bio && p.bio.length) {
      html += '<details class="sec"><summary>生平（' + p.bio.length + ' 章）</summary><div class="cb">' +
        p.bio.map(function (b) { return '<div class="biochapter">' + esc(b.t) + '</div><div class="lirow">' + esc(b.c) + '</div>'; }).join('') + '</div></details>';
    }
    if (p.memories && p.memories.length) {
      html += '<details class="sec"><summary>记忆碎片（' + p.memories.length + ' 条）</summary><div class="cb">' +
        p.memories.map(function (m) { return '<div class="lirow">· ' + esc(m) + '</div>'; }).join('') + '</div></details>';
    }
    if (p.shared && p.shared.length) {
      html += '<details class="sec"><summary>你们的共同经历</summary><div class="cb">' +
        p.shared.map(function (m) { return '<div class="lirow">· ' + esc(m) + '</div>'; }).join('') + '</div></details>';
    }
    if (p.sched && p.sched.length) {
      html += '<div class="card"><div class="ct">24 小时作息</div><div class="cb">' +
        p.sched.map(function (s) {
          const f = function (x) { const h = Math.floor(x), m = Math.round((x - h) * 60); return util.p2(h) + ':' + util.p2(m); };
          return '<div class="kvrow"><div class="k">' + f(s.h0) + '-' + f(s.h1) + '</div><div class="v">' + esc(s.a) + '</div></div>';
        }).join('') + '</div></div>';
    }

    html += '<div class="card"><div class="ct">用户设定 <span class="mini" id="addRsBtn">＋ 手动加 RS</span></div><div class="cb" id="rsListBox"><div class="lirow">加载中…</div></div></div>';
    html += '<div class="hint">在聊天里发 <span class="kbd">RS 内容</span> 永久写入设定、<span class="kbd">LS 内容</span> 本次会话生效、<span class="kbd">【3小时后】</span> 快进时间。TA 说过的时间约定会被自动记住并在到期时提醒兑现。</div>';
    bd.innerHTML = html;

    sync.rs(p.id).then(function (rs) {
      const box = $('rsListBox');
      box.innerHTML = rs.length
        ? rs.map(function (r, i) {
            return '<div class="kvrow"><div class="v">· ' + esc(r) + '</div><div class="k" style="width:auto;cursor:pointer;color:var(--red)" data-rsi="' + i + '">删除</div></div>';
          }).join('')
        : '<div class="lirow">还没有永久设定</div>';
      box.querySelectorAll('[data-rsi]').forEach(function (el) {
        el.addEventListener('click', function () {
          const i = Number(el.getAttribute('data-rsi'));
          rs.splice(i, 1);
          sync.clearRS(p.id).then(function () {
            let q = Promise.resolve();
            for (const r of rs) q = q.then(function () { return sync.addRS(p.id, r); });
            return q;
          }).then(openProfile.bind(null, p.id));
        });
      });
    });
    $('addRsBtn').addEventListener('click', function () {
      const v = prompt('输入一条永久设定（等同聊天里发 RS+内容）：');
      if (v && v.trim()) sync.addRS(p.id, v.trim()).then(function () { openProfile(p.id); toast('已写入'); });
    });

    showPage('page-profile');
  }

  /* ---------- 设置页 ---------- */
  function buildSettings() {
    engine.getSettings().then(function (st) {
      const bd = $('setBody');
      bd.innerHTML =
        '<div class="card"><div class="ct">AI 接口（OpenAI 兼容，只发到你填的地址）</div><div class="cb">' +
        fld('接口地址 baseURL', 'setBase', st.baseURL, 'https://api.deepseek.com ，兼容 MiniMax / GLM / Kimi 等，可带或不带 /v1') +
        fld('API Key', 'setKey', st.apiKey, '只存在这台设备上，绝不外发', 'password') +
        fld('模型 model', 'setModel', st.model, 'DeepSeek 默认 deepseek-chat') +
        fld('温度 temperature', 'setTemp', st.temperature, '0~1.5，越小越稳') +
        '</div></div>' +

        '<div class="card"><div class="ct">语音（云端音色 · 明确指令触发 · 每次最多3条）</div><div class="cb">' +
        switchRow('ttsOn', '语音回复', '仅明确指令触发（用语音回我 / 想听你声音），一次最多 3 条，用尽自动停', st.ttsOn !== false) +
        fld('语音 Key', 'setTtsKey', st.ttsKey, '硅基流动 siliconflow.cn 免费注册即送额度；CosyVoice2-0.5B 是免费模型（有频控），试听与语音≈0成本', 'password') +
        fld('语音接口地址', 'setTtsBase', st.ttsBaseURL, 'OpenAI /audio/speech 兼容，默认 https://api.siliconflow.cn/v1') +
        fld('语音模型', 'setTtsModel', st.ttsModel, '默认 FunAudioLLM/CosyVoice2-0.5B（中文超自然）') +
        '<div style="font-size:12px;color:#8a8a8a;margin:4px 0">每个角色绑定一个男声，下方音色库点▶试听在线合成。</div>' +
        voiceRowsHtml() +
        '</div></div>' +

        '<div class="card"><div class="ct">回复性格</div><div class="cb">' +
        fld('最长回复字数（硬截断）', 'setMax', st.maxChars, '默认 400；平时 TA 只回 1-2 句，只有你要细节才写长') +
        fld('打字速度（字/秒）', 'setCps', st.cps, '默认 10') +
        switchRow('followUp', '30 秒追问', '你 30 秒没回，TA 按人设追问一条（只一条）', st.followUp) +
        switchRow('lifeGreet', '日常主动问候', '隔一两天，TA 按作息自己发来消息（如问你在干嘛）', st.lifeGreet) +
        fld('追问间隔（秒）', 'setFollowSec', st.followUpSec, '默认 30') +
        switchRow('photos', '生活照', 'TA 偶尔发生活照（免费图库，发出即转存本地）', st.photos) +
        switchRow('intimLib', '亲密素材参考', '亲密场景给 AI 提供本地话术作参考（回复仍全部由 AI 生成）', st.intimLib) +
        fld('每人保留消息条数', 'setKeep', st.keepN, '默认 300，超出自动裁掉最早的') +
        fld('注入模型的历史条数', 'setHist', st.historyN, '默认 60') +
        '</div></div>' +

        '<div class="card"><div class="ct">数据</div><div class="cb">' +
        '<div class="hint">聊天记录、人设修改、API Key 全部只存在这台设备的浏览器里（IndexedDB）。删除 App 或清掉网站数据即全部消失。</div>' +
        '<button class="rbtn" id="wipeBtn">清空全部数据（不可恢复）</button>' +
        '</div></div>';

      function fld(label, id, val, hint, type) {
        return '<div class="fld"><label>' + label + '</label>' +
          '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(val) + '">' +
          (hint ? '<div class="val">' + hint + '</div>' : '') + '</div>';
      }
      function switchRow(key, label, desc, on) {
        return '<div class="optrow"><div><div class="l">' + label + '</div><div class="d">' + desc + '</div></div>' +
          '<label class="switch"><input type="checkbox" id="sw_' + key + '"' + (on ? ' checked' : '') + '><span class="sl"></span></label></div>';
      }

      const num = function (v, d, min, max) {
        const n = parseFloat(v);
        if (isNaN(n)) return d;
        return Math.max(min, Math.min(max, n));
      };
      const save = function (patch, msg) {
        engine.saveSettings(patch).then(function () { if (msg) toast(msg); });
      };
      $('setBase').addEventListener('change', function () { save({ baseURL: this.value.trim() }, '已保存'); });
      $('setKey').addEventListener('change', function () { save({ apiKey: this.value.trim() }, '已保存'); });
      $('setModel').addEventListener('change', function () { save({ model: this.value.trim() }, '已保存'); });
      $('setTemp').addEventListener('change', function () { save({ temperature: num(this.value, 0.8, 0, 1.5) }, '已保存'); });
      $('sw_ttsOn').addEventListener('change', function () { save({ ttsOn: this.checked }, '已保存'); });
      $('setTtsBase').addEventListener('change', function () { save({ ttsBaseURL: this.value.trim() }, '已保存'); });
      $('setTtsKey').addEventListener('change', function () { save({ ttsKey: this.value.trim() }, '已保存'); });
      $('setTtsModel').addEventListener('change', function () { save({ ttsModel: this.value.trim() }, '已保存'); });

      /* 每角色音色绑定（云端男声库）+ 音色库试听 */
      sync.list().forEach(function (p) {
        store.get('voicePref_' + p.id, null).then(function (pref) {
          const sel = $('vsel_' + p.id);
          if (sel && pref && pref.name) sel.value = pref.name;
        });
        $('vsel_' + p.id).addEventListener('change', function () {
          store.set('voicePref_' + p.id, { name: this.value }).then(function () { toast('已保存：' + p.name); });
        });
      });
      CLOUD_VOICES.forEach(function (v, i) {
        $('vtry_' + i).addEventListener('click', function () {
          const key = $('setTtsKey').value.trim();
          const base = $('setTtsBase').value.trim();
          const model = $('setTtsModel').value.trim();
          toast('云端合成中…');
          playCloud(VOICE_SAMPLE, v.id, key, base, model, function (e) { toast(e); });
        });
      });
      $('setMax').addEventListener('change', function () { save({ maxChars: num(this.value, 400, 50, 400) }, '已保存'); });
      $('setCps').addEventListener('change', function () { save({ cps: num(this.value, 10, 2, 40) }, '已保存'); });
      $('setFollowSec').addEventListener('change', function () { save({ followUpSec: num(this.value, 30, 5, 300) }, '已保存'); });
      $('setKeep').addEventListener('change', function () { save({ keepN: num(this.value, 300, 50, 1000) }, '已保存'); });
      $('setHist').addEventListener('change', function () { save({ historyN: num(this.value, 60, 10, 120) }, '已保存'); });
      $('sw_followUp').addEventListener('change', function () { save({ followUp: this.checked }, '已保存'); });
      $('sw_lifeGreet').addEventListener('change', function () { save({ lifeGreet: this.checked }, '已保存'); });
      $('sw_photos').addEventListener('change', function () { save({ photos: this.checked }, '已保存'); });
      $('sw_intimLib').addEventListener('change', function () { save({ intimLib: this.checked }, '已保存'); });
      $('wipeBtn').addEventListener('click', function () {
        if (!confirm('确定清空全部数据？聊天记录、设定、API Key 都会消失，不可恢复。')) return;
        if (!confirm('再确认一次：真的全部清空？')) return;
        Promise.resolve()
          .then(function () {
            if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
              try { indexedDB.deleteDatabase('schat-v2'); } catch (e) {}
            }
            // GitHub Pages 源站与所有仓库共享 localStorage，绝不能 clear() 殃及其他项目
            try { localStorage.removeItem(store.LS_KEY || 'schat-v2-store'); } catch (e) {}
            location.reload();
          });
      });
    });
  }

  /* ---------- 帮助页 ---------- */
  function buildHelp() {
    $('helpBody').innerHTML =
      '<div class="card"><div class="ct">指令</div><div class="cb">' +
      '<div class="lirow"><span class="kbd">RS 内容</span> —— 永久修改 TA 的人设，写进基础设定层，清空聊天也不丢。</div>' +
      '<div class="lirow"><span class="kbd">LS 内容</span> —— 本次会话临时调整，清空聊天后失效。</div>' +
      '<div class="lirow"><span class="kbd">【3小时后】</span> —— 快进时间，TA 按 24 小时作息过完这段时间再开口。</div>' +
      '<div class="lirow">长按气泡 —— 引用回复 / 复制。</div>' +
      '</div></div>' +
      '<div class="card"><div class="ct">节奏</div><div class="cb">' +
      '<div class="lirow">· 回复中点「停止」可中断。</div>' +
      '<div class="lirow">· 开启日常主动问候后，TA 偶尔会按作息自然地想起你并发来消息。</div>' +
      '<div class="lirow">· 短暂退出聊天不会丢消息，全在本地。</div>' +
      '</div></div>' +
      '<div class="card"><div class="ct">关于</div><div class="cb"><div class="lirow">Schat v2 · 人设版本 v' + (window.SCHAT_PERSONAS_VER || '?') + '<br>纯静态 PWA · 数据全本地 · 直连你自填的 OpenAI 兼容接口。</div></div></div>';
  }

  /* ---------- 启动 ---------- */
  function bindGlobal() {
    $('homeSetBtn').addEventListener('click', function () { buildSettings(); showPage('page-set'); });
    $('homeHelpBtn').addEventListener('click', function () { buildHelp(); showPage('page-help'); });
    $('setBackBtn').addEventListener('click', function () { showPage('page-home'); renderList(); });
    $('helpBackBtn').addEventListener('click', function () { showPage('page-home'); });
    $('profileBackBtn').addEventListener('click', function () { showPage('page-chat'); });
    $('onboardOk').addEventListener('click', function () {
      $('onboard').classList.remove('show');
      store.set('onboarded', 1);
    });
  }

  ui.bootUi = function () {
    bindGlobal();
    bindChatEvents();
    renderList();
    store.get('onboarded', 0).then(function (v) {
      if (!v) $('onboard').classList.add('show');
    });
  };
})();
