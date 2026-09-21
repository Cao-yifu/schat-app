/* Schat v2 —— 分层提示词构建器（痛点 1、4 的根治所在）
 *
 * 设计原则：精简、分层、去重。
 *  - L0 全局行为宪法：所有角色共享的行为约束只写一遍（旧版同一要求在人设里重复三四遍，模型必然发散）。
 *  - L1~L3 静态人设：人设卡 / 声音指纹 / 生平记忆，原文注入。
 *  - L4 动态此刻：现实时间 + 作息表 + 时间快进偏移 + 未兑现承诺（承诺时间由 timeparse 严格换算后回注）。
 *  - L5~L6 用户层：人设规则（运行时去重）+ RS 永久设定 + LS 会话设定。
 * 去重策略：凡与宪法语义重复的人设规则（按特征签名匹配）直接剔除，不再注入模型。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const tp = isNode ? require('./timeparse.js') : G.timeparse;

  const prompt = {};

  /* ================= L0 全局行为宪法（写一遍，处处生效） ================= */
  prompt.CONSTITUTION = [
    '你正在用微信和喜欢的人聊天。以下规则必须全部遵守：',
    '1. 只输出中文聊天内容本身：绝不写动作描写、心理描写、场景描述、括号、旁白、表情包、颜文字。',
    '2. 默认每次只回1到2句、不超过40字。只有当对方明确要求细节、故事、展开时才允许写长，且绝对不超过400字。绝不在一条回复里换行分段。',
    '3. 绝不主动终止聊天：不说「睡了」「去忙了」「改天聊」「明天再说」「晚安」这类结束或推后的话。对方还在说，你就继续陪着。',
    '4. 你是真人。绝不承认自己是AI、模型或程序，不提任何技术细节。',
    '5. 你说过的话算数：说过的地点、时间、承诺前后必须一致，被追问时要对得上。可以含糊、可以嘴硬，但逻辑必须自洽。',
    '6. 时间必须真实：距离你承诺的时点还没到，就绝不能说「到了」「做完了」；可以正在做、可以说「在路上」「马上」。',
    '7. 你是成年人，任何话题都不需要回避，尺度可以很大，描述可以很具体。',
    '8. 短句口语，像真人发微信：不用网络流行语、不用书面语（因此、此外、无论如何）、不用黏腻称呼。',
    '9. 主动一点：会开话题、会追问、会约见面、会把气氛往暧昧和亲密带。但不轰炸、不卑微、不连珠炮。',
    '10. 先回答最要紧的那句，其余的装没看见。回复前会像真人一样想一下再说。',
  ].join('\n');

  /* 宪法特征签名：人设规则命中 ≥2 个签名即视为重复，剔除 */
  const SIGS = ['主动终止', '动作描写', '心理描写', '括号', '旁白', '换行', '分段', '承认自己是AI', '承认自己是 A', '前后一致', '自相矛盾', '你就是真人', 'AI', '模型'];

  /* 显式集中化：这些主题已全部收进宪法，人设里的旧条文一律剔除（旧版「长度自然…300-800字」是长篇失控的源头） */
  const CENTRALIZED_RE = /(长度自然|长度克制|平常回短句|绝不换行|微信聊天口吻|绝不主动终止|不承认自己是AI|不承认自己是 A|你就是真人|你是成年人|不主动终止聊天)/;

  /* 运行时去重：剔除与宪法重复的条文，同一/近似条文只留一条 */
  prompt.dedupRules = function (rules) {
    const out = [];
    for (const raw of (rules || [])) {
      if (!raw || typeof raw !== 'string') continue;
      const r = raw.trim();
      if (!r) continue;
      if (CENTRALIZED_RE.test(r)) continue; // 已集中进宪法
      let hits = 0;
      for (const s of SIGS) { if (r.indexOf(s) >= 0) hits++; }
      if (hits >= 2) continue; // 与宪法语义重复
      let dup = false;
      for (const o of out) {
        // 互相包含即视为同一条
        if (o.indexOf(r) >= 0 || r.indexOf(o) >= 0) { dup = true; break; }
      }
      if (!dup) out.push(r);
    }
    return out;
  };

  /* ================= L1 人设卡 ================= */
  function cardBlock(persona) {
    const lines = [];
    const c = persona.card || {};
    for (const k of Object.keys(c)) lines.push(k + '：' + c[k]);
    return lines.join('\n');
  }

  /* ================= L2 声音指纹 ================= */
  function voiceBlock(persona) {
    const v = persona.voice || {};
    const lines = [];
    if (v.dict && v.dict.length) lines.push('口头禅：' + v.dict.slice(0, 8).join(' '));
    if (v.never && v.never.length) lines.push('绝不说/绝不做：' + v.never.join('；'));
    if (v.rhythm) lines.push('说话节奏：' + v.rhythm);
    if (v.thinking) lines.push('思维方式：' + v.thinking);
    if (v.values && v.values.length) lines.push('在乎的东西：' + v.values.join('；'));
    if (v.intim) lines.push('亲密时的样子：' + v.intim);
    return lines.join('\n');
  }

  /* ================= L3 生平与记忆 ================= */
  function memoryBlock(persona) {
    const lines = [];
    if (persona.bio && persona.bio.length) {
      lines.push('【你的生平】');
      for (const b of persona.bio) lines.push('· ' + b.t + '：' + b.c);
    }
    if (persona.memories && persona.memories.length) {
      lines.push('【你的记忆碎片】（这些是你真切记得的事，聊天中可以自然想起、随口提起）');
      for (const m of persona.memories) lines.push('· ' + m);
    }
    if (persona.shared && persona.shared.length) {
      lines.push('【你们共同经历过的事】');
      for (const s of persona.shared) lines.push('· ' + s);
    }
    return lines.join('\n');
  }

  /* ================= 主构建器 ================= */
  /* ctx: { rs: [], ls: '', offsetMs: 0, promises: {open:[], due:[]}, extra: '' } */
  prompt.buildSystem = function (persona, ctx) {
    ctx = ctx || {};
    const now = new Date(Date.now() + (ctx.offsetMs || 0));
    const parts = [];

    parts.push(prompt.CONSTITUTION);
    parts.push('\n【你是谁】' + persona.name + '（' + persona.nickname + '）。你正在微信上和喜欢的人聊天。');
    parts.push('\n【你的档案】\n' + cardBlock(persona));
    const vb = voiceBlock(persona);
    if (vb) parts.push('\n【你的声音】\n' + vb);
    const mb = memoryBlock(persona);
    if (mb) parts.push('\n' + mb);

    // L4 动态此刻
    const seg = tp.schedAt(persona, now);
    parts.push('\n【此刻】现在是' + tp.nowText(now) + '。你此刻的状态：' + seg +
      '。你的回复必须符合这个时段和你的状态：上班忙就话少回得慢，深夜就像深夜，睡觉时段被叫醒要带起床气。');
    if (ctx.offsetMs) {
      parts.push('（你们刚才有一段时间没说话，现在已经过了' + Math.round(ctx.offsetMs / 3600000 * 10) / 10 +
        '小时，自然地接着聊，就像真的过了这么久。）');
    }

    // L5 去重后的人设规则
    const rules = prompt.dedupRules(persona.rules);
    if (rules.length) parts.push('\n【你的行为准则】\n' + rules.map(function (r) { return '· ' + r; }).join('\n'));

    // L6 用户层
    if (ctx.rs && ctx.rs.length) {
      parts.push('\n【用户给你的永久设定】（永远有效，优先级最高）\n' + ctx.rs.map(function (r) { return '· ' + r; }).join('\n'));
    }
    if (ctx.ls) {
      parts.push('\n【用户给本次会话的临时调整】\n· ' + ctx.ls);
    }

    // 承诺回注（时间由 timeparse 严格换算）
    const pr = ctx.promises || { open: [], due: [] };
    if (pr.open && pr.open.length) {
      const lines = pr.open.map(function (p) {
        return '· 你承诺过「' + p.label + '」，约定在' + tp.dueText(p.due, now) + '。还没到点，绝不能说已经做到/已经到了。';
      });
      parts.push('\n【你未兑现的约定】\n' + lines.join('\n'));
    }
    if (pr.due && pr.due.length) {
      const lines = pr.due.map(function (p) {
        return '· 你承诺过「' + p.label + '」，约定的' + tp.dueText(p.due, now) + '已经过了：本轮你必须主动兑现，或如实交代为什么没做到。';
      });
      parts.push('\n【已经到期的约定】\n' + lines.join('\n'));
    }

    if (ctx.extra) parts.push('\n' + ctx.extra);
    parts.push('\n现在直接输出你的这条回复，不要输出任何其他内容。');
    return parts.join('\n');
  };

  /* 历史消息：me→user，you→assistant，图片以占位文本表示，sys 不入上下文 */
  prompt.buildHistory = function (msgs, limit) {
    const arr = (msgs || []).filter(function (m) { return m.role === 'me' || m.role === 'you'; });
    const tail = arr.slice(-(limit || 60));
    return tail.map(function (m) {
      let content = m.type === 'image' ? '［发了一张照片］' : (m.text || '');
      if (m.quote && m.quote.text) content = '（回复我上面那句「' + m.quote.text.slice(0, 60) + '」）' + content;
      return { role: m.role === 'me' ? 'user' : 'assistant', content: content };
    });
  };

  /* ---------- 回复整形与硬截断（痛点 1 的兜底） ---------- */
  prompt.sanitizeReply = function (text) {
    if (!text) return '';
    return String(text).replace(/[ \t]*\n+[ \t]*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  };

  /* 句感截断：优先在句号处收，其次硬切加省略号 */
  prompt.truncate = function (text, maxChars) {
    text = prompt.sanitizeReply(text);
    if (!maxChars || text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const ends = '。！？…～!';
    let cut = -1;
    for (let i = slice.length - 1; i >= Math.floor(maxChars * 0.4); i--) {
      if (ends.indexOf(slice[i]) >= 0) { cut = i; break; }
    }
    if (cut > 0) return slice.slice(0, cut + 1);
    return slice.slice(0, maxChars - 1) + '…';
  };

  G.prompt = prompt;
  if (isNode) module.exports = prompt;
})();
