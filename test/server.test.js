'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createApp, loadConfig } = require('../server');
const { generateTest } = require('../lib/puzzles');
const { toIq, teaserBucket } = require('../lib/scoring');

function startServer() {
  const config = { ...loadConfig({}), dataFile: null, port: 0 };
  const app = createApp(config);
  return new Promise((resolve) => {
    app.server.listen(0, () => {
      const base = `http://127.0.0.1:${app.server.address().port}`;
      const call = async (path, body) => {
        const res = await fetch(base + path, body === undefined ? {} : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.json() };
      };
      resolve({ ...app, call, close: () => new Promise((r) => app.server.close(r)) });
    });
  });
}

test('IQ 환산: 평균 정답률은 100 근처, 높을수록 IQ가 높다', () => {
  assert.strictEqual(toIq(0.5).iq, 100);
  assert.ok(toIq(0.8).iq > toIq(0.6).iq);
  assert.ok(toIq(1).iq <= 150 && toIq(0).iq >= 55);
  assert.deepStrictEqual(teaserBucket(93).range, [5, 10]);
  assert.strictEqual(teaserBucket(99.5).topPercent, 1);
});

test('전체 흐름: 응시 → 무료 결과(IQ 숨김) → 결제 → 전체 리포트', async () => {
  const app = await startServer();
  try {
    const session = await app.call('/api/sessions', {});
    assert.strictEqual(session.status, 200);
    const { sessionId, questions } = session.body;
    assert.strictEqual(questions.length, 30);
    // 정답은 클라이언트로 전송되지 않는다
    assert.ok(!JSON.stringify(session.body).includes('answerIndex'));

    // 서버에 저장된 시드로 정답을 알아내 앞쪽 20문항만 맞힌다
    const seed = app.store.get('sessions', sessionId).seed;
    const answers = generateTest(seed).map((q, i) => (i < 20 ? q.answerIndex : (q.answerIndex + 1) % 6));
    const sub = await app.call(`/api/sessions/${sessionId}/submit`, { answers });
    const { resultId } = sub.body;
    assert.ok(resultId);

    // 중복 제출은 같은 결과를 돌려준다
    const again = await app.call(`/api/sessions/${sessionId}/submit`, { answers: [] });
    assert.strictEqual(again.body.resultId, resultId);

    const teaser = await app.call(`/api/results/${resultId}`);
    assert.strictEqual(teaser.body.paid, false);
    assert.ok(teaser.body.teaser.topPercent > 0);
    for (const k of ['iq', 'percentile', 'correctCount', 'review', 'categories']) assert.ok(!(k in teaser.body), k);

    // 금액 조작은 거부
    const order = await app.call(`/api/results/${resultId}/orders`, { name: '홍길동' });
    assert.strictEqual(order.body.amount, 4900);
    const cheat = await app.call('/api/payments/confirm', { orderId: order.body.orderId, paymentKey: 'mock_x', amount: 100 });
    assert.strictEqual(cheat.status, 400);
    const badKey = await app.call('/api/payments/confirm', { orderId: order.body.orderId, paymentKey: 'fake', amount: 4900 });
    assert.strictEqual(badKey.status, 402);

    const ok = await app.call('/api/payments/confirm', { orderId: order.body.orderId, paymentKey: 'mock_abc', amount: 4900 });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.resultId, resultId);

    const full = await app.call(`/api/results/${resultId}`);
    assert.strictEqual(full.body.paid, true);
    assert.strictEqual(full.body.correctCount, 20);
    assert.strictEqual(full.body.name, '홍길동');
    assert.ok(full.body.iq >= 55 && full.body.iq <= 150);
    assert.strictEqual(full.body.review.length, 30);
    assert.ok(full.body.teaser.range[0] <= 100 - full.body.percentile && 100 - full.body.percentile <= full.body.teaser.range[1]);

    const paidAgain = await app.call(`/api/results/${resultId}/orders`, {});
    assert.strictEqual(paidAgain.status, 409);
  } finally {
    await app.close();
  }
});

test('정적 파일과 SPA 라우팅, 경로 탐색 차단', async () => {
  const app = await startServer();
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    assert.strictEqual((await fetch(`${base}/`)).status, 200);
    assert.strictEqual((await fetch(`${base}/app.js`)).status, 200);
    assert.strictEqual((await fetch(`${base}/missing.js`)).status, 404);
    const trav = await fetch(`${base}/..%2fserver.js`);
    assert.notStrictEqual(await trav.text().then((t) => t.includes('createApp')), true);
    assert.strictEqual((await fetch(`${base}/api/results/nope`)).status, 404);
  } finally {
    await app.close();
  }
});
