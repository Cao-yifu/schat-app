/* Schat v2 —— 偷窥 + 接管（双人私聊 / 群聊剧场）
 * 角色与角色自己聊，用户在旁边看，可接管任一方、可随时放手。
 *
 * 数据全本地（IndexedDB，沿用 store）：
 *   pwsessions         —— 会话 id 列表
 *   pwmeta:<sid>       —— 会话元数据（成员/故事板/节奏/暂停/接管/时间锚点/群名/群昵称/公告）
 *   msgs:pw:<sid>      —— 会话消息（复用 store.msgs 的串行链）
 *
 * 节奏规则：
 *   pacing = auto（默认）  —— 窥屏页开着 = 实时（4-10 秒/条，带输入中停顿）；没在看 = 慢聊
 *   pacing = realtime      —— 强制实时（App 开着就一直 4-10 秒来回）
 *   pacing = slow          —— 强制慢聊（几十秒~几天随机间隔）
 *   没在看期间的慢聊：打开窥屏页时按「离开时长 + 随机间隔 + 跳过睡眠」补齐。
 *
 * 数量区间（v74）：每组双人窥屏会话消息 10~120 条。
 *   下限：打开窥屏页时不足 10 条 → 1.5~3 秒/条快速补齐（时间戳散布最近时段、遵守个人作息）；
 *   上限：任何落库路径先裁后存，只保留最新 120 条（实时/慢聊/回填/补齐一视同仁）。
 *
 * 睡眠（个人作息，v73）：
 *   persona.sleep=[起,止]（缺省 2-7）——实时模式：睡着的角色这一轮不发言、醒着的继续聊；
 *   慢聊/回填跳过睡眠段；被接管的角色不受睡眠限制。
 *   正在实时（正在窥屏或 pacing=realtime）时全局睡眠窗口取消。
 *
 * 接管：takenBy = 角色 id 时，该角色不再自动发言，输入即替 TA 发（对方察觉不到）。
 *
 * 群聊：user 是普通成员（sendUser）可插话；群名/群昵称/群公告/邀请/踢出（成员管理）；
 *   me=false 的群 = 幽灵群（纯观察，不进主列表，仍走窥屏入口）。
 *
 * 记忆闭环（charmem）：三种对话面事件双向流通；双层记忆（真相/表面）注入提示词；
 *   熟悉度（pairfam）随聊天/建群/朋友圈推进，注入开场白与亲疏。
 * 角色间互发照片：对话要照片/聊到兴头时小概率从 photo_pools 抽签袋发图。
 *
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
  const cm = isNode ? require('./charmem.js') : G.charmem;

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
  pw._sleep = [2, 7];            // 全局夜间睡觉窗口 [起,止)（慢聊/回填用；实时模式无视）
  pw._perSleep = null;           // 测试覆盖：function(ts, pid) -> bool

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
  /* 个人作息：persona.sleep=[起,止]，支持跨零点；测试关闭开关（_sleep[0]<0）同步生效 */
  function asleepAt(ts, pid) {
    if (pw._sleep[0] < 0) return false; // 测试环境关闭所有睡眠
    if (pw._perSleep) return pw._perSleep(ts, pid);
    const p = sync.get(pid);
    let s = (p && p.sleep && p.sleep.length === 2) ? p.sleep : null;
    if (!s) {
      if (!pw._sleep || pw._sleep[0] < 0) return false;
      s = pw._sleep; // 缺省 2-7
    }
    const h = new Date(ts).getHours();
    if (s[0] <= s[1]) return h >= s[0] && h < s[1];
    return h >= s[0] || h < s[1]; // 跨零点（如 23-7）
  }
  /* 该角色下一次醒来的时间戳（睡过头了就按 24h 内最近一次） */
  function wakeEndFor(pid, ts) {
    const p = sync.get(pid);
    let s = (p && p.sleep && p.sleep.length === 2) ? p.sleep : pw._sleep;
    const d = new Date(ts);
    const h = d.getHours();
    const endHour = s[0] <= s[1] ? s[1] : s[1]; // [起,止)：跨零点时止点本来就小于起点
    const mk = function (hour, dayPlus) {
      const x = new Date(ts);
      x.setHours(hour, 0, 0, 0);
      x.setDate(x.getDate() + (dayPlus || 0));
      return x.getTime();
    };
    if (s[0] <= s[1]) {
      const end = mk(s[1], 0);
      return end > ts ? end : mk(s[1], 1);
    }
    // 跨零点（如 23-7）：23点睡，7点醒（第二天）
    if (h >= s[0]) return mk(s[1], 1);
    return mk(s[1], 0);
  }
  /* 全睡着时：等到最近一个成员醒来（上限 2 小时，防计算误差） */
  function nextWakeDelay(meta, now) {
    let min = 2 * 3600 * 1000;
    for (const id of meta.members) {
      const end = wakeEndFor(id, now);
      if (end > now && end - now < min) min = end - now;
    }
    return Math.max(30000, min);
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

  /* ---------- 数量区间（10~120 条） ---------- */
  pw.MIN_MSGS = 10;            // 打开窥屏页时至少补足到 10 条
  pw.MAX_MSGS = 120;           // 任何时刻最多保留 120 条（超出的最旧消息落库前裁掉）
  pw._FILL = {
    gap: [1500, 3000],         // 快速补齐：两条之间真实间隔 1.5~3 秒
    spanMs: 24 * 3600 * 1000,  // 补齐消息时间戳散布窗口（最近 24 小时）
    minWindow: 5 * 60 * 1000,  // 窗口下限 5 分钟（刚建会话也能散布开）
  };

  /* 落库 + 上限裁剪：先裁到 MAX_MSGS-1 再追加（同一条串行链，store.trimMsgs/appendMsg），
   * 链上任何时刻条数 ≤ MAX_MSGS（连瞬时 121 都不可能出现）；
   * 裁剪=整体重写消息数组，旧消息数据同步删除（IndexedDB put 替换）。
   * 数量区间只作用于双人窥屏会话；群聊保持现状（原样追加、不裁剪）。 */
  function appendOne(sid, msg) {
    const key = pw.MSG_KEY(sid);
    const meta = metaCache[sid];
    if (meta && meta.kind !== 'dual') {
      return store.appendMsg(key, msg).then(function () {
        pw.hooks.onMsg(sid, msg, 'append');
        return msg;
      });
    }
    return store.trimMsgs(key, pw.MAX_MSGS - 1).then(function () {
      return store.appendMsg(key, msg);
    }).then(function () {
      pw.hooks.onMsg(sid, msg, 'append');
      return msg;
    });
  }
  /* 老数据一次性兜底：打开/启动时把超 120 条的双人链裁到 120（群聊不动） */
  function enforceCap(sid) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'dual') return Promise.resolve();
    return store.trimMsgs(pw.MSG_KEY(sid), pw.MAX_MSGS);
  }

  /* 快速补齐计划：need 个槽位时间戳散布在 [start, now]，严格交替选人；
   * 发言人在槽位时间睡着 → 顺延到 TA 醒来的时刻（遵守个人作息，绝不在睡眠窗口造消息）；
   * 顺延越界（到现在还没醒）→ 弃掉剩余槽位，宁缺毋滥，醒后实时节奏自然续上。 */
  function buildFillPlan(meta, msgs, need, now) {
    const plan = [];
    let lastTs = 0;
    for (const m of msgs) { if (m.ts && m.ts > lastTs) lastTs = m.ts; }
    let start = lastTs ? Math.max(lastTs, now - pw._FILL.spanMs) : (now - pw._FILL.spanMs);
    if (now - start < pw._FILL.minWindow) start = now - pw._FILL.minWindow;
    let t = Math.max(start, lastTs || 0); // 槽位时间不得早于最后一条消息（不乱序）
    let guard = 0;
    while (plan.length < need && guard++ < 200) {
      const target = start + (plan.length + 1) * (now - start) / (need + 1);
      t = Math.max(t + 1000, target); // 严格递增，至少间隔 1 秒
      if (t > now) break;
      const cur = msgs.concat(plan.map(function (p) { return { role: p.sp }; }));
      const sp = pw.nextSpeaker(meta, cur);
      if (!sp || !sync.get(sp)) break;
      /* 发言人在槽位时间睡着 → 顺延到醒来的时刻；作息表与测试钩子不一致时半小时步进兜底 */
      let g2 = 0;
      while (asleepAt(t, sp) && t <= now && g2++ < 48) {
        const wake = wakeEndFor(sp, t);
        if (wake && wake > t && wake < now) t = Math.max(t + 1000, wake);
        else t += 30 * 60 * 1000;
      }
      if (t > now) break; // 现在还没醒：到此为止，宁缺毋滥
      plan.push({ ts: t, sp: sp });
    }
    return plan;
  }

  /* 快速补齐执行：每条间隔 1.5~3 秒连续生成（真实时间），消息时间戳用计划里的历史时刻 */
  function runFill(sid, meta, plan) {
    if (!plan.length) return Promise.resolve();
    busy[sid] = true;
    let chain = Promise.resolve();
    for (const slot of plan) {
      chain = chain.then(function () {
        if (meta.paused || meta.genOff === 'nokey' || meta.genOff === 'err') return;
        if (meta.takenBy === slot.sp) return; // 中途被接管：该角色不自动发言
        return new Promise(function (res) {
          setTimeout(res, util.randInt(pw._FILL.gap[0], pw._FILL.gap[1]));
        }).then(function () {
          return genOne(sid, meta, slot.sp, slot.ts);
        });
      });
    }
    return chain.then(function () {
      busy[sid] = false;
      return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
    }, function (err) {
      busy[sid] = false;
      console.warn('[偷窥快速补齐]', err && err.message);
    });
  }

  /* 打开窥屏页时：双人会话消息数 < 10 → 快速补齐到至少 10 条，随后交给正常实时节奏（群聊不补） */
  function ensureMinMsgs(sid) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'dual' || meta.paused || busy[sid]) return Promise.resolve();
    return pw.msgs(sid).then(function (msgs) {
      const need = pw.MIN_MSGS - msgs.length;
      if (need <= 0) return null;
      const plan = buildFillPlan(meta, msgs, need, Date.now());
      return runFill(sid, meta, plan);
    });
  }

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
  /* 群内显示名：群昵称优先，未设用本名/昵称 */
  pw.dispName = function (meta, pid) {
    if (!meta) return pid;
    if (pid === 'user') return (meta.gnicks && meta.gnicks.user) || '我';
    return (meta.gnicks && meta.gnicks[pid]) || meta.names[pid] || pid;
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
    const kind = opts.kind === 'group' ? 'group' : 'dual';
    const meta = {
      id: sid,
      kind: kind,
      members: members,
      names: names,
      storyboard: String(opts.storyboard || '').trim(),
      pacing: 'auto',          // auto | realtime | slow
      paused: false,
      takenBy: null,           // 被用户接管的角色 id；null = 旁观
      genOff: null,            // 'nokey' | 'err' | null —— 生成被关掉的信号
      createdAt: now,
      lastGen: now,
      me: opts.me == null ? kind === 'group' : !!opts.me, // 有我的群聊（进主列表）；幽灵群 me=false
      groupName: kind === 'group' ? String(opts.groupName || members.map(function (m) { return names[m]; }).join('、')) : '',
      gnicks: opts.gnicks || {},
      announcement: String(opts.announcement || ''),
      lastDigestN: 0,          // 上次记忆提炼时的消息条数（防每次关闭都调 API）
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
    const meta = metaCache[sid];
    delete metaCache[sid];
    if (meta) cm.onPause(meta); // 关闭前提炼一次记忆（异步，不阻塞删除）
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
    if (paused) {
      clearTimer(sid);
      cm.onPauseGuarded(meta); // 暂停时提炼记忆（新消息足够多才调 API）
    } else {
      meta.genOff = null; // 继续 = 重新尝试生成（Key 可能已补上/网络已恢复）
    }
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

  /* ---------- 群管理（任务6/10）：群名 / 群昵称 / 公告 / 邀请 / 踢出 ---------- */
  pw.setGroupName = function (sid, name) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    meta.groupName = String(name || '').trim().slice(0, 24) || meta.groupName;
    return saveMeta(sid).then(function () {
      pw.hooks.onState(sid);
      return meta.groupName;
    });
  };
  pw.setGnick = function (sid, pid, nick) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    if (pid !== 'user' && meta.members.indexOf(pid) < 0) return Promise.reject(new Error('不在群里'));
    meta.gnicks = meta.gnicks || {};
    const n = String(nick || '').trim().slice(0, 12);
    if (n) meta.gnicks[pid] = n; else delete meta.gnicks[pid];
    return saveMeta(sid).then(function () { pw.hooks.onState(sid); });
  };
  pw.setAnnouncement = function (sid, text) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    meta.announcement = String(text || '').trim().slice(0, 200);
    return saveMeta(sid).then(function () {
      pw.hooks.onState(sid);
      const sys = { id: util.uid(), role: 'sys', type: 'text', text: meta.announcement ? '你更新了群公告' : '你清空了群公告', ts: Date.now() };
      return appendOne(sid, sys).then(function () {
        return meta.announcement;
      });
    });
  };
  pw.inviteMember = function (sid, pid) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    if (!sync.get(pid)) return Promise.reject(new Error('角色不存在'));
    if (meta.members.indexOf(pid) >= 0) return Promise.reject(new Error('已在群里'));
    const p = sync.get(pid);
    const nm = p.nickname || p.name;
    meta.members.push(pid);
    meta.names[pid] = nm;
    const sys = { id: util.uid(), role: 'sys', type: 'text', text: '你邀请「' + nm + '」加入了群聊', ts: Date.now() };
    return appendOne(sid, sys).then(function () {
      meta.lastGen = Date.now();
      return saveMeta(sid);
    }).then(function () {
      // 记忆 + 熟悉度：拉进同一个群，新人与每人 +1（封顶由 setFam 钳制）
      let chain = cm.groupEntry(sid, nm + ' 被拉进了群聊', { layer: 'face', level: 1, impact: 'low' });
      meta.members.forEach(function (o) {
        if (o !== pid) chain = chain.then(function () { return cm.bumpFam(pid, o, 1, '被拉进同一个群'); });
      });
      return chain.then(function () {
        pw.hooks.onState(sid);
        if (watching === sid || meta.pacing === 'realtime') armNext(sid); // 新人加入：继续聊
      });
    });
  };
  pw.kickMember = function (sid, pid) {
    const meta = metaCache[sid];
    if (!meta || meta.kind !== 'group') return Promise.reject(new Error('不是群聊'));
    const i = meta.members.indexOf(pid);
    if (i < 0) return Promise.reject(new Error('不在群里'));
    const nm = meta.names[pid] || pid;
    meta.members.splice(i, 1);
    delete meta.names[pid];
    if (meta.gnicks) delete meta.gnicks[pid];
    if (meta.takenBy === pid) meta.takenBy = null;
    const sys = { id: util.uid(), role: 'sys', type: 'text', text: '你将「' + nm + '」移出了群聊', ts: Date.now() };
    return appendOne(sid, sys).then(function () {
      return saveMeta(sid);
    }).then(function () {
      // 记忆痕迹 + 熟悉度下调 + 被踢反应调度（任务10）
      let chain = cm.groupEntry(sid, nm + ' 被移出了群聊', { layer: 'face', level: 1, impact: 'mid' });
      chain = chain.then(function () {
        return cm.charEntry(pid, '被你移出了群聊「' + (meta.groupName || '群') + '」', { layer: 'truth', level: 2, impact: 'high' });
      });
      meta.members.forEach(function (o) {
        chain = chain.then(function () { return cm.lowerFam(pid, o, '被踢出群'); });
      });
      chain = chain.then(function () { return cm.scheduleKick(meta, pid); });
      return chain.then(function () { pw.hooks.onState(sid); });
    });
  };

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
  /* 实时模式的「醒着的下一个」：自然下一位睡着 → 依次找醒着的；全睡着返回 null。
   * 被接管的角色不自动发言。 */
  function pickAwake(meta, msgs, now) {
    const natural = pw.nextSpeaker(meta, msgs);
    if (!natural) return null;
    if (meta.takenBy === natural) return null;
    if (!asleepAt(now, natural)) return natural;
    const last = lastSpeaker(meta, msgs);
    const n = meta.members.length;
    const idx = meta.members.indexOf(natural);
    for (let i = 1; i < n; i++) {
      const cand = meta.members[(idx + i) % n];
      if (cand === last) continue;                 // 绝不连着同一个人说
      if (meta.takenBy === cand) continue;
      if (!asleepAt(now, cand)) return cand;
    }
    return null;
  }

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

  /* ---------- 黄腔催化角色（陆野=渐进脏话撩人 / 沈知意=快速起飞骚0）----------
   * 在场检测：成员列表里有，或历史消息里发言过都算在场。
   * 档位规则（按在场角色取最强档）：
   *   - 陆野+沈知意同在 → 双催化·全场极黄（最强档，全员注入，含两位本人）
   *   - 仅沈知意在 → 快速起飞档（几句之内尺度拉满，比陆野快）
   *   - 仅陆野在 → 渐进三档（前几轮轻微 → 越聊越放得开）
   *   - 催化角色本人不被单人催化（自己有自己的人格，不需要催化段）
   */
  const CATALYST_LU = '陆野';
  const CATALYST_SHEN = '沈知意';
  /* [消息数阈值, 催化文案]：前几轮轻微 → 越聊越放得开；每档都要求保持自己的性格方式 */
  const CATALYST_TIERS = [
    [4, '【陆野在场】陆野也在。他嘴里的荤话让你有点在意，你说话比平时多了一点躁动和较劲，但还收得住。保持你自己的性格方式。'],
    [12, '【陆野在场】陆野的黄腔一句比一句脏，勾得你心里发痒。你会不自觉地顺着他的话往下接，偶尔冒出几句露骨的话——脸红也要说，嘴硬也要说，尺度一点点放开。保持你自己的性格方式。'],
    [1e9, '【陆野在场】陆野的脏话已经把火撩起来了：你敢接最脏的话、敢开黄腔，甚至主动把话题往更下流的方向带。害羞就脸红着说，清纯就半推半就，嘴硬就边骂边配合——用你自己的性格方式接住，尺度对齐陆野，别输给他。']
  ];
  /* 沈知意快速起飞档：不需要慢慢渐进，几句之内就勾到彻底放开 */
  const FAST_TIERS = [
    [2, '【沈知意在场】沈知意也在。他看起来纯情得不行，话里却透着一股勾人的浪劲，几句就把气氛撩起来了。你会不自觉地跟着他的节奏，尺度很快放开——保持你自己的性格方式。'],
    [6, '【沈知意在场】沈知意这个看着纯情的弟弟，比你想象的浪得多：又软又骚地勾你，你已经放开了，跟着他说露骨的话，脏话浪话都接得住，别输给这个装纯的小子。保持你自己的性格方式。'],
    [1e9, '【沈知意在场】你已经被他带到彻底起飞：想说什么就说什么，越脏越带劲。他的纯情是装的，床上比你浪十倍，你只管放开了接，尺度拉满，跟他比着来。']
  ];
  /* 双催化·全场极黄：陆野+沈知意同在，全员尺度拉到最高 */
  const CATALYST_BOTH = '【陆野+沈知意·双催化】陆野和沈知意都在场，两个人一唱一和：陆野的脏话勾人、沈知意的浪劲撩人，全场尺度已经被拉到最高。你完全放开，接最脏的话、说最骚的话，越下流越尽兴，跟上全场的节奏。害羞就脸红着说，清纯就半推半就，嘴硬就边骂边配合——保持你自己的性格方式，但尺度别输给他们两个。';
  function catalystPresent(meta, msgs, id) {
    if (!meta) return false;
    if ((meta.members || []).indexOf(id) >= 0) return true;
    return (msgs || []).some(function (m) { return m.role === id; });
  }
  pw._catalyst = function (meta, pid, msgs) {
    if (!meta) return '';
    const arr = msgs || [];
    const n = arr.length;
    const lu = catalystPresent(meta, arr, CATALYST_LU);
    const sh = catalystPresent(meta, arr, CATALYST_SHEN);
    if (!lu && !sh) return '';
    /* 双催化最强档：全员（含两位催化本人）互相撩，覆盖一切单人档 */
    if (lu && sh) return CATALYST_BOTH;
    /* 催化角色本人不被单人催化 */
    if (pid === CATALYST_LU || pid === CATALYST_SHEN) return '';
    const tiers = sh ? FAST_TIERS : CATALYST_TIERS;
    for (let i = 0; i < tiers.length; i++) {
      if (n <= tiers[i][0]) return tiers[i][1];
    }
    return tiers[tiers.length - 1][1];
  };

  /* 私聊/群聊场景说明 + 故事板注入（最高优先级，但不许说破） */
  function buildExtra(meta, pid, msgs) {
    const others = meta.members.filter(function (m) { return m !== pid; });
    const otherNames = others.map(function (m) { return pw.dispName(meta, m); });
    let out = '';
    if (meta.kind === 'dual') {
      out += '【私聊场景】你现在正在和「' + pw.dispName(meta, others[0]) +
        '」微信私聊——不是和你喜欢的那个人聊天。做你自己：把你性格里的棱角露出来，该怼就怼、该调侃就调侃、该较劲就较劲、该客气就客气，按你平时对人的态度来，别端着、别磨成温吞水、别一上来就亲热。' +
        '说话要有来回：接住对方刚说的话，可以反问、反驳、顺着往下聊，绝不自说自话。';
    } else {
      out += '【群聊场景】你现在在一个微信群里（群名「' + (meta.groupName || '群聊') + '」），成员：你、' + otherNames.join('、') +
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
    /* 陆野催化：他在场时，对其他角色的提示词注入渐进增强的催化段（见 pw._catalyst） */
    const cat = pw._catalyst(meta, pid, msgs);
    if (cat) out += '\n' + cat;
    return out;
  }
  pw._buildExtra = buildExtra;   // 测试钩子

  function buildHistory(meta, msgs, pid, limit) {
    const arr = msgs.filter(function (m) { return (m.type || 'text') === 'text' && m.text; });
    const tail = arr.slice(-(limit || 60));
    return tail.map(function (m) {
      let content = m.text;
      if (m.role !== pid) {
        const who = m.role === 'user' ? '他' : pw.dispName(meta, m.role);
        content = who + '：' + content;
      }
      return { role: m.role === pid ? 'assistant' : 'user', content: content };
    });
  }

  /* ---------- 记忆/熟悉度/补充人设注入（任务2/8/9）：故事板 > 记忆闭环 > 通用人设 ---------- */
  function buildMemCtx(meta, pid, msgs) {
    const others = meta.members.filter(function (m) { return m !== pid; });
    return Promise.all([
      cm.inject({ pid: pid, others: others, sid: meta.id, face: meta.kind === 'group' ? 'group' : 'dual', msgs: msgs }),
      cm.injectFam(meta.members),
      store.get('pextra:' + pid, ''),
    ]).then(function (r) {
      let more = '';
      if (r[0]) more += r[0];
      if (r[1]) more += r[1];
      if (r[2]) {
        more += '\n【用户给你的补充人设】（高于默认人设；与故事板/记忆闭环冲突时，以后者为准）\n' + r[2];
      }
      return more;
    }).catch(function () { return ''; });
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
        return buildMemCtx(meta, pid, msgs).then(function (mem) {
          if (mem) ctx.extra += '\n' + mem;
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
            return appendOne(sid, msg).then(function () {
              meta.genOff = null;
              meta.lastGen = Date.now();
              /* 记忆闭环 + 熟悉度推进 + 角色间照片 + 自发改群昵称（异步，不阻塞） */
              const all = msgs.concat([msg]);
              cm.observe(meta, meta, all);
              maybeBumpFam(meta, pid, all);
              maybePhotoChar(sid, meta, pid, all);
              if (meta.kind === 'group') maybeChangeGnick(sid, meta, pid, all);
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
    });
  }

  /* 熟悉度推进：聊得起来，说话双方小概率 +1（群聊封顶 2「熟」，双人封顶 3「亲密」） */
  function maybeBumpFam(meta, pid, msgs) {
    if (!cm) return;
    const prev = lastSpeaker(meta, msgs.slice(0, -1));
    if (!prev || prev === pid) return;
    const p = meta.kind === 'dual' ? 0.07 : 0.05;
    if (Math.random() >= p) return;
    cm.fam(prev, pid).then(function (f) {
      const cap = meta.kind === 'dual' ? 3 : 2;
      if (f.level < cap) cm.bumpFam(prev, pid, 1, meta.kind === 'dual' ? '私聊聊得越来越近' : '群聊里聊得熟络');
    }).catch(function () {});
  }

  /* ---------- 角色间/群内互发照片（任务11，嵌入式本地池 + 抽签袋，零网图） ---------- */
  const PW_PHOTO_REQ = /(照片|自拍|拍一张|拍张|发张|发图|你的照片|交换照片|发张看看|看看你的脸|看看你长|让我看看你|想看看你|看看你|你长什么样|看看你的手|看看手|看看你的腿|看看腿)/;
  const PW_PHOTO_INTIM = /(私密照|裸照|裸体|那话儿|下面|大不大|硬不硬|勃起|鸡巴|几把|尺寸|脱了|脱光|脱给我|露给我|色一点|骚一点|身材|你的身体)/;
  const PW_PHOTO_LEG = /(看看腿|看腿|腿照|你的腿|大腿|小腿|长腿)/;
  const PW_PHOTO_HAND = /(看看手|看手|手照|你的手)/;
  const PW_LAUGH = /(哈哈|笑死|笑喷|开心|好玩|太逗|逗死|乐死|有意思)/;

  function pwPeriod(ts) {
    const h = new Date(ts).getHours();
    if (h >= 20 || h < 5) return 'night';
    if ((h >= 5 && h < 7) || (h >= 17 && h < 20)) return 'dusk';
    return 'day';
  }
  function maybePhotoChar(sid, meta, pid, msgs) {
    const lib = (typeof window !== 'undefined' && window.SCHAT && window.SCHAT.SCHAT_PHOTOS) ||
      (typeof globalThis !== 'undefined' && globalThis.SCHAT && globalThis.SCHAT.SCHAT_PHOTOS) || null;
    if (!lib) return;
    const persona = sync.get(pid);
    if (!persona) return;
    const fromOthers = msgs.slice(0, -1).filter(function (m) { return m.role !== pid && m.type === 'text' && m.text; });
    const last = fromOthers[fromOthers.length - 1];
    if (!last) return;
    const txt = last.text || '';
    let pool = null, poolKind = 'selfie', send = false;
    if (PW_PHOTO_INTIM.test(txt)) { pool = lib[persona.name] && lib[persona.name].priv; poolKind = 'priv'; send = true; }
    else if (PW_PHOTO_LEG.test(txt)) { pool = lib['_公共腿']; poolKind = 'leg'; if (PW_PHOTO_REQ.test(txt)) send = true; }
    else if (PW_PHOTO_HAND.test(txt)) { pool = lib['_公共手']; poolKind = 'hand'; if (PW_PHOTO_REQ.test(txt)) send = true; }
    else if (PW_PHOTO_REQ.test(txt)) { pool = lib[persona.name] && lib[persona.name].selfie; poolKind = 'selfie'; send = true; }
    else if (PW_LAUGH.test(txt) && Math.random() < 0.07) { pool = lib[persona.name] && lib[persona.name].selfie; poolKind = 'selfie'; send = true; }
    if (!send) return;
    if (send && pool && pool.length && Math.random() > 0.85) return; // 要求照片也不是 100% 秒发
    if (!pool || !pool.length) return;
    const key = 'lastphoto:pw:' + sid + ':' + pid;
    return store.get(key, 0).then(function (at) {
      if (Date.now() - at < 20 * 1000) return; // 20 秒冷却
      const filtered = (engine.filterPool ? engine.filterPool(pool, pwPeriod(Date.now()), null, null) : pool) || pool;
      if (!filtered.length) return;
      const draw = engine.drawPhotoExact || null;
      const pick = function () {
        if (!draw) return filtered[Math.floor(Math.random() * filtered.length)];
        return draw('pbag_pw_' + sid + '_' + pid + '_' + poolKind, filtered);
      };
      return Promise.resolve(pick()).then(function (entry) {
        if (!entry) return;
        return store.set(key, Date.now()).then(function () {
          const img = { id: util.uid(), role: pid, type: 'image', text: '', src: entry.s, ts: Date.now() };
          return appendOne(sid, img).then(function () {
            meta.lastGen = Date.now();
            return saveMeta(sid);
          });
        });
      });
    }).catch(function () {});
  }

  /* 角色自发改群昵称（任务6）：聊到兴头/被逗笑/情绪事件时小概率走 API 判定+生成 */
  function maybeChangeGnick(sid, meta, pid, msgs) {
    if (Math.random() >= 0.06) return;
    const recent = msgs.slice(-4).map(function (m) { return m.text || ''; }).join(' ');
    if (!/(哈哈|笑死|笑喷|开心|好玩|太逗|逗死|乐死|气死|无语|服了|绝了|厉害|牛逼|可爱)/.test(recent)) return; // 兴头/情绪事件才触发
    return engine.getSettings().then(function (st) {
      if (!String(st.apiKey || '').trim()) return null;
      const p = sync.get(pid);
      const sys = '你是' + (p.nickname || p.name) + '，正在一个微信群里聊天，刚才聊得正起劲。你心血来潮，想给自己换个群昵称。' +
        '只输出一个新昵称（2-6 个字，符合你的性格，可以俏皮一点，不要符号、不要解释）；如果不想改，只输出「不改」。';
      return api.chat({
        baseURL: st.baseURL, apiKey: st.apiKey, model: st.model, temperature: 1.1,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: '换个群昵称' }],
        maxTokens: 30,
      }).then(function (raw) {
        const t = String(raw || '').trim().replace(/^["'「『\s]+/, '').replace(/["'」』\s]+$/, '');
        if (!t || t === '不改' || t.length < 2 || t.length > 8) return null;
        return t;
      }).catch(function () { return null; });
    }).then(function (nick) {
      if (!nick) return null;
      const old = pw.dispName(meta, pid);
      meta.gnicks = meta.gnicks || {};
      meta.gnicks[pid] = nick;
      const sys = { id: util.uid(), role: 'sys', type: 'text', text: old + ' 将群昵称改为「' + nick + '」', ts: Date.now() };
      return appendOne(sid, sys).then(function () {
        return saveMeta(sid);
      }).then(function () {
        cm.groupEntry(sid, pid + ' 在群里把昵称改成了「' + nick + '」', { layer: 'face', level: 1, impact: 'low' });
        cm.charEntry(pid, '在群「' + (meta.groupName || '群') + '」里把群昵称改成了「' + nick + '」', { layer: 'face', level: 1, impact: 'low' });
        pw.hooks.onState(sid);
        return nick;
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
          if (asleepAt(t, sp)) return cur; // 个人作息：这个时段 TA 在睡，跳过这一条（慢聊/回填）
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
    const realtime = meta.pacing === 'realtime' || (meta.pacing === 'auto' && watching === sid);
    if (!realtime) {
      // 慢聊：全局睡眠窗口生效（顺延到起床）
      if (inSleep(now)) {
        timers[sid] = setTimeout(function () { doTurn(sid); }, Math.min(wakeAt(now) - now, 24 * 3600 * 1000));
        return;
      }
      armNext(sid);
      return;
    }
    /* 实时模式：无视全局睡眠窗口；睡着的角色这一轮不发言、醒着的继续聊 */
    return pw.msgs(sid).then(function (msgs) {
      const sp = pickAwake(meta, msgs, now);
      if (!sp) {
        // 全睡着/只剩刚说过话的：等到最近一个醒来（或稍后重试）
        timers[sid] = setTimeout(function () { doTurn(sid); }, nextWakeDelay(meta, now) + util.randInt(0, 2000));
        return;
      }
      if (busy[sid]) return;
      busy[sid] = true;
      pw.hooks.onTyping(sid, sp);
      const typingMs = util.randInt(pw._INTERVALS.typing[0], pw._INTERVALS.typing[1]);
      return new Promise(function (res) { setTimeout(res, typingMs); }).then(function () {
        return genOne(sid, meta, sp, Date.now());
      }).then(function (msg) {
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

  /* 用户刚发过一条（接管替身 / 群聊插话）→ 醒着的一方回一条。
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
      const now = Date.now();
      const sp = engaged ? pickAwake(meta, msgs, now) : pw.nextSpeaker(meta, msgs);
      if (!sp || !sync.get(sp) || busy[sid]) return;
      if (engaged && asleepAt(now, sp)) return; // 睡着的角色不接话
      busy[sid] = true;
      pw.hooks.onTyping(sid, sp);
      return new Promise(function (res) { setTimeout(res, delay); }).then(function () {
        return genOne(sid, meta, sp, Date.now());
      }).then(function (msg) {
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

  /* 接管发言：以该角色身份发出，对方只当是 TA 本人（不受睡眠限制） */
  pw.sendAs = function (sid, text) {
    const meta = metaCache[sid];
    if (!meta || !meta.takenBy) return Promise.reject(new Error('未在接管状态'));
    const pid = meta.takenBy;
    if (!sync.get(pid)) return Promise.reject(new Error('角色不存在'));
    const t = String(text || '').trim();
    if (!t) return Promise.resolve();
    const msg = { id: util.uid(), role: pid, type: 'text', text: t, ts: Date.now(), actor: 'user' };
    return appendOne(sid, msg).then(function () {
      meta.lastGen = Date.now();
      cm.observe(meta, meta, null); // 用户替身发言也计入对话量
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
    return appendOne(sid, msg).then(function () {
      meta.lastGen = Date.now();
      cm.observe(meta, meta, null);
      return saveMeta(sid);
    }).then(function () { return replyNow(sid); });
  };

  /* ---------- 打开 / 关闭窥屏页 ---------- */
  pw.open = function (sid) {
    watching = sid;
    const meta = metaCache[sid];
    if (!meta) return Promise.resolve();
    meta.genOff = null; // 重新打开：允许再试（Key 可能已补上）
    return runBackfill(sid)
      .then(function () { return enforceCap(sid); })   // 老数据超 120 先裁
      .then(function () { return ensureMinMsgs(sid); }) // 不足 10 条快速补齐
      .then(function () { armNext(sid); });            // 随后进入正常实时节奏
  };
  pw.close = function () {
    if (watching) {
      const meta = metaCache[watching];
      if (meta && meta.pacing === 'auto') clearTimer(watching); // 没在看 → 停实时，改回慢聊
    }
    watching = null;
  };

  /* App 启动：强制实时的会话恢复循环（其余等打开窥屏页时回填）；顺带把超 120 的老数据裁掉 */
  pw.scheduleAll = function () {
    return pw.listMeta().then(function (metas) {
      metas.forEach(function (meta) {
        metaCache[meta.id] = meta;
        enforceCap(meta.id); // 上限硬约束兜底（不阻塞启动）
        if (meta.pacing === 'realtime' && !meta.paused) armNext(meta.id);
      });
    });
  };

  G.privatewatch = pw;
  G.pw = pw;
  if (isNode) module.exports = pw;
})();
