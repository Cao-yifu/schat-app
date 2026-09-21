/* Schat v2 —— 角色生活照
 * 调用免费随机图库 loremflickr（CORS 友好），图片到手后立刻通过 canvas 压缩并转
 * data:image 持久化进聊天记录，刷新不消失；之后不再依赖外网。
 * 任何一步失败都静默跳过，绝不影响聊天。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const photos = {};

  /* 抓一张图并转成压缩后的 dataURL；失败返回 null */
  photos.fetchOne = function (kw) {
    const url = 'https://loremflickr.com/640/480/' + encodeURIComponent(kw || 'daily') + '?random=' + Date.now();
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('img http ' + r.status);
      return r.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () {
          try {
            const MAX = 640;
            let w = img.width, h = img.height;
            if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d');
            if (!ctx) { resolve(null); return; } // jsdom 无 canvas：测试环境直接跳过
            ctx.drawImage(img, 0, 0, w, h);
            resolve(cv.toDataURL('image/jpeg', 0.72));
          } catch (e) { resolve(null); }
        };
        img.onerror = function () { resolve(null); };
        img.src = URL.createObjectURL(blob);
      });
    }).catch(function () { return null; });
  };

  G.photos = photos;
  if (typeof module !== 'undefined' && module.exports) module.exports = photos;
})();
