/* Schat v2 —— 通用工具
 * 浏览器与 Node 双环境可用（经典脚本，挂载到 SCHAT 命名空间）。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const util = {};

  /* 唯一 id：时间戳 + 随机数（避免依赖 crypto.randomUUID，兼容 jsdom/旧 iOS） */
  util.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  /* 数字补零 */
  util.p2 = function (n) { return n < 10 ? '0' + n : '' + n; };

  /* 防抖 */
  util.debounce = function (fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* 深拷贝（人设数据为纯 JSON） */
  util.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* 随机整数 [a,b) */
  util.randInt = function (a, b) { return a + Math.floor(Math.random() * (b - a)); };

  /* 弹性随机（节奏用）：区间内随机，且不连续重复同一个值、不连续两次都命中极端值
   *（区间两端各 15% 视为极端）——防止一直秒回或一直拖很久。last 传上一次的值。 */
  util.elasticRand = function (a, b, last) {
    const span = b - a;
    const edge = function (x) { return span > 0 && (x <= a + span * 0.15 || x >= b - span * 0.15); };
    let v = util.randInt(a, b);
    for (let i = 0; i < 10 && last != null && (v === last || (edge(v) && edge(last))); i++) {
      v = util.randInt(a, b);
    }
    return v;
  };

  /* 微信列表时间格式：今天 HH:mm / 昨天 / 周一~周日 / 年-月-日 */
  util.listTime = function (ts) {
    const d = new Date(ts), now = new Date();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = (today - day) / 86400000;
    if (diff <= 0) return util.p2(d.getHours()) + ':' + util.p2(d.getMinutes());
    if (diff === 1) return '昨天';
    if (diff < 7) return '周' + '日一二三四五六'[d.getDay()];
    return d.getFullYear() + '-' + util.p2(d.getMonth() + 1) + '-' + util.p2(d.getDate());
  };

  /* 聊天内分隔时间：今天/昨天/月-日 + HH:mm */
  util.chatTime = function (ts) {
    const d = new Date(ts), now = new Date();
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const diff = (today - day) / 86400000;
    const hm = util.p2(d.getHours()) + ':' + util.p2(d.getMinutes());
    if (diff <= 0) return hm;
    if (diff === 1) return '昨天 ' + hm;
    return util.p2(d.getMonth() + 1) + '月' + util.p2(d.getDate()) + '日 ' + hm;
  };

  G.util = util;
  if (typeof module !== 'undefined' && module.exports) module.exports = util;
})();
