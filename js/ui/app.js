/* Schat v2 —— UI 层：列表页 / 聊天页 / 设置页 / 人设页 / 帮助
 * 与引擎通过 engine.hooks 单向通信；所有数据仍从 store 读写，UI 不直接调 API。
 */
(function () {
  const G = window.SCHAT = window.SCHAT || {};
  const util = G.util, store = G.store, engine = G.engine, sync = G.sync, tp = G.timeparse;

  const $ = function (id) { return document.getElementById(id); };
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
    if (p.avatar) return '<div class="' + cls + '"><img src="' + p.avatar + '" alt=""></div>';
    return '<div class="' + cls + '" style="background:' + (p.avatarColor || '#8AA88F') + '">' + esc(p.name[0]) + '</div>';
  }

  function showPage(id) {
    const pages = document.querySelectorAll('.page');
    for (const pg of pages) pg.classList.remove('active');
    $(id).classList.add('active');
  }

  function sheet(id, show) {
    $(id).classList.toggle('show', show);
    $('mask' + id.slice(5) === undefined ? '' : '');
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
      return (m.role === 'me' ? '' : '') + (m.text || '').slice(0, 40);
    }
    return '开始聊天吧';
  }

  function renderList() {
    const list = sync.list();
    const box = $('homeList');
    $('verLine').textContent = 'Schat v2 · 人设版本 v' + (window.SCHAT_PERSONAS_VER || '?') + ' · 数据只存在这台设备上';
    let chain = Promise.resolve();
    box.innerHTML = '';
    for (const persona of list) {
      (function (item) {
        chain = chain.then(function () {
          return Promise.all([store.msgs(item.id), sync.unread(item.id)]);
        }).then(function (r) {
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
          box.appendChild(row);
        });
      })(persona);
    }
    return chain;
  }
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
    if (msg.type === 'image' && msg.src) {
      inner += '<img class="ph" src="' + msg.src + '" alt="照片">';
    } else {
      inner += esc(msg.text || '');
    }
    const ava = me
      ? '<div class="ava" style="background:#3a4a3f">我</div>'
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
  function showTyping(on) {
    $('chatSub').textContent = on ? '对方正在输入…' : '';
    const btn = $('sendBtn');
    if (on) {
      btn.textContent = '停止';
      btn.classList.add('stop');
    } else {
      btn.textContent = '发送';
      btn.classList.remove('stop');
    }
    const box = $('chatScroll');
    if (on) {
      if (!typingRow) {
        typingRow = document.createElement('div');
        typingRow.className = 'msg you typingrow';
        typingRow.innerHTML = '<div class="ava" style="background:' + (sync.get(currentLover).avatarColor || '#8AA88F') + '">…</div>' +
          '<div class="wrap"><div class="bub"><span class="dots"><span></span><span></span><span></span></span></div></div>';
        box.appendChild(typingRow);
        scrollBottom(true);
      }
    } else if (typingRow) {
      typingRow.remove();
      typingRow = null;
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

  /* 引擎挂钩 */
  engine.hooks.onMsg = function (loverId, msg, kind) {
    if (loverId === currentLover && lastRenderKey === loverId) {
      const persona = sync.get(loverId);
      if (document.getElementById('page-chat').classList.contains('active')) {
        if (kind === 'append') appendMsgDom(persona, msg);
        else updateMsgDom(persona, msg);
      }
      scrollBottom(false);
    }
    renderList();
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
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
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

        '<div class="card"><div class="ct">回复性格</div><div class="cb">' +
        fld('最长回复字数（硬截断）', 'setMax', st.maxChars, '默认 400；平时 TA 只回 1-2 句，只有你要细节才写长') +
        fld('打字速度（字/秒）', 'setCps', st.cps, '默认 10') +
        switchRow('followUp', '30 秒追问', '你 30 秒没回，TA 按人设追问一条（只一条）', st.followUp) +
        switchRow('lifeGreet', '日常主动问候', '隔一两天，TA 按作息自己发来消息（如问你在干嘛）', st.lifeGreet) +
        fld('追问间隔（秒）', 'setFollowSec', st.followUpSec, '默认 30') +
        switchRow('photos', '生活照', 'TA 偶尔发生活照（免费图库，发出即转存本地）', st.photos) +
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
      $('setMax').addEventListener('change', function () { save({ maxChars: num(this.value, 400, 50, 400) }, '已保存'); });
      $('setCps').addEventListener('change', function () { save({ cps: num(this.value, 10, 2, 40) }, '已保存'); });
      $('setFollowSec').addEventListener('change', function () { save({ followUpSec: num(this.value, 30, 5, 300) }, '已保存'); });
      $('setKeep').addEventListener('change', function () { save({ keepN: num(this.value, 300, 50, 1000) }, '已保存'); });
      $('setHist').addEventListener('change', function () { save({ historyN: num(this.value, 60, 10, 120) }, '已保存'); });
      $('sw_followUp').addEventListener('change', function () { save({ followUp: this.checked }, '已保存'); });
      $('sw_lifeGreet').addEventListener('change', function () { save({ lifeGreet: this.checked }, '已保存'); });
      $('sw_photos').addEventListener('change', function () { save({ photos: this.checked }, '已保存'); });
      $('wipeBtn').addEventListener('click', function () {
        if (!confirm('确定清空全部数据？聊天记录、设定、API Key 都会消失，不可恢复。')) return;
        if (!confirm('再确认一次：真的全部清空？')) return;
        Promise.resolve()
          .then(function () {
            if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
              try { indexedDB.deleteDatabase('schat-v2'); } catch (e) {}
            }
            localStorage.clear();
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
    $('helpBackBtn').addEventListener('click', function () { showPage(lastRenderKey === 'page-help' ? 'page-home' : 'page-home'); });
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
