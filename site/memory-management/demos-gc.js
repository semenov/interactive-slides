// Demos for slides 12–16: pauses vs throughput, GOGC/GOMEMLIMIT, leaks with heap snapshots, weak references.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { logger } = window.MM;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const ms = v => v >= 1000 ? dec(v / 1000, 1) + ' с' : v >= 10 ? Math.round(v) + ' мс' : dec(v, v < 1 ? 2 : 1) + ' мс';
  const mb = v => v >= 1024 ? dec(v / 1024, v >= 10240 ? 0 : 1) + ' ГБ' : Math.round(v) + ' МБ';

  function slider(label, list, idx, fmt, on) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = fmt(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); on(); });
    return { el: h('label', { class: 'slider inline' }, h('span', { class: 'label' }, label), input, out), get: () => list[+input.value] };
  }

  // ---------------------------------------------------------------- pauses vs throughput
  Deck.demo('pauses', root => {
    const CORES = 4, SPEED = 1, T = 10000, G0 = 2000, SVC = 5, GAP = 2.5; // ms; 400 rps, 50% load
    let mode = 'stw';
    const modeBtns = [['stw', 'Stop-the-world'], ['conc', 'Конкурентный']].map(([k, v]) =>
      h('button', { class: 'btn small', onclick: () => { mode = k; update(); } }, v));
    const heap = slider('Живая куча', [0.25, 0.5, 1, 2, 4, 8], 2, v => (v < 1 ? dec(v, 2) : v) + ' ГБ', update);
    const chart = h('div');
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(h('div', { class: 'controls' }, modeBtns), heap.el, chart, stats, logEl);

    // Discrete simulation: 4 workers, requests every 2.5 ms needing 5 ms of CPU each.
    function simulate(L) {
      const work = (L / SPEED) * 1000; // core-ms of marking
      const blocks = []; // [core, from, to, kind]
      let blocked; // per core: list of [from, to] when the core does GC
      if (mode === 'stw') {
        const P = work / CORES;
        blocked = Array.from({ length: CORES }, () => [[G0, G0 + P]]);
        for (let c = 0; c < CORES; c++) blocks.push([c, G0, G0 + P, 'stw']);
      } else {
        const D = work * 1.1; // one dedicated worker (25%), plus barrier overhead
        const stw = 0.1;
        blocked = Array.from({ length: CORES }, (_, c) => c === CORES - 1 ? [[G0, G0 + D]] : [[G0, G0 + stw], [G0 + D, G0 + D + stw]]);
        blocks.push([CORES - 1, G0, G0 + D, 'gcw']);
        for (let c = 0; c < CORES; c++) { blocks.push([c, G0, G0 + stw, 'stw']); blocks.push([c, G0 + D, G0 + D + stw, 'stw']); }
      }
      const free = Array(CORES).fill(0);
      const lat = [];
      const N = Math.floor(T / GAP);
      for (let k = 0; k < N; k++) {
        const a = k * GAP;
        let best = -1, bestEnd = Infinity;
        for (let c = 0; c < CORES; c++) {
          let start = Math.max(a, free[c]), need = SVC;
          if (mode === 'conc' && c !== CORES - 1 && a >= G0 && a < G0 + work * 1.1) need = SVC * 1.05; // write barrier cost
          let end = start + need;
          for (const [f, t] of blocked[c]) {
            if (start >= f && start < t) { start = t; end = start + need; }
            else if (start < f && end > f) end += t - f;
          }
          if (end < bestEnd) { bestEnd = end; best = c; }
        }
        free[best] = bestEnd;
        lat.push(bestEnd - a);
      }
      lat.sort((x, y) => x - y);
      const p99 = lat[Math.floor(lat.length * 0.99)];
      const pmax = lat[lat.length - 1];
      const maxPause = mode === 'stw' ? work / CORES : 0.1;
      const cpu = (mode === 'stw' ? work : work * 1.1) / (CORES * T) * 100;
      return { blocks, p99, pmax, maxPause, cpu, work };
    }
    function update() {
      modeBtns.forEach((b, k) => b.classList.toggle('sel', (k === 0) === (mode === 'stw')));
      const L = heap.get();
      const r = simulate(L);
      const W = 360, LH = 18, top = 8, left = 44, right = 8, x = v => left + (v / T) * (W - left - right);
      let s = `<svg class="chart" viewBox="0 0 ${W} ${top + CORES * (LH + 6) + 22}" role="img" aria-label="Загрузка ядер по времени">`;
      for (let c = 0; c < CORES; c++) {
        const y = top + c * (LH + 6);
        s += `<text class="lane-l" x="0" y="${y + 13}">ядро ${c + 1}</text><rect class="lane" x="${left}" y="${y}" width="${W - left - right}" height="${LH}" rx="3"/>`;
        for (const [cc, f, t, kind] of r.blocks) {
          if (cc !== c) continue;
          const w = Math.max(1.5, x(Math.min(t, T)) - x(f));
          s += `<rect class="${kind === 'stw' ? 'stw' : 'gcw'}" x="${x(f).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${LH}" rx="2"/>`;
        }
      }
      const yb = top + CORES * (LH + 6) + 14;
      for (let sec = 0; sec <= 10; sec += 2) s += `<text x="${x(sec * 1000) - 4}" y="${yb}">${sec} с</text>`;
      chart.innerHTML = s + '</svg>';
      stats.innerHTML = `<div class="stat ${r.maxPause > 50 ? 'warn' : ''}"><b>${ms(r.maxPause)}</b><span>самая длинная пауза</span></div>` +
        `<div class="stat ${r.p99 > 50 ? 'warn' : ''}"><b>${ms(r.p99)}</b><span>p99 задержки</span></div>` +
        `<div class="stat"><b>${dec(r.cpu)}%</b><span>CPU на сборку</span></div>`;
      if (mode === 'stw') {
        logEl.className = 'log ' + (r.maxPause > 100 ? 'bad' : r.maxPause > 20 ? 'warn' : '');
        logEl.innerHTML = `Все 4 ядра размечают ${dec(L, L < 1 ? 2 : 0)} ГБ за ${ms(r.maxPause)}, программа в это время стоит. Запросы копятся в очереди, худший ждёт ${ms(r.pmax)}. Зато CPU на сборку минимален.`;
      } else {
        logEl.className = 'log ' + (r.p99 > 20 ? 'warn' : 'ok');
        logEl.innerHTML = `Одно ядро размечает кучу ${ms(r.work * 1.1)} параллельно с программой; остановки — доли миллисекунды в начале и в конце. Пока идёт цикл, запросам достаются 3 ядра из 4 и они ждут дольше. CPU на сборку чуть больше, чем у STW: барьеры и повторная работа.`;
      }
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- GOGC / GOMEMLIMIT
  Deck.demo('gogc', root => {
    const CORES = 4, SPEED = 1024; // MB of live heap marked per core-second (order of magnitude)
    const live = slider('Живые данные', [64, 128, 256, 512, 1024, 2048], 3, mb, update);
    const rate = slider('Выделение', [50, 100, 200, 500, 1000, 2000], 2, v => mb(v) + '/с', update);
    const gogc = slider('GOGC', [25, 50, 100, 200, 400, 800, 'off'], 2, v => String(v), update);
    const lim = slider('GOMEMLIMIT', ['off', 256, 512, 768, 1024, 2048, 4096], 0, v => v === 'off' ? 'нет' : mb(v), update);
    const chart = h('div');
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(live.el, rate.el, gogc.el, lim.el, chart, stats, logEl);

    function update() {
      const L = live.get(), A = rate.get(), G = gogc.get(), M = lim.get();
      const cost = L / SPEED; // core-seconds per cycle
      let target = G === 'off' ? Infinity : L * (1 + G / 100);
      if (M !== 'off') target = Math.min(target, M);
      let headroom = target - L, capped = false, noGc = false;
      let cycles, cpu;
      if (!isFinite(target)) { noGc = true; cycles = 0; cpu = 0; }
      else {
        cycles = headroom > 0 ? A / headroom : Infinity;
        cpu = cycles * cost;
        if (M !== 'off' && cpu > CORES / 2) { // the limiter caps GC at ~50% CPU
          capped = true;
          cpu = CORES / 2;
          cycles = cpu / cost;
          headroom = A / cycles;
        }
      }
      const peak = noGc ? Infinity : L + headroom;

      // Sawtooth over 4 seconds.
      const W = 360, H = 130, left = 46, right = 6, top = 8, bottom = 18, SPAN = 4;
      const yMax = Math.max(noGc ? L * 4 : peak, M === 'off' ? 0 : M, L * 2) * 1.12;
      const X = s => left + (s / SPAN) * (W - left - right), Y = v => top + (1 - Math.min(v, yMax) / yMax) * (H - top - bottom);
      let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Размер кучи во времени">`;
      for (const f of [0, 0.5, 1]) s += `<line class="ax" x1="${left}" x2="${W - right}" y1="${Y(yMax / 1.12 * f)}" y2="${Y(yMax / 1.12 * f)}"/><text x="0" y="${Y(yMax / 1.12 * f) + 4}">${mb(yMax / 1.12 * f)}</text>`;
      if (noGc) {
        s += `<path class="saw" d="M${X(0)} ${Y(L)} L${X(SPAN)} ${Y(L + A * SPAN)}"/>`;
      } else if (cycles * SPAN > 60) {
        s += `<rect class="band" x="${X(0)}" y="${Y(peak)}" width="${X(SPAN) - X(0)}" height="${Math.max(1, Y(L) - Y(peak))}"/>`;
      } else {
        const period = 1 / cycles;
        let d = `M${X(0)} ${Y(L)}`;
        for (let t0 = 0; t0 < SPAN; t0 += period) {
          const t1 = Math.min(SPAN, t0 + period);
          const v = L + A * (t1 - t0);
          d += ` L${X(t1).toFixed(1)} ${Y(v).toFixed(1)}`;
          if (t1 < SPAN) d += ` L${X(t1).toFixed(1)} ${Y(L).toFixed(1)}`;
        }
        s += `<path class="saw" d="${d}"/>`;
      }
      s += `<line class="liveline" x1="${left}" x2="${W - right}" y1="${Y(L)}" y2="${Y(L)}"/>`;
      if (M !== 'off') s += `<line class="limit" x1="${left}" x2="${W - right}" y1="${Y(M)}" y2="${Y(M)}"/><text x="${W - 70}" y="${Y(M) - 4}" style="fill:var(--block)">GOMEMLIMIT</text>`;
      for (let sec = 0; sec <= SPAN; sec++) s += `<text x="${X(sec) - (sec === SPAN ? 16 : 6)}" y="${H - 3}">${sec} с</text>`;
      chart.innerHTML = s + '</svg>';

      const cpuPct = cpu / CORES * 100;
      stats.innerHTML = `<div class="stat ${M !== 'off' && peak > M ? 'warn' : ''}"><b>${noGc ? '∞' : mb(peak)}</b><span>пик кучи</span></div>` +
        `<div class="stat"><b>${noGc ? 0 : cycles >= 10 ? Math.round(cycles) : dec(cycles)}</b><span>сборок в секунду</span></div>` +
        `<div class="stat ${cpuPct > 25 ? 'warn' : ''}"><b>${Math.round(cpuPct)}%</b><span>CPU на GC (4 ядра)</span></div>`;
      let msg, cls = '';
      if (noGc) { msg = 'GOGC=off без лимита: сборок нет, куча растёт на скорость выделения, пока не придёт OOM killer.'; cls = 'bad'; }
      else if (capped) { msg = `Лимит слишком близко к живым данным. Без ограничителя GC работал бы непрерывно (death spiral); Go отдаёт ему не больше половины CPU, и куча выходит за лимит до ${mb(peak)}. Это сигнал: лимит мал или данных слишком много.`; cls = 'bad'; }
      else if (M !== 'off' && target === M && (G === 'off' || L * (1 + G / 100) > M)) { msg = `Сборку запускает лимит: куча не выходит за ${mb(M)}. ${G === 'off' ? 'GOGC=off + GOMEMLIMIT — сборки только когда память действительно нужна.' : 'Пока лимит далеко, правит GOGC.'}`; cls = 'ok'; }
      else msg = `Каждая сборка размечает ${mb(L)} живых данных — около ${ms(cost * 1000)} работы одного ядра. Между сборками программа успевает выделить ${mb(headroom)}. Больше GOGC — реже сборки, но выше пик.`;
      logEl.className = 'log ' + cls;
      logEl.innerHTML = msg;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- leaks + heap snapshots
  Deck.demo('leak', root => {
    const BASE = 150, LIMIT = 1024, ALLOC = 60; // MB, MB, MB per second of garbage
    const SRC = [
      { key: 'cache', label: 'Кэш без лимита', path: 'Map ← cache (users.js:12)', rate: 12, per: 1 / 256, what: 'записей' },
      { key: 'listen', label: 'Подписка не снята', path: 'Array ← emitter._events.data (ws.js:31)', rate: 6, per: 1 / 16, what: 'замыканий' },
      { key: 'timer', label: 'Замыкание в setInterval', path: 'Buffer ← (closure) ← Timeout (report.js:17)', rate: 8, per: 1, what: 'буферов' },
      { key: 'queue', label: 'Очередь без предела', path: 'Array ← queue.jobs (worker.js:5)', rate: 16, per: 1 / 128, what: 'задач' },
    ];
    let on = {}, retained, heap, t, hist, gcs, snaps, crashed;
    const chart = h('div');
    const toggles = h('div', { class: 'toggles' }, SRC.map(s => {
      const cb = h('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { on[s.key] = cb.checked; });
      return h('label', { class: 'toggle' }, cb, h('span', null, s.label));
    }));
    const snapBtn = h('button', { class: 'btn primary', onclick: snapshot }, 'Снимок кучи 1');
    const snapEl = h('div', { class: 'snap' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    root.append(toggles, chart, h('p', { class: 'note' }, 'Сплошная — размер кучи, пунктир — живые данные, красная — лимит 1 ГБ.'), h('div', { class: 'controls' }, snapBtn, h('button', { class: 'btn', onclick: () => { reset(); say('Перезапуск.'); } }, 'Перезапуск')), snapEl, logEl);

    function reset() {
      retained = Object.fromEntries(SRC.map(s => [s.key, 0]));
      heap = BASE; t = 0; hist = []; gcs = 0; snaps = []; crashed = 0; say.reset();
      snapBtn.textContent = 'Снимок кучи 1';
      snapEl.innerHTML = '';
    }
    const liveNow = () => BASE + SRC.reduce((s, x) => s + retained[x.key], 0);
    function tick(dt) {
      if (crashed > 0) { crashed -= dt; if (crashed <= 0) { const keep = { ...on }; reset(); on = keep; say('Процесс перезапущен оркестратором. Через какое-то время всё повторится.', 'warn'); } draw(); return; }
      t += dt;
      for (const s of SRC) if (on[s.key]) retained[s.key] += s.rate * dt;
      heap += (ALLOC + SRC.reduce((a, s) => a + (on[s.key] ? s.rate : 0), 0)) * dt;
      const L = liveNow();
      const target = Math.min(L * 2, LIMIT);
      if (heap >= target) {
        heap = L;
        gcs++;
        if (L > LIMIT * 0.97) {
          crashed = 2.5;
          say('<code>FATAL ERROR: Reached heap limit Allocation failed — JavaScript heap out of memory</code>. Сборщик не нашёл, что освободить: всё достижимо.', 'bad');
        }
      }
      hist.push([t, heap, L]);
      while (hist.length && hist[0][0] < t - 40) hist.shift();
      draw();
    }
    function draw() {
      const W = 360, H = 112, left = 46, right = 6, top = 6, bottom = 6;
      const t1 = Math.max(40, t), t0 = t1 - 40;
      const X = v => left + ((v - t0) / 40) * (W - left - right), Y = v => top + (1 - v / 1150) * (H - top - bottom);
      let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Размер кучи во времени">`;
      for (const v of [0, 512, 1024]) s += `<line class="ax" x1="${left}" x2="${W - right}" y1="${Y(v)}" y2="${Y(v)}"/><text x="0" y="${Y(v) + 4}">${mb(v)}</text>`;
      s += `<line class="limit" x1="${left}" x2="${W - right}" y1="${Y(LIMIT)}" y2="${Y(LIMIT)}"/>`;
      if (hist.length > 1) {
        s += `<path class="saw" d="${hist.map(([tt, v], k) => (k ? 'L' : 'M') + X(tt).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}"/>`;
        s += `<path class="liveline" fill="none" d="${hist.map(([tt, , v], k) => (k ? 'L' : 'M') + X(tt).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ')}"/>`;
      }
      if (crashed > 0) s += `<text class="oom" x="${W / 2 - 20}" y="${Y(700)}">OOM</text>`;
      chart.innerHTML = s + '</svg>';
    }
    function snapshot() {
      if (snaps.length >= 2) { snaps = []; snapEl.innerHTML = ''; }
      snaps.push({ t, r: { ...retained } });
      if (snaps.length === 1) {
        snapBtn.textContent = 'Снимок кучи 2';
        say('Снимок 1 сохранён. Подождите несколько секунд и сделайте второй.');
        return;
      }
      snapBtn.textContent = 'Снова снимок 1';
      const [a, b] = snaps;
      const dt = b.t - a.t;
      const rows = SRC.map(s => ({ s, d: b.r[s.key] - a.r[s.key] })).filter(x => x.d > 0.5).sort((x, y) => y.d - x.d);
      const noise = (Math.random() - 0.5) * 2;
      snapEl.innerHTML = '<div class="snap-row head"><span>Кто удерживает</span><span>Δ размер</span><span>Δ объектов</span></div>' +
        rows.map(({ s, d }) => `<div class="snap-row grow"><code>${s.path}</code><b>+${mb(d)}</b><span>+${Math.round(d / s.per).toLocaleString('ru-RU')}</span></div>`).join('') +
        `<div class="snap-row"><code>(всё остальное)</code><b>${noise >= 0 ? '+' : '−'}${dec(Math.abs(noise))} МБ</b><span>~0</span></div>`;
      if (rows.length) say(`За ${Math.round(dt)} с выросло: ${rows.map(x => x.s.label.toLowerCase()).join(', ')}. Путь удержания (retainers) показывает, кто держит объекты, — это и есть место утечки.`, 'warn');
      else say(`За ${Math.round(dt)} с ничего не выросло: память после сборок стабильна, утечки нет. Пила — это нормальная работа GC.`, 'ok');
    }
    const loop = rafLoop(tick);
    reset();
    say('Сервис работает: пила — выделение и сборки, пол стоит на месте. Включите источник утечки.');
    draw();
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- weak references
  Deck.demo('weakref', root => {
    let mode, objs, n;
    const modeBtns = [['Map', 'Map'], ['WeakMap', 'WeakMap']].map(([k, v]) =>
      h('button', { class: 'btn small', onclick: () => { mode = k; reset(); } }, h('code', null, v)));
    const code = h('pre', { class: 'code' }, h('code'));
    const colApp = h('div', { class: 'wk-col' });
    const colCache = h('div', { class: 'wk-col' });
    const colHeap = h('div', { class: 'wk-col' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 2);
    const newBtn = h('button', { class: 'btn', onclick: add }, 'Новый объект');
    const dropBtn = h('button', { class: 'btn', onclick: drop }, 'Приложение забыло объект');
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Кэш:'), modeBtns),
      code,
      h('div', { class: 'controls' }, newBtn, dropBtn, h('button', { class: 'btn primary', onclick: gc }, 'Сборка мусора')),
      h('div', { class: 'wk' }, colApp, colCache, colHeap),
      logEl,
    );
    function reset(m) {
      if (m) mode = m;
      objs = []; n = 0; say.reset();
      modeBtns.forEach((b, k) => b.classList.toggle('sel', (k === 1) === (mode === 'WeakMap')));
      code.firstChild.innerHTML = Deck.highlight(`const stats = new ${mode}();\nstats.set(user, computeStats(user)); // метаданные`, 'js');
      say(mode === 'Map' ? 'Обычная Map держит ключи сильными ссылками.' : 'WeakMap держит ключи слабо: запись живёт, пока жив ключ.');
      render();
    }
    function add() {
      if (objs.filter(o => o.alive).length >= 6) { say('Хватит для примера — запустите сборку.'); return; }
      n++;
      objs.push({ id: 'user' + n, inApp: true, cached: true, alive: true });
      say(`Создан <code>user${n}</code>; приложение держит его, в кэше — запись с метаданными.`);
      render();
    }
    function drop() {
      const o = objs.find(x => x.inApp);
      if (!o) { say('Приложение уже ничего не держит.'); return; }
      o.inApp = false;
      say(`Приложение отпустило <code>${o.id}</code> (сессия закрыта). ` + (mode === 'Map' ? 'Но Map всё ещё держит его как ключ.' : 'Слабая ссылка из WeakMap его не удерживает.'), mode === 'Map' ? 'warn' : '');
      render();
    }
    function gc() {
      const freed = [];
      for (const o of objs) {
        if (!o.alive) continue;
        const held = o.inApp || (mode === 'Map' && o.cached);
        if (!held) { o.alive = false; o.cached = false; freed.push(o.id); }
      }
      const stuck = objs.filter(o => o.alive && !o.inApp).length;
      if (freed.length) say(`Сборка: освобождены ${freed.join(', ')}, записи о них исчезли из WeakMap сами.`, 'ok');
      else if (stuck) say(`Сборка ничего не освободила: ${stuck} ${plural(stuck, ['объект', 'объекта', 'объектов'])} не нужны приложению, но достижимы через Map. Это и есть утечка через кэш.`, 'bad');
      else say('Сборка: всё достижимо и нужно — освобождать нечего.');
      render();
    }
    function render() {
      const objHtml = (o, cls) => `<span class="wk-obj ${cls}">${o.id}</span>`;
      colApp.innerHTML = '<h4>Приложение держит</h4>' + (objs.filter(o => o.inApp).map(o => objHtml(o, 'held')).join('') || '<span class="empty">ничего</span>');
      colCache.innerHTML = `<h4>${mode} (ключи)</h4>` + (objs.filter(o => o.cached).map(o => objHtml(o, mode === 'WeakMap' ? 'weak' : '')).join('') || '<span class="empty">пусто</span>');
      colHeap.innerHTML = '<h4>Куча</h4>' + (objs.map(o => objHtml(o, !o.alive ? 'gone' : o.inApp ? 'held' : 'orphan')).join('') || '<span class="empty">пусто</span>');
    }
    reset('Map');
    return {};
  });
})();
