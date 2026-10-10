// Demos for slides 3–10: sorting race, pivot choice, stability, Timsort, decision tree, radix, quickselect, external sort.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function logger(el, keep = 2) {
    const lines = [];
    const say = (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
    say.clear = () => { lines.length = 0; };
    return say;
  }
  // Deterministic PRNG so that presets look the same every time.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, r) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const btnGroup = (items, onPick, initial = 0) => {
    const btns = items.map(([label], i) => h('button', { class: 'btn small' + (i === initial ? ' sel' : ''), onclick: () => pick(i) }, label));
    function pick(i) {
      btns.forEach((b, k) => b.classList.toggle('sel', k === i));
      onPick(i, items[i]);
    }
    return { el: btns, pick };
  };

  // ---------------------------------------------------------------- sorting race
  // Every algorithm is a generator over its own copy of the array that yields one event per step:
  // {t:'cmp', i, j} — compared a[i] and a[j]; {t:'w', i} — wrote a[i]; {t:'swap', i, j}; {t:'piv', i}.
  function* insertion(a) {
    for (let i = 1; i < a.length; i++) {
      const x = a[i];
      let j = i - 1;
      while (j >= 0) {
        yield { t: 'cmp', i: j, j: j + 1 };
        if (a[j] > x) { a[j + 1] = a[j]; yield { t: 'w', i: j + 1 }; j--; } else break;
      }
      if (j + 1 !== i) { a[j + 1] = x; yield { t: 'w', i: j + 1 }; }
    }
  }
  function* mergeSort(a) {
    function* rec(lo, hi) {
      if (hi - lo < 2) return;
      const mid = (lo + hi) >> 1;
      yield* rec(lo, mid);
      yield* rec(mid, hi);
      const L = a.slice(lo, mid), R = a.slice(mid, hi);
      let i = 0, j = 0, k = lo;
      while (i < L.length && j < R.length) {
        yield { t: 'cmp', i: k, j: mid + j };
        a[k] = L[i] <= R[j] ? L[i++] : R[j++];
        yield { t: 'w', i: k++ };
      }
      while (i < L.length) { a[k] = L[i++]; yield { t: 'w', i: k++ }; }
      while (j < R.length) { a[k] = R[j++]; yield { t: 'w', i: k++ }; }
    }
    yield* rec(0, a.length);
  }
  function* quickSort(a) {
    function* rec(lo, hi) {
      if (lo >= hi) return;
      const p = a[hi];
      yield { t: 'piv', i: hi };
      let i = lo;
      for (let j = lo; j < hi; j++) {
        yield { t: 'cmp', i: j, j: hi };
        if (a[j] < p) {
          if (i !== j) { [a[i], a[j]] = [a[j], a[i]]; yield { t: 'swap', i, j }; }
          i++;
        }
      }
      if (i !== hi) { [a[i], a[hi]] = [a[hi], a[i]]; yield { t: 'swap', i, j: hi }; }
      yield* rec(lo, i - 1);
      yield* rec(i + 1, hi);
    }
    yield* rec(0, a.length - 1);
  }
  function* heapSort(a) {
    const n = a.length;
    function* sift(root, end) {
      for (;;) {
        let c = 2 * root + 1;
        if (c >= end) return;
        if (c + 1 < end) {
          yield { t: 'cmp', i: c, j: c + 1 };
          if (a[c + 1] > a[c]) c++;
        }
        yield { t: 'cmp', i: root, j: c };
        if (a[c] <= a[root]) return;
        [a[c], a[root]] = [a[root], a[c]];
        yield { t: 'swap', i: c, j: root };
        root = c;
      }
    }
    for (let i = (n >> 1) - 1; i >= 0; i--) yield* sift(i, n);
    for (let end = n - 1; end > 0; end--) {
      [a[0], a[end]] = [a[end], a[0]];
      yield { t: 'swap', i: 0, j: end };
      yield* sift(0, end);
    }
  }

  Deck.demo('race', root => {
    const N = 24;
    const ALGOS = [
      ['Вставками', insertion],
      ['Слиянием', mergeSort],
      ['Быстрая', quickSort],
      ['Пирамидальная', heapSort],
    ];
    const PRESETS = [
      ['случайный', () => shuffle([...Array(N)].map((_, i) => i + 1), rng(7))],
      ['отсортированный', () => [...Array(N)].map((_, i) => i + 1)],
      ['обратный', () => [...Array(N)].map((_, i) => N - i)],
      ['много повторов', () => { const r = rng(3); return [...Array(N)].map(() => (1 + Math.floor(r() * 4)) * 6); }],
    ];
    let data, runs, playing = false, acc = 0, stepNo = 0;
    const panels = h('div', { class: 'race' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const playBtn = h('button', { class: 'btn primary', onclick: () => setPlay(!playing) }, 'Пуск');
    const stepBtn = h('button', { class: 'btn', onclick: () => { setPlay(false); step(); } }, 'Шаг');
    const presets = btnGroup(PRESETS, i => load(i));
    root.append(
      h('div', { class: 'controls' }, presets.el),
      h('div', { class: 'controls' }, playBtn, stepBtn, h('button', { class: 'btn', onclick: () => { setPlay(false); finish(); } }, 'До конца')),
      panels, logEl,
    );

    function load(i) {
      setPlay(false);
      data = PRESETS[i][1]();
      stepNo = 0;
      panels.innerHTML = '';
      runs = ALGOS.map(([name, fn]) => {
        const a = data.slice();
        const bars = a.map(() => h('i'));
        const cmpEl = h('b', null, '0'), wEl = h('b', null, '0');
        const box = h('div', { class: 'rc' },
          h('div', { class: 'rc-head' }, h('span', { class: 'rc-name' }, name),
            h('span', { class: 'rc-cnt' }, 'сравн. ', cmpEl), h('span', { class: 'rc-cnt' }, 'запис. ', wEl)),
          h('div', { class: 'rc-bars' }, bars));
        panels.append(box);
        return { name, a, it: fn(a), bars, cmpEl, wEl, box, cmp: 0, w: 0, done: false, ev: null, piv: -1 };
      });
      runs.forEach(draw);
      say(`Массив из ${N} элементов, у всех четырёх алгоритмов одинаковый. Нажмите «Пуск» или «Шаг».`);
    }
    function advance(r) {
      if (r.done) return;
      const { value, done } = r.it.next();
      if (done) { r.done = true; r.ev = null; return; }
      r.ev = value;
      if (value.t === 'cmp') r.cmp++;
      else if (value.t === 'w') r.w++;
      else if (value.t === 'swap') r.w += 2;
      else if (value.t === 'piv') { r.piv = value.i; return advance(r); }
    }
    function draw(r) {
      const max = Math.max(...data);
      r.bars.forEach((b, k) => {
        b.style.height = (r.a[k] / max) * 100 + '%';
        b.className = '';
      });
      if (r.done) r.bars.forEach(b => b.classList.add('ok'));
      else if (r.ev) {
        const e = r.ev;
        if (e.t === 'cmp') { r.bars[e.i].className = 'cmp'; r.bars[e.j].className = 'cmp'; }
        if (e.t === 'w') r.bars[e.i].className = 'wr';
        if (e.t === 'swap') { r.bars[e.i].className = 'wr'; r.bars[e.j].className = 'wr'; }
        if (r.a === runs[2].a && r.piv >= 0 && !r.bars[r.piv].className) r.bars[r.piv].className = 'piv';
      }
      r.cmpEl.textContent = fmt(r.cmp);
      r.wEl.textContent = fmt(r.w);
      r.box.classList.toggle('done', r.done);
    }
    function step() {
      if (runs.every(r => r.done)) return report();
      stepNo++;
      runs.forEach(r => { const was = r.done; advance(r); draw(r); if (!was && r.done) finished(r); });
      if (runs.every(r => r.done)) report();
    }
    function finished(r) {
      say(`${r.name}: готово за ${fmt(r.cmp)} ${plural(r.cmp, ['сравнение', 'сравнения', 'сравнений'])} и ${fmt(r.w)} ${plural(r.w, ['запись', 'записи', 'записей'])}.`);
    }
    function finish() {
      for (const r of runs) { while (!r.done) advance(r); draw(r); }
      report();
    }
    function report() {
      setPlay(false);
      const best = runs.reduce((a, b) => (b.cmp < a.cmp ? b : a));
      const worst = runs.reduce((a, b) => (b.cmp > a.cmp ? b : a));
      const nlogn = Math.round(N * Math.log2(N));
      const [ins, , quick] = runs;
      let tail = '';
      if (quick.cmp >= N * (N - 1) / 2) tail += ' Быстрая с последним опорным элементом деградировала до n(n−1)/2: опорный элемент всё время крайний.';
      if (ins.cmp < 2 * N) tail += ' Вставкам почти нечего делать: каждый элемент сравнивается один раз с соседом.';
      if (ins.cmp >= N * (N - 1) / 2) tail += ' Вставки на обратном массиве сдвигают каждый элемент в самое начало.';
      say(`Всё отсортировано. Меньше всего сравнений у «${best.name}» (${fmt(best.cmp)}), больше всего — у «${worst.name}» (${fmt(worst.cmp)}). Для ориентира n·log₂n ≈ ${nlogn}.${tail}`, worst.cmp > 2 * nlogn ? 'warn' : 'ok');
    }
    const loop = rafLoop(dt => {
      acc += dt * 28;
      while (acc >= 1 && playing) { acc -= 1; step(); }
    });
    function setPlay(on) {
      playing = on;
      playBtn.textContent = on ? 'Пауза' : 'Пуск';
      if (on) loop.start(); else loop.stop();
    }
    load(0);
    return { start() {}, stop() { setPlay(false); } };
  });

  // ---------------------------------------------------------------- pivot choice / introsort
  Deck.demo('pivot', root => {
    const N = 2000;
    const DATA = [
      ['случайные', () => shuffle([...Array(N)].map((_, i) => i), rng(11))],
      ['отсортированные', () => [...Array(N)].map((_, i) => i)],
      ['почти отсортированные', () => { const a = [...Array(N)].map((_, i) => i), r = rng(5); for (let k = 0; k < 20; k++) { const i = Math.floor(r() * N), j = Math.floor(r() * N); [a[i], a[j]] = [a[j], a[i]]; } return a; }],
      ['10 разных значений', () => { const r = rng(9); return [...Array(N)].map(() => Math.floor(r() * 10)); }],
    ];
    const PIVOT = ['первый', 'случайный', 'медиана трёх'];
    let dataI = 0, pivI = 0, three = false, intro = false;
    const dataG = btnGroup(DATA, i => { dataI = i; run(); });
    const pivG = btnGroup(PIVOT.map(p => [p]), i => { pivI = i; run(); });
    const threeT = h('input', { type: 'checkbox', onchange: () => { three = threeT.checked; run(); } });
    const introT = h('input', { type: 'checkbox', onchange: () => { intro = introT.checked; run(); } });
    const stats = h('div', { class: 'stats' });
    const bars = h('div', { class: 'pv-bars' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'label' }, 'Данные'), h('div', { class: 'controls' }, dataG.el),
      h('div', { class: 'label' }, 'Опорный элемент'), h('div', { class: 'controls' }, pivG.el),
      h('label', { class: 'toggle' }, threeT, 'трёхпутевое разбиение (< = >) для повторов'),
      h('label', { class: 'toggle' }, introT, 'introsort: глубже 2·log₂n — перейти на heapsort'),
      stats, bars, logEl,
    );

    function sortCount(src) {
      const a = src.slice();
      const r = rng(42);
      let cmp = 0, maxDepth = 0, heaps = 0;
      const lt = (x, y) => { cmp++; return x < y; };
      const limit = 2 * Math.floor(Math.log2(N));
      const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
      function heapsort(lo, hi) {
        const n = hi - lo + 1;
        const sift = (root, end) => {
          for (;;) {
            let c = 2 * root + 1;
            if (c >= end) return;
            if (c + 1 < end && lt(a[lo + c], a[lo + c + 1])) c++;
            if (!lt(a[lo + root], a[lo + c])) return;
            swap(lo + root, lo + c);
            root = c;
          }
        };
        for (let i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
        for (let end = n - 1; end > 0; end--) { swap(lo, lo + end); sift(0, end); }
      }
      function choose(lo, hi) {
        if (pivI === 0) return lo;
        if (pivI === 1) return lo + Math.floor(r() * (hi - lo + 1));
        const m = (lo + hi) >> 1;
        let x = lo, y = m, z = hi;
        if (lt(a[y], a[x])) [x, y] = [y, x];
        if (lt(a[z], a[y])) { [y, z] = [z, y]; if (lt(a[y], a[x])) [x, y] = [y, x]; }
        return y;
      }
      function qs(lo, hi, depth) {
        while (lo < hi) {
          maxDepth = Math.max(maxDepth, depth);
          if (intro && depth > limit) { heaps++; heapsort(lo, hi); return; }
          swap(choose(lo, hi), hi);
          const p = a[hi];
          if (three) {
            let lt_ = lo, gt = hi - 1, i = lo;
            while (i <= gt) {
              if (lt(a[i], p)) swap(lt_++, i++);
              else if (lt(p, a[i])) swap(i, gt--);
              else i++;
            }
            swap(gt + 1, hi);
            // [lo, lt_) < p, [lt_, gt + 1] = p, (gt + 1, hi] > p
            qs(lo, lt_ - 1, depth + 1);
            lo = gt + 2; depth++;
          } else {
            let i = lo;
            for (let j = lo; j < hi; j++) if (lt(a[j], p)) swap(i++, j);
            swap(i, hi);
            qs(lo, i - 1, depth + 1);
            lo = i + 1; depth++;
          }
        }
      }
      qs(0, a.length - 1, 1);
      for (let i = 1; i < a.length; i++) if (a[i - 1] > a[i]) throw new Error('pivot demo: not sorted');
      return { cmp, maxDepth, heaps };
    }
    function run() {
      const res = sortCount(DATA[dataI][1]());
      const nlogn = N * Math.log2(N), quad = N * (N - 1) / 2;
      const ratio = res.cmp / nlogn;
      stats.innerHTML = `<div class="stat${ratio > 4 ? ' warn' : ''}"><b>${fmt(res.cmp)}</b><span>сравнений</span></div>` +
        `<div class="stat${ratio > 4 ? ' warn' : ''}"><b>×${dec(ratio)}</b><span>от n·log₂n</span></div>` +
        `<div class="stat${res.maxDepth > 4 * Math.log2(N) ? ' warn' : ''}"><b>${fmt(res.maxDepth)}</b><span>глубина рекурсии</span></div>`;
      const scale = v => Math.max(0.6, (Math.log10(v) - 3) / (Math.log10(quad) - 3) * 100);
      bars.innerHTML = [
        ['n·log₂n', nlogn, 'ref'], ['эта сортировка', res.cmp, ratio > 4 ? 'bad' : 'me'], ['n²/2', quad, 'ref'],
      ].map(([l, v, c]) => `<div class="pv-row ${c}"><span>${l}</span><span class="cost-track"><span class="cost-fill" style="width:${scale(v)}%"></span></span><b>${fmt(v)}</b></div>`).join('') +
        '<p class="note">Шкала логарифмическая.</p>';
      let msg, cls = 'ok';
      if (ratio > 4) {
        cls = 'bad';
        msg = dataI === 3
          ? 'Повторы ломают двухпутевое разбиение: равные опорному уходят в одну сторону, и куски почти не уменьшаются. Включите трёхпутевое — равные сразу встанут на место.'
          : 'Опорный элемент почти всегда крайний: каждое разбиение отрезает один элемент. Квадратичное время и рекурсия глубиной почти n — в C это переполнение стека.';
      } else if (res.heaps) {
        msg = `Глубина упёрлась в предел ${2 * Math.floor(Math.log2(N))}, и ${res.heaps} ${plural(res.heaps, ['кусок досортирован', 'куска досортированы', 'кусков досортированы'])} heapsort. Худший случай обезврежен: O(n log n) гарантированно.`;
      } else if (three && dataI === 3) {
        msg = `Трёхпутевое разбиение: все равные опорному сразу встают на место, и каждое разбиение убирает целое значение. 10 разных значений — около 10 разбиений на ветку, глубина ${res.maxDepth}. Даже меньше n·log₂n.`;
      } else msg = `Разбиения сбалансированы: глубина ${res.maxDepth} — порядка log₂n = ${dec(Math.log2(N))}, сравнений ×${dec(ratio)} от n·log₂n. Так и должна работать быстрая сортировка.`;
      if (ratio > 4 && intro) msg = 'Introsort ограничивает глубину рекурсии, но здесь мешают повторы: на каждом уровне всё равно почти n сравнений. Нужно трёхпутевое разбиение — так делает pdqsort.';
      if (res.heaps && ratio <= 4) cls = 'ok';
      logEl.className = 'log ' + cls;
      logEl.textContent = msg;
    }
    run();
    return {};
  });

  // ---------------------------------------------------------------- stability
  Deck.demo('stable', root => {
    const STAFF = [
      ['Аня', 'dev', 310], ['Борис', 'ops', 240], ['Вера', 'dev', 280], ['Глеб', 'qa', 190],
      ['Дина', 'ops', 260], ['Егор', 'dev', 350], ['Жанна', 'qa', 210], ['Захар', 'ops', 220],
    ].map(([name, dept, salary], i) => ({ name, dept, salary, id: i }));
    let rows = STAFF.slice(), bySalary = false;
    const table = h('div', { class: 'st-table' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const unstableSort = (arr, key) => { // heapsort: unstable
      const a = arr.slice(), n = a.length;
      const k = x => key(x);
      const sift = (r, end) => {
        for (;;) {
          let c = 2 * r + 1;
          if (c >= end) return;
          if (c + 1 < end && k(a[c + 1]) > k(a[c])) c++;
          if (k(a[c]) <= k(a[r])) return;
          [a[c], a[r]] = [a[r], a[c]];
          r = c;
        }
      };
      for (let i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
      for (let e = n - 1; e > 0; e--) { [a[0], a[e]] = [a[e], a[0]]; sift(0, e); }
      return a;
    };
    const DEPT = { dev: 0, ops: 1, qa: 2 };
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn', onclick: () => { rows = rows.slice().sort((a, b) => b.salary - a.salary); bySalary = true; render('salary'); } }, '1. по зарплате ↓'),
        h('button', { class: 'btn primary', onclick: () => byDept(true) }, '2. по отделу, стабильно'),
        h('button', { class: 'btn', onclick: () => byDept(false) }, '2. по отделу, heapsort'),
        h('button', { class: 'btn', onclick: () => { rows = STAFF.slice(); bySalary = false; render(); say('Исходный порядок: как пришли из базы.'); } }, 'Сброс')),
      table, logEl,
    );
    function byDept(stable) {
      rows = stable ? rows.slice().sort((a, b) => DEPT[a.dept] - DEPT[b.dept]) : unstableSort(rows, r => DEPT[r.dept]);
      render('dept');
      const broken = groupsBroken();
      if (!bySalary) say('Сначала отсортируйте по зарплате — иначе проверять нечего.', 'warn');
      else if (stable) say('Стабильная сортировка (как Timsort в Python) не трогает порядок внутри отдела: он остался «по зарплате». Две сортировки дали сортировку по двум ключам.', 'ok');
      else say(broken ? `Heapsort переставил равные: в ${broken} ${plural(broken, ['отделе', 'отделах', 'отделах'])} порядок по зарплате сломан. Так ведут себя Go <code>slices.Sort</code> и C++ <code>std::sort</code>.` : 'На этих данных повезло — но нестабильная сортировка ничего не гарантирует.', broken ? 'bad' : 'warn');
    }
    function groupsBroken() {
      let broken = 0;
      for (const d of Object.keys(DEPT)) {
        const s = rows.filter(r => r.dept === d).map(r => r.salary);
        if (s.some((v, i) => i && s[i - 1] < v)) broken++;
      }
      return broken;
    }
    function render(key) {
      table.innerHTML = '';
      const sorted = key === 'dept';
      table.append(h('div', { class: 'st-row st-h' }, h('span', null, '#'), h('span', null, 'имя'), h('span', { class: key === 'dept' ? 'k' : '' }, 'отдел'), h('span', { class: key === 'salary' ? 'k' : '' }, 'зарплата')));
      rows.forEach((r, i) => {
        let ok = '';
        if (sorted && bySalary) {
          const prev = rows[i - 1];
          ok = prev && prev.dept === r.dept && prev.salary < r.salary ? ' bad' : '';
        }
        const first = sorted && (!rows[i - 1] || rows[i - 1].dept !== r.dept);
        table.append(h('div', { class: `st-row d-${r.dept}${ok}${first && i ? ' gap' : ''}` },
          h('span', { class: 'st-id' }, String(r.id + 1)), h('span', null, r.name), h('span', null, h('i', { class: 'st-dept' }, r.dept)), h('span', { class: 'st-sal' }, r.salary + ' т.')));
      });
    }
    render();
    say('Нажмите кнопки по порядку: сначала по зарплате, затем по отделу — стабильно или нет.');
    return {};
  });

  // ---------------------------------------------------------------- Timsort
  // A faithful small Timsort: count_run, minrun, binary insertion, classic merge_collapse,
  // merges with gallop pre-trimming and galloping mode (MIN_GALLOP fixed at 7).
  function timsort(src) {
    const a = src.slice(), n = a.length;
    let cmp = 0;
    const lt = (x, y) => { cmp++; return x < y; };
    const phases = [];
    const snap = (p) => { p.arr = a.slice(); p.stack = stack.map(r => ({ ...r })); p.cmp = cmp; phases.push(p); };
    let r = 0, nn = n;
    while (nn >= 64) { r |= nn & 1; nn >>= 1; }
    const minrun = nn + r;
    const stack = [];
    function gallop(arr, from, to, pred) { // first i in [from, to) with !pred(arr[i]); pred true on a prefix
      let last = from - 1, ofs = 0;
      while (from + ofs < to && pred(arr[from + ofs])) { last = from + ofs; ofs = ofs * 2 + 1; }
      let lo = last + 1, hi = Math.min(from + ofs, to);
      while (lo < hi) { const m = (lo + hi) >> 1; if (pred(arr[m])) lo = m + 1; else hi = m; }
      return lo;
    }
    function mergeAt(idx) {
      const A = stack[idx], B = stack[idx + 1];
      const c0 = cmp;
      const left = a.slice(A.lo, A.lo + A.len), right = a.slice(B.lo, B.lo + B.len);
      // Pre-trim: elements of A <= B[0] already in place; elements of B >= A[last] already in place.
      const k = gallop(left, 0, left.length, x => !lt(right[0], x));
      const bEnd = k === left.length ? 0 : gallop(right, 0, right.length, x => lt(x, left[left.length - 1]));
      let gallops = 0, galloped = 0;
      const out = left.slice(0, k);
      if (k < left.length) {
        let i = k, j = 0;
        const R = right.slice(0, bEnd);
        const MIN = 7;
        outer: while (i < left.length && j < R.length) {
          let ca = 0, cb = 0;
          while (ca < MIN && cb < MIN) {
            if (lt(R[j], left[i])) { out.push(R[j++]); cb++; ca = 0; if (j >= R.length) break outer; }
            else { out.push(left[i++]); ca++; cb = 0; if (i >= left.length) break outer; }
          }
          gallops++;
          let ga, gb;
          do {
            const ki = gallop(left, i, left.length, x => !lt(R[j], x));
            ga = ki - i; galloped += ga;
            for (; i < ki; i++) out.push(left[i]);
            if (i >= left.length) break outer;
            out.push(R[j++]);
            if (j >= R.length) break outer;
            const kj = gallop(R, j, R.length, x => lt(x, left[i]));
            gb = kj - j; galloped += gb;
            for (; j < kj; j++) out.push(R[j]);
            if (j >= R.length) break outer;
            out.push(left[i++]);
            if (i >= left.length) break outer;
          } while (ga >= MIN || gb >= MIN);
        }
        while (i < left.length) out.push(left[i++]);
        while (j < R.length) out.push(R[j++]);
        for (let t = bEnd; t < right.length; t++) out.push(right[t]);
      } else out.push(...right);
      for (let t = 0; t < out.length; t++) a[A.lo + t] = out[t];
      stack.splice(idx, 2, { lo: A.lo, len: A.len + B.len });
      snap({ t: 'merge', lo: A.lo, aLen: A.len, bLen: B.len, k, bTail: B.len - bEnd, gallops, galloped, cost: cmp - c0 });
    }
    function collapse() {
      for (;;) {
        const m = stack.length;
        if (m < 2) return;
        let idx = m - 2;
        const L = i => stack[i].len;
        if ((m >= 3 && L(m - 3) <= L(m - 2) + L(m - 1)) || (m >= 4 && L(m - 4) <= L(m - 3) + L(m - 2))) {
          if (L(m - 3) < L(m - 1)) idx = m - 3;
        } else if (L(m - 2) > L(m - 1)) return;
        mergeAt(idx);
      }
    }
    snap({ t: 'start', minrun });
    let lo = 0;
    while (lo < n) {
      const c0 = cmp;
      let hi = lo + 1, desc = false;
      if (hi < n) {
        if (lt(a[hi], a[lo])) { desc = true; while (++hi < n && lt(a[hi], a[hi - 1])); }
        else while (++hi < n && !lt(a[hi], a[hi - 1]));
      }
      const natural = hi - lo;
      if (desc) a.splice(lo, natural, ...a.slice(lo, hi).reverse());
      const force = Math.min(minrun, n - lo);
      if (natural < force) {
        for (let i = lo + natural; i < lo + force; i++) {
          const x = a[i];
          let l = lo, rr = i;
          while (l < rr) { const m = (l + rr) >> 1; if (lt(x, a[m])) rr = m; else l = m + 1; }
          a.splice(i, 1); a.splice(l, 0, x);
        }
      }
      const len = Math.max(natural, force);
      stack.push({ lo, len });
      snap({ t: 'run', lo, len, natural, desc, cost: cmp - c0 });
      collapse();
      lo += len;
    }
    while (stack.length > 1) {
      const m = stack.length;
      mergeAt(m >= 3 && stack[m - 3].len < stack[m - 1].len ? m - 3 : m - 2);
    }
    snap({ t: 'end' });
    for (let i = 1; i < n; i++) if (a[i - 1] > a[i]) throw new Error('timsort demo: not sorted');
    return { phases, cmp, minrun };
  }
  function mergeSortCount(src) {
    const a = src.slice();
    let cmp = 0;
    const rec = (lo, hi) => {
      if (hi - lo < 2) return;
      const mid = (lo + hi) >> 1;
      rec(lo, mid); rec(mid, hi);
      const L = a.slice(lo, mid), R = a.slice(mid, hi);
      let i = 0, j = 0, k = lo;
      while (i < L.length && j < R.length) { cmp++; a[k++] = R[j] < L[i] ? R[j++] : L[i++]; }
      while (i < L.length) a[k++] = L[i++];
      while (j < R.length) a[k++] = R[j++];
    };
    rec(0, a.length);
    return cmp;
  }

  Deck.demo('timsort', root => {
    const N = 128;
    const PRESETS = [
      ['4 готовых куска', () => { const r = rng(21); const a = []; for (let c = 0; c < 4; c++) a.push(...[...Array(32)].map(() => Math.floor(r() * 1000)).sort((x, y) => x - y)); return a; }],
      ['старое + 10 новых', () => { const r = rng(4); const a = [...Array(118)].map(() => Math.floor(r() * 1000)).sort((x, y) => x - y); for (let i = 0; i < 10; i++) a.push(Math.floor(r() * 1000)); return a; }],
      ['убывающий', () => [...Array(N)].map((_, i) => (N - i) * 7)],
      ['случайный', () => { const r = rng(8); return [...Array(N)].map(() => Math.floor(r() * 1000)); }],
    ];
    let res, pos, data, base;
    const presetG = btnGroup(PRESETS, i => load(i));
    const bars = h('div', { class: 'ts-bars' });
    const stackEl = h('div', { class: 'ts-stack' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: () => go(pos + 1) }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, presetG.el),
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => go(res.phases.length - 1) }, 'До конца'), h('button', { class: 'btn', onclick: () => go(0) }, 'Сначала')),
      bars, stackEl, stats, logEl,
    );
    const barEls = [...Array(N)].map(() => h('i'));
    bars.append(...barEls);

    function load(i) {
      data = PRESETS[i][1]();
      res = timsort(data);
      base = mergeSortCount(data);
      go(0);
    }
    function go(p) {
      pos = Math.max(0, Math.min(res.phases.length - 1, p));
      const ph = res.phases[pos];
      const arr = ph.arr, max = 1000;
      const owner = new Array(N).fill(-1);
      ph.stack.forEach((r, k) => { for (let t = r.lo; t < r.lo + r.len; t++) owner[t] = k; });
      barEls.forEach((b, k) => {
        b.style.height = Math.max(3, (arr[k] / max) * 100) + '%';
        b.className = owner[k] < 0 ? '' : 'r' + (owner[k] % 4);
        if (ph.t === 'end') b.className = 'ok';
      });
      if (ph.t === 'run' || ph.t === 'merge') {
        const lo = ph.lo, len = ph.t === 'run' ? ph.len : ph.aLen + ph.bLen;
        for (let t = lo; t < lo + len; t++) barEls[t].classList.add('cur');
      }
      stackEl.innerHTML = '<span class="label">стек серий:</span>' + (ph.stack.length
        ? ph.stack.map((r, k) => `<span class="ts-run r${k % 4}">[${r.lo}…${r.lo + r.len}) · ${r.len}</span>`).join('')
        : '<span class="empty">пусто</span>');
      stats.innerHTML = `<div class="stat"><b>${fmt(ph.cmp)}</b><span>сравнений Timsort</span></div>` +
        `<div class="stat"><b>${fmt(base)}</b><span>у сортировки слиянием</span></div>` +
        `<div class="stat"><b>${res.minrun}</b><span>minrun при n = ${N}</span></div>`;
      stepBtn.disabled = pos === res.phases.length - 1;
      if (ph.t === 'start') say(`n = ${N}, minrun = ${res.minrun}. Timsort идёт слева направо, ищет серии и складывает их на стек.`);
      else if (ph.t === 'run') {
        let s = `Серия с позиции ${ph.lo}: ${ph.natural} ${plural(ph.natural, ['элемент', 'элемента', 'элементов'])} уже ${ph.desc ? 'строго убывали — развернули' : 'шли по порядку'}`;
        s += ph.len > ph.natural ? `, добили до ${ph.len} бинарными вставками.` : '.';
        say(`${s} ${fmt(ph.cost)} ${plural(ph.cost, ['сравнение', 'сравнения', 'сравнений'])}.`);
      } else if (ph.t === 'merge') {
        let s = `Слияние ${ph.aLen} + ${ph.bLen} за ${fmt(ph.cost)} ${plural(ph.cost, ['сравнение', 'сравнения', 'сравнений'])}.`;
        const pre = [];
        if (ph.k) pre.push(`${ph.k} ${plural(ph.k, ['элемент', 'элемента', 'элементов'])} в начале левой`);
        if (ph.bTail) pre.push(`${ph.bTail} в конце правой`);
        if (pre.length) s += ` Галоп заранее нашёл, что ${pre.join(' и ')} уже на месте.`;
        if (ph.galloped) s += ` Режим галопа включался ${ph.gallops} ${plural(ph.gallops, ['раз', 'раза', 'раз'])} и скопировал пачками ${ph.galloped} ${plural(ph.galloped, ['элемент', 'элемента', 'элементов'])}.`;
        say(s);
      } else {
        const ratio = base / res.cmp;
        say(`Готово: ${fmt(res.cmp)} сравнений против ${fmt(base)} у обычной сортировки слиянием` + (ratio > 1.3 ? ` — в ${dec(ratio)} раза меньше. Порядок, который уже был в данных, не пропал зря.` : '. На случайных данных выигрыша почти нет: Timsort здесь — обычная сортировка слиянием.'), ratio > 1.3 ? 'ok' : '');
      }
    }
    load(0);
    return {};
  });

  // ---------------------------------------------------------------- decision tree + lower bound
  Deck.demo('decision', root => {
    // Tree for 3 elements a, b, c. Internal: [label, x, y, left(yes), right(no)]
    const NODES = {
      r: { q: 'a < b?', x: 180, y: 22, yes: 'n1', no: 'n2' },
      n1: { q: 'b < c?', x: 95, y: 82, yes: 'L1', no: 'n3' },
      n2: { q: 'a < c?', x: 265, y: 82, yes: 'L4', no: 'n4' },
      n3: { q: 'a < c?', x: 140, y: 142, yes: 'L2', no: 'L3' },
      n4: { q: 'b < c?', x: 310, y: 142, yes: 'L5', no: 'L6' },
      L1: { leaf: 'a<b<c', x: 40, y: 142 },
      L2: { leaf: 'a<c<b', x: 95, y: 200 },
      L3: { leaf: 'c<a<b', x: 185, y: 200 },
      L4: { leaf: 'b<a<c', x: 220, y: 142 },
      L5: { leaf: 'b<c<a', x: 265, y: 200 },
      L6: { leaf: 'c<b<a', x: 350, y: 200 },
    };
    const PERMS = [['a<b<c', [1, 2, 3]], ['a<c<b', [1, 3, 2]], ['b<a<c', [2, 1, 3]], ['b<c<a', [3, 1, 2]], ['c<a<b', [2, 3, 1]], ['c<b<a', [3, 2, 1]]];
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 390 222');
    svg.setAttribute('class', 'dt');
    const mk = (tag, attrs, text) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; svg.append(e); return e; };
    const edges = {}, nodes = {};
    for (const [id, n] of Object.entries(NODES)) {
      if (n.leaf) continue;
      for (const [kind, to] of [['yes', n.yes], ['no', n.no]]) {
        const t = NODES[to];
        edges[id + to] = mk('line', { x1: n.x, y1: n.y + 12, x2: t.x, y2: t.y - 12, class: 'dt-e' });
        mk('text', { x: (n.x + t.x) / 2 + (kind === 'yes' ? -10 : 10), y: (n.y + t.y) / 2 + 4, class: 'dt-yn', 'text-anchor': 'middle' }, kind === 'yes' ? 'да' : 'нет');
      }
    }
    for (const [id, n] of Object.entries(NODES)) {
      const w = n.leaf ? 64 : 62;
      const rect = mk('rect', { x: n.x - w / 2, y: n.y - 12, width: w, height: 24, rx: n.leaf ? 12 : 5, class: n.leaf ? 'dt-leaf' : 'dt-node' });
      mk('text', { x: n.x, y: n.y + 4.5, 'text-anchor': 'middle', class: 'dt-t' }, n.q || n.leaf);
      nodes[id] = rect;
    }
    const permG = btnGroup(PERMS, i => trace(i), -1);
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const nSel = h('input', { type: 'range', min: 0, max: 6, value: 2, 'aria-label': 'n' });
    const NS = [3, 5, 10, 20, 100, 1000, 1000000];
    const nOut = h('output');
    const table = h('div', { class: 'dt-table' });
    nSel.addEventListener('input', calc);
    root.append(svg, h('div', { class: 'controls dt-perms' }, permG.el), logEl,
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'n'), nSel, nOut), table);

    function trace(i) {
      const [name, v] = PERMS[i];
      const val = { a: v[0], b: v[1], c: v[2] };
      Object.values(nodes).forEach(r => r.classList.remove('on'));
      Object.values(edges).forEach(e => e.classList.remove('on'));
      let id = 'r', steps = 0;
      while (!NODES[id].leaf) {
        const n = NODES[id];
        const [x, , y] = n.q.split(' ');
        const yes = val[x] < val[y.replace('?', '')];
        const to = yes ? n.yes : n.no;
        nodes[id].classList.add('on');
        edges[id + to].classList.add('on');
        id = to; steps++;
      }
      nodes[id].classList.add('on');
      logEl.innerHTML = `Порядок ${name.replace(/</g, ' &lt; ')}: ${steps} ${plural(steps, ['сравнение', 'сравнения', 'сравнений'])}. У дерева 6 = 3! листьев, а у дерева высоты 2 их не больше 4 — значит, в худшем случае 3 сравнения неизбежны.`;
    }
    function calc() {
      const n = NS[+nSel.value];
      nOut.textContent = fmt(n);
      let lg = 0;
      for (let i = 2; i <= n; i++) lg += Math.log2(i);
      const k = Math.ceil(Math.log2(n));
      const merge = n * k - 2 ** k + 1;
      const rows = [
        ['перестановок n!', n <= 20 ? factStr(n) : `≈ 10<sup>${fmt(Math.floor(lg / Math.log2(10)))}</sup>`],
        ['нижняя граница ⌈log₂ n!⌉', fmt(Math.ceil(lg - 1e-9))],
        ['слиянием, худший случай', fmt(merge)],
        ['вставками, худший случай', fmt(n * (n - 1) / 2)],
      ];
      table.innerHTML = rows.map(([l, v], i) => `<div class="${i === 1 ? 'hl' : ''}"><span>${l}</span><b>${v}</b></div>`).join('');
    }
    function factStr(n) { let p = 1n; for (let i = 2n; i <= BigInt(n); i++) p *= i; return p.toLocaleString('ru-RU'); }
    calc();
    logEl.textContent = 'Нажмите на одну из шести перестановок.';
    return {};
  });

  // ---------------------------------------------------------------- LSD radix sort
  Deck.demo('radix', root => {
    const START = [329, 457, 657, 839, 436, 720, 355, 61, 402, 538, 117, 795];
    const NAMES = ['единицам', 'десяткам', 'сотням'];
    let seq, phase; // phase: 0 = initial; then pass p: 2p+1 = distributed, 2p+2 = collected
    let buckets = [];
    const seqEl = h('div', { class: 'rx-seq' });
    const bucketsEl = h('div', { class: 'rx-buckets' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('span', { class: 'label' }, 'последовательность'), seqEl, h('span', { class: 'label' }, 'корзины 0–9'), bucketsEl, logEl);
    const digit = (v, p) => Math.floor(v / 10 ** p) % 10;
    const chip = (v, p, extra = '') => {
      const s = String(v).padStart(3, '0');
      const k = 2 - p;
      return `<span class="val rx${extra}">${p < 0 ? s : s.slice(0, k) + '<u>' + s[k] + '</u>' + s.slice(k + 1)}</span>`;
    };
    function reset() { seq = START.slice(); phase = 0; buckets = []; render(); say('12 трёхзначных чисел. Первый проход — по единицам.'); }
    function step() {
      if (phase >= 6) return;
      const p = phase >> 1;
      if (phase % 2 === 0) {
        buckets = [...Array(10)].map(() => []);
        for (const v of seq) buckets[digit(v, p)].push(v);
        phase++;
        say(`Раскладываем по ${NAMES[p]}: проходим последовательность слева направо, каждое число — в конец своей корзины. Порядок внутри корзины — как был.`);
      } else {
        seq = buckets.flat();
        buckets = [];
        phase++;
        say(phase === 6
          ? `Готово: 3 прохода × 12 чисел = 36 раскладок и ни одного сравнения. Для 32-битных чисел берут разряд = байт: 4 прохода по 256 корзин.`
          : `Собрали корзины по порядку 0…9. Теперь числа упорядочены по ${p === 0 ? 'последней цифре' : 'двум последним цифрам'}.`, phase === 6 ? 'ok' : '');
      }
      render();
    }
    function render() {
      const p = phase >> 1;
      const showP = phase >= 6 ? -1 : (phase % 2 === 1 ? p : p);
      seqEl.innerHTML = seq.map(v => chip(v, phase >= 6 ? -1 : showP, phase >= 6 ? ' done' : '')).join('');
      if (phase % 2 === 1) seqEl.classList.add('dim'); else seqEl.classList.remove('dim');
      bucketsEl.innerHTML = [...Array(10)].map((_, d) =>
        `<div class="rx-b"><b>${d}</b>${(buckets[d] || []).map(v => chip(v, p)).join('')}</div>`).join('');
      stepBtn.disabled = phase >= 6;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- quickselect
  Deck.demo('select', root => {
    const START = [41, 17, 88, 5, 63, 29, 94, 12, 70, 36, 51, 8, 77, 23, 58];
    const K = 7; // 0-based index of the median among 15
    let a, lo, hi, cmp, done, lastPivot, stage;
    const arrEl = h('div', { class: 'qs-arr' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), arrEl, stats, logEl);
    function reset() {
      a = START.slice(); lo = 0; hi = a.length - 1; cmp = 0; done = false; lastPivot = -1; stage = 0;
      say(`Нужен элемент, который встал бы на место ${K} (с нуля) в отсортированном массиве, — медиана из 15. Опорный — последний в отрезке.`);
      render();
    }
    function step() {
      if (done) return;
      if (lo === hi) { finish(lo); return; }
      const p = a[hi];
      let i = lo;
      for (let j = lo; j < hi; j++) { cmp++; if (a[j] < p) { [a[i], a[j]] = [a[j], a[i]]; i++; } }
      [a[i], a[hi]] = [a[hi], a[i]];
      lastPivot = i;
      stage++;
      if (i === K) { finish(i, p); return; }
      const side = i < K ? 'правой' : 'левой';
      const left = i - lo, right = hi - i;
      if (i < K) lo = i + 1; else hi = i - 1;
      say(`Опорный ${p} встал на позицию ${i}: слева ${left} ${plural(left, ['меньший', 'меньших', 'меньших'])}, справа ${right} ${plural(right, ['больший', 'больших', 'больших'])}. Нам нужна позиция ${K} — ищем дальше только в ${side} части [${lo}…${hi}].`);
      render();
    }
    function finish(i, p = a[i]) {
      done = true; lastPivot = i;
      say(`Нашли: на позиции ${K} стоит ${p} — это медиана. ${cmp} ${plural(cmp, ['сравнение', 'сравнения', 'сравнений'])} за ${stage} ${plural(stage, ['разбиение', 'разбиения', 'разбиений'])}; полная сортировка заняла бы ~n·log₂n ≈ 59. Слева от медианы все меньше, справа — больше, хотя между собой не упорядочены.`, 'ok');
      render();
    }
    function render() {
      arrEl.innerHTML = a.map((v, k) => {
        let c = '';
        if (k < lo || k > hi) c = ' out';
        if (k === lastPivot) c = done ? ' found' : ' piv';
        return `<div class="qs-c${c}${k === K ? ' target' : ''}"><span class="val">${v}</span><small>${k}</small></div>`;
      }).join('');
      stats.innerHTML = `<div class="stat"><b>${cmp}</b><span>сравнений</span></div><div class="stat"><b>${done ? 0 : hi - lo + 1}</b><span>осталось кандидатов</span></div><div class="stat"><b>${stage}</b><span>разбиений</span></div>`;
      stepBtn.disabled = done;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- external merge sort
  Deck.demo('external', root => {
    const M = 6;
    const INPUT = [47, 12, 85, 33, 9, 61, 74, 28, 90, 15, 52, 3, 66, 41, 19, 88, 7, 57, 36, 95, 22, 70, 11, 49];
    let pos, mem, runs, heads, out, phase, reads, writes, last;
    const view = h('div', { class: 'ex' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stats = h('div', { class: 'stats' });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    const allBtn = h('button', { class: 'btn', onclick: () => { let g = 0; while (phase !== 'done' && g++ < 200) step(); } }, 'До конца');
    root.append(h('div', { class: 'controls' }, stepBtn, allBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')), view, stats, logEl);
    function reset() {
      pos = 0; mem = []; runs = []; heads = []; out = []; phase = 'read'; reads = 0; writes = 0; last = -1;
      say(`На диске ${INPUT.length} записей, в памяти помещается ${M}. Фаза 1: делаем отсортированные серии.`);
      render();
    }
    function step() {
      if (phase === 'read') {
        mem = INPUT.slice(pos, pos + M); pos += mem.length; reads += mem.length;
        phase = 'sort';
        say(`Прочитали ${mem.length} записей в память.`);
      } else if (phase === 'sort') {
        mem.sort((x, y) => x - y);
        phase = 'write';
        say('Отсортировали в памяти — Postgres делает это quicksort.');
      } else if (phase === 'write') {
        runs.push(mem); writes += mem.length; mem = [];
        say(`Записали серию ${runs.length} во временный файл.` + (pos < INPUT.length ? '' : ` Входные данные кончились: ${runs.length} ${plural(runs.length, ['серия', 'серии', 'серий'])}. Фаза 2 — ${runs.length}-путевое слияние.`));
        if (pos < INPUT.length) phase = 'read';
        else { phase = 'merge'; heads = runs.map(() => 0); reads += 0; }
      } else if (phase === 'merge') {
        let best = -1;
        runs.forEach((r, k) => { if (heads[k] < r.length && (best < 0 || r[heads[k]] < runs[best][heads[best]])) best = k; });
        const v = runs[best][heads[best]++];
        out.push(v); reads++; writes++; last = best;
        const hv = runs.map((r, k) => heads[k] < r.length ? r[heads[k]] : null).filter(x => x != null);
        say(`Минимум среди голов серий — ${v} из серии ${best + 1}. Выводим его и берём следующий элемент той же серии.` + (hv.length ? ` Головы серий теперь: ${hv.join(', ')}.` : ''));
        if (out.length === INPUT.length) {
          phase = 'done';
          say(`Готово за один проход слияния. Каждая запись прочитана и записана дважды — это и есть цена внешней сортировки. Если серий больше, чем буферов помещается в память, слияние идёт в несколько проходов, и каждый — ещё одно чтение и запись всех данных.`, 'ok');
        }
      }
      render();
    }
    function render() {
      const cell = (v, cls = '') => `<span class="val ${cls}">${v}</span>`;
      const disk = INPUT.map((v, k) => cell(v, k < pos ? 'gone' : '')).join('');
      const heapVals = phase === 'merge' ? runs.map((r, k) => heads[k] < r.length ? r[heads[k]] : null).filter(v => v != null).sort((x, y) => x - y) : [];
      const memHtml = phase === 'merge'
        ? heapVals.map((v, k) => cell(v, k ? '' : 'head')).join('') + '<span class="empty">— куча из голов серий, минимум слева</span>'
        : mem.length ? mem.map(v => cell(v)).join('') : '<span class="empty">пусто</span>';
      const runsHtml = runs.length ? runs.map((r, k) => `<div class="ex-run${k === last && phase !== 'done' ? ' last' : ''}"><small>серия ${k + 1}</small>${r.map((v, i) => cell(v, phase === 'merge' || phase === 'done' ? (i < heads[k] ? 'gone' : i === heads[k] ? 'head' : '') : '')).join('')}</div>`).join('') : '<span class="empty">пока нет</span>';
      view.innerHTML =
        `<div class="ex-box"><span class="label">вход на диске</span><div class="queue">${disk}</div></div>` +
        `<div class="ex-box mem"><span class="label">память: ${M} записей</span><div class="queue">${memHtml}</div></div>` +
        `<div class="ex-box"><span class="label">временные файлы</span>${runsHtml}</div>` +
        `<div class="ex-box"><span class="label">результат</span><div class="queue">${out.length ? out.map(v => cell(v, 'done')).join('') : '<span class="empty">пусто</span>'}</div></div>`;
      stats.innerHTML = `<div class="stat"><b>${reads}</b><span>прочитано</span></div><div class="stat"><b>${writes}</b><span>записано</span></div><div class="stat"><b>${runs.length}</b><span>серий</span></div>`;
      stepBtn.disabled = allBtn.disabled = phase === 'done';
    }
    reset();
    return {};
  });
})();
