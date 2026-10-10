// Demos for slides 9–16: scheduler, context switch, thread limits, GIL, load average, cgroup CPU quota.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { logger, dec, fmt, dur, legend } = window.PT;

  // Canvas sized to its CSS box with devicePixelRatio; returns a 2D context in CSS pixels.
  function fitCanvas(cv, height) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(height * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.height = height + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    return [ctx, w];
  }
  const css = name => getComputedStyle(document.querySelector('.deck')).getPropertyValue(name).trim();

  // ---------------------------------------------------------------- scheduler
  // Simplified CFS: global run queue, vruntime advanced by 1024/weight per ms,
  // slice = latency × weight share, sleeper credit and wakeup preemption.
  // "Round-robin" mode: FIFO queue, fixed 10 ms slices, no preemption on wakeup.
  Deck.demo('scheduler', root => {
    const WEIGHT = { '-10': 9548, '-9': 7620, '-8': 6100, '-7': 4904, '-6': 3906, '-5': 3121, '-4': 2501, '-3': 1991, '-2': 1586, '-1': 1277, 0: 1024, 1: 820, 2: 655, 3: 526, 4: 423, 5: 335, 6: 272, 7: 215, 8: 172, 9: 137, 10: 110 };
    const W = 200; // window, ms
    const SPEED = 50; // simulated ms per real second
    const COLORS = ['#1864ab', '#e8590c', '#2b8a3e', '#862e9c', '#c2255c'];
    const DEFS = [
      { id: 'A', what: 'считает', kind: 'cpu' },
      { id: 'B', what: 'считает', kind: 'cpu' },
      { id: 'C', what: 'веб-сервер', kind: 'io', burst: 1, sleep: 8 },
      { id: 'D', what: 'считает', kind: 'cpu' },
      { id: 'E', what: 'считает', kind: 'cpu' },
    ];
    let tasks, cores, cur, now, rr, fifo, acc = 0, playing = true;
    let ncores = 1, nTasks = 3, niceA = 0;

    const cv = h('canvas', { class: 'sch-cv', 'aria-label': 'Временная диаграмма планировщика' });
    const table = h('div', { class: 'sch-tab' });
    const rq = h('div', { class: 'sch-rq' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const coreBtns = [1, 2].map(n => h('button', { class: 'btn small', onclick: () => { ncores = n; reset(); } }, `${n} ${plural(n, ['ядро', 'ядра', 'ядер'])}`));
    const addBtn = h('button', { class: 'btn small', onclick: () => { nTasks = Math.min(5, nTasks + 1); reset(); } }, '+ задача');
    const subBtn = h('button', { class: 'btn small', onclick: () => { nTasks = Math.max(3, nTasks - 1); reset(); } }, '− задача');
    const playBtn = h('button', { class: 'btn small', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пауза');
    const niceOut = h('output', null, '0');
    const niceIn = h('input', { type: 'range', min: -10, max: 10, value: 0, 'aria-label': 'nice задачи A' });
    niceIn.addEventListener('input', () => {
      niceA = +niceIn.value;
      niceOut.textContent = (niceA > 0 ? '+' : '') + niceA;
      tasks[0].w = WEIGHT[niceA];
      tasks[0].nice = niceA;
      say(`nice A = ${niceA}: вес ${WEIGHT[niceA]} против 1024 у B. В режиме CFS процессор между ними делится в этой пропорции.`);
    });
    const rrIn = h('input', { type: 'checkbox' });
    rrIn.addEventListener('change', () => { rr = rrIn.checked; reset(); });
    root.append(
      h('div', { class: 'controls' }, ...coreBtns, addBtn, subBtn, playBtn),
      h('div', { class: 'controls sch-ctl2' },
        h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'nice A'), niceIn, niceOut),
        h('label', { class: 'toggle' }, rrIn, h('span', null, 'простая очередь'))),
      cv,
      legend([['run', 'на ядре'], ['ready', 'готов, ждёт ядро'], ['blk', 'заблокирован (ждёт сеть)']]),
      rq, table, logEl,
    );

    function reset() {
      now = 0; acc = 0; fifo = [];
      cores = ncores; cur = Array(cores).fill(null);
      tasks = DEFS.slice(0, nTasks).map((d, i) => ({
        ...d, color: COLORS[i], nice: i === 0 ? niceA : 0, w: WEIGHT[i === 0 ? niceA : 0],
        v: 0, st: 'ready', slice: 0, left: d.burst || 0, sleepLeft: 0, readyAt: 0,
        hist: new Int8Array(W).fill(-1), lat: [],
      }));
      fifo = tasks.slice();
      coreBtns.forEach((b, i) => b.classList.toggle('sel', i + 1 === ncores));
      addBtn.disabled = nTasks >= 5;
      subBtn.disabled = nTasks <= 3;
      say(rr
        ? 'Простая очередь: каждый получает 10 мс по кругу, проснувшийся встаёт в конец. Посмотрите на задержку C.'
        : 'CFS: на ядро идёт задача с наименьшим взвешенным временем. C просыпается каждые 8 мс — и почти сразу получает ядро.');
      draw();
    }
    const latency = () => 6 * (1 + Math.log2(cores));
    const minV = () => Math.min(...tasks.filter(t => t.st !== 'block').map(t => t.v), Infinity);
    function sliceFor(t) {
      if (rr) return 10;
      const sum = tasks.filter(x => x.st !== 'block').reduce((s, x) => s + x.w, 0);
      return Math.max(1, Math.round(latency() * t.w / sum));
    }
    function put(c, t) {
      cur[c] = t; t.st = 'run'; t.core = c; t.slice = sliceFor(t);
      t.lat.push(now - t.readyAt);
      if (t.lat.length > 30) t.lat.shift();
    }
    function makeReady(t) {
      t.st = 'ready'; t.readyAt = now; t.core = -1;
      if (rr) fifo.push(t);
    }
    function pick() {
      if (rr) return fifo.shift() || null;
      let best = null;
      for (const t of tasks) if (t.st === 'ready' && (!best || t.v < best.v)) best = t;
      return best;
    }
    function wake(t) {
      const mv = minV();
      if (!rr && mv !== Infinity) t.v = Math.max(t.v, mv - latency() / 2);
      makeReady(t);
      if (rr || cur.some(x => !x)) return;
      // Wakeup preemption: kick the running task that is furthest ahead.
      let c = 0;
      cur.forEach((x, i) => { if (x.v > cur[c].v) c = i; });
      if (cur[c].v - t.v > 1) { const old = cur[c]; makeReady(old); put(c, t); }
    }
    function step() {
      for (let c = 0; c < cores; c++) {
        const t = cur[c];
        if (!t) continue;
        t.v += 1024 / t.w;
        t.slice--;
        if (t.kind === 'io') t.left--;
      }
      for (const t of tasks) if (t.st === 'block' && --t.sleepLeft <= 0) { t.left = t.burst; wake(t); }
      for (let c = 0; c < cores; c++) {
        const t = cur[c];
        if (!t) continue;
        if (t.kind === 'io' && t.left <= 0) { t.st = 'block'; t.sleepLeft = t.sleep; t.core = -1; cur[c] = null; continue; }
        if (t.slice <= 0) {
          const waiting = tasks.some(x => x.st === 'ready');
          if (waiting) { cur[c] = null; makeReady(t); } else t.slice = sliceFor(t);
        }
      }
      for (let c = 0; c < cores; c++) if (!cur[c]) { const t = pick(); if (t) put(c, t); }
      const k = now % W;
      for (const t of tasks) t.hist[k] = t.st === 'run' ? 2 + t.core : t.st === 'ready' ? 1 : 0;
      now++;
    }
    const loop = rafLoop(dt => {
      if (!playing) return;
      acc += dt * SPEED;
      let n = 0;
      while (acc >= 1 && n++ < 20) { step(); acc--; }
      draw();
    });

    function draw() {
      const rowH = 16, gap = 3, lab = 46;
      const rows = cores + tasks.length;
      const height = rows * (rowH + gap) + 8 + 14;
      const [ctx, w] = fitCanvas(cv, height);
      const cw = (w - lab) / W;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      const paper = css('--paper') || '#f2f5f7', muted = css('--muted') || '#5a6e80', line = css('--line') || '#d5dfe7';
      const start = Math.max(0, now - W);
      let y = 0;
      for (let c = 0; c < cores; c++, y += rowH + gap) {
        ctx.fillStyle = muted;
        ctx.fillText('CPU' + c, 0, y + rowH / 2);
        ctx.fillStyle = paper;
        ctx.fillRect(lab, y, w - lab, rowH);
        for (let m = start; m < now; m++) {
          const k = m % W;
          const t = tasks.find(x => x.hist[k] === 2 + c);
          if (!t) continue;
          ctx.fillStyle = t.color;
          ctx.fillRect(lab + (m - start) * cw, y, Math.ceil(cw), rowH);
        }
      }
      y += 6;
      ctx.fillStyle = line;
      ctx.fillRect(lab, y - 5, w - lab, 1);
      for (const t of tasks) {
        ctx.fillStyle = t.color;
        ctx.fillText(t.id, 0, y + rowH / 2);
        for (let m = start; m < now; m++) {
          const s = t.hist[m % W];
          const x = lab + (m - start) * cw;
          if (s >= 2) { ctx.globalAlpha = 1; ctx.fillStyle = t.color; ctx.fillRect(x, y, Math.ceil(cw), rowH); }
          else if (s === 1) { ctx.globalAlpha = 0.22; ctx.fillStyle = t.color; ctx.fillRect(x, y, Math.ceil(cw), rowH); }
          else if (s === 0) { ctx.globalAlpha = 0.5; ctx.fillStyle = muted; ctx.fillRect(x, y + rowH / 2 - 0.5, Math.ceil(cw), 1); }
        }
        ctx.globalAlpha = 1;
        y += rowH + gap;
      }
      ctx.fillStyle = muted;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('сейчас', w, y + 6);
      ctx.textAlign = 'left';
      ctx.fillText(`−${W} мс`, lab, y + 6);

      // run queue
      const ready = rr ? fifo : tasks.filter(t => t.st === 'ready').sort((a, b) => a.v - b.v);
      rq.innerHTML = '';
      rq.append(h('span', { class: 'label' }, 'очередь:'));
      if (!ready.length) rq.append(h('span', { class: 'empty' }, 'пусто'));
      ready.forEach(t => rq.append(h('span', { class: 'sch-chip', style: `--c:${t.color}` }, t.id)));
      if (!rr && ready.length) rq.append(h('span', { class: 'empty' }, '← по возрастанию vruntime'));

      // table
      const span = Math.min(now, W);
      const ST = { run: 'на ядре', ready: 'ждёт ядро', block: 'ждёт сеть' };
      table.innerHTML = '<div class="sch-r sch-h"><span></span><span>сейчас</span><span>CPU</span><span>nice</span><span>ожидание ядра</span></div>';
      for (const t of tasks) {
        let busy = 0;
        for (let m = Math.max(0, now - W); m < now; m++) if (t.hist[m % W] >= 2) busy++;
        const lat = t.lat.length ? t.lat.reduce((s, x) => s + x, 0) / t.lat.length : 0;
        table.append(h('div', { class: 'sch-r' },
          h('b', { style: `color:${t.color}` }, `${t.id} · ${t.what}`),
          h('span', null, ST[t.st]),
          h('span', null, span ? Math.round((busy / span) * 100) + '%' : '—'),
          h('span', null, (t.nice > 0 ? '+' : '') + t.nice),
          h('span', { class: t.kind === 'io' && lat > 3 ? 'bad' : '' }, t.kind === 'io' ? `в среднем ${dec(lat)} мс` : '')));
      }
    }
    reset();
    window.addEventListener('resize', () => draw());
    return { start: () => loop.start(), stop: () => loop.stop() };
  });

  // ---------------------------------------------------------------- context switch cost
  Deck.demo('ctxswitch', root => {
    const RATES = [100, 300, 1000, 3000, 10000, 30000, 100000];
    const WS = [
      ['16 КБ', 'помещается в L1', 1.5, 0.3],
      ['512 КБ', 'в L2', 20, 3],
      ['8 МБ', 'в L3', 150, 10],
    ];
    let ws = 1, proc = true;
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: RATES.length - 1, value: 3, 'aria-label': 'Переключений в секунду на ядро' });
    input.addEventListener('input', update);
    const wsBtns = WS.map(([n], i) => h('button', { class: 'btn small', onclick: () => { ws = i; update(); } }, n));
    const pIn = h('input', { type: 'checkbox', checked: true });
    pIn.addEventListener('change', () => { proc = pIn.checked; update(); });
    const bar = h('div', { class: 'sc-bar cs-bar' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label cs-l' }, 'Переключений/с на ядро'), input, out),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Рабочие данные задачи:'), ...wsBtns),
      h('label', { class: 'toggle' }, pIn, h('span', null, 'между разными процессами (смена таблицы страниц)')),
      h('span', { class: 'label' }, 'Одна секунда одного ядра'),
      bar,
      legend([['ok', 'полезная работа'], ['sys', 'само переключение'], ['warm', 'работа на холодном кэше и TLB']]),
      stats, logEl,
    );
    function update() {
      const rate = RATES[+input.value];
      out.textContent = fmt(rate);
      wsBtns.forEach((b, i) => b.classList.toggle('sel', i === ws));
      const direct = proc ? 2 : 1.2; // µs
      const [, where, warm, tlb] = WS[ws];
      const indirect = warm + (proc ? tlb : 0);
      const per = direct + indirect;
      const lostD = Math.min(1, (rate * direct) / 1e6);
      const lostI = Math.min(1 - lostD, (rate * indirect) / 1e6);
      const lost = lostD + lostI;
      bar.innerHTML = `<span class="ok" style="width:${(1 - lost) * 100}%"></span><span class="sys" style="width:${lostD * 100}%"></span><span class="warm" style="width:${lostI * 100}%"></span>`;
      stats.innerHTML = `<div class="stat"><b>${dec(per, per < 10 ? 1 : 0)} мкс</b><span>цена одного переключения</span></div>` +
        `<div class="stat"><b>${dur(1e9 / rate)}</b><span>работы между ними</span></div>` +
        `<div class="stat${lost > 0.1 ? ' warn' : ''}"><b>${Math.round(lost * 100)}%</b><span>процессора потеряно</span></div>`;
      let text, cls;
      if (lost < 0.02) { text = `Незаметно. Задача успевает поработать ${dur(1e9 / rate)} и прогреть кэш. Так живёт обычный сервер.`; cls = 'ok'; }
      else if (lost < 0.15) { text = `Заметно: ${Math.round(lost * 100)}% ядра уходит на переключения и разогрев. Рабочие данные ${where}, и после каждого переключения их приходится подтягивать заново.`; cls = 'warn'; }
      else { text = 'Ядро больше переключается и греет кэши, чем работает. Так бывает, когда сотни потоков на нескольких ядрах дерутся за блокировку или будят друг друга через очередь. Меньше потоков — больше пропускная способность.'; cls = 'bad'; }
      if (!proc) text += ' Потоки одного процесса делят таблицу страниц, поэтому TLB не страдает.';
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- how many threads
  Deck.demo('threadcalc', root => {
    const NS = [100, 1000, 4000, 10000, 20000, 32000, 50000, 100000, 200000, 1000000];
    const RAM = 16 * 1024 ** 3;
    const KINDS = [
      { b: 'потоки ОС', stack: 8 * 1024 ** 2, rss: 40 * 1024, os: true, note: 'C, Rust, Python: стек 8 МБ' },
      { b: 'Java', stack: 1024 ** 2, rss: 80 * 1024, os: true, note: '-Xss1m' },
      { b: 'горутины', stack: 2048, rss: 4 * 1024, os: false, note: 'для сравнения: не потоки ОС' },
    ];
    const LIMITS = [
      ['vm.max_map_count', 65530 / 2, '65 530 отображений, по 2 на поток (стек + защитная страница)'],
      ['ulimit -u', 63000, '≈ 63 000 процессов и потоков на пользователя'],
      ['kernel.threads-max', 127000, '≈ 127 000 задач на всю систему (зависит от RAM)'],
      ['pid_max', 4194304, '4 194 304 ID на систему (на старых — 32 768)'],
    ];
    let kind = 0;
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 3, 'aria-label': 'Число потоков' });
    input.addEventListener('input', update);
    const kBtns = KINDS.map((k, i) => h('button', { class: 'btn small', onclick: () => { kind = i; update(); } }, k.b));
    const stats = h('div', { class: 'stats' });
    const lims = h('div', { class: 'tc-lims' });
    const logEl = h('div', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, ...kBtns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Сколько'), input, out),
      stats, lims, logEl,
    );
    const size = b => b >= 1024 ** 4 ? dec(b / 1024 ** 4) + ' ТБ' : b >= 1024 ** 3 ? dec(b / 1024 ** 3) + ' ГБ' : Math.round(b / 1024 ** 2) + ' МБ';
    function update() {
      const n = NS[+input.value], k = KINDS[kind];
      out.textContent = fmt(n);
      kBtns.forEach((b, i) => b.classList.toggle('sel', i === kind));
      const rss = n * k.rss;
      stats.innerHTML = `<div class="stat"><b>${size(n * k.stack)}</b><span>виртуальной памяти под стеки</span></div>` +
        `<div class="stat${rss > RAM ? ' warn' : ''}"><b>${size(rss)}</b><span>реально занято (из 16 ГБ)</span></div>` +
        `<div class="stat${n / 8 * 3 > 1000 ? ' warn' : ''}"><b>${dur((n / 8) * 3e6)}</b><span>очередь к ядру, если все считают</span></div>`;
      lims.innerHTML = '';
      let first = null;
      const rows = k.os ? LIMITS : [];
      rows.forEach(([name, lim, desc]) => {
        const over = n > lim;
        if (over && !first) first = name;
        lims.append(h('div', { class: 'tc-row' + (over ? ' over' : '') },
          h('code', null, name),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.min(100, (n / lim) * 100)}%` })),
          h('span', { class: 'tc-st' }, over ? 'превышен' : Math.round((n / lim) * 100) + '%'),
          h('small', null, desc)));
      });
      if (!k.os) lims.append(h('p', { class: 'note' }, 'Горутины живут в памяти процесса и планируются рантаймом Go на GOMAXPROCS потоках ОС, поэтому лимиты ядра на них не действуют. Ограничение — только память.'));
      let text, cls = 'ok';
      if (k.os && first) {
        text = `Первым сработает <code>${first}</code>: создание потока вернёт ошибку, хотя памяти ещё полно. ` +
          (first === 'vm.max_map_count' ? 'Это частый сюрприз у Java и Elasticsearch: лимит поднимают через <code>sysctl vm.max_map_count</code>.' : 'Лимиты можно поднять, но тысячи активных потоков всё равно утонут в переключениях.');
        cls = 'bad';
      } else if (rss > RAM) {
        text = `Не хватит памяти: ${size(rss)} при 16 ГБ.`;
        cls = 'bad';
      } else if (k.os && n >= 4000) {
        text = 'Создать можно, но если хотя бы часть потоков активна, они будут стоять в очереди к 8 ядрам и вытеснять друг другу кэши. Тысячи соединений обслуживают циклом событий или лёгкими потоками.';
        cls = 'warn';
      } else {
        text = k.os ? 'Спокойно: столько потоков ОС держит любой сервер. Виртуальная память под стеки — только резерв адресов, её не жалко.' : 'Горутина начинается с 2 КБ стека и растёт по необходимости, поэтому их бывают миллионы.';
      }
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- GIL
  Deck.demo('gil', root => {
    const CORES = 4, CHUNKS = 8;
    const LOADS = [
      { b: 'вычисления', cpu: 0.5, wait: 0, axis: 4.5 },
      { b: 'запросы в сеть', cpu: 0.005, wait: 0.2, axis: 1.8 },
    ];
    const HOW = [['threading', 'потоки'], ['multiprocessing', 'процессы'], ['free-threaded', 'без GIL, 3.14t']];
    const START = 0.08; // s to start a worker process
    let load = 0, how = 0, workers = 4, plan, prog = 1;
    const lb = LOADS.map((l, i) => h('button', { class: 'btn small', onclick: () => { load = i; build(); } }, l.b));
    const hb = HOW.map(([k, n], i) => h('button', { class: 'btn small', onclick: () => { how = i; build(); } }, n));
    const wb = [1, 2, 4, 8].map(n => h('button', { class: 'btn small', onclick: () => { workers = n; build(); } }, String(n)));
    const cv = h('canvas', { class: 'gil-cv', 'aria-label': 'Временная диаграмма воркеров' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    const runBtn = h('button', { class: 'btn primary', onclick: () => { prog = 0; loop.start(); } }, 'Запустить');
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label gil-l' }, 'Задача'), ...lb),
      h('div', { class: 'controls' }, h('span', { class: 'label gil-l' }, 'Способ'), ...hb),
      h('div', { class: 'controls' }, h('span', { class: 'label gil-l' }, 'Воркеров'), ...wb, runBtn),
      cv,
      legend([['run', 'выполняет Python'], ['gilw', 'ждёт GIL или ядро'], ['io', 'ждёт сеть'], ['st', 'запуск процесса']]),
      stats, logEl,
    );
    const loop = rafLoop(dt => {
      prog = Math.min(1, prog + dt / 2.2);
      draw();
      if (prog >= 1) loop.stop();
    });

    // Segment kinds: run, share (n = how many lanes share one core/GIL), io, start.
    function build() {
      const L = LOADS[load], wN = workers;
      const proc = how === 1, freeT = how === 2;
      const lanes = [];
      const per = CHUNKS / wN; // chunks per worker
      const start = proc ? START : 0;
      const slow = freeT ? 1.08 : 1;
      let wall;
      if (L.wait === 0) {
        // CPU-bound
        let share, cpuTime;
        if (how === 0) { share = wN; cpuTime = L.cpu * per * wN * (1 + 0.03 * (wN - 1)); }
        else { share = Math.max(1, wN / CORES); cpuTime = L.cpu * per * slow * share; }
        for (let i = 0; i < wN; i++) {
          const segs = [];
          if (start) segs.push(['start', 0, start]);
          segs.push([share > 1 ? 'share' : 'run', start, start + cpuTime, share, i]);
          lanes.push(segs);
        }
        wall = start + cpuTime + (proc ? 0.02 : 0);
      } else {
        for (let i = 0; i < wN; i++) {
          const segs = [];
          let t = 0;
          if (start) { segs.push(['start', 0, start]); t = start; }
          for (let c = 0; c < per; c++) {
            segs.push(['run', t, t + L.cpu]); t += L.cpu;
            segs.push(['io', t, t + L.wait]); t += L.wait;
          }
          lanes.push(segs);
        }
        wall = start + per * (L.cpu + L.wait);
      }
      const base = L.wait === 0 ? L.cpu * CHUNKS : CHUNKS * (L.cpu + L.wait);
      plan = { lanes, wall, speed: base / wall, axis: L.axis };
      lb.forEach((b, i) => b.classList.toggle('sel', i === load));
      hb.forEach((b, i) => b.classList.toggle('sel', i === how));
      wb.forEach((b, i) => b.classList.toggle('sel', [1, 2, 4, 8][i] === workers));
      prog = 1;
      draw();
      const top = L.wait ? 'единицы %' : how === 0 ? '100%' : Math.min(wN, CORES) * 100 + '%';
      stats.innerHTML = `<div class="stat"><b>${dec(wall, 2)} с</b><span>время</span></div>` +
        `<div class="stat${plan.speed < 1.2 && wN > 1 ? ' warn' : ''}"><b>×${dec(plan.speed, 1)}</b><span>ускорение к 1 воркеру</span></div>` +
        `<div class="stat"><b>${top}</b><span>CPU процесса в top</span></div>`;
      let text, cls = '';
      if (L.wait) {
        text = how === 1
          ? 'Процессы тоже ускоряют ожидание, но каждый стоит десятки мегабайт памяти и время на запуск. Для ввода-вывода хватает потоков или asyncio.'
          : 'Пока поток ждёт сеть, он отпускает GIL, и остальные работают. Потоки отлично ускоряют ввод-вывод — даже с GIL.';
        cls = how === 1 ? 'warn' : 'ok';
      } else if (how === 0) {
        text = wN === 1 ? 'Один поток — эталон: 8 кусков по 0,5 с на одном ядре.' :
          `Потоки выполняют байткод по очереди, передавая GIL каждые 5 мс. ${wN} ${plural(wN, ['поток', 'потока', 'потоков'])} — то же время, даже чуть хуже из-за борьбы за блокировку. top покажет 100%: занято одно ядро.`;
        cls = wN === 1 ? '' : 'bad';
      } else if (how === 1) {
        text = 'У каждого процесса свой интерпретатор и свой GIL — работают параллельно. Плата: запуск процессов, память и pickle аргументов и результатов. ' +
          (wN > CORES ? 'Воркеров больше, чем ядер, — ОС делит ядра между ними, быстрее не становится.' : '');
        cls = 'ok';
      } else {
        text = 'Сборка без GIL: потоки параллельны, как процессы, но без копирования данных. Однопоточный код медленнее на несколько процентов, а C-расширения должны поддерживать этот режим. ' +
          (wN > CORES ? 'Больше потоков, чем ядер, не помогает.' : '');
        cls = 'ok';
      }
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    function draw() {
      const rowH = 18, gap = 5, lab = 30;
      const height = plan.lanes.length * (rowH + gap) + 22;
      const [ctx, w] = fitCanvas(cv, height);
      const accent = css('--accent') || '#1864ab', soft = css('--accent-soft') || '#dfebf7', muted = css('--muted') || '#5a6e80', line = css('--line') || '#d5dfe7', paper = css('--paper') || '#f2f5f7';
      const pw = w - lab;
      const X = t => lab + (t / plan.axis) * pw;
      const tNow = prog * plan.wall;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      plan.lanes.forEach((segs, i) => {
        const y = i * (rowH + gap);
        ctx.fillStyle = muted;
        ctx.fillText('#' + (i + 1), 0, y + rowH / 2);
        ctx.fillStyle = paper;
        ctx.fillRect(lab, y, pw, rowH);
        for (const [kind, t0, t1, share, idx] of segs) {
          const e = Math.min(t1, tNow);
          if (e <= t0) continue;
          const x0 = X(t0), x1 = X(e);
          if (kind === 'start') { ctx.fillStyle = line; ctx.fillRect(x0, y, x1 - x0, rowH); }
          else if (kind === 'io') { ctx.fillStyle = '#b9d0e8'; ctx.fillRect(x0, y + 5, Math.max(1, x1 - x0), rowH - 10); }
          else if (kind === 'run') { ctx.fillStyle = accent; ctx.fillRect(x0, y, Math.max(1.5, x1 - x0), rowH); }
          else {
            // Interleaved: this lane holds the GIL / core for one stripe in `share`.
            const n = Math.round(share), sw = 3;
            ctx.fillStyle = '#f3c4d2';
            ctx.fillRect(x0, y, x1 - x0, rowH);
            ctx.fillStyle = accent;
            for (let x = x0 + (idx % n) * sw; x < x1; x += sw * n) ctx.fillRect(x, y, Math.min(sw, x1 - x), rowH);
          }
        }
      });
      const y = plan.lanes.length * (rowH + gap);
      ctx.fillStyle = muted;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('0', lab, y + 8);
      ctx.textAlign = 'right';
      if (prog < 1 || X(plan.wall) < w - 80) ctx.fillText(dec(plan.axis, 1) + ' с', w, y + 8);
      if (prog >= 1) {
        ctx.fillStyle = css('--block') || '#ce3262';
        ctx.fillRect(X(plan.wall) - 1, 0, 2, y);
        ctx.textAlign = X(plan.wall) > w - 60 ? 'right' : 'left';
        ctx.fillText(dec(plan.wall, 2) + ' с', ctx.textAlign === 'right' ? X(plan.wall) - 4 : X(plan.wall) + 4, y + 8);
      }
      ctx.textAlign = 'left';
    }
    build();
    window.addEventListener('resize', () => draw());
    return { stop: () => { loop.stop(); prog = 1; draw(); } };
  });

  // ---------------------------------------------------------------- load average
  Deck.demo('loadavg', root => {
    const CORES = 4, SPEED = 20; // simulated seconds per real second
    const E = [Math.exp(-5 / 60), Math.exp(-5 / 300), Math.exp(-5 / 900)];
    const HIST = 180; // samples of 5 s = 15 min
    let la, hist, simT, acc, R = 2, D = 0;
    const mk = (label, init, set) => {
      const out = h('output', null, init);
      const input = h('input', { type: 'range', min: 0, max: 16, value: init, 'aria-label': label });
      input.addEventListener('input', () => { out.textContent = input.value; set(+input.value); note(); });
      return h('label', { class: 'slider inline' }, h('span', { class: 'label la-l' }, label), input, out);
    };
    const cv = h('canvas', { class: 'la-cv', 'aria-label': 'График load average' });
    const nums = h('div', { class: 'la-nums' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(
      mk('Считают (R)', R, v => { R = v; }),
      mk('Ждут диск (D)', D, v => { D = v; }),
      nums, cv,
      legend([['n', 'R + D сейчас'], ['l1', '1 мин'], ['l5', '5 мин'], ['l15', '15 мин']]),
      stats,
      h('div', { class: 'controls' }, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl,
    );
    function reset() {
      // Start from a quiet machine that has been running one busy task for a while.
      la = [1, 1, 1]; hist = Array.from({ length: HIST }, () => [1, 1, 1, 1]); simT = 0; acc = 0;
      note(); draw();
    }
    const loop = rafLoop(dt => {
      acc += dt * SPEED;
      while (acc >= 5) {
        acc -= 5; simT += 5;
        const n = R + D;
        la = la.map((l, i) => l * E[i] + n * (1 - E[i]));
        hist.push([n, ...la]);
        if (hist.length > HIST) hist.shift();
      }
      draw();
    });
    function note() {
      const busy = Math.min(R, CORES) / CORES;
      const queue = Math.max(0, R - CORES);
      stats.innerHTML = `<div class="stat"><b>${Math.round(busy * 100)}%</b><span>загрузка CPU</span></div>` +
        `<div class="stat${queue ? ' warn' : ''}"><b>${queue}</b><span>ждут свободное ядро</span></div>` +
        `<div class="stat${D ? ' warn' : ''}"><b>${D}</b><span>в состоянии D</span></div>`;
      let text, cls = '';
      if (D >= 4 && R <= CORES) { text = 'Load растёт, а процессор свободен: задачи в D ждут диск и попадают в load. Смотрите <code>iostat -x 1</code> и <code>vmstat 1</code> (столбец b), а не на процессор.'; cls = 'warn'; }
      else if (R > CORES) { text = `Задач, готовых работать, больше, чем ядер: ${queue} ${plural(queue, ['стоит', 'стоят', 'стоят'])} в очереди, и каждая выполняется медленнее. Load выше ${CORES} на ${CORES} ядрах — это и есть очередь.`; cls = 'bad'; }
      else { text = `Load ≤ ${CORES} на ${CORES} ядрах — очереди нет. Обратите внимание: 1-минутное среднее догоняет за минуту, 15-минутное — за полчаса.`; cls = 'ok'; }
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    function draw() {
      nums.innerHTML = `<span class="label">load average:</span> <b>${la.map(x => dec(x, 2)).join('&nbsp; ')}</b> <span class="la-t">+${Math.floor(simT / 60)} мин ${simT % 60} с</span>`;
      const height = 120;
      const [ctx, w] = fitCanvas(cv, height);
      const maxY = Math.max(8, ...hist.map(r => Math.max(...r)));
      const Y = v => height - 4 - (v / maxY) * (height - 14);
      const X = i => (i / (HIST - 1)) * w;
      ctx.strokeStyle = css('--line') || '#d5dfe7';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, Y(CORES)); ctx.lineTo(w, Y(CORES)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css('--muted') || '#5a6e80';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${CORES} ядра`, 4, Y(CORES) - 4);
      const off = HIST - hist.length;
      const colors = ['#c9d6e2', '#1864ab', '#e8590c', '#2b8a3e'];
      colors.forEach((c, k) => {
        if (!hist.length) return;
        ctx.strokeStyle = c;
        ctx.lineWidth = k ? 2 : 1.5;
        ctx.beginPath();
        hist.forEach((r, i) => {
          const x = X(off + i), y = Y(r[k]);
          if (!i) ctx.moveTo(x, y);
          else if (k === 0) { ctx.lineTo(x, Y(hist[i - 1][0])); ctx.lineTo(x, y); }
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }
    reset();
    return { start: () => loop.start(), stop: () => loop.stop() };
  });

  // ---------------------------------------------------------------- cgroup CPU quota
  Deck.demo('cgroup', root => {
    const LIMITS = [0.5, 1, 2, 4, 8];
    const PERIOD = 100, NEED = 50;
    let limI = 2, T = 8;
    const lOut = h('output'), tOut = h('output');
    const lIn = h('input', { type: 'range', min: 0, max: LIMITS.length - 1, value: limI, 'aria-label': 'Лимит CPU' });
    const tIn = h('input', { type: 'range', min: 1, max: 16, value: T, 'aria-label': 'Занятых потоков' });
    lIn.addEventListener('input', () => { limI = +lIn.value; update(); });
    tIn.addEventListener('input', () => { T = +tIn.value; update(); });
    const vis = h('div', { class: 'cg-vis' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log' });
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label cg-l' }, 'Лимит CPU'), lIn, lOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label cg-l' }, 'Занятых потоков'), tIn, tOut),
      vis,
      legend([['run', 'поток работает'], ['thr', 'троттлинг: квота кончилась']]),
      stats, logEl,
    );
    function update() {
      const lim = LIMITS[limI];
      const quota = lim * PERIOD;
      lOut.textContent = String(lim).replace('.', ',');
      tOut.textContent = T;
      const run = Math.min(PERIOD, quota / T); // ms each thread runs per period
      const pct = (run / PERIOD) * 100;
      vis.innerHTML = '';
      const head = h('div', { class: 'cg-head' });
      for (let p = 0; p < 3; p++) head.append(h('span', null, `${p * 100}–${(p + 1) * 100} мс`));
      vis.append(head);
      const rows = h('div', { class: 'cg-rows' });
      for (let i = 0; i < T; i++) {
        const r = h('div', { class: 'cg-row' });
        for (let p = 0; p < 3; p++) r.append(h('div', { class: 'cg-per' }, h('i', { style: `width:${pct}%` })));
        rows.append(r);
      }
      vis.append(rows);
      let lat;
      if (run >= NEED) lat = NEED;
      else { const p = Math.ceil(NEED / run); lat = (p - 1) * PERIOD + (NEED - (p - 1) * run); }
      stats.innerHTML = `<div class="stat"><b>${dec(run, run < 10 ? 1 : 0)} мс</b><span>работы в каждом периоде</span></div>` +
        `<div class="stat${run < PERIOD ? ' warn' : ''}"><b>${dec(PERIOD - run, PERIOD - run < 10 && run < PERIOD ? 1 : 0)} мс</b><span>простоя на квоте</span></div>` +
        `<div class="stat${lat > NEED ? ' warn' : ''}"><b>${fmt(lat)} мс</b><span>займёт запрос на 50 мс CPU</span></div>`;
      if (T <= lim) {
        logEl.innerHTML = 'Потоков не больше лимита: квоты хватает на весь период, троттлинга нет.';
        logEl.className = 'log ok';
      } else {
        logEl.innerHTML = `${T} ${plural(T, ['поток', 'потока', 'потоков'])} вместе тратят квоту ${fmt(quota)} мс за ${dec(run, run < 10 ? 1 : 0)} мс и стоят до конца периода. ` +
          `Средняя загрузка в мониторинге — ровно ${String(lim).replace('.', ',')} CPU, «всё в норме», а запрос на 50 мс отвечает за ${fmt(lat)} мс. Подгоните пулы под лимит: GOMAXPROCS, <code>-XX:ActiveProcessorCount</code>, число воркеров gunicorn.`;
        logEl.className = 'log ' + (lat > 2 * NEED ? 'bad' : 'warn');
      }
    }
    update();
    return {};
  });
})();
