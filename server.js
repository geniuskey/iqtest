'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { generateTest, toPublic, renderCell, SCHEDULE, OPTION_COUNT } = require('./lib/puzzles');
const { grade, toIq, teaserBucket, classify } = require('./lib/scoring');
const { Store } = require('./lib/store');
const { createPaymentProvider } = require('./lib/payment');

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    price: Number(env.PRICE || 4900),
    listPrice: Number(env.LIST_PRICE || 9900),
    durationSec: Number(env.TEST_DURATION_SEC || 25 * 60),
    calibrationMin: Number(env.CALIBRATION_MIN || 300),
    dataFile: env.DATA_FILE === '' ? null : env.DATA_FILE || path.join(__dirname, 'data', 'db.json'),
    // none: 전부 무료 + 광고 수익 / mock: 테스트 결제 / toss: 토스페이먼츠 실결제
    provider: env.PAYMENT_PROVIDER || 'none',
    adsenseClient: env.ADSENSE_CLIENT || null,
    adsenseSlot: env.ADSENSE_SLOT || null,
    tossClientKey: env.TOSS_CLIENT_KEY,
    tossSecretKey: env.TOSS_SECRET_KEY,
  };
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createApp(config = loadConfig()) {
  const store = new Store(config.dataFile);
  const payments = createPaymentProvider(config);
  const newId = () => crypto.randomBytes(12).toString('base64url');
  const free = payments.name === 'none';

  // ------------------------------------------------------------ 핸들러

  function publicConfig() {
    return {
      price: config.price,
      listPrice: config.listPrice,
      provider: payments.name,
      clientKey: payments.clientKey,
      free,
      adsense: config.adsenseClient ? { client: config.adsenseClient, slot: config.adsenseSlot } : null,
      durationSec: config.durationSec,
      questionCount: SCHEDULE.length,
      optionCount: OPTION_COUNT,
      takers: store.count('results'),
    };
  }

  function createSession() {
    const session = {
      id: newId(),
      seed: crypto.randomInt(1, 2 ** 31),
      createdAt: Date.now(),
      resultId: null,
    };
    store.put('sessions', session.id, session);
    const questions = generateTest(session.seed).map(toPublic);
    return { sessionId: session.id, durationSec: config.durationSec, startedAt: session.createdAt, questions };
  }

  function submit(sessionId, body) {
    const session = store.get('sessions', sessionId);
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '테스트 세션을 찾을 수 없습니다.');
    if (session.resultId) return { resultId: session.resultId };

    const raw = Array.isArray(body.answers) ? body.answers : [];
    const answers = SCHEDULE.map((_, i) => {
      const a = raw[i];
      return Number.isInteger(a) && a >= 0 && a < OPTION_COUNT ? a : null;
    });
    const questions = generateTest(session.seed);
    const g = grade(questions, answers);
    const population = store.values('results').map((r) => r.ratio);
    const { iq, percentile } = toIq(g.ratio, population, config.calibrationMin);
    const elapsedSec = Math.min(Math.round((Date.now() - session.createdAt) / 1000), config.durationSec);

    const result = {
      id: newId(),
      sessionId,
      createdAt: Date.now(),
      elapsedSec,
      answers,
      ratio: g.ratio,
      correctCount: g.correctCount,
      answeredCount: g.answeredCount,
      categories: g.categories,
      difficulties: g.difficulties,
      iq,
      percentile,
      paid: false,
      name: null,
    };
    store.put('results', result.id, result);
    session.resultId = result.id;
    store.put('sessions', session.id, session);
    return { resultId: result.id };
  }

  function getResult(resultId) {
    const r = store.get('results', resultId);
    if (!r) throw new HttpError(404, 'RESULT_NOT_FOUND', '결과를 찾을 수 없습니다.');
    const base = {
      id: r.id,
      createdAt: r.createdAt,
      elapsedSec: r.elapsedSec,
      answeredCount: r.answeredCount,
      total: SCHEDULE.length,
      teaser: teaserBucket(r.percentile),
      categoryLabels: Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, v.label])),
      paid: r.paid,
      unlocked: r.paid || free,
      price: config.price,
      listPrice: config.listPrice,
    };
    if (!base.unlocked) return base;

    // 결제 완료(또는 무료 모드): 전체 리포트 + 문제별 해설
    const session = store.get('sessions', r.sessionId);
    const questions = generateTest(session.seed);
    return {
      ...base,
      name: r.name,
      iq: r.iq,
      percentile: r.percentile,
      classification: classify(r.iq),
      correctCount: r.correctCount,
      categories: r.categories,
      difficulties: r.difficulties,
      review: questions.map((q, i) => ({
        id: q.id,
        difficulty: q.difficulty,
        category: q.category,
        cells: q.grid.slice(0, 8).map(renderCell),
        options: q.options.map(renderCell),
        answerIndex: q.answerIndex,
        chosen: r.answers[i],
      })),
    };
  }

  function createOrder(resultId, body) {
    const r = store.get('results', resultId);
    if (!r) throw new HttpError(404, 'RESULT_NOT_FOUND', '결과를 찾을 수 없습니다.');
    if (free) throw new HttpError(400, 'PAYMENT_DISABLED', '무료 모드에서는 결제가 필요 없습니다.');
    if (r.paid) throw new HttpError(409, 'ALREADY_PAID', '이미 결제가 완료된 결과입니다.');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 20) : '';
    const order = {
      orderId: `iq_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`,
      resultId,
      name,
      amount: config.price,
      status: 'pending',
      createdAt: Date.now(),
    };
    store.put('orders', order.orderId, order);
    return {
      orderId: order.orderId,
      amount: order.amount,
      orderName: 'IQ 테스트 정밀 결과 리포트',
      provider: payments.name,
      clientKey: payments.clientKey,
      customerKey: `cust_${crypto.createHash('sha256').update(resultId).digest('hex').slice(0, 24)}`,
    };
  }

  async function confirmPayment(body) {
    const { orderId, paymentKey } = body;
    const amount = Number(body.amount);
    const order = typeof orderId === 'string' && store.get('orders', orderId);
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', '주문을 찾을 수 없습니다.');
    if (order.status === 'paid') return { resultId: order.resultId };
    if (order.status === 'confirming') throw new HttpError(409, 'IN_PROGRESS', '결제 승인이 진행 중입니다.');
    // 클라이언트가 금액을 조작하지 못하도록 서버에 저장된 금액과 비교
    if (amount !== order.amount) throw new HttpError(400, 'AMOUNT_MISMATCH', '결제 금액이 일치하지 않습니다.');

    order.status = 'confirming';
    let res;
    try {
      res = await payments.confirm({ paymentKey, orderId, amount });
    } catch (e) {
      res = { ok: false, code: 'CONFIRM_ERROR', message: '결제 승인 중 오류가 발생했습니다.' };
    }
    if (!res.ok) {
      order.status = 'pending';
      store.put('orders', orderId, order);
      throw new HttpError(402, res.code, res.message);
    }
    Object.assign(order, { status: 'paid', paymentKey, paidAt: Date.now(), method: res.method, receiptUrl: res.receiptUrl || null });
    store.put('orders', orderId, order);
    const result = store.get('results', order.resultId);
    result.paid = true;
    result.name = order.name || null;
    store.put('results', result.id, result);
    return { resultId: result.id };
  }

  // ------------------------------------------------------------ 라우팅

  const routes = [
    ['GET', /^\/api\/config$/, () => publicConfig()],
    ['GET', /^\/api\/sample$/, () => toPublic(generateTest(20260101)[0])],
    ['GET', /^\/api\/sample$/, () => toPublic(generateTest(20260101)[0])],
    ['POST', /^\/api\/sessions$/, () => createSession()],
    ['POST', /^\/api\/sessions\/([\w-]+)\/submit$/, (m, body) => submit(m[1], body)],
    ['GET', /^\/api\/results\/([\w-]+)$/, (m) => getResult(m[1])],
    ['POST', /^\/api\/results\/([\w-]+)\/orders$/, (m, body) => createOrder(m[1], body)],
    ['POST', /^\/api\/payments\/confirm$/, (m, body) => confirmPayment(body)],
  ];

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(new HttpError(413, 'TOO_LARGE', '요청이 너무 큽니다.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new HttpError(400, 'BAD_JSON', '잘못된 요청입니다.'));
        }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    let file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'FORBIDDEN' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA: 확장자가 없는 경로는 index.html
      if (path.extname(rel)) return sendJson(res, 404, { error: 'NOT_FOUND' });
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, re, handler] of routes) {
          const m = url.pathname.match(re);
          if (m && req.method === method) {
            const body = method === 'POST' ? await readBody(req) : {};
            return sendJson(res, 200, await handler(m, body));
          }
        }
        throw new HttpError(404, 'NOT_FOUND', '존재하지 않는 API입니다.');
      }
      if (url.pathname === '/ads.txt') {
        // 애드센스 승인/수익 보호용 판매자 선언 파일
        if (!config.adsenseClient) throw new HttpError(404, 'NOT_FOUND', 'ads.txt 없음');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`google.com, ${config.adsenseClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '허용되지 않는 요청입니다.');
      serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      sendJson(res, 500, { error: 'INTERNAL', message: '서버 오류가 발생했습니다.' });
    }
  });

  return { server, store, config };
}

if (require.main === module) {
  const config = loadConfig();
  const { server, store } = createApp(config);
  server.listen(config.port, () => {
    console.log(`IQ test server: http://localhost:${config.port}  (payment: ${config.provider}${config.provider === 'none' ? '' : `, price: ₩${config.price}`}, adsense: ${config.adsenseClient || 'off'})`);
  });
  const shutdown = () => {
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp, loadConfig };
