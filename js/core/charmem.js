/* Schat v2 —— 角色记忆闭环 + 熟悉度图谱（charmem）
 *
 * 记忆闭环：三种对话面（我↔TA 私聊 / 双人私聊 / 群聊）的关键事实与事件，
 * 双向流通、跨对话面可见。双层记忆：
 *   truth（真相层）——实际发生的事（如 A 与 B 已偷情），只注入当事人；
 *   face（表面层）——对外表现（如群里假装刚认识），人人可见。
 * 生成提示词时两层都注入：角色「知道真相但会演」，不会说漏（除非性格爱炫耀）。
 *
 * 存储（IndexedDB，沿用 store）：
 *   charmem:global     —— 全局事实（谁都知道/公开层面的事件）
 *   charmem:<角色id>   —— 该角色相关的事实与事件
 *   charmem:me-<角色id>—— 我↔该角色之间的事
 *   pairmem:<A>-<B>    —— 角色对之间的事（键为排序后组合）
 *   groupmem:<群id>    —— 群内的事
 *   pairfam:<A>-<B>    —— 熟悉度 { level:0不认识/1认识/2熟/3亲密, why, ts }
 *
 * 熟悉度：初始关系矩阵 REL_INIT（按人设背景），建群/双人私聊/朋友圈互动/我牵线推进，
 * 贯穿所有聊天面（开场白、亲疏、朋友圈互动过滤）。
 *
 * 记忆写入：各对话面关键转折本地规则抽取（无 Key 退化路径），
 * 每 N 轮或对话暂停/关闭时 API 批量压缩提炼成条目 JSON。
 *
 * 记忆注入：任何对话面生成回复时检索相关记忆注入提示词，
 * 优先级：故事板 > 记忆闭环 > 通用人设；按相关性与时间衰减取 top K 防提示词爆炸。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const store = isNode ? require('./store.js') : G.store;
  const util = isNode ? require('./util.js') : G.util;

  const cm = {};

  cm.MAX = 60;         // 每库最多保留条数
  cm.K = 8;            // 注入 top K
  cm.DIGEST_EVERY = 12;   // 每 N 条消息做一次批量压缩
  cm.LEVELS = ['不认识', '认识', '熟', '亲密'];

  /* ================= 初始关系矩阵（0不认识/1认识/2熟/3亲密） ================= */
  cm.REL_INIT = {
    '孙铎-徐朗': [1, '同城职场，打过照面'],
    '孙铎-梁川': [2, '同在上海的职场人，饭局应酬见过几回'],
    '孙铎-阿杰': [1, '公司车常去阿杰车行检修，认识'],
    '徐朗-乐恩': [2, '乐恩校队训练常受伤，徐朗是熟识的医生'],
    '徐朗-阿杰': [2, '阿杰玩车摔伤常挂急诊，和徐朗熟'],
    '徐朗-梁川': [1, '同城体面人，饭局见过'],
    '徐朗-Allen': [1, 'Allen 妈妈以前身体不好，看病时认识徐朗'],
    '小泽-Allen': [2, '宠物圈：一个开宠物店一个养狗，熟'],
    '小泽-乐恩': [1, '同龄，乐恩带队友去猫咖，认识'],
    '小泽-阿杰': [1, '阿杰总喂流浪猫，猫圈认识'],
    '梁川-Allen': [1, 'Allen 爱拍城市建筑，建筑圈混脸熟'],
    '阿杰-齐越': [2, '齐越的电动车总在阿杰车行修，熟了'],
    '阿杰-乐恩': [1, '运动圈，骑车打球偶尔碰见'],
    '齐越-乐恩': [1, '你带学弟回过家，见过'],
    'Allen-乐恩': [1, '一个是你的学长一个是学弟，你攒局见过'],
    '王忆可-Allen': [3, '大学时的学长学妹，现在是长期炮友，见面就是为了打炮', '长期炮友，见面就是为了打炮'],
    '陆野-齐越': [2, '健身房认识的：一个教练一个练家子，嘴上都荤，臭味相投'],
    '陆野-徐朗': [1, '徐朗在陆野的健身房办过卡，陆野带过课'],
    '陆野-阿杰': [1, '玩车也健身，健身房照过面'],
    '沈知意-陆野': [2, '陆野健身房隔壁画室的常客，一来二去混成损友：陆野爱逗他装纯，他嘴上说烦，其实很吃这套'],
    '沈知意-乐恩': [1, '大学城认识：一个学体育一个学纯艺，食堂球场照过面'],
    '沈知意-Allen': [1, '都在艺术圈打转：Allen 拍城市建筑、沈知意学纯艺，展览上照过面'],
  };

  /* 键名归一化：REL_INIT 按「排序后组合」索引（防写法与 pairKey 不一致） */
  const REL_NORM = {};
  Object.keys(cm.REL_INIT).forEach(function (k) {
    const parts = k.split('-');
    REL_NORM[[parts[0], parts[1]].sort().join('-')] = cm.REL_INIT[k];
  });

  function pairKey(a, b) {
    return [a, b].sort().join('-');
  }
  function nowMs() { return Date.now(); }
  function nameOf(pid) {
    const p = (G.sync || {}).get ? G.sync.get(pid) : null;
    return p ? (p.nickname || p.name) : pid;
  }

  /* 亲密真相种子：REL_INIT 里 level>=3 且带真相句（第三元素）的关系，把真相写进 pairmem（只种一次，src=init） */
  function seedTruth(a, b, init) {
    if (!(init && init[2])) return Promise.resolve();
    const k = 'pairmem:' + pairKey(a, b);
    return store.get(k, []).then(function (arr) {
      if (arr.some(function (e) { return e.src === 'init'; })) return;
      return cm.pairEntry(a, b, init[2], { layer: 'truth', level: 3, impact: 'high', src: 'init' });
    });
  }

  /* ================= 熟悉度 ================= */
  cm.fam = function (a, b) {
    return store.get('pairfam:' + pairKey(a, b), null).then(function (f) {
      if (f) return f;
      const init = REL_NORM[pairKey(a, b)];
      if (init) return seedTruth(a, b, init).then(function () { return { level: init[0], why: init[1], ts: 0 }; });
      return { level: 0, why: '', ts: 0 };
    });
  };
  cm.setFam = function (a, b, level, why) {
    const k = pairKey(a, b);
    const lvl = Math.max(0, Math.min(3, level | 0));
    return cm.fam(a, b).then(function (cur) {
      if (lvl === cur.level) return null;
      const entry = { fact: nameOf(a) + ' 与 ' + nameOf(b) + ' 的关系变为「' + cm.LEVELS[lvl] + '」' + (why ? '（' + why + '）' : ''), layer: 'face', level: 1, impact: 'low', src: 'system', a: a, b: b };
      return store.set('pairfam:' + k, { level: lvl, why: why || cur.why || '', ts: nowMs() })
        .then(function () { return cm.add('pairmem:' + k, entry); });
    });
  };
  cm.bumpFam = function (a, b, delta, why) {
    return cm.fam(a, b).then(function (f) { return cm.setFam(a, b, f.level + (delta || 1), why); });
  };
  cm.lowerFam = function (a, b, why) {
    return cm.fam(a, b).then(function (f) { return cm.setFam(a, b, f.level - 1, why); });
  };
  /* 只读熟悉度等级（朋友圈互动过滤等场景） */
  cm.famLevel = function (a, b) {
    return cm.fam(a, b).then(function (f) { return f.level; });
  };
  cm.famList = function (ids) {
    const pairs = [];
    const keys = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairKey(ids[i], ids[j]);
        if (keys.indexOf(k) < 0) { keys.push(k); pairs.push([ids[i], ids[j]]); }
      }
    }
    return Promise.all(pairs.map(function (pr) {
      return cm.fam(pr[0], pr[1]).then(function (f) {
        return { a: pr[0], b: pr[1], level: f.level, why: f.why };
      });
    }));
  };
  /* 我牵线：私聊里同时提到两个角色名 → 两人熟悉度 +1 */
  cm.matchmake = function (names) {
    const ids = [];
    (G.sync && G.sync.list ? G.sync.list({ all: true }) : []).forEach(function (p) {
      if (names.indexOf(p.name) >= 0 || names.indexOf(p.nickname) >= 0) ids.push(p.id);
    });
    const uniq = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
    if (uniq.length < 2) return Promise.resolve(null);
    return cm.bumpFam(uniq[0], uniq[1], 1, '你在中间牵的线');
  };

  /* ================= 记忆条目 ================= */
  function normalize(entry) {
    return {
      id: util.uid(),
      t: nowMs(),
      layer: entry.layer === 'truth' ? 'truth' : 'face',
      level: entry.level == null ? 1 : Math.max(0, Math.min(3, entry.level | 0)),
      impact: entry.impact === 'high' || entry.impact === 'mid' ? entry.impact : 'low',
      fact: String(entry.fact || '').slice(0, 160),
      src: entry.src || 'unknown',
      a: entry.a || null, b: entry.b || null, sid: entry.sid || null,
    };
  }
  cm.add = function (key, entry) {
    if (!entry || !entry.fact) return Promise.resolve();
    return store.get(key, []).then(function (arr) {
      arr.push(normalize(entry));
      if (arr.length > cm.MAX) arr = arr.slice(-cm.MAX);
      return store.set(key, arr);
    });
  };
  cm.charEntry = function (pid, fact, opts) { return cm.add('charmem:' + pid, Object.assign({ fact: fact }, opts || {}, { a: pid })); };
  cm.meEntry = function (pid, fact, opts) { return cm.add('charmem:me-' + pid, Object.assign({ fact: fact }, opts || {}, { a: pid })); };
  cm.pairEntry = function (a, b, fact, opts) {
    return cm.add('pairmem:' + pairKey(a, b), Object.assign({ fact: fact }, opts || {}, { a: a, b: b }));
  };
  cm.groupEntry = function (sid, fact, opts) { return cm.add('groupmem:' + sid, Object.assign({ fact: fact }, opts || {}, { sid: sid })); };
  cm.globalEntry = function (fact, opts) { return cm.add('charmem:global', Object.assign({ fact: fact }, opts || {})); };

  /* ================= 本地规则抽取（无 Key 退化路径） ================= */
  const DIGEST_RULES = [
    { re: /(上床|开房|做了|偷情|发生关系|滚床单|上了床|睡过|亲了|舌吻|接吻|做爱|约炮|炮友|有过一夜|爽了)/, fact: '两人有了亲密关系', layer: 'truth', level: 3, impact: 'high' },
    { re: /(喜欢你|爱你|表白|在一起吧|我们在一起|想见你|离不开你|吃醋|在意你)/, fact: '两人之间动了感情', layer: 'truth', level: 2, impact: 'high' },
    { re: /(绝交|拉黑|别联系|分手|离婚|滚蛋|再也不想见|老死不相往来)/, fact: '两人闹翻了', layer: 'truth', level: 2, impact: 'high' },
    { re: /(吵架|吵起来|闹脾气|冷战|生气|不理你)/, fact: '两人吵过架', layer: 'truth', level: 2, impact: 'mid' },
    { re: /(改天|下次|周末|今晚|晚上|明天|周五|周六|周日)[^，。！？]{0,20}(约|一起|见面|请|聚|喝|吃)/, fact: '两人约了见面', layer: 'face', level: 1, impact: 'low' },
    { re: /(假装不熟|装不认识|别让人知道|保密|瞒着|别告诉)/, fact: '两人有事要瞒着别人', layer: 'truth', level: 3, impact: 'high' },
    { re: /(结婚了|我老婆|我老公|我对象|有家室)/, fact: '其中一方有家室/对象', layer: 'face', level: 1, impact: 'mid' },
    { re: /(帮你|借你|送你|请你|陪你|接你|送你回家)/, fact: '两人之间有实际照应', layer: 'face', level: 1, impact: 'low' },
  ];

  /* 本地规则抽取：从最近消息里提炼关键事实（离线退化路径） */
  cm.localDigest = function (msgs, names) {
    names = names || {};
    const out = [];
    const seen = {};
    const tail = (msgs || []).slice(-20);
    for (const m of tail) {
      if (!m || !m.text) continue;
      const who = m.role === 'user' || m.role === 'me' ? '我' : (names[m.role] || m.role);
      for (const r of DIGEST_RULES) {
        const mm = m.text.match(r.re);
        if (mm && !seen[r.fact]) {
          seen[r.fact] = true;
          out.push({ who: who, fact: r.fact + '（' + who + '说：' + m.text.slice(0, 24) + '…）', layer: r.layer, level: r.level, impact: r.impact, src: 'digest' });
        }
      }
      if (out.length >= 3) break;
    }
    return out;
  };

  /* ================= API 批量压缩（每 N 轮 / 暂停 / 关闭时提炼） ================= */
  cm.apiDigest = function (msgs, names, hint) {
    return new Promise(function (resolve) {
      const api = G.api || (isNode ? require('./api.js') : null);
      const engine = G.engine || (isNode ? require('./engine.js') : null);
      if (!api || !engine) return resolve(cm.localDigest(msgs, names));
      engine.getSettings().then(function (st) {
        if (!String(st.apiKey || '').trim()) return resolve(cm.localDigest(msgs, names));
        const hist = (msgs || []).slice(-24).map(function (m) {
          return (m.role === 'user' ? '他' : (names[m.role] || m.role)) + '：' + String(m.text || '').slice(0, 100);
        }).join('\n');
        const sys = '你是记忆提炼器。下面是一段微信聊天记录' + (hint ? '（' + hint + '）' : '') +
          '。提炼出值得跨对话记住的关键事实（谁和谁发生了什么、什么关系变化、什么秘密、什么约定），最多 4 条。' +
          '每条输出 JSON 对象：{"who":"当事人","fact":"事实一句话（中文，30字内）","layer":"truth 或 face（truth=实际发生但可能不便对外公开；face=对外公开的表现）","level":0到3（0公开、1圈内、2仅当事人、3机密）,"impact":"high/mid/low"}。' +
          '没有值得记的就输出空数组。只输出 JSON 数组，不要任何解释。';
        api.chat({ baseURL: st.baseURL, apiKey: st.apiKey, model: st.model, temperature: 0.3, messages: [{ role: 'system', content: sys }, { role: 'user', content: hist }] })
          .then(function (raw) {
            const m = String(raw || '').match(/\[[\s\S]*\]/);
            const arr = m ? JSON.parse(m[0]) : null;
            if (!arr || !arr.length) return resolve(cm.localDigest(msgs, names));
            return resolve(arr.filter(function (e) { return e && e.fact; }).map(function (e) {
              return { who: e.who || '', fact: String(e.fact).slice(0, 160), layer: e.layer === 'truth' ? 'truth' : 'face', level: Math.max(0, Math.min(3, parseInt(e.level, 10) || 1)), impact: e.impact, src: 'api' };
            }));
          })
          .catch(function () { resolve(cm.localDigest(msgs, names)); });
      }).catch(function () { resolve(cm.localDigest(msgs, names)); });
    });
  };

  /* 对话面压缩计数：每 DIGEST_EVERY 条提炼一次 */
  const digestChains = {};
  cm.observe = function (face, meta, msgs) {
    if (!meta || !meta.id) return Promise.resolve();
    const counterKey = 'memcnt:' + meta.id;
    return store.get(counterKey, 0).then(function (n) {
      const next = n + 1;
      if (next < cm.DIGEST_EVERY) return store.set(counterKey, next);
      // 到点：压缩 + 重置计数（串行防并发重复）
      const prev = digestChains[meta.id] || Promise.resolve();
      const job = prev.then(function () {
        return store.set(counterKey, 0).then(function () {
          const msgsP = msgs ? Promise.resolve(msgs) : store.msgs('pw:' + meta.id);
          return msgsP.then(function (all) {
            const kind = meta.kind === 'group' ? 'group' : 'dual';
            const hint = (kind === 'group' ? '群聊' : '双人私聊') + '：' + (meta.members || []).map(function (id) { return nameOf(id); }).join('、');
            return cm.apiDigest(all, meta.names || {}, hint).then(function (entries) {
              let chain = Promise.resolve();
              entries.forEach(function (e) {
                if (kind === 'group') chain = chain.then(function () { return cm.groupEntry(meta.id, e.fact, { layer: e.layer, level: e.level, impact: e.impact }); });
                else {
                  const a = meta.members[0], b = meta.members[1];
                  if (e.layer === 'truth' && e.level >= 2) {
                    chain = chain.then(function () { return cm.pairEntry(a, b, e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
                    chain = chain.then(function () { return cm.charEntry(a, e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
                    chain = chain.then(function () { return cm.charEntry(b, e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
                  } else {
                    chain = chain.then(function () { return cm.pairEntry(a, b, e.fact, { layer: 'face', level: e.level, impact: e.impact }); });
                  }
                }
              });
              return chain;
            });
          });
        });
      });
      digestChains[meta.id] = job.catch(function () {});
      return job;
    });
  };
  /* 暂停时提炼（带消息量护栏：新增不足 6 条不调 API，防每次暂停都烧钱） */
  cm.onPauseGuarded = function (meta) {
    if (!meta || !meta.id) return Promise.resolve();
    return (G.store ? G.store : store).msgs('pw:' + meta.id).then(function (msgs) {
      const base = meta.lastDigestN || 0;
      if (msgs.length - base < 6) return null;
      meta.lastDigestN = msgs.length;
      return cm.onPause(meta);
    }).catch(function () {});
  };
  /* 对话暂停/关闭时强制提炼一次 */
  cm.onPause = function (meta) {
    if (!meta || !meta.id) return Promise.resolve();
    return (G.store ? G.store : store).msgs('pw:' + meta.id).then(function (msgs) {
      const kind = meta.kind === 'group' ? 'group' : 'dual';
      const hint = (kind === 'group' ? '群聊' : '双人私聊') + '（暂停/关闭时提炼）：' + (meta.members || []).map(function (id) { return nameOf(id); }).join('、');
      return cm.apiDigest(msgs, meta.names || {}, hint).then(function (entries) {
        let chain = Promise.resolve();
        entries.forEach(function (e) {
          if (kind === 'group') chain = chain.then(function () { return cm.groupEntry(meta.id, e.fact, { layer: e.layer, level: e.level, impact: e.impact }); });
          else if (e.layer === 'truth' && e.level >= 2) {
            chain = chain.then(function () { return cm.pairEntry(meta.members[0], meta.members[1], e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
          } else {
            chain = chain.then(function () { return cm.pairEntry(meta.members[0], meta.members[1], e.fact, { layer: 'face', level: e.level, impact: e.impact }); });
          }
        });
        return chain;
      });
    }).catch(function () {});
  };

  /* 我↔TA 私聊：每 6 条本地提炼（含 API 时每 24 条批量压缩） */
  cm.observeMe = function (loverId) {
    const counterKey = 'mecnt:' + loverId;
    return store.get(counterKey, 0).then(function (n) {
      const next = n + 1;
      if (next % 6 !== 0) return store.set(counterKey, next);
      return store.set(counterKey, next).then(function () {
        return store.msgs(loverId).then(function (msgs) {
          const names = {};
          names[loverId] = nameOf(loverId);
          const tail = msgs.slice(-14);
          const local = cm.localDigest(tail, names);
          let chain = Promise.resolve();
          local.forEach(function (e) {
            chain = chain.then(function () { return cm.meEntry(loverId, e.fact, { layer: e.layer, level: e.level, impact: e.impact }); });
            if (e.layer === 'truth' && e.level >= 2) chain = chain.then(function () { return cm.charEntry(loverId, e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
          });
          if (next % 24 === 0) {
            chain = chain.then(function () {
              return cm.apiDigest(tail, names, '你和他（我）的私聊').then(function (entries) {
                let q = Promise.resolve();
                entries.forEach(function (e) {
                  q = q.then(function () { return cm.meEntry(loverId, e.fact, { layer: e.layer, level: e.level, impact: e.impact }); });
                  if (e.layer === 'truth' && e.level >= 2) q = q.then(function () { return cm.charEntry(loverId, e.fact, { layer: 'truth', level: e.level, impact: e.impact }); });
                });
                return q;
              });
            });
          }
          return chain;
        });
      });
    }).catch(function () {});
  };

  /* ================= 记忆注入 ================= */
  /* opts: { pid, others:[id], sid, face:'me'|'dual'|'group', msgs:[最近消息] } */
  cm.inject = function (opts) {
    const pid = opts.pid;
    const others = opts.others || [];
    const keys = [];
    if (opts.face === 'me') {
      keys.push('charmem:' + pid, 'charmem:me-' + pid);
      if (others && others.length) others.forEach(function (o) { keys.push('pairmem:' + pairKey(pid, o)); });
      keys.push('charmem:global');
    } else {
      keys.push('charmem:' + pid);
      others.forEach(function (o) { keys.push('pairmem:' + pairKey(pid, o)); });
      if (opts.sid) keys.push('groupmem:' + opts.sid);
      if (opts.face === 'group' && others.length > 1) {
        for (let i = 0; i < others.length; i++) {
          for (let j = i + 1; j < others.length; j++) keys.push('pairmem:' + pairKey(others[i], others[j]));
        }
      }
      keys.push('charmem:global');
    }
    const msgs = opts.msgs || [];
    const words = {};
    (msgs.slice(-8)).forEach(function (m) {
      String(m.text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('').forEach(function (c, i, arr) {
        if (i + 1 < arr.length) words[arr[i] + arr[i + 1]] = true;
      });
    });
    const days = function (t) { return Math.max(0, (nowMs() - t) / 86400000); };
    const wImpact = { high: 3, mid: 2, low: 1 };
    return Promise.all(keys.map(function (k) {
      return store.get(k, []).then(function (arr) {
        return arr.map(function (e) {
          let score = (wImpact[e.impact] || 1) * Math.pow(0.82, days(e.t));
          let boost = 0;
          for (const w in words) { if (e.fact.indexOf(w) >= 0) boost += 0.6; }
          score += boost;
          return { e: e, score: score, key: k };
        });
      });
    })).then(function (lists) {
      const flat = [];
      lists.forEach(function (l) { l.forEach(function (x) { flat.push(x); }); });
      const truth = flat.filter(function (x) {
        // 带当事人标记的机密真相，且本角色不是当事人 → 他并不知道，不注入
        return x.e.layer === 'truth' && (x.e.level >= 2) && (x.e.a || x.e.b) && (x.e.a !== pid && x.e.b !== pid);
      });
      // 真相层过滤：非当事人的机密真相不注入（他不知道）
      const seen = {};
      const visible = flat.filter(function (x) {
        if (truth.indexOf(x) >= 0) return false;
        const sig = x.e.fact;
        if (seen[sig]) return false;
        seen[sig] = true;
        return true;
      }).sort(function (x, y) { return y.score - x.score; }).slice(0, cm.K);
      if (!visible.length) return '';
      const truths = [], faces = [];
      visible.forEach(function (x) {
        const t = '· ' + x.e.fact;
        if (x.e.layer === 'truth') truths.push(t); else faces.push(t);
      });
      let out = '';
      if (truths.length) {
        out += '\n【记忆·真相】你确实知道这些事（发生过、你知道）：\n' + truths.join('\n') +
          '\n对外要照常演：不主动说破、不提这些事，除非你的性格本来就爱炫耀或故意刺激人。';
      }
      if (faces.length) {
        out += '\n【记忆·对外】在别人眼里（表面上的情况）：\n' + faces.join('\n') +
          '\n对外表现以这层为准，别把里子的事说漏。';
      }
      return out;
    }).catch(function () { return ''; });
  };

  /* 熟悉度注入：开场白/称呼/话题按熟悉度来 */
  cm.injectFam = function (ids) {
    if (!ids || ids.length < 2) return Promise.resolve('');
    return cm.famList(ids).then(function (pairs) {
      const lines = pairs.map(function (p) {
        const na = nameOf(p.a), nb = nameOf(p.b);
        const guide = {
          0: '完全不认识：开场陌生拘谨，用客气称呼，话题从寒暄起，别一上来就熟络',
          1: '认识但不熟：像刚认识的人，礼貌但放得开一点，有分寸',
          2: '熟人：可以随意，直接喊外号、聊熟事，接话自然',
          3: '亲密：两人关系很近，什么都能聊，肢体亲近感强',
        }[p.level];
        return '· ' + na + ' 与 ' + nb + '：' + guide + (p.why ? '（原因：' + p.why + '）' : '');
      });
      return '\n【你们之间的关系】\n' + lines.join('\n') + '\n称呼、开场白、话题、互动亲疏都要符合这个关系程度；别越过当前熟悉度硬装熟或装生。';
    });
  };

  /* ================= 被踢反应（任务10） ================= */
  /* 情境分类：a 明确做错/说错话被踢 → 道歉服软；b 自己喊着要退群被踢 → 委屈/生气/不问；
   * c 无缘无故被踢 → 按性格（炸毛/委屈/难过/冷处理） */
  cm.classifyKick = function (msgs, pid) {
    let lastP = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === pid && msgs[i].text) { lastP = msgs[i].text; break; }
    }
    if (/(退群|不想待|没意思|退了|不玩了|走了|退出)/.test(lastP)) return 'b';
    if (/(对不起|错了|骂|滚|傻逼|脑残|去死|闭嘴|活该|没用)/.test(lastP)) return 'a';
    return 'c';
  };
  /* 按性格的反应概率表（[概率, 类型]） */
  cm.KICK_STYLE = {
    '齐越': [[0.8, '炸毛'], [0.1, '委屈'], [0.1, '不问']],
    '小泽': [[0.5, '委屈'], [0.3, '生气'], [0.2, '不问']],
    'Allen': [[0.6, '难过'], [0.2, '委屈'], [0.2, '道歉']],
    '孙铎': [[0.5, '冷处理'], [0.3, '委屈'], [0.2, '生气']],
    '徐朗': [[0.5, '冷处理'], [0.3, '难过'], [0.2, '道歉']],
    '梁川': [[0.6, '冷处理'], [0.2, '生气'], [0.2, '道歉']],
    '阿杰': [[0.4, '生气'], [0.3, '委屈'], [0.3, '难过']],
    '乐恩': [[0.5, '委屈'], [0.3, '难过'], [0.2, '道歉']],
    '王忆可': [[0.5, '生气'], [0.3, '委屈'], [0.2, '不问']],
    '陆野': [[0.5, '炸毛'], [0.3, '生气'], [0.2, '不问']],
    '沈知意': [[0.5, '委屈'], [0.3, '难过'], [0.2, '道歉']],
  };
  /* 无 Key 回退话术池（语料池参考，只用于被踢事件这一条场景，不用于普通对话） */
  cm.KICK_POOL = {
    '孙铎': {
      炸毛: ['你把我踢了？行，我记着了。', '踢就踢吧，用不着跟我解释。'],
      委屈: ['…你把我移出去了。', '我干什么了你要这样。'],
      生气: ['凭什么踢我。你把话说清楚。'],
      难过: ['算了。你说什么就是什么。'],
      冷处理: ['嗯。', '知道了。'],
      道歉: ['是我说错话了，对不起。'],
    },
    '徐朗': {
      冷处理: ['知道了。'], 难过: ['…行。'], 道歉: ['是我不对，给你添麻烦了。'],
      生气: ['至于吗。'], 委屈: ['我做了什么？'],
    },
    '小泽': {
      委屈: ['你干嘛呀，把我踢了QAQ', '我就说了两句你就不带我玩了…'],
      生气: ['哼，我自己也能玩。'], 难过: ['…好伤心。'], 道歉: ['对不起嘛，别生我气。'],
    },
    '梁川': {
      冷处理: ['嗯。'], 生气: ['这事你做得欠考虑。'], 道歉: ['抱歉。'],
      委屈: ['…可以给我个理由吗。'], 难过: ['好。'],
    },
    '阿杰': {
      生气: ['靠，说踢就踢？', '行啊你，过河拆桥。'], 委屈: ['我哪句话又招你了。'],
      难过: ['…挺没劲的。'], 道歉: ['我的错，哥你消气。'],
    },
    '齐越': {
      炸毛: ['我操，你踢我？！你疯了吧！', '你有病啊！把话放群里说，踢我算什么本事！'],
      委屈: ['不是，你凭什么啊。'], 生气: ['行，你等着。'], 难过: ['…你认真的？'], 道歉: ['行行行我的错。'],
    },
    '乐恩': {
      委屈: ['哥，你为什么踢我…', '我是不是做错什么了…'],
      难过: ['…好难过。'], 道歉: ['对不起哥，我错了。'], 生气: ['你过分了。'],
    },
    'Allen': {
      难过: ['…被你踢出来了。挺突然的。', '唉，行吧。'], 委屈: ['我干啥了呀，你把我移出去。'],
      道歉: ['是我说错啥了吗，我给你道歉。'], 生气: ['至于吗。'],
    },
    '王忆可': {
      生气: ['踢我？行啊，你等着。', '呵，把我踢了是吧，有你的。'],
      委屈: ['我哪儿招你了，说清楚。'],
      不问: ['行。', '哦。'],
    },
    '陆野': {
      炸毛: ['我操，你他妈把我踢了？！有病吧你！', '靠，把老子踢了？你等着，这事没完！'],
      生气: ['行啊你，说踢就踢，牛逼。', '凭什么踢我，给个说法。'],
      不问: ['行。', '哦。'],
      道歉: ['行行行，算我的。'],
      委屈: ['不是，我哪句又招你了。'],
    },
    '沈知意': {
      委屈: ['哥，你为什么把我踢了呀……', '我是不是说错话了……你别生气。'],
      难过: ['…被踢出来了。有点难受。', '原来我在你眼里是多余的……'],
      道歉: ['对不起，是我不好，你别不要我……', '我错了嘛，把我加回去好不好。'],
      生气: ['你、你太过分了。', '哼，我生气了。'],
    },
  };
  cm.pickKickStyle = function (pid, situation) {
    const table = cm.KICK_STYLE[pid] || [[0.4, '委屈'], [0.3, '生气'], [0.3, '不问']];
    let r = Math.random(), acc = 0;
    for (const pair of table) { acc += pair[0]; if (r < acc) return pair[1]; }
    return table[table.length - 1][1];
  };
  /* 安排延迟私聊反应（几分钟~几小时）；返回 {due, situation, style} */
  cm.scheduleKick = function (meta, pid) {
    return store.msgs('pw:' + meta.id).then(function (msgs) {
      const situation = cm.classifyKick(msgs, pid);
      const style = situation === 'a' ? '道歉' : (situation === 'b' ? cm.pickKickStyle(pid, 'b') : cm.pickKickStyle(pid, 'c'));
      const due = nowMs() + util.randInt(3 * 60000, 4 * 3600000);
      const item = { id: util.uid(), pid: pid, sid: meta.id, groupName: meta.groupName || '', situation: situation, style: style, due: due };
      return store.get('kickpend', []).then(function (arr) {
        arr.push(item);
        return store.set('kickpend', arr).then(function () { return item; });
      });
    });
  };
  cm.pendingKicks = function () { return store.get('kickpend', []); };
  cm.removeKick = function (id) {
    return store.get('kickpend', []).then(function (arr) {
      return store.set('kickpend', arr.filter(function (x) { return x.id !== id; }));
    });
  };

  G.charmem = cm;
  if (isNode) module.exports = cm;
})();
