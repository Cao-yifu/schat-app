/* Schat v2 —— 回复引擎
 * 管线：收消息 → 指令解析（RS/LS/【X小时后】）→ 构建分层提示词 → 「对方正在输入…」停顿
 *      → SSE 流式接收、逐字打出（可调速、可停止）→ 整形硬截断 → 入库 →
 *      追问定时（30秒仅一条）→ 偶尔发生活照（data:image 持久化）。
 * 每个情人的请求串行执行（队列），停止按钮通过 AbortController 中止。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const store = isNode ? require('./store.js') : G.store;
  const util = isNode ? require('./util.js') : G.util;
  const tp = isNode ? require('./timeparse.js') : G.timeparse;
  const prompt = isNode ? require('./prompt.js') : G.prompt;
  const api = isNode ? require('./api.js') : G.api;
  const sync = isNode ? require('./sync.js') : G.sync;
  const photos = isNode ? require('./photos.js') : G.photos;

  const engine = {};

  /* 默认设置（设置页可改） */
  engine.DEFAULTS = {
    baseURL: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.8,
    maxChars: 400,        // 硬截断上限（「短为默认」由提示词约束，这里只管兜底）
    cps: 10,              // 打字速度（字/秒）
    followUp: true,
    followUpSec: 30,      // 追问间隔（秒）
    lifeGreet: true,      // 日常主动问候
    photos: true,         // 生活照开关
    keepN: 300,           // 每角色保留消息条数
    historyN: 60,         // 注入模型的历史条数
    intimLib: true,       // 亲密素材参考
    ttsOn: true,          // 语音回复开关（仅明确指令触发）
    ttsBaseURL: 'https://api.siliconflow.cn/v1',
    ttsModel: 'fishaudio/fish-speech-1.5',
    ttsVoice: 'fishaudio/fish-speech-1.5:alex',
    ttsInstruct: '用自然放松的日常口语语气说，不要播音腔，像发微信语音一样随意',
  };
  let settingsCache = null;
  engine.getSettings = function () {
    if (settingsCache) return Promise.resolve(settingsCache);
    return store.get('settings', {}).then(function (s) {
      settingsCache = Object.assign({}, engine.DEFAULTS, s || {});
      /* 语音设置迁移：旧版 CosyVoice/james 已废弃，自动切到 fish-speech-1.5 */
      if (/CosyVoice|james/i.test(settingsCache.ttsModel + ' ' + settingsCache.ttsVoice)) {
        settingsCache.ttsModel = engine.DEFAULTS.ttsModel;
        settingsCache.ttsVoice = engine.DEFAULTS.ttsVoice;
        store.set('settings', settingsCache).catch(function () {});
      }
      return settingsCache;
    });
  };
  engine.saveSettings = function (patch) {
    return engine.getSettings().then(function (s) {
      Object.assign(s, patch);
      return store.set('settings', s).then(function () { settingsCache = s; return s; });
    });
  };

  /* UI 挂钩（ui/app.js 注入） */
  engine.hooks = {
    onMsg: function () {},        // (loverId, msg, kind: 'append'|'update')
    onTyping: function () {},     // (loverId, bool)
    onSys: function () {},        // (loverId, text) —— 轻提示（不入库）
  };
  engine.activeLover = null;      // 当前打开的聊天（未读判断用）

  const running = {};             // loverId -> 运行态
  const queues = {};              // loverId -> Promise 链（串行）
  const followTimers = {};

  function enqueue(loverId, fn) {
    const prev = queues[loverId] || Promise.resolve();
    const next = prev.then(fn).catch(function (e) { console.error('[engine]', e); });
    queues[loverId] = next;
    return next;
  }

  function sysMsg(loverId, text) {
    const msg = { id: util.uid(), role: 'sys', type: 'text', text: text, ts: Date.now() };
    return store.appendMsg(loverId, msg).then(function () {
      engine.hooks.onMsg(loverId, msg, 'append');
      return msg;
    });
  }
  engine.sysMsg = sysMsg;

  function touchUnread(loverId) {
    if (engine.activeLover === loverId) return Promise.resolve();
    return sync.unread(loverId).then(function (n) { return sync.setUnread(loverId, (n || 0) + 1); });
  }

  function appendYou(loverId, msg) {
    return store.appendMsg(loverId, msg).then(function () {
      engine.hooks.onMsg(loverId, msg, 'append');
      return touchUnread(loverId);
    });
  }

  /* ---------- 本地亲密素材：语境检测 + 轮换抽取（不占 API，注入提示词做"语言血液"） ---------- */
  const INTIM_HINTS = /(想你|想要|亲我|抱我|吻|脱|床上|今晚|过来|忍不住|硬了|湿了|进来|深一点|快一点|受不了|轻点|抱紧|别停|舒服|要你|睡你|上你|含住|顶|插|骑|坐上来|腿|腰|呼吸|喘|咬|舔|呻吟|高潮|射|里面|全部给我|趴好|自己动|求我|别躲|别跑|别忍|出声|叫出来|操你|干死|鸡巴|骚逼|骚货|贱货|欠操|妈的|母狗|小婊子|爽死|插进|舔我|射了|叫老公|爬过来|夹得|吸得|好热|好紧|宝贝|宝宝)/;
  const INTIM_STRONG = /(硬了|湿了|进来|深一点|受不了|别停|顶|插|骑|坐上来|呻吟|高潮|射|含住|里面|自己动|求我|叫出来|出声|别忍|趴好|操你|干死|鸡巴|骚逼|贱货|欠操|妈的|母狗|爽死|插进|舔我|射了|叫老公|爬过来|我要你|要你|放倒)/;
  /* 用户反馈触发：要更下流的信号，立即拉高热峰值并锁定脏话风格一段时间 */
  const DIRTY_RE = /(更下流|更脏|再脏|说脏话|脏话|越脏越好|再黄|更黄|放开|别害羞|粗口|再粗|骚一点|贱一点|别装|不准收敛|保持下流|继续下流|别停哦|用力点|再狠)/;
  /* 做爱阶段表：素材与对白跟着剧情走，避免跳戏。
   * 5-7 为射精高潮段：逼近堆叠 → 射精瞬间 → 缓缓下落，氛围词原地停留拉长最高点 */
  const STAGE_NAMES = [
    '前戏调情（接吻、抚摸、撩拨，衣服还穿着）',
    '脱衣贴身（互相脱、肌肤相贴、亲遍）',
    '口活手活（含住、舔、用手指、跪着）',
    '进入（刚插进来那一下，紧、胀）',
    '抽插（节奏、体位、力度，越干越狠）',
    '逼近临界（憋着、越顶越快、要射了——疯话堆叠）',
    '射精瞬间（最高点、爆发）',
    '高潮余波（缓缓下落、抖、瘫、喘）',
    '事后温存（抱着、复盘、余韵，温柔又下流）'
  ];
  const CLIMAX_NOTES = {
    5: '你们正在逼近临界——憋着，越顶越快：这一轮的疯话要快速向上加强、一层层堆叠，短促急促的脏话加上极致逼问（要射了吗？求我。叫出来。谁在操你？）。',
    6: '这是最高潮——射精瞬间：把堆到顶的情绪用爆发式的极致粗口或逼问全部砸出来，这是全程最狠的一轮，别一笔带过。',
    7: '刚射完——缓缓下落：抖、瘫、喘，余韵里还带着下流话，节奏放慢，温柔里带脏，别立刻跳去别的。'
  };

  /* ---------- 场景状态机：事件驱动触发（不是关键词驱动） ----------
   * normal(日常) → warm(暧昧,注入素材) → sex(做爱,API+场景指引)
   * 进入 sex 后：嗯/快点/继续等短回应与氛围词都维持高热；
   * 只有明确话题切换（明天/开会/吃饭等日常话题）才冷却。45分钟无互动自动重置。 */
  const AMBIENT_RE = /(嗯|啊|继续|快点|别停|再深|再快|爽|用力|抱|亲|要|给|干|弄|叫|舒服|对|就这样|别动|转过来|趴|上来|下去|射|出来|接着|轻点|慢点|重点|腿|腰|里面|顶|含|张|硬|湿|高潮|到了|再来|想|好舒服|好爽|好热|好紧|快点呀|快点啊|更深|别出来|快点射|操|痒|酥|麻)/;
  const TOPIC_RE = /(明天|开会|工作|上班|加班|吃饭|吃了吗|天气|回家|到家|睡觉|晚安|早安|忙|出差|项目|客户|合同|学校|上课|考试|家人|爸妈|朋友|逛街|买|电影|下班|老板|同事|房租|钱|账单|医院|挂号|写作业|论文|答辩|简历|面试)/;
  /* 地点感知：提取最近对话里的场所，做爱场景结合空间编排 */
  const PLACE_MAP = [
    ['厕所', /(厕所|洗手间|卫生间|盥洗室)/],
    ['车里', /(车里|车内|后座|停车场|副驾)/],
    ['办公室', /(办公室|会议室|工位|办公桌)/],
    ['酒店', /(酒店|宾馆|客房|房间)/],
    ['床上', /(床上|床)/],
    ['厨房', /(厨房|灶台)/],
    ['浴室', /(浴室|淋浴|卫生间洗澡)/],
    ['户外', /(天台|阳台|公园|草地|海边|江边|帐篷|野外|操场|楼顶)/]
  ];

  function sniffPlace(msgs) {
    let place = null;
    for (const m of msgs.slice(-8)) {
      if (!m.text) continue;
      for (const [name, re] of PLACE_MAP) {
        if (re.test(m.text)) place = name; // 后出现的覆盖，取最新
      }
    }
    return place;
  }

  function updateScene(loverId) {
    return store.msgs(loverId).then(function (msgs) {
      const meMsgs = msgs.filter(function (m) { return m.role === 'me'; });
      const lastMe = meMsgs.length ? (meMsgs[meMsgs.length - 1].text || '') : '';
      return store.get('scene_' + loverId, null).then(function (sc) {
        const nowTs = Date.now();
        if (sc && (nowTs - sc.ts > 45 * 60 * 1000)) sc = null; // 45分钟无互动重置
        let heat = (sc && sc.heat != null) ? sc.heat : 0;
        const wasSex = !!(sc && sc.mode === 'sex');

        const hasStrong = INTIM_STRONG.test(lastMe);
        const hasTrig = INTIM_HINTS.test(lastMe);
        const hasAmb = AMBIENT_RE.test(lastMe) && lastMe.length <= 6; // 氛围词必须是短回应，防止长句里的"啊/要"误维持
        const hasTopic = TOPIC_RE.test(lastMe);
        const hasDirty = DIRTY_RE.test(lastMe);

        /* 热度曲线：波峰快、衰减慢。
         * 露骨词/更下流反馈 → 直接到峰顶 100；暧昧词 +20（渐进升温）；氛围短词 +8（维持）；
         * 明确日常话题 → 立即冷却到 15（退出场景）；中性消息 -12（缓慢衰减，峰值可持续约3-4轮）。 */
        if (hasDirty || hasStrong) heat = 100;
        else if (hasTopic && !hasStrong && !hasDirty) heat = 15;
        else if (hasTrig) heat = Math.min(100, heat + 20);
        else if (hasAmb) heat = Math.min(100, heat + 8);
        else heat = Math.max(0, heat - 12);

        const mode = heat >= 60 ? 'sex' : (heat >= 20 ? 'warm' : 'normal');
        let stage = null;
        if (mode === 'sex') {
          if (!wasSex) {
            stage = 0; // 进入 sex 从第 0 阶段开始
          } else {
            const cur = (sc.stage == null ? -1 : sc.stage);
            // 射精高潮段（5-7）：用户用氛围词维持时原地停留，把最高点拉长，别太短促
            if (cur >= 5 && hasAmb && !hasStrong && !hasTrig) stage = cur;
            else stage = Math.min(8, cur + 1); // 到事后温存封顶
          }
        }
        const place = sniffPlace(msgs) || (sc && sc.place) || null;
        const tier = mode === 'sex' ? 2 : (mode === 'warm' ? 1 : 0);
        return store.set('scene_' + loverId, {
          mode: mode, ts: nowTs, place: place, heat: heat, stage: stage,
          dirty: hasDirty || (!!sc && sc.dirty && heat >= 60) // 波峰期内脏话风格锁定，衰减出峰后解除
        }).then(function () { return tier; });
      });
    });
  }

  function pickIntimLines(loverId, persona, heat) {
    const lib = (typeof window !== 'undefined' && window.SCHAT_INTIM) || (typeof globalThis !== 'undefined' && globalThis.SCHAT_INTIM) || null;
    if (!lib || heat < 1) return '';
    return Promise.all([store.msgs(loverId), store.get('scene_' + loverId, null)]).then(function (r) {
      const msgs = r[0], sc = r[1];
      // 轮换：按已用素材次数取模，避免重复
      const used = msgs.filter(function (m) { return m.intim; }).length;
      const pick = function (pool, n) {
        const out = [];
        if (!pool || !pool.length) return out; // 素材池为空时不能取模，否则注入 undefined
        for (let i = 0; i < n; i++) out.push(pool[(used * n + i * 7 + (used % 3)) % pool.length]);
        return out;
      };
      const one = function (pool) { return (pool && pool.length) ? pick(pool, 1)[0] : null; };
      const perPool = (lib.per && lib.per[persona.name]) || (lib.per && lib.per['孙铎']) || [];
      const cliPool = (lib.climax && lib.climax[persona.name]) || (lib.climax && lib.climax['孙铎']) || [];
      const stage = sc && sc.stage;
      const lines = [];
      if (heat >= 2) {
        // 阶段配池：素材跟着剧情走，前后连贯不跳戏
        if (stage === 0) { lines.push.apply(lines, pick(lib.scenes.tease, 2)); const x = one(perPool); if (x) lines.push(x); }
        else if (stage === 1) { lines.push.apply(lines, pick(lib.scenes.heat, 2)); const x = one(perPool); if (x) lines.push(x); }
        else if (stage === 2) { const x = one(lib.scenes.hard); if (x) lines.push(x); const y = one(lib.scenes.heat); if (y) lines.push(y); const z = one(perPool); if (z) lines.push(z); }
        else if (stage === 3) { lines.push.apply(lines, pick(lib.scenes.push, 2)); const x = one(perPool); if (x) lines.push(x); }
        else if (stage === 4) { lines.push.apply(lines, pick(lib.scenes.hard, 2)); const x = one(lib.scenes.bed); if (x) lines.push(x); }
        else if (stage === 5) { lines.push.apply(lines, pick(cliPool, 2)); const x = one(lib.scenes.moan); if (x) lines.push(x); }
        else if (stage === 6) { const x = one(cliPool); if (x) lines.push(x); const y = one(lib.scenes.moan); if (y) lines.push(y); const z = one(lib.scenes.dirty); if (z) lines.push(z); }
        else if (stage === 7) { const x = one(lib.scenes.moan); if (x) lines.push(x); const y = one(lib.scenes.after); if (y) lines.push(y); const z = one(perPool); if (z) lines.push(z); }
        else if (stage === 8) { lines.push.apply(lines, pick(lib.scenes.after, 2)); const x = one(perPool); if (x) lines.push(x); }
        else {
          if (lib.scenes.hard && lib.scenes.hard.length) lines.push.apply(lines, pick(lib.scenes.hard, 2));
          const x = one(lib.scenes.bed); if (x) lines.push(x);
        }
      } else if (heat === 1) {
        if (lib.scenes.heat && lib.scenes.heat.length) lines.push.apply(lines, pick(lib.scenes.heat, 2));
        const x = one(perPool); if (x) lines.push(x);
      }
      if (!lines.length) return ''; // 整库为空就不注入，免得提示词里出现空参考段
      return '\n【本地素材参考】以下是几句贴合此刻气氛的话，可以照用、也可以按你的口吻重组，不要整段照抄：\n' +
        lines.map(function (s) { return '· ' + s; }).join('\n');
    });
  }

  /* 场景指引（不塞本地句）：做爱场景里让 API 贴着场景写，前后连贯 + 阶段递进 + 波峰持续 */
  function sceneGuide(loverId, ctx) {
    return store.get('scene_' + loverId, null).then(function (sc) {
      let note = '现在你们已经在床上了，正在进行中：不许提工作、行程、巡馆、开会、吃饭这类无关的事，你写的内容只能是此刻床上的反应、动作和下流话。必须接着对方刚说的话和动作往下回应，不许自顾自另起一段。';
      const stage = sc && sc.stage;
      if (stage != null) {
        if (CLIMAX_NOTES[stage]) note += CLIMAX_NOTES[stage];
        else if (STAGE_NAMES[stage]) {
          note += '你们正在进行「' + STAGE_NAMES[stage] + '」这一步：这一轮的对白、动作、下流话必须贴住这一步写，别跳步骤（还没进入就别喊射、已经射完就别重新开始），一步一步往前推。';
        }
      }
      if (sc && sc.dirty) {
        note += '对方刚让你更下流——现在正是波峰：接下来连续几轮都要保持最脏、最直接的尺度和下流话，只升不降，绝不在这一两轮收敛、变客气、道歉或岔开话题。';
      }
      const place = sc && sc.place;
      if (place) {
        note += '你们此刻就在「' + place + '」里：把这里的空间、物件、声音、姿势限制、随时被撞见的紧张感揉进你的动作和下流话里，写得具体一点、长一点。';
      } else {
        note += '这条可以写长一点（几十个字），把过程写出来，长短句错落。';
      }
      ctx.extra = (ctx.extra ? ctx.extra + '\n' : '') + '\n【场景】' + note;
      return ctx;
    });
  }

  /* 组装动态层 ctx */
  function buildCtx(loverId, extra) {
    return Promise.all([
      sync.rs(loverId), sync.ls(loverId), sync.offset(loverId), sync.promises(loverId),
    ]).then(function (r) {
      const now = Date.now() + r[2];
      const open = [], due = [];
      for (const p of (r[3] || [])) {
        if (p.done) continue;
        if (p.due <= now + 30 * 1000) due.push(p); else open.push(p);
      }
      return { rs: r[0], ls: r[1], offsetMs: r[2], promises: { open: open, due: due }, extra: extra || '' };
    });
  }

  /* 核心：调 API + 流式逐字打出。opts.extra 追加系统提示；opts.follow 标记追问 */
  function streamReply(loverId, persona, opts) {
    opts = opts || {};
    return engine.getSettings().then(function (st) {
      if (!st.apiKey) throw Object.assign(new Error('先在「设置」里填入 API Key'), { noKey: true });
      const heatP = (st.intimLib !== false && !opts.noIntim) ? updateScene(loverId) : Promise.resolve(0);
      return heatP.then(function (heat) {
        const photoNote = opts.photoSent ? '（你刚给对方发了一张照片。不要用文字描述照片里的内容、不要说照片是在哪拍的、不要点评画面，像平时一样接话就行。）' : '';
        return buildCtx(loverId, (opts.extra || '') + photoNote).then(function (ctx) {
          // 全部走 API 生成（用户要求：更多 API 参与，前后句逻辑连贯；不做本地直出、不强制塞本地句）
          if (heat >= 1) {
            return pickIntimLines(loverId, persona, heat).then(function (lines) {
              if (lines) ctx.extra = (ctx.extra ? ctx.extra + '\n' : '') + lines;
              return ctx;
            }).then(function (ctx2) {
              if (heat >= 2 && st.intimLib !== false) return sceneGuide(loverId, ctx2);
              return ctx2;
            });
          }
          return ctx;
        }).then(function (ctx) {
            const system = prompt.buildSystem(persona, ctx);
            return store.msgs(loverId).then(function (history) {
          const messages = [{ role: 'system', content: system }].concat(prompt.buildHistory(history, st.historyN));
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const state = running[loverId] = {
            controller: controller, buffer: '', released: '', done: false,
            streamEnded: false, error: null, msg: null, timer: null, persistTimer: null,
            maxChars: st.maxChars, // 停止截断要与 finalize 用同一上限（原来 stop 里写死 400）
          };
          engine.hooks.onTyping(loverId, true);

          /* 逐字打出：tick 节奏释放 buffer；流结束且倒空后 finalize */
          function startTyping() {
            const cps = Math.max(2, Math.min(40, st.cps || 10));
            const tickMs = 100;
            const perTick = Math.max(1, Math.round(cps * tickMs / 1000));
            state.timer = setInterval(function () {
              if (state.done) { finishTyping(); return; }
              if (state.buffer) {
                const n = Math.min(state.buffer.length, perTick + util.randInt(0, 2));
                state.released += state.buffer.slice(0, n);
                state.buffer = state.buffer.slice(n);
                if (!state.msg) {
                  state.msg = { id: util.uid(), role: 'you', type: 'text', text: state.released, ts: Date.now() };
                  if (opts.follow) state.msg.follow = true;
                  
                  if (ctx.extra && ctx.extra.indexOf('【本地素材参考】') >= 0) state.msg.intim = true;
                  store.appendMsg(loverId, state.msg).then(function () {
                    engine.hooks.onMsg(loverId, state.msg, 'append');
                  });
                } else {
                  state.msg.text = state.released;
                  engine.hooks.onMsg(loverId, state.msg, 'update');
                  if (!state.persistTimer) {
                    state.persistTimer = setTimeout(function () {
                      state.persistTimer = null;
                      if (state.msg) store.updateMsg(loverId, state.msg).catch(function (e) { console.error('[engine]', e); });
                    }, 600);
                  }
                }
              } else if (state.streamEnded) {
                finishTyping();
                finalize(state.released);
              }
            }, tickMs);
          }
          function finishTyping() {
            if (state.timer) { clearInterval(state.timer); state.timer = null; }
            if (state.persistTimer) { clearTimeout(state.persistTimer); state.persistTimer = null; }
            engine.hooks.onTyping(loverId, false);
          }

          function finalize(raw) {
            if (state.finalized) return state.result;
            state.finalized = true;
            state.done = true;
            delete running[loverId];
            let text = prompt.truncate(raw, st.maxChars);
            if (state.error && !text) { state.result = Promise.reject(state.error); return state.result; }
            if (state.msg) {
              state.msg.text = text;
              state.msg.ts = Date.now();
              state.result = store.updateMsg(loverId, state.msg).then(function () {
                engine.hooks.onMsg(loverId, state.msg, 'update');
                return afterReply(loverId, persona, state.msg, opts);
              }).then(function () { return text; });
              return state.result;
            }
            if (!text) { state.result = Promise.resolve(''); return state.result; }
            const msg = { id: util.uid(), role: 'you', type: 'text', text: text, ts: Date.now() };
            if (opts.follow) msg.follow = true;
            
            state.result = appendYou(loverId, msg).then(function () {
              return afterReply(loverId, persona, msg, opts);
            }).then(function () { return text; });
            return state.result;
          }

          /* 「对方正在输入…」停顿后再发请求，拟真人节奏 */
          const delay = util.randInt(700, 2200);
          startTyping();
          return new Promise(function (resolve) { setTimeout(resolve, delay); }).then(function () {
            if (state.done) return state.released; // 停顿期间被停止
            return api.chat({
              baseURL: st.baseURL, apiKey: st.apiKey, model: st.model,
              temperature: st.temperature,
              messages: messages,
              maxTokens: Math.min(900, Math.max(120, Math.round(st.maxChars * 1.8))),
              signal: controller ? controller.signal : undefined,
              onToken: function (piece) { state.buffer += piece; },
            }).then(function () {
              state.streamEnded = true; // 由打字循环收尾
              return waitFinalized(state);
            }, function (err) {
              if (state.done) { return state.released; } // 手动停止
              state.error = err;
              state.streamEnded = true;
              return waitFinalized(state);
            });
          });
        });
      });
      });
    });

    function waitFinalized(state) {
      return new Promise(function (resolve, reject) {
        const check = setInterval(function () {
          if (state.result) {
            clearInterval(check);
            state.result.then(resolve, reject);
          } else if (state.done && !state.timer) {
            clearInterval(check);
            resolve(state.released);
          }
        }, 100);
      });
    }
  }

  /* 回复完成后的收尾：追问定时、照片、裁剪 */
  function afterReply(loverId, persona, msg, opts) {
    const jobs = [];
    jobs.push(maybeVoice(loverId, persona, msg));
    jobs.push(engine.getSettings().then(function (st) {
      if (st.followUp && !opts.noFollow && !opts.follow) armFollowUp(loverId, persona, st);
    }));
    jobs.push(maybePhoto(loverId, persona));
    jobs.push(engine.getSettings().then(function (st) {
      return store.trimMsgs(loverId, st.keepN || engine.DEFAULTS.keepN).catch(function () {});
    }));
    // 承诺管线：本条回复里新出现的明确时间约定入库；已到期的顺手核销——
    // 本轮提示词已把它们列为「到期必须兑现/交代」，这条回复就是对它们的处理
    jobs.push(sync.promises(loverId).then(function (arr) {
      const now = Date.now();
      let chain = Promise.resolve();
      arr.forEach(function (p, i) {
        if (!p.done && p.due <= now) chain = chain.then(function () { return sync.settlePromise(loverId, i); });
      });
      return chain.then(function () {
        const found = tp.extractPromises(msg.text, new Date());
        if (found.length) return sync.addPromises(loverId, found);
      });
    }));
    return Promise.all(jobs);
  }

  /* 30 秒追问（仅一条）——程序化话术池轮换，零 API、零延迟、绝不自问自答不开新话题 */
  const FOLLOW_POOL = ['怎么不说话了', '怎么了？', '你在想什么？', '没想好吗？', '睡着了？', '人呢'];
  let followIdx = 0;
  function armFollowUp(loverId, persona, st) {
    clearTimeout(followTimers[loverId]);
    followTimers[loverId] = setTimeout(function () {
      if (!sync.get(loverId)) return; // 角色已删除：追问别再把它的聊天记录复活
      store.msgs(loverId).then(function (arr) {
        const last = arr[arr.length - 1];
        if (!last || last.role !== 'you') return; // 用户已经回过话了
        if (running[loverId]) return;
        const text = FOLLOW_POOL[followIdx % FOLLOW_POOL.length];
        followIdx += 1;
        appendYou(loverId, { id: util.uid(), role: 'you', type: 'text', text: text, ts: Date.now() });
      });
    }, (st.followUpSec || 30) * 1000);
  }
  function cancelFollowUp(loverId) { clearTimeout(followTimers[loverId]); }

  /* 语音回复：只有明确指令触发，一次触发最多 3 条，用尽即停（控制成本）。
   * 云端合成：需要语音 Key（OpenAI 兼容 /audio/speech，如 SiliconFlow CosyVoice2）。 */
  const VOICE_REQ_RE = /(用语音|语音回|发语音|发条语音|来条语音|语音一下|给我语音|用语音说|语音说|发句语音|语音消息|语音条|想听你的声音|听你声音|说话给我听|你的声音)/;
  function maybeVoice(loverId, persona, msg) {
    if (!msg || msg.type !== 'text' || !msg.text) return Promise.resolve();
    return Promise.all([
      engine.getSettings(),
      store.get('voice_' + loverId, null),
      store.get('voicePref_' + loverId, null),
    ]).then(function (r) {
      const st = r[0], vs = r[1], pref = r[2];
      if (!vs || !vs.left || vs.left <= 0) return;
      if (st.ttsOn === false) return;
      if (!st.ttsKey || !st.ttsBaseURL) return; // 没配 Key 不出语音
      return store.set('voice_' + loverId, { left: vs.left - 1 }).then(function () {
        return api.tts({
          baseURL: st.ttsBaseURL,
          apiKey: st.ttsKey,
          model: st.ttsModel || 'FunAudioLLM/CosyVoice2-0.5B',
          voice: (persona.ttsVoice || (pref && pref.name) || st.ttsVoice) || 'FunAudioLLM/CosyVoice2-0.5B:alex',
          instruction: persona.ttsInstruct || st.ttsInstruct || '',
          text: msg.text,
        }).then(function (blob) {
          if (!blob) return;
          msg.audioUrl = URL.createObjectURL(blob);
          return store.updateMsg(loverId, msg).catch(function () {}).then(function () {
            engine.hooks.onMsg(loverId, msg, 'update');
          });
        });
      });
    }).catch(function () {});
  }

  /* 抽签袋：随机不重复抽取，抽完一轮再重新洗牌 */
  /* 照片上下文过滤：时段/室内外/角度（与角色当前时空一致） */
  const OUTDOOR_PLACE_RE = /(车里|车内|停车场|天台|阳台|公园|海边|江边|户外|街上|路上|操场)/;
  const INDOOR_PLACE_RE = /(厕所|卫生间|洗手间|办公室|会议室|酒店|宾馆|房间|床上|厨房|浴室|淋浴|展馆|展厅|家里|我家|你家|宿舍)/;
  function nowPeriod(loverId) {
    return sync.offset(loverId).then(function (off) {
      const h = new Date(Date.now() + off).getHours();
      if (h >= 20 || h < 5) return 'night';
      if ((h >= 5 && h < 7) || (h >= 17 && h < 20)) return 'dusk';
      return 'day';
    });
  }
  function filterPool(pool, period, prefIn, prefAngle) {
    let ok = pool.filter(function (e) {
      if (period === 'night') return e.t === 'night' || e.t === 'dusk';
      if (period === 'day') return e.t === 'day' || e.t === 'dusk';
      return e.t === 'dusk' || e.t === 'any';
    });
    if (!ok.length) ok = pool;
    if (prefIn !== null) {
      const inOk = ok.filter(function (e) { return e.in === prefIn || e.in == null; });
      if (inOk.length) ok = inOk;
    }
    if (prefAngle) {
      const aOk = ok.filter(function (e) { return e.a === prefAngle; });
      if (aOk.length) ok = aOk;
    }
    return ok;
  }
  function placePrefIn(loverId) {
    return store.get('scene_' + loverId, null).then(function (sc) {
      const place = sc && sc.place;
      if (!place) return null;
      if (OUTDOOR_PLACE_RE.test(place)) return 0;
      if (INDOOR_PLACE_RE.test(place)) return 1;
      return null;
    });
  }
  function shuffled(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function drawPhoto(loverId, poolKind, pool) {
    const key = 'pbag_' + loverId + '_' + poolKind;
    return store.get(key, null).then(function (bag) {
      if (!bag || !bag.order || bag.order.length !== pool.length) {
        bag = { order: shuffled(pool.length), pos: 0 };
      }
      if (bag.pos >= bag.order.length) {
        bag.order = shuffled(pool.length);
        bag.pos = 0;
      }
      const idx = bag.order[bag.pos];
      bag.pos += 1;
      return store.set(key, bag).then(function () { return pool[idx]; });
    });
  }

  /* 偶尔主动发一张自拍（嵌入式本地池：时段+室内外匹配，零网图） */
  function maybePhoto(loverId, persona) {
    return engine.getSettings().then(function (st) {
      if (!st.photos) return;
      const lib = (typeof window !== 'undefined' && window.SCHAT && window.SCHAT.SCHAT_PHOTOS) || (typeof globalThis !== 'undefined' && globalThis.SCHAT && globalThis.SCHAT.SCHAT_PHOTOS) || null;
      const pool = lib && lib[persona.name] && lib[persona.name].selfie;
      if (!pool || !pool.length) return;
      return Promise.all([sync.lastPhotoAt(loverId), nowPeriod(loverId), placePrefIn(loverId)]).then(function (res) {
        if (Date.now() - res[0] < 10 * 60 * 1000) return;
        if (Math.random() > 0.16) return;
        const filtered = filterPool(pool, res[1], res[2], null);
        return drawPhoto(loverId, 'selfie', filtered).then(function (entry) {
          return sync.setLastPhotoAt(loverId, Date.now()).then(function () {
            const msg = { id: util.uid(), role: 'you', type: 'image', text: '', src: entry.s, ts: Date.now() };
            return appendYou(loverId, msg);
          });
        });
      });
    }).catch(function () {});
  }

  /* 对方明确要照片：立刻从嵌入式本地池取一张发过去（零网图）
   * 私密词→该角色私密照池；腿→公共腿；手→公共手；自拍/普通照片→该角色自拍池 */
  const PHOTO_REQ_RE = /(照片|自拍|拍给我|拍一张|发张|来张|发图|看看你的腿|看看腿|看看你的手|看看手|看看你的脸|看看你长|让我看看你|想看看你|看看你)/;
  const PHOTO_INTIM_RE = /(私密照|裸照|裸体|那话儿|你的下面|看看下面|下面给我|大不大|硬不硬|勃起|鸡巴|几把|尺寸|脱了|脱光|脱给我|露给我|色一点|骚一点|来点刺激)/;
  const PHOTO_LEG_RE = /(看看腿|看腿|腿照|给我看.*腿|你的腿|大腿|小腿|长腿)/;
  const PHOTO_HAND_RE = /(看看手|看手|手照|给我看.*手|你的手)/;
  function sendPhotoNow(loverId, persona, text) {
    return engine.getSettings().then(function (st) {
      if (!st.photos) return false;
      const lib = (typeof window !== 'undefined' && window.SCHAT && window.SCHAT.SCHAT_PHOTOS) || (typeof globalThis !== 'undefined' && globalThis.SCHAT && globalThis.SCHAT.SCHAT_PHOTOS) || null;
      if (!lib) return false;
      let pool = null, poolKind = 'selfie';
      if (PHOTO_INTIM_RE.test(text)) { pool = (lib[persona.name] && lib[persona.name].priv) || []; poolKind = 'priv'; }
      else if (PHOTO_LEG_RE.test(text)) { pool = lib['_公共腿'] || []; poolKind = 'leg'; }
      else if (PHOTO_HAND_RE.test(text)) { pool = lib['_公共手'] || []; poolKind = 'hand'; }
      else pool = (lib[persona.name] && lib[persona.name].selfie) || [];
      if (!pool.length) return false;
      return Promise.all([sync.lastPhotoAt(loverId), nowPeriod(loverId), placePrefIn(loverId)]).then(function (res) {
        if (Date.now() - res[0] < 20 * 1000) return false; // 20 秒内刚发过，不再连发
        let prefAngle = null;
        if (/(看看你的脸|看看你长|让我看看你)/.test(text)) prefAngle = 'close';
        const filtered = filterPool(pool, res[1], res[2], prefAngle);
        return drawPhoto(loverId, poolKind, filtered).then(function (entry) {
          return sync.setLastPhotoAt(loverId, Date.now()).then(function () {
            const msg = { id: util.uid(), role: 'you', type: 'image', text: '', src: entry.s, ts: Date.now() };
            return appendYou(loverId, msg).then(function () { return true; });
          });
        });
      });
    }).catch(function () { return false; });
  }

  function handleErr(loverId) {
    return function (err) {
      if (err && err.noKey) return sysMsg(loverId, '还没填 API Key：去「设置 → AI 接口」填好后重新发。');
      console.warn('[回复失败]', err);
      return sysMsg(loverId, 'TA 没回消息（' + (err && err.message ? err.message : '网络错误') + '），再发一条试试。');
    };
  }

  /* 用户发消息（指令 + 普通聊天） */
  engine.send = function (loverId, text, quote) {
    const persona = sync.get(loverId);
    if (!persona) return Promise.reject(new Error('角色不存在'));
    cancelFollowUp(loverId);
    return enqueue(loverId, function () {
      const skip = tp.parseSkipHours(text);
      if (skip !== null) {
        return sync.addOffset(loverId, Math.round(skip * 3600000)).then(function () {
          return sync.offset(loverId);
        }).then(function (off) {
          const fut = new Date(Date.now() + off);
          return sysMsg(loverId, '【时间快进】已快进到 ' + tp.nowText(fut));
        }).then(function () {
          const extra = '用户发来「' + text.slice(0, 20) + '」，你们刚才有一段时间没说话，时间已经过去了。按照你现在的作息状态，自然地重新开口（刚睡醒/刚下班/刚忙完），一两句即可。';
          return streamReply(loverId, persona, { extra: extra }).catch(handleErr(loverId));
        });
      }
      const rsM = text.match(/^\s*RS\s*[:：]?\s*([\s\S]+)$/i);
      if (rsM) {
        return sync.addRS(loverId, rsM[1].trim()).then(function () {
          return sysMsg(loverId, '【RS】已永久写入设定');
        }).then(function () {
          return streamReply(loverId, persona, {}).catch(handleErr(loverId));
        });
      }
      const lsM = text.match(/^\s*LS\s*[:：]?\s*([\s\S]+)$/i);
      if (lsM) {
        return sync.setLS(loverId, lsM[1].trim()).then(function () {
          return sysMsg(loverId, '【LS】本次会话已生效，清空聊天后失效');
        }).then(function () {
          return streamReply(loverId, persona, {}).catch(handleErr(loverId));
        });
      }
      const msg = { id: util.uid(), role: 'me', type: 'text', text: text, ts: Date.now(), quote: quote || null };
      const wantPhoto = PHOTO_REQ_RE.test(text) || PHOTO_INTIM_RE.test(text) || PHOTO_LEG_RE.test(text) || PHOTO_HAND_RE.test(text);
      if (VOICE_REQ_RE.test(text)) {
        // 明确指令：TA 接下来最多用 3 条语音回复（用尽自动停，控制成本）
        store.set('voice_' + loverId, { left: 3 });
        engine.getSettings().then(function (st) {
          if (!st.ttsKey) {
            engine.hooks.onSys(loverId, '还没填语音 Key：去「设置 → 语音」填上硅基流动的 sk- 开头的 Key，才能发语音');
          } else {
            engine.hooks.onSys(loverId, '接下来 TA 会用语音回你（最多 3 条）');
          }
        });
      }
      return store.appendMsg(loverId, msg).then(function () {
        engine.hooks.onMsg(loverId, msg, 'append');
        if (wantPhoto) {
          // 明确要照片：先自动发一张（本地嵌入式池，按当前时段/场景筛选），再让 TA 文字回应
          return sendPhotoNow(loverId, persona, text).then(function (sent) {
            return streamReply(loverId, persona, sent ? { photoSent: true } : {}).catch(handleErr(loverId));
          });
        }
        return streamReply(loverId, persona, {}).catch(handleErr(loverId));
      });
    });
  };

  /* 停止生成 */
  engine.stop = function (loverId) {
    const st = running[loverId];
    if (!st) return;
    st.done = true;
    if (st.controller) st.controller.abort();
    if (st.timer) { clearInterval(st.timer); st.timer = null; }
    if (st.persistTimer) { clearTimeout(st.persistTimer); st.persistTimer = null; }
    engine.hooks.onTyping(loverId, false);
    if (st.msg) {
      st.msg.text = prompt.truncate(st.released + st.buffer, st.maxChars || 400);
      st.msg.stopped = true;
      store.updateMsg(loverId, st.msg).catch(function (e) { console.error('[engine]', e); });
      engine.hooks.onMsg(loverId, st.msg, 'update');
    }
    delete running[loverId];
  };
  engine.isRunning = function (loverId) { return !!running[loverId]; };

  function shouldLifeGreet(lastTs, lastHiTs, nowMs, rnd, st) {
    if (!st || st.lifeGreet === false || !String(st.apiKey || '').trim()) return false;
    if (!Number.isFinite(nowMs) || !Number.isFinite(lastTs)) return false;
    const hour = new Date(nowMs).getHours();
    if (hour < 8 || hour > 23) return false;
    if (nowMs - lastTs < 18 * 3600 * 1000) return false;
    if (lastHiTs && (!Number.isFinite(lastHiTs) || nowMs - lastHiTs < 24 * 3600 * 1000)) return false;
    return rnd < 0.25;
  }
  engine.shouldLifeGreet = shouldLifeGreet;

  /* 生活作息主动问候：隔一两天偶尔自然地想起对方 */
  engine.lifeTick = function () {
    return engine.getSettings().then(function (st) {
      if (st.lifeGreet === false || !String(st.apiKey || '').trim()) return;
      const jobs = sync.list().map(function (persona) {
        return store.msgs(persona.id).then(function (arr) {
          const last = arr[arr.length - 1];
          if (!last) return;
          return store.get('lifeHi_' + persona.id, 0).then(function (lastHiTs) {
            const now = Date.now();
            if (!shouldLifeGreet(last.ts, lastHiTs, now, Math.random(), st)) return;
            return store.set('lifeHi_' + persona.id, now).then(function () {
              return enqueue(persona.id, function () {
                const extra = '按你的生活作息，此刻你自然想起了他（或正好有事想跟他说）。用你的口吻主动给他发一条消息，比如问他在干嘛、提醒他吃饭、分享一件小事，就一条，简短1-2句。不要显得生硬，不要提"好久没联系"。';
                return streamReply(persona.id, persona, { extra: extra }).catch(function (e) {
                  console.warn('[日常问候失败]', e && e.message);
                });
              });
            });
          });
        });
      });
      return Promise.all(jobs).catch(function (e) {
        console.warn('[lifeTick]', e && e.message); // 定时器入口必须兜住：一次失败不能变成未处理的 rejection
      });
    });
  };

  G.engine = engine;
  if (isNode) module.exports = engine;
})();
