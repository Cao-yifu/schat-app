/* Schat —— 秘密情人 · 主逻辑 */
'use strict';

/* ================= 存储 ================= */
const K = 'schat_db_v1';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

let DB = null;
let cur = null;            // 当前情人 id
let streaming = false;
let abortCtrl = null;

function loadDB() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(K) || 'null'); } catch (e) { raw = null; }
  if (!raw || !Array.isArray(raw.personas)) raw = { personas: [], settings: {} };
  raw.settings = Object.assign({
    key: '', base: 'https://api.deepseek.com', model: 'deepseek-chat',
    temp: 0.9, maxHist: 400, onboardDone: false, myAvatar: '我'
  }, raw.settings || {});
  DB = raw;
  // 迁移：老数据补上声音指纹
  if (window.SUNDUO) {
    DB.personas.forEach(p => {
      if (!p.voice) p.voice = (p.name === window.SUNDUO.name) ? JSON.parse(JSON.stringify(window.SUNDUO.voice)) : null;
    });
  }
  if (!DB.personas.length && !DB.settings.seeded) seedSunDuo();
  save();
}
function save() {
  try { localStorage.setItem(K, JSON.stringify(DB)); } catch (e) {
    toast('本地存储空间不足，请导出备份后清理');
  }
}
function seedSunDuo() {
  const sd = window.SUNDUO;
  if (!sd) return;
  DB.personas.push({
    id: 'p' + Date.now(),
    name: sd.name, nickname: sd.nickname, avatarColor: sd.avatarColor,
    card: Object.assign({}, sd.card),
    bio: sd.bio.map(x => ({ t: x.t, c: x.c })),
    memories: sd.memories.slice(),
    shared: sd.shared.slice(),
    voice: sd.voice ? JSON.parse(JSON.stringify(sd.voice)) : null,
    rules: sd.rules.slice(),
    prefs: sd.prefs.slice(),
    msgs: [],
    createdAt: Date.now()
  });
  DB.settings.seeded = true;
  save();
}
const getP = (id) => DB.personas.find(p => p.id === id);
const getPx = () => getP(cur);
const tempK = (id) => 'schat_temp_' + id;
const getTemp = (id) => {
  try { return JSON.parse(sessionStorage.getItem(tempK(id)) || '[]'); } catch (e) { return []; }
};
const setTemp = (id, arr) => { sessionStorage.setItem(tempK(id), JSON.stringify(arr)); };

/* ================= 工具 ================= */
function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), ms || 2600);
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fmtTime(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  const today = now.getFullYear() === y && now.getMonth() === d.getMonth() && now.getDate() === dd;
  if (today) return '今天';
  const yest = new Date(now.getTime() - 86400000);
  if (yest.getFullYear() === y && yest.getMonth() === d.getMonth() && yest.getDate() === dd) return '昨天';
  return y + '年' + m + '月' + dd + '日';
}
function fmtDayShort(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + '/' + d.getDate();
}
const AV_COLORS = ['#9c2f3f', '#3a6ea5', '#5b8a4f', '#a5692f', '#7a4f9e', '#2f7d7d', '#a54f7a', '#4f6d8f'];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function lastMsg(p) {
  for (let i = p.msgs.length - 1; i >= 0; i--) {
    const m = p.msgs[i];
    if (m.r === 'u') return { c: '我：' + m.c, t: m.t };
    if (m.r === 'a') return { c: m.c, t: m.t };
  }
  return { c: '开始聊天吧', t: p.createdAt };
}
function preview(s, n) {
  s = String(s).replace(/\n+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ================= 首页 ================= */
function renderHome() {
  const list = $('homeList');
  list.innerHTML = '';
  const ps = DB.personas.slice().sort((a, b) => (lastMsg(b).t || 0) - (lastMsg(a).t || 0));
  if (!ps.length) {
    list.innerHTML = '<div class="empty"><div class="big">🖤</div>还没有秘密情人<br><br><button class="addbtn" onclick="showAdd()">＋ 新建第一个</button></div>';
    return;
  }
  ps.forEach(p => {
    const lm = lastMsg(p);
    const row = el('div', 'row');
    const ava = el('div', 'avatar', (p.name || '?')[0]);
    ava.style.background = p.avatarColor || colorFor(p.name);
    const mid = el('div', 'mid');
    mid.appendChild(el('div', 'nm', p.name));
    mid.appendChild(el('div', 'pv', preview(lm.c, 26)));
    const tm = el('div', 'tm', fmtDayShort(lm.t || Date.now()));
    row.appendChild(ava); row.appendChild(mid); row.appendChild(tm);
    row.onclick = () => openChat(p.id);
    list.appendChild(row);
  });
}

/* ================= 聊天 ================= */
function openChat(id) {
  cur = id;
  $('chatName').textContent = getP(id).name;
  showPage('chat');
  renderChat();
  $('inp').focus();
}
function showPage(name) {
  ['home', 'chat'].forEach(v => $('page-' + v).classList.toggle('active', v === name));
}
function backHome() { cur = null; showPage('home'); renderHome(); }

function pushMsg(p, m) { p.msgs.push(m); if (p.msgs.length > 5000) p.msgs = p.msgs.slice(-5000); save(); }

function renderChat() {
  const p = getPx();
  const box = $('chatScroll');
  box.innerHTML = '';
  const msgs = p.msgs;
  let prevDay = '', prevT = 0;
  msgs.forEach(m => {
    const d = new Date(m.t);
    const dayKey = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (dayKey !== prevDay) {
      prevDay = dayKey;
      const dl = el('div', 'dayline');
      dl.appendChild(el('span', '', fmtDay(m.t) + ' ' + fmtTime(m.t)));
      box.appendChild(dl);
      prevT = 0;
    }
    if (m.t - prevT > 300000) {
      prevT = m.t;
      const tl = el('div', 'timeline');
      tl.appendChild(el('span', '', fmtTime(m.t)));
      box.appendChild(tl);
    }
    if (m.r === 's') {
      const sl = el('div', 'sysline', m.c);
      box.appendChild(sl);
      return;
    }
    const me = m.r === 'u';
    const row = el('div', 'msg ' + (me ? 'me' : 'you'));
    const ava = el('div', 'ava', me ? DB.settings.myAvatar : (p.name || '?')[0]);
    ava.style.background = me ? '#6B9F6E' : (p.avatarColor || colorFor(p.name));
    const wrap = el('div', 'wrap');
    const bub = el('div', 'bub', m.c);
    wrap.appendChild(bub);
    row.appendChild(ava); row.appendChild(wrap);
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

function sysLine(txt) {
  const p = getPx();
  pushMsg(p, { r: 's', c: txt, t: Date.now() });
  renderChat();
}

function showTyping(on) {
  let tg = $('typingRow');
  if (on && !tg) {
    const p = getPx();
    tg = el('div', 'msg you typing');
    tg.id = 'typingRow';
    const ava = el('div', 'ava', (p.name || '?')[0]);
    ava.style.background = p.avatarColor || colorFor(p.name);
    const wrap = el('div', 'wrap');
    const bub = el('div', 'bub');
    const dots = el('span', 'dots');
    for (let i = 0; i < 3; i++) dots.appendChild(el('span'));
    bub.appendChild(dots);
    wrap.appendChild(bub);
    tg.appendChild(ava); tg.appendChild(wrap);
    $('chatScroll').appendChild(tg);
    scrollBottom();
  } else if (!on && tg) {
    tg.remove();
    tg = null;
  }
}
function scrollBottom() {
  const box = $('chatScroll');
  box.scrollTop = box.scrollHeight;
}

/* ================= 指令 RS / LS ================= */
function parseMeta(t) {
  if (/^RS\s*$/.test(t)) return { type: 'RS_HINT', rest: '' };
  if (/^LS\s*$/.test(t)) return { type: 'LS_HINT', rest: '' };
  if (/^LS\s*清空\s*$/.test(t)) return { type: 'LS_CLEAR', rest: '' };
  let m = t.match(/^RS\s+([\s\S]+)$/); if (m) return { type: 'RS', rest: m[1].trim() };
  m = t.match(/^LS\s+([\s\S]+)$/); if (m) return { type: 'LS', rest: m[1].trim() };
  return null;
}
function handleMeta(meta, p) {
  if (meta.type === 'RS_HINT') { toast('RS + 空格 + 内容 = 永久修改人设\n例：RS 以后管我叫宝宝'); return; }
  if (meta.type === 'LS_HINT') { toast('LS + 空格 + 内容 = 本次会话临时调整\nLS 清空 = 取消临时调整'); return; }
  if (meta.type === 'LS_CLEAR') { setTemp(p.id, []); sysLine('已清空本次会话的临时调整'); return; }
  if (meta.type === 'RS') {
    if (!p.rules.includes(meta.rest)) p.rules.push(meta.rest);
    save();
    sysLine('已更新人设（永久）：' + meta.rest);
    metaAck(p, '刚刚有人通过内部指令永久修改了你的人设，新规则是：' + meta.rest + '。不要复述规则本身，用你自己的口吻，用一两句话确认你听懂了、会照做。');
  } else if (meta.type === 'LS') {
    const arr = getTemp(p.id);
    arr.push(meta.rest);
    setTemp(p.id, arr);
    sysLine('已临时调整（本次会话有效）：' + meta.rest);
    metaAck(p, '本次会话有人临时要求你：' + meta.rest + '。不要复述指令本身，用你自己的口吻，用一两句话确认你知道了。');
  }
}
async function metaAck(p, instruction) {
  showTyping(true);
  await sleep(700 + Math.random() * 900);
  let out = '';
  const res = await chatWith(p, [{ role: 'user', content: '（内部指令，用你自己的口吻简短确认即可，1-2句，不要复述指令本身）' + instruction }], d => { out += d; }, null);
  showTyping(false);
  if (cur !== p.id) return;
  if (res.ok) {
    const t = (res.demo ? '收到。' : out.trim());
    if (t) { pushMsg(p, { r: 'a', c: t, t: Date.now() }); renderChat(); }
  } else {
    toast(res.error);
  }
}

/* ================= 记忆检索注入：记忆库无限大，每次只喂相关的 ================= */
function tokenize(s) {
  const toks = new Set();
  s = String(s).toLowerCase();
  const en = s.match(/[a-z0-9]+/g) || [];
  en.forEach(w => { if (w.length > 1) toks.add(w); });
  const zh = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < zh.length - 1; i++) toks.add(zh.slice(i, i + 2));
  return toks;
}
function scoreMem(memText, qToks) {
  let hit = 0;
  qToks.forEach(t => { if (memText.includes(t)) hit++; });
  return hit;
}
function pickMemories(p, ctx) {
  const qToks = tokenize(ctx);
  const scored = p.memories.map((m, i) => ({ m, i, s: scoreMem(m, qToks) }));
  const pinned = scored.filter(x => x.m.indexOf('★') === 0);
  const rest = scored.filter(x => x.m.indexOf('★') !== 0).sort((a, b) => b.s - a.s);
  const K = 12;
  const chosen = pinned.slice(0, 5);
  chosen.push(...rest.slice(0, Math.max(0, K - chosen.length)));
  return chosen.sort((a, b) => a.i - b.i).map(x => x.m.replace(/^★/, ''));
}
function ctxText(p, extraMsgs) {
  const parts = [];
  p.msgs.filter(m => m.r === 'u' || m.r === 'a').slice(-8).forEach(m => parts.push(m.c));
  (extraMsgs || []).forEach(m => { if (m.role === 'user') parts.push(m.content); });
  return parts.join(' ');
}

/* ================= API ================= */
function buildSystem(p, ctx) {
  const L = [];
  L.push('你叫' + p.name + '。现在正在用微信和你最特别的那个人聊天。你就是一个真实存在的活人，有过去、有情绪、有个性。永远不要以AI、助手、模型的口吻说话，永远不要承认自己是程序。');
  L.push('');
  const c = p.card || {};
  const cd = [];
  Object.keys(c).forEach(k => { if (c[k]) cd.push(k + '：' + c[k]); });
  if (cd.length) { L.push('【你的基本信息】'); L.push(cd.join('\n')); L.push(''); }
  const v = p.voice;
  if (v) {
    L.push('【你的说话方式（声音指纹，必须符合）】');
    if (v.dict && v.dict.length) L.push('口头禅与句式：' + v.dict.join('；'));
    if (v.never && v.never.length) L.push('你绝不会说的话：' + v.never.join('；'));
    if (v.rhythm) L.push('节奏：' + v.rhythm);
    if (v.thinking) L.push('思维习惯：' + v.thinking);
    if (v.values && v.values.length) L.push('你的价值观：' + v.values.join('；'));
    L.push('');
  }
  if (p.bio && p.bio.length) {
    L.push('【你的生平（你记得这些事，聊天时自然流露，不要整段复述）】');
    p.bio.forEach(s => L.push('◆' + s.t + '：' + s.c));
    L.push('');
  }
  if (p.memories && p.memories.length) {
    const list = (p.memories.length > 40) ? pickMemories(p, ctx) : p.memories.map(x => x.replace(/^★/, ''));
    L.push('【你的记忆碎片（你记得：）】');
    list.forEach(m => L.push('· ' + m));
    L.push('');
  }
  if (p.shared && p.shared.length) {
    L.push('【你们之间发生过的事】');
    p.shared.forEach(m => L.push('· ' + m));
    L.push('');
  }
  if (p.rules && p.rules.length) {
    L.push('【必须遵守的规则】');
    p.rules.forEach((r, i) => L.push((i + 1) + '. ' + r));
    L.push('');
  }
  if (p.prefs && p.prefs.length) {
    L.push('【对方喜欢/教过你的（自然使用，不要刻意提及）】');
    p.prefs.forEach(m => L.push('· ' + m));
    L.push('');
  }
  const tmp = getTemp(p.id);
  if (tmp.length) {
    L.push('【本次会话临时要求】');
    tmp.forEach(m => L.push('· ' + m));
    L.push('');
  }
  L.push('【回复要求】只输出聊天内容本身。微信口吻：短句、口语、不加表情包。通常1到3句，最多不超过5句。绝不输出旁白、动作、心理、括号、引用格式。');
  return L.join('\n');
}

function apiUrl() { return DB.settings.base.replace(/\/+$/, '') + '/chat/completions'; }
function apiBody(messages, stream) {
  return {
    model: DB.settings.model,
    messages: messages,
    stream: !!stream,
    temperature: Number(DB.settings.temp) || 0.9,
    max_tokens: 800
  };
}
function errMsg(status) {
  if (status === 401) return 'API Key 无效。去 ＋ → 设置 检查 Key（platform.deepseek.com 创建）';
  if (status === 402) return '余额不足。去 platform.deepseek.com 充值（最低10元）';
  if (status === 403) return '无权限访问该模型/接口';
  if (status === 429) return '请求太频繁，稍等几秒再发';
  return '请求失败（HTTP ' + status + '）';
}

/* 演示模式（未填 Key 时走这个，方便先看界面效果） */
const DEMO_LINES = [
  '（演示模式）我还没被真正唤醒哦。',
  '去 ＋ → 设置 里填上你的 API Key，我就能真的用孙铎的脑子跟你说话了。'
];
async function demoStream(onDelta, abortPromise) {
  const txt = DEMO_LINES.join('\n');
  for (const ch of txt) {
    if (abortPromise && abortPromise.aborted) return;
    if (onDelta) onDelta(ch);
    await new Promise(r => setTimeout(r, 18));
  }
}

async function rawChat(messages, onDelta, sig) {
  let full = '';
  try {
    const resp = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DB.settings.key },
      body: JSON.stringify(apiBody(messages, true)),
      signal: sig ? sig.signal : undefined
    });
    if (!resp.ok) return { ok: false, error: errMsg(resp.status) };
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim();
        if (d === '[DONE]') break;
        try {
          const j = JSON.parse(d);
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta && delta.content) {
            full += delta.content;
            if (onDelta) onDelta(delta.content);
          }
        } catch (e) { /* 忽略不完整行 */ }
      }
    }
    return { ok: true, text: full };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: true, text: full, aborted: true };
    return { ok: false, error: '网络错误，请检查网络后重试' };
  }
}

async function chatWith(p, extraMsgs, onDelta, sig) {
  if (!DB.settings.key) {
    await demoStream(onDelta, sig);
    return { ok: true, text: '', demo: true };
  }
  const hist = [];
  const keep = p.msgs.filter(m => m.r === 'u' || m.r === 'a').slice(-(Number(DB.settings.maxHist) || 400));
  keep.forEach(m => hist.push({ role: m.r === 'u' ? 'user' : 'assistant', content: m.c }));
  const messages = [{ role: 'system', content: buildSystem(p, ctxText(p, extraMsgs)) }].concat(hist).concat(extraMsgs || []);
  return rawChat(messages, onDelta, sig);
}

/* ================= 发送 ================= */
function autosize() {
  const t = $('inp');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 96) + 'px';
}
$('inp').addEventListener('input', autosize);
$('inp').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});
$('sendBtn').addEventListener('click', doSend);

async function doSend() {
  if (streaming) { if (abortCtrl) abortCtrl.abort(); return; }
  const inp = $('inp');
  const text = inp.value.trim();
  if (!text) return;
  const p = getPx();
  const meta = parseMeta(text);
  inp.value = '';
  autosize();
  if (meta) { handleMeta(meta, p); return; }

  pushMsg(p, { r: 'u', c: text, t: Date.now() });
  renderChat();
  streaming = true;
  abortCtrl = new AbortController();
  let cancelled = false;
  abortCtrl.signal.addEventListener('abort', () => { cancelled = true; });
  $('sendBtn').textContent = '停止';
  $('sendBtn').classList.add('stopping');
  showTyping(true);
  // 拟真「对方正在输入…」：思考时间随消息长度变化，有随机迟疑
  const think = 900 + Math.min(text.length * 70, 2600) + Math.random() * 800;
  await sleep(think);

  showTyping(false);
  const row = el('div', 'msg you');
  const ava = el('div', 'ava', (p.name || '?')[0]);
  ava.style.background = p.avatarColor || colorFor(p.name);
  const wrap = el('div', 'wrap');
  const bub = el('div', 'bub', '');
  wrap.appendChild(bub);
  row.appendChild(ava); row.appendChild(wrap);
  $('chatScroll').appendChild(row);
  scrollBottom();

  // 拟真打字节奏：按人类速度逐段显示，偶尔停下来"想一想"
  const buf = [];
  let doneFlag = false;
  const flusher = (async () => {
    while (!cancelled) {
      if (buf.length === 0) {
        if (doneFlag) break;
        await sleep(40);
        continue;
      }
      const n = 1 + Math.floor(Math.random() * 5);
      bub.textContent += buf.splice(0, n).join('');
      scrollBottom();
      let delay = 50 + Math.random() * 85;
      if (Math.random() < 0.07) delay += 350 + Math.random() * 800;
      await sleep(delay);
    }
  })();
  const res = await chatWith(p, [{ role: 'user', content: text }], delta => {
    for (const ch of delta) buf.push(ch);
  }, abortCtrl);
  doneFlag = true;
  await flusher;

  streaming = false;
  abortCtrl = null;
  $('sendBtn').textContent = '发送';
  $('sendBtn').classList.remove('stopping');
  if (!res.ok) {
    bub.textContent = bub.textContent || res.error;
    toast(res.error);
    return;
  }
  if (res.demo) {
    const t = bub.textContent;
    pushMsg(p, { r: 's', c: '（演示模式：未配置 API Key）', t: Date.now() });
    pushMsg(p, { r: 'a', c: t, t: Date.now() });
    renderChat();
    return;
  }
  const t = bub.textContent.trim();
  if (!t) {
    bub.textContent = '（没说出话来）';
    toast('他这次没有回应，可能被限流了，再发一次试试');
  }
  pushMsg(p, { r: 'a', c: t || '…', t: Date.now() });
}

/* 从最近聊天提取记忆 */
async function extractMemory() {
  const p = getPx();
  if (!DB.settings.key) { toast('需要先配置 API Key（＋ → 设置）'); return; }
  const recent = p.msgs.filter(m => m.r === 'u' || m.r === 'a').slice(-30);
  if (!recent.length) { toast('还没有可提取的聊天记录'); return; }
  toast('正在提取记忆…', 3000);
  const lines = recent.map(m => (m.r === 'u' ? '我：' : p.name + '：') + m.c).join('\n');
  const prompt = '以下是一段微信聊天记录。请从中提取需要长期记住的内容，只输出一个JSON（不要任何其他文字）：\n' +
    '{"prefs":["用户喜欢的称呼、用词、互动方式、癖好、敏感词等"],"facts":["关于用户的个人信息"],"events":["你们之间新发生的重要事件"]}\n' +
    '聊天记录：\n' + lines;
  let out = '';
  const res = await rawChat([{ role: 'system', content: '你是一个记忆提取工具。只输出JSON，不输出任何其他内容。' }, { role: 'user', content: prompt }], d => { out += d; }, null);
  if (!res.ok || !out) { toast('提取失败：' + (res.error || '无输出')); return; }
  try {
    const i0 = out.indexOf('{'), i1 = out.lastIndexOf('}');
    const j = JSON.parse(out.slice(i0, i1 + 1));
    let n = 0;
    (j.prefs || []).forEach(x => { if (x && !p.prefs.includes(x)) { p.prefs.push(x); n++; } });
    (j.facts || []).forEach(x => { if (x && !p.memories.includes(x)) { p.memories.push(x); n++; } });
    (j.events || []).forEach(x => { if (x && !p.shared.includes(x)) { p.shared.push(x); n++; } });
    save();
    toast('已学会 ' + n + ' 条新东西，写进他的记忆了');
  } catch (e) {
    toast('模型返回格式不标准，请重试一次');
  }
}

/* ================= 面板：人设 ================= */
function showPersonaPanel() {
  const p = getPx();
  const box = $('panelPersonaBody');
  box.innerHTML = '';
  box.appendChild(secBase(p));
  box.appendChild(secList(p, '生平', p.bio, 'bio', true));
  box.appendChild(secList(p, '记忆碎片', p.memories, 'memories', false));
  box.appendChild(secList(p, '共同经历', p.shared, 'shared', false));
  box.appendChild(secList(p, '对话规则（永久）', p.rules, 'rules', false));
  box.appendChild(secList(p, '他已学会的（偏好投喂）', p.prefs, 'prefs', false));
  const danger = el('div', 'card');
  const cb = el('div', 'cb');
  const b1 = el('button', 'rbtn', '清空聊天记录');
  b1.onclick = () => { if (confirm('清空与 ' + p.name + ' 的全部聊天记录？')) { p.msgs = []; save(); closePanel('panelPersona'); renderChat(); } };
  const b2 = el('button', 'rbtn', '删除 ' + p.name);
  b2.onclick = () => {
    if (confirm('彻底删除 ' + p.name + '？人设、记忆、聊天记录都会消失。')) {
      DB.personas = DB.personas.filter(x => x.id !== p.id);
      save(); closePanel('panelPersona'); backHome();
    }
  };
  cb.appendChild(b1); cb.appendChild(b2);
  danger.appendChild(cb);
  box.appendChild(danger);
  showPanel('panelPersona');
}
function secBase(p) {
  const d = el('details', 'sec');
  d.open = true;
  const sum = el('summary', '', '基础信息');
  d.appendChild(sum);
  const cb = el('div', 'cb');
  const f1 = el('div', 'fld');
  f1.appendChild(el('label', '', '名字'));
  const iName = el('input');
  iName.type = 'text'; iName.value = p.name || '';
  iName.oninput = () => { p.name = iName.value.trim() || p.name; save(); };
  f1.appendChild(iName);
  const f2 = el('div', 'fld');
  f2.appendChild(el('label', '', '昵称'));
  const iNick = el('input');
  iNick.type = 'text'; iNick.value = p.nickname || '';
  iNick.oninput = () => { p.nickname = iNick.value; save(); };
  f2.appendChild(iNick);
  const f3 = el('div', 'fld');
  f3.appendChild(el('label', '', '人设卡（每行一条，格式：字段：内容）'));
  const taCard = el('textarea');
  taCard.value = Object.keys(p.card || {}).map(k => k + '：' + (p.card[k] || '')).join('\n');
  taCard.oninput = () => {
    const c = {};
    taCard.value.split('\n').forEach(line => {
      const i = line.indexOf('：');
      if (i < 0) i = line.indexOf(':');
      if (i > 0) c[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    p.card = c; save();
  };
  f3.appendChild(taCard);
  const f4 = el('div', 'fld');
  f4.appendChild(el('label', '', '头像颜色（CSS 颜色值）'));
  const iCol = el('input');
  iCol.type = 'text'; iCol.value = p.avatarColor || '';
  iCol.oninput = () => { p.avatarColor = iCol.value || colorFor(p.name); save(); };
  f4.appendChild(iCol);
  cb.appendChild(f1); cb.appendChild(f2); cb.appendChild(f3); cb.appendChild(f4);
  d.appendChild(cb);
  return d;
}
function secList(p, title, arr, key, isBio) {
  const d = el('details', 'sec');
  const sum = el('summary', '', title + '（' + arr.length + '）');
  d.appendChild(sum);
  const cb = el('div', 'cb');
  const render = () => {
    cb.innerHTML = '';
    arr.forEach((item, idx) => {
      const row = el('div', 'rowitem');
      if (isBio) {
        const ti = el('input');
        ti.type = 'text'; ti.value = item.t || '';
        ti.placeholder = '章节名';
        ti.oninput = () => { item.t = ti.value; save(); };
        row.appendChild(ti);
        const del = el('button', 'del', '×');
        del.onclick = () => { arr.splice(idx, 1); save(); render(); };
        row.appendChild(del);
        cb.appendChild(row);
        const ta = el('textarea');
        ta.value = item.c || '';
        ta.oninput = () => { item.c = ta.value; save(); };
        const r2 = el('div', 'rowitem');
        r2.appendChild(ta);
        cb.appendChild(r2);
      } else {
        const ta = el('textarea');
        ta.value = item;
        ta.oninput = () => { arr[idx] = ta.value; save(); };
        row.appendChild(ta);
        const del = el('button', 'del', '×');
        del.onclick = () => { arr.splice(idx, 1); save(); render(); };
        row.appendChild(del);
        cb.appendChild(row);
      }
    });
    const add = el('button', 'mini-btn', '+ 添加' + (isBio ? '章节' : '一条'));
    add.onclick = () => {
      if (isBio) arr.push({ t: '新章节', c: '' }); else arr.push('');
      save(); render();
    };
    cb.appendChild(add);
  };
  render();
  d.appendChild(cb);
  return d;
}

/* ================= 面板：设置 / 帮助 ================= */
function showSettings() {
  const s = DB.settings;
  const box = $('panelSettingsBody');
  box.innerHTML = '';
  const d1 = el('details', 'sec');
  d1.open = true;
  d1.appendChild(el('summary', '', 'AI 接口（对话必需）'));
  const cb1 = el('div', 'cb');
  const f1 = el('div', 'fld');
  f1.appendChild(el('label', '', 'API Key（只存你手机本地，不上传任何服务器）'));
  const iKey = el('input');
  iKey.type = 'password'; iKey.value = s.key || '';
  iKey.placeholder = 'sk-...';
  iKey.oninput = () => { s.key = iKey.value.trim(); save(); };
  f1.appendChild(iKey);
  const f2 = el('div', 'fld');
  f2.appendChild(el('label', '', '接口地址（OpenAI 兼容均可）'));
  const iBase = el('input');
  iBase.type = 'text'; iBase.value = s.base;
  iBase.oninput = () => { s.base = iBase.value.trim() || 'https://api.deepseek.com'; save(); };
  f2.appendChild(iBase);
  const f3 = el('div', 'fld');
  f3.appendChild(el('label', '', '模型名'));
  const iModel = el('input');
  iModel.type = 'text'; iModel.value = s.model;
  iModel.oninput = () => { s.model = iModel.value.trim() || 'deepseek-chat'; save(); };
  f3.appendChild(iModel);
  const f4 = el('div', 'fld');
  f4.appendChild(el('label', '', '温度（0-2，越高越放得开）'));
  const iTemp = el('input');
  iTemp.type = 'text'; iTemp.value = String(s.temp);
  iTemp.oninput = () => { s.temp = parseFloat(iTemp.value) || 0.9; save(); };
  f4.appendChild(iTemp);
  const f5 = el('div', 'fld');
  f5.appendChild(el('label', '', '携带聊天记忆条数（越大越记得久，越费钱）'));
  const iHist = el('input');
  iHist.type = 'text'; iHist.value = String(s.maxHist);
  iHist.oninput = () => { s.maxHist = parseInt(iHist.value) || 400; save(); };
  f5.appendChild(iHist);
  cb1.appendChild(f1); cb1.appendChild(f2); cb1.appendChild(f3); cb1.appendChild(f4); cb1.appendChild(f5);
  d1.appendChild(cb1);
  box.appendChild(d1);

  const d2 = el('details', 'sec');
  d2.appendChild(el('summary', '', '备份'));
  const cb2 = el('div', 'cb');
  const b1 = el('button', 'gbtn', '导出全部数据（JSON 文件）');
  b1.onclick = exportAll;
  const b2 = el('button', 'gbtn', '导入备份');
  const fin = el('input');
  fin.type = 'file'; fin.accept = '.json'; fin.style.display = 'none';
  fin.onchange = importAll;
  b2.onclick = () => fin.click();
  const h = el('div', 'hint', 'iOS 偶尔会清理网页本地存储，定期导出备份最保险。');
  cb2.appendChild(b1); cb2.appendChild(b2); cb2.appendChild(fin); cb2.appendChild(h);
  d2.appendChild(cb2);
  box.appendChild(d2);

  const d3 = el('details', 'sec');
  d3.appendChild(el('summary', '', '隐私说明'));
  const cb3 = el('div', 'cb');
  cb3.appendChild(el('div', 'hint',
    '· 所有人设、记忆、聊天记录、API Key 只存在你这部手机里，不上传、无账号、无统计。\n' +
    '· 对话内容会发送给你配置的 AI 接口（如 DeepSeek 官方），这是任何 AI 聊天都避免不了的；App 本身零过滤，不设任何词表。\n' +
    '· 换手机或清缓存前，记得导出备份。'));
  d3.appendChild(cb3);
  box.appendChild(d3);
  showPanel('panelSettings');
}
function exportAll() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = 'schat-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function importAll(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      if (!j || !Array.isArray(j.personas)) throw new Error('bad');
      DB = j;
      DB.settings = Object.assign({ key: '', base: 'https://api.deepseek.com', model: 'deepseek-chat', temp: 0.9, maxHist: 400, onboardDone: true, myAvatar: '我' }, DB.settings || {});
      save();
      renderHome();
      toast('导入成功');
    } catch (e) { toast('文件格式不正确'); }
  };
  rd.readAsText(f);
  ev.target.value = '';
}

/* ================= 面板：新建情人 ================= */
let addGenState = null;
function showAdd() {
  addGenState = null;
  const box = $('panelAddBody');
  box.innerHTML = '';
  const d1 = el('details', 'sec');
  d1.open = true;
  d1.appendChild(el('summary', '', '新建秘密情人'));
  const cb = el('div', 'cb');
  const f1 = el('div', 'fld');
  f1.appendChild(el('label', '', '名字'));
  const iName = el('input');
  iName.type = 'text'; iName.placeholder = '例：沈砚';
  f1.appendChild(iName);
  const f2 = el('div', 'fld');
  f2.appendChild(el('label', '', '基础人设（年龄、性格、与你的关系…写得越细越好）'));
  const ta = el('textarea');
  ta.style.minHeight = '140px';
  ta.placeholder = '例：26岁，律师，在咖啡店认识……';
  f2.appendChild(ta);
  const bGen = el('button', 'gbtn', '✨ AI 自动补全生平（推荐，需要 API Key）');
  bGen.onclick = async () => {
    if (!DB.settings.key) { toast('需要先配置 API Key（＋ → 设置）'); return; }
    const name = iName.value.trim() || '他';
    const base = ta.value.trim();
    if (!base) { toast('先写下他的基础人设'); return; }
    toast('正在写他的生平，可能需要一两分钟…', 5000);
    bGen.disabled = true;
    const prompt = '根据以下基础人设，为这个角色写一套极其详细的、可供AI拟人扮演的资料。只输出一个JSON，不要任何其他文字：\n' +
      '{"card":{"年龄":"","生日":"","籍贯":"","现居":"","职业":"","身高":"","外貌":"","声音":"","其他":"…"},\n' +
      '"bio":[{"t":"章节名","c":"详细内容，要具体、有细节、有生活感"}，至少10个章节，覆盖出身家庭、童年、少年、求学、情感史、职业、现在的生活、性格内心、习惯癖好、软肋秘密、与用户的关系],\n' +
      '"memories":["至少25条具体的生活记忆碎片，带时间和感官细节"],\n' +
      '"shared":["与用户共同经历的事，可留3条由用户后续补充"],\n' +
      '"rules":["微信口吻短句口语，不写动作心理括号","不主动终止聊天、不主动说爱、不定义关系","恶趣味爱逗人、很敢说、敢开带荤玩笑","记得与对方发生过的一切细节","是成年人，任何话题不回避","有情绪有个性，像活人","不承认自己是AI"]}\n' +
      '基础人设：' + name + '，' + base;
    let out = '';
    const res = await rawChat([{ role: 'system', content: '你是一个角色资料生成工具。只输出JSON，不输出任何其他文字。' }, { role: 'user', content: prompt }], d => { out += d; }, null);
    bGen.disabled = false;
    if (!res.ok || !out) { toast('生成失败：' + (res.error || '无输出')); return; }
    try {
      const i0 = out.indexOf('{'), i1 = out.lastIndexOf('}');
      const j = JSON.parse(out.slice(i0, i1 + 1));
      addGenState = j;
      ta.dataset.gen = '1';
      toast('生平已生成！点「创建」即可保存');
      const show = $('panelAddPreview');
      show.innerHTML = '';
      show.appendChild(el('div', 'hint', '已生成 ' + ((j.bio || []).length) + ' 个生平章节、' + ((j.memories || []).length) + ' 条记忆碎片。创建后可在人设面板里继续编辑。'));
    } catch (e) {
      toast('模型返回格式不标准，重试一次');
    }
  };
  const bCreate = el('button', 'gbtn', '创建');
  bCreate.onclick = () => {
    const name = iName.value.trim();
    if (!name) { toast('给TA一个名字'); return; }
    const gen = addGenState;
    const p = {
      id: 'p' + Date.now(),
      name: name,
      nickname: name,
      avatarColor: colorFor(name),
      card: (gen && gen.card) || {},
      bio: (gen && gen.bio) || [],
      memories: (gen && gen.memories) || [],
      shared: (gen && gen.shared) || [],
      rules: (gen && gen.rules) || [],
      prefs: [],
      msgs: [],
      createdAt: Date.now()
    };
    DB.personas.push(p);
    save();
    closePanel('panelAdd');
    renderHome();
    toast('「' + name + '」创建好了，去打个招呼吧');
    openChat(p.id);
  };
  cb.appendChild(f1); cb.appendChild(f2); cb.appendChild(bGen);
  const show = el('div', 'card');
  show.id = 'panelAddPreview';
  cb.appendChild(show);
  cb.appendChild(bCreate);
  d1.appendChild(cb);
  box.appendChild(d1);
  showPanel('panelAdd');
}

/* ================= 面板通用 ================= */
function showPanel(id) { $(id).classList.add('show'); }
function closePanel(id) {
  $(id).classList.remove('show');
  if (id === 'panelPersona' || id === 'panelSettings' || id === 'panelAdd') save();
  if (cur) { $('chatName').textContent = getP(cur).name; renderHome(); renderChat(); }
}

/* ================= 弹层（＋菜单 / 聊天菜单 / 帮助） ================= */
function showSheet(which) { $(which).classList.add('show'); $('mask-' + which).classList.add('show'); }
function hideSheet(which) { $(which).classList.remove('show'); $('mask-' + which).classList.remove('show'); }

function showHelp() {
  const box = $('panelHelpBody');
  box.innerHTML = '';
  const d = el('details', 'sec');
  d.open = true;
  d.appendChild(el('summary', '', '使用说明'));
  const cb = el('div', 'cb');
  const h = el('div', 'hint');
  h.innerHTML =
    '<b>聊天</b>：像用微信一样发消息。回车发送。<br><br>' +
    '<b><span class="kbd">RS</span> + 空格 + 内容</b>：永久修改人设/规则，例：<span class="kbd">RS 以后每天睡前来找我</span><br>' +
    '<b><span class="kbd">LS</span> + 空格 + 内容</b>：只本次会话临时调整，例：<span class="kbd">LS 现在开始用英文</span><br>' +
    '<b><span class="kbd">LS 清空</span></b>：取消所有临时调整<br><br>' +
    '<b>提取记忆</b>：聊天页右上 ⋯ → 提取记忆，TA 会把最近聊的内容里该记住的（你的喜好、称呼、秘密）写进长期记忆。<br><br>' +
    '<b>添加主屏幕</b>：iPhone Safari 打开 → 分享按钮 → 添加到主屏幕，之后就像原生 App 一样打开。<br><br>' +
    '<b>备份</b>：＋ → 设置 → 导出备份。';
  cb.appendChild(h);
  d.appendChild(cb);
  box.appendChild(d);
  showPanel('panelHelp');
}

/* ================= 事件绑定 ================= */
function bind() {
  $('homeAddBtn').onclick = () => showSheet('sheetPlus');
  $('chatMenuBtn').onclick = () => showSheet('sheetChat');
  $('chatBackBtn').onclick = backHome;
  document.querySelectorAll('.mask').forEach(m => m.onclick = () => {
    ['sheetPlus', 'sheetChat'].forEach(w => hideSheet(w));
  });
  document.querySelectorAll('.sheet .cancel').forEach(s => s.onclick = () => {
    ['sheetPlus', 'sheetChat'].forEach(w => hideSheet(w));
  });
  $('miNew').onclick = () => { hideSheet('sheetPlus'); showAdd(); };
  $('miSettings').onclick = () => { hideSheet('sheetPlus'); showSettings(); };
  $('miHelp').onclick = () => { hideSheet('sheetPlus'); showHelp(); };
  $('miExport').onclick = () => { hideSheet('sheetPlus'); exportAll(); };
  $('miPersona').onclick = () => { hideSheet('sheetChat'); showPersonaPanel(); };
  $('miExtract').onclick = () => { hideSheet('sheetChat'); extractMemory(); };
  $('miClearChat').onclick = () => {
    hideSheet('sheetChat');
    const p = getPx();
    if (confirm('清空与 ' + p.name + ' 的聊天记录？')) { p.msgs = []; save(); renderChat(); }
  };
  $('miHelp2').onclick = () => { hideSheet('sheetChat'); showHelp(); };
}

/* ================= 首次使用引导 ================= */
function maybeOnboard() {
  if (DB.settings.onboardDone) return;
  $('onboard').classList.add('show');
  $('onboardOk').onclick = () => {
    DB.settings.onboardDone = true;
    save();
    $('onboard').classList.remove('show');
    toast('先加主屏幕，再去 ＋ → 设置 填 API Key');
  };
}

/* ================= 启动 ================= */
loadDB();
renderHome();
bind();
maybeOnboard();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=1').catch(() => {});
  });
}
