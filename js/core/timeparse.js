/* Schat v2 —— 时间系统（痛点 2、3 的根治所在）
 *
 * 根治点：
 *  a) 承诺不守时 —— extractPromises 只做「严格字面时间」提取，承诺带 due 时间戳入库，
 *     系统提示词回注「还没到时候不许说到了」，到期由提醒器催角色兑现。
 *  b) 秒数换算错 —— 所有换算在这里集中完成并带单元测试（分钟×60、小时×3600）。
 *  c) 意象误触发 —— 比喻/意向/梦境类表述绝不进约定提取：先要求显式数字时间，
 *     再要求承诺语境，再扫隐喻词黑名单，三道闸。「梦到我」没有数字时间，第一关就被拦下。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const util = (typeof module !== 'undefined' && module.exports) ? require('./util.js') : G.util;
  const tp = {};

  /* ---------- 中文时段 ---------- */
  const PARTS = [
    [0, '凌晨'], [5, '早上'], [8, '上午'], [12, '中午'], [14, '下午'], [18, '晚上'], [23, '深夜'],
  ];
  tp.daypart = function (h) {
    let r = '晚上';
    for (const p of PARTS) { if (h >= p[0]) r = p[1]; }
    return r;
  };

  /* 12 小时制中文时刻：晚上6:23；h12 0→12 */
  tp.clockText = function (d) {
    let h = d.getHours();
    const m = d.getMinutes();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return tp.daypart(h) + h12 + '点' + (m ? util.p2(m) : '');
  };

  /* 完整当前时间：周六 晚上6:23 */
  tp.nowText = function (d) {
    d = d || new Date();
    return '周' + '日一二三四五六'[d.getDay()] + ' ' + tp.clockText(d);
  };

  /* 距离描述：今天/明天/后天/周X */
  tp.dayName = function (d, now) {
    now = now || new Date();
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = Math.round((a - b) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return '周' + '日一二三四五六'[d.getDay()];
  };

  /* 承诺到期时间的友好描述：今晚6:32 / 明天早上8:00 */
  tp.dueText = function (ts, now) {
    const d = new Date(ts);
    return tp.dayName(d, now) + ' ' + tp.clockText(d);
  };

  /* ---------- 24h 作息表定位 ---------- */
  tp.schedAt = function (persona, date) {
    date = date || new Date();
    const h = date.getHours() + date.getMinutes() / 60;
    const segs = (persona && persona.sched) || [];
    for (const s of segs) {
      if (h >= s.h0 && h < s.h1) return s.a;
    }
    return segs.length ? segs[segs.length - 1].a : '自由活动';
  };

  /* ---------- 【X小时后】指令 ---------- */
  tp.parseSkipHours = function (text) {
    const m = String(text || '').match(/^\s*【\s*(半|\d+(?:\.\d+)?)\s*个?\s*(小时|钟头|分钟|分)\s*后\s*】/);
    if (!m) return null;
    const n = m[1] === '半' ? 0.5 : parseFloat(m[1]);
    if (m[2] === '分钟' || m[2] === '分') return n / 60;
    return n; // 小时
  };

  /* ---------- 严格字面时间提取 ---------- */
  // 承诺语境动词（出现其一才可能是约定）
  const COMMIT_RE = /(到|过来|过來|来|见|見|找|接|等|陪|回|给你|給你|打给|打給|发|發|说|說|弄|做|洗|收拾|做饭|做飯|出门|出門|出发|出發|下班|回来|回來|回去|过去|過去|上来|上來|汇报|匯報|约|約)/;
  // 隐喻/意向/梦境黑名单：命中即拒绝（第三道闸）
  const METAPHOR_RE = /(梦到|夢到|梦见|夢見|做梦|做夢|梦里|夢裡|梦醒|幻想|想像|想象|虚构|假如梦)/;
  // 数字+单位：分钟/小时/秒（分钟必须×60——旧版痛点的直接修正）；「半」只与小时搭配（半小时=30分钟）
  const DURATION_RE = /(半|\d{1,3})\s*(?:个|個)?\s*(小时|小時|钟头|鐘頭|分钟|分鐘|分|秒)/g;
  const DAY_MARK_RE = /(今晚|今天|明早|明天早上|明天|后天|後天|大后天|大後天|周[一二三四五六日天]|礼拜[一二三四五六日天]|星期[一二三四五六日天])/;
  const DAYPART_RE = /(凌晨|清晨|早上|早晨|上午|中午|午后|午後|下午|傍晚|晚上|夜里|夜裡|深夜)/;
  const CLOCK_RE = /(\d{1,2})\s*[点點][:：]?\s*(\d{1,2})?\s*(?:分)?/;

  function durToMs(n, unit) {
    n = parseInt(n, 10);
    if (unit === '秒') return n * 1000;
    if (unit === '分' || unit === '分钟' || unit === '分鐘') return n * 60 * 1000; // ← 分钟×60，不再算成秒
    return n * 3600 * 1000; // 小时
  }
  function durValid(n, unit) {
    n = parseInt(n, 10);
    if (unit === '秒') return n >= 5 && n <= 7200;
    if (unit === '分' || unit === '分钟' || unit === '分鐘') return n >= 1 && n <= 300;
    return n >= 1 && n <= 72;
  }

  /* 把「晚上8点」「8:30」「明早7点」换算成时间戳（取下一次出现） */
  function clockToDate(hour, minute, clause, now) {
    hour = parseInt(hour, 10);
    minute = minute ? parseInt(minute, 10) : 0;
    if (hour > 24 || minute > 59) return null;
    if (hour === 24) hour = 0;
    const d = new Date(now.getTime());
    const dayMark = clause.match(DAY_MARK_RE);
    const dp = clause.match(DAYPART_RE);
    // 时段词修正半天制：晚上/下午/傍晚/深夜 + 1~11 点 → +12
    if (dp && /(下午|傍晚|晚上|夜里|夜裡|深夜)/.test(dp[1]) && hour >= 1 && hour <= 11) hour += 12;
    if (dp && /(凌晨|深夜)/.test(dp[1]) && hour === 12) hour = 0;
    if (dayMark) {
      const t = dayMark[1];
      if (/明天/.test(t)) d.setDate(d.getDate() + 1);
      else if (/后天|後天/.test(t)) d.setDate(d.getDate() + 2);
      else if (/大后天|大後天/.test(t)) d.setDate(d.getDate() + 3);
      else {
        const wd = '日一二三四五六'.indexOf(t.replace(/周|礼拜|星期/, '').replace('天', '日'));
        if (wd >= 0) {
          let add = (wd - d.getDay() + 7) % 7;
          if (add === 0) add = 7;
          d.setDate(d.getDate() + add);
        }
      }
    }
    d.setHours(hour, minute, 0, 0);
    // 取下一次出现：算出来的时间已过（且没写昨天之类）→ +1 天
    if (d.getTime() <= now.getTime() - 5 * 60 * 1000) {
      if (!/昨晚|昨天/.test(clause)) d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }

  /* 主入口：从一条角色回复中提取明确时间约定。
   * 返回 [{ label, due }]；任何比喻性表述都不会产生结果。 */
  tp.extractPromises = function (text, now) {
    now = now || new Date();
    const out = [];
    if (!text) return out;
    const clauses = String(text).split(/[。！？!?\n；;]/);
    for (const clauseRaw of clauses) {
      const clause = clauseRaw.trim();
      if (!clause) continue;
      if (METAPHOR_RE.test(clause)) continue; // 第三道闸：梦境/幻想整句跳过

      // 第一道：时长型（20分钟后到 / 我半小时就到 / 一小时后打给你）
      DURATION_RE.lastIndex = 0;
      let m;
      while ((m = DURATION_RE.exec(clause)) !== null) {
        const n = m[1], unit = m[2];
        let ms;
        if (n === '半') {
          if (!/(小时|小時|钟头|鐘頭)/.test(unit)) continue; // 「半」只认小时
          ms = 30 * 60 * 1000;
        } else {
          if (!durValid(n, unit)) continue;
          ms = durToMs(n, unit);
        }
        const after = clause.slice(m.index + m[0].length, m.index + m[0].length + 8);
        const before = clause.slice(Math.max(0, m.index - 8), m.index);
        // 第二道：承诺语境——时间词前后要有承诺动词（允许「就/便/大概」等填充字）
        if (!COMMIT_RE.test(after) && !COMMIT_RE.test(before)) continue;
        out.push({ label: clause.slice(0, 40), due: now.getTime() + ms });
        break; // 每条子句最多取一个时长约定
      }
      if (out.length && clause.indexOf(out[out.length - 1].label) >= 0) continue;

      // 第二道：钟点型（晚上8点见 / 8点半到 / 明早7点 / 周六晚8点）
      const cm = clause.match(CLOCK_RE);
      if (cm) {
        const hasDay = DAY_MARK_RE.test(clause) || DAYPART_RE.test(clause);
        if (hasDay || COMMIT_RE.test(clause)) {
          // 「8点半」= 8:30（正则只匹配到「8点」，分钟组为空）
          const minute = cm[2] || (/[点點]\s*半/.test(clause) ? '30' : undefined);
          const due = clockToDate(cm[1], minute, clause, now);
          if (due) out.push({ label: clause.slice(0, 40), due: due });
        }
      }
    }
    // 去重 + 过滤掉已经过去的（除非刚生成）
    const seen = {};
    return out.filter(function (p) {
      const k = p.label + p.due;
      if (seen[k]) return false;
      seen[k] = 1;
      return p.due > now.getTime();
    });
  };

  G.timeparse = tp;
  if (typeof module !== 'undefined' && module.exports) module.exports = tp;
})();
