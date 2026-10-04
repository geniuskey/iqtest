// 브라우저(<script>)와 Node(require) 양쪽에서 쓰는 공용 모듈 (UMD)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.IQCore = root.IQCore || {}).rng = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// 시드 기반 난수 생성기 (mulberry32) — 같은 시드면 항상 같은 문제가 재현된다.
function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[next.int(arr.length)];
  next.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = next.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  next.sample = (arr, k) => next.shuffle(arr).slice(0, k);
  return next;
}

return { createRng };
});
