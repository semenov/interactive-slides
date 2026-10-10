// Demos for slides 2–12: threads vs event loop, blocking IO, epoll, io_uring, event loop queues,
// async state machine, blocking the loop, libuv thread pool.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const kb = v => v >= 1024 * 1024 ? dec(v / 1024 / 1024, v < 10 * 1024 * 1024 ? 1 : 0) + ' ГБ' : v >= 1024 ? dec(v / 1024, v < 10240 ? 1 : 0) + ' МБ' : Math.round(v) + ' КБ';
  const us = v => v >= 1000 ? dec(v / 1000, v < 10000 ? 1 : 0) + ' мс' : dec(v, v < 10 ? 1 : 0) + ' мкс';

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  function slider(root, label, list, idx, show, onChange) {
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
    const set = () => { out.textContent = show(list[+input.value]); };
    set();
    input.addEventListener('input', () => { set(); onChange(); });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label sl-l' }, label), input, out));
    return () => list[+input.value];
  }
  function modeButtons(list, cur, onPick) {
    const btns = list.map(([key, text]) => h('button', { class: 'btn small' + (key === cur ? ' sel' : ''), onclick: () => pick(key) }, text));
    function pick(key) {
      btns.forEach((b, i) => b.classList.toggle('sel', list[i][0] === key));
      onPick(key);
    }
    return h('div', { class: 'controls' }, btns);
  }

  // ---------------------------------------------------------------- thread per connection vs event loop
  Deck.demo('threads', root => {
    const CONNS = [100, 300, 1000, 3000, 10000, 30000, 100000];
    const RATES = [0.1, 1, 10];
    const THREAD_KB = 48 + 16 + 8; // touched user stack + kernel stack + task_struct/TLS
    const LOOP_KB = 4;             // connection object, parser state, small buffers
    const SWITCH_US = 3;           // direct cost + cache/TLB pollution
    const WORK_US = 10;            // read + parse + write per request
    const n = slider(root, 'Соединений', CONNS, 3, fmt, update);
    const rate = slider(root, 'Запросов/с на соединение', RATES, 1, v => dec(v, v < 1 ? 1 : 0), update);
    const table = h('div', { class: 'tc' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(table, logEl);

    function update() {
      const N = n(), lam = N * rate();
      const tMem = N * THREAD_KB, lMem = N * LOOP_KB + 8 * 1024;
      const tSw = lam * 2;
      const rho = lam * WORK_US / 1e6;
      const lSw = 2 * lam * Math.max(0, 1 - rho); // the loop sleeps only when its queue is empty
      const tCpu = (lam * WORK_US + tSw * SWITCH_US) / 1e6, lCpu = (lam * WORK_US + lSw * SWITCH_US) / 1e6;
      const max = Math.max(tMem, lMem);
      const bar = (v, cls) => `<span class="tc-bar"><i class="${cls}" style="width:${Math.max(1, (v / max) * 100)}%"></i></span>`;
      const cores = v => v < 0.01 ? '≈ 0' : dec(v, v < 1 ? 2 : 1);
      table.innerHTML =
        `<span></span><b>поток на соединение</b><b>цикл событий</b>` +
        `<span>потоков ОС</span><span class="${N > 30000 ? 'bad' : ''}">${fmt(N)}</span><span>1</span>` +
        `<span>память</span><span>${kb(tMem)}${bar(tMem, 'th')}</span><span>${kb(lMem)}${bar(lMem, 'lp')}</span>` +
        `<span>адреса под стеки</span><span>${kb(N * 8192)}</span><span>8 МБ</span>` +
        `<span>переключений в секунду</span><span>${fmt(tSw)}</span><span>${fmt(lSw)}</span>` +
        `<span>занято ядер CPU</span><span class="${tCpu > 1 ? 'bad' : ''}">${cores(tCpu)}</span><span class="${lCpu > 0.8 ? 'bad' : ''}">${cores(lCpu)}</span>`;
      if (N > 30000) logEl.innerHTML = `${fmt(N)} потоков: каждому стеку нужны два отображения памяти (стек и защитная страница), а <code>vm.max_map_count</code> по умолчанию 65 530 — около 32 тысяч потоков. Дальше <code>pthread_create</code> вернёт <code>EAGAIN</code>.`;
      else if (lCpu > 1) logEl.innerHTML = `Одному циклу не хватает ядра: ${fmt(lam)} запросов в секунду по ${WORK_US} мкс. Запускают по циклу на ядро — так делают nginx (worker_processes), Node cluster и Tokio.`;
      else if (tCpu > lCpu * 1.3 && tSw > 1e4) logEl.innerHTML = `На переключения потоков уходит ${cores(tSw * SWITCH_US / 1e6)} ядра. Цикл событий под нагрузкой почти не засыпает: <code>epoll_wait</code> сразу возвращает пачку готовых сокетов.`;
      else logEl.innerHTML = `При малой нагрузке цикл тоже засыпает и просыпается на каждое событие, так что переключений почти столько же. Разница — в памяти на спящие соединения: ${THREAD_KB} КБ против ${LOOP_KB} КБ. Добавьте запросов в секунду.`;
      logEl.className = 'log' + (N > 30000 || lCpu > 1 ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- blocking / busy polling / epoll timeline
  Deck.demo('blocking', root => {
    const T = 10;
    const ARR = { A: 7, B: 2, C: 4.5 };
    const W = 0.5;
    const PLANS = {
      block: {
        thread: [['sleep', 0, 7, 'read(A) спит'], ['work', 7, 7.5, 'A'], ['work', 7.5, 8, 'B'], ['work', 8, 8.5, 'C'], ['sleep', 8.5, 10, 'read(A)']],
        start: { A: 7, B: 7.5, C: 8 }, cpu: 15, calls: '4 read',
        log: 'Поток уснул в <code>read(A)</code>. Данные на B и C давно пришли, но поток об этом не знает: B ждёт 5,5 мс. Отсюда и модель «поток на соединение».',
        cls: 'warn',
      },
      spin: {
        thread: [['spin', 0, 2, 'read → EAGAIN…'], ['work', 2, 2.5, 'B'], ['spin', 2.5, 4.5, ''], ['work', 4.5, 5, 'C'], ['spin', 5, 7, ''], ['work', 7, 7.5, 'A'], ['spin', 7.5, 10, '']],
        start: { A: 7, B: 2, C: 4.5 }, cpu: 100, calls: '≈ 30 000 read',
        log: 'Каждый сокет обслужен сразу, но поток крутит <code>read → EAGAIN</code> по кругу и жжёт ядро на 100%, даже когда ничего не происходит.',
        cls: 'warn',
      },
      epoll: {
        thread: [['sleep', 0, 2, 'epoll_wait'], ['work', 2, 2.5, 'B'], ['sleep', 2.5, 4.5, 'epoll_wait'], ['work', 4.5, 5, 'C'], ['sleep', 5, 7, 'epoll_wait'], ['work', 7, 7.5, 'A'], ['sleep', 7.5, 10, 'epoll_wait']],
        start: { A: 7, B: 2, C: 4.5 }, cpu: 15, calls: '4 epoll_wait + 3 read',
        log: 'Поток спит в <code>epoll_wait</code>, пока хоть один сокет не станет готов. Ядро будит его и говорит, какой именно. Сразу и без лишнего CPU.',
        cls: 'ok',
      },
    };
    let mode = 'block', t = 0, playing = false;
    const lanes = h('div', { class: 'tl' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Запустить');
    root.append(
      modeButtons([['block', 'блокирующий read'], ['spin', 'неблокирующий опрос'], ['epoll', 'epoll']], mode, m => { mode = m; t = 0; playing = false; render(); }),
      lanes, h('div', { class: 'controls' }, runBtn), stats, logEl,
    );
    const pct = v => (v / T) * 100 + '%';
    function render() {
      const p = PLANS[mode];
      const done = t >= T;
      let html = `<div class="tl-axis"><span>0</span><span>${T / 2} мс</span><span>${T} мс</span></div>`;
      html += '<div class="tl-row"><span class="tl-name">поток</span><div class="tl-lane">' +
        p.thread.map(([k, a, b, label]) => `<i class="seg ${k}" style="left:${pct(a)};width:${pct(b - a)}">${b - a >= 1.5 ? label : ''}</i>`).join('') +
        `<i class="tl-mask" style="left:${pct(t)}"></i><i class="tl-head" style="left:${pct(t)}"></i></div></div>`;
      for (const s of ['A', 'B', 'C']) {
        const a = ARR[s], st = p.start[s];
        html += `<div class="tl-row"><span class="tl-name">сокет ${s}</span><div class="tl-lane thin">` +
          (st > a ? `<i class="seg waitd" style="left:${pct(a)};width:${pct(st - a)}"></i>` : '') +
          `<i class="seg work" style="left:${pct(st)};width:${pct(W)}"></i>` +
          `<i class="arr" style="left:${pct(a)}" title="данные пришли"></i>` +
          `<i class="tl-mask" style="left:${pct(t)}"></i></div></div>`;
      }
      lanes.innerHTML = html;
      const worst = Math.max(...['A', 'B', 'C'].map(s => p.start[s] - ARR[s]));
      stats.innerHTML = done
        ? `<div class="stat ${worst > 1 ? 'warn' : ''}"><b>${dec(worst)} мс</b><span>худшее ожидание</span></div>` +
          `<div class="stat ${p.cpu > 50 ? 'warn' : ''}"><b>${p.cpu}%</b><span>CPU занят</span></div>` +
          `<div class="stat"><b class="small">${p.calls}</b><span>системных вызовов</span></div>`
        : '<div class="stat"><b>—</b><span>худшее ожидание</span></div><div class="stat"><b>—</b><span>CPU занят</span></div><div class="stat"><b>—</b><span>системных вызовов</span></div>';
      runBtn.disabled = playing;
    }
    const say = logger(logEl, 1);
    function run() { t = 0; playing = true; render(); }
    render();
    say('Серые полосы — поток спит, оранжевая штриховка — крутится впустую, зелёные — обрабатывает данные. Точка — момент, когда пришли данные.');
    return rafLoop(dt => {
      if (!playing) return;
      t = Math.min(T, t + dt * 3);
      if (t >= T) { playing = false; say(PLANS[mode].log, PLANS[mode].cls); }
      render();
    });
  });

  // ---------------------------------------------------------------- select / poll / epoll
  Deck.demo('epoll', root => {
    const CELLS = 96;
    const NS = [100, 1000, 10000, 100000];
    let mode = 'poll', ready = [], scan = -1, rlist = [], phase = 'idle', calls = 0;
    const grid = h('div', { class: 'ep-grid' });
    const cells = Array.from({ length: CELLS }, () => h('i'));
    grid.append(...cells);
    const rl = h('div', { class: 'ep-rl' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const callBtn = h('button', { class: 'btn primary', onclick: call }, 'Пришли данные → ждать');
    root.append(modeButtons([['select', 'select'], ['poll', 'poll'], ['epoll', 'epoll / kqueue']], mode, m => { mode = m; reset(); }));
    const N = slider(root, 'Соединений', NS, 2, fmt, () => { reset(); });
    root.append(
      h('div', { class: 'ep-box' }, h('span', { class: 'label' }, 'сокеты процесса (показаны 96)'), grid),
      h('div', { class: 'ep-box' }, h('span', { class: 'label' }, 'вернулось из вызова'), rl),
      h('div', { class: 'controls' }, callBtn), stats, logEl,
    );
    function reset() {
      ready = []; rlist = []; scan = -1; phase = 'idle'; calls = 0;
      render();
      showStats(false);
      say(mode === 'epoll'
        ? 'Сокеты зарегистрированы один раз через <code>epoll_ctl</code>. Ядро само добавит сокет в список готовых, когда придут данные.'
        : `Каждый вызов <code>${mode}</code> передаёт ядру весь список дескрипторов, и ядро опрашивает каждый.`);
    }
    function call() {
      if (phase === 'scan') return;
      const k = 1 + Math.floor(Math.random() * 4);
      const pool = [...Array(CELLS).keys()].sort(() => Math.random() - 0.5);
      ready = pool.slice(0, k).sort((a, b) => a - b);
      rlist = [];
      calls++;
      if (mode === 'select' && N() > 1024) {
        phase = 'idle'; render(); showStats(true);
        say('<code>select</code> работает с битовой маской на 1024 дескриптора (FD_SETSIZE). Сокет с номером 1024 и выше передать нельзя: запись за границей маски портит память.', 'bad');
        return;
      }
      if (mode === 'epoll') {
        rlist = ready.slice();
        phase = 'done';
        render(); showStats(true);
        say(`Данные пришли — ядро сразу положило ${k} ${plural(k, ['сокет', 'сокета', 'сокетов'])} в список готовых. <code>epoll_wait</code> просто забрал его: работа пропорциональна числу готовых, а не всех.`, 'ok');
      } else {
        phase = 'scan'; scan = 0;
        say(`Ядро проходит по всем ${fmt(N())} дескрипторам и у каждого спрашивает: готов?`);
      }
    }
    function cost() {
      const n = N(), k = ready.length || 2;
      if (mode === 'epoll') return { checked: k, bytes: k * 12, t: 0.5 + k * 0.1 };
      if (mode === 'select') return { checked: n, bytes: (n / 8) * 3 * 2, t: 0.5 + n * 0.03 };
      return { checked: n, bytes: n * 8 * 2, t: 0.5 + n * 0.04 };
    }
    function showStats(on) {
      const c = cost();
      const cpu = c.t * 1000 / 1e6 * 100;
      const blocked = mode === 'select' && N() > 1024;
      stats.innerHTML = blocked ? `<div class="stat warn"><b>✕</b><span>не работает</span></div><div class="stat"><b>1024</b><span>FD_SETSIZE</span></div><div class="stat"><b>${fmt(N())}</b><span>нужно</span></div>` :
        `<div class="stat ${c.checked > 1000 ? 'warn' : ''}"><b>${fmt(c.checked)}</b><span>проверок за вызов</span></div>` +
        `<div class="stat"><b>${kb(c.bytes / 1024).replace(/^0 КБ$/, c.bytes + ' Б')}</b><span>копируется ядро ↔ процесс</span></div>` +
        `<div class="stat ${cpu > 50 ? 'warn' : ''}"><b>${cpu < 1 ? dec(cpu, 2) : fmt(cpu)}%</b><span>CPU при 1000 вызовов/с</span></div>`;
      if (!on) stats.classList.add('dim'); else stats.classList.remove('dim');
    }
    function render() {
      cells.forEach((c, i) => {
        const r = ready.includes(i);
        c.className = (r ? 'rdy' : '') + (phase === 'scan' && i < scan ? ' scanned' : '') + (phase === 'scan' && i === Math.floor(scan) ? ' cur' : '') + (rlist.includes(i) ? ' got' : '');
      });
      rl.innerHTML = rlist.length ? rlist.map(i => `<span class="val done">fd ${i + 3}</span>`).join('') : '<span class="empty">пусто</span>';
      callBtn.disabled = phase === 'scan';
    }
    reset();
    return rafLoop(dt => {
      if (phase !== 'scan') return;
      scan += dt * CELLS / 1.4;
      ready.forEach(i => { if (i < scan && !rlist.includes(i)) rlist.push(i); });
      if (scan >= CELLS) {
        phase = 'done'; scan = -1;
        showStats(true);
        const c = cost();
        say(`Проверено ${fmt(c.checked)} дескрипторов, чтобы найти ${ready.length}. При ${fmt(N())} соединениях один вызов стоит около ${us(c.t)} — и так на каждом обороте цикла.`, N() >= 10000 ? 'warn' : '');
      }
      render();
    });
  });

  // ---------------------------------------------------------------- epoll vs io_uring syscalls
  Deck.demo('uring', root => {
    const KS = [1, 2, 4, 8, 16, 32, 64];
    let kind = 'sock';
    const sqIn = h('input', { type: 'checkbox' });
    sqIn.addEventListener('change', update);
    root.append(modeButtons([['sock', 'сокеты'], ['file', 'файлы на диске']], kind, m => { kind = m; update(); }));
    const K = slider(root, 'Операций в пачке', KS, 3, String, update);
    root.append(h('label', { class: 'toggle' }, sqIn, h('span', null, 'io_uring с ', h('code', null, 'SQPOLL'), ' — поток ядра сам забирает очередь')));
    const rows = h('div', { class: 'ur' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(rows, logEl);
    function ticks(list) {
      return list.map(([cls, n, label]) => Array.from({ length: n }, () => `<i class="${cls}" title="${label}"></i>`).join('')).join('');
    }
    function update() {
      const k = K(), sq = sqIn.checked;
      let ep, epN, epNote;
      if (kind === 'sock') {
        ep = [['ew', 1, 'epoll_wait'], ['rd', k, 'read'], ['wr', k, 'write']];
        epN = 1 + 2 * k;
        epNote = `1 epoll_wait + ${k} read + ${k} write`;
      } else {
        ep = [['rd', k, 'pread в потоке пула'], ['fx', k, 'futex: разбудить поток'], ['ew', 2, 'epoll_wait + eventfd']];
        epN = 2 * k + 2;
        epNote = `${k} pread в пуле + ${k} futex + 2`;
      }
      const urN = sq ? 0 : 1;
      rows.innerHTML =
        `<div class="ur-row"><span class="label">${kind === 'sock' ? 'epoll' : 'epoll + пул потоков'} — <b>${epN}</b> ${plural(epN, ['вызов', 'вызова', 'вызовов'])}<small>${epNote}</small></span><div class="ur-ticks">${ticks(ep)}</div></div>` +
        `<div class="ur-row"><span class="label">io_uring — <b>${urN}</b> ${plural(urN, ['вызов', 'вызова', 'вызовов'])}<small>${sq ? 'только запись в кольцо SQ и чтение из CQ' : '1 io_uring_enter: отправить всё и дождаться'}</small></span><div class="ur-ticks">${urN ? ticks([['ue', 1, 'io_uring_enter']]) : '<span class="empty">нет системных вызовов</span>'}</div></div>`;
      if (kind === 'file') logEl.innerHTML = `Для обычного файла epoll бесполезен: он всегда «готов», а <code>read()</code> ждёт диск. libuv отдаёт ${k} ${plural(k, ['чтение', 'чтения', 'чтений'])} в пул потоков — это ещё и ${2 * k} переключений контекста. io_uring читает файлы асинхронно сам.`;
      else if (sq) logEl.innerHTML = 'С SQPOLL поток ядра крутится и сам забирает заявки из кольца — ноль системных вызовов, но ценой целого ядра CPU.';
      else logEl.innerHTML = `Каждый системный вызов — переход в ядро и обратно, а после патчей от Spectre и Meltdown он заметно подорожал. Здесь ${epN} против 1: io_uring выигрывает на пачках мелких операций.`;
      logEl.className = 'log' + (kind === 'file' ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- event loop: stack, microtasks, macrotasks
  Deck.demo('eventloop', root => {
    // Each step: [line, stack, micro, macro, output, note]
    const SNIPPETS = {
      basic: {
        title: 'then и setTimeout',
        code: [
          "console.log('1');",
          "setTimeout(() => console.log('2'), 0);",
          "Promise.resolve().then(() => console.log('3'));",
          "console.log('4');",
        ],
        steps: [
          [-1, ['скрипт'], [], [], '', 'Весь скрипт — первая макрозадача. Стек вызовов начинается с него.'],
          [0, ['скрипт', 'console.log'], [], [], '1', 'Синхронный код выполняется сразу.'],
          [1, ['скрипт', 'setTimeout'], [], ['таймер → log 2'], '1', 'setTimeout регистрирует таймер. Когда он истечёт, колбэк станет макрозадачей. Задержка 0 не значит «сейчас».'],
          [2, ['скрипт', 'then'], ['log 3'], ['таймер → log 2'], '1', 'Промис уже выполнен, поэтому .then сразу ставит колбэк в очередь микрозадач.'],
          [3, ['скрипт', 'console.log'], ['log 3'], ['таймер → log 2'], '1 4', 'Синхронный код идёт дальше. Колбэки ждут.'],
          [-1, [], ['log 3'], ['таймер → log 2'], '1 4', 'Стек пуст — скрипт закончился. Перед следующей макрозадачей цикл выполняет все микрозадачи.'],
          [2, ['колбэк then'], [], ['таймер → log 2'], '1 4 3', 'Микрозадача выполнена. Очередь микрозадач пуста.'],
          [1, ['колбэк таймера'], [], [], '1 4 3 2', 'Только теперь цикл берёт макрозадачу — колбэк таймера.'],
        ],
      },
      await: {
        title: 'async/await',
        code: [
          'async function f() {',
          "  console.log('a');",
          '  await null;',
          "  console.log('b');",
          '}',
          "setTimeout(() => console.log('t'), 0);",
          'f();',
          "Promise.resolve().then(() => console.log('p'));",
          "console.log('c');",
        ],
        steps: [
          [5, ['скрипт', 'setTimeout'], [], ['таймер → log t'], '', 'Таймер зарегистрирован.'],
          [6, ['скрипт', 'f'], [], ['таймер → log t'], '', 'Вызов async-функции — обычный синхронный вызов.'],
          [1, ['скрипт', 'f', 'console.log'], [], ['таймер → log t'], 'a', 'Тело до первого await выполняется сразу, синхронно.'],
          [2, ['скрипт'], ['f: после await'], ['таймер → log t'], 'a', 'await приостанавливает f: её состояние сохранено, продолжение станет микрозадачей. f() вернула промис, управление снова в скрипте.'],
          [7, ['скрипт', 'then'], ['f: после await', 'log p'], ['таймер → log t'], 'a', 'then ставит колбэк в очередь микрозадач — после продолжения f.'],
          [8, ['скрипт', 'console.log'], ['f: после await', 'log p'], ['таймер → log t'], 'a c', 'Последняя строка скрипта.'],
          [3, ['f (продолжение)', 'console.log'], ['log p'], ['таймер → log t'], 'a c b', 'Стек опустел — микрозадачи по порядку. f продолжилась с места, где остановилась.'],
          [7, ['колбэк then'], [], ['таймер → log t'], 'a c b p', 'Вторая микрозадача.'],
          [5, ['колбэк таймера'], [], [], 'a c b p t', 'Микрозадачи кончились — теперь таймер.'],
        ],
      },
      nested: {
        title: 'микрозадача в таймере',
        code: [
          'setTimeout(() => {',
          "  console.log('t1');",
          "  Promise.resolve().then(() => console.log('p1'));",
          '}, 0);',
          "setTimeout(() => console.log('t2'), 0);",
        ],
        steps: [
          [0, ['скрипт', 'setTimeout'], [], ['таймер 1'], '', 'Первый таймер.'],
          [4, ['скрипт', 'setTimeout'], [], ['таймер 1', 'таймер 2 → log t2'], '', 'Второй таймер. Оба истекут одновременно.'],
          [-1, [], [], ['таймер 1', 'таймер 2 → log t2'], '', 'Скрипт закончен, микрозадач нет. Берём первую макрозадачу.'],
          [1, ['колбэк таймера 1', 'console.log'], [], ['таймер 2 → log t2'], 't1', 'Выполняется первый таймер.'],
          [2, ['колбэк таймера 1', 'then'], ['log p1'], ['таймер 2 → log t2'], 't1', 'Внутри него ставится микрозадача.'],
          [2, ['колбэк then'], [], ['таймер 2 → log t2'], 't1 p1', 'Макрозадача закончилась — сначала все микрозадачи, и только потом следующий таймер. (В Node до 11-й версии было t1 t2 p1.)'],
          [4, ['колбэк таймера 2'], [], [], 't1 p1 t2', 'Теперь второй таймер.'],
        ],
      },
    };
    let snip = 'basic', step = 0;
    const codeEl = h('pre', { class: 'code el-code' });
    const stackEl = h('div', { class: 'el-stack' });
    const microEl = h('div', { class: 'queue' });
    const macroEl = h('div', { class: 'queue' });
    const outEl = h('div', { class: 'el-out' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { step++; render(); } }, 'Шаг');
    const backBtn = h('button', { class: 'btn', onclick: () => { step--; render(); } }, 'Назад');
    root.append(
      modeButtons(Object.entries(SNIPPETS).map(([k, s]) => [k, s.title]), snip, k => { snip = k; step = 0; render(); }),
      codeEl,
      h('div', { class: 'el-grid' },
        h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'стек вызовов'), stackEl),
        h('div', { class: 'el-qs' },
          h('div', { class: 'el-box micro' }, h('span', { class: 'label' }, 'микрозадачи'), microEl),
          h('div', { class: 'el-box macro' }, h('span', { class: 'label' }, 'макрозадачи'), macroEl),
          h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'вывод'), outEl))),
      h('div', { class: 'controls' }, stepBtn, backBtn, h('button', { class: 'btn', onclick: () => { step = 0; render(); } }, 'Сначала')),
      logEl,
    );
    function render() {
      const s = SNIPPETS[snip];
      const [line, stack, micro, macro, out, note] = s.steps[step];
      codeEl.innerHTML = '<code>' + s.code.map((l, i) => `<span class="ln${i === line ? ' cur' : ''}">${highlight(l, 'js') || ' '}</span>`).join('') + '</code>';
      stackEl.innerHTML = stack.length ? stack.slice().reverse().map((f, i) => `<span class="frame${i === 0 ? ' top' : ''}">${f}</span>`).join('') : '<span class="empty">пусто</span>';
      const chips = (list, cls) => list.length ? list.map(x => `<span class="task ${cls}">${x}</span>`).join('') : '<span class="empty">пусто</span>';
      microEl.innerHTML = chips(micro, 'mi');
      macroEl.innerHTML = chips(macro, 'ma');
      outEl.innerHTML = out ? out.split(' ').map(x => `<span class="val">${x}</span>`).join('') : '<span class="empty">—</span>';
      const last = step === s.steps.length - 1;
      logEl.innerHTML = `<b>${step + 1}/${s.steps.length}.</b> ${note}` + (last ? ' <b>Итог: ' + out + '</b>' : '');
      logEl.className = 'log' + (last ? ' ok' : '');
      stepBtn.disabled = last;
      backBtn.disabled = step === 0;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- async function as a state machine
  Deck.demo('statemachine', root => {
    const SRC = [
      'async function load(id) {',
      '  const user = await db.get(id);',
      '  const posts = await api.posts(user);',
      '  return posts.length;',
      '}',
    ];
    const GEN = [
      'function load(id) {',
      '  const f = { state: 0, id, user: null };',
      '  const { promise, resolve } = Promise.withResolvers();',
      '  function resume(value) {',
      '    switch (f.state) {',
      '      case 0:',
      '        f.state = 1;',
      '        db.get(f.id).then(resume); return;',
      '      case 1:',
      '        f.user = value; f.state = 2;',
      '        api.posts(f.user).then(resume); return;',
      '      case 2:',
      '        resolve(value.length);',
      '    }',
      '  }',
      '  resume();',
      '  return promise;',
      '}',
    ];
    // [src line, gen lines, stack, frame, promise, note]
    const STEPS = [
      [0, [0, 1, 2, 15], ['handler', 'load'], { state: 0, id: 7, user: 'null' }, 'ещё нет', 'Вызов load(7): в куче создаётся объект-кадр f, затем запускается первый кусок.'],
      [1, [5, 6, 7], ['handler', 'load', 'resume'], { state: 1, id: 7, user: 'null' }, 'ещё нет', 'Кусок 0: запрос в БД отправлен, state = 1, return. Ждать здесь некому и незачем.'],
      [1, [16], ['handler'], { state: 1, id: 7, user: 'null' }, 'pending', 'load вернула промис в ожидании. Стек освобождён: от функции остался только объект в куче — несколько десятков байт.'],
      [1, [], [], { state: 1, id: 7, user: 'null' }, 'pending', 'Поток свободен: цикл событий обслуживает другие запросы, пока БД отвечает.'],
      [2, [8, 9, 10], ['цикл событий', 'resume'], { state: 2, id: 7, user: '{ name: "ann" }' }, 'pending', 'Ответ БД пришёл: микрозадача вызывает resume(user). Switch по state = 1 продолжает с нужного места. user сохранён в кадре — он понадобится после следующего await.'],
      [2, [], [], { state: 2, id: 7, user: '{ name: "ann" }' }, 'pending', 'Снова пауза: стек пуст, ждём api.posts.'],
      [3, [11, 12], ['цикл событий', 'resume'], { state: 2, id: 7, user: '{ name: "ann" }' }, 'выполнен: 3', 'Пришли посты: case 2 выполняет return — промис load выполнен, и тот, кто его ждал, продолжит в следующей микрозадаче.'],
    ];
    let step = 0;
    const src = h('pre', { class: 'code sm-src' });
    const gen = h('pre', { class: 'code sm-gen' });
    const stackEl = h('div', { class: 'el-stack' });
    const frameEl = h('div', { class: 'sm-frame' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { step++; render(); } }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => { step = 0; render(); } }, 'Сначала')),
      src,
      h('div', { class: 'sm-tabs' }, h('span', { class: 'label' }, 'во что это превращается (упрощённо)')),
      gen,
      h('div', { class: 'sm-grid' },
        h('div', { class: 'el-box' }, h('span', { class: 'label' }, 'стек потока'), stackEl),
        h('div', { class: 'el-box heap' }, h('span', { class: 'label' }, 'куча: кадр f'), frameEl)),
      logEl,
    );
    const lines = (arr, cur) => '<code>' + arr.map((l, i) => `<span class="ln${cur.includes(i) ? ' cur' : ''}">${highlight(l, 'js')}</span>`).join('') + '</code>';
    function render() {
      const [sl, gl, stack, frame, prom, note] = STEPS[step];
      src.innerHTML = lines(SRC, [sl]);
      gen.innerHTML = lines(GEN, gl);
      stackEl.innerHTML = stack.length ? stack.slice().reverse().map((f, i) => `<span class="frame${i === 0 ? ' top' : ''}">${f}</span>`).join('') : '<span class="empty">пусто — поток свободен</span>';
      frameEl.innerHTML = Object.entries(frame).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('') + `<div><span>промис</span><b>${prom}</b></div>`;
      logEl.innerHTML = `<b>${step + 1}/${STEPS.length}.</b> ${note}`;
      logEl.className = 'log' + (step === STEPS.length - 1 ? ' ok' : '');
      stepBtn.disabled = step === STEPS.length - 1;
      const cur = gen.querySelector('.cur');
      if (cur) gen.scrollTop += cur.getBoundingClientRect().top - gen.getBoundingClientRect().top - 24;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- blocking the event loop
  Deck.demo('blockloop', root => {
    const RATE = 200, REQ = 0.002, HEAVY = 0.3, CHUNK = 0.01, WINDOW = 6;
    let mode = 'main', now, queue, cur, worker, points, nextArr, heavyId, heavyDone, heavyStart = null, reportAt = null, worstSince = 0;
    const canvas = h('canvas', { class: 'bl-canvas', height: 320 });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const heavyBtn = h('button', { class: 'btn primary', onclick: heavy }, 'Тяжёлая задача: 300 мс');
    root.append(
      modeButtons([['main', 'в основном потоке'], ['chunk', 'кусками по 10 мс'], ['worker', 'в worker_threads']], mode, m => { mode = m; say(MODE_TEXT[m]); }),
      h('div', { class: 'controls' }, heavyBtn),
      h('div', { class: 'bl-wrap' }, canvas, h('span', { class: 'bl-y' }, 'задержка каждого запроса, лог. шкала')),
      stats, logEl,
    );
    const MODE_TEXT = {
      main: 'Задача выполняется прямо в обработчике запроса, как синхронный <code>JSON.parse</code> или <code>bcrypt.hashSync</code>.',
      chunk: 'Задача считает 10 мс и отдаёт управление через <code>setImmediate</code>: между кусками цикл успевает обслужить других.',
      worker: 'Задача уходит в отдельный поток со своим циклом событий. Основной поток только отправляет и получает сообщение.',
    };
    function reset() {
      now = 0; queue = []; cur = null; worker = null; points = []; nextArr = 0; heavyId = 0; heavyDone = null;
    }
    function heavy() {
      heavyId++;
      heavyStart = now; worstSince = 0; reportAt = null;
      if (mode === 'main') queue.push({ kind: 'heavy', arr: now, left: HEAVY });
      else if (mode === 'chunk') queue.push({ kind: 'chunk', arr: now, left: HEAVY });
      else queue.push({ kind: 'post', arr: now, left: 0.0005 });
      heavyBtn.disabled = true;
    }
    function finish(job) {
      if (job.kind === 'req') {
        points.push([now, now - job.arr]);
        if (heavyStart != null) worstSince = Math.max(worstSince, now - job.arr);
      }
      else if (job.kind === 'heavy' || job.kind === 'chunk' || job.kind === 'reply') {
        heavyDone = now - job.arr0;
        heavyBtn.disabled = false;
        reportAt = now + 0.4; // let the backlog drain before summing up
      } else if (job.kind === 'post') worker = { left: HEAVY, arr0: job.arr };
    }
    function report() {
      const mx = worstSince * 1000;
      heavyStart = null;
      if (mode === 'main') say(`Пока шли 300 мс счёта, цикл стоял: накопилось ~${Math.round(HEAVY * RATE)} запросов, худший ждал ${Math.round(mx)} мс. Health check с таймаутом в 200 мс уже решил бы, что сервер мёртв.`, 'bad');
      else if (mode === 'chunk') say(`Задача заняла ${Math.round(heavyDone * 1000)} мс вместо 300 — делила поток с остальными, — зато задержка других не выросла выше ~${Math.max(12, Math.round(mx))} мс.`, 'ok');
      else say(`Задача посчиталась на другом ядре за ${Math.round(heavyDone * 1000)} мс, остальные запросы этого не заметили. Цена — копирование данных между потоками.`, 'ok');
    }
    function tick(dt) {
      const end = now + dt;
      while (now < end) {
        // arrivals
        while (nextArr <= now) {
          queue.push({ kind: 'req', arr: nextArr, left: REQ });
          nextArr += -Math.log(1 - Math.random()) / RATE;
        }
        let step = Math.min(end, nextArr) - now;
        if (worker) step = Math.min(step, worker.left);
        if (!cur && queue.length) {
          cur = queue.shift();
          if (cur.arr0 == null) cur.arr0 = cur.arr;
          cur.slice = cur.kind === 'chunk' ? Math.min(CHUNK, cur.left) : cur.left;
        }
        if (cur) step = Math.min(step, cur.slice);
        step = Math.max(step, 1e-6);
        now += step;
        if (worker) {
          worker.left -= step;
          if (worker.left <= 1e-9) { queue.push({ kind: 'reply', arr: now, arr0: worker.arr0, left: 0.0005 }); worker = null; }
        }
        if (cur) {
          cur.left -= step; cur.slice -= step;
          if (cur.left <= 1e-9) { const j = cur; cur = null; finish(j); }
          else if (cur.slice <= 1e-9) { queue.push(cur); cur = null; } // yield: back to the end of the queue
        }
      }
      points = points.filter(p => p[0] > now - WINDOW);
      if (reportAt != null && now >= reportAt) { reportAt = null; report(); }
    }
    function draw() {
      const w = canvas.clientWidth;
      if (canvas.width !== w * 2) { canvas.width = w * 2; }
      const H = canvas.height, W = canvas.width;
      const ctx = canvas.getContext('2d');
      const css = getComputedStyle(root);
      ctx.clearRect(0, 0, W, H);
      // Log scale from 1 ms to 500 ms.
      const Y = l => H - 6 - (Math.log10(Math.min(500, Math.max(1, l * 1000))) / Math.log10(500)) * (H - 12);
      ctx.strokeStyle = css.getPropertyValue('--line').trim() || '#ddd';
      ctx.lineWidth = 2;
      ctx.font = '22px ' + (css.getPropertyValue('--font').trim() || 'sans-serif');
      for (const v of [0.001, 0.01, 0.1]) {
        const y = Y(v);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillStyle = css.getPropertyValue('--muted').trim() || '#666';
        ctx.fillText(Math.round(v * 1000) + ' мс', 8, y - 6);
      }
      const accent = css.getPropertyValue('--accent').trim(), bad = css.getPropertyValue('--block').trim();
      for (const [t, l] of points) {
        const x = W - ((now - t) / WINDOW) * W;
        ctx.fillStyle = l > 0.05 ? bad : accent;
        ctx.fillRect(x - 3, Y(l) - 3, 6, 6);
      }
    }
    function pct(arr, p) {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(p * s.length))];
    }
    let acc = 0;
    function render() {
      draw();
      acc = 0;
      const recent = points.filter(p => p[0] > now - 2).map(p => p[1] * 1000);
      const p50 = pct(recent, 0.5), p99 = pct(recent, 0.99);
      stats.innerHTML = `<div class="stat"><b>${dec(p50, p50 < 10 ? 1 : 0)} мс</b><span>медиана, 2 с</span></div>` +
        `<div class="stat ${p99 > 50 ? 'warn' : ''}"><b>${Math.round(p99)} мс</b><span>p99, 2 с</span></div>` +
        `<div class="stat"><b>${heavyDone != null ? Math.round(heavyDone * 1000) + ' мс' : '—'}</b><span>тяжёлая задача</span></div>`;
    }
    reset();
    say('Поток обслуживает ~200 запросов в секунду, каждый по 2 мс: занят на 40%. Задержка — пара миллисекунд.');
    const loop = rafLoop(dt => {
      tick(dt);
      acc += dt;
      if (acc > 0.05) render();
    });
    return loop;
  });

  // ---------------------------------------------------------------- libuv thread pool
  Deck.demo('threadpool', root => {
    const CORES = 8;
    const POOL = [1, 2, 4, 8, 16, 32, 64];
    const TASKS = [1, 2, 4, 6, 8, 12, 16];
    let kind = 'cpu';
    const TYPES = { cpu: { name: 'crypto.pbkdf2', dur: 100, cpu: true }, dns: { name: 'dns.lookup', dur: 50, cpu: false } };
    root.append(modeButtons([['cpu', 'crypto.pbkdf2 — 100 мс CPU'], ['dns', 'dns.lookup — 50 мс ожидания']], kind, k => { kind = k; update(); }));
    const P = slider(root, 'UV_THREADPOOL_SIZE', POOL, 2, String, update);
    const N = slider(root, 'Одновременных вызовов', TASKS, 4, String, update);
    const gantt = h('div', { class: 'tp' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(gantt, stats, logEl);

    // Processor-sharing simulation: tasks queue FIFO for pool threads; CPU tasks share CORES.
    function simulate(n, p, type) {
      const tasks = Array.from({ length: n }, (_, i) => ({ i, left: type.dur, start: null, end: null, thread: null }));
      const free = Array.from({ length: Math.min(p, 64) }, (_, i) => i);
      let t = 0;
      const running = [];
      let q = tasks.slice();
      while (q.length || running.length) {
        while (free.length && q.length) { const tk = q.shift(); tk.thread = free.shift(); tk.start = t; running.push(tk); }
        const speed = type.cpu ? Math.min(1, CORES / running.length) : 1;
        const dtNext = Math.min(...running.map(r => r.left / speed));
        t += dtNext;
        for (const r of running) r.left -= dtNext * speed;
        for (const r of running.filter(r => r.left <= 1e-6)) { r.end = t; free.push(r.thread); free.sort((a, b) => a - b); }
        running.splice(0, running.length, ...running.filter(r => r.left > 1e-6));
      }
      return { tasks, total: t };
    }
    function update() {
      const type = TYPES[kind], p = P(), n = N();
      const { tasks, total } = simulate(n, p, type);
      const threadsUsed = Math.min(p, n);
      const scale = Math.max(total, 400);
      let html = '';
      const rows = Math.min(p, Math.max(n, 4), 16);
      for (let th = 0; th < rows; th++) {
        const mine = tasks.filter(t => t.thread === th);
        html += `<div class="tp-row"><span class="tp-name">поток ${th + 1}</span><div class="tp-lane">` +
          mine.map(t => `<i class="${type.cpu ? 'cpu' : 'io'}${t.end - t.start > type.dur * 1.05 ? ' slow' : ''}" style="left:${(t.start / scale) * 100}%;width:${((t.end - t.start) / scale) * 100}%">${t.i + 1}</i>`).join('') +
          '</div></div>';
      }
      if (p > rows) html += `<div class="tp-more">…и ещё ${p - rows} ${plural(p - rows, ['поток', 'потока', 'потоков'])} без работы</div>`;
      html += `<div class="tp-axis"><span>0</span><span>${Math.round(scale / 2)} мс</span><span>${Math.round(scale)} мс</span></div>`;
      gantt.innerHTML = html;
      const waited = tasks.filter(t => t.start > 0).length;
      const first = Math.min(...tasks.map(t => t.end));
      stats.innerHTML = `<div class="stat"><b>${Math.round(first)} мс</b><span>первый готов</span></div>` +
        `<div class="stat ${total > type.dur * 1.5 ? 'warn' : ''}"><b>${Math.round(total)} мс</b><span>последний готов</span></div>` +
        `<div class="stat ${waited ? 'warn' : ''}"><b>${waited}</b><span>${plural(waited, ['ждал', 'ждали', 'ждали'])} в очереди</span></div>`;
      if (waited) logEl.innerHTML = `Свободных потоков ${p}, а вызовов ${n}: ${waited} ${plural(waited, ['стоит', 'стоят', 'стоят'])} в очереди пула. Всё остальное, что ходит через пул, — <code>fs</code>, <code>zlib</code> — встанет за ними.`;
      else if (type.cpu && threadsUsed > CORES) logEl.innerHTML = `Потоков больше, чем ядер (${CORES}): никто не ждёт в очереди, но все делят процессор и каждый считает дольше 100 мс. Для счёта больше потоков, чем ядер, не помогает.`;
      else logEl.innerHTML = `Потоков хватает: все ${n} ${plural(n, ['вызов', 'вызова', 'вызовов'])} ${n === 1 ? 'выполняется' : 'выполняются'} сразу.${type.cpu ? '' : ' Для ожидания (DNS, медленный диск) большой пул безопасен: потоки спят, не занимая CPU.'}`;
      logEl.className = 'log' + (waited ? ' warn' : ' ok');
    }
    update();
    return {};
  });
})();
