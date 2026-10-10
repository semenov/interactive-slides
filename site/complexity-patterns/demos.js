// Demos for the complexity part: crossover, growth, amortised array, recursion depth, N+1, doubling test.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  window.CP = { logger, fmt, dec };

  // 10^x as a readable string: 4 700 000 → «4,7 млн», 10^15 → «10¹⁵».
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sup = n => String(n).split('').map(c => SUP[+c]).join('');
  function big(log10) {
    if (log10 < 3) return fmt(10 ** log10);
    if (log10 < 6) return fmt(10 ** log10);
    if (log10 < 9) return dec(10 ** (log10 - 6), log10 < 7 ? 1 : 0) + ' млн';
    if (log10 < 12) return dec(10 ** (log10 - 9), log10 < 10 ? 1 : 0) + ' млрд';
    const e = Math.floor(log10);
    const m = 10 ** (log10 - e);
    if (e >= 1e4) { const k = Math.floor(Math.log10(e)); return '10<sup>' + (e / 10 ** k >= 1.05 ? dec(e / 10 ** k, 1) + '·' : '') + '10' + sup(k) + '</sup>'; }
    return (m >= 1.05 && e < 100 ? dec(m, 1) + '·' : '') + '10<sup>' + e + '</sup>';
  }
  // seconds given as log10
  function dur(ls) {
    const s = 10 ** ls;
    if (ls < -6) return dec(s * 1e9, s * 1e9 < 10 ? 1 : 0) + ' нс';
    if (ls < -3) return dec(s * 1e6, 0) + ' мкс';
    if (ls < 0) return dec(s * 1e3, 0) + ' мс';
    if (s < 60) return dec(s, s < 10 ? 1 : 0) + ' с';
    if (s < 3600) return dec(s / 60, 0) + ' мин';
    if (s < 86400) return dec(s / 3600, 0) + ' ч';
    if (s < 3.15e7) return dec(s / 86400, 0) + ' дн';
    const ly = ls - Math.log10(3.15e7);
    if (ly < 4) return fmt(10 ** ly) + ' лет';
    if (ly > 10.14) return 'дольше Вселенной';
    return big(ly) + ' лет';
  }
  CP.big = big;
  CP.dur = dur;

  // ---------------------------------------------------------------- crossover: insertion vs merge sort
  Deck.demo('crossover', root => {
    const MAXN = 200;
    const ins = n => (n * n) / 4;
    const mer = n => 3 * n * Math.log2(Math.max(2, n));
    let cross = 2;
    while (ins(cross) < mer(cross)) cross++;
    const W = 320, H = 170, PX = 34, PY = 12;
    const ymax = ins(MAXN);
    const X = n => PX + ((n - 2) / (MAXN - 2)) * (W - PX - 8);
    const Y = v => H - 22 - (Math.min(v, ymax) / ymax) * (H - 22 - PY);
    const path = f => { let d = ''; for (let n = 2; n <= MAXN; n += 2) d += (d ? 'L' : 'M') + X(n).toFixed(1) + ' ' + Y(f(n)).toFixed(1); return d; };
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'xo-plot');
    svg.innerHTML =
      `<path class="ax" d="M${PX} ${PY}V${H - 22}H${W - 4}"/>` +
      `<path class="xo-cross" d="M${X(cross)} ${PY}V${H - 22}"/>` +
      `<text class="dim" x="${X(cross) + 4}" y="${PY + 10}">n ≈ ${cross}</text>` +
      `<path class="cv ins" d="${path(ins)}"/><path class="cv mer" d="${path(mer)}"/>` +
      `<text class="dim" x="${PX}" y="${H - 6}">2</text><text class="dim end" x="${W - 6}" y="${H - 6}">n = ${MAXN}</text>` +
      `<text class="dim" x="2" y="${PY + 8}">шаги</text>` +
      `<line class="xo-mark" y1="${PY}" y2="${H - 22}"/>`;
    const mark = svg.querySelector('.xo-mark');
    const slider = h('input', { type: 'range', min: 2, max: MAXN, value: 16, 'aria-label': 'Размер массива n' });
    const out = h('output');
    const rows = h('div', { class: 'xo-rows' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'n'), slider, out),
      svg, rows, logEl,
      h('p', { class: 'note' }, 'Модель: вставки — n²/4 дешёвых шагов в одном цикле; слияние — 3·n·log₂n (копирование в буфер, вызовы).'),
    );
    function update() {
      const n = +slider.value;
      out.textContent = n;
      const a = ins(n), b = mer(n), m = Math.max(a, b);
      mark.setAttribute('x1', X(n));
      mark.setAttribute('x2', X(n));
      rows.innerHTML =
        `<div class="xo-row ${a <= b ? 'win' : ''}"><span><span class="sw ins"></span>вставками, O(n²)</span><span class="cost-track"><span class="cost-fill ins" style="width:${(a / m) * 100}%"></span></span><b>${fmt(a)}</b></div>` +
        `<div class="xo-row ${b < a ? 'win' : ''}"><span><span class="sw mer"></span>слиянием, O(n log n)</span><span class="cost-track"><span class="cost-fill mer" style="width:${(b / m) * 100}%"></span></span><b>${fmt(b)}</b></div>`;
      if (a <= b) {
        logEl.innerHTML = `При n = ${n} «плохой» O(n²) быстрее в ${dec(b / a)} раза: константа у слияния больше, а n ещё мало.`;
        logEl.className = 'log ok';
      } else {
        logEl.innerHTML = `При n = ${n} слияние быстрее в ${dec(a / b)} раза — и разрыв только растёт. При n = 10⁶ он будет в тысячи раз.`;
        logEl.className = 'log';
      }
    }
    slider.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- growth table
  Deck.demo('growth', root => {
    const NS = [10, 20, 50, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
    const lfact = n => { if (n <= 170) { let s = 0; for (let k = 2; k <= n; k++) s += Math.log10(k); return s; } return (n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n)) / Math.LN10; };
    const FUNCS = [
      ['O(1)', () => 0],
      ['O(log n)', n => Math.log10(Math.log2(n))],
      ['O(n)', n => Math.log10(n)],
      ['O(n log n)', n => Math.log10(n * Math.log2(n))],
      ['O(n²)', n => 2 * Math.log10(n)],
      ['O(n³)', n => 3 * Math.log10(n)],
      ['O(2ⁿ)', n => n * Math.LOG10E * Math.LN2],
      ['O(n!)', n => lfact(n)],
    ];
    const slider = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 4, 'aria-label': 'Размер входа n' });
    const out = h('output');
    const table = h('div', { class: 'gr-table' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'n ='), slider, out), table, logEl);
    const MAXL = 20;
    function update() {
      const n = NS[+slider.value];
      out.textContent = n >= 1e4 ? '10' + sup(Math.round(Math.log10(n))) : fmt(n);
      let last = '';
      table.innerHTML = `<div class="gr-row gr-head"><span></span><span>шагов</span><span class="gr-barh"></span><span>время</span><span></span></div>` +
        FUNCS.map(([name, f]) => {
          const L = f(n), ls = L - 8, ok = ls <= 0;
          if (ok) last = name;
          return `<div class="gr-row ${ok ? 'ok' : 'no'}"><code>${name}</code><span class="gr-ops">${big(L)}</span>` +
            `<span class="gr-bar"><i style="width:${Math.max(1.5, Math.min(100, (L / MAXL) * 100))}%"></i></span>` +
            `<span class="gr-t">${dur(ls)}</span><span class="gr-mark">${ok ? '✓' : '✗'}</span></div>`;
        }).join('');
      logEl.innerHTML = `При n = ${out.textContent} в секунду укладывается всё до <b>${last}</b> включительно.` +
        (n >= 1e8 ? ' На таких объёмах данные часто даже не помещаются в память — нужен потоковый проход или индекс.' : n <= 20 ? ' Маленькое n — можно позволить себе даже экспоненту.' : '');
      logEl.className = 'log';
    }
    slider.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- dynamic array: amortised push
  Deck.demo('dynarray', root => {
    const MAX = 64;
    const STRATS = [
      ['×2', c => c * 2, 'удвоение'],
      ['×1,5', c => Math.max(c + 1, Math.floor(c * 1.5)), 'в 1,5 раза (Java)'],
      ['+4', c => c + 4, 'на 4 ячейки'],
    ];
    let strat = 0, size, cap, costs, total, copiedFlash;
    const sbtn = STRATS.map(([label], i) => h('button', { class: 'btn small', onclick: () => { strat = i; reset(); } }, 'ёмкость ' + label));
    const pushBtn = h('button', { class: 'btn primary', onclick: () => push(1) }, 'append');
    const push8Btn = h('button', { class: 'btn', onclick: () => push(8) }, '+8 append');
    const cells = h('div', { class: 'da-cells' });
    const chart = h('div', { class: 'da-chart' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, ...sbtn),
      h('div', { class: 'controls' }, pushBtn, push8Btn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      cells,
      h('div', { class: 'label' }, 'Цена каждого append: 1 запись + копирование'),
      chart, stats, logEl,
    );
    function reset() {
      sbtn.forEach((b, i) => b.classList.toggle('sel', i === strat));
      size = 0; cap = 1; costs = []; total = 0; copiedFlash = 0;
      say(`Ёмкость растёт ${STRATS[strat][2]}. Нажимайте append.`);
      render();
    }
    function push(k) {
      let msg = '';
      for (let j = 0; j < k && size < MAX; j++) {
        let cost = 1;
        copiedFlash = 0;
        if (size === cap) {
          const nc = STRATS[strat][1](cap);
          cost += size;
          copiedFlash = size;
          msg = `append №${size + 1}: места нет — выделили ${nc} ${plural(nc, ['ячейку', 'ячейки', 'ячеек'])}, скопировали ${size}. Цена ${cost}.`;
          cap = nc;
        } else msg = `append №${size + 1}: место есть, цена 1.`;
        size++;
        costs.push(cost);
        total += cost;
      }
      if (size >= MAX) msg += ' Хватит: дальше картина та же.';
      say(msg + ` В среднем ${dec(total / size, 2)} на элемент.`, strat === 2 && size > 16 ? 'warn' : '');
      render();
    }
    function render() {
      const shown = Math.max(cap, 8);
      let html = '';
      for (let i = 0; i < Math.min(shown, 72); i++) {
        const cls = i < size ? (i < copiedFlash ? 'copied' : 'used') : i < cap ? 'free' : 'none';
        if (cls !== 'none') html += `<i class="${cls}"></i>`;
      }
      cells.innerHTML = html;
      const mx = Math.max(8, ...costs);
      chart.innerHTML = costs.map(c => `<i class="${c > 1 ? 'grow' : ''}" style="height:${Math.max(4, (c / mx) * 100)}%"></i>`).join('') || '<span class="empty">пока пусто</span>';
      const avg = size ? total / size : 0;
      stats.innerHTML = `<div class="stat"><b>${size} / ${cap}</b><span>размер / ёмкость</span></div>` +
        `<div class="stat"><b>${fmt(total)}</b><span>всего операций</span></div>` +
        `<div class="stat ${avg > 3 ? 'warn' : ''}"><b>${dec(avg, 2)}</b><span>в среднем на append</span></div>`;
      pushBtn.disabled = push8Btn.disabled = size >= MAX;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- recursion depth
  Deck.demo('recursion', root => {
    const NS = [10, 100, 1000, 1e4, 1e5, 1e6];
    const RT = [
      ['Python', d => d < 990 ? 0 : 2, 'RecursionError на 1000 кадрах'],
      ['JS (V8)', d => d < 8000 ? 0 : d < 15000 ? 1 : 2, 'RangeError: Maximum call stack size exceeded'],
      ['Java', d => d < 1e4 ? 0 : d < 5e4 ? 1 : 2, 'StackOverflowError, зависит от -Xss'],
      ['Go', d => d < 5e6 ? 0 : 2, 'стек горутины растёт до 1 ГБ'],
    ];
    let shape = 'list', iter = false;
    const shapeBtns = [['balanced', 'сбалансированное дерево'], ['list', 'вырожденное: список']].map(([k, l]) =>
      h('button', { class: 'btn small', 'data-k': k, onclick: () => { shape = k; update(); } }, l));
    const slider = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 2, 'aria-label': 'Число узлов' });
    const out = h('output');
    const iterIn = h('input', { type: 'checkbox' });
    iterIn.addEventListener('change', () => { iter = iterIn.checked; update(); });
    const stackEl = h('div', { class: 'rc-stack' });
    const rtEl = h('div', { class: 'rc-rt' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, ...shapeBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'узлов'), slider, out),
      h('label', { class: 'toggle' }, iterIn, h('span', null, 'обход с явным стеком (в куче)')),
      h('div', { class: 'rc-body' }, stackEl, rtEl),
      logEl,
    );
    slider.addEventListener('input', update);
    function update() {
      shapeBtns.forEach(b => b.classList.toggle('sel', b.dataset.k === shape));
      const n = NS[+slider.value];
      out.textContent = fmt(n);
      const depth = shape === 'list' ? n : Math.ceil(Math.log2(n + 1));
      const SHOW = 9;
      const frames = [];
      const k = Math.min(depth, SHOW);
      for (let i = 0; i < k; i++) {
        const lvl = depth <= SHOW ? i : i < 4 ? i : depth - (SHOW - i);
        frames.push(`<div class="rc-fr">${iter ? 'stack[' + lvl + ']' : 'dfs(узел ' + (lvl + 1) + ')'}</div>`);
      }
      if (depth > SHOW) frames.splice(4, 0, `<div class="rc-gap">… ещё ${fmt(depth - SHOW)} …</div>`);
      stackEl.innerHTML = `<div class="label">${iter ? 'список в куче' : 'стек вызовов'} · глубина <b>${fmt(depth)}</b></div>` + frames.reverse().join('');
      stackEl.classList.toggle('heap', iter);
      rtEl.innerHTML = RT.map(([name, f, why]) => {
        const st = iter ? 0 : f(depth);
        const txt = ['работает', 'на грани', 'падает'][st];
        return `<div class="rc-r s${st}"><b>${name}</b><span>${txt}</span>${st ? `<small>${why}</small>` : ''}</div>`;
      }).join('');
      if (iter) {
        logEl.innerHTML = `Память та же — O(${shape === 'list' ? 'n' : 'log n'}), но в куче, где места гигабайты. Ни один рантайм не упадёт.`;
        logEl.className = 'log ok';
      } else if (shape === 'balanced') {
        logEl.innerHTML = `Сбалансированное дерево из ${fmt(n)} узлов — глубина всего ${depth}. Рекурсия безопасна: O(log n) памяти.`;
        logEl.className = 'log ok';
      } else {
        logEl.innerHTML = `Вырожденное дерево — та же структура, но глубина ${fmt(depth)}: O(n) памяти на стеке.` + (depth >= 1000 ? ' Так падают рекурсивный парсер на вложенном JSON и DFS по длинной цепочке.' : '');
        logEl.className = depth >= 1000 ? 'log bad' : 'log';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- N+1 and nested loops
  Deck.demo('nplus1', root => {
    const NS = [10, 50, 100, 500, 1000, 5000, 10000];
    const RTT = [0.2, 0.5, 1, 5];
    const PY_OPS = 3e7; // simple Python operations per second
    const mk = (label, list, idx, f) => {
      const o = h('output');
      const inp = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
      const set = () => { o.textContent = f(list[+inp.value]); };
      set();
      inp.addEventListener('input', () => { set(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label np-l' }, label), inp, o));
      return () => list[+inp.value];
    };
    const n = mk('заказов', NS, 2, fmt);
    const rtt = mk('задержка до БД', RTT, 1, v => dec(v, v < 1 ? 1 : 0) + ' мс');
    const box = h('div', { class: 'np-box' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(box, logEl);
    const ms = v => v < 1 ? dec(v, 2) + ' мс' : v < 1000 ? fmt(v) + ' мс' : dec(v / 1000, v < 1e4 ? 1 : 0) + ' с';
    function group(title, rows) {
      const m = Math.max(...rows.map(r => r[1]));
      return `<div class="np-g"><div class="label">${title}</div>` + rows.map(([name, t, sub, bad]) =>
        `<div class="np-row ${bad ? 'bad' : 'good'}"><span>${name}<small>${sub}</small></span><span class="cost-track"><span class="cost-fill" style="width:${Math.max(1, (t / m) * 100)}%"></span></span><b>${ms(t)}</b></div>`).join('') + '</div>';
    }
    function update() {
      const N = n(), R = rtt(), EXEC = 0.1;
      const q1 = (1 + N) * (R + EXEC);
      const q2 = 2 * (R + EXEC) + N * 0.002;
      const nested = (N * N / 2) / PY_OPS * 1000; // users ≈ orders, half the list on average
      const dict = (2 * N) / PY_OPS * 1000;
      box.innerHTML =
        group('Загрузить пользователей заказов', [
          ['ленивая связь в цикле', q1, `${fmt(1 + N)} ${plural(1 + N, ['запрос', 'запроса', 'запросов'])}`, true],
          ['prefetch / IN (…)', q2, '2 запроса', false],
        ]) +
        group('Сопоставить в памяти Python', [
          ['вложенный цикл', nested, `~${CP.big(Math.log10(N * N / 2))} сравнений`, true],
          ['dict по id', dict, `${fmt(2 * N)} операций`, false],
        ]);
      const worst = Math.max(q1, nested);
      logEl.innerHTML = `${fmt(N)} заказов: N+1 — ${ms(q1)} против ${ms(q2)}, вложенный цикл — ${ms(nested)} против ${ms(dict)}.` +
        (N <= 100 ? ' На тестовых данных разница почти не видна — поэтому такие баги и доезжают до прода.' : worst > 1000 ? ' Таймаут HTTP-запроса уже близко.' : '');
      logEl.className = worst > 1000 ? 'log bad' : worst > 200 ? 'log warn' : 'log';
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- doubling test, measured live
  Deck.demo('doubling', root => {
    const NS = [1000, 2000, 4000, 8000];
    let timer = 0, running = false;
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Запустить замер');
    const table = h('div', { class: 'db-table' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'controls' }, runBtn),
      h('pre', { class: 'code db-code' }, h('code', { html: Deck.highlight(
        '// O(n²): includes проходит весь out\nfor (const x of data) if (!out.includes(x)) out.push(x);\n// O(n): Set.has — хеш-таблица\nfor (const x of data) if (!seen.has(x)) seen.add(x);', 'js') })),
      table, logEl,
    );
    const data = n => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = (i * 2654435761) % 1000003; return a; };
    function quad(d) { const out = []; for (const x of d) if (!out.includes(x)) out.push(x); return out.length; }
    function lin(d) { const s = new Set(); for (const x of d) if (!s.has(x)) s.add(x); return s.size; }
    // Time per call: batches of at least ~8 ms (timer resolution is coarse), minimum of several batches
    // (GC pauses, JIT tiering and other tabs only ever add time).
    function time(f, d, batches) {
      let best = Infinity, r = 0;
      for (let b = 0; b < batches; b++) {
        let reps = 0;
        const t0 = performance.now();
        let t;
        do { r += f(d); reps++; t = performance.now() - t0; } while (t < 8);
        best = Math.min(best, t / reps);
      }
      return r < 0 ? 0 : best;
    }
    let rows = [];
    function render() {
      const cell = (v, prev) => v == null ? '<span class="dim">…</span>' : `${dec(v, v < 1 ? 2 : 1)} мс` + (prev ? ` <em class="${v / prev > 3 ? 'q' : 'l'}">×${dec(v / prev)}</em>` : '');
      table.innerHTML = `<div class="db-row db-head"><span>n</span><span>includes</span><span>Set</span></div>` +
        NS.map((nn, i) => `<div class="db-row"><b>${fmt(nn)}</b><span>${cell(rows[i] && rows[i][0], i && rows[i - 1] && rows[i - 1][0])}</span><span>${cell(rows[i] && rows[i][1], i && rows[i - 1] && rows[i - 1][1])}</span></div>`).join('');
    }
    function run() {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      rows = [];
      render();
      logEl.innerHTML = 'Замеряем…';
      logEl.className = 'log';
      for (let k = 0; k < 3; k++) { quad(data(3000)); lin(data(3000)); } // warm up the JIT
      let i = 0;
      const step = () => {
        const d = data(NS[i]);
        const tq = time(quad, d, 3);
        const tl = time(lin, d, 5);
        rows.push([tq, tl]);
        render();
        i++;
        if (i < NS.length) timer = setTimeout(step, 30);
        else {
          running = false;
          runBtn.disabled = false;
          // geometric mean of the three doubling ratios
          const g = k => Math.cbrt(rows[3][k] / rows[0][k]);
          const r = g(0), s = g(1);
          logEl.innerHTML = `Каждое удвоение n замедляет includes в среднем в ${dec(r)} раза (квадрат: ×4), а Set — в ${dec(s)} раза (линейно: ×2). При n = 8 000 разница — в ${fmt(rows[3][0] / rows[3][1])} ${plural(Math.round(rows[3][0] / rows[3][1]), ['раз', 'раза', 'раз'])}, при миллионе было бы в десятки тысяч.`;
          logEl.className = 'log ok';
        }
      };
      timer = setTimeout(step, 30);
    }
    render();
    logEl.innerHTML = 'Нажмите «Запустить замер»: код выполнится прямо здесь, на 1–8 тыс. элементов.';
    return { stop() { clearTimeout(timer); if (running) { running = false; runBtn.disabled = false; logEl.innerHTML = 'Замер прерван — запустите снова.'; } } };
  });
})();
