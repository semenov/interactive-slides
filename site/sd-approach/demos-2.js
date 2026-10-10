// Demos for slides 11–18: percentiles, fan-out, Little's law, queueing, step-by-step design, idempotency.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { dec, num, dur, pct, logger, listSlider } = window.SD;

  // Seeded RNG so a demo shows the same picture every time.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const expo = (r, mean) => -Math.log(1 - r()) * mean;
  const quant = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  const ms = v => (v < 10 ? dec(v, 1) : Math.round(v)) + ' мс';

  // ---------------------------------------------------------------- percentiles
  Deck.demo('percentiles', root => {
    const N = 5000, LO = Math.log(4), HI = Math.log(700), BINS = 44;
    const r = rng(7);
    const base = [], u = [];
    for (let i = 0; i < N; i++) {
      const z = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
      base.push(20 * Math.exp(0.32 * z));
      u.push([r(), r(), r(), r()]);
    }
    let gc = false, miss = false;
    const bGc = h('button', { class: 'btn small', onclick: () => { gc = !gc; bGc.classList.toggle('sel', gc); update('gc'); } }, 'Паузы GC у 1%');
    const bMiss = h('button', { class: 'btn small', onclick: () => { miss = !miss; bMiss.classList.toggle('sel', miss); update('miss'); } }, 'Промахи кэша у 8%');
    const chart = h('div', { class: 'pc-chart' });
    const bars = h('div', { class: 'pc-bars' });
    const marks = h('div', { class: 'pc-marks' });
    const axis = h('div', { class: 'pc-axis' });
    chart.append(bars, marks, axis);
    for (const t of [5, 10, 20, 50, 100, 200, 500]) axis.append(h('span', { style: `left:${xpos(t)}%` }, String(t)));
    axis.append(h('span', { class: 'unit', style: 'left:100%' }, 'мс'));
    const stats = h('div', { class: 'stats pc-stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, bGc, bMiss), chart, stats, logEl);
    function xpos(v) { return Math.max(0, Math.min(100, (Math.log(v) - LO) / (HI - LO) * 100)); }

    function sample(withGc, withMiss) {
      return base.map((b, i) => {
        let v = b;
        if (withMiss && u[i][0] < 0.08) v += 40 + 40 * u[i][1];
        if (withGc && u[i][2] < 0.01) v += 150 + 150 * u[i][3];
        return v;
      });
    }
    function summary(xs) {
      const s = Float64Array.from(xs).sort();
      return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: quant(s, 0.5), p95: quant(s, 0.95), p99: quant(s, 0.99), p999: quant(s, 0.999) };
    }
    const BASE = summary(sample(false, false));
    const KEYS = [['mean', 'среднее'], ['p50', 'p50'], ['p95', 'p95'], ['p99', 'p99'], ['p999', 'p99,9']];

    function update(what) {
      const xs = sample(gc, miss);
      const st = summary(xs);
      const cnt = new Array(BINS).fill(0);
      xs.forEach(v => { cnt[Math.max(0, Math.min(BINS - 1, Math.floor((Math.log(v) - LO) / (HI - LO) * BINS)))]++; });
      const max = Math.max(...cnt);
      bars.innerHTML = cnt.map((c, i) => {
        const mid = Math.exp(LO + (i + 0.5) / BINS * (HI - LO));
        const cls = mid > st.p99 ? 'tail' : '';
        return `<i class="${cls}" style="height:${c ? Math.max(3, c / max * 100) : 0}%"></i>`;
      }).join('');
      marks.innerHTML = KEYS.map(([k]) => `<i class="m-${k}" style="left:${xpos(st[k])}%"></i>`).join('');
      stats.innerHTML = KEYS.map(([k, l]) => `<div class="stat m-${k}"><b>${ms(st[k])}</b><span>${l}</span></div>`).join('');
      const d = (k) => `${ms(BASE[k])} → ${ms(st[k])}`;
      if (!what) logEl.innerHTML = 'Обычный сервис: медиана 20 мс, распределение с хвостом вправо. Шкала логарифмическая; красным — запросы медленнее p99.';
      else if (!gc && !miss) logEl.innerHTML = 'Без пауз и промахов: среднее и p50 почти совпадают, хвост короткий.';
      else logEl.innerHTML = `${gc && miss ? 'Паузы GC и промахи кэша' : gc ? 'Паузы GC у 1% запросов' : 'Промахи кэша у 8% запросов'}: среднее ${d('mean')}, а p99 ${d('p99')}.` +
        (gc ? ' По среднему всё в порядке — по p99 сервис в несколько раз медленнее.' : ' Хвост вырос, а медиана почти не изменилась.');
      logEl.className = 'log' + (st.p99 > 3 * BASE.p99 ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- fan-out tail amplification
  Deck.demo('fanout', root => {
    const P = [['p95', 0.05], ['p99', 0.01], ['p99,9', 0.001]];
    let p = 0.01, hedge = false, runs = 0, slowRuns = 0;
    const r = rng(42);
    const grid = h('div', { class: 'fo-grid' });
    const sl = h('div');
    const n = listSlider(sl, 'Вызовов', [1, 2, 5, 10, 20, 50, 100, 200], 5, String, () => reset('n'));
    const pBtns = h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Медленный вызов — хуже'));
    const pb = P.map(([l, v]) => {
      const b = h('button', { class: 'btn small' + (v === p ? ' sel' : ''), onclick: () => { p = v; pb.forEach(x => x.classList.toggle('sel', x === b)); reset('p'); } }, l);
      pBtns.append(b);
      return b;
    });
    const hcb = h('input', { type: 'checkbox' });
    hcb.addEventListener('change', () => { hedge = hcb.checked; reset('hedge'); });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(sl, pBtns, h('label', { class: 'toggle' }, hcb, 'Хеджированные запросы (копия после p95)'),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => run(1) }, 'Запрос'),
        h('button', { class: 'btn', onclick: () => run(1000) }, '1000 запросов')),
      grid, stats, logEl);

    const pCall = () => (hedge ? p * p : p);
    const theory = () => 1 - Math.pow(1 - pCall(), n.get());
    function drawGrid(slow) {
      const N = n.get();
      grid.style.setProperty('--cols', Math.min(N, N > 50 ? 20 : 10));
      grid.style.width = Math.min(N, N > 50 ? 20 : 10) * 26 + 'px';
      grid.innerHTML = Array.from({ length: N }, (_, i) => `<i class="${slow && slow[i] ? 'slow' : ''}"></i>`).join('');
    }
    function drawStats() {
      stats.innerHTML = `<div class="stat"><b>${pct(pCall(), pCall() < 0.001 ? 4 : pCall() < 0.01 ? 2 : 1)}</b><span>медленный вызов</span></div>` +
        `<div class="stat${theory() > 0.2 ? ' warn' : ''}"><b>${pct(theory(), 1)}</b><span>медленных страниц, теория</span></div>` +
        `<div class="stat"><b>${runs ? pct(slowRuns / runs, 1) : '—'}</b><span>на опыте, ${num(runs)} ${plural(runs, ['запрос', 'запроса', 'запросов'])}</span></div>`;
    }
    function reset(what) {
      runs = slowRuns = 0;
      drawGrid(null);
      drawStats();
      const N = n.get();
      logEl.innerHTML = `${N} ${plural(N, ['вызов', 'вызова', 'вызовов'])}, каждый медленный с вероятностью ${pct(pCall(), pCall() < 0.01 ? 2 : 0)}: страница медленная в ${pct(theory(), 1)} случаев.` +
        (what === 'hedge' && hedge ? ' Копия уходит на другую реплику, если первая не ответила за p95: медленными остаются вызовы, где не повезло обеим, ≈ p². Цена — ~5% лишних запросов.' : '');
      logEl.className = 'log' + (theory() > 0.2 ? ' warn' : '');
    }
    function run(k) {
      const N = n.get(), q = pCall();
      let last = null, slowCalls = 0;
      for (let j = 0; j < k; j++) {
        const slow = Array.from({ length: N }, () => r() < q);
        const any = slow.some(Boolean);
        runs++;
        if (any) slowRuns++;
        last = slow;
        slowCalls = slow.filter(Boolean).length;
      }
      drawGrid(last);
      drawStats();
      if (k === 1) logEl.innerHTML = slowCalls ? `Медленных вызовов: ${slowCalls} из ${N} — и весь ответ ждёт самого медленного.` : `Все ${N} ${plural(N, ['вызов', 'вызова', 'вызовов'])} быстрые — повезло.`;
      else logEl.innerHTML = `Из ${num(runs)} запросов медленных ${pct(slowRuns / runs, 1)}, теория — ${pct(theory(), 1)}.`;
      logEl.className = 'log' + (slowCalls && k === 1 ? ' warn' : '');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- Little's law and a connection pool
  Deck.demo('little', root => {
    const sl = h('div', { class: 'est-sl' });
    const lam = listSlider(sl, 'Поток λ, запросов/с', [100, 200, 500, 1000, 2000, 3000, 5000, 10000], 4, num, () => update());
    const w = listSlider(sl, 'Запрос к базе W', [1, 2, 5, 10, 20, 50, 100, 200], 2, v => v + ' мс', () => update('w'));
    const pool = listSlider(sl, 'Соединений в пуле', [5, 10, 20, 50, 100], 2, String, () => update());
    const slots = h('div', { class: 'lt-slots' });
    const queue = h('div', { class: 'lt-queue' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    const slow = h('button', { class: 'btn small', onclick: () => { w.set(w.get() === 50 ? 5 : 50); update('w'); } }, 'База: 5 ↔ 50 мс');
    root.append(sl, h('div', { class: 'controls' }, slow), h('span', { class: 'label' }, 'Пул соединений'), slots, queue, stats, logEl);
    function update(what) {
      const L = lam.get() * w.get() / 1000, P = pool.get();
      const cap = P / w.get() * 1000;
      const busy = Math.min(L, P);
      slots.innerHTML = Array.from({ length: P }, (_, i) => {
        const f = Math.max(0, Math.min(1, busy - i));
        return `<i style="--f:${f * 100}%"></i>`;
      }).join('');
      const over = lam.get() > cap;
      queue.innerHTML = over ? `<b>очередь растёт на ${num(lam.get() - cap)} запросов в секунду</b>` : '';
      stats.innerHTML = `<div class="stat"><b>${dec(L, L < 10 ? 1 : 0).replace(/,0$/, '')}</b><span>нужно соединений: λ·W</span></div>` +
        `<div class="stat${over ? ' warn' : ''}"><b>${num(cap)}/с</b><span>потолок пула: ${P} ÷ ${w.get()} мс</span></div>` +
        `<div class="stat${L / P > 0.8 ? ' warn' : ''}"><b>${pct(Math.min(L / P, 9.99), 0)}</b><span>загрузка пула</span></div>`;
      if (over) {
        logEl.innerHTML = `Нужно ${dec(L, 0)} соединений одновременно, а есть ${P}. Пул пропускает только ${num(cap)} запросов/с, остальные ждут соединения — ожидание растёт, пока клиенты не начнут отваливаться по таймауту и повторять запросы.` +
          (what === 'w' ? ' Трафик не изменился — замедлилась только база.' : '');
        logEl.className = 'log bad';
      } else if (L / P > 0.8) {
        logEl.innerHTML = `Влезает впритык: занято ${pct(L / P, 0)} пула. Любой всплеск — и запросы ждут соединения (почему — на следующем слайде).`;
        logEl.className = 'log warn';
      } else {
        logEl.innerHTML = `${num(lam.get())} запросов/с × ${w.get()} мс = в среднем ${dec(L, 1).replace(/,0$/, '')} занятых соединений из ${P}. Запас есть.`;
        logEl.className = 'log ok';
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- M/M/1 queue
  Deck.demo('queue', root => {
    const S = 10; // ms, mean service time
    const input = h('input', { type: 'range', min: 10, max: 99, value: 50, 'aria-label': 'Загрузка' });
    const out = h('output');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 320 150');
    svg.setAttribute('class', 'qu-chart');
    const X = rho => 34 + rho * 276, Y = t => 128 - Math.min(t, 20) / 20 * 116;
    let path = '';
    for (let i = 0; i <= 200; i++) { const rho = i / 200 * 0.95; path += (i ? 'L' : 'M') + X(rho).toFixed(1) + ' ' + Y(1 / (1 - rho)).toFixed(1); }
    svg.innerHTML = `
      <g class="qu-grid">${[1, 5, 10, 15, 20].map(t => `<line x1="34" x2="310" y1="${Y(t)}" y2="${Y(t)}"/><text x="28" y="${Y(t) + 4}" text-anchor="end">${t}×</text>`).join('')}
      ${[0, 0.5, 0.7, 0.9].map(rho => `<text x="${X(rho)}" y="145" text-anchor="middle">${Math.round(rho * 100)}%</text>`).join('')}</g>
      <rect class="qu-safe" x="${X(0.5)}" y="12" width="${X(0.7) - X(0.5)}" height="116"/>
      <path class="qu-curve" d="${path}"/>
      <line class="qu-v" x1="0" x2="0" y1="12" y2="128"/>
      <circle class="qu-pt" r="5"/>`;
    const vline = svg.querySelector('.qu-v'), pt = svg.querySelector('.qu-pt');
    const live = h('div', { class: 'qu-live' });
    const qEl = h('div', { class: 'qu-q' });
    const srv = h('div', { class: 'qu-srv' }, h('span', null, 'сервер'), h('i'));
    const srvFill = srv.querySelector('i');
    live.append(qEl, srv);
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Загрузка ρ'), input, out), svg,
      h('span', { class: 'label' }, 'Очередь вживую (замедлено)'), live, stats, logEl);

    // Exact statistics: Lindley recursion over 200k requests.
    function simulate(rho) {
      const r = rng(1234 + Math.round(rho * 100)), n = 1000000, lam = rho / S;
      const resp = new Float64Array(n);
      let wait = 0;
      for (let i = 0; i < n; i++) {
        const s = expo(r, S);
        resp[i] = wait + s;
        wait = Math.max(0, wait + s - expo(r, 1 / lam));
      }
      const mean = resp.reduce((a, b) => a + b, 0) / n;
      resp.sort();
      return { mean, p99: quant(resp, 0.99) };
    }

    // Live animation in slow motion: mean service 0.3 s.
    const SV = 0.3, vr = rng(99);
    let rho = 0.5, q = 0, busy = 0, left = 0, nextArr = 0, maxQ = 0;
    const loop = rafLoop(dt => {
      nextArr -= dt;
      while (nextArr <= 0) { q++; nextArr += expo(vr, SV / rho); }
      if (busy) { left -= dt; if (left <= 0) busy = 0; }
      if (!busy && q > 0) { q--; busy = 1; left = expo(vr, SV); }
      maxQ = Math.max(maxQ, q);
      drawLive();
    });
    let lastQ = -1, lastMax = -1;
    function drawLive() {
      srvFill.style.width = busy ? '100%' : '0';
      if (q === lastQ && maxQ === lastMax) return;
      lastQ = q; lastMax = maxQ;
      const show = Math.min(q, 24);
      qEl.innerHTML = Array.from({ length: show }, () => '<i></i>').join('') + (q > show ? `<span>+${q - show}</span>` : '') +
        `<em>в очереди ${q}, максимум ${maxQ}</em>`;
    }

    function update() {
      rho = +input.value / 100;
      out.textContent = input.value + '%';
      maxQ = q;
      const T = S / (1 - rho);
      vline.setAttribute('x1', X(rho)); vline.setAttribute('x2', X(rho));
      pt.setAttribute('cx', X(rho)); pt.setAttribute('cy', Y(T / S));
      clearTimeout(simTimer);
      simTimer = setTimeout(() => showStats(rho, T), 120);
      const k = 1 / (1 - rho);
      logEl.innerHTML = `Обработка — ${S} мс, но при загрузке ${input.value}% запрос в среднем ждёт ещё ${ms(T - S)} в очереди: ответ — ${dec(k, k < 10 ? 1 : 0).replace(/,0$/, '')}× от времени обработки.` +
        (rho >= 0.9 ? ' Небольшой рост трафика здесь даёт огромный рост задержки.' : rho <= 0.7 ? ' Зона, где держат загрузку в продакшене.' : '');
      logEl.className = 'log' + (rho >= 0.9 ? ' bad' : rho > 0.7 ? ' warn' : ' ok');
    }
    let simTimer = 0;
    function showStats(rho, T) {
      const sim = simulate(rho);
      stats.innerHTML = `<div class="stat"><b>${ms(T)}</b><span>среднее, формула</span></div>` +
        `<div class="stat"><b>${ms(sim.mean)}</b><span>среднее, симуляция 1 млн</span></div>` +
        `<div class="stat${sim.p99 > 20 * S ? ' warn' : ''}"><b>${ms(sim.p99)}</b><span>p99, симуляция</span></div>`;
    }
    input.addEventListener('input', update);
    update();
    showStats(rho, S / (1 - rho));
    drawLive();
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- URL shortener, step by step
  Deck.demo('design', root => {
    const NODES = {
      client: ['клиент', 6, 122, 62, 40, 0],
      cdn: ['CDN', 6, 26, 62, 36, 5],
      lb: ['LB', 92, 122, 50, 40, 1],
      app: ['сервис', 170, 116, 86, 52, 0],
      redis: ['Redis', 290, 26, 112, 36, 2],
      pg: ['Postgres', 290, 122, 112, 40, 0],
      rep: ['реплики', 290, 194, 112, 34, 3],
      ids: ['счётчик ID', 86, 196, 82, 34, 4],
      kafka: ['Kafka', 170, 254, 86, 34, 6],
      ch: ['ClickHouse', 290, 254, 112, 34, 6],
    };
    // [from, to, firstStep, lastStep, dashed]
    const EDGES = [
      ['client', 'app', 0, 0], ['client', 'lb', 1, 4], ['lb', 'app', 1, 9],
      ['app', 'pg', 0, 9], ['app', 'redis', 2, 9], ['pg', 'rep', 3, 9, true], ['app', 'ids', 4, 9],
      ['client', 'cdn', 5, 9], ['cdn', 'lb', 5, 9], ['app', 'kafka', 6, 9, true], ['kafka', 'ch', 6, 9, true],
    ];
    const STEPS = [
      'Простейшая рабочая схема: <code>POST /links</code> пишет пару код → URL в Postgres, <code>GET /{code}</code> читает её и отвечает 302. Дальше каждое усложнение должно опираться на требование или число.',
      'В пике ~35 тыс. чтений/с, а один экземпляр сервиса держит несколько тысяч. Сервис без состояния — ставим N копий за балансировщиком в двух-трёх зонах.',
      'Чтений в 100 раз больше записей, популярность ссылок очень неравномерна. Redis перед базой: при 95% попаданий до Postgres доходит меньше 2 тыс. запросов/с. Компромисс — кэш нужно наполнять и инвалидировать.',
      'Для 99,99% нужен автоматический фейловер: реплики в других зонах, Patroni переключает primary за ~30 с. Асинхронная реплика отстаёт, поэтому только что созданную ссылку читаем с primary.',
      'Уникальные коды без координации на каждом запросе: сервис берёт у счётчика диапазон из 1000 ID и кодирует их в base62. Альтернатива — случайный код и повтор при конфликте уникального ключа.',
      'Пользователи по всему миру: CDN отвечает из ближайшей точки. 301 кэшируется браузером навсегда — меньше нагрузки, но переходы мимо нас не посчитать. 302 с коротким TTL в CDN — компромисс.',
      'Статистика: сервис пишет событие клика в Kafka и сразу отвечает, ClickHouse считает агрегаты. Основная база не получает запись на каждый переход.',
      'Узкие места при ×10: горячая ссылка упирается в один узел Redis — добавить маленький локальный кэш в сервисе; 18 ТБ за 10 лет — шардировать Postgres по коду. Подробнее — <a href="/sd-scaling/">в следующей части</a>.',
    ];
    const HOT = { 7: ['redis', 'pg'] };
    const NEW_EDGE = { 1: 'lb', 2: 'redis', 3: 'rep', 4: 'ids', 5: 'cdn', 6: 'kafka' };
    let step = 0;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 408 294');
    svg.setAttribute('class', 'ds-svg');
    const counter = h('span', { class: 'label ds-count' });
    const prev = h('button', { class: 'btn', onclick: () => go(step - 1) }, '← Назад');
    const next = h('button', { class: 'btn primary', onclick: () => go(step + 1) }, 'Дальше →');
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'controls' }, prev, next, h('button', { class: 'btn', onclick: () => go(0) }, 'Сначала'), counter), svg, logEl);

    function anchor(a, b) {
      // Point on the border of box a, in the direction of box b's centre.
      const [, ax, ay, aw, ah] = NODES[a], [, bx, by, bw, bh] = NODES[b];
      const cx = ax + aw / 2, cy = ay + ah / 2, dx = bx + bw / 2 - cx, dy = by + bh / 2 - cy;
      const k = Math.min(Math.abs((aw / 2 + 3) / (dx || 1e-9)), Math.abs((ah / 2 + 3) / (dy || 1e-9)));
      return [cx + dx * k, cy + dy * k];
    }
    function go(s) {
      step = Math.max(0, Math.min(STEPS.length - 1, s));
      const hot = HOT[step] || [];
      let html = '<defs><marker id="ds-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#13293d"/></marker></defs>';
      for (const [a, b, s0, s1, dashed] of EDGES) {
        if (step < s0 || step > s1 || step < NODES[a][5] || step < NODES[b][5]) continue;
        const [x1, y1] = anchor(a, b), [x2, y2] = anchor(b, a);
        html += `<line class="ds-edge${dashed ? ' dash' : ''}${s0 === step && step ? ' new' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ds-arr)"/>`;
      }
      for (const [id, [label, x, y, w, hh, s0]] of Object.entries(NODES)) {
        if (step < s0) continue;
        const cls = 'ds-node' + (id === 'pg' || id === 'rep' || id === 'redis' || id === 'ch' ? ' store' : '') + (s0 === step && step ? ' new' : '') + (hot.includes(id) ? ' hot' : '');
        const many = id === 'app' && step >= 1;
        html += `<g class="${cls}">` + (many ? `<rect x="${x + 6}" y="${y - 6}" width="${w}" height="${hh}" rx="7"/><rect x="${x + 3}" y="${y - 3}" width="${w}" height="${hh}" rx="7"/>` : '') +
          `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="7"/><text x="${x + w / 2}" y="${y + hh / 2 + 5}" text-anchor="middle">${id === 'pg' && step >= 7 ? 'шарды Postgres' : label}${many ? ' ×N' : ''}</text></g>`;
      }
      if (step >= 3) html += `<text class="ds-cap" x="340" y="183" text-anchor="end">репликация</text>`;
      if (step >= 7) html += `<text class="ds-cap hot" x="346" y="20" text-anchor="middle">горячий ключ</text>`;
      svg.innerHTML = html;
      counter.textContent = `Шаг ${step + 1} из ${STEPS.length}`;
      prev.disabled = step === 0;
      next.disabled = step === STEPS.length - 1;
      logEl.innerHTML = STEPS[step];
      logEl.className = 'log' + (step === 7 ? ' warn' : '');
    }
    go(0);
    return {};
  });

  // ---------------------------------------------------------------- idempotency key
  Deck.demo('idem', root => {
    let useKey = true, lose = true, charged = 0, keys = [], timers = [], busy = false, seq = 0;
    const kcb = h('input', { type: 'checkbox', checked: true });
    kcb.addEventListener('change', () => { useKey = kcb.checked; });
    const lcb = h('input', { type: 'checkbox', checked: true });
    lcb.addEventListener('change', () => { lose = lcb.checked; });
    const pay = h('button', { class: 'btn primary', onclick: send }, 'Оплатить 1 000 ₽');
    const lanes = h('ol', { class: 'id-seq' });
    const card = h('div', { class: 'stats id-stats' });
    const logEl = h('p', { class: 'log', 'aria-live': 'polite' });
    root.append(
      h('label', { class: 'toggle' }, kcb, h('span', null, 'Клиент шлёт заголовок ', h('code', null, 'Idempotency-Key'))),
      h('label', { class: 'toggle' }, lcb, 'Ответ сервера теряется в сети'),
      h('div', { class: 'controls' }, pay, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      lanes, card, logEl);

    const line = (who, text, cls = '') => lanes.append(h('li', { class: cls }, h('b', null, who), h('span', { html: text })));
    function draw() {
      card.innerHTML = `<div class="stat${charged > 1000 * seq ? ' warn' : ''}"><b>${(charged).toLocaleString('ru-RU')} ₽</b><span>списано с карты</span></div>` +
        `<div class="stat"><b>${seq}</b><span>${plural(seq, ['покупка', 'покупки', 'покупок'])} на самом деле</span></div>` +
        `<div class="stat"><b>${keys.length}</b><span>${plural(keys.length, ['ключ', 'ключа', 'ключей'])} в таблице</span></div>`;
    }
    function reset() {
      timers.forEach(clearTimeout);
      timers = [];
      busy = false;
      pay.disabled = false;
      charged = 0; keys = []; seq = 0;
      lanes.innerHTML = '';
      draw();
      logEl.innerHTML = 'Клиент оплачивает заказ. Ответ на запрос иногда теряется: таймаут балансировщика, обрыв мобильной сети, перезапуск пода.';
      logEl.className = 'log';
    }
    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function server(key, attempt) {
      if (key && keys.includes(key)) {
        line('сервер', `ключ <code>${key}</code> уже есть — возвращаю сохранённый ответ, ничего не списываю`, 'ok');
        return;
      }
      charged += 1000;
      if (key) keys.push(key);
      line('сервер', `списываю 1 000 ₽${key ? `, в той же транзакции сохраняю ключ и ответ` : ''}${attempt > 1 && !key ? ' — для сервера это новый платёж' : ''}`, attempt > 1 && !key ? 'bad' : '');
      draw();
    }
    function send() {
      if (busy) return;
      busy = true;
      pay.disabled = true;
      lanes.innerHTML = '';
      seq++;
      const key = useKey ? 'k-' + (0x7f3a + seq * 2711).toString(16) : null;
      const lost = lose;
      line('клиент', `<code>POST /payments</code> amount=1000${key ? ` · ключ <code>${key}</code>` : ''}`);
      later(600, () => {
        server(key, 1);
        later(600, () => {
          if (!lost) {
            line('сеть', 'ответ 201 дошёл', 'ok');
            finish();
            return;
          }
          line('сеть', 'ответ 201 потерян', 'bad');
          later(700, () => {
            line('клиент', 'таймаут: непонятно, прошёл ли платёж. Повторяю тот же запрос' + (key ? ' с тем же ключом' : ''));
            later(600, () => {
              server(key, 2);
              later(500, () => { line('сеть', 'ответ 201 дошёл', 'ok'); finish(); });
            });
          });
        });
      });
      function finish() {
        busy = false;
        pay.disabled = false;
        draw();
        if (charged > 1000 * seq) {
          logEl.innerHTML = 'Двойное списание: повтор без ключа сервер не отличил от новой покупки. Не повторять тоже нельзя — тогда при потерянном ответе заказ останется неоплаченным.';
          logEl.className = 'log bad';
        } else if (lost) {
          logEl.innerHTML = 'Повтор безопасен: сервер нашёл ключ и вернул тот же ответ. Ключ хранят сутки-двое; одновременные дубли ловит уникальный индекс по ключу.';
          logEl.className = 'log ok';
        } else {
          logEl.innerHTML = 'Ответ дошёл, повтор не понадобился. Включите потерю ответа.';
          logEl.className = 'log';
        }
      }
    }
    reset();
    return { stop: () => { if (busy) reset(); } };
  });
})();
