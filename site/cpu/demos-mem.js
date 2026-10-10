// Demos for slides 9–16: latency scale, cache lines, prefetching, false sharing, Python vs numpy, data layout.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 1.2e-6 s → «1,2 мкс»
  function fmtTime(sec) {
    const a = Math.abs(sec);
    const pick = (v, u) => (v >= 100 ? fmt(v) : v >= 10 ? dec(v, 0) : dec(v, v < 1 ? 2 : 1).replace(/,0$/, '')) + ' ' + u;
    if (a < 1e-6) return pick(sec * 1e9, 'нс');
    if (a < 1e-3) return pick(sec * 1e6, 'мкс');
    if (a < 1) return pick(sec * 1e3, 'мс');
    return pick(sec, 'с');
  }

  // ---------------------------------------------------------------- latency ladder
  Deck.demo('latency', root => {
    const GHZ = 3;
    const L = [
      ['Регистр', 0.33, 'Операнды прямо в ядре. 16 регистров общего назначения и 16–32 векторных. Значение доступно на следующем такте.'],
      ['Кэш L1', 1.3, '32–48 КБ данных на каждое ядро (плюс столько же для инструкций), 4–5 тактов. Здесь живёт горячий цикл.'],
      ['Кэш L2', 4, '1–2 МБ на ядро, 12–16 тактов. Промах L1 с попаданием в L2 почти незаметен.'],
      ['Кэш L3', 15, 'Общий на все ядра, десятки мегабайт, 40–70 тактов — зависит от того, в каком куске кристалла лежит линия.'],
      ['RAM', 90, 'Десятки и сотни гигабайт, 80–120 нс. На чужом сокете (NUMA) — ещё в 1,5–2 раза дольше. Здесь ядро встаёт: окна внеочередного исполнения хватает на несколько десятков тактов, а не на сотни.'],
      ['NVMe SSD', 80e3, 'Случайное чтение 4 КБ: 50–100 мкс, плюс системный вызов. Если страница уже в кэше ОС — это просто копирование из RAM.'],
      ['Сеть в ДЦ', 250e3, 'Запрос-ответ между серверами одного дата-центра: 0,1–0,5 мс. Столько стоит каждый запрос к Redis или базе — тысячи промахов кэша.'],
      ['HDD', 8e6, 'Подвести головку и дождаться нужного сектора: 5–10 мс.'],
      ['Москва — Нью-Йорк', 120e6, 'Время прохождения туда и обратно по оптоволокну. Свет быстрее не станет.'],
    ];
    const MODES = [['ns', 'Время'], ['cyc', 'Такты'], ['human', 'Такт = 1 секунда']];
    let mode = 'human', sel = 4;
    const modeBtns = MODES.map(([k, n]) => h('button', { class: 'btn small', onclick: () => { mode = k; render(); } }, n));
    const list = h('div', { class: 'lt-list' });
    const detail = h('p', { class: 'log' });
    root.append(h('div', { class: 'controls' }, modeBtns), list, detail);
    const maxLog = Math.log10(L[L.length - 1][1] / L[0][1]);
    const human = s => {
      if (s < 60) return dec(s, 0) + ' с';
      if (s < 3600) return dec(s / 60, s < 600 ? 1 : 0).replace(/,0$/, '') + ' мин';
      if (s < 86400) return dec(s / 3600, 1).replace(/,0$/, '') + ' ч';
      const d = s / 86400;
      if (d < 60) { const v = d < 10 ? +d.toFixed(1) : Math.round(d); return dec(v, d < 10 ? 1 : 0).replace(/,0$/, '') + ' ' + plural(Math.round(v), ['день', 'дня', 'дней']); }
      if (d < 365) { const m = Math.round(d / 30.4); return m + ' ' + plural(m, ['месяц', 'месяца', 'месяцев']); }
      const y = Math.round(d / 365); return y + ' ' + plural(y, ['год', 'года', 'лет']);
    };
    const cycTxt = c => c < 1e6 ? fmt(c) : dec(c / 1e6, 0) + ' млн';
    function value(ns) {
      const cyc = Math.max(1, Math.round(ns * GHZ));
      if (mode === 'ns') return fmtTime(ns * 1e-9);
      if (mode === 'cyc') return cycTxt(cyc);
      return human(cyc);
    }
    function render() {
      modeBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      list.innerHTML = '';
      L.forEach(([name, ns], i) => {
        const w = 4 + 96 * Math.log10(ns / L[0][1]) / maxLog;
        list.append(h('button', { class: 'lt-row' + (i === sel ? ' sel' : '') + (i >= 5 ? ' io' : ''), onclick: () => { sel = i; render(); } },
          h('span', { class: 'lt-n' }, name),
          h('span', { class: 'lt-bar' }, h('i', { style: `width:${w}%` })),
          h('b', null, value(ns))));
      });
      const [name, ns, text] = L[sel];
      const ratio = ns / L[1][1];
      detail.innerHTML = `<b>${name}</b>: ${text}` + (sel > 1 ? ` В ${ratio < 1e4 ? fmt(ratio) : ratio < 1e6 ? fmt(ratio / 1e3) + ' тыс.' : fmt(ratio / 1e6) + ' млн'} раз дольше, чем L1.` : '');
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- matrix traversal on a tiny cache
  Deck.demo('matrix', root => {
    const N = 8;
    let order = 'rows', cap = 4, k, cache, cells, hits, misses, playing = false, acc = 0;
    const orderBtns = [['rows', 'По строкам'], ['cols', 'По столбцам']].map(([o, n]) => h('button', { class: 'btn small', onclick: () => { order = o; reset(true); } }, n));
    const capBtns = [4, 8].map(c => h('button', { class: 'btn small', onclick: () => { cap = c; reset(true); } }, `кэш: ${c} ${plural(c, ['линия', 'линии', 'линий'])}`));
    const playBtn = h('button', { class: 'btn primary', onclick: () => (playing ? pause() : play()) }, 'Пуск');
    const grid = h('div', { class: 'mx-grid' });
    const cacheEl = h('div', { class: 'mx-cache' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(
      h('div', { class: 'controls' }, orderBtns, capBtns),
      h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', onclick: () => { pause(); step(); } }, 'Шаг'), h('button', { class: 'btn', onclick: () => reset(false) }, 'Сброс')),
      h('div', { class: 'mx-wrap' }, grid, cacheEl),
      stats, logEl,
    );
    function reset(auto) {
      pause();
      k = 0; cache = []; cells = Array(N * N).fill(''); hits = 0; misses = 0;
      orderBtns.forEach((b, i) => b.classList.toggle('sel', ['rows', 'cols'][i] === order));
      capBtns.forEach((b, i) => b.classList.toggle('sel', [4, 8][i] === cap));
      say(`Кэш пуст. Каждая строка матрицы — 8 × 8 байт = одна линия. Кэш вмещает ${cap} ${plural(cap, ['линию', 'линии', 'линий'])} и вытесняет ту, что дольше всех не использовалась (LRU).`);
      render(-1);
      if (auto) play();
    }
    function step() {
      if (k >= N * N) { reset(false); return; }
      const i = order === 'rows' ? Math.floor(k / N) : k % N;
      const j = order === 'rows' ? k % N : Math.floor(k / N);
      const idx = i * N + j, line = i;
      const pos = cache.indexOf(line);
      if (pos >= 0) {
        cache.splice(pos, 1); cache.push(line); hits++; cells[idx] = 'hit';
        say(`m[${i}][${j}]: строка ${i} уже в кэше — попадание, ~4 такта.`, 'ok');
      } else {
        let ev = '';
        if (cache.length >= cap) ev = `, вытесняем строку ${cache.shift()} — её дольше всех не трогали`;
        cache.push(line); misses++; cells[idx] = 'miss';
        say(`m[${i}][${j}]: промах — грузим линию со строкой ${i} целиком (64 байта)${ev}.`, 'bad');
      }
      k++;
      render(idx);
      if (k === N * N) {
        const txt = order === 'rows' ? 'По строкам: один промах на линию, остальные 7 чтений — из кэша. Промахов 8 из 64.'
          : cap < N ? 'По столбцам: каждое чтение — новая строка, и пока дойдём до неё снова, она уже вытеснена. Промахов 64 из 64: из каждой загруженной линии использовали 8 байт из 64.'
          : 'По столбцам, но вся матрица влезла в кэш: после первого столбца всё попадания. Порядок обхода важен, когда данные больше кэша.';
        say(txt, misses > 8 ? 'warn' : 'ok');
      }
    }
    function render(cur) {
      grid.innerHTML = cells.map((c, i) => `<span class="mx-c ${c} ${i === cur ? 'cur' : ''} ${cache.includes(Math.floor(i / N)) ? 'in' : ''}"></span>`).join('');
      let html = '<span class="label">Кэш</span>';
      for (let s = 0; s < cap; s++) {
        const l = cache[s];
        html += l == null ? '<span class="mx-line empty">пусто</span>' : `<span class="mx-line ${s === cache.length - 1 && cur >= 0 ? 'new' : ''}">строка ${l}</span>`;
      }
      cacheEl.innerHTML = html;
      stats.innerHTML = `<div class="stat"><b>${k}</b><span>чтений из 64</span></div><div class="stat ${misses > 8 ? 'warn' : ''}"><b>${misses}</b><span>промахов</span></div>` +
        `<div class="stat"><b>${k ? Math.round((hits / k) * 100) : 0}%</b><span>попаданий</span></div>`;
    }
    const loop = rafLoop(dt => {
      acc += dt;
      if (acc < 0.16) return;
      acc = 0;
      step();
      if (k >= N * N) pause();
    });
    function play() { if (k >= N * N) reset(false); playing = true; playBtn.textContent = 'Пауза'; acc = 1; loop.start(); }
    function pause() { playing = false; playBtn.textContent = 'Пуск'; loop.stop(); }
    reset(false);
    return { stop: pause };
  });

  // ---------------------------------------------------------------- array vs list, hardware prefetcher
  Deck.demo('prefetch', root => {
    const LINES = 64, EL = 64, LAT = 100, GAP = 5, WORK = 1, DIST = 8;
    const r = rng(11);
    // Scattered nodes: a random permutation where the next node is never on the adjacent line.
    let scattered;
    do {
      scattered = [...Array(LINES).keys()];
      for (let i = LINES - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [scattered[i], scattered[j]] = [scattered[j], scattered[i]]; }
    } while (scattered.some((l, i) => i && Math.abs(l - scattered[i - 1]) === 1));
    const MODES = {
      array: { name: 'Массив int64', line: i => Math.floor(i / 8), text: '8 элементов в линии, линии подряд' },
      seq: { name: 'Список, узлы подряд', line: i => Math.floor(i / 4), text: 'узел 16 байт: значение + указатель, 4 узла в линии; узлы выделялись друг за другом' },
      rand: { name: 'Список, узлы вразброс', line: i => scattered[i], text: 'те же узлы после вставок, удалений и работы аллокатора: каждый в своей линии' },
    };
    let mode = 'array', sim, T = 0, playing = false, slow = false;
    const modeBtns = Object.entries(MODES).map(([k, m]) => h('button', { class: 'btn small', onclick: () => { mode = k; reset(true); } }, m.name));
    const slowIn = h('input', { type: 'checkbox' });
    slowIn.addEventListener('change', () => { slow = slowIn.checked; });
    const playBtn = h('button', { class: 'btn primary', onclick: () => (playing ? pause() : play()) }, 'Пуск');
    const map = h('div', { class: 'pf-map' });
    const bar = h('div', { class: 'pf-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, modeBtns),
      h('div', { class: 'controls' }, playBtn, h('label', { class: 'toggle' }, slowIn, h('span', null, 'в 10 раз медленнее'))),
      h('span', { class: 'label' }, 'Память: 64 линии по 64 байта (одна страница 4 КБ)'),
      map,
      h('p', { class: 'br-legend' }, h('i', { class: 'sw pf-own' }), 'данные структуры ', h('i', { class: 'sw pf-fly' }), 'линия в пути ', h('i', { class: 'sw pf-in' }), 'в кэше'),
      bar, stats, logEl,
    );

    function simulate() {
      const m = MODES[mode];
      const req = new Map(); // line → [requestTime, arrival]
      let last = -Infinity, t = 0, wait = 0, prevLine = -1, pf = 0;
      const request = (l, at, pre) => {
        if (req.has(l) || l < 0 || l >= LINES) return;
        const arr = Math.max(at + LAT, last + GAP);
        last = arr;
        req.set(l, [at, arr, pre]);
        if (pre) pf++;
      };
      const els = [];
      for (let i = 0; i < EL; i++) {
        const l = m.line(i);
        const t0 = t;
        if (l !== prevLine) {
          request(l, t, false);
          // Stream prefetcher: two adjacent lines in a row → fetch the next DIST lines ahead.
          if (prevLine >= 0 && l === prevLine + 1) for (let d = 1; d <= DIST; d++) request(l + d, t, true);
        }
        const ready = req.get(l)[1];
        if (ready > t) { wait += ready - t; t = ready; }
        els.push({ l, t0, start: t, end: t + WORK });
        t += WORK;
        prevLine = l;
      }
      return { req, els, total: t, wait, pf, own: new Set(Array.from({ length: EL }, (_, i) => m.line(i))) };
    }
    function reset(auto) {
      pause();
      modeBtns.forEach((b, i) => b.classList.toggle('sel', Object.keys(MODES)[i] === mode));
      sim = simulate();
      T = 0;
      logEl.innerHTML = `${MODES[mode].name}: ${MODES[mode].text}.`;
      logEl.className = 'log';
      render();
      if (auto) play();
    }
    function render() {
      const done = sim.els.filter(e => e.end <= T).length;
      const curEl = sim.els.find(e => e.end > T);
      let html = '';
      for (let l = 0; l < LINES; l++) {
        const q = sim.req.get(l);
        let cls = sim.own.has(l) ? 'own' : '';
        if (q && T >= q[0]) cls += T >= q[1] ? ' in' : ' fly';
        if (curEl && curEl.l === l && T > 0) cls += ' cur';
        html += `<i class="${cls}"></i>`;
      }
      map.innerHTML = html;
      const waited = sim.els.reduce((s, e) => s + Math.max(0, Math.min(T, e.start) - Math.min(T, e.t0)), 0);
      const worked = sim.els.reduce((s, e) => s + Math.max(0, Math.min(T, e.end) - Math.min(T, e.start)), 0);
      const full = sim.total;
      bar.innerHTML = `<span class="wait" style="width:${(waited / Math.max(full, 6500)) * 100}%"></span><span class="work" style="width:${(worked / Math.max(full, 6500)) * 100}%"></span>`;
      stats.innerHTML = `<div class="stat"><b>${fmtTime(Math.min(T, full) * 1e-9)}</b><span>прошло, ${done} из ${EL} элементов</span></div>` +
        `<div class="stat ${waited > worked * 3 ? 'warn' : ''}"><b>${waited + worked ? Math.round((waited / (waited + worked)) * 100) : 0}%</b><span>времени ядро ждёт память</span></div>` +
        `<div class="stat"><b>${done ? dec(Math.min(T, full) / done, Math.min(T, full) / done < 10 ? 1 : 0) : '—'}</b><span>нс на элемент</span></div>`;
      if (T >= full) {
        logEl.innerHTML = mode === 'array'
          ? `Первая линия — полные ${LAT} нс. Со второй префетчер видит поток и запрашивает по ${DIST} линий вперёд; дальше линии приходят раньше, чем нужны. ${dec(full / EL, 1)} нс на элемент — и меньше на длинном массиве. Лишние жёлтые линии за концом массива — цена угадывания.`
          : mode === 'seq'
            ? `Указатели ничего не испортили: узлы лежат подряд, и префетчер видит те же последовательные адреса. ${dec(full / EL, 1)} нс на элемент. Так бывает сразу после построения списка.`
            : `Каждый узел — промах: адрес следующего известен только после загрузки текущего, префетчеру не за что зацепиться, внеочередному исполнению — тоже. ${dec(full / EL, 0)} нс на элемент: в ${dec(full / simArray(), 0)} раз медленнее массива.`;
        logEl.className = 'log ' + (mode === 'rand' ? 'warn' : 'ok');
      }
    }
    let arrayTotal = 0;
    function simArray() {
      if (!arrayTotal) { const save = mode; mode = 'array'; arrayTotal = simulate().total; mode = save; }
      return arrayTotal;
    }
    const loop = rafLoop(dt => {
      T += dt * 1000 * (slow ? 0.1 : 1);
      if (T >= sim.total) { T = sim.total; pause(); }
      render();
    });
    function play() { if (T >= sim.total) T = 0; playing = true; playBtn.textContent = 'Пауза'; loop.start(); }
    function pause() { playing = false; playBtn.textContent = 'Пуск'; loop.stop(); }
    reset(false);
    return { stop: pause };
  });

  // ---------------------------------------------------------------- false sharing / MESI
  Deck.demo('falseshare', root => {
    const XFER = 50, HOLD = 3, SPEED = 100; // ns per line transfer, writes per ownership, sim ns per real second
    const MODES = {
      same: { name: 'Пишут, одна линия' },
      pad: { name: 'Пишут, разные линии' },
      read: { name: 'Только читают' },
    };
    let mode = 'same', t, a, b, owner, xferUntil, held, xfers, acc = 0, playing = false;
    const modeBtns = Object.entries(MODES).map(([k, m]) => h('button', { class: 'btn small', onclick: () => { mode = k; reset(); play(); } }, m.name));
    const playBtn = h('button', { class: 'btn primary', onclick: () => (playing ? pause() : play()) }, 'Пуск');
    const view = h('div', { class: 'fs-view' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(h('div', { class: 'controls' }, modeBtns), h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', onclick: () => { reset(); } }, 'Сброс')), view, stats, logEl);

    function reset() {
      t = 0; a = 0; b = 0; owner = 0; xferUntil = -1; held = 0; xfers = 0;
      modeBtns.forEach((x, i) => x.classList.toggle('sel', Object.keys(MODES)[i] === mode));
      logEl.innerHTML = mode === 'same' ? 'Ядро 0 увеличивает <code>a</code>, ядро 1 — <code>b</code>. Переменные разные, но лежат в одной 64-байтной линии.'
        : mode === 'pad' ? 'Между <code>a</code> и <code>b</code> 56 байт пустоты: каждая переменная в своей линии.'
        : 'Оба ядра только читают <code>a</code> и <code>b</code> из одной линии.';
      logEl.className = 'log';
      render();
    }
    // One simulated nanosecond.
    function tick() {
      t++;
      if (mode === 'pad' || mode === 'read') { a++; b++; return; }
      if (t < xferUntil) return; // both cores wait: the line is on its way
      if (xferUntil >= 0 && t === xferUntil) { owner = 1 - owner; held = 0; xferUntil = -1; }
      if (owner === 0) a++; else b++;
      held++;
      // The other core's request for ownership (RFO) has been waiting; after a few stores the line leaves.
      if (held >= HOLD) { xferUntil = t + XFER; xfers++; }
    }
    function render() {
      const moving = mode === 'same' && xferUntil > t;
      const st = core => {
        if (mode === 'pad') return 'M';
        if (mode === 'read') return 'S';
        if (moving) return 'I';
        return owner === core ? 'M' : 'I';
      };
      const line = (core, vars, state) => `<div class="fs-line s${state}"><span class="fs-st">${state}</span>${
        Array.from({ length: 8 }, (_, i) => `<i class="${vars[i] || ''}">${vars[i] || ''}</i>`).join('')}</div>`;
      const core = c => {
        const s = st(c);
        const lines = mode === 'pad' ? line(c, c === 0 ? ['a'] : ['b'], 'M') : line(c, ['a', 'b'], s);
        return `<div class="fs-core ${moving && owner !== c ? 'wait' : ''}"><b>Ядро ${c}</b><span class="label">${mode === 'read' ? 'читает' : 'пишет'} ${c ? 'b' : 'a'}</span>${lines}<span class="fs-n">${c ? 'b' : 'a'} = ${fmt(c ? b : a)}</span></div>`;
      };
      const progress = moving ? 1 - (xferUntil - t) / XFER : 0;
      view.innerHTML = core(0) + `<div class="fs-bus ${moving ? 'on' : ''}"><span class="label">L3 / межъядерная сеть</span><i style="left:${owner === 0 ? progress * 100 : (1 - progress) * 100}%"></i></div>` + core(1);
      const ops = a + b;
      stats.innerHTML = `<div class="stat"><b>${t ? fmt((ops / t) * 1000) : 0}</b><span>операций за мкс</span></div>` +
        `<div class="stat ${xfers ? 'warn' : ''}"><b>${fmt(xfers)}</b><span>передач линии между ядрами</span></div>` +
        `<div class="stat"><b>${fmt(t)} нс</b><span>прошло (замедлено в ${fmt(1e9 / SPEED / 1e6)} млн раз)</span></div>`;
      if (t > 300) {
        if (mode === 'same') { logEl.innerHTML = `Линия ездит туда-обратно: чтобы записать, ядро должно владеть ею в состоянии M, а копию у соседа — аннулировать (I). ~${XFER} нс на передачу, и в это время оба ядра стоят. В ${Math.round(2000 / ((ops / t) * 1000))} раз медленнее, чем с разными линиями.`; logEl.className = 'log bad'; }
        else if (mode === 'pad') { logEl.innerHTML = 'Каждое ядро держит свою линию в состоянии M (изменена, только у меня) и пишет в L1 без всякой связи с соседом.'; logEl.className = 'log ok'; }
        else { logEl.innerHTML = 'Копии линии в состоянии S (общая) лежат в обоих L1 одновременно. Чтение общих данных масштабируется по ядрам — проблема только в записи.'; logEl.className = 'log ok'; }
      }
    }
    const loop = rafLoop(dt => {
      acc += dt * SPEED;
      while (acc >= 1) { acc -= 1; tick(); }
      render();
    });
    function play() { playing = true; playBtn.textContent = 'Пауза'; loop.start(); }
    function pause() { playing = false; playBtn.textContent = 'Пуск'; loop.stop(); }
    reset();
    return { stop: pause };
  });

  // ---------------------------------------------------------------- Python loop vs numpy
  Deck.demo('pyoverhead', root => {
    // [label, fixed cost s, per element s, bytes per element]
    const npPer = n => (n * 8 <= 1 << 20 ? 0.15e-9 : n * 8 <= 32 << 20 ? 0.3e-9 : 0.5e-9);
    const M = [
      ['for x in a: s += x', () => 50e-9, () => 20e-9, 32],
      ['sum(a)', () => 60e-9, () => 3e-9, 32],
      ['np.sum(a)', () => 2e-6, npPer, 8],
      ['цикл на Go / C', () => 0, () => 1e-9, 8],
    ];
    const slider = h('input', { type: 'range', min: 0, max: 14, value: 6, 'aria-label': 'Размер массива' });
    const out = h('output');
    const bars = h('div', { class: 'py-bars' });
    const mem = h('div', { class: 'py-mem' });
    const logEl = h('p', { class: 'log' });
    slider.addEventListener('input', update);
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Элементов'), slider, out), bars, mem, logEl);
    const nOf = () => Math.round(10 ** (1 + +slider.value / 2));
    const lo = Math.log10(10e-9), hi = Math.log10(10);
    const human = n => n >= 1e6 ? dec(n / 1e6, 0) + ' млн' : n >= 1e3 ? dec(n / 1e3, 0) + ' тыс.' : String(n);
    const bytes = b => b >= 1e9 ? dec(b / 1e9, 1) + ' ГБ' : b >= 1e6 ? dec(b / 1e6, b < 1e7 ? 1 : 0) + ' МБ' : b >= 1e3 ? dec(b / 1e3, 0) + ' КБ' : b + ' Б';
    function update() {
      const n = nOf();
      out.textContent = human(n);
      const times = M.map(([, f, p]) => f(n) + p(n) * n);
      const best = Math.min(...times);
      bars.innerHTML = M.map(([label], i) => {
        const t = times[i];
        const w = Math.max(2, ((Math.log10(t) - lo) / (hi - lo)) * 100);
        return `<div class="py-row ${t === best ? 'best' : ''}"><code>${label}</code><span class="py-track"><i style="width:${w}%"></i></span><b>${fmtTime(t)}</b></div>`;
      }).join('');
      mem.innerHTML = `<span>список Python: <b>${bytes(n * 32)}</b> — указатель 8 Б + объект float 24 Б</span><span>numpy float64: <b>${bytes(n * 8)}</b></span>`;
      const [py, , np] = times;
      let txt;
      if (np > py) txt = `На ${human(n)} элементах numpy проигрывает: ~2 мкс на вызов (разбор аргументов, создание результата) дороже всего цикла Python. Маленькие массивы — обычным кодом.`;
      else if (n < 1e5) txt = `Здесь numpy быстрее в ${fmt(py / np)} раз: накладные расходы на вызов уже окупились. Каждая итерация Python — ~20 нс, numpy — доли наносекунды на элемент.`;
      else txt = `numpy быстрее цикла Python в ${fmt(py / np)} раз и даже простого цикла на Go/C: внутри — SIMD и несколько аккумуляторов, а наивный цикл упирается в задержку сложения. ${n * 8 > 32 << 20 ? 'Массив уже больше L3 — numpy ждёт память, а не считает.' : ''}`;
      logEl.innerHTML = txt;
      logEl.className = 'log ' + (np > py ? 'warn' : 'ok');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- AoS vs SoA vs references
  Deck.demo('soa', root => {
    const F = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'm', 'id'];
    const P = 16;
    const TASKS = { x: ['сумма x', ['x']], upd: ['x += vx', ['x', 'vx']], all: ['все поля', F] };
    const LAYOUTS = { aos: 'Массив структур', soa: 'Структура массивов', refs: 'Массив ссылок (Java, Python)' };
    let layout = 'aos', task = 'x';
    const r = rng(5);
    // Heap for the "references" layout: objects (16-byte header + 64 bytes of fields) mixed with other objects.
    const heap = (() => {
      const lines = [];
      for (let p = 0; p < P; p++) {
        if (r() < 0.45) lines.push(Array(8).fill('junk'));
        const off = 2 * Math.floor(r() * 4); // 0, 16, 32, 48 bytes into a line
        const cells = Array(off).fill('junk').concat(['hdr', 'hdr'], F);
        while (cells.length % 8) cells.push('junk');
        for (let i = 0; i < cells.length; i += 8) lines.push(cells.slice(i, i + 8));
      }
      return { lines };
    })();
    const layBtns = Object.entries(LAYOUTS).map(([k, n]) => h('button', { class: 'btn small', onclick: () => { layout = k; render(); } }, n));
    const taskBtns = Object.entries(TASKS).map(([k, [n]]) => h('button', { class: 'btn small', onclick: () => { task = k; render(); } }, n));
    const map = h('div', { class: 'so-map' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, layBtns),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Цикл'), taskBtns),
      h('p', { class: 'so-legend' }, F.map(f => h('span', { class: 'so-k f-' + f }, f)), h('span', { class: 'so-k f-ref' }, 'ссылка'), h('span', { class: 'so-k f-hdr' }, 'заголовок'), h('span', { class: 'so-k f-junk' }, 'чужое')),
      map, stats, logEl,
    );
    function build() {
      if (layout === 'aos') return Array.from({ length: P }, () => [...F]);
      if (layout === 'soa') return F.flatMap(f => [Array(8).fill(f), Array(8).fill(f)]);
      return [Array(8).fill('ref'), Array(8).fill('ref'), ...heap.lines];
    }
    function render() {
      layBtns.forEach((b, i) => b.classList.toggle('sel', Object.keys(LAYOUTS)[i] === layout));
      taskBtns.forEach((b, i) => b.classList.toggle('sel', Object.keys(TASKS)[i] === task));
      const need = TASKS[task][1];
      const lines = build();
      let touched = 0, used = 0;
      map.innerHTML = lines.map(cells => {
        const useCell = c => need.includes(c) || c === 'ref';
        const hit = cells.some(useCell);
        if (hit) { touched++; used += cells.filter(useCell).length * 8; }
        return `<span class="so-line ${hit ? 'hit' : ''}">${cells.map(c => `<i class="f-${c} ${useCell(c) ? 'use' : ''}"></i>`).join('')}</span>`;
      }).join('');
      const pct = used / (touched * 64);
      stats.innerHTML = `<div class="stat"><b>${touched}</b><span>${plural(touched, ['линия загружена', 'линии загружены', 'линий загружено'])}</span></div>` +
        `<div class="stat"><b>${fmt(touched * 64)} Б</b><span>прочитано из памяти</span></div>` +
        `<div class="stat ${pct < 0.5 ? 'warn' : ''}"><b>${Math.round(pct * 100)}%</b><span>полезных байт</span></div>`;
      const fields = need.length;
      logEl.innerHTML = layout === 'aos'
        ? (fields === 8 ? 'Когда нужны все поля, массив структур идеален: одна частица — одна линия, всё полезно.' : `Каждая частица занимает свою линию, а нужно из неё ${fields * 8} байт из 64. Остальное процессор тянет из памяти зря — и вытесняет из кэша полезное.`)
        : layout === 'soa'
          ? (fields === 8 ? 'Все поля нужны — SoA читает то же количество линий, просто из восьми потоков. Префетчер справляется с несколькими потоками сразу.' : `Нужные поля лежат подряд в своих массивах: ${touched} ${plural(touched, ['линия', 'линии', 'линий'])} вместо 16, все байты полезны. И такой цикл векторизуется.`)
          : `Сначала массив ссылок, потом переход по каждой ссылке в кучу. Объекты разбросаны среди чужих, у каждого 16 байт заголовка. В Python ещё хуже: каждое поле-число — отдельный объект где-то в куче.`;
      logEl.className = 'log ' + (pct < 0.5 ? 'warn' : 'ok');
    }
    render();
    return {};
  });
})();
