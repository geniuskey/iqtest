'use strict';

// 결제 승인 모듈.
//  - none: 결제 없음 (모든 결과 무료 공개, 광고로 수익화)
//  - mock: 실제 청구 없이 결제 흐름만 시뮬레이션 (개발/데모용)
//  - toss: 토스페이먼츠 결제위젯/결제창 → 서버에서 승인 API 호출
//    https://docs.tosspayments.com/reference#결제-승인

function createPaymentProvider(config) {
  if (config.provider === 'none') {
    return {
      name: 'none',
      clientKey: null,
      async confirm() {
        return { ok: false, code: 'PAYMENT_DISABLED', message: '결제가 비활성화되어 있습니다.' };
      },
    };
  }
  if (config.provider === 'toss') {
    if (!config.tossSecretKey || !config.tossClientKey) {
      throw new Error('PAYMENT_PROVIDER=toss 에는 TOSS_CLIENT_KEY, TOSS_SECRET_KEY 환경변수가 필요합니다.');
    }
    return {
      name: 'toss',
      clientKey: config.tossClientKey,
      async confirm({ paymentKey, orderId, amount }) {
        const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.tossSecretKey}:`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, code: body.code || 'CONFIRM_FAILED', message: body.message || '결제 승인에 실패했습니다.' };
        if (body.status !== 'DONE' || body.totalAmount !== amount) {
          return { ok: false, code: 'INVALID_STATE', message: '결제 상태가 올바르지 않습니다.' };
        }
        return { ok: true, method: body.method, approvedAt: body.approvedAt, receiptUrl: body.receipt && body.receipt.url };
      },
    };
  }

  return {
    name: 'mock',
    clientKey: null,
    async confirm({ paymentKey }) {
      if (typeof paymentKey !== 'string' || !paymentKey.startsWith('mock_')) {
        return { ok: false, code: 'INVALID_PAYMENT_KEY', message: '유효하지 않은 결제 키입니다.' };
      }
      return { ok: true, method: '테스트 결제', approvedAt: new Date().toISOString() };
    },
  };
}

module.exports = { createPaymentProvider };
