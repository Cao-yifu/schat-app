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
    const tb = $('tabbar');
    if (tb) {
      const isTab = id === 'page-home' || id === 'page-roles' || id === 'page-moments' || id === 'page-set';
      tb.classList.toggle('show', isTab);
      document.body.classList.toggle('tabs-on', isTab);
      tb.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('on', t.getAttribute('data-tab') === id);
      });
    }
    if (id === 'page-moments') { renderMoments(); if (G.moments) G.moments.autoTick(); }
    if (id === 'page-roles') renderRoles();
  }

  function sheet(id, show) {
    $(id).classList.toggle('show', show);
    // 遮罩配对：sheetMsg -> maskSheet, sheetChat -> maskChat, sheetPin -> maskPin
    const maskMap = { sheetMsg: 'maskSheet', sheetChat: 'maskChat', sheetPin: 'maskPin' };
    const mask = maskMap[id];
    if (mask) $(mask).classList.toggle('show', show);
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

  /* 长按/右键列表行 → 置顶/取消置顶（私聊行与群聊行通用） */
  let pinSuppress = false; // 长按后吞掉本次 click
  let pinTarget = null;    // { id }
  function showPinSheet(target) {
    pinTarget = target;
    pinSuppress = true;
    store.get('pinned', []).then(function (arr) {
      $('siPin').style.display = arr.indexOf(target.id) >= 0 ? 'none' : '';
      $('siUnpin').style.display = arr.indexOf(target.id) >= 0 ? '' : 'none';
    });
    sheet('sheetPin', true);
  }
  function bindRowPress(row, target) {
    let pressTimer = null;
    const cancel = function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    row.addEventListener('touchstart', function () {
      pressTimer = setTimeout(function () { showPinSheet(target); }, 480);
    }, { passive: true });
    row.addEventListener('touchend', function () {
      cancel();
      if (pinSuppress) setTimeout(function () { pinSuppress = false; }, 400);
    });
    row.addEventListener('touchmove', cancel, { passive: true });
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      cancel();
      showPinSheet(target);
    });
  }

  function renderList() {
    const list = sync.list();
    const box = $('homeList');
    $('verLine').textContent = 'Schat v2 · 人设版本 v' + (window.SCHAT_PERSONAS_VER || '?') + ' · 数据只存在这台设备上';
    box.innerHTML = '';
    /* 有我的群聊（kind=group 且 me!==false）进主列表；幽灵群留在窥屏入口 */
    const PW2 = G.pw || G.privatewatch;
    const groupsP = PW2 ? PW2.listMeta().then(function (metas) {
      return metas.filter(function (m) { return m.kind === 'group' && m.me !== false; });
    }).catch(function () { return []; }) : Promise.resolve([]);
    // 并发读取每个角色的最新消息，全部就绪后按列表顺序一次性插入（顺序稳定且首屏更快）
    return Promise.all([store.get('pinned', []), groupsP, Promise.all(list.map(function (item) {
      return Promise.all([store.msgs(item.id), sync.unread(item.id)]).then(function (r) {
        const msgs = r[0], unread = r[1] || 0;
        const last = msgs[msgs.length - 1];
        const row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('data-name', item.name);
        row.setAttribute('data-id', item.id);
        row.innerHTML =
          avatarHtml(item, 'avatar') +
          '<div class="mid"><div class="nm">' + esc(item.nickname || item.name) + '</div>' +
          '<div class="pv">' + esc(previewOf(msgs)) + '</div></div>' +
          '<div class="tm">' + (last ? esc(util.listTime(last.ts)) : '') + '</div>';
        const dot = document.createElement('span');
        dot.className = 'udot';
        dot.style.display = unread > 0 ? 'block' : 'none';
        row.querySelector('.avatar').appendChild(dot);
        bindRowPress(row, { id: item.id });
        row.addEventListener('click', function () {
          if (pinSuppress) { pinSuppress = false; return; }
          openChat(item.id);
        });
        return row;
      });
    }))]).then(function (r) {
      const pinnedIds = r[0] || [];
      const gmetas = r[1];
      const loverRows = r[2];
      const groupRowsP = PW2 ? Promise.all(gmetas.map(function (meta) {
        return PW2.msgs(meta.id).then(function (msgs) {
          let last = null;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].type === 'text') { last = msgs[i]; break; }
          }
          const row = document.createElement('div');
          row.className = 'row';
          row.setAttribute('data-name', meta.groupName || '群聊');
          row.setAttribute('data-id', meta.id);
          const avas = meta.members.slice(0, 3).map(function (id) {
            const p = sync.get(id);
            return p ? avatarHtml(p, 'avatar') : '<div class="avatar" style="background:#44506e">?</div>';
          }).join('');
          const pv = last ? PW2.dispName(meta, last.role) + '：' + (last.text || '').slice(0, 30) : '（还没有消息）';
          row.innerHTML = '<div class="gavastack">' + avas + '</div>' +
            '<div class="mid"><div class="nm">' + esc(meta.groupName || '群聊') + '<span class="gtag">群聊</span></div>' +
            '<div class="pv">' + esc(pv) + '</div></div>' +
            '<div class="tm">' + esc(util.listTime(meta.lastGen || meta.createdAt)) + '</div>';
          bindRowPress(row, { id: meta.id });
          row.addEventListener('click', function () {
            if (pinSuppress) { pinSuppress = false; return; }
            openPeek(meta.id, 'home');
          });
          return row;
        });
      })) : Promise.resolve([]);
      return groupRowsP.then(function (groupRows) {
        const all = loverRows.concat(groupRows);
        const pinnedRows = [];
        const rest = [];
        all.forEach(function (row) {
          const id = row.getAttribute('data-id');
          if (pinnedIds.indexOf(id) >= 0) {
            row.classList.add('pinned');
            const mark = document.createElement('span');
            mark.className = 'pinmark';
            mark.textContent = '📌 ';
            const nm = row.querySelector('.nm');
            nm.insertBefore(mark, nm.firstChild);
            pinnedRows.push(row);
          } else rest.push(row);
        });
        pinnedRows.forEach(function (r2) { box.appendChild(r2); });
        rest.forEach(function (r2) { box.appendChild(r2); });
        applySearch();
      });
    });
  }
  /* 流式打字期间每 100ms 一次 onMsg，列表重渲染必须防抖，否则每 tick 全员读库 */
  const refreshListSoon = util.debounce(function () { renderList(); }, 300);
  ui.refreshList = function () { renderList(); };

  /* Aurora：首页搜索（纯视图层过滤，不改数据） */
  function applySearch() {
    const s = $('homeSearch');
    const q = s ? s.value.trim().toLowerCase() : '';
    const box = $('homeList');
    if (!box) return;
    for (const row of box.children) {
      const nm = row.querySelector('.nm');
      const txt = ((nm ? nm.textContent : '') + ' ' + (row.getAttribute('data-name') || '')).toLowerCase();
      row.style.display = (!q || txt.indexOf(q) !== -1) ? '' : 'none';
    }
  }

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
    const ava = me
      ? '<div class="ava"><img src="' + MY_AVATAR + '" alt=""></div>'
      : avatarHtml(persona, 'ava');
    const d = new Date(msg.ts || Date.now());
    const hm = util.p2(d.getHours()) + ':' + util.p2(d.getMinutes());
    return '<div class="msg ' + (me ? 'me' : 'you') + '" data-id="' + msg.id + '">' + ava +
      '<div class="wrap"><div class="bub">' + inner + '</div><time>' + hm + '</time></div></div>';
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
    const sub = $('chatSub');
    if (sub) sub.innerHTML = '<b></b>在线';
  }
  function showTyping(on) {
    if (on) {
      hideTypingIndicator();
      $('chatSub').textContent = '对方正在输入…';
      const btn = $('sendBtn');
      btn.textContent = '⏹';
      btn.classList.add('stop');
    } else {
      hideTypingIndicator();
      const btn = $('sendBtn');
      btn.textContent = '⊕';
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
    /* Aurora：聊天页头显示对方头像 + 在线状态（仅视图层，数据不动） */
    const pa = $('chatPeerAva');
    if (pa) pa.innerHTML = avatarHtml(persona, 'avatar');
    $('chatSub').innerHTML = '<b></b>在线';
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

  /* ---------- 朋友圈 ---------- */
  const M = G.moments;
  let composeImg = null;

  function renderRoles() {
    const box = $('rolesGrid');
    if (!box) return;
    box.innerHTML = '';
    sync.list().forEach(function (p) {
      const c = document.createElement('div');
      c.className = 'rolecard';
      c.innerHTML = avatarHtml(p, 'avatar') + '<div class="nm">' + esc(p.nickname || p.name) + '</div>';
      c.addEventListener('click', function () { openProfileFrom('roles', p.id); });
      box.appendChild(c);
    });
  }

  function momentDom(m, personas) {
    const isMe = m.pid === 'me';
    const p = isMe ? null : personas.find(function (x) { return x.id === m.pid; });
    const post = document.createElement('div');
    post.className = 'mpost';
    const hd = document.createElement('div');
    hd.className = 'mhd';
    hd.innerHTML = (isMe
      ? '<div class="mava"><img src="' + MY_AVATAR + '" alt=""></div>'
      : avatarHtml(p, 'mava')) +
      '<div class="mnm">' + esc(isMe ? '我' : (p ? (p.nickname || p.name) : 'TA')) + '</div>' +
      '<div class="mtime">' + esc(M.fmtAgo(m.t)) + '</div>';
    post.appendChild(hd);
    /* 点击头像 → 角色卡（任务8） */
    if (!isMe && p) {
      const mava = hd.querySelector('.mava');
      mava.classList.add('tappable');
      mava.addEventListener('click', function () { openProfileFrom('moments', p.id); });
    }
    if (m.text) {
      const tx = document.createElement('div');
      tx.className = 'mtxt';
      tx.textContent = m.text;
      post.appendChild(tx);
    }
    if (m.img) {
      const imwrap = document.createElement('div');
      imwrap.className = 'mimg';
      const img = document.createElement('img');
      img.src = m.img;
      img.alt = '照片';
      imwrap.appendChild(img);
      post.appendChild(imwrap);
    }
    const mbar = document.createElement('div');
    mbar.className = 'mbar';
    const lk = document.createElement('div');
    lk.className = 'act' + (m.liked ? ' liked' : '');
    lk.innerHTML = '<span>' + (m.liked ? '♥' : '♡') + '</span><span>' + (m.liked ? '取消' : '赞') + '</span>';
    lk.addEventListener('click', function () {
      M.toggleLike(m).then(renderMoments);
    });
    const cm = document.createElement('div');
    cm.className = 'act';
    cm.innerHTML = '<span>💬</span><span>评论</span>';
    cm.addEventListener('click', function () {
      const ip = post.querySelector('.cmtinput');
      if (ip) ip.classList.toggle('show');
    });
    mbar.appendChild(lk);
    mbar.appendChild(cm);
    post.appendChild(mbar);
    const likeNames = m.liked ? (m.likes || []).concat(['我']) : (m.likes || []);
    if (likeNames.length || (m.comments || []).length) {
      const foot = document.createElement('div');
      foot.className = 'mfoot';
      if (likeNames.length) {
        const ll = document.createElement('div');
        ll.className = 'likeline';
        ll.innerHTML = '<span class="lk">♥</span><span>' + esc(likeNames.join('、')) + '</span>';
        ll.addEventListener('click', function () { M.toggleLike(m).then(renderMoments); });
        foot.appendChild(ll);
      }
      (m.comments || []).forEach(function (c) {
        const cl = document.createElement('div');
        cl.className = 'cmt';
        const b = document.createElement('b');
        b.textContent = c.who;
        /* 点击评论者名字 → 该角色卡（任务8） */
        const cp = personas.find(function (x) { return (x.nickname || x.name) === c.who; });
        if (cp) {
          b.classList.add('tappable');
          b.addEventListener('click', function () { openProfileFrom('moments', cp.id); });
        }
        cl.appendChild(b);
        cl.appendChild(document.createTextNode(c.text));
        foot.appendChild(cl);
      });
      post.appendChild(foot);
    }
    const ip = document.createElement('div');
    ip.className = 'cmtinput';
    const ipt = document.createElement('input');
    ipt.type = 'text';
    ipt.placeholder = '评论…';
    const sbtn = document.createElement('button');
    sbtn.textContent = '发送';
    const send = function () {
      const t = ipt.value.trim();
      if (!t) return;
      m.comments = m.comments || [];
      m.comments.push({ who: '我', text: t });
      M.update(m).then(renderMoments);
      ipt.value = '';
      if (!isMe && p) M.replyComment(m, t);
    };
    sbtn.addEventListener('click', send);
    ipt.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
    ip.appendChild(ipt);
    ip.appendChild(sbtn);
    post.appendChild(ip);
    if (!isMe && p) {
      const nm = post.querySelector('.mnm');
      nm.classList.add('tappable');
      nm.addEventListener('click', function () { openProfileFrom('moments', p.id); });
    }
    return post;
  }

  function renderMoments() {
    const box = $('momentsList');
    if (!box) return Promise.resolve();
    return M.list().then(function (arr) {
      box.innerHTML = '';
      if (!arr.length) {
        box.innerHTML = '<div class="empty"><div class="big">🫧</div>TA们还没有发过动态<br><br><button class="gbtn" id="mComposeFirst">＋ 发第一条</button></div>';
        const b = $('mComposeFirst');
        if (b) b.addEventListener('click', openCompose);
        return;
      }
      const personas = sync.list();
      arr.slice().sort(function (a, b) { return b.t - a.t; }).forEach(function (m) {
        box.appendChild(momentDom(m, personas));
      });
    });
  }
  ui.renderMoments = renderMoments;

  function openCompose() {
    composeImg = null;
    $('composeText').value = '';
    $('composeImgPrev').style.display = 'none';
    $('maskCompose').classList.add('show');
    $('sheetCompose').classList.add('show');
  }
  function closeCompose() {
    $('maskCompose').classList.remove('show');
    $('sheetCompose').classList.remove('show');
  }

  function bindMoments() {
    $('momentsCamBtn').addEventListener('click', openCompose);
    $('maskCompose').addEventListener('click', closeCompose);
    $('composePhotoBtn').addEventListener('click', function () { $('composeFile').click(); });
    $('composeFile').addEventListener('change', function () {
      const f = this.files && this.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('照片别超过 2MB'); return; }
      const rd = new FileReader();
      rd.onload = function () {
        composeImg = rd.result;
        $('composeImg').src = composeImg;
        $('composeImgPrev').style.display = 'block';
      };
      rd.readAsDataURL(f);
    });
    $('composePubBtn').addEventListener('click', function () {
      const text = $('composeText').value.trim();
      if (!text && !composeImg) { toast('写点什么再发'); return; }
      M.postMine(text, composeImg).then(function () {
        closeCompose();
        showPage('page-moments');
        renderMoments();
        toast('已发布');
      });
    });
  }

  /* ---------- 偷窥 / 接管 ---------- */
  const PW = G.pw || G.privatewatch;
  let peekSid = null;
  let peekMeta = null;
  let peekRendered = [];
  let peekTypingRow = null;

  function pwSheet(name, show) {
    $('sheet' + name).classList.toggle('show', show);
    $('mask' + name).classList.toggle('show', show);
  }

  function peekScrollBottom(force) {
    const sc = $('peekScroll');
    if (!sc) return;
    const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
    if (force || near) sc.scrollTop = sc.scrollHeight;
  }

  function peekBubble(meta, msg) {
    const d = new Date(msg.ts || Date.now());
    const hm = util.p2(d.getHours()) + ':' + util.p2(d.getMinutes());
    if (msg.role === 'sys') {
      return '<div class="sysline">' + esc(msg.text) + '</div>';
    }
    const body = msg.type === 'image'
      ? (msg.src && msg.src.indexOf('data:image/') === 0 ? '<img class="ph" src="' + msg.src + '" alt="照片">' : esc('[图片]'))
      : esc(msg.text || '');
    if (msg.role === 'user') {
      const nm = (meta.gnicks && meta.gnicks.user) ? '<div class="nm">' + esc(meta.gnicks.user) + '</div>' : '';
      return '<div class="msg me" data-id="' + msg.id + '"><div class="ava"><img src="' + MY_AVATAR + '" alt=""></div>' +
        '<div class="wrap">' + nm + '<div class="bub">' + body + '</div><time>' + hm + '</time></div></div>';
    }
    const p = sync.get(msg.role);
    const me = meta.kind === 'dual' && meta.members.indexOf(msg.role) === 1; // 双人：第二位靠右
    const nm = meta.kind === 'group' ? '<div class="nm">' + esc(PW.dispName(meta, msg.role)) + '</div>' : '';
    const ava = p ? avatarHtml(p, 'ava') : '<div class="ava" style="background:#44506e">?</div>';
    return '<div class="msg ' + (me ? 'me' : 'you') + '" data-id="' + msg.id + '">' + ava +
      '<div class="wrap">' + nm + '<div class="bub">' + body + '</div><time>' + hm + '</time></div></div>';
  }

  function renderPeekMsgs(meta) {
    return PW.msgs(meta.id).then(function (msgs) {
      peekRendered = msgs.slice();
      const box = $('peekScroll');
      let html = '';
      let lastTs = 0;
      for (const m of msgs) {
        if (m.ts - lastTs > 5 * 60 * 1000) {
          html += '<div class="dayline"><span>' + esc(util.chatTime(m.ts)) + '</span></div>';
        }
        html += peekBubble(meta, m);
        lastTs = m.ts;
      }
      box.innerHTML = html;
      peekScrollBottom(true);
    });
  }

  function appendPeekDom(msg) {
    const box = $('peekScroll');
    if (!box || !peekMeta) return;
    const last = peekRendered[peekRendered.length - 1];
    if (!last || msg.ts - last.ts > 5 * 60 * 1000) {
      const dl = document.createElement('div');
      dl.className = 'dayline';
      dl.innerHTML = '<span>' + esc(util.chatTime(msg.ts)) + '</span>';
      box.appendChild(dl);
    }
    peekRendered.push(msg);
    const tmp = document.createElement('div');
    tmp.innerHTML = peekBubble(peekMeta, msg);
    box.appendChild(tmp.firstChild);
    peekScrollBottom(true);
  }

  function showPeekTyping(pid) {
    hidePeekTyping();
    if (!peekMeta) return;
    const me = peekMeta.kind === 'dual' && peekMeta.members.indexOf(pid) === 1;
    const p = sync.get(pid);
    const ava = p ? avatarHtml(p, 'ava') : '<div class="ava" style="background:#44506e">?</div>';
    peekTypingRow = document.createElement('div');
    peekTypingRow.className = 'msg ' + (me ? 'me' : 'you') + ' typingrow';
    peekTypingRow.innerHTML = ava + '<div class="wrap"><div class="bub"><span class="dots"><span></span><span></span><span></span></span></div></div>';
    $('peekScroll').appendChild(peekTypingRow);
    const sub = $('peekSub');
    if (sub) sub.textContent = (peekMeta.names[pid] || pid) + ' 正在输入…';
    peekScrollBottom(true);
  }
  function hidePeekTyping() {
    if (peekTypingRow) { peekTypingRow.remove(); peekTypingRow = null; }
    const sub = $('peekSub');
    if (sub) sub.innerHTML = '<b></b>在线';
  }

  function peekStateLabel(meta) {
    if (meta.paused) return '已暂停';
    if (meta.pacing === 'realtime') return '实时模式';
    if (meta.pacing === 'slow') return '慢聊模式';
    return '自动节奏（看戏=实时）';
  }

  function renderPeekTitle(meta) {
    $('peekTitle').textContent = meta.kind === 'group'
      ? (meta.groupName || '群聊')
      : (meta.names[meta.members[0]] || meta.members[0]) + ' · ' + (meta.names[meta.members[1]] || meta.members[1]);
    const box = $('peekPeerAva');
    box.innerHTML = '';
    const ids = meta.members.slice(0, meta.kind === 'dual' ? 2 : 3);
    ids.forEach(function (id) {
      const p = sync.get(id);
      const el = document.createElement('span');
      el.style.display = 'inline-block';
      el.style.marginRight = '-6px';
      el.innerHTML = p ? avatarHtml(p, 'avatar') : '<div class="avatar" style="background:#44506e">?</div>';
      el.querySelector('.avatar').style.width = '34px';
      el.querySelector('.avatar').style.height = '34px';
      el.querySelector('.avatar').style.border = '2px solid #202941';
      box.appendChild(el);
    });
    $('peekSub').innerHTML = '<b></b>' + (meta.kind === 'group' ? (meta.members.length + 1) + ' 人' : '在线');
  }

  function renderPeekBar(meta) {
    const bar = $('peekBar');
    if (!bar) return;
    const effRealtime = meta.pacing === 'realtime' || meta.pacing === 'auto';
    let html = '';
    html += meta.paused
      ? '<button class="pwbtn on" id="peekPauseBtn">▶ 继续</button>'
      : '<button class="pwbtn" id="peekPauseBtn">⏸ 暂停</button>';
    html += effRealtime
      ? '<button class="pwbtn on" id="peekPaceBtn">⚡ 实时中 · 切回慢聊</button>'
      : '<button class="pwbtn" id="peekPaceBtn">🐢 慢聊中 · 开始实时</button>';
    if (meta.kind === 'dual') {
      meta.members.forEach(function (m) {
        const on = meta.takenBy === m;
        html += on
          ? '<button class="pwbtn warn" data-take="' + m + '">✋ 放手「' + esc(meta.names[m] || m) + '」</button>'
          : '<button class="pwbtn" data-take="' + m + '">🎭 接管「' + esc(meta.names[m] || m) + '」</button>';
      });
    }
    if (meta.paused) html += '<span class="pwbtn note">已暂停：不会产生新消息，点「继续」恢复。</span>';
    else if (meta.genOff === 'nokey') html += '<span class="pwbtn note">未配置 API Key，请在设置页填写后重试</span>';
    else if (meta.genOff === 'err') html += '<span class="pwbtn note">上次生成失败，点「暂停→继续」重试。</span>';
    else if (meta.takenBy) html += '<span class="pwbtn note">你正替「' + esc(meta.names[meta.takenBy] || meta.takenBy) + '」说话，对方察觉不到。</span>';
    else if (meta.kind === 'dual') html += '<span class="pwbtn note">旁观中 · ' + esc(peekStateLabel(meta)) + '：接管一方即可替 TA 发消息。</span>';
    else html += '<span class="pwbtn note">你也是群成员，直接输入插话。</span>';
    bar.innerHTML = html;

    $('peekPauseBtn').addEventListener('click', function () {
      PW.setPaused(meta.id, !meta.paused);
    });
    $('peekPaceBtn').addEventListener('click', function () {
      PW.setPacing(meta.id, effRealtime ? 'slow' : 'realtime');
    });
    bar.querySelectorAll('[data-take]').forEach(function (b) {
      b.addEventListener('click', function () {
        const m = b.getAttribute('data-take');
        PW.takeover(meta.id, meta.takenBy === m ? null : m);
      });
    });
  }

  function renderPeekInput(meta) {
    const bar = $('peekInbar');
    const inp = $('peekInp');
    if (meta.kind === 'group') {
      bar.style.display = '';
      inp.placeholder = '群聊里说点什么…';
    } else if (meta.takenBy) {
      bar.style.display = '';
      inp.placeholder = '以「' + (meta.names[meta.takenBy] || meta.takenBy) + '」的身份说…';
    } else {
      bar.style.display = 'none'; // 旁观中：接管后才能输入
    }
  }

  function renderPeek(meta) {
    renderPeekTitle(meta);
    renderPeekBar(meta);
    renderPeekInput(meta);
    renderPeekMsgs(meta);
  }

  let peekOrigin = 'pwlist'; // 'pwlist' | 'home'（从首页群聊行进入）
  function openPeek(sid, origin) {
    peekOrigin = origin || 'pwlist';
    return PW.meta(sid).then(function (meta) {
      if (!meta) { toast('会话不存在'); return; }
      peekSid = sid;
      peekMeta = meta;
      peekRendered = [];
      hidePeekTyping();
      showPage('page-peek');
      renderPeek(meta);
      PW.open(sid); // 打开即补课（离开期间的慢聊）+ 进入实时循环
    });
  }
  ui.openPeek = openPeek;

  function closePeek() {
    PW.close();
    peekSid = null;
    peekMeta = null;
    hidePeekTyping();
    if (peekOrigin === 'home') {
      showPage('page-home');
      renderList();
    } else {
      showPage('page-pwlist');
      renderPwList();
    }
  }

  function renderPwList() {
    const box = $('pwList');
    if (!box) return Promise.resolve();
    return PW.listMeta().then(function (metas) {
      /* 窥屏入口只留：双人私聊 + 没有我的群聊（幽灵群）；有我的群聊在首页列表 */
      const visible = metas.filter(function (m) { return m.kind === 'dual' || m.me === false; });
      return Promise.all(visible.map(function (meta) {
        return PW.msgs(meta.id).then(function (msgs) { return { meta: meta, msgs: msgs }; });
      })).then(function (rows) {
        box.innerHTML = '';
        if (!rows.length) {
          box.innerHTML = '<div class="empty"><div class="big">👁</div>还没有偷窥局<br>挑两个角色，看 TA 们自己聊</div>';
          return;
        }
        rows.forEach(function (r) {
          const meta = r.meta;
          const avas = meta.members.slice(0, 2).map(function (id) {
            const p = sync.get(id);
            return p ? avatarHtml(p, 'avatar') : '<div class="avatar" style="background:#44506e">?</div>';
          });
          let last = null;
          for (let i = r.msgs.length - 1; i >= 0; i--) {
            if (r.msgs[i].type === 'text') { last = r.msgs[i]; break; }
          }
          const nm = meta.kind === 'group' ? (meta.groupName || '群聊') : (meta.members.map(function (m) { return meta.names[m] || m; }).join(' · '));
          const pv = last ? PW.dispName(meta, last.role) + '：' + (last.text || '') : '';
          const st = meta.paused ? '已暂停' : (meta.pacing === 'realtime' ? '实时模式' : (meta.pacing === 'slow' ? '慢聊模式' : '自动节奏'));
          const row = document.createElement('div');
          row.className = 'pwsess';
          row.innerHTML = '<div class="dualava">' + avas.join('') + '</div>' +
            '<div class="mid"><div class="nm">' + esc(nm) + '</div>' +
            '<div class="pv">' + esc(pv.slice(0, 30) || '（还没有消息）') + '</div>' +
            '<div class="st">' + st + (meta.kind === 'group' ? ' · 幽灵群' : '') + '</div></div>' +
            '<div class="tm">' + esc(util.listTime(meta.lastGen || meta.createdAt)) + '</div>';
          row.addEventListener('click', function () { openPeek(meta.id, 'pwlist'); });
          box.appendChild(row);
        });
      });
    });
  }

  function buildPwPick(containerId, maxSel) {
    const box = $(containerId);
    box.innerHTML = '';
    const state = { sel: [] };
    const render = function () {
      box.querySelectorAll('.rolecard').forEach(function (c) {
        c.classList.toggle('sel', state.sel.indexOf(c.getAttribute('data-pid')) >= 0);
      });
    };
    sync.list().forEach(function (p) {
      const c = document.createElement('div');
      c.className = 'rolecard';
      c.setAttribute('data-pid', p.id);
      c.innerHTML = avatarHtml(p, 'avatar') + '<div class="nm">' + esc(p.nickname || p.name) + '</div>';
      c.addEventListener('click', function () {
        const i = state.sel.indexOf(p.id);
        if (i >= 0) state.sel.splice(i, 1);
        else if (state.sel.length >= maxSel) { toast('最多选 ' + maxSel + ' 个'); return; }
        else state.sel.push(p.id);
        render();
      });
      box.appendChild(c);
    });
    return state;
  }

  let pwPickDualState = null;
  function openPwCreate() {
    pwPickDualState = buildPwPick('pwPickDual', 2);
    $('pwStoryDual').value = '';
    pwSheet('PwCreate', true);
  }
  let pwPickGroupState = null;
  function openPwGroup() {
    pwPickGroupState = buildPwPick('pwPickGroup', 8);
    $('pwStoryGroup').value = '';
    pwSheet('PwGroup', true);
  }

  /* 群公告与成员面板（任务6/10） */
  function renderPwMembers(meta) {
    if (!meta || meta.kind !== 'group') return;
    $('pwMembersTitle').textContent = (meta.groupName || '群聊') + ' · 成员管理';
    $('pwAnnounceText').textContent = meta.announcement || '（暂无公告）';
    const box = $('pwMembersList');
    box.innerHTML = '';
    const mkRow = function (id, name, sub, canKick) {
      const p = sync.get(id);
      const row = document.createElement('div');
      row.className = 'memrow';
      row.innerHTML = (p ? avatarHtml(p, 'avatar') : '<div class="avatar" style="background:#44506e">?</div>') +
        '<div class="mid"><div class="nm">' + esc(name) + '</div><div class="sub">' + esc(sub || '') + '</div></div>';
      const acts = document.createElement('div');
      acts.className = 'memacts';
      const nickBtn = document.createElement('button');
      nickBtn.className = 'pwbtn';
      nickBtn.textContent = '设昵称';
      nickBtn.addEventListener('click', function () {
        const cur = (meta.gnicks && meta.gnicks[id]) || '';
        const v = prompt('给「' + name + '」设置群内昵称（留空 = 用本名）：', cur);
        if (v === null) return;
        PW.setGnick(meta.id, id, v).then(function () {
          toast(v.trim() ? '昵称已设' : '已恢复本名');
          renderPwMembers(meta);
        });
      });
      acts.appendChild(nickBtn);
      if (canKick) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'pwbtn warn';
        kickBtn.textContent = '移除';
        kickBtn.addEventListener('click', function () {
          if (!confirm('把「' + name + '」移出群聊？TA 会记住这件事。')) return;
          PW.kickMember(meta.id, id).then(function () {
            toast('已移出群聊');
            renderPwMembers(meta);
          });
        });
        acts.appendChild(kickBtn);
      }
      row.appendChild(acts);
      box.appendChild(row);
    };
    mkRow('user', (meta.gnicks && meta.gnicks.user) || '我', '群主', false);
    meta.members.forEach(function (id) {
      mkRow(id, PW.dispName(meta, id), '', true);
    });
    /* 邀请面板候选项（不在群里的角色） */
    const pick = $('pwInvitePick');
    if (pick) {
      pick.innerHTML = '';
      sync.list().forEach(function (p) {
        if (meta.members.indexOf(p.id) >= 0) return;
        const c = document.createElement('div');
        c.className = 'rolecard';
        c.innerHTML = avatarHtml(p, 'avatar') + '<div class="nm">' + esc(p.nickname || p.name) + '</div>';
        c.addEventListener('click', function () {
          PW.inviteMember(meta.id, p.id).then(function () {
            toast('已邀请「' + (p.nickname || p.name) + '」加入');
            pwSheet('PwInvite', false);
            renderPwMembers(meta);
          });
        });
        pick.appendChild(c);
      });
    }
  }

  function openPwStory() {
    if (!peekMeta) return;
    $('pwStoryEdit').value = peekMeta.storyboard || '';
    pwSheet('PwMenu', false);
    pwSheet('PwStory', true);
  }

  function bindPwEvents() {
    if (!PW) return;
    /* 角色页入口 */
    $('pwListBtn').addEventListener('click', function () {
      showPage('page-pwlist');
      renderPwList();
    });
    $('pwGroupBtn').addEventListener('click', openPwGroup);
    $('pwListBackBtn').addEventListener('click', function () { showPage('page-roles'); });
    $('pwNewBtn').addEventListener('click', openPwCreate);
    $('pwNewBtn2').addEventListener('click', openPwCreate);
    $('pwNewGroupBtn').addEventListener('click', openPwGroup);
    /* 创建面板 */
    $('maskPwCreate').addEventListener('click', function () { pwSheet('PwCreate', false); });
    $('maskPwGroup').addEventListener('click', function () { pwSheet('PwGroup', false); });
    $('pwCreateBtn').addEventListener('click', function () {
      if (!pwPickDualState || pwPickDualState.sel.length !== 2) { toast('挑两个角色'); return; }
      PW.create({ members: pwPickDualState.sel, storyboard: $('pwStoryDual').value }).then(function (meta) {
        pwSheet('PwCreate', false);
        showPage('page-pwlist');
        renderPwList();
        openPeek(meta.id);
      });
    });
    $('pwGroupCreateBtn').addEventListener('click', function () {
      if (!pwPickGroupState || pwPickGroupState.sel.length < 2) { toast('至少拉两个角色'); return; }
      const ghost = !!($('pwGhostChk') && $('pwGhostChk').checked);
      PW.create({ kind: 'group', members: pwPickGroupState.sel, storyboard: $('pwStoryGroup').value, me: !ghost }).then(function (meta) {
        pwSheet('PwGroup', false);
        if (ghost) {
          /* 幽灵群：纯观察，走窥屏入口 */
          showPage('page-pwlist');
          renderPwList();
          openPeek(meta.id, 'pwlist');
        } else {
          /* 有我的群聊：进首页主列表 */
          showPage('page-home');
          renderList();
          toast('群聊已创建：在首页聊天列表里');
          openPeek(meta.id, 'home');
        }
      });
    });
    /* 窥屏页 */
    $('peekBackBtn').addEventListener('click', closePeek);
    $('peekMenuBtn').addEventListener('click', function () {
      const isGroup = peekMeta && peekMeta.kind === 'group';
      $('pwmRename').style.display = isGroup ? '' : 'none';
      $('pwmMembers').style.display = isGroup ? '' : 'none';
      pwSheet('PwMenu', true);
    });
    $('maskPwMenu').addEventListener('click', function () { pwSheet('PwMenu', false); });
    $('pwmCancel').addEventListener('click', function () { pwSheet('PwMenu', false); });
    $('pwmStory').addEventListener('click', openPwStory);
    $('pwmPause').addEventListener('click', function () {
      pwSheet('PwMenu', false);
      if (peekMeta) PW.setPaused(peekMeta.id, !peekMeta.paused);
    });
    $('pwmDelete').addEventListener('click', function () {
      pwSheet('PwMenu', false);
      if (!peekMeta) return;
      if (!confirm('删除这个偷窥/群聊会话？聊天记录一并删除，不可恢复。')) return;
      const sid = peekMeta.id;
      PW.remove(sid).then(function () {
        closePeek();
        toast('已删除');
      });
    });
    /* 修改群名（任务6） */
    $('pwmRename').addEventListener('click', function () {
      pwSheet('PwMenu', false);
      if (!peekMeta || peekMeta.kind !== 'group') return;
      const v = prompt('修改群名：', peekMeta.groupName || '');
      if (v === null) return;
      PW.setGroupName(peekMeta.id, v).then(function () {
        toast('群名已改');
        renderList();
      });
    });
    /* 群公告与成员（任务6/10） */
    $('pwmMembers').addEventListener('click', function () {
      pwSheet('PwMenu', false);
      if (!peekMeta || peekMeta.kind !== 'group') return;
      renderPwMembers(peekMeta);
      pwSheet('PwMembers', true);
    });
    $('pwMembersClose').addEventListener('click', function () { pwSheet('PwMembers', false); });
    $('maskPwMembers').addEventListener('click', function () { pwSheet('PwMembers', false); });
    $('pwInviteBtn').addEventListener('click', function () {
      if (!peekMeta || peekMeta.kind !== 'group') return;
      pwSheet('PwInvite', true);
    });
    $('pwInviteCancel').addEventListener('click', function () { pwSheet('PwInvite', false); });
    $('maskPwInvite').addEventListener('click', function () { pwSheet('PwInvite', false); });
    $('pwAnnEditBtn').addEventListener('click', function () {
      if (!peekMeta) return;
      $('pwAnnInput').value = peekMeta.announcement || '';
      pwSheet('PwAnn', true);
    });
    $('maskPwAnn').addEventListener('click', function () { pwSheet('PwAnn', false); });
    $('pwAnnClear').addEventListener('click', function () { $('pwAnnInput').value = ''; });
    $('pwAnnSave').addEventListener('click', function () {
      if (!peekMeta) return;
      PW.setAnnouncement(peekMeta.id, $('pwAnnInput').value).then(function () {
        pwSheet('PwAnn', false);
        toast('群公告已更新');
        renderPwMembers(peekMeta);
      });
    });
    /* 故事板编辑 */
    $('maskPwStory').addEventListener('click', function () { pwSheet('PwStory', false); });
    $('pwStoryClear').addEventListener('click', function () {
      if (peekMeta) PW.setStoryboard(peekMeta.id, '').then(function () {
        pwSheet('PwStory', false);
        toast('故事板已清空：回到无剧本模式');
      });
    });
    $('pwStorySave').addEventListener('click', function () {
      if (peekMeta) PW.setStoryboard(peekMeta.id, $('pwStoryEdit').value).then(function () {
        pwSheet('PwStory', false);
        toast('故事板已更新，对后续消息生效');
      });
    });
    /* 输入发送：群聊以自己身份，接管中以角色身份 */
    function peekSend() {
      const inp = $('peekInp');
      const text = inp.value.trim();
      if (!text || !peekSid || !peekMeta) return;
      inp.value = '';
      inp.style.height = 'auto';
      if (peekMeta.kind === 'group') PW.sendUser(peekSid, text);
      else if (peekMeta.takenBy) PW.sendAs(peekSid, text);
    }
    $('peekSendBtn').addEventListener('click', peekSend);
    const pinp = $('peekInp');
    pinp.addEventListener('input', function () {
      pinp.style.height = 'auto';
      pinp.style.height = Math.min(96, pinp.scrollHeight) + 'px';
    });
    pinp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        peekSend();
      }
    });
    /* 引擎挂钩 */
    PW.hooks.onMsg = function (sid, msg) {
      if (sid === peekSid && document.getElementById('page-peek').classList.contains('active')) {
        hidePeekTyping();
        appendPeekDom(msg);
      }
      if (document.getElementById('page-pwlist').classList.contains('active')) renderPwList();
    };
    PW.hooks.onTyping = function (sid, pid) {
      if (sid !== peekSid) return;
      if (pid) showPeekTyping(pid);
      else hidePeekTyping();
    };
    PW.hooks.onState = function (sid) {
      if (sid !== peekSid) return;
      PW.meta(sid).then(function (meta) {
        if (!meta) return;
        peekMeta = meta;
        if (document.getElementById('page-peek').classList.contains('active')) {
          renderPeekTitle(meta);
          renderPeekBar(meta);
          renderPeekInput(meta);
        }
      });
      if (peekOrigin === 'home') refreshListSoon(); // 群名/成员等变化同步首页行
    };
  }

  /* ---------- 聊天页事件 ---------- */
  const EMOJIS = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😜','🤪','😎','🤔','😏','😴','🥱','😭','😤','😠','🤯','😱','😳','😈','👍','👎','👌','🙏','💪','🤝','❤️','💔','🔥','✨','🎉','🌸','🍺','🥂','🍚','🌙','⭐','💤','🐶','🐱','🫣'];
  function compressImage(dataUrl, cb) {
    // 长边 ≤800、JPEG q80；无 canvas 的环境（如 jsdom 测试）原样返回
    try {
      const c = document.createElement('canvas');
      const ctx2 = c && c.getContext ? c.getContext('2d') : null;
      if (!ctx2) { cb(dataUrl); return; }
      const img = new Image();
      img.onload = function () {
        try {
          let w = img.width, h = img.height;
          const max = 800;
          if (Math.max(w, h) > max) {
            const k = max / Math.max(w, h);
            w = Math.round(w * k); h = Math.round(h * k);
          }
          c.width = w; c.height = h;
          ctx2.drawImage(img, 0, 0, w, h);
          try { cb(c.toDataURL('image/jpeg', 0.8)); }
          catch (e) { cb(dataUrl); }
        } catch (e) { cb(dataUrl); }
      };
      img.onerror = function () { cb(dataUrl); };
      img.src = dataUrl;
    } catch (e) { cb(dataUrl); }
  }
  function insertEmoji(ch) {
    const inp = $('inp');
    const s = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
    const e2 = inp.selectionEnd == null ? inp.value.length : inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + ch + inp.value.slice(e2);
    const pos = s + ch.length;
    inp.selectionStart = inp.selectionEnd = pos;
    inp.focus();
    inp.dispatchEvent(new Event('input'));
  }

  function bindChatEvents() {
    $('chatBackBtn').addEventListener('click', closeChat);
    /* ⊕ = 添加本地图片；Enter 仍发送文字 */
    $('sendBtn').addEventListener('click', function () {
      if (engine.isRunning(currentLover)) engine.stop(currentLover);
      else $('chatFile').click();
    });
    /* emoji 面板 */
    const emojiBar = $('emojibar');
    emojiBar.innerHTML = '';
    EMOJIS.forEach(function (e) {
      const b = document.createElement('button');
      b.className = 'emoji-cell';
      b.textContent = e;
      b.addEventListener('click', function () { insertEmoji(e); });
      emojiBar.appendChild(b);
    });
    $('emojiBtn').addEventListener('click', function () {
      emojiBar.classList.toggle('show');
    });
    /* 本地图片发送：压缩（长边≤800、JPEG q80）后以图片消息发出，未成功不落库 */
    $('chatFile').addEventListener('change', function () {
      const f = this.files && this.files[0];
      this.value = ''; // 允许重复选同一张
      if (!f || !currentLover) return;
      if (f.size > 8 * 1024 * 1024) { toast('图片别超过 8MB'); return; }
      const rd = new FileReader();
      rd.onload = function () {
        compressImage(rd.result, function (dataUrl) {
          if (!dataUrl) { toast('图片处理失败，未发送'); return; }
          engine.sendChatImage(currentLover, dataUrl).then(function () {
            emojiBar.classList.remove('show');
            toast('图片已发送');
          }, function () { toast('图片发送失败'); });
        });
      };
      rd.onerror = function () { toast('读取图片失败'); };
      rd.readAsDataURL(f);
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
      openProfileFrom('chat', currentLover);
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
  let profileOrigin = 'roles'; // roles | chat | moments（返回键回到原位置）
  let momentsScrollTop = 0;
  function openProfileFrom(origin, loverId) {
    profileOrigin = origin || 'roles';
    if (origin === 'moments') {
      const sc = document.querySelector('#page-moments .scroll');
      momentsScrollTop = sc ? sc.scrollTop : 0;
    }
    openProfile(loverId);
  }
  function openProfile(loverId) {
    const p = sync.get(loverId);
    if (!p) return;
    $('profileName').textContent = p.nickname || p.name;
    const bd = $('profileBody');
    let html = '<div class="profile">' +
      (p.avatar ? '<div class="bava"><img src="' + p.avatar + '"></div>' : '<div class="bava" style="background:' + p.avatarColor + '">' + esc(p.name[0]) + '</div>') +
      '<div class="pname">' + esc(p.name) + '</div>' +
      '<div class="pid2">' + esc((p.card && (p.card['身份'] || p.card.job)) || '') + '</div></div>';

    /* 发起对话 + 补充人设（任务8） */
    html += '<button class="gbtn" id="profileChatBtn">💬 发起对话</button>';
    html += '<div class="card"><div class="ct">补充人设（只对 TA 生效，高于默认人设）</div><div class="cb">' +
      '<textarea id="pextraInp" class="compose-input" placeholder="给 TA 写自定义人设补充，例如：他现在升职了、最近在戒烟……保存后每次生成回复都会注入（低于故事板/记忆闭环）"></textarea>' +
      '<div class="pwrow2"><button class="gbtn ghost" id="pextraClear">清空</button><button class="gbtn" id="pextraSave">保存</button></div>' +
      '</div></div>';

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

    /* 发起对话（任务8） */
    $('profileChatBtn').addEventListener('click', function () { openChat(p.id); });
    /* 补充人设（任务8）：本地持久化，注入时高于默认人设 */
    store.get('pextra:' + p.id, '').then(function (v) {
      const el = $('pextraInp');
      if (el) el.value = v || '';
    });
    $('pextraSave').addEventListener('click', function () {
      const v = $('pextraInp').value.trim();
      store.set('pextra:' + p.id, v).then(function () { toast(v ? '补充人设已保存' : '已清空'); });
    });
    $('pextraClear').addEventListener('click', function () {
      $('pextraInp').value = '';
      store.set('pextra:' + p.id, '').then(function () { toast('已清空'); });
    });

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
        '<div class="card"><div class="ct">常用入口</div><div class="cb">' +
        '<div class="entryrow" id="entrySet">⚙ 设置与 AI 接口</div>' +
        '<div class="entryrow" id="entryTips">💡 使用提示</div>' +
        '<div class="entryrow" id="entryHelp">❓ 帮助与关于</div>' +
        '</div></div>' +

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
      /* 常用入口（设置/提示/帮助都在这 =「我的」页） */
      $('entrySet').addEventListener('click', function () {
        const c = bd.querySelector('.card:nth-of-type(2)');
        if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      $('entryTips').addEventListener('click', function () { $('onboard').classList.add('show'); });
      $('entryHelp').addEventListener('click', function () { buildHelp(); showPage('page-help'); });
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
    /* 设置/提示/帮助入口已挪到「我的」（设置页顶部入口卡，buildSettings 里绑定） */
    $('setBackBtn').addEventListener('click', function () { showPage('page-home'); renderList(); });
    $('helpBackBtn').addEventListener('click', function () { showPage('page-set'); });
    /* 列表行长按：置顶/取消置顶（任务4） */
    $('siPin').addEventListener('click', function () {
      sheet('sheetPin', false);
      pinSuppress = false;
      if (!pinTarget) return;
      store.get('pinned', []).then(function (arr) {
        if (arr.indexOf(pinTarget.id) < 0) arr.unshift(pinTarget.id);
        return store.set('pinned', arr);
      }).then(function () { renderList(); toast('已置顶'); });
    });
    $('siUnpin').addEventListener('click', function () {
      sheet('sheetPin', false);
      pinSuppress = false;
      if (!pinTarget) return;
      store.get('pinned', []).then(function (arr) {
        return store.set('pinned', arr.filter(function (x) { return x !== pinTarget.id; }));
      }).then(function () { renderList(); toast('已取消置顶'); });
    });
    $('siPinCancel').addEventListener('click', function () { sheet('sheetPin', false); pinSuppress = false; });
    $('maskPin').addEventListener('click', function () { sheet('sheetPin', false); pinSuppress = false; });
    $('profileBackBtn').addEventListener('click', function () {
      if (profileOrigin === 'moments') {
        /* 回到朋友圈原位置（任务8） */
        showPage('page-moments');
        const sc = document.querySelector('#page-moments .scroll');
        if (sc && momentsScrollTop) {
          setTimeout(function () { sc.scrollTop = momentsScrollTop; }, 60);
        }
      } else if (profileOrigin === 'chat') showPage('page-chat');
      else showPage('page-roles');
    });
    $('onboardOk').addEventListener('click', function () {
      $('onboard').classList.remove('show');
      store.set('onboarded', 1);
    });
    /* 底部标签栏：聊天 / 角色 / 朋友圈 / 我的 */
    const tb = $('tabbar');
    if (tb) {
      /* Aurora 要求 6：底部「我的」入口显示用户头像（不用通用轮廓图标） */
      const myAva = $('tabMyAva');
      if (myAva) myAva.src = MY_AVATAR;
      tb.querySelectorAll('.tab').forEach(function (t) {
        t.addEventListener('click', function () {
          const id = t.getAttribute('data-tab');
          if (id === 'page-set') buildSettings();
          if (id === 'page-home') { showPage(id); renderList(); }
          else showPage(id);
        });
      });
    }
    const hs = $('homeSearch');
    if (hs) hs.addEventListener('input', applySearch);
  }

  /* Aurora：状态栏时钟（演示框内假状态栏；手机端由系统状态栏接管，CSS 隐藏） */
  function startStatusClock() {
    const el = $('statusClock');
    if (!el) return;
    const tick = function () {
      const d = new Date();
      el.textContent = util.p2(d.getHours()) + ':' + util.p2(d.getMinutes());
    };
    tick();
    setInterval(tick, 15000);
  }

  ui.bootUi = function () {
    bindGlobal();
    bindChatEvents();
    bindMoments();
    bindPwEvents();
    startStatusClock();
    /* 启动即显示底部四栏 + 点亮聊天 tab：
     * 修复「打开后 tabbar/其他页面不显示，点设置键才缓冲出来」——
     * 此前 tabbar 的 .show 类只会在点击事件里由 showPage() 加上，启动流程从未调用。 */
    showPage('page-home');
    renderList();
    store.get('onboarded', 0).then(function (v) {
      if (!v) $('onboard').classList.add('show');
    });
    /* 朋友圈：首次播种 + 定时自动发动态 */
    if (G.moments) {
      G.moments.seed().then(function () {});
      G.moments.autoTick().catch(function () {});
      setInterval(function () { G.moments.autoTick().catch(function () {}); }, 10 * 60000);
    }
    /* 偷窥/接管：强制实时的会话在 App 打开期间恢复自动聊 */
    if (PW) {
      PW.scheduleAll().catch(function (e) { console.warn('[pw boot]', e && e.message); });
    }
    /* 被踢反应队列：启动即查 + 每分钟一次（任务10） */
    if (engine.kickTick) {
      engine.kickTick();
      setInterval(function () { engine.kickTick(); }, 60000);
    }
  };
})();
