/* Schat v2 —— 照片已全部改为嵌入式本地池（js/core/photo_pools.js），零网图。
 * 本文件仅保留模块占位：photos.fetchOne / photos.fetchLocal 已废弃，
 * 不再发起任何网络图片请求。 */
(function () {
  const G = typeof window !== 'undefined' ? (window.SCHAT = window.SCHAT || {}) : (globalThis.SCHAT = globalThis.SCHAT || {});
  const photos = {};
  G.photos = photos;
  if (typeof module !== 'undefined' && module.exports) module.exports = photos;
})();
