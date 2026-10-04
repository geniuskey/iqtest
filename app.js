'use strict';

(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $topSlot = document.getElementById('topbar-slot');
  const LS_SESSION = 'iq.session';
  const LS_LAST_RESULT = 'iq.lastResult';
  const { puzzles, result: resultCore } = window.IQCore;
  const site = window.IQ_CONFIG || {};

  // 정적 사이트 버전: 서버 없이 브라우저에서 문제 생성·채점, 결과는 링크에 담아 공유한다.
  const config = {
    free: true,
    durationSec: site.durationSec || 25 * 60,
    questionCount: puzzles.SCHEDULE.length,
    optionCount: puzzles.OPTION_COUNT,
    adsense: site.adsense && site.adsense.client ? { client: site.adsense.client, slot: site.adsense.slot || null } : null,
  };
  let timerHandle = null;

  // ------------------------------------------------------------ 유틸

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const storage = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
  };

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function stopTimer() {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  // 정규분포 (막대 그래프/종 곡선용)
  function normInv(p) {
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p < 0.02425 || p > 0.97575) {
      const q = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
      const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      return p < 0.5 ? x : -x;
    }
    const q = p - 0.5, r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const iqAtTop = (topPct) => (topPct <= 0 ? 150 : topPct >= 100 ? 55 : 100 + 15 * normInv(1 - topPct / 100));

  // 종 곡선 SVG — band: [IQ 하한, IQ 상한] 강조, marker: 정확한 IQ 위치
  function bellSvg({ band, marker }) {
    const W = 640, H = 220, L = 20, R = 620, BASE = 180;
    const lo = 55, hi = 145;
    const x = (iq) => L + ((Math.min(Math.max(iq, lo), hi) - lo) / (hi - lo)) * (R - L);
    const y = (iq) => BASE - 150 * Math.exp(-0.5 * ((iq - 100) / 15) ** 2);
    const path = (a, b) => {
      let d = `M${x(a).toFixed(1)},${BASE}`;
      for (let iq = a; iq <= b; iq += 0.5) d += ` L${x(iq).toFixed(1)},${y(iq).toFixed(1)}`;
      return `${d} L${x(b).toFixed(1)},${BASE} Z`;
    };
    let s = `<svg class="bell" viewBox="0 0 ${W} ${H}" role="img" aria-label="IQ 분포 그래프">`;
    s += `<defs><linearGradient id="bg-grad" x1="0" x2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>`;
    s += `<path d="${path(lo, hi)}" fill="#eef2ff" stroke="#c7d2fe" stroke-width="2"/>`;
    if (band) s += `<path d="${path(Math.max(lo, band[0]), Math.min(hi, band[1]))}" fill="url(#bg-grad)" opacity=".85"/>`;
    for (const t of [70, 85, 100, 115, 130, 145]) {
      s += `<line x1="${x(t)}" y1="${BASE}" x2="${x(t)}" y2="${BASE + 6}" stroke="#9ca3af"/>`;
      s += `<text x="${x(t)}" y="${BASE + 22}" text-anchor="middle" font-size="13" fill="#6b7280">${t}</text>`;
    }
    s += `<line x1="${L}" y1="${BASE}" x2="${R}" y2="${BASE}" stroke="#9ca3af"/>`;
    if (marker) {
      const mx = x(marker);
      s += `<line x1="${mx}" y1="${y(marker) - 14}" x2="${mx}" y2="${BASE}" stroke="#111827" stroke-width="2.5" stroke-dasharray="4 3"/>`;
      s += `<circle cx="${mx}" cy="${y(marker)}" r="7" fill="#111827" stroke="#fff" stroke-width="3"/>`;
      s += `<rect x="${mx - 30}" y="${Math.max(2, y(marker) - 46)}" width="60" height="26" rx="8" fill="#111827"/>`;
      s += `<text x="${mx}" y="${Math.max(2, y(marker) - 46) + 18}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">나 ${marker}</text>`;
    }
    return `${s}</svg>`;
  }

  function matrixHtml(cells, missingHtml = '?') {
    return `<div class="matrix">${cells.map((c) => `<div>${c}</div>`).join('')}<div class="missing">${missingHtml}</div></div>`;
  }

  // ------------------------------------------------------------ 광고 (애드센스)
  // 광고는 랜딩·분석 중·결과 화면에만 둔다. 문제 풀이 화면에는 넣지 않는다
  // (보기를 누르다 광고를 잘못 누르기 쉬운 배치는 애드센스 정책 위반 소지가 있다).

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

  function adSlot() {
    const ads = config && config.adsense;
    if (!ads) {
      return isLocal ? '<div class="ad"><div class="ad-label">광고</div><div class="ad-placeholder">광고 영역 (ADSENSE_CLIENT 설정 시 표시)</div></div>' : '';
    }
    if (!ads.slot) return ''; // 슬롯 없이 클라이언트 ID만 있으면 자동 광고에 맡긴다
    return `<div class="ad"><div class="ad-label">광고</div><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ads.client)}" data-ad-slot="${esc(ads.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
  }

  // SPA라서 화면을 새로 그릴 때마다 새 광고 칸을 채워 달라고 요청해야 한다
  function fillAds() {
    if (!config || !config.adsense || !window.adsbygoogle) return;
    $app.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
      try { window.adsbygoogle.push({}); } catch { /* 광고 차단기 등 */ }
    });
  }

  function loadAdsense() {
    if (!config.adsense) return;
    window.adsbygoogle = window.adsbygoogle || [];
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.adsense.client)}`;
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------ 라우팅

  async function route() {
    stopTimer();
    $topSlot.innerHTML = '';
    window.scrollTo(0, 0);
    const hash = location.hash.replace(/^#/, '') || '/';
    const [, view, id, step] = hash.split('/');
    try {
      if (!view) return await renderLanding();
      if (view === 'intro') return renderIntro();
      if (view === 'test') return await renderTest();
      if (view === 'analyzing') return await renderAnalyzing(id);
      if (view === 'result') return await renderResult(id, step);
      if (view === 'privacy') return renderPrivacy();
      location.hash = '#/';
    } catch (e) {
      $app.innerHTML = `<div class="intro card"><h2>문제가 발생했어요</h2><p class="error">${esc(e.message)}</p><a class="btn btn-ghost" href="#/">처음으로</a></div>`;
    }
  }

  // ------------------------------------------------------------ 랜딩

  async function renderLanding() {
    const sessionSaved = storage.get(LS_SESSION);
    const lastResult = storage.get(LS_LAST_RESULT);
    $app.innerHTML = `
      <section class="hero">
        <div>
          <span class="pill">${config.free ? '100% 무료' : '무료 응시'} · 약 ${Math.round(config.durationSec / 60)}분</span>
          <h1>나의 <em>IQ</em>는<br/>상위 몇 %일까?</h1>
          <p class="lead">언어·지식과 무관한 ${config.questionCount}개의 시각 패턴 문제로<br/>순수한 추론 능력을 측정합니다.</p>
          <a class="btn btn-primary btn-lg" href="#/intro">테스트 시작하기 →</a>
          <div class="hero-meta"><span>${config.questionCount}문항 행렬 추론</span><span>회원가입 불필요</span><span>결과 즉시 확인</span></div>
          ${sessionSaved ? `<div class="resume-banner"><span>진행 중인 테스트가 있어요.</span><a class="btn btn-ghost" href="#/test">이어서 풀기</a></div>` : ''}
          ${lastResult && !sessionSaved ? `<div class="resume-banner"><span>지난번 테스트 결과가 있어요.</span><a class="btn btn-ghost" href="#/result/${esc(lastResult)}">결과 보기</a></div>` : ''}
        </div>
        <div class="hero-visual">${matrixHtml(SAMPLE.cells)}<div class="caption">예시 문제 — 빈칸에 들어갈 그림은?</div></div>
      </section>

      <section class="section">
        <h2 class="section-title">이런 테스트예요</h2>
        <div class="grid-3">
          <div class="card feature"><div class="icon">🧩</div><h3>행렬 추론 (Matrix Reasoning)</h3><p>3×3 도형 배열의 규칙을 찾아 빈칸에 들어갈 그림을 고르는, 세계적으로 널리 쓰이는 비언어 지능검사 방식입니다.</p></div>
          <div class="card feature"><div class="icon">📈</div><h3>점점 어려워지는 문제</h3><p>쉬운 패턴부터 여러 규칙이 겹친 고난도 문제까지, 난이도에 따라 가중치를 두어 채점합니다.</p></div>
          <div class="card feature"><div class="icon">🎯</div><h3>4개 영역 분석</h3><p>패턴 인식 · 공간 지각 · 수리 추론 · 논리 연산 영역별 강점과 약점을 분석합니다.</p></div>
        </div>
      </section>

      ${adSlot()}

      <section class="section">
        <h2 class="section-title">진행 방법</h2>
        <div class="grid-3 steps">
          <div class="card step"><h3>${config.questionCount}문항 풀기</h3><p>제한 시간 ${Math.round(config.durationSec / 60)}분 동안 최대한 많은 문제를 풀어 보세요.</p></div>
          <div class="card step"><h3>무료로 순위 확인</h3><p>전체 응시자 중 나의 위치(상위 %)를 바로 알려드려요.</p></div>
          <div class="card step"><h3>${config.free ? '무료 정밀 리포트' : '정밀 리포트'}</h3><p>정확한 IQ 점수, 영역별 분석, 문제별 해설, 인증서를 받아보세요.</p></div>
        </div>
      </section>

      <section class="section faq">
        <h2 class="section-title">자주 묻는 질문</h2>
        <details><summary>이 테스트는 공인 지능검사인가요?</summary><p>아니요. 레이븐 누진행렬과 같은 방식의 문제로 만든 온라인 추정 검사입니다. 재미와 자기 이해를 위한 참고 자료로 활용해 주시고, 진단·채용·입학 등 공식적인 목적에는 임상 전문가가 실시하는 표준화 검사를 받으세요.</p></details>
        <details><summary>IQ 점수는 어떻게 계산하나요?</summary><p>문항 난이도에 따라 가중치를 둔 정답률을 평균 100, 표준편차 15인 척도로 환산합니다. 응시 데이터가 충분히 쌓이면 실제 응시자 분포를 기준으로 백분위를 계산합니다.</p></details>
        <details><summary>중간에 창을 닫으면 어떻게 되나요?</summary><p>진행 상황이 브라우저에 저장되어 같은 기기에서 이어서 풀 수 있습니다. 단, 제한 시간은 계속 흘러갑니다.</p></details>
        <details><summary>정밀 리포트에는 무엇이 들어 있나요?</summary><p>정확한 IQ 점수와 백분위, 분포 그래프 상의 내 위치, 영역별·난이도별 정답률, 모든 문제의 정답 해설, 이름이 들어간 IQ 인증서(PNG)가 포함됩니다.</p></details>
      </section>
      <div class="center section"><a class="btn btn-primary btn-lg" href="#/intro">지금 무료로 시작하기 →</a></div>
    `;
    fillAds();
  }

  const SAMPLE = puzzles.toPublic(puzzles.generateTest(20260101)[0]);

  // ------------------------------------------------------------ 안내

  function renderIntro() {
    const saved = storage.get(LS_SESSION);
    $app.innerHTML = `
      <div class="intro card">
        <span class="pill">시작 전 안내</span>
        <h1 style="margin-top:12px">테스트 안내</h1>
        <div class="rules">
          <ul>
            <li>총 <b>${config.questionCount}문항</b>, 제한 시간 <b>${Math.round(config.durationSec / 60)}분</b>입니다.</li>
            <li>각 문제는 3×3 그림 배열입니다. 가로·세로 규칙을 찾아 <b>빈칸(?)에 들어갈 그림</b>을 ${config.optionCount}개 보기 중에서 고르세요.</li>
            <li>뒤로 갈수록 어려워집니다. 모르는 문제는 건너뛰었다가 나중에 다시 풀 수 있어요.</li>
            <li>시간이 끝나면 자동으로 제출됩니다. 계산기·메모 없이 혼자 풀어야 정확합니다.</li>
            <li>키보드 <b>1~${config.optionCount}</b>로 보기 선택, <b>←/→</b>로 이동할 수 있어요.</li>
          </ul>
        </div>
        ${saved ? `<div class="notice">진행 중인 테스트가 있어요. 새로 시작하면 이전 진행 내용은 사라집니다.</div><br/>` : ''}
        <div class="actions">
          <button class="btn btn-primary btn-lg" id="start">${saved ? '새로 시작하기' : '준비됐어요, 시작!'}</button>
          ${saved ? '<a class="btn btn-ghost btn-lg" href="#/test">이어서 풀기</a>' : ''}
        </div>
        <p class="muted small" style="margin-top:16px">조용한 환경에서 집중할 수 있을 때 시작하세요.</p>
      </div>`;
    document.getElementById('start').onclick = () => {
      // 응시자마다 다른 문제: 무작위 시드로 시험지를 만든다
      const seed = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % (2 ** 31 - 1));
      storage.set(LS_SESSION, {
        seed,
        durationSec: config.durationSec,
        localStart: Date.now(),
        answers: puzzles.SCHEDULE.map(() => null),
        current: 0,
      });
      location.hash = '#/test';
    };
  }

  // ------------------------------------------------------------ 테스트

  async function renderTest() {
    const s = storage.get(LS_SESSION);
    if (!s || !s.seed) { storage.del(LS_SESSION); location.hash = '#/intro'; return; }
    const questions = puzzles.generateTest(s.seed).map(puzzles.toPublic);
    let submitting = false;

    const remaining = () => Math.max(0, s.durationSec - (Date.now() - s.localStart) / 1000);
    const save = () => storage.set(LS_SESSION, s);

    function submit() {
      if (submitting) return;
      submitting = true;
      stopTimer();
      const code = resultCore.encodeResult({
        seed: s.seed,
        answers: s.answers,
        elapsedSec: Math.min(s.durationSec, (Date.now() - s.localStart) / 1000),
        createdAt: Date.now(),
      });
      storage.del(LS_SESSION);
      storage.set(LS_LAST_RESULT, code);
      location.hash = `#/analyzing/${code}`;
    }

    function confirmSubmit() {
      const left = s.answers.filter((a) => a === null).length;
      const msg = left ? `아직 ${left}문항을 풀지 않았어요. 그래도 제출할까요?` : '모든 문항을 풀었어요. 제출할까요?';
      openModal(`
        <h3>답안 제출</h3>
        <p class="muted">${msg}</p>
        <div class="actions"><button class="btn btn-primary" data-act="ok">제출하기</button><button class="btn btn-ghost" data-act="cancel">계속 풀기</button></div>`,
      { ok: () => { closeModal(); submit(); }, cancel: closeModal });
    }

    function draw() {
      const i = s.current;
      const q = questions[i];
      const total = questions.length;
      const answered = s.answers.filter((a) => a !== null).length;
      $app.innerHTML = `
        <div class="test-head">
          <div class="qno">문제 ${i + 1} <span>/ ${total}</span></div>
          <div class="timer" id="timer">${mmss(remaining())}</div>
        </div>
        <div class="progress"><div style="width:${(answered / total) * 100}%"></div></div>
        <div class="test-body">
          <div>${matrixHtml(q.cells)}</div>
          <div>
            <div class="options-title">빈칸에 들어갈 그림을 고르세요</div>
            <div class="options">
              ${q.options.map((o, k) => `<button class="option ${s.answers[i] === k ? 'selected' : ''}" data-opt="${k}" aria-label="보기 ${k + 1}"><span class="num">${k + 1}</span>${o}</button>`).join('')}
            </div>
            <div class="test-nav">
              <button class="btn btn-ghost" id="prev" ${i === 0 ? 'disabled' : ''}>← 이전</button>
              ${i === total - 1
                ? '<button class="btn btn-primary" id="finish">제출하기</button>'
                : `<button class="btn btn-ghost" id="next">${s.answers[i] === null ? '건너뛰기' : '다음'} →</button>`}
            </div>
          </div>
        </div>
        <div class="dots">${questions.map((_, k) => `<button class="${s.answers[k] !== null ? 'done' : ''} ${k === i ? 'current' : ''}" data-go="${k}">${k + 1}</button>`).join('')}</div>
        <div class="center" style="margin-top:20px"><button class="btn btn-ghost" id="finish2">답안 제출 (${answered}/${total})</button></div>`;

      $app.querySelectorAll('[data-opt]').forEach((b) => {
        b.onclick = () => choose(Number(b.dataset.opt));
      });
      $app.querySelectorAll('[data-go]').forEach((b) => {
        b.onclick = () => go(Number(b.dataset.go));
      });
      const prev = document.getElementById('prev');
      const next = document.getElementById('next');
      const fin = document.getElementById('finish');
      if (prev) prev.onclick = () => go(i - 1);
      if (next) next.onclick = () => go(i + 1);
      if (fin) fin.onclick = confirmSubmit;
      document.getElementById('finish2').onclick = confirmSubmit;
    }

    let advanceTimer = null;
    function choose(k) {
      s.answers[s.current] = k;
      save();
      $app.querySelectorAll('[data-opt]').forEach((b) => b.classList.toggle('selected', Number(b.dataset.opt) === k));
      clearTimeout(advanceTimer);
      const from = s.current;
      advanceTimer = setTimeout(() => {
        if (s.current !== from) return;
        if (from < questions.length - 1) go(from + 1);
        else draw();
      }, 280);
    }

    function go(k) {
      if (k < 0 || k >= questions.length) return;
      clearTimeout(advanceTimer);
      s.current = k;
      save();
      draw();
    }

    function tick() {
      const left = remaining();
      const el = document.getElementById('timer');
      if (el) {
        el.textContent = mmss(left);
        el.classList.toggle('warn', left <= 120);
      }
      if (left <= 0) {
        toast('시간이 종료되어 자동 제출합니다.');
        submit();
      }
    }

    function onKey(e) {
      if (!location.hash.startsWith('#/test') || $modal.innerHTML) return;
      const n = Number(e.key);
      if (n >= 1 && n <= questions[s.current].options.length) choose(n - 1);
      else if (e.key === 'ArrowRight') go(s.current + 1);
      else if (e.key === 'ArrowLeft') go(s.current - 1);
    }
    document.onkeydown = onKey;

    if (remaining() <= 0) return submit();
    draw();
    timerHandle = setInterval(tick, 500);
  }

  // ------------------------------------------------------------ 분석 중 연출

  async function renderAnalyzing(resultId) {
    const steps = ['응답 데이터 수집', '문항별 정답 채점', '난이도 가중치 적용', '전체 응시자 분포와 비교', '영역별 프로파일 생성'];
    $app.innerHTML = `
      <div class="analyzing">
        <div class="spinner"></div>
        <h2>결과를 분석하고 있어요</h2>
        <p class="muted">잠시만 기다려 주세요…</p>
        <ol>${steps.map((t) => `<li>${t}</li>`).join('')}</ol>
      </div>
      ${adSlot()}`;
    fillAds();
    const items = $app.querySelectorAll('li');
    for (let i = 0; i < items.length; i++) {
      await sleep(650);
      if (!location.hash.startsWith('#/analyzing')) return;
      items[i].classList.add('on');
    }
    await sleep(500);
    if (location.hash.startsWith('#/analyzing')) location.replace(`#/result/${resultId}/rank`);
  }

  // ------------------------------------------------------------ 결과

  // step === 'rank': 테스트 직후 순위만 먼저 보여주는 단계 (무료 모드에서도 한 번 거친다)
  async function renderResult(id, step) {
    const r = resultCore.buildReport(id);
    if (!r) throw new Error('결과 링크가 올바르지 않아요. 링크가 잘리지 않았는지 확인해 주세요.');
    storage.set(LS_LAST_RESULT, r.id);
    if (step === 'rank') renderTeaser(r);
    else renderFull(r);
    fillAds();
  }

  // 무료 결과 문구: 평균 이상은 "상위 N% 이내", 평균 미만은 "하위 N% 이내"
  function rankLabel([lowTop, highTop]) {
    if (highTop <= 50) return `상위 ${highTop}% 이내`;
    return `하위 ${100 - lowTop}% 이내`;
  }

  // 정확한 백분위 문구 (유료 리포트·인증서)
  function positionLabel(percentile) {
    const top = 100 - percentile;
    const fmt = (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1));
    return top <= 50 ? `상위 ${fmt(top)}%` : `하위 ${fmt(percentile)}%`;
  }

  function renderTeaser(r) {
    const [lowTop, highTop] = r.teaser.range;
    const band = [iqAtTop(highTop), iqAtTop(lowTop)];
    const cats = Object.values(r.categoryLabels);
    $app.innerHTML = `
      <div class="result-wrap">
        <div class="card result-hero">
          <span class="pill">테스트 완료 🎉</span>
          <p class="sub" style="margin-top:14px">당신의 추론 능력은 전체 응시자 중</p>
          <div class="rank">${rankLabel(r.teaser.range)}</div>
          <p class="sub">에 해당합니다.</p>
          ${bellSvg({ band })}
          <p class="muted small">색칠된 구간이 당신이 속한 범위예요. 정확한 위치는 아래 버튼을 눌러 확인할 수 있어요.</p>
          <div class="stat-row">
            <div class="stat"><b>${r.answeredCount}/${r.total}</b><span>응답한 문항</span></div>
            <div class="stat"><b>${mmss(r.elapsedSec)}</b><span>소요 시간</span></div>
            <div class="stat locked"><b class="blur">??/${r.total}</b><span>정답 수</span><div class="lock-badge"><span>🔒</span></div></div>
          </div>
        </div>

        <div class="card result-section">
          <div class="iq-teaser">
            <span class="label">나의 IQ</span>
            <span class="locked"><span class="num blur">???</span><span class="lock-badge"><span>🔒 잠금</span></span></span>
          </div>
          <div class="preview-list locked">
            <div class="blur">
              ${cats.map((c, i) => `<div class="bar"><span>${esc(c)}</span><div class="track"><div class="fill" style="width:${[72, 55, 83, 64][i % 4]}%"></div></div><span class="val">??%</span></div>`).join('')}
            </div>
            <div class="lock-badge"><span>🔒 영역별 분석</span></div>
          </div>
        </div>

        ${adSlot()}

        ${revealCard(r)}
      </div>`;
  }

  // 결제 대신 "확인하기" 버튼 한 번 — 순위로 궁금증을 만든 뒤 리포트로 넘어간다
  function revealCard(r) {
    return `
        <div class="card paywall" id="reveal">
          <h2>결과 리포트가 준비됐어요</h2>
          <p class="muted">버튼을 누르면 아래 내용을 모두 무료로 볼 수 있어요.</p>
          <ul class="benefits">
            <li><b>정확한 IQ 점수</b>와 백분위</li>
            <li>분포 그래프 상의 <b>정확한 내 위치</b></li>
            <li><b>4개 영역</b>(패턴·공간·수리·논리) 및 난이도별 정답률</li>
            <li><b>${r.total}문항 전체 정답 해설</b></li>
            <li>이름이 들어간 <b>IQ 인증서</b> 이미지 다운로드</li>
          </ul>
          <a class="btn btn-primary btn-lg btn-block" id="reveal-btn" href="#/result/${esc(r.id)}">내 IQ 확인하기 (무료) →</a>
        </div>`;
  }

  // ------------------------------------------------------------ 전체 리포트

  function renderFull(r) {
    const cats = Object.values(r.categories);
    const diffNames = { 1: '기초', 2: '보통', 3: '어려움', 4: '매우 어려움' };
    const link = `${location.origin}${location.pathname}#/result/${r.id}`;
    $app.innerHTML = `
      <div class="result-wrap">
        <div class="card result-hero">
          <p class="sub">${r.name ? `<b>${esc(r.name)}</b>님의 ` : ''}IQ 점수</p>
          <div class="iq-big" id="iq-num">0</div>
          <div class="class-badge">${esc(r.classification)}</div>
          <p class="sub" style="margin-top:14px">전체 인구 중 <b>${positionLabel(r.percentile)}</b> (백분위 ${r.percentile.toFixed(1)})</p>
          ${bellSvg({ marker: r.iq })}
          <div class="stat-row">
            <div class="stat"><b>${r.correctCount}/${r.total}</b><span>정답 수</span></div>
            <div class="stat"><b>${r.answeredCount}/${r.total}</b><span>응답한 문항</span></div>
            <div class="stat"><b>${mmss(r.elapsedSec)}</b><span>소요 시간</span></div>
          </div>
        </div>

        ${adSlot()}

        <div class="card result-section">
          <h2>영역별 분석</h2>
          <div class="preview-list">
            ${cats.map((c) => `<div class="bar"><span>${esc(c.label)}</span><div class="track"><div class="fill" style="width:${(c.correct / c.total) * 100}%"></div></div><span class="val">${c.correct}/${c.total}</span></div>`).join('')}
          </div>
          <h2 style="margin-top:24px">난이도별 정답률</h2>
          <div class="preview-list">
            ${Object.entries(r.difficulties).map(([k, d]) => `<div class="bar"><span>${diffNames[k]}</span><div class="track"><div class="fill" style="width:${(d.correct / d.total) * 100}%"></div></div><span class="val">${d.correct}/${d.total}</span></div>`).join('')}
          </div>
          <p class="muted small" style="margin-top:14px">${insight(r)}</p>
        </div>

        <div class="card result-section">
          <h2>IQ 인증서</h2>
          <canvas class="cert-canvas" id="cert" width="1200" height="850"></canvas>
          <div class="field" style="margin-top:14px">
            <label for="cert-name2">인증서 이름</label>
            <input id="cert-name2" maxlength="20" value="${esc(r.name || '')}" placeholder="이름을 입력하면 인증서에 반영돼요" />
          </div>
          <div class="actions">
            <button class="btn btn-primary" id="dl">인증서 다운로드 (PNG)</button>
            <button class="btn btn-ghost" id="copy">결과 링크 복사</button>
          </div>
          <p class="muted small">결과 링크를 저장해 두면 언제든 이 리포트를 다시 볼 수 있어요.</p>
        </div>

        ${adSlot()}

        <div class="card result-section">
          <h2>문제별 해설</h2>
          <p class="muted small">초록색 테두리가 정답, 빨간색 테두리가 내가 고른 오답입니다.</p>
          ${r.review.map((q, i) => reviewItem(q) + (i % 10 === 9 && i < r.review.length - 1 ? adSlot() : '')).join('')}
        </div>
        <div class="center section"><a class="btn btn-ghost" href="#/intro">다시 테스트하기</a></div>
      </div>`;

    countUp(document.getElementById('iq-num'), r.iq);
    const nameInput = document.getElementById('cert-name2');
    const redraw = () => drawCertificate(document.getElementById('cert'), { ...r, name: nameInput.value.trim() || r.name });
    redraw();
    nameInput.oninput = redraw;
    document.getElementById('dl').onclick = () => {
      const a = document.createElement('a');
      a.download = `IQ-certificate-${r.iq}.png`;
      a.href = document.getElementById('cert').toDataURL('image/png');
      a.click();
    };
    document.getElementById('copy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('링크가 복사되었습니다.'); } catch { prompt('아래 링크를 복사하세요', link); }
    };
  }

  function insight(r) {
    const cats = Object.values(r.categories).map((c) => ({ ...c, rate: c.correct / c.total }));
    cats.sort((a, b) => b.rate - a.rate);
    const best = cats[0];
    const worst = cats[cats.length - 1];
    if (best.rate === worst.rate) return '네 영역에서 고른 수행을 보였습니다.';
    return `가장 강한 영역은 <b>${esc(best.label)}</b>, 상대적으로 보완할 영역은 <b>${esc(worst.label)}</b>입니다.`;
  }

  function reviewItem(q) {
    const status = q.chosen === null ? '<span class="tag-skip">미응답</span>' : q.chosen === q.answerIndex ? '<span class="tag-ok">정답</span>' : '<span class="tag-no">오답</span>';
    const diff = ['', '★', '★★', '★★★', '★★★★'][q.difficulty];
    return `
      <div class="review-item">
        <div class="review-head"><b>문제 ${q.id} <span class="muted small">${diff}</span></b>${status}</div>
        <div class="review-grid">
          ${matrixHtml(q.cells, q.options[q.answerIndex])}
          <div class="options">
            ${q.options.map((o, k) => `<div class="option ${k === q.answerIndex ? 'correct' : k === q.chosen ? 'wrong' : ''}"><span class="num">${k + 1}</span>${o}</div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  function countUp(el, target) {
    const start = performance.now();
    const dur = 1400;
    const from = 50;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function drawCertificate(canvas, r) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const font = (w, s) => `${w} ${s}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, W, H);
    // 테두리
    ctx.strokeStyle = '#b8860b';
    ctx.lineWidth = 10;
    ctx.strokeRect(30, 30, W - 60, H - 60);
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, W - 100, H - 100);
    // 배경 장식
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#4f46e5';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) ctx.fillRect(110 + i * 70, 440 + j * 70, 54, 54);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#b8860b';
    ctx.font = font('700', 26);
    ctx.fillText('CERTIFICATE OF INTELLIGENCE', W / 2, 130);
    ctx.fillStyle = '#111827';
    ctx.font = font('800', 56);
    ctx.fillText('IQ 테스트 인증서', W / 2, 205);
    ctx.fillStyle = '#6b7280';
    ctx.font = font('400', 24);
    ctx.fillText('This certifies that', W / 2, 270);
    ctx.fillStyle = '#111827';
    ctx.font = font('800', 52);
    ctx.fillText(r.name || '익명의 응시자', W / 2, 340);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(380, 362); ctx.lineTo(820, 362); ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.font = font('400', 24);
    ctx.fillText('님은 IQMatrix 행렬 추론 테스트에서 다음의 점수를 획득하였습니다.', W / 2, 410);

    const grad = ctx.createLinearGradient(450, 0, 750, 0);
    grad.addColorStop(0, '#4f46e5');
    grad.addColorStop(1, '#7c3aed');
    ctx.fillStyle = grad;
    ctx.font = font('900', 150);
    ctx.fillText(String(r.iq), W / 2, 570);
    ctx.fillStyle = '#111827';
    ctx.font = font('700', 28);
    ctx.fillText(`${r.classification}  ·  ${positionLabel(r.percentile)}`, W / 2, 630);

    ctx.font = font('400', 20);
    ctx.fillStyle = '#6b7280';
    const date = new Date(r.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    ctx.textAlign = 'left';
    ctx.fillText(`응시일  ${date}`, 110, 740);
    ctx.fillText(`인증번호  ${r.certId}`, 110, 772);
    ctx.textAlign = 'right';
    ctx.fillText('IQMatrix', W - 110, 740);
    ctx.fillText('온라인 추정 검사 결과', W - 110, 772);
    // 인장
    ctx.save();
    ctx.translate(W - 190, 640);
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = i % 2 ? 50 : 58;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffdf7';
    ctx.textAlign = 'center';
    ctx.font = font('900', 22);
    ctx.fillText('IQ', 0, -2);
    ctx.font = font('700', 13);
    ctx.fillText('CERTIFIED', 0, 18);
    ctx.restore();
  }

  // ------------------------------------------------------------ 개인정보처리방침
  // 애드센스 승인에는 쿠키·광고 관련 고지를 담은 개인정보처리방침 페이지가 필요하다.

  function renderPrivacy() {
    $app.innerHTML = `
      <div class="intro card policy">
        <h1>개인정보처리방침</h1>
        <h3>1. 수집하는 정보</h3>
        <p>본 서비스는 회원가입 없이 이용할 수 있으며, 이름·이메일·전화번호 등 개인을 식별할 수 있는 정보를 수집하지 않습니다. 테스트 문제 생성과 채점은 모두 사용자의 브라우저 안에서 이루어지며, 응답과 점수는 운영자의 서버로 전송·저장되지 않습니다. 결과는 결과 링크 주소 안에만 담기므로, 링크를 공유하면 받은 사람도 같은 결과를 볼 수 있습니다. 인증서에 입력한 이름도 브라우저에서만 처리됩니다.</p>
        <h3>2. 브라우저 저장소</h3>
        <p>진행 중인 테스트와 최근 결과 링크를 이어서 볼 수 있도록 브라우저의 로컬 저장소(localStorage)를 사용합니다. 브라우저 설정에서 언제든 삭제할 수 있습니다.</p>
        <h3>3. 광고와 쿠키</h3>
        <p>본 서비스는 Google 애드센스 광고를 게재합니다. Google을 포함한 제3자 광고 사업자는 쿠키를 사용해 사용자의 이 사이트 및 다른 사이트 방문 기록을 기반으로 광고를 게재할 수 있습니다. 맞춤 광고는 <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google 광고 설정</a>에서 해제할 수 있으며, 자세한 내용은 <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">Google 광고 정책</a>을 참고하세요.</p>
        <h3>4. 접속 기록</h3>
        <p>사이트는 GitHub Pages로 제공되며, 호스팅 사업자(GitHub)가 보안과 서비스 운영을 위해 IP 주소 등 접속 기록을 수집할 수 있습니다. 자세한 내용은 <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub 개인정보처리방침</a>을 참고하세요.</p>
        <h3>5. 문의</h3>
        <p>개인정보 관련 문의는 사이트 운영자에게 연락해 주세요.</p>
        <a class="btn btn-ghost" href="#/">처음으로</a>
      </div>`;
  }

  // ------------------------------------------------------------ 모달

  function openModal(html, handlers = {}) {
    $modal.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    $modal.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = (e) => handlers[b.dataset.act] && handlers[b.dataset.act](e);
    });
  }
  function closeModal() {
    $modal.innerHTML = '';
  }

  // ------------------------------------------------------------ 시작

  function boot() {
    window.addEventListener('hashchange', () => {
      document.onkeydown = null;
      closeModal();
      route();
    });
    loadAdsense();
    route();
  }

  boot();
})();
