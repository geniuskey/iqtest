'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { generateTest, renderCell, keyOf, SCHEDULE, OPTION_COUNT } = require('../core/puzzles');

test('같은 시드는 같은 시험지를 만든다', () => {
  assert.deepStrictEqual(generateTest(42), generateTest(42));
  assert.notDeepStrictEqual(generateTest(42), generateTest(43));
});

test('모든 문제는 서로 다른 보기 6개와 올바른 정답 인덱스를 가진다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const qs = generateTest(seed);
    assert.strictEqual(qs.length, SCHEDULE.length);
    for (const q of qs) {
      assert.strictEqual(q.options.length, OPTION_COUNT);
      assert.strictEqual(new Set(q.options.map(renderCell)).size, OPTION_COUNT, `${q.type} seed ${seed}`);
      assert.strictEqual(keyOf(q.options[q.answerIndex]), keyOf(q.grid[8]));
    }
  }
});

test('"가장 흔한 속성" 요령으로 정답을 맞히기 어렵다', () => {
  // 각 보기가 다른 보기들과 공유하는 속성 수가 가장 많은 것을 고르는 전략
  const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => {
    if (Array.isArray(v)) return v.map((x, i) => `${pre}${k}${typeof x === 'object' ? i : ''}=${JSON.stringify(x)}`);
    if (v && typeof v === 'object') return flat(v, `${pre}${k}.`);
    return [`${pre}${k}=${v}`];
  });
  let hits = 0;
  let n = 0;
  for (let seed = 1; seed <= 150; seed++) {
    for (const q of generateTest(seed)) {
      const sets = q.options.map((o) => new Set(flat(o)));
      const scores = sets.map((s, i) => sets.reduce((acc, t, j) => acc + (i === j ? 0 : [...s].filter((x) => t.has(x)).length), 0));
      const max = Math.max(...scores);
      const tops = scores.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
      hits += tops.includes(q.answerIndex) ? 1 / tops.length : 0;
      n++;
    }
  }
  assert.ok(hits / n < 0.25, `heuristic accuracy ${(hits / n).toFixed(3)}`);
});
