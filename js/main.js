/* Schat v2 —— 应用启动器 */
(function () {
  'use strict';

  let started = false;

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function (err) {
        console.warn('[Schat] Service Worker 注册失败', err);
      });
    }, { once: true });
  }

  function boot() {
    if (started) return;
    started = true;

    const app = window.SCHAT;
    const initStore = app.store && app.store.init
      ? app.store.init()
      : Promise.resolve();

    initStore
      .then(function () { return app.sync.boot(); })
      .then(function () {
        app.ui.bootUi();
        window.setInterval(app.engine.tick, 15000);
      })
      .catch(function (err) {
        console.error('[Schat] 启动失败', err);
        window.setTimeout(function () { throw err; }, 0);
      });
  }

  registerServiceWorker();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
