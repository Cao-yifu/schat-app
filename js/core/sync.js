/* Schat v2 —— 多情人版本同步 + 每角色动态状态
 *
 * 同步机制（需求 3.2）：
 *  - 人设随 JS 包分发，SCHAT_PERSONAS_VER 是版本锚点；
 *  - 已安装用户的本地副本在启动时与包内版本比对，新版本自动合并：
 *    新增角色自动安装、已更新角色覆盖旧数据；
 *  - 用户删除的角色写入墓碑表，之后任何版本更新都不会让它复活。
 * 同时承载每角色的动态状态：RS 永久设定、LS 会话设定、时间快进偏移、承诺列表、未读数。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const store = isNode ? require('./store.js') : G.store;
  const util = isNode ? require('./util.js') : G.util;

  const sync = {};

  function bundled() {
    const src = (typeof window !== 'undefined' && window.SCHAT_PERSONAS) || (typeof SCHAT_PERSONAS !== 'undefined' && SCHAT_PERSONAS) || (isNode && require('./personas.js').PERSONAS) || [];
    const ver = (typeof window !== 'undefined' && window.SCHAT_PERSONAS_VER) || (isNode && require('./personas.js').VER) || 1;
    return { list: src, ver: ver };
  }

  /* 启动同步：返回安装后的角色数组 */
  sync.boot = function () {
    const b = bundled();
    // 先读上次安装的版本号再比对：_installedVer 只在内存里，不读库会导致每次启动都误判为升级
    return store.get('installed_ver', 0).then(function (savedVer) {
      sync._installedVer = savedVer || 0;
      return store.get('personas', null).then(function (installed) {
        return store.get('tombstones', []).then(function (tombs) {
        let map = installed || {};
        let dirty = false;
        if (!installed) {
          // 首次安装：全部装
          map = {};
          for (const p of b.list) map[p.id] = util.clone(p);
          dirty = true;
        } else if (b.ver > (sync._installedVer || 0)) {
          // 版本升级：合并（尊重墓碑）
          for (const p of b.list) {
            if (tombs.indexOf(p.id) >= 0) { delete map[p.id]; continue; }
            if (!map[p.id] || JSON.stringify(map[p.id]) !== JSON.stringify(p)) {
              map[p.id] = util.clone(p);
              dirty = true;
            }
          }
          // 包内已移除的角色也下线（墓碑除外的不动数据？直接移除）
          for (const id of Object.keys(map)) {
            if (!b.list.some(function (p) { return p.id === id; })) { delete map[id]; dirty = true; }
          }
        }
        const save = dirty ? store.set('personas', map) : Promise.resolve();
        return save.then(function () {
          return store.set('installed_ver', b.ver).then(function () {
            sync._installedVer = b.ver;
            sync._map = map;
            return sync.list();
          });
        });
        });
      });
    });
  };

  sync.list = function () {
    if (sync._map) {
      const arr = Object.keys(sync._map).map(function (k) { return sync._map[k]; });
      arr.sort(function (a, b) { return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0); });
      return arr;
    }
    return bundled().list;
  };
  sync.get = function (id) {
    const arr = sync.list();
    for (const p of arr) if (p.id === id) return p;
    return null;
  };

  /* 删除角色 → 墓碑，不再复活 */
  sync.remove = function (id) {
    return store.get('tombstones', []).then(function (t) {
      if (t.indexOf(id) < 0) t.push(id);
      return store.set('tombstones', t);
    }).then(function () {
      if (sync._map) { delete sync._map[id]; return store.set('personas', sync._map); }
    });
  };
  sync.restore = function (id) { /* 未来如果想做「找回」，墓碑里移出即可 */
    return store.get('tombstones', []).then(function (t) {
      return store.set('tombstones', t.filter(function (x) { return x !== id; }));
    });
  };

  /* ---------- 每角色动态状态 ---------- */
  sync.rs = function (id) { return store.get('rs:' + id, []); };
  sync.addRS = function (id, rule) {
    return sync.rs(id).then(function (arr) { arr.push(rule); return store.set('rs:' + id, arr); });
  };
  sync.clearRS = function (id) { return store.set('rs:' + id, []); };
  sync.ls = function (id) { return store.get('ls:' + id, ''); };
  sync.setLS = function (id, v) { return store.set('ls:' + id, v || ''); };
  sync.offset = function (id) { return store.get('offset:' + id, 0); };
  sync.addOffset = function (id, ms) {
    return sync.offset(id).then(function (v) { return store.set('offset:' + id, (v || 0) + ms); });
  };
  sync.resetOffset = function (id) { return store.set('offset:' + id, 0); };

  sync.promises = function (id) { return store.get('promises:' + id, []); };
  sync.addPromises = function (id, list) {
    if (!list || !list.length) return Promise.resolve();
    return sync.promises(id).then(function (arr) {
      return store.set('promises:' + id, arr.concat(list));
    });
  };
  sync.settlePromise = function (id, idx) {
    return sync.promises(id).then(function (arr) {
      if (idx >= 0 && idx < arr.length) { arr[idx].done = true; return store.set('promises:' + id, arr); }
    });
  };

  sync.unread = function (id) { return store.get('unread:' + id, 0); };
  sync.setUnread = function (id, n) { return store.set('unread:' + id, n); };
  sync.lastPhotoAt = function (id) { return store.get('lastphoto:' + id, 0); };
  sync.setLastPhotoAt = function (id, ts) { return store.set('lastphoto:' + id, ts); };

  G.sync = sync;
  if (isNode) module.exports = sync;
})();
