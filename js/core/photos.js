/* Schat v2 —— 角色生活照
 * 两种来源：
 *  1) 角色专属本地相册（persona.photoLocal）：真实照片池，随机取一张；
 *  2) 免费随机图库 loremflickr（persona.photoKw，仅无本地相册时用）。
 * 图片到手后立刻通过 canvas 压缩并转 data:image 持久化进聊天记录，刷新不消失。
 * 任何一步失败都静默跳过，绝不影响聊天。
 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const photos = {};

  /* blob → 压缩后的 dataURL；失败返回 null */
  function blobToDataUrl(blob) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        let out = null;
        try {
          const MAX = 640;
          let w = img.width, h = img.height;
          if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          if (!ctx) { resolve(null); return; } // jsdom 无 canvas：测试环境直接跳过
          ctx.drawImage(img, 0, 0, w, h);
          out = cv.toDataURL('image/jpeg', 0.72);
        } catch (e) { out = null; }
        if (img.src && img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src); // 用完即释放，避免 blob 堆积
        resolve(out);
      };
      img.onerror = function () {
        if (img.src && img.src.indexOf('blob:') === 0) URL.revokeObjectURL(img.src);
        resolve(null);
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  /* 抓一张图库图并转成压缩后的 dataURL；失败返回 null */
  photos.fetchOne = function (kw) {
    const url = 'https://loremflickr.com/640/480/' + encodeURIComponent(kw || 'daily') + '?random=' + Date.now();
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('img http ' + r.status);
      return r.blob();
    }).then(blobToDataUrl).catch(function () { return null; });
  };

  /* 从本地相册随机取一张（角色专属真实照片池）；失败返回 null */
  photos.fetchLocal = function (list) {
    if (!list || !list.length) return Promise.resolve(null);
    const url = list[Math.floor(Math.random() * list.length)];
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('local img ' + r.status);
      return r.blob();
    }).then(blobToDataUrl).catch(function () { return null; });
  };

  G.photos = photos;
  if (typeof module !== 'undefined' && module.exports) module.exports = photos;
})();
