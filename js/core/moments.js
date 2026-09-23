/* Schat v2 —— 朋友圈（动态时间线 + 圈层互动）
 * 数据全存本地 store['moments']；纯嵌入式头像，零网图。
 * 交互（沿用旧版方案）：
 *  - 首次启动播种：每人前 2 条预设动态（含互相点赞/评论），时间戳错开
 *  - 定时自动发动态：活泼的一天一条(24h)，其余两天一条(48h)；一次最多补发 2 位，10 分钟冷却
 *  - 有 API Key 走 AI 按人设写；无 Key 回退预设池（按序取，池尽即停）
 *  - 圈层互动：TA 发动态后，其他角色随机点赞 + 偶尔留一句评论
 *  - 你评论后：作者有 65% 概率过一会儿回你一句（走 API）
 *  - 你可以发自己的动态（文字 + 可选本地照片），TA 们过会儿来赞评
 */
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const S = G.SCHAT = G.SCHAT || {};
  const moments = {};

  /* 发动态频率（小时） */
  moments.META = {
    '孙铎': 48, '徐朗': 48, '小泽': 24, '梁川': 48,
    '阿杰': 48, '齐越': 48, '乐恩': 24, 'Allen': 48,
  };

  /* 圈层：看到别人动态时可能留的评论 */
  moments.REACTIONS = {
    '孙铎': ['注意身体。', '这个点还不睡。', '行。', '改天约。', '多穿点。'],
    '徐朗': ['又熬夜。', '注意饮食。', '少贫。', '过来量体温。', '睡你的。'],
    '小泽': ['哦～', '带我一个', '好可爱!!', '哼', '泽哥也想'],
    '梁川': ['不错。', '有品位。', '注意休息。', '挺好。'],
    '阿杰': ['哈哈哈哈', '可以啊', '改天喝一个', '行啊你'],
    '齐越': ['行啊你', '这谁受得了', '啧', '你才知道'],
    '乐恩': ['哥你好会', '我也想去', '棒!!', '带带我'],
    'Allen': ['挺好。', '哈哈哈', '可不', '带我一个呗', '这日子过得'],
  };

  /* 预设动态池（每位 3 条，按人物性格写的朋友圈文案） */
  moments.PRESETS = [
    {
      name: '孙铎',
      posts: [
        { text: '浦东的雨下到人走不动。酒店走廊的灯，比你上次说的晚安还亮。', likes: ['齐越', '乐恩'], comments: [{ who: '齐越', text: '又出差？' }, { who: '乐恩', text: '哥，上海冷不冷' }] },
        { text: '客户夸我稳重。我在想，稳重大概就是心里有人，脸上什么都没有。', likes: ['小泽'], comments: [] },
        { text: '飞机落地，手机开机，三条未读。其中一条是你。', likes: ['乐恩'], comments: [{ who: '小泽', text: '酸了' }] },
      ],
    },
    {
      name: '徐朗',
      posts: [
        { text: '一台手术七个半小时。下了台只想找个地方坐着，最好有人把饭摆到面前。', likes: ['阿杰', '小泽'], comments: [{ who: '阿杰', text: '徐哥辛苦了' }, { who: '乐恩', text: '徐医生注意身体' }] },
        { text: '今天门诊有人送锦旗。我说不用，他硬塞。行吧，挂值班室，谁看谁累。', likes: ['梁川'], comments: [{ who: '齐越', text: '挂锦旗挺有画面' }] },
        { text: '夜班。护士台的热水壶又空了，先紧着别人，我最后。', likes: ['孙铎', '乐恩'], comments: [{ who: '乐恩', text: '徐医生也太好了' }] },
      ],
    },
    {
      name: '小泽',
      posts: [
        { text: '今天有只布偶在店里撒野，被我教育的服服帖帖。像不像某人。', likes: ['乐恩', '阿杰'], comments: [{ who: '乐恩', text: '泽哥又开始了' }, { who: '齐越', text: '说谁呢' }] },
        { text: '店里来了只新猫，和人一样，越不理它越往你脚边蹭。', likes: ['孙铎'], comments: [{ who: '孙铎', text: '猫比人会。' }] },
        { text: '打烊了。抱着猫刷手机，就等一条消息。', likes: ['齐越'], comments: [{ who: '阿杰', text: '等谁呢' }] },
      ],
    },
    {
      name: '梁川',
      posts: [
        { text: '凌晨两点，图纸第37版。完美的东西都是磨出来的。', likes: ['阿杰', '齐越'], comments: [{ who: '齐越', text: '梁工又通宵' }, { who: '阿杰', text: '注意身体' }] },
        { text: '工地灰大。有人问我身上为什么总是一股水泥味——其实我喷的是木质调。', likes: ['小泽'], comments: [{ who: '小泽', text: '哦～' }] },
        { text: '有人问建筑最重要的是什么。我说，让人想回家。', likes: ['孙铎'], comments: [{ who: '孙铎', text: '受教。' }] },
      ],
    },
    {
      name: '阿杰',
      posts: [
        { text: '改了一下午车，手黑得洗不掉。这行当，喜欢就值。', likes: ['乐恩', '小泽'], comments: [{ who: '乐恩', text: '杰哥帅' }, { who: '小泽', text: '带我一个' }] },
        { text: '店门口那只流浪猫又来了，喂了三个月，还是不让我摸。挺有性格，像我认识的一人。', likes: ['齐越'], comments: [{ who: '齐越', text: '猫都拿不下，还吹' }] },
        { text: '夜里跑了一圈山路。头盔后座空着，风比平时响。', likes: ['梁川', '孙铎'], comments: [{ who: '孙铎', text: '山路注意安全。' }] },
      ],
    },
    {
      name: '齐越',
      posts: [
        { text: '下班路过菜市场，买了某人爱吃的菜。顺手。就是顺手。', likes: ['小泽', '阿杰'], comments: [{ who: '小泽', text: '哦～顺手' }, { who: '阿杰', text: '哈哈哈' }] },
        { text: '合租的冰箱又乱了。我说了他多少次，他还是不改。算了，我摆。', likes: ['梁川'], comments: [{ who: '梁川', text: '家和万事兴。' }] },
        { text: '昨晚又梦见你了。算了，我是直男，梦不算数。', likes: ['乐恩'], comments: [{ who: '乐恩', text: '越哥嘴真硬' }, { who: '阿杰', text: '哈哈哈哈' }] },
      ],
    },
    {
      name: '乐恩',
      posts: [
        { text: '训练结束。加练了四十个罚球，教练说我最近状态不对。他懂什么。', likes: ['阿杰'], comments: [{ who: '阿杰', text: '小恩上强度了' }, { who: '齐越', text: '年轻人' }] },
        { text: '校队外套洗了，新外套还没买。降温了，也没人提醒我添衣服。', likes: ['孙铎'], comments: [{ who: '孙铎', text: '多穿点。' }] },
        { text: '球场边的情侣一对一对。我投进最后一个三分，回头找的那个人，不在看台。', likes: ['齐越', '小泽'], comments: [{ who: '小泽', text: '有点东西' }] },
      ],
    },
    {
      name: 'Allen',
      posts: [
        { text: '早上遛狗遇到楼下大爷，聊了半小时房价。我也不是想聊，狗不走。哈哈哈', likes: ['小泽', '乐恩'], comments: [{ who: '乐恩', text: 'Allen哥的生活真惬意' }, { who: '小泽', text: '哦～' }] },
        { text: '咖啡店老板问我还做展览吗。我说早不做了，现在专职陪狗，他愣了好几秒。可不，多少人想不开。', likes: ['孙铎'], comments: [{ who: '孙铎', text: '各有各的活法。' }] },
        { text: '妈妈刚来电话，问吃没吃饭。以前是我担心她，现在反过来。就正常过，都挺好。', likes: ['徐朗', '阿杰'], comments: [{ who: '徐朗', text: '家人平安就是福。' }, { who: '阿杰', text: '哈哈哈哈真好' }] },
      ],
    },
    {
      name: '陆野',
      posts: [
        { text: '带了一天课，嗓子都喊哑了。回家还是一个人，操。', likes: ['齐越', '阿杰'], comments: [{ who: '齐越', text: '出来喝点？' }, { who: '阿杰', text: '野哥哪天带我一个' }] },
        { text: '睡前刷到合租室友秀恩爱的朋友圈。就挺羡慕的。我媳妇要是在，我也天天秀。她不在。', likes: ['阿杰'], comments: [{ who: '阿杰', text: '哥，嫂子啥时候回来啊' }, { who: '齐越', text: '光羡慕有屁用' }] },
        { text: '今天教了个新学员，翘臀不错。没别的意思，就是练得挺到位。', likes: ['齐越'], comments: [{ who: '齐越', text: '你这话说出来自己信吗' }] },
      ],
    },
    {
      name: '沈知意',
      posts: [
        { text: '画了一天的作业，手上全是颜料。老师说我的色彩感觉很好，其实我只是想画得像你一点。', likes: ['乐恩', 'Allen'], comments: [{ who: '乐恩', text: '知意好文艺呀' }, { who: 'Allen', text: '有灵气。' }] },
        { text: '今晚宿舍卧谈，他们问我谈过恋爱没有。我笑了笑没说话。他们不知道我手机里存了什么。', likes: ['陆野'], comments: [{ who: '陆野', text: '小骚货，装什么纯。' }, { who: '齐越', text: '这话里有话啊' }] },
        { text: '买了件新睡衣，试穿的时候脸红了。不是因为它透。', likes: ['乐恩'], comments: [{ who: '乐恩', text: '？有情况' }] },
      ],
    },
  ];

  moments.fmtAgo = function (ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 172800000) return '昨天';
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  moments.store = function () { return S.store; };
  moments.list = function () { return S.store.get('moments', []); };
  moments.save = function (arr) { return S.store.set('moments', arr).catch(function () {}); };
  moments.add = function (m) {
    return moments.list().then(function (arr) {
      arr.push(m);
      return moments.save(arr).then(function () { return m; });
    });
  };
  moments.update = function (m) {
    return moments.list().then(function (arr) {
      for (let i = 0; i < arr.length; i++) if (arr[i].id === m.id) arr[i] = m;
      return moments.save(arr);
    });
  };

  /* 首次播种：每人前 2 条预设动态（含圈层互赞互评），时间戳错开 */
  moments.seed = function () {
    return S.store.get('momentsSeeded', false).then(function (done) {
      if (done) return false;
      const personas = S.sync.list();
      return Promise.resolve().then(function () {
        const arr = [];
        const now = Date.now();
        let i = 0;
        moments.PRESETS.forEach(function (pres) {
          const p = personas.find(function (x) { return x.name === pres.name; });
          if (!p) return;
          pres.posts.slice(0, 2).forEach(function (post) {
            i += 1;
            arr.push({
              id: 'mseed' + i,
              pid: p.id,
              text: post.text,
              t: now - 3 * 3600000 - i * 5 * 3600000,
              likes: post.likes || [],
              comments: (post.comments || []).slice(),
              liked: false,
              mine: false,
            });
          });
        });
        arr.sort(function (a, b) { return b.t - a.t; });
        return S.store.set('moments', arr).then(function () {
          return S.store.set('momentsSeeded', true);
        }).then(function () { return true; });
      });
    });
  };

  /* 发动态用的轻量提示词 */
  function momentPrompt(p) {
    const L = [];
    const d = new Date();
    const hh = d.getHours();
    const mm = d.getMinutes();
    const ap = hh >= 12 ? '下午' : '上午';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    const timeStr = ap + h12 + '点' + (mm < 10 ? '0' : '') + mm + '分';
    L.push('你是' + (p.nickname || p.name) + '，真实存在的活人，不是AI。现在是' + timeStr + '。');
    L.push('你在发微信朋友圈。写一条动态：1-2句短句、口语，符合你的性格和说话方式，内容是你此刻生活里的真实日常或心情。');
    L.push('绝不写解释、标签、表情符号列表、动作描写。只输出动态正文，不超过 60 字。');
    const cd = [];
    if (p.card) {
      Object.keys(p.card).forEach(function (k) {
        if (p.card[k] && cd.length < 6) cd.push(k + '：' + p.card[k]);
      });
    }
    if (cd.length) L.push('【你的基本信息】' + cd.join('；'));
    const v = p.voice;
    if (v) L.push('【你的说话方式】' + (typeof v === 'string' ? v : (v.rhythm || '')));
    return L.join('\n');
  }

  function cleanText(s) {
    let t = String(s || '').trim();
    t = t.replace(/^[\s"'「」:：\-—]+/, '');
    t = t.replace(/（?图[:：][^）】]*）?/g, '');
    return t.slice(0, 120);
  }

  /* 生成一条角色动态：有 Key 走 AI（按人设），无 Key 用预设池兜底 */
  moments.genPost = function (p) {
    return S.engine.getSettings().then(function (st) {
      if (st.apiKey) {
        return S.api.chat({
          baseURL: st.baseURL,
          apiKey: st.apiKey,
          model: st.model,
          messages: [
            { role: 'system', content: momentPrompt(p) },
            { role: 'user', content: '（现在发一条你的朋友圈动态，只输出动态正文）' },
          ],
        }).then(function (out) {
          const text = cleanText(out);
          return text || null;
        }).catch(function () { return null; });
      }
      return Promise.resolve(null);
    }).then(function (aiText) {
      let text = aiText;
      if (!text) {
        const pres = moments.PRESETS.find(function (x) { return x.name === p.name; });
        const pool = pres ? pres.posts : [];
        return S.store.get('momentsUsed', {}).then(function (used) {
          const u = used[p.name] || 0;
          if (u >= pool.length) return null; // 池子用尽且无 AI
          used[p.name] = u + 1;
          return S.store.set('momentsUsed', used).then(function () { return pool[u].text; });
        });
      }
      return text;
    }).then(function (text) {
      if (!text) return null;
      const m = {
        id: 'm' + Date.now() + Math.floor(Math.random() * 1e6),
        pid: p.id,
        text: text,
        t: Date.now(),
        likes: [],
        comments: [],
        liked: false,
        mine: false,
      };
      return moments.add(m).then(function () {
        moments.react(m);
        return m;
      });
    });
  };

  /* 圈层互动（按熟悉度过滤，任务9）：熟人（2/3）点赞评论多，认识但不熟（1）很少，不认识（0）几乎不互动 */
  moments.react = function (m) {
    const personas = S.sync.list();
    return Promise.resolve().then(function () {
      const others = personas.filter(function (x) { return x.id !== m.pid && x.name; });
      if (!others.length) return;
      const cm = S.charmem;
      if (!cm || !cm.famLevel) {
        /* 无记忆模块时的旧行为（基本不会走到：charmem 已接入） */
        const sh = others.slice().sort(function () { return Math.random() - 0.5; });
        const nLikes = 1 + Math.floor(Math.random() * Math.min(3, others.length));
        const likers = sh.slice(0, nLikes).map(function (x) { return x.name; });
        m.likes = (m.likes || []).concat(likers.filter(function (n) { return (m.likes || []).indexOf(n) < 0; }));
        if (Math.random() < 0.6 && sh.length) {
          const who = sh[0];
          const pool = moments.REACTIONS[who.name] || [];
          if (pool.length) {
            m.comments = m.comments || [];
            m.comments.push({ who: who.name, text: pool[Math.floor(Math.random() * pool.length)] });
          }
        }
        return moments.update(m);
      }
      return Promise.all(others.map(function (o) {
        return cm.famLevel(m.pid, o.id).then(function (lv) { return { o: o, lv: lv }; });
      })).then(function (rows) {
        const sh = rows.slice().sort(function () { return Math.random() - 0.5; });
        /* 熟悉度 → 互动概率：3亲密 0.9 / 2熟 0.8 / 1认识 0.12 / 0不认识 0.02 */
        const likers = [];
        sh.forEach(function (r) {
          const p = r.lv >= 3 ? 0.9 : r.lv === 2 ? 0.8 : r.lv === 1 ? 0.12 : 0.02;
          if (Math.random() < p) likers.push(r.o.name);
        });
        /* 评论：优先熟人圈（熟/亲密）里挑一个 */
        const fams = sh.filter(function (r) { return r.lv >= 2; });
        const cands = fams.length ? fams : sh;
        if (Math.random() < 0.6 && cands.length) {
          const who = cands[0].o;
          const pool = moments.REACTIONS[who.name] || [];
          if (pool.length) {
            m.comments = m.comments || [];
            m.comments.push({ who: who.name, text: pool[Math.floor(Math.random() * pool.length)] });
          }
        }
        m.likes = (m.likes || []).concat(likers.filter(function (n) { return (m.likes || []).indexOf(n) < 0; }));
        return moments.update(m);
      });
    });
  };

  /* 定时自动发动态：10 分钟冷却，一次最多补发 2 位 */
  moments.autoTick = function () {
    return S.store.get('momentsGenAt', 0).then(function (genAt) {
      const now = Date.now();
      if (now - genAt < 10 * 60000) return false;
      return moments.list().then(function (arr) {
        const personas = S.sync.list();
      return Promise.resolve().then(function () {
          const due = personas.filter(function (p) {
            const freq = (moments.META[p.name] || 48) * 3600000;
            let last = 0;
            arr.forEach(function (m) { if (m.pid === p.id && m.t > last) last = m.t; });
            return now - last >= freq;
          });
          if (!due.length) return false;
          return S.store.set('momentsGenAt', now).then(function () {
            const pick = due.slice(0, 2);
            const chain = Promise.resolve();
            pick.forEach(function (p) {
              chain.then(function () { return moments.genPost(p).catch(function () {}); });
            });
            return chain.then(function () { return true; });
          });
        });
      });
    });
  };

  /* 你评论后：作者 65% 概率过一会儿回你一句（走 API，无 Key 静默） */
  moments.replyComment = function (m, userText) {
    const personas = S.sync.list();
      return Promise.resolve().then(function () {
      const p = personas.find(function (x) { return x.id === m.pid; });
      if (!p) return;
      return S.engine.getSettings().then(function (st) {
        if (!st.apiKey || Math.random() > 0.65) return;
        setTimeout(function () {
          S.api.chat({
            baseURL: st.baseURL,
            apiKey: st.apiKey,
            model: st.model,
            messages: [
              { role: 'system', content: momentPrompt(p) },
              { role: 'user', content: '你的朋友圈动态《' + String(m.text || '').slice(0, 60) + '》下面，TA评论了一句：「' + userText + '」。以你的口吻简短回复这条评论，就一句，自然，不要复述评论内容。' },
            ],
          }).then(function (out) {
            const t = cleanText(out);
            if (!t) return;
            m.comments = m.comments || [];
            m.comments.push({ who: p.name, text: t });
            return moments.update(m).then(function () {
              if (S.ui && S.ui.renderMoments) S.ui.renderMoments();
            });
          }).catch(function () {});
        }, 8000 + Math.random() * 12000);
      });
    });
  };

  moments.toggleLike = function (m) {
    m.liked = !m.liked;
    return moments.update(m);
  };

  /* 发布我的朋友圈（文字 + 可选本地照片 dataURL） */
  moments.postMine = function (text, imgData) {
    const m = {
      id: 'm' + Date.now() + Math.floor(Math.random() * 1e6),
      pid: 'me',
      text: text || '分享了一张照片',
      t: Date.now(),
      likes: [],
      comments: [],
      liked: false,
      mine: true,
    };
    if (imgData) m.img = imgData;
    return moments.add(m).then(function () {
      setTimeout(function () {
        moments.react(m).then(function () {
          if (S.ui && S.ui.renderMoments) S.ui.renderMoments();
        });
      }, 15000 + Math.random() * 20000);
      return m;
    });
  };

  S.moments = moments;
  if (typeof module !== 'undefined' && module.exports) module.exports = moments;
})();
