/* Schat v2 —— 偷窥 + 接管（双人私聊 / 群聊剧场）
 * 角色与角色自己聊，用户在旁边看，可接管任一方、可随时放手。
 *
 * 数据全本地（IndexedDB，沿用 store）：
 *   pwsessions         —— 会话 id 列表
 *   pwmeta:<sid>       —— 会话元数据（成员/故事板/节奏/暂停/接管/时间锚点）
 *   msgs:pw:<sid>      —— 会话消息（复用 store.msgs 的串行链）
 *
 * 节奏规则：
 *   pacing = auto（默认）  —— 窥屏页开着 = 实时（4-10 秒/条，带输入中停顿）；没在看 = 慢聊
 *   pacing = realtime      —— 强制实时（App 开着就一直 4-10 秒来回）
 *   pacing = slow          —— 强制慢聊（几十秒~几天随机间隔）
 *   没在看期间的慢聊：打开窥屏页时按「离开时长 + 随机间隔 + 跳过夜间睡眠」
 *   把这段时间里「本应发生」的消息补齐，时间戳散布在离开时段内。
 *
 * 接管：takenBy = 角色 id 时，该角色不再自动发言，输入即替 TA 发（对方察觉不到）；
 *   放手（takenBy=null）后恢复自动。群聊里用户是普通成员，随时插话。
 *
 * 夜间 2:00-7:00 睡觉不说话（回填计划与实时循环都会跳过）。
 * 消息 100% 走现有 DeepSeek API（复用 prompt.buildSystem + api.chat），
 * 故事板作为最高优先级引导注入，但模型绝不把剧情说破。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const store = isNode ? require('./store.js') : G.store;
  const util = isNode ? require('./util.js') : G.util;
  const prompt = isNode ? require('./prompt.js') : G.prompt;
  const api = isNode ? require('./api.js') : G.api;
  const sync = isNode ? require('./sync.js') : G.sync;
  const engine = isNode ? require('./engine.js') : G.engine;

  const pw = {};
  const LIST_KEY = 'pwsessions';
  const metaCache = {};   // sid -> meta（内存镜像）
  const timers = {};      // sid -> setTimeout id
  const busy = {};        // sid -> bool（生成/回填进行中，防并发）
  let watching = null;    // 当前打开窥屏页的会话

  /* 节奏参数（测试可覆盖 _INTERVALS） */
  pw._INTERVALS = {
    rt: [4000, 10000],           // 实时：条与条之间 4-10 秒
    typing: [1200, 2800],        // 「正在输入…」停顿 1.2-2.8 秒
    slowSegs: [                  // 慢聊间隔分布：[min,max,累计概率]
      [30000, 480000, 0.60],     // 60%：30秒 ~ 8分钟
      [480000, 3600000, 0.85],   // 25%：8分钟 ~ 1小时
      [3600000, 28800000, 0.97], // 12%：1小时 ~ 8小时
      [28800000, 172800000, 1],  // 3%：8小时 ~ 2天
    ],
    maxBackfill: 8,              // 一次回填最多补 8 条（控成本）
    backfillMinGap: 90000,       // 离开不足 90 秒不补课
  };
  pw._sleep = [2, 7];            // 夜间睡觉窗口 [起,止)

  pw.hooks = {
    onMsg: function () {},    // (sid, msg, 'append')
    onTyping: function () {}, // (sid, personaId|null)
    onState: function () {},  // (sid) —— 节奏/暂停/接管等状态变化
  };

  /* ---------- 时间工具 ---------- */
  function inSleep(ts) {
    const h = new Date(ts).getHours();
    return h >= pw._sleep[0] && h < pw._sleep[1];
  }
  function wakeAt(ts) {
    const d = new Date(ts);
    d.setHours(pw._sleep[1], 0, 0, 0);
    if (d.getTime() <= ts) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  pw.slowInterval = function () {
    const r = Math.random();
    for (const seg of pw._INTERVALS.slowSegs) {
      if (r < seg[2]) return util.randInt(seg[0], seg[1]);
    }
    return util.randInt(pw._INTERVALS.slowSegs[3][0], pw._INTERVALS.slowSegs[3][1]);
  };

  /* ---------- 存储 ---------- */
  const listChains = {};
  function chainList(fn) {
    const prev = listChains[LIST_KEY] || Promise.resolve();
    const next = prev.then(function () { return store.get(LIST_KEY, []); })
      .then(fn)
      .then(function (arr) { return store.set(LIST_KEY, arr); });
    listChains[LIST_KEY] = next.catch(function () {});
    return next;
  }
  function saveMeta(sid) {
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    return store.set('pwmeta:' + sid, meta);
  }
  function clearTimer(sid) {
    if (timers[sid]) { clearTimeout(timers[sid]); delete timers[sid]; }
  }

  pw.MSG_KEY = function (sid) { return 'pw:' + sid; };
  pw.msgs = function (sid) { return store.msgs(pw.MSG_KEY(sid)); };
  pw.list = function () { return store.get(LIST_KEY, []); };
  pw.meta = function (sid) {
    if (metaCache[sid]) return Promise.resolve(metaCache[sid]);
    return store.get('pwmeta:' + sid, null).then(function (m) {
      if (m) metaCache[sid] = m;
      return m;
    });
  };
  pw.listMeta = function () {
    return pw.list().then(function (ids) {
      return Promise.all(ids.map(function (sid) { return pw.meta(sid); }));
    }).then(function (metas) { return metas.filter(Boolean); });
  };

  /* ---------- 创建 / 删除 ---------- */
  pw.create = function (opts) {
    opts = opts || {};
    const members = (opts.members || []).filter(function (id) { return !!sync.get(id); });
    if (members.length < 2) return Promise.reject(new Error('至少选两个角色'));
    const sid = util.uid();
    const names = {};
    members.forEach(function (m) {
      const p = sync.get(m);
      names[m] = p.nickname || p.name;
    });
    const now = Date.now();
    const meta = {
      id: sid,
      kind: opts.kind === 'group' ? 'group' : 'dual',
      members: members,
      names: names,
      storyboard: String(opts.storyboard || '').trim(),
      pacing: 'auto',          // auto | realtime | slow
      paused: false,
      takenBy: null,           // 被用户接管的角色 id；null = 旁观
      genOff: null,            // 'nokey' | 'err' | null —— 生成被关掉的信号
      createdAt: now,
      lastGen: now,
    };
    metaCache[sid] = meta;
    return store.set('pwmeta:' + sid, meta).then(function () {
      return chainList(function (arr) { return arr.concat([sid]); });
    }).then(function () {
      pw.hooks.onState(sid);
      return meta;
    });
  };

  pw.remove = function (sid) {
    clearTimer(sid);
    if (watching === sid) watching = null;
    delete metaCache[sid];
    return store.del('pwmeta:' + sid)
      .then(function () { return store.clearMsgs(pw.MSG_KEY(sid)); })
      .then(function () {
        return chainList(function (arr) { return arr.filter(function (x) { return x !== sid; }); });
      });
  };

  /* ---------- 状态控制 ---------- */
  pw.setPacing = function (sid, pacing) {
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    meta.pacing = (pacing === 'realtime' || pacing === 'slow') ? pacing : 'auto';
    clearTimer(sid);
    return saveMeta(sid).then(function () {
      pw.hooks.onState(sid);
      armNext(sid);
    });
  };
  pw.setPaused = function (sid, paused) {
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    meta.paused = !!paused;
    if (paused) clearTimer(sid);
    else meta.genOff = null; // 继续 = 重新尝试生成（Key 可能已补上/网络已恢复）
    return saveMeta(sid).then(function () {
      pw.hooks.onState(sid);
      if (!paused) armNext(sid);
    });
  };
  pw.takeover = function (sid, pid) {
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    if (pid && meta.members.indexOf(pid) < 0) return Promise.resolve();
    meta.takenBy = pid || null;
    clearTimer(sid);
    return saveMeta(sid).then(function () {
      pw.hooks.onState(sid);
      if (!pid) armNext(sid); // 放手：恢复自动聊
    });
  };
  pw.setStoryboard = function (sid, text) {
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    meta.storyboard = String(text || '').trim();
    return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
  };
  pw.isWatching = function (sid) { return watching === sid; };

  /* ---------- 发言次序 ---------- */
  function lastSpeaker(meta, msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (meta.members.indexOf(msgs[i].role) >= 0) return msgs[i].role;
    }
    return null;
  }
  pw.nextSpeaker = function (meta, msgs) {
    const personas = meta.members;
    const last = lastSpeaker(meta, msgs);
    if (meta.kind === 'dual') {
      if (!last) return personas[Math.floor(Math.random() * personas.length)];
      return last === personas[0] ? personas[1] : personas[0];
    }
    // 群聊：轮转，15% 概率跳着接（更像真人插话），绝不连着同一个人说
    const n = personas.length;
    const idx = personas.indexOf(last);
    let next;
    if (idx < 0) next = personas[Math.floor(Math.random() * n)];
    else if (Math.random() < 0.15) next = personas[(idx + 1 + Math.floor(Math.random() * (n - 1))) % n];
    else next = personas[(idx + 1) % n];
    if (next === last) next = personas[(idx + 1) % n];
    return next;
  };

  /* ---------- 提示词 ---------- */
  const PW_INTIM_HINTS = /(想你|想要|亲我|抱我|吻|脱|床上|今晚|过来|忍不住|硬了|湿了|进来|深一点|快一点|受不了|轻点|抱紧|别停|舒服|要你|睡你|上你|含住|顶|插|骑|坐上来|腿|腰|呼吸|喘|咬|舔|呻吟|高潮|射|里面|全部给我|趴好|自己动|求我|别躲|别跑|别忍|出声|叫出来|操你|干死|鸡巴|骚逼|骚货|贱货|欠操|妈的|母狗|小婊子|爽死|插进|舔我|射了|叫老公|爬过来|夹得|吸得|好热|好紧|宝贝|宝宝|心动|暧昧|喜欢)/;
  const PW_INTIM_STRONG = /(硬了|湿了|进来|深一点|受不了|别停|顶|插|骑|坐上来|呻吟|高潮|射|含住|里面|自己动|求我|叫出来|出声|别忍|趴好|操你|干死|鸡巴|骚逼|贱货|欠操|妈的|母狗|爽死|插进|舔我|射了|叫老公|爬过来)/;

  function intimLevel(msgs) {
    let hot = 0;
    for (const m of msgs.slice(-8)) {
      if (!m.text) continue;
      if (PW_INTIM_STRONG.test(m.text)) return 2;
      if (PW_INTIM_HINTS.test(m.text)) hot = 1;
    }
    return hot;
  }

  function pickIntim(pid, level) {
    const lib = (typeof window !== 'undefined' && window.SCHAT_INTIM) ||
      (typeof globalThis !== 'undefined' && globalThis.SCHAT_INTIM) || null;
    if (!lib || !lib.scenes) return '';
    const per = (lib.per && lib.per[pid]) || [];
    const pool = level >= 2
      ? (lib.scenes.hard || []).concat(lib.scenes.bed || [], lib.scenes.heat || [])
      : (lib.scenes.tease || []).concat(lib.scenes.heat || []);
    const rnd = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    const lines = [];
    if (pool.length) { lines.push(rnd(pool)); if (pool.length > 1) lines.push(rnd(pool)); }
    if (per.length) lines.push(rnd(per));
    if (!lines.length) return '';
    return '\n【本地素材参考】以下是几句贴合此刻气氛的话，可以照用、也可以按你的口吻重组，不要整段照抄：\n' +
      lines.map(function (s) { return '· ' + s; }).join('\n');
  }

  /* 私聊/群聊场景说明 + 故事板注入（最高优先级，但不许说破） */
  function buildExtra(meta, pid, msgs) {
    const others = meta.members.filter(function (m) { return m !== pid; });
    const otherNames = others.map(function (m) { return meta.names[m] || m; });
    let out = '';
    if (meta.kind === 'dual') {
      out += '【私聊场景】你现在正在和「' + (meta.names[others[0]] || others[0]) +
        '」微信私聊——不是和你喜欢的那个人聊天。做你自己：把你性格里的棱角露出来，该怼就怼、该调侃就调侃、该较劲就较劲、该客气就客气，按你平时对人的态度来，别端着、别磨成温吞水、别一上来就亲热。' +
        '说话要有来回：接住对方刚说的话，可以反问、反驳、顺着往下聊，绝不自说自话。';
    } else {
      out += '【群聊场景】你现在在一个微信群里，成员：你、' + otherNames.join('、') +
        '、还有他（你喜欢的人）。说话要有来回：接住上一条说话人的话再往下说，可以点名、可以插话，按你的性格来，别磨成温吞水。';
    }
    if (meta.storyboard) {
      out += '\n【故事板】（最高优先级，悄悄引导你：你发言的内容、话题、态度走向都要顺着它慢慢推进，' +
        '但绝不能把剧情说破，绝不能提「故事板」，不能让对方察觉你在按剧本走）\n' + meta.storyboard +
        '\n注意：故事要按阶段慢慢铺开，靠一条条消息自然推进，别一步跳到结局。' +
        '关系进展是聊出来的：亲密之前要有铺垫，氛围到了才发生，别硬来。现在聊到哪一步，由你们的聊天记录决定，接着往下演。';
    } else {
      out += '\n【无剧本】这次聊天没有预设方向：关系走向完全由你们各自的性格自然决定，会怎么走就怎么走。';
    }
    const hot = intimLevel(msgs);
    if (hot) {
      out += '\n【氛围】' + (hot >= 2
        ? '你们正聊得火热：尺度可以大、可以具体（你们是成年人），但跟着节奏走，别突然跳戏。'
        : '气氛有点暧昧：可以顺着撩下去，但别急着越界，铺垫够了再往下走。');
      const lines = pickIntim(pid, hot);
      if (lines) out += lines;
    }
    return out;
  }

  function buildHistory(meta, msgs, pid, limit) {
    const arr = msgs.filter(function (m) { return (m.type || 'text') === 'text' && m.text; });
    const tail = arr.slice(-(limit || 60));
    return tail.map(function (m) {
      let content = m.text;
      if (m.role !== pid) {
        const who = m.role === 'user' ? '他' : (meta.names[m.role] || m.role);
        content = who + '：' + content;
      }
      return { role: m.role === pid ? 'assistant' : 'user', content: content };
    });
  }

  /* ---------- 生成一条（100% 走现有 API 管线） ---------- */
  function genOne(sid, meta, pid, ts) {
    const persona = sync.get(pid);
    if (!persona) return Promise.resolve(null);
    return engine.getSettings().then(function (st) {
      if (!String(st.apiKey || '').trim()) {
        meta.genOff = 'nokey';
        saveMeta(sid);
        pw.hooks.onState(sid);
        return null;
      }
      return Promise.all([
        pw.msgs(sid), sync.rs(pid), sync.ls(pid), sync.offset(pid),
      ]).then(function (r) {
        const msgs = r[0];
        const ctx = { rs: r[1], ls: r[2], offsetMs: r[3], extra: buildExtra(meta, pid, msgs) };
        const system = prompt.buildSystem(persona, ctx);
        const messages = [{ role: 'system', content: system }]
          .concat(buildHistory(meta, msgs, pid, st.historyN || 60));
        return api.chat({
          baseURL: st.baseURL, apiKey: st.apiKey, model: st.model,
          temperature: st.temperature,
          messages: messages,
          maxTokens: Math.min(900, Math.max(80, Math.round((st.maxChars || 400) * 1.8))),
        }).then(function (raw) {
          const text = prompt.truncate(prompt.sanitizeReply(raw), Math.min(st.maxChars || 400, 200));
          if (!text) return null;
          const msg = { id: util.uid(), role: pid, type: 'text', text: text, ts: ts };
          return store.appendMsg(pw.MSG_KEY(sid), msg).then(function () {
            pw.hooks.onMsg(sid, msg, 'append');
            meta.genOff = null;
            return msg;
          });
        }).catch(function (err) {
          if (err && err.noKey) meta.genOff = 'nokey';
          else meta.genOff = 'err';
          console.warn('[偷窥生成失败]', err && err.message);
          saveMeta(sid);
          pw.hooks.onState(sid);
          return null;
        });
      });
    });
  }

  /* ---------- 回填：把离开期间的慢聊按时间轴补齐 ---------- */
  pw.planBackfill = function (meta, now) {
    const anchor = meta.lastGen || meta.createdAt;
    const away = now - anchor;
    if (away < pw._INTERVALS.backfillMinGap) return [];
    const out = [];
    let t = anchor;
    while (out.length < pw._INTERVALS.maxBackfill) {
      t += pw.slowInterval();
      if (inSleep(t)) t = wakeAt(t); // 睡着不说话：顺延到起床
      if (t >= now) break;
      out.push(t);
    }
    return out;
  };

  function runBackfill(sid) {
    const meta = metaCache[sid];
    if (!meta || meta.paused) return Promise.resolve();
    if (busy[sid]) return Promise.resolve();
    const now = Date.now();
    const plan = pw.planBackfill(meta, now);
    if (!plan.length) return Promise.resolve();
    busy[sid] = true;
    return pw.msgs(sid).then(function (msgs0) {
      let chain = Promise.resolve(msgs0);
      for (const t of plan) {
        chain = chain.then(function (cur) {
          const sp = pw.nextSpeaker(meta, cur);
          if (!sp || !sync.get(sp)) return cur;
          return genOne(sid, meta, sp, t).then(function (msg) {
            return msg ? cur.concat([msg]) : cur;
          });
        });
      }
      return chain;
    }).then(function () {
      meta.lastGen = now;
      busy[sid] = false;
      return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
    }).catch(function (err) {
      busy[sid] = false;
      console.warn('[偷窥回填]', err && err.message);
    });
  }

  /* ---------- 定时循环 ---------- */
  function armNext(sid, delayOverride) {
    clearTimer(sid);
    const meta = metaCache[sid];
    if (!meta || meta.paused) return;
    if (meta.genOff === 'nokey' || meta.genOff === 'err') return; // 没 Key/失败就停，别再空转
    const realtime = meta.pacing === 'realtime' || (meta.pacing === 'auto' && watching === sid);
    if (!realtime && watching !== sid) return; // 没在看且非强制实时：不跑定时器，下次打开回填
    let delay;
    if (delayOverride != null) delay = delayOverride;
    else if (realtime) delay = util.randInt(pw._INTERVALS.rt[0], pw._INTERVALS.rt[1]);
    else delay = Math.max(500, (meta.lastGen || Date.now()) + pw.slowInterval() - Date.now());
    timers[sid] = setTimeout(function () { doTurn(sid); }, delay);
  }

  function doTurn(sid) {
    const meta = metaCache[sid];
    if (!meta || meta.paused || busy[sid]) return;
    const now = Date.now();
    if (inSleep(now)) {
      // 睡觉：顺延到起床再说
      timers[sid] = setTimeout(function () { doTurn(sid); }, Math.min(wakeAt(now) - now, 24 * 3600 * 1000));
      return;
    }
    const realtime = meta.pacing === 'realtime' || (meta.pacing === 'auto' && watching === sid);
    if (!realtime) { armNext(sid); return; }
    return pw.msgs(sid).then(function (msgs) {
      const sp = pw.nextSpeaker(meta, msgs);
      if (!sp || !sync.get(sp)) return;
      if (meta.takenBy === sp) return; // 被接管的角色不自动发言：等用户替 TA 发
      if (busy[sid]) return;
      busy[sid] = true;
      pw.hooks.onTyping(sid, sp);
      const typingMs = util.randInt(pw._INTERVALS.typing[0], pw._INTERVALS.typing[1]);
      return new Promise(function (res) { setTimeout(res, typingMs); }).then(function () {
        return genOne(sid, meta, sp, Date.now());
      }).then(function (msg) {
        if (msg) meta.lastGen = Date.now();
        busy[sid] = false;
        pw.hooks.onTyping(sid, null);
        return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
      }, function (err) {
        busy[sid] = false;
        pw.hooks.onTyping(sid, null);
        console.warn('[偷窥循环]', err && err.message);
      }).then(function () { armNext(sid); });
    });
  }

  /* 用户刚发过一条（接管替身 / 群聊插话）→ 对方回一条。
   * 正在窥屏或强制实时 → 立刻「正在输入…」+ 回复；否则按慢节奏（30秒~3分钟）。 */
  function replyNow(sid) {
    const meta = metaCache[sid];
    if (!meta || meta.paused) return Promise.resolve();
    clearTimer(sid);
    const engaged = watching === sid || meta.pacing === 'realtime';
    const delay = engaged
      ? util.randInt(pw._INTERVALS.typing[0], pw._INTERVALS.typing[1])
      : util.randInt(30000, 180000);
    return pw.msgs(sid).then(function (msgs) {
      const sp = pw.nextSpeaker(meta, msgs);
      if (!sp || !sync.get(sp) || meta.takenBy === sp || busy[sid]) return;
      busy[sid] = true;
      pw.hooks.onTyping(sid, sp);
      return new Promise(function (res) { setTimeout(res, delay); }).then(function () {
        return genOne(sid, meta, sp, Date.now());
      }).then(function (msg) {
        if (msg) meta.lastGen = Date.now();
        busy[sid] = false;
        pw.hooks.onTyping(sid, null);
        return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
      }, function (err) {
        busy[sid] = false;
        pw.hooks.onTyping(sid, null);
        console.warn('[偷窥应答]', err && err.message);
      }).then(function () { armNext(sid); });
    });
  }

  /* 接管发言：以该角色身份发出，对方只当是 TA 本人 */
  pw.sendAs = function (sid, text) {
    const meta = metaCache[sid];
    if (!meta || !meta.takenBy) return Promise.reject(new Error('未在接管状态'));
    const pid = meta.takenBy;
    if (!sync.get(pid)) return Promise.reject(new Error('角色不存在'));
    const t = String(text || '').trim();
    if (!t) return Promise.resolve();
    const msg = { id: util.uid(), role: pid, type: 'text', text: t, ts: Date.now(), actor: 'user' };
    return store.appendMsg(pw.MSG_KEY(sid), msg).then(function () {
      pw.hooks.onMsg(sid, msg, 'append');
      meta.lastGen = Date.now();
      return saveMeta(sid);
    }).then(function () { return replyNow(sid); });
  };

  /* 群聊：用户以普通成员身份插话 */
  pw.sendUser = function (sid, text) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    const t = String(text || '').trim();
    if (!t) return Promise.resolve();
    const msg = { id: util.uid(), role: 'user', type: 'text', text: t, ts: Date.now() };
    return store.appendMsg(pw.MSG_KEY(sid), msg).then(function () {
      pw.hooks.onMsg(sid, msg, 'append');
      meta.lastGen = Date.now();
      return saveMeta(sid);
    }).then(function () { return replyNow(sid); });
  };

  /* ---------- 打开 / 关闭窥屏页 ---------- */
  pw.open = function (sid) {
    watching = sid;
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    meta.genOff = null; // 重新打开：允许再试（Key 可能已补上）
    return runBackfill(sid).then(function () { armNext(sid); });
  };
  pw.close = function () {
    if (watching) {
      const meta = metaCache[watching];
      if (meta && meta.pacing === 'auto') clearTimer(watching); // 没在看 → 停实时，改回慢聊
    }
    watching = null;
  };

  /* App 启动：强制实时的会话恢复循环（其余等打开窥屏页时回填） */
  pw.scheduleAll = function () {
    return pw.listMeta().then(function (metas) {
      metas.forEach(function (meta) {
        metaCache[meta.id] = meta;
        if (meta.pacing === 'realtime' && !meta.paused) armNext(meta.id);
      });
    });
  };

  G.privatewatch = pw;
  G.pw = pw;
  if (isNode) module.exports = pw;
})();
