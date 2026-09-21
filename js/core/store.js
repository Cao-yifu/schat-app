/* Schat v2 —— 本地存储层
 * 设计目标：数据全本地、绝不外发；浏览器用 IndexedDB，无 IndexedDB 的环境
 * （如 jsdom 测试）自动降级 localStorage，接口完全一致。
 *
 * 存储内容：
 *   kv   —— 设置、人设副本、墓碑、RS 永久设定、LS 会话设定、承诺、未读数、版本号等
 *   msgs —— 每个情人的聊天记录数组（key = msgs:<loverId>），元素结构：
 *            { id, role:'me'|'you'|'sys', type:'text'|'image', text, src,
 *              quote:{text,who}|null, ts, follow:bool }
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const store = {};
  let driver = null; // 'idb' | 'local'

  /* ---------------- IndexedDB 驱动 ---------------- */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open('schat-v2', 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore('kv');
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbTx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction('kv', mode);
      const os = tx.objectStore('kv');
      const out = fn(os);
      tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  /* ---------------- localStorage 驱动（降级用） ---------------- */
  const LS_KEY = 'schat-v2-store';
  store.LS_KEY = LS_KEY; // 供 UI 精确清理（GitHub Pages 源站共享，绝不能全站 clear）
  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function lsWrite(obj) {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  }

  store.init = function () {
    if (typeof indexedDB !== 'undefined') {
      driver = 'idb';
      return idbOpen().then(function (db) {
        store._db = db;
      }).catch(function () {
        driver = 'local'; // 隐私模式等场景下降级
      });
    }
    driver = 'local';
    return Promise.resolve();
  };
  store.driver = function () { return driver; };

  /* kv 读写（值为任意 JSON） */
  store.get = function (key, def) {
    if (driver === 'idb') {
      return idbTx(store._db, 'readonly', function (os) { return os.get(key); })
        .then(function (v) { return v === undefined ? def : v; });
    }
    const v = lsRead()[key];
    return Promise.resolve(v === undefined ? def : v);
  };
  store.set = function (key, val) {
    if (driver === 'idb') {
      return idbTx(store._db, 'readwrite', function (os) { return os.put(val, key); });
    }
    const o = lsRead(); o[key] = val; lsWrite(o);
    return Promise.resolve();
  };
  store.del = function (key) {
    if (driver === 'idb') {
      return idbTx(store._db, 'readwrite', function (os) { return os.delete(key); });
    }
    const o = lsRead(); delete o[key]; lsWrite(o);
    return Promise.resolve();
  };

  /* 消息读写 */
  /* 消息读写（按 key 串行化：并发读-改-写会丢消息，如照片入库与 trimMsgs 裁剪撞车） */
  const chains = {};
  function chain(key, fn) {
    const prev = chains[key] || Promise.resolve();
    const next = prev.then(fn);
    chains[key] = next.catch(function () {}); // 链条不断：上一步失败不阻塞后续写
    return next;
  }

  store.msgs = function (loverId) {
    return store.get('msgs:' + loverId, []);
  };
  store.appendMsg = function (loverId, msg) {
    return chain('msgs:' + loverId, function () {
      return store.msgs(loverId).then(function (arr) {
        arr.push(msg);
        return store.set('msgs:' + loverId, arr).then(function () { return msg; });
      });
    });
  };
  store.updateMsg = function (loverId, msg) {
    return chain('msgs:' + loverId, function () {
      return store.msgs(loverId).then(function (arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].id === msg.id) { arr[i] = msg; break; }
        }
        return store.set('msgs:' + loverId, arr);
      });
    });
  };
  store.clearMsgs = function (loverId) {
    return chain('msgs:' + loverId, function () {
      return store.set('msgs:' + loverId, []);
    });
  };
  /* 只保留最近 keepN 条（图片消息占空间） */
  store.trimMsgs = function (loverId, keepN) {
    return chain('msgs:' + loverId, function () {
      return store.msgs(loverId).then(function (arr) {
        if (arr.length > keepN) {
          arr = arr.slice(arr.length - keepN);
          return store.set('msgs:' + loverId, arr);
        }
      });
    });
  };

  G.store = store;
  if (typeof module !== 'undefined' && module.exports) module.exports = store;
})();
