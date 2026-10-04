'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encodeResult, decodeResult, buildReport } = require('../core/result');
const { generateTest } = require('../core/puzzles');

test('결과 코드: 인코딩한 값이 그대로 복원된다', () => {
  const answers = Array.from({ length: 30 }, (_, i) => (i % 7 === 0 ? null : i % 6));
  const createdAt = Date.UTC(2026, 9, 4);
  const code = encodeResult({ seed: 123456789, answers, elapsedSec: 1234.4, createdAt });
  assert.match(code, /^1\.[0-9a-z]+\.[0-9a-z]+\.[0-9a-z]+\.[0-5-]{30}$/);
  assert.deepStrictEqual(decodeResult(code), { seed: 123456789, answers, elapsedSec: 1234, createdAt });
});

test('결과 코드: 잘못된 링크는 거부한다', () => {
  const ok = encodeResult({ seed: 5, answers: Array(30).fill(0), elapsedSec: 10, createdAt: Date.now() });
  assert.ok(decodeResult(ok));
  for (const bad of ['', 'abc', ok.replace(/^1/, '2'), ok.slice(0, -1), `${ok}0`, ok.replace(/0$/, '9'), '1.0.a.b.' + '0'.repeat(30), '<script>']) {
    assert.strictEqual(decodeResult(bad), null, bad);
    assert.strictEqual(buildReport(bad), null, bad);
  }
});

test('리포트: 링크만으로 같은 채점 결과를 재현한다', () => {
  const seed = 987654;
  const qs = generateTest(seed);
  const answers = qs.map((q, i) => (i < 20 ? q.answerIndex : (q.answerIndex + 1) % 6));
  const code = encodeResult({ seed, answers, elapsedSec: 900, createdAt: Date.now() });
  const r = buildReport(code);
  assert.strictEqual(r.correctCount, 20);
  assert.strictEqual(r.answeredCount, 30);
  assert.strictEqual(r.review.length, 30);
  assert.ok(r.iq >= 55 && r.iq <= 150);
  assert.deepStrictEqual(buildReport(code), r);
  const allRight = buildReport(encodeResult({ seed, answers: qs.map((q) => q.answerIndex), elapsedSec: 900, createdAt: Date.now() }));
  assert.ok(allRight.iq > r.iq);
});
