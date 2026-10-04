// 브라우저(<script>)와 Node(require) 양쪽에서 쓰는 공용 모듈 (UMD)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng'));
  else (root.IQCore = root.IQCore || {}).puzzles = factory(root.IQCore.rng);
})(typeof self !== 'undefined' ? self : this, function (rng) {
'use strict';

// 레이븐(Raven) 방식의 3x3 행렬 추론 문제 생성기.
// 각 문제는 "셀 속성(attrs)" 9개로 이루어진 격자이고, 마지막 칸이 정답이다.
// 오답 보기는 정답(또는 다른 오답)의 속성을 하나씩 바꿔서 만든다.

const { createRng } = rng;

const SHAPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'star', 'diamond', 'cross'];
const FRAME_SHAPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon', 'diamond'];
const FILLS = ['white', 'gray', 'black'];
const SIZES = [0.6, 0.85, 1.1];
const LINES = ['top', 'bottom', 'left', 'right', 'diag1', 'diag2', 'h', 'v'];

const COLORS = { white: '#ffffff', gray: '#9aa3ad', black: '#1f2937' };
const INK = '#1f2937';

// ---------------------------------------------------------------- 렌더링

const LAYOUTS = {
  1: { r: 28, p: [[50, 50]] },
  2: { r: 17, p: [[29, 50], [71, 50]] },
  3: { r: 15, p: [[50, 29], [28, 70], [72, 70]] },
  4: { r: 14, p: [[30, 30], [70, 30], [30, 70], [70, 70]] },
  5: { r: 12, p: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]] },
  6: { r: 11, p: [[22, 33], [50, 33], [78, 33], [22, 67], [50, 67], [78, 67]] },
  7: { r: 10, p: [[50, 50], [50, 20], [76, 35], [76, 65], [50, 80], [24, 65], [24, 35]] },
  8: { r: 9.5, p: [[20, 20], [50, 20], [80, 20], [20, 50], [80, 50], [20, 80], [50, 80], [80, 80]] },
  9: { r: 9.5, p: [[20, 20], [50, 20], [80, 20], [20, 50], [50, 50], [80, 50], [20, 80], [50, 80], [80, 80]] },
};

const f1 = (n) => Math.round(n * 10) / 10;

function polygon(n, cx, cy, r, rotDeg) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function shapeSvg(shape, cx, cy, r, fill, strokeWidth = 3) {
  const style = `fill="${COLORS[fill] || fill}" stroke="${INK}" stroke-width="${strokeWidth}" stroke-linejoin="round"`;
  switch (shape) {
    case 'circle':
      return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.9)}" ${style}/>`;
    case 'square':
      return `<polygon points="${polygon(4, cx, cy, r, 45)}" ${style}/>`;
    case 'diamond':
      return `<polygon points="${polygon(4, cx, cy, r, -90)}" ${style}/>`;
    case 'triangle':
      return `<polygon points="${polygon(3, cx, cy + r * 0.15, r * 1.05, -90)}" ${style}/>`;
    case 'pentagon':
      return `<polygon points="${polygon(5, cx, cy + r * 0.05, r, -90)}" ${style}/>`;
    case 'hexagon':
      return `<polygon points="${polygon(6, cx, cy, r, 0)}" ${style}/>`;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? r * 1.05 : r * 0.45;
        const a = ((-90 + 36 * i) * Math.PI) / 180;
        pts.push(`${f1(cx + rr * Math.cos(a))},${f1(cy + 0.05 * r + rr * Math.sin(a))}`);
      }
      return `<polygon points="${pts.join(' ')}" ${style}/>`;
    }
    case 'cross': {
      const w = r * 0.36;
      const d = [
        [-w, -r], [w, -r], [w, -w], [r, -w], [r, w], [w, w],
        [w, r], [-w, r], [-w, w], [-r, w], [-r, -w], [-w, -w],
      ].map(([x, y]) => `${f1(cx + x)},${f1(cy + y)}`).join(' ');
      return `<polygon points="${d}" ${style}/>`;
    }
    default:
      throw new Error(`unknown shape ${shape}`);
  }
}

const LINE_COORDS = {
  top: [18, 18, 82, 18],
  bottom: [18, 82, 82, 82],
  left: [18, 18, 18, 82],
  right: [82, 18, 82, 82],
  diag1: [18, 18, 82, 82],
  diag2: [82, 18, 18, 82],
  h: [18, 50, 82, 50],
  v: [50, 18, 50, 82],
};

// 점 이동 문제용: 3x3 격자의 바깥 8칸을 시계방향으로 번호 매김
const RING = [[22, 22], [50, 22], [78, 22], [78, 50], [78, 78], [50, 78], [22, 78], [22, 50]];

function glyphSvg(g, scale = 1) {
  const tf = [`rotate(${g.angle} 50 50)`];
  if (scale !== 1) tf.push(`translate(50 50) scale(${scale}) translate(-50 -50)`);
  if (g.mirror) tf.push('translate(100 0) scale(-1 1)');
  return (
    `<g transform="${tf.join(' ')}">` +
    `<line x1="50" y1="80" x2="50" y2="20" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
    `<polygon points="50,20 76,30 50,41" fill="${INK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
    `<circle cx="50" cy="80" r="5" fill="${INK}"/>` +
    `</g>`
  );
}

function renderCell(a) {
  let s = '';
  if (a.lines) {
    for (const name of a.lines) {
      const [x1, y1, x2, y2] = LINE_COORDS[name];
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    }
  }
  if (a.dots) {
    for (let i = 0; i < 9; i++) {
      const x = 10 + (i % 3) * 27 + 0.5;
      const y = 10 + Math.floor(i / 3) * 27 + 0.5;
      s += `<rect x="${x}" y="${y}" width="26" height="26" rx="3" fill="none" stroke="#cbd2da" stroke-width="1.5"/>`;
    }
    for (const d of a.dots) {
      const [x, y] = RING[d.pos];
      s += d.style === 'ring'
        ? `<circle cx="${x}" cy="${y}" r="8.5" fill="#fff" stroke="${INK}" stroke-width="3.5"/>`
        : `<circle cx="${x}" cy="${y}" r="9.5" fill="${INK}"/>`;
    }
  }
  if (a.frame) s += shapeSvg(a.frame, 50, 50, 43, 'white', 3);
  if (a.items) {
    const { shape, count, fill, size } = a.items;
    const layout = LAYOUTS[count];
    for (const [x, y] of layout.p) s += shapeSvg(shape, x, y, layout.r * SIZES[size], fill, count > 4 ? 2.5 : 3);
  }
  if (a.inner) s += shapeSvg(a.inner.shape, 50, 52, 15, a.inner.fill, 3);
  if (a.glyph) s += glyphSvg(a.glyph, a.frame ? 0.62 : 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${s}</svg>`;
}

// ---------------------------------------------------------------- 유틸

const clone = (o) => JSON.parse(JSON.stringify(o));
const mod = (n, m) => ((n % m) + m) % m;

function normalize(a) {
  const o = clone(a);
  if (o.lines) o.lines = [...o.lines].sort();
  if (o.glyph) o.glyph.angle = mod(o.glyph.angle, 360);
  if (o.dots) o.dots = o.dots.map((d) => ({ pos: mod(d.pos, 8), style: d.style }));
  return o;
}
const keyOf = (a) => JSON.stringify(normalize(a));

function other(rng, domain, current) {
  const choices = domain.filter((v) => v !== current);
  return rng.pick(choices);
}

function isValid(a) {
  if (a.items && !LAYOUTS[a.items.count]) return false;
  if (a.lines && a.lines.length === 0) return false;
  if (a.dots && a.dots.length === 2 && mod(a.dots[0].pos, 8) === mod(a.dots[1].pos, 8)) return false;
  return true;
}

// ---------------------------------------------------------------- 오답 축(axis)
// 오답 보기는 정답에 "축" 3개를 조합해 만든다. 축 = 정답의 속성 하나를 고정된 다른 값으로 바꾸는 변환.
// 3개 축의 2x2x2 = 8가지 조합 중 정답을 포함하지 않는 대각선 쌍 하나를 빼면 6개 보기가 되는데,
// 이렇게 하면 정답의 각 속성값이 보기들 중 정확히 절반에만 나타나서 "가장 흔한 보기 고르기" 요령이 통하지 않는다.
// 축 팩토리: (rng, answer) => (cell) => cell

const axis = {
  attr: (path, domain) => (rng, ans) => {
    const [k1, k2] = path.split('.');
    const v = other(rng, domain, k2 ? ans[k1][k2] : ans[k1]);
    return (cell) => {
      const o = clone(cell);
      if (k2) o[k1][k2] = v; else o[k1] = v;
      return o;
    };
  },
  count: (deltas) => (rng) => {
    const d = rng.pick(deltas);
    return (cell) => {
      const o = clone(cell);
      o.items.count += d;
      return o;
    };
  },
  angle: (deltas) => (rng) => {
    const d = rng.pick(deltas);
    return (cell) => {
      const o = clone(cell);
      o.glyph.angle = mod(o.glyph.angle + d, 360);
      return o;
    };
  },
  mirror: () => () => (cell) => {
    const o = clone(cell);
    o.glyph.mirror = !o.glyph.mirror;
    return o;
  },
  dot: (idx, deltas) => (rng) => {
    const d = rng.pick(deltas);
    return (cell) => {
      const o = clone(cell);
      o.dots[idx].pos = mod(o.dots[idx].pos + d, 8);
      return o;
    };
  },
  toggle: (pool) => (rng) => {
    const name = rng.pick(pool);
    return (cell) => {
      const o = clone(cell);
      o.lines = o.lines.includes(name) ? o.lines.filter((l) => l !== name) : [...o.lines, name];
      return o;
    };
  },
};

// ---------------------------------------------------------------- 문제 유형
// make(rng) => { cell(r, c), axes: [축 팩토리...] }
// 행렬에서 각 행/열이 따르는 규칙이 정답을 하나로 결정하도록 설계한다.

const SIZE_IDX = [0, 1, 2];

const TYPES = {
  // 같은 모양의 개수가 행/열을 따라 증가
  'count-prog': {
    difficulty: 1,
    category: 'numeric',
    make(rng) {
      const shape = rng.pick(SHAPES);
      const fill = rng.pick(FILLS);
      const step = rng.pick([1, 2]);
      return {
        cell: (r, c) => ({ items: { shape, fill, size: 1, count: 1 + r + step * c } }),
        axes: [axis.count([-1, 1, -2]), axis.count([-3, 2]), axis.attr('items.shape', SHAPES), axis.attr('items.fill', FILLS)],
      };
    },
  },

  // 각 행에 세 가지 모양이 한 번씩 등장 (라틴 방진), 행마다 색이 고정
  'shape-latin': {
    difficulty: 1,
    category: 'pattern',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const rowFill = rng.shuffle(FILLS);
      return {
        cell: (r, c) => ({ items: { shape: shapes[(r + c) % 3], fill: rowFill[r], size: 1, count: 1 } }),
        axes: [axis.attr('items.shape', shapes), axis.attr('items.fill', FILLS), axis.attr('items.size', SIZE_IDX), axis.count([1])],
      };
    },
  },

  // 행마다 모양 고정, 열을 따라 크기 증가(또는 감소)
  'size-prog': {
    difficulty: 1,
    category: 'spatial',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fill = rng.pick(FILLS);
      const rev = rng() < 0.5;
      return {
        cell: (r, c) => ({ items: { shape: shapes[r], fill, size: rev ? 2 - c : c, count: 1 } }),
        axes: [axis.attr('items.size', SIZE_IDX), axis.attr('items.shape', shapes), axis.attr('items.fill', FILLS)],
      };
    },
  },

  // 열마다 모양 고정, 색이 라틴 방진
  'fill-latin': {
    difficulty: 1,
    category: 'pattern',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fills = rng.shuffle(FILLS);
      return {
        cell: (r, c) => ({ items: { shape: shapes[c], fill: fills[(r + c) % 3], size: 1, count: 1 } }),
        axes: [axis.attr('items.fill', FILLS), axis.attr('items.shape', shapes), axis.attr('items.size', SIZE_IDX), axis.count([1])],
      };
    },
  },

  // 깃발이 일정한 각도로 회전
  rotation: {
    difficulty: 2,
    category: 'spatial',
    make(rng) {
      const base = 45 * rng.int(8);
      const colStep = rng.pick([45, 90, -45, -90]);
      const rowStep = rng.pick([90, 135, 180, -90]);
      return {
        cell: (r, c) => ({ glyph: { angle: mod(base + r * rowStep + c * colStep, 360), mirror: false } }),
        axes: [axis.angle([90, -90]), axis.angle([45, -45]), axis.mirror()],
      };
    },
  },

  // 점이 바깥 8칸을 따라 일정 칸씩 이동
  'dot-move': {
    difficulty: 2,
    category: 'spatial',
    make(rng) {
      const p0 = rng.int(8);
      const k2 = rng.pick([1, 2, 3, 7]);
      const k1 = rng.pick([1, 2, 3, 5, 6, 7].filter((k) => k !== k2));
      return {
        // +1, +2, +4 조합이면 8칸이 모두 한 번씩 나온다
        cell: (r, c) => ({ dots: [{ pos: mod(p0 + r * k1 + c * k2, 8), style: 'black' }] }),
        axes: [axis.dot(0, [1, -1]), axis.dot(0, [2, -2]), axis.dot(0, [4])],
      };
    },
  },

  // 1열 + 2열 = 3열 (선 합치기)
  'overlay-or': {
    difficulty: 2,
    category: 'logic',
    make(rng) {
      return overlayPuzzle(rng, 'or');
    },
  },

  // 1열과 2열에 공통으로 있는 선만 남김
  'overlay-and': {
    difficulty: 2,
    category: 'logic',
    make(rng) {
      return overlayPuzzle(rng, 'and');
    },
  },

  // 같은 선은 사라지고 다른 선만 남음
  'overlay-xor': {
    difficulty: 3,
    category: 'logic',
    make(rng) {
      return overlayPuzzle(rng, 'xor');
    },
  },

  // 각 행: 1열 개수 + 2열 개수 = 3열 개수
  'count-sum': {
    difficulty: 2,
    category: 'numeric',
    make(rng) {
      const shape = rng.pick(SHAPES);
      const fill = rng.pick(['gray', 'black']);
      const rows = arithmeticRows(rng, 'sum');
      return {
        cell: (r, c) => ({ items: { shape, fill, size: 1, count: rows[r][c] } }),
        axes: [axis.count([-1, 1]), axis.count([-2, 2, 3]), axis.attr('items.shape', SHAPES), axis.attr('items.fill', FILLS)],
      };
    },
  },

  // 각 행: 1열 개수 - 2열 개수 = 3열 개수
  'count-diff': {
    difficulty: 3,
    category: 'numeric',
    make(rng) {
      const shape = rng.pick(SHAPES);
      const fill = rng.pick(FILLS);
      const rows = arithmeticRows(rng, 'diff');
      return {
        cell: (r, c) => ({ items: { shape, fill, size: 1, count: rows[r][c] } }),
        axes: [axis.count([-1, 1]), axis.count([2, 3, -2]), axis.attr('items.fill', FILLS), axis.attr('items.size', SIZE_IDX)],
      };
    },
  },

  // 모양과 색이 각각 서로 다른 라틴 방진
  'two-latin': {
    difficulty: 2,
    category: 'pattern',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fills = rng.shuffle(FILLS);
      return {
        cell: (r, c) => ({ items: { shape: shapes[(r + c) % 3], fill: fills[(r + 2 * c) % 3], size: 1, count: 1 } }),
        axes: [axis.attr('items.shape', shapes), axis.attr('items.fill', FILLS), axis.attr('items.size', SIZE_IDX)],
      };
    },
  },

  // 모양·색·개수가 모두 각자의 라틴 방진
  'three-latin': {
    difficulty: 3,
    category: 'pattern',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fills = rng.shuffle(FILLS);
      const counts = rng.shuffle([1, 2, 3]);
      return {
        cell: (r, c) => ({
          items: { shape: shapes[(r + c) % 3], fill: fills[(r + 2 * c) % 3], size: 1, count: counts[(2 * r + c) % 3] },
        }),
        axes: [axis.attr('items.shape', shapes), axis.attr('items.fill', FILLS), axis.attr('items.count', [1, 2, 3])],
      };
    },
  },

  // 바깥 도형과 안쪽 도형이 서로 다른 순서로 순환
  'inner-outer': {
    difficulty: 3,
    category: 'pattern',
    make(rng) {
      return innerOuter(rng, false);
    },
  },

  // 바깥 도형 순환 + 안쪽 깃발 회전
  'rotation-latin': {
    difficulty: 3,
    category: 'spatial',
    make(rng) {
      const frames = rng.sample(FRAME_SHAPES, 3);
      const base = 45 * rng.int(8);
      const colStep = rng.pick([90, -90, 135]);
      const rowStep = rng.pick([45, -45, 180]);
      return {
        cell: (r, c) => ({
          frame: frames[(r + 2 * c) % 3],
          glyph: { angle: mod(base + r * rowStep + c * colStep, 360), mirror: false },
        }),
        axes: [axis.angle([45, -45, 90, 180]), axis.mirror(), axis.attr('frame', frames)],
      };
    },
  },

  // 두 점이 서로 다른 규칙으로 이동
  'dots-two': {
    difficulty: 4,
    category: 'spatial',
    make(rng) {
      for (;;) {
        const a0 = rng.int(8), b0 = rng.int(8);
        const ka = [rng.pick([1, 3, 7]), rng.pick([1, 2, 6])]; // [행, 열]
        const kb = [rng.pick([2, 5, 7]), rng.pick([3, 5, 7])];
        if (ka[1] === kb[1]) continue;
        const cell = (r, c) => ({
          dots: [
            { pos: mod(a0 + r * ka[0] + c * ka[1], 8), style: 'black' },
            { pos: mod(b0 + r * kb[0] + c * kb[1], 8), style: 'ring' },
          ],
        });
        let ok = true;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!isValid(cell(r, c))) ok = false;
        if (!ok) continue;
        return {
          cell,
          axes: [axis.dot(0, [1, -1, 2]), axis.dot(1, [1, -1, 2]), axis.dot(0, [4, 3]), axis.dot(1, [4, -3])],
        };
      }
    },
  },

  // 모양·색·개수 라틴 방진 + 행에 따른 크기 변화
  'four-attr': {
    difficulty: 4,
    category: 'pattern',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fills = rng.shuffle(FILLS);
      const counts = rng.shuffle([1, 2, 3]);
      const rev = rng() < 0.5;
      return {
        cell: (r, c) => ({
          items: {
            shape: shapes[(2 * r + c) % 3],
            fill: fills[(r + c) % 3],
            size: rev ? 2 - r : r,
            count: counts[(r + 2 * c) % 3],
          },
        }),
        axes: [
          axis.attr('items.shape', shapes), axis.attr('items.fill', FILLS),
          axis.attr('items.count', [1, 2, 3]), axis.attr('items.size', SIZE_IDX),
        ],
      };
    },
  },

  // 덧셈 규칙 + 모양 라틴 방진
  'count-sum-shape': {
    difficulty: 4,
    category: 'numeric',
    make(rng) {
      const shapes = rng.sample(SHAPES, 3);
      const fill = rng.pick(['gray', 'black', 'white']);
      const rows = arithmeticRows(rng, 'sum');
      return {
        cell: (r, c) => ({ items: { shape: shapes[(r + 2 * c) % 3], fill, size: 1, count: rows[r][c] } }),
        axes: [axis.count([-1, 1]), axis.count([-2, 2]), axis.attr('items.shape', shapes)],
      };
    },
  },

  // 바깥 도형 순환 + 깃발 회전 + 체크무늬로 좌우 반전
  'rotation-mirror': {
    difficulty: 4,
    category: 'spatial',
    make(rng) {
      const frames = rng.sample(FRAME_SHAPES, 3);
      const base = 45 * rng.int(8);
      const colStep = rng.pick([90, -90]);
      const rowStep = rng.pick([45, -45, 135]);
      const flip = rng() < 0.5;
      return {
        cell: (r, c) => ({
          frame: frames[(r + c) % 3],
          glyph: { angle: mod(base + r * rowStep + c * colStep, 360), mirror: ((r + c) % 2 === 0) !== flip },
        }),
        axes: [axis.angle([45, -45, 90, 180]), axis.mirror(), axis.attr('frame', frames)],
      };
    },
  },

  // 바깥·안쪽 도형 순환 + 안쪽 색 순환
  'inner-outer-fill': {
    difficulty: 4,
    category: 'pattern',
    make(rng) {
      return innerOuter(rng, true);
    },
  },
};

function innerOuter(rng, fillLatin) {
  const frames = rng.sample(FRAME_SHAPES, 3);
  const inners = rng.sample(SHAPES.filter((s) => !frames.includes(s)), 3);
  const fills = rng.shuffle(FILLS);
  const fixedFill = rng.pick(['black', 'gray']);
  return {
    cell: (r, c) => ({
      frame: frames[(r + c) % 3],
      inner: { shape: inners[(r + 2 * c) % 3], fill: fillLatin ? fills[(2 * r + c) % 3] : fixedFill },
    }),
    axes: [axis.attr('frame', frames), axis.attr('inner.shape', inners), axis.attr('inner.fill', FILLS)],
  };
}

function arithmeticRows(rng, op) {
  // 등차수열로도 해석되는 행, 곱셈으로도 해석되는 행은 피한다 (규칙이 하나로 정해지도록)
  for (;;) {
    const rows = [];
    while (rows.length < 3) {
      let a, b;
      if (op === 'sum') {
        a = 1 + rng.int(4); b = 1 + rng.int(4);
        if (b === 2 * a || (a === 2 && b === 2) || a + b > 8) continue;
        rows.push([a, b, a + b]);
      } else {
        a = 3 + rng.int(6); b = 1 + rng.int(a - 1);
        if (2 * a === 3 * b) continue;
        rows.push([a, b, a - b]);
      }
    }
    if (new Set(rows.map((x) => x.join())).size === 3) return rows;
  }
}

function overlayPuzzle(rng, op) {
  const combine = {
    or: (A, B) => [...new Set([...A, ...B])],
    and: (A, B) => A.filter((x) => B.includes(x)),
    xor: (A, B) => [...A.filter((x) => !B.includes(x)), ...B.filter((x) => !A.includes(x))],
  };
  const rows = [];
  while (rows.length < 3) {
    const A = rng.sample(LINES, 2 + rng.int(op === 'and' ? 3 : 2));
    const B = rng.sample(LINES, 2 + rng.int(op === 'and' ? 3 : 2));
    const inter = combine.and(A, B);
    // 겹치는 선이 있어야 OR/XOR/AND를 구분할 수 있다
    if (inter.length < 1 || inter.length === A.length || inter.length === B.length) continue;
    const C = combine[op](A, B);
    if (C.length < 2) continue;
    rows.push([A, B, C]);
  }
  // 오답 축은 3행에 실제로 등장한 선 위주로 — 규칙을 잘못 적용했을 때 나올 법한 모양이 된다
  // 선 개수로 정답이 드러나지 않도록 "빼는 축"과 "더하는 축"을 함께 쓴다
  const [A3, B3, C3] = rows[2];
  const relevant = [...new Set([...A3, ...B3])];
  const inAnswer = C3;
  const outRelevant = relevant.filter((l) => !C3.includes(l));
  const outAny = LINES.filter((l) => !C3.includes(l));
  const add = outRelevant.length ? outRelevant : outAny;
  return {
    cell: (r, c) => ({ lines: rows[r][c] }),
    axes: [axis.toggle(inAnswer), axis.toggle(add), axis.toggle(rng() < 0.5 ? inAnswer : outAny)],
  };
}

// ---------------------------------------------------------------- 시험 구성

// 난이도 순으로 30문항 (같은 시험지 형식, 응시자마다 다른 문제)
const SCHEDULE = [
  'shape-latin', 'count-prog', 'size-prog', 'fill-latin', 'shape-latin', 'count-prog', 'fill-latin',
  'rotation', 'two-latin', 'overlay-or', 'dot-move', 'count-sum', 'overlay-and', 'rotation', 'two-latin', 'dot-move',
  'three-latin', 'overlay-xor', 'inner-outer', 'count-diff', 'rotation-latin', 'three-latin', 'overlay-xor', 'inner-outer', 'count-diff',
  'dots-two', 'four-attr', 'count-sum-shape', 'rotation-mirror', 'inner-outer-fill',
];

const OPTION_COUNT = 6;
const WEIGHTS = { 1: 1, 2: 1.5, 3: 2, 4: 2.5 };

function buildOptions(spec, answer, rng) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const factories = rng.sample(spec.axes, 3);
    const fns = factories.map((f) => f(rng, answer));
    const combos = [];
    for (let m = 0; m < 8; m++) {
      let cell = answer;
      for (let b = 0; b < 3; b++) if (m & (1 << b)) cell = fns[b](cell);
      combos.push(normalize(cell));
    }
    if (!combos.every(isValid)) continue;
    if (new Set(combos.map(keyOf)).size !== 8) continue;
    const drop = 1 + rng.int(3); // 정답(0)이 아닌 대각선 쌍 (m, 7-m) 제거
    return combos.filter((_, m) => m !== drop && m !== 7 - drop);
  }
  return null;
}

function buildPuzzle(typeName, rng) {
  const type = TYPES[typeName];
  for (let attempt = 0; attempt < 30; attempt++) {
    const spec = type.make(rng);
    const grid = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(normalize(spec.cell(r, c)));
    const options = buildOptions(spec, grid[8], rng);
    if (!options) continue;
    const order = rng.shuffle(options.map((_, i) => i));
    return {
      type: typeName,
      difficulty: type.difficulty,
      category: type.category,
      grid,
      options: order.map((i) => options[i]),
      answerIndex: order.indexOf(0),
    };
  }
  throw new Error(`could not build puzzle ${typeName}`);
}

function generateTest(seed) {
  const rng = createRng(seed);
  return SCHEDULE.map((typeName, i) => ({ id: i + 1, ...buildPuzzle(typeName, rng) }));
}

// 클라이언트로 보내는 형태 (정답 제외)
function toPublic(q) {
  return {
    id: q.id,
    cells: q.grid.slice(0, 8).map(renderCell),
    options: q.options.map(renderCell),
  };
}

const CATEGORIES = {
  pattern: '패턴 인식',
  spatial: '공간 지각',
  numeric: '수리 추론',
  logic: '논리 연산',
};

return {
  generateTest,
  toPublic,
  renderCell,
  keyOf,
  TYPES,
  SCHEDULE,
  WEIGHTS,
  CATEGORIES,
  OPTION_COUNT,
};
});
