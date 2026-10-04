// 브라우저(<script>)와 Node(require) 양쪽에서 쓰는 공용 모듈 (UMD)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./puzzles'), require('./scoring'));
  else (root.IQCore = root.IQCore || {}).result = factory(root.IQCore.puzzles, root.IQCore.scoring);
})(typeof self !== 'undefined' ? self : this, function (puzzles, scoring) {
'use strict';

// 서버 없이 결과를 공유하기 위해, 결과 전체를 링크 안의 짧은 코드로 담는다.
// 코드 = 버전.시드.소요시간(초).응시일(일).답안   (숫자는 36진수, 답안은 0~5 또는 '-'(미응답))
// 예) 1.k3j2x1.ld.1bxa.0123-4501234...
// 링크만 있으면 같은 시드로 문제를 다시 만들고 채점해서 리포트를 똑같이 재현할 수 있다.

const { generateTest, renderCell, SCHEDULE, OPTION_COUNT } = puzzles;
const { grade, toIq, teaserBucket, classify } = scoring;

const VERSION = '1';
const DAY = 86400000;
const ANSWERS_RE = new RegExp(`^[0-${OPTION_COUNT - 1}-]{${SCHEDULE.length}}$`);

function encodeResult({ seed, answers, elapsedSec, createdAt }) {
  return [
    VERSION,
    seed.toString(36),
    Math.max(0, Math.round(elapsedSec)).toString(36),
    Math.floor(createdAt / DAY).toString(36),
    answers.map((a) => (a === null || a === undefined ? '-' : String(a))).join(''),
  ].join('.');
}

function decodeResult(code) {
  const parts = String(code || '').split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return null;
  const [, s, e, d, a] = parts;
  if (!/^[0-9a-z]{1,7}$/.test(s) || !/^[0-9a-z]{1,4}$/.test(e) || !/^[0-9a-z]{1,5}$/.test(d) || !ANSWERS_RE.test(a)) return null;
  const seed = parseInt(s, 36);
  if (seed < 1 || seed >= 2 ** 31) return null;
  return {
    seed,
    elapsedSec: parseInt(e, 36),
    createdAt: parseInt(d, 36) * DAY,
    answers: [...a].map((c) => (c === '-' ? null : Number(c))),
  };
}

// 결과 코드 → 화면에 그릴 리포트 (서버 버전의 /api/results 응답과 같은 모양)
function buildReport(code) {
  const data = decodeResult(code);
  if (!data) return null;
  const questions = generateTest(data.seed);
  const g = grade(questions, data.answers);
  const { iq, percentile } = toIq(g.ratio);
  return {
    id: code,
    certId: data.seed.toString(36).toUpperCase().padStart(6, '0'),
    createdAt: data.createdAt,
    elapsedSec: data.elapsedSec,
    answeredCount: g.answeredCount,
    total: questions.length,
    teaser: teaserBucket(percentile),
    categoryLabels: Object.fromEntries(Object.entries(g.categories).map(([k, v]) => [k, v.label])),
    unlocked: true,
    name: null,
    iq,
    percentile,
    classification: classify(iq),
    correctCount: g.correctCount,
    categories: g.categories,
    difficulties: g.difficulties,
    review: questions.map((q, i) => ({
      id: q.id,
      difficulty: q.difficulty,
      category: q.category,
      cells: q.grid.slice(0, 8).map(renderCell),
      options: q.options.map(renderCell),
      answerIndex: q.answerIndex,
      chosen: data.answers[i],
    })),
  };
}

return { encodeResult, decodeResult, buildReport };
});
