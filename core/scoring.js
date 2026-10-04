// 브라우저(<script>)와 Node(require) 양쪽에서 쓰는 공용 모듈 (UMD)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./puzzles'));
  else (root.IQCore = root.IQCore || {}).scoring = factory(root.IQCore.puzzles);
})(typeof self !== 'undefined' ? self : this, function (puzzles) {
'use strict';

const { WEIGHTS, CATEGORIES } = puzzles;

// ---------------------------------------------------------------- 정규분포

function erf(x) {
  // Abramowitz-Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

function normInv(p) {
  // Acklam 근사
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------- 채점

// 사전 규준(가정값): 가중 정답률의 평균/표준편차. 실제 응시 데이터가 쌓이면 경험적 분포로 대체된다.
const PRIOR = { mean: 0.5, sd: 0.17 };
const IQ_MIN = 55;
const IQ_MAX = 150;

function grade(questions, answers) {
  const correct = questions.map((q, i) => answers[i] === q.answerIndex);
  let earned = 0;
  let possible = 0;
  const categories = {};
  const difficulties = {};
  questions.forEach((q, i) => {
    const w = WEIGHTS[q.difficulty];
    possible += w;
    if (correct[i]) earned += w;
    const cat = (categories[q.category] ||= { label: CATEGORIES[q.category], correct: 0, total: 0 });
    cat.total++;
    if (correct[i]) cat.correct++;
    const dif = (difficulties[q.difficulty] ||= { correct: 0, total: 0 });
    dif.total++;
    if (correct[i]) dif.correct++;
  });
  return {
    correct,
    correctCount: correct.filter(Boolean).length,
    answeredCount: answers.filter((a) => a !== null && a !== undefined).length,
    ratio: earned / possible,
    categories,
    difficulties,
  };
}

// ratio -> { iq, percentile(0~100, 아래에 있는 비율) }
// population: 지금까지 저장된 응시자들의 ratio 배열. 충분히 쌓이면 그 분포로 백분위를 계산한다.
function toIq(ratio, population = [], minSample = 300) {
  let p;
  if (population.length >= minSample) {
    let below = 0;
    let equal = 0;
    for (const r of population) {
      if (r < ratio) below++;
      else if (r === ratio) equal++;
    }
    p = (below + equal / 2 + 0.5) / (population.length + 1);
  } else {
    p = normCdf((ratio - PRIOR.mean) / PRIOR.sd);
  }
  p = Math.min(Math.max(p, 1e-5), 1 - 1e-5);
  const iq = Math.round(Math.min(IQ_MAX, Math.max(IQ_MIN, 100 + 15 * normInv(p))));
  // 표시용 백분위는 반올림된 IQ와 일관되게 맞춘다
  const percentile = normCdf((iq - 100) / 15) * 100;
  return { iq, percentile };
}

// 무료 결과에서 보여줄 "상위 N%" 구간 — 정확한 값 대신 대략적인 구간만 공개
const BUCKETS = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];

function teaserBucket(percentile) {
  const top = 100 - percentile;
  const idx = BUCKETS.findIndex((b) => top <= b);
  const upper = BUCKETS[idx];
  const lower = idx > 0 ? BUCKETS[idx - 1] : 0;
  return { topPercent: upper, range: [lower, upper] };
}

function classify(iq) {
  if (iq >= 130) return '최우수 (Very Superior)';
  if (iq >= 120) return '우수 (Superior)';
  if (iq >= 110) return '평균 상 (High Average)';
  if (iq >= 90) return '평균 (Average)';
  if (iq >= 80) return '평균 하 (Low Average)';
  if (iq >= 70) return '경계선 (Borderline)';
  return '낮음 (Low)';
}

return { grade, toIq, teaserBucket, classify, normCdf, normInv, PRIOR };
});
