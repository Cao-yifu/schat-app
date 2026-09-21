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
    intimLib: true,       // 本地亲密素材库：亲密语境自动注入本地话术
  };
  let settingsCache = null;
  engine.getSettings = function () {
    if (settingsCache) return Promise.resolve(settingsCache);
    return store.get('settings', {}).then(function (s) {
      settingsCache = Object.assign({}, engine.DEFAULTS, s || {});
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
        let mode = (sc && sc.mode) || 'normal';
        const nowTs = Date.now();
        if (sc && (nowTs - sc.ts > 45 * 60 * 1000)) { mode = 'normal'; sc = null; } // 45分钟无互动重置

        const hasStrong = INTIM_STRONG.test(lastMe);
        const hasTrig = INTIM_HINTS.test(lastMe);
        const hasAmb = AMBIENT_RE.test(lastMe);
        const hasTopic = TOPIC_RE.test(lastMe);

        if (mode === 'sex') {
          // 做爱场景：短回应/氛围词/暧昧词都维持高热；只有明确日常话题才退出
          if (hasTopic && !hasTrig && !hasStrong && !hasAmb) mode = 'normal';
          else if (hasTopic && !hasStrong && lastMe.length > 10) mode = 'warm';
          else mode = 'sex';
        } else if (mode === 'warm') {
          if (hasStrong) mode = 'sex';
          else if (hasTrig || hasAmb) mode = 'warm';
          else if (hasTopic && !hasAmb) mode = 'normal';
          else mode = 'warm';
        } else {
          if (hasStrong) mode = 'sex';
          else if (hasTrig) mode = 'warm';
          else mode = 'normal';
        }

        const heat = mode === 'sex' ? 2 : (mode === 'warm' ? 1 : 0);
        // 地点任何模式都跟踪：先约地点再进状态的对话才能接上场景
        const place = sniffPlace(msgs) || (sc && sc.place) || null;
        return store.set('scene_' + loverId, { mode: mode, ts: nowTs, place: place }).then(function () {
          return heat;
        });
      });
    });
  }

  function pickIntimLines(loverId, persona, heat) {
    const lib = (typeof window !== 'undefined' && window.SCHAT_INTIM) || (typeof globalThis !== 'undefined' && globalThis.SCHAT_INTIM) || null;
    if (!lib || heat < 1) return '';
    return store.msgs(loverId).then(function (msgs) {
      // 轮换：按已用素材次数取模，避免重复
      const used = msgs.filter(function (m) { return m.intim; }).length;
      const pick = function (pool, n) {
        const out = [];
        if (!pool || !pool.length) return out; // 素材池为空时不能取模，否则注入 undefined
        for (let i = 0; i < n; i++) out.push(pool[(used * n + i * 7 + (used % 3)) % pool.length]);
        return out;
      };
      const lines = [];
      if (heat >= 2) {
        if (lib.scenes.hard && lib.scenes.hard.length) lines.push.apply(lines, pick(lib.scenes.hard, 2));
        if (lib.scenes.bed && lib.scenes.bed.length) lines.push(pick(lib.scenes.bed, 1)[0]);
      } else if (heat === 1) {
        if (lib.scenes.heat && lib.scenes.heat.length) lines.push.apply(lines, pick(lib.scenes.heat, 2));
      }
      const pool = (lib.per && lib.per[persona.name]) || (lib.per && lib.per['孙铎']) || [];
      if (pool.length) lines.push.apply(lines, pick(pool, 2));
      if (!lines.length) return ''; // 整库为空就不注入，免得提示词里出现空参考段
      return '\n【本地素材参考】以下是几句贴合此刻气氛的话，可以照用、也可以按你的口吻重组，不要整段照抄：\n' +
        lines.map(function (s) { return '· ' + s; }).join('\n');
    });
  }

  /* 场景指引（不塞本地句）：做爱场景里让 API 贴着场景写，前后连贯 */
  function sceneGuide(loverId, ctx) {
    return store.get('scene_' + loverId, null).then(function (sc) {
      let note = '现在你们已经在床上了，正在进行中：不许提工作、行程、巡馆、开会、吃饭这类无关的事，你写的内容只能是此刻床上的反应、动作和下流话。必须接着对方刚说的话和动作往下回应，不许自顾自另起一段。';
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
        return buildCtx(loverId, opts.extra).then(function (ctx) {
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

  /* 30 秒追问（仅一条）——走 API 生成，保证追问接得上上文 */
  function armFollowUp(loverId, persona, st) {
    clearTimeout(followTimers[loverId]);
    const armedAt = Date.now();
    followTimers[loverId] = setTimeout(function () {
      if (!sync.get(loverId)) return; // 角色已删除：追问别再把它的聊天记录复活
      store.msgs(loverId).then(function (arr) {
        const last = arr[arr.length - 1];
        if (!last || last.role !== 'you') return; // 用户已经回过话了
        if (running[loverId]) return;
        enqueue(loverId, function () {
          const sec = Math.round((Date.now() - armedAt) / 1000);
          const extra = '对方已经' + sec + '秒没回你上一条消息。你有点在意，用你的口吻补一条简短的追问，就一条，1-2句，催他回答你刚才问的事。绝不能自问自答，绝不能替你上一条消息做解释或续写，绝不能开新话题。';
          return streamReply(loverId, persona, { extra: extra, follow: true })
            .catch(function (e) { console.warn('[追问失败]', e && e.message); });
        });
      });
    }, (st.followUpSec || 30) * 1000);
  }
  function cancelFollowUp(loverId) { clearTimeout(followTimers[loverId]); }

  /* 偶尔发生活照 */
  function maybePhoto(loverId, persona) {
    return engine.getSettings().then(function (st) {
      if (!st.photos) return;
      const useLocal = !!(persona.photoLocal && persona.photoLocal.length);
      if (!useLocal && !persona.photoKw) return;
      return sync.lastPhotoAt(loverId).then(function (last) {
        if (Date.now() - last < 10 * 60 * 1000) return;
        if (Math.random() > 0.16) return;
        const p = useLocal ? photos.fetchLocal(persona.photoLocal) : photos.fetchOne(persona.photoKw);
        return p.then(function (dataUrl) {
          if (!dataUrl) return;
          return sync.setLastPhotoAt(loverId, Date.now()).then(function () {
            const msg = { id: util.uid(), role: 'you', type: 'image', text: '', src: dataUrl, ts: Date.now() };
            return appendYou(loverId, msg);
          });
        });
      });
    }).catch(function () {});
  }

  /* 对方明确要照片：立刻调取一张发过去（私密词→私密池；否则普通池；无本地相册用图库） */
  const PHOTO_REQ_RE = /(照片|自拍|拍给我|拍一张|发张|来张|发图|看看你的腿|看看腿|看看你的手|看看手|看看你的脸|看看你长|让我看看你|想看看你|看看你)/;
  const PHOTO_INTIM_RE = /(私密照|裸照|裸体|腿照|大腿|那话儿|你的下面|看看下面|下面给我|大不大|硬不硬|勃起|鸡巴|几把|尺寸|脱了|脱光|脱给我|露给我|色一点|骚一点|来点刺激)/;
  function sendPhotoNow(loverId, persona, intim) {
    return engine.getSettings().then(function (st) {
      if (!st.photos) return;
      const intimPool = intim && persona.photoIntim && persona.photoIntim.length ? persona.photoIntim : null;
      const useLocal = intimPool || (persona.photoLocal && persona.photoLocal.length);
      if (!useLocal && !persona.photoKw) return;
      return sync.lastPhotoAt(loverId).then(function (last) {
        if (Date.now() - last < 20 * 1000) return; // 20 秒内刚发过，不再连发
        const p = intimPool ? photos.fetchLocal(intimPool)
          : (useLocal ? photos.fetchLocal(persona.photoLocal) : photos.fetchOne(persona.photoKw));
        return p.then(function (dataUrl) {
          if (!dataUrl) return;
          return sync.setLastPhotoAt(loverId, Date.now()).then(function () {
            const msg = { id: util.uid(), role: 'you', type: 'image', text: '', src: dataUrl, ts: Date.now() };
            return appendYou(loverId, msg);
          });
        });
      });
    }).catch(function () {});
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
      const wantPhoto = PHOTO_REQ_RE.test(text) || PHOTO_INTIM_RE.test(text);
      const wantIntim = PHOTO_INTIM_RE.test(text);
      return store.appendMsg(loverId, msg).then(function () {
        engine.hooks.onMsg(loverId, msg, 'append');
        if (wantPhoto) {
          // 明确要照片：先自动发一张（私密词发私密池），再让 TA 文字回应
          return sendPhotoNow(loverId, persona, wantIntim).then(function () {
            return streamReply(loverId, persona, {}).catch(handleErr(loverId));
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
