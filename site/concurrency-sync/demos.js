// Demos for slides 2–8: data race step-through, lost updates, booking race, mutex, futex, deadlock.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '', fresh = false) => {
      if (fresh) lines.length = 0;
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  const logBox = () => h('div', { class: 'log', 'aria-live': 'polite' });

  // ---------------------------------------------------------------- counter++ step by step
  Deck.demo('race-step', root => {
    const OPS = ['load', 'add', 'store'];
    const CODE = ['r = x', 'r = r + 1', 'x = r'];
    let x, th, trace;
    const mem = h('div', { class: 'rs-mem' });
    const cols = h('div', { class: 'rs-cols' });
    const traceEl = h('div', { class: 'rs-trace' });
    const logEl = logBox();
    const say = logger(logEl);
    const b1 = h('button', { class: 'btn primary t1b', onclick: () => step(0) }, 'Шаг T1');
    const b2 = h('button', { class: 'btn primary t2b', onclick: () => step(1) }, 'Шаг T2');
    let timer = 0;
    root.append(
      h('div', { class: 'controls' }, b1, b2,
        h('button', { class: 'btn', onclick: showBad }, 'Показать потерю'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      mem, cols, traceEl, logEl);

    function reset() {
      clearInterval(timer); timer = 0;
      x = 0; trace = [];
      th = [{ pc: 0, r: null }, { pc: 0, r: null }];
      say('Каждый поток делает <code>x++</code> один раз. Ожидаем x = 2. Нажимайте «Шаг T1» и «Шаг T2» в любом порядке.', '', true);
      render();
    }
    function step(i) {
      const t = th[i], name = 'T' + (i + 1);
      if (t.pc > 2) return;
      const op = t.pc;
      if (op === 0) { t.r = x; say(`${name}: load — прочитал x = ${x} в свой регистр.`); }
      else if (op === 1) { t.r += 1; say(`${name}: add — в регистре теперь ${t.r}. В памяти x всё ещё ${x}.`); }
      else {
        const before = x;
        x = t.r;
        say(`${name}: store — записал ${t.r} в x` + (before === t.r ? ` поверх такого же ${before}: работа второго потока затёрта.` : '.'), before === t.r ? 'warn' : '');
      }
      trace.push([i, OPS[op]]);
      t.pc++;
      if (th[0].pc > 2 && th[1].pc > 2) {
        if (x === 2) say('Готово: x = 2. Повезло — окна load…store не пересеклись. Попробуйте начать оба потока с load.', 'ok');
        else say('Готово: x = 1, а ожидали 2. Оба потока прочитали 0 и оба записали 1 — одно обновление потеряно.', 'bad');
      }
      render();
    }
    function showBad() {
      reset();
      const seq = [0, 1, 0, 1, 0, 1];
      let k = 0;
      timer = setInterval(() => { step(seq[k++]); if (k >= seq.length) { clearInterval(timer); timer = 0; } }, 700);
    }
    function render() {
      mem.innerHTML = `<span class="label">память</span><b>x = ${x}</b>`;
      cols.innerHTML = th.map((t, i) => `<div class="rs-th t${i + 1}"><div class="rs-head">T${i + 1}<span>регистр: <b>${t.r ?? '—'}</b></span></div>` +
        OPS.map((op, k) => `<div class="rs-op ${k < t.pc ? 'done' : k === t.pc ? 'cur' : ''}"><span>${op}</span><code>${CODE[k]}</code></div>`).join('') +
        '</div>').join('');
      traceEl.innerHTML = '<span class="label">порядок:</span>' + (trace.length ? trace.map(([i, op]) => `<span class="chip t${i + 1}">T${i + 1} ${op}</span>`).join('') : '<span class="empty">пока ничего</span>');
      b1.disabled = th[0].pc > 2 || !!timer;
      b2.disabled = th[1].pc > 2 || !!timer;
    }
    reset();
    return { stop() { clearInterval(timer); timer = 0; render(); } };
  });

  // ---------------------------------------------------------------- lost updates, automatic run
  Deck.demo('race-run', root => {
    const PER = 5000;
    let n = 4, mode = 'multi', threads, x, running = false, quantum = 0, curT = 0, events = 0;
    const out = h('output');
    const slider = h('input', { type: 'range', min: 1, max: 8, value: n, 'aria-label': 'Число потоков' });
    slider.addEventListener('input', () => { n = +slider.value; out.textContent = n; reset(); });
    out.textContent = n;
    const modeBtns = [['multi', 'много ядер'], ['single', 'одно ядро'], ['atomic', 'atomic.Add']].map(([m, label]) =>
      h('button', { class: 'btn small', onclick: () => { mode = m; reset(); } }, label));
    const runBtn = h('button', { class: 'btn primary', onclick: run }, 'Запустить');
    const bars = h('div', { class: 'rr-bars' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'потоков'), slider, out),
      h('div', { class: 'controls' }, ...modeBtns),
      h('div', { class: 'controls' }, runBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      bars, stats, logEl);

    function reset() {
      running = false;
      x = 0;
      threads = Array.from({ length: n }, () => ({ done: 0, pc: 0, r: 0 }));
      quantum = 0; curT = 0; events = 0;
      modeBtns.forEach((b, i) => b.classList.toggle('sel', ['multi', 'single', 'atomic'][i] === mode));
      runBtn.disabled = false;
      say(`${n} ${plural(n, ['поток', 'потока', 'потоков'])} × ${fmt(PER)} инкрементов. Нажмите «Запустить».`, '', true);
      render();
    }
    function run() { if (threads.every(t => t.done === PER)) reset(); running = true; runBtn.disabled = true; }
    const alive = () => threads.map((t, i) => i).filter(i => threads[i].done < PER);
    // One micro-operation of one thread: load, add or store (atomic mode does all three at once).
    function micro(i) {
      const t = threads[i];
      if (mode === 'atomic') { x++; t.done++; return; }
      // load, add, store, then loop bookkeeping (i++, cmp/jmp) where a switch is harmless.
      if (t.pc === 0) t.r = x;
      else if (t.pc === 1) t.r++;
      else if (t.pc === 2) { if (x !== t.r - 1) events++; x = t.r; t.done++; }
      t.pc = (t.pc + 1) % 5;
    }
    function tick(steps) {
      for (let s = 0; s < steps; s++) {
        const a = alive();
        if (!a.length) { finish(); return; }
        if (mode === 'single') {
          // One core: a thread runs a whole time slice, then the scheduler switches (possibly between load and store).
          if (quantum <= 0 || threads[curT].done >= PER) { curT = a[Math.floor(Math.random() * a.length)]; quantum = 15000 + Math.floor(Math.random() * 25000); }
          micro(curT); quantum--;
        } else {
          micro(a[Math.floor(Math.random() * a.length)]);
        }
      }
    }
    function finish() {
      running = false;
      runBtn.disabled = false;
      const exp = n * PER, lost = exp - x;
      if (!lost) say(mode === 'atomic' ? 'Ни одного потерянного обновления: каждый инкремент — одна неделимая инструкция.' : 'Потерь нет: один поток не с кем гонять.', 'ok');
      else if (mode === 'single') say(`Потеряно ${fmt(lost)}, а затирание случилось всего ${events} ${plural(events, ['раз', 'раза', 'раз'])}: поток вытеснили между load и store, и, вернувшись, он записал старое значение поверх всего, что другие насчитали за его отсутствие.`, 'warn');
      else say(`Потеряно ${fmt(lost)} из ${fmt(exp)} (${Math.round((lost / exp) * 100)}%), чужую запись затёрли ${fmt(events)} ${plural(events, ['раз', 'раза', 'раз'])}. Каждый прогон даст другое число — поэтому такие баги трудно воспроизвести.`, 'bad');
      render();
    }
    function render() {
      bars.innerHTML = threads.map((t, i) => `<div class="rr-row"><span>T${i + 1}</span><span class="track"><span class="fill" style="width:${(t.done / PER) * 100}%"></span></span></div>`).join('');
      const exp = threads.reduce((s, t) => s + t.done, 0);
      stats.innerHTML = `<div class="stat"><b>${fmt(exp)}</b><span>сделано x++</span></div>` +
        `<div class="stat"><b>${fmt(x)}</b><span>значение x</span></div>` +
        `<div class="stat ${exp - x > 0 ? 'warn' : ''}"><b>${fmt(exp - x)}</b><span>потеряно</span></div>`;
    }
    reset();
    const loop = rafLoop(dt => { if (running) { tick(Math.round(dt * 60000)); render(); } });
    return loop;
  });

  // ---------------------------------------------------------------- booking: check-then-act across instances
  Deck.demo('booking', root => {
    const SCRIPTS = {
      naive: {
        label: 'Наивно',
        steps: [
          ['A', "SELECT owner FROM seats WHERE id = '12A'", 'NULL — свободно', { A: 'место свободно, иду бронировать' }, 'Алиса проверила: место свободно.'],
          ['B', "SELECT owner FROM seats WHERE id = '12A'", 'NULL — свободно', { B: 'место свободно, иду бронировать' }, 'Боб проверил в ту же миллисекунду — Алиса ещё ничего не записала, место свободно.'],
          ['A', "UPDATE seats SET owner = 'alice' WHERE id = '12A'", 'UPDATE 1', { owner: 'alice', A: '✓ билет выписан, деньги списаны' }, 'Алиса записала себя. Боб уже прошёл проверку и об этом не знает.'],
          ['B', "UPDATE seats SET owner = 'bob' WHERE id = '12A'", 'UPDATE 1', { owner: 'bob', B: '✓ билет выписан, деньги списаны' }],
        ],
        end: ['Оба получили билет и оба заплатили, а место записано за Бобом. Каждый запрос по отдельности атомарен — сломался порядок «проверил, потом сделал».', 'bad'],
      },
      mutex: {
        label: 'Мьютекс в коде',
        steps: [
          ['A', 'bookingMu.Lock()  // экземпляр 1', 'захвачен', { A: 'держит мьютекс экземпляра 1' }, 'Экземпляр 1 захватил свой мьютекс.'],
          ['B', 'bookingMu.Lock()  // экземпляр 2', 'захвачен', { B: 'держит мьютекс экземпляра 2' }, 'Экземпляр 2 тоже захватил — свой. Мьютексы разные, ожидания нет.'],
          ['A', "SELECT owner FROM seats WHERE id = '12A'", 'NULL — свободно', { A: 'место свободно' }, 'Алиса видит свободное место.'],
          ['B', "SELECT owner FROM seats WHERE id = '12A'", 'NULL — свободно', { B: 'место свободно' }, 'Боб тоже: запись Алисы ещё не сделана.'],
          ['A', "UPDATE seats SET owner = 'alice' WHERE id = '12A'", 'UPDATE 1', { owner: 'alice', A: '✓ билет выписан' }, 'Алиса записала себя.'],
          ['B', "UPDATE seats SET owner = 'bob' WHERE id = '12A'", 'UPDATE 1', { owner: 'bob', B: '✓ билет выписан' }],
        ],
        end: ['Мьютекс живёт в памяти одного процесса. За балансировщиком два экземпляра — у каждого свой мьютекс, и они друг другу не мешают. Двойная бронь.', 'bad'],
      },
      cond: {
        label: 'UPDATE … WHERE',
        steps: [
          ['A', "UPDATE seats SET owner = 'alice'\n WHERE id = '12A' AND owner IS NULL", 'UPDATE 1', { owner: 'alice', A: '✓ строка изменена — билет выписан' }, 'Проверка «owner IS NULL» и запись выполнены одним оператором под блокировкой строки.'],
          ['B', "UPDATE seats SET owner = 'bob'\n WHERE id = '12A' AND owner IS NULL", 'UPDATE 0', { B: '✗ 0 строк — «место уже занято»' }],
        ],
        end: ['Проверка и запись — одна операция в базе. Если транзакция Алисы ещё не закоммичена, UPDATE Боба подождёт блокировку строки и перепроверит условие. Самый простой и быстрый вариант.', 'ok'],
      },
      forupd: {
        label: 'SELECT … FOR UPDATE',
        steps: [
          ['A', "BEGIN;\nSELECT owner FROM seats WHERE id = '12A' FOR UPDATE", 'NULL — строка заблокирована', { lock: 'A', A: 'держит блокировку строки' }, 'Алиса прочитала строку и заблокировала её до конца транзакции.'],
          ['B', "BEGIN;\nSELECT owner FROM seats WHERE id = '12A' FOR UPDATE", 'ждёт…', { B: '⏳ ждёт блокировку строки' }, 'Боб хочет ту же строку и ждёт, пока транзакция Алисы закончится.'],
          ['A', "UPDATE seats SET owner = 'alice' WHERE id = '12A';\nCOMMIT", 'COMMIT', { owner: 'alice', lock: 'B', A: '✓ билет выписан', B: 'получил строку: owner = alice' }],
          ['B', 'ROLLBACK', 'место занято', { lock: '', B: '✗ «место уже занято»' }],
        ],
        end: ['Пессимистичная блокировка: второй ждёт, пока первый закончит, и видит уже обновлённую строку. Подходит, когда между проверкой и записью нужна логика в приложении.', 'ok'],
      },
    };
    let key = 'naive', k, st;
    const tabs = Object.entries(SCRIPTS).map(([id, s]) => h('button', { class: 'btn small', onclick: () => { key = id; reset(); } }, s.label));
    const lanes = h('div', { class: 'bk-lanes' });
    const db = h('div', { class: 'bk-db' });
    const sql = h('pre', { class: 'bk-sql' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, ...tabs), lanes, sql, db, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')), logEl);

    function reset() {
      k = 0;
      st = { owner: null, lock: '', A: 'отправила запрос', B: 'отправил запрос', who: '' };
      tabs.forEach((b, i) => b.classList.toggle('sel', Object.keys(SCRIPTS)[i] === key));
      sql.textContent = '-- запросы появятся здесь';
      sql.className = 'bk-sql';
      say('Место 12A свободно. Алиса и Боб нажали «Купить» в одну и ту же секунду. Нажимайте «Шаг».', '', true);
      render();
    }
    function step() {
      const s = SCRIPTS[key];
      if (k >= s.steps.length) return;
      const [who, q, res, eff, note] = s.steps[k++];
      Object.assign(st, eff, { who });
      sql.textContent = `${who === 'A' ? 'Алиса' : 'Боб'}> ${q}\n→ ${res}`;
      sql.className = 'bk-sql ' + who;
      if (k >= s.steps.length) say(...s.end);
      else say(`Шаг ${k} из ${s.steps.length}. ${note || ''}`);
      render();
    }
    function render() {
      lanes.innerHTML = [['A', 'Алиса', 'экземпляр 1'], ['B', 'Боб', 'экземпляр 2']].map(([id, name, inst]) =>
        `<div class="bk-lane ${id} ${st.who === id ? 'act' : ''}"><b>${name}</b><span class="label">${inst}</span><span class="bk-st">${st[id]}</span></div>`).join('');
      db.innerHTML = `<span class="label">Postgres · seats</span><span class="bk-row">12A · owner = <b>${st.owner ?? 'NULL'}</b>` +
        (st.lock ? ` <span class="bk-lock">🔒 ${st.lock === 'A' ? 'Алиса' : 'Боб'}</span>` : '') + '</span>';
      stepBtn.disabled = k >= SCRIPTS[key].steps.length;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- mutex: timeline of who holds and who waits
  Deck.demo('mutex', root => {
    const W = 64, CYCLE = 20, TICK = 0.09;
    let n = 4, frac = 0.25, threads, owner, queue, hist, t, acc, done, waitTicks, busyTicks, window;
    const mk = (label, min, max, val, fmtv, set) => {
      const out = h('output');
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      const upd = () => { out.textContent = fmtv(+input.value); set(+input.value); };
      input.addEventListener('input', () => { upd(); reset(); });
      upd();
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label mx-l' }, label), input, out));
    };
    mk('потоков', 1, 8, n, v => v, v => { n = v; });
    mk('под замком', 1, 16, 4, v => Math.round((v / CYCLE) * 100) + '%', v => { frac = v / CYCLE; });
    const grid = h('div', { class: 'mx-grid' });
    const legend = h('div', { class: 'mx-legend' }, h('span', null, h('span', { class: 'sw w' }), 'работа без замка'), h('span', null, h('span', { class: 'sw c' }), 'под замком'), h('span', null, h('span', { class: 'sw q' }), 'ждёт замок'));
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    root.append(grid, legend, stats, logEl);

    function reset() {
      threads = Array.from({ length: n }, (_, i) => ({ st: 'w', left: 1 + Math.floor(Math.random() * CYCLE) + i }));
      owner = -1; queue = []; t = 0; acc = 0; done = 0; waitTicks = 0; busyTicks = 0; window = [];
      hist = threads.map(() => []);
      for (let i = 0; i < W; i++) tickOnce(); // fill the timeline right away
      render();
    }
    const csLen = () => Math.max(1, Math.round(frac * CYCLE));
    function tickOnce() {
      t++;
      const c = csLen();
      threads.forEach((th, i) => {
        if (th.st === 'w' && --th.left <= 0) { th.st = 'q'; queue.push(i); }
        else if (th.st === 'c' && --th.left <= 0) {
          th.st = 'w'; th.left = Math.max(1, Math.round((CYCLE - c) * (0.4 + Math.random() * 1.2))); owner = -1; done++; window.push(t);
        }
      });
      if (owner < 0 && queue.length) { owner = queue.shift(); threads[owner].st = 'c'; threads[owner].left = c; }
      threads.forEach((th, i) => {
        hist[i].push(th.st);
        if (hist[i].length > W) hist[i].shift();
        if (th.st === 'q') waitTicks++;
        busyTicks++;
      });
      while (window.length && window[0] <= t - 200) window.shift();
    }
    function render() {
      grid.innerHTML = hist.map((row, i) => `<div class="mx-row"><span>T${i + 1}</span><div class="mx-cells">` +
        row.map(s => `<i class="${s}"></i>`).join('') + '</div></div>').join('');
      const span = Math.min(t, 200) || 1;
      const speed = (window.length / span) * CYCLE; // completions per cycle = speedup over one thread
      const limit = CYCLE / csLen();
      const waitPct = busyTicks ? Math.round((waitTicks / busyTicks) * 100) : 0;
      stats.innerHTML = `<div class="stat"><b>${fmt(done)}</b><span>x++ сделано, ни одного не потеряно</span></div>` +
        `<div class="stat ${waitPct > 30 ? 'warn' : ''}"><b>${waitPct}%</b><span>времени потоки ждут</span></div>` +
        `<div class="stat"><b>${t > 40 ? speed.toFixed(1).replace('.', ',') : '…'}×</b><span>ускорение (предел ${Math.min(n, limit).toFixed(1).replace('.', ',')}×)</span></div>`;
      const u = n / limit, lim = limit.toFixed(1).replace('.', ',');
      logEl.className = 'log ' + (u >= 1 ? 'bad' : u >= 0.6 ? 'warn' : 'ok');
      logEl.innerHTML = u >= 1
        ? `Замок нужен потокам чаще, чем он бывает свободен: в секцию входит один поток за раз, поэтому больше ${lim} операций за цикл не сделать. Новые потоки только удлиняют очередь.`
        : u >= 0.6
          ? `Замок занят ~${Math.round(u * 100)}% времени — потоки уже заметно ждут друг друга. Предел ускорения при такой доле — ${lim}×.`
          : `Замок часто свободен, потоки почти не ждут. Предел ускорения при такой доле — ${lim}×, до него ещё есть запас.`;
    }
    reset();
    return rafLoop(dt => {
      acc += dt;
      let ch = false;
      while (acc >= TICK) { acc -= TICK; tickOnce(); ch = true; }
      if (ch) render();
    });
  });

  // ---------------------------------------------------------------- futex-based mutex
  Deck.demo('futex', root => {
    // Drepper's futex mutex: 0 = free, 1 = locked, 2 = locked with waiters.
    const LONG = [
      ['T1', 'Lock(): CAS(state, 0 → 1) — успех', { s: 1, t1: 'cpu:в секции' }, 'Быстрый путь: одна атомарная инструкция, ~15 нс, ядро ОС не участвует.', 15],
      ['T2', 'Lock(): CAS(state, 0 → 1) — неудача, state = 1', { t2: 'spin:крутится' }, 'Замок занят. Сразу спать дорого — сначала покрутимся: вдруг владелец скоро выйдет.', 15],
      ['T2', 'спин: 100 × PAUSE, state всё ещё 1', { t2: 'spin:крутится' }, 'Крутился ~1 мкс, сжигая ядро. Владелец всё ещё в секции — секция длинная.', 1000],
      ['T2', 'state = 2; futex(FUTEX_WAIT, &state, 2)', { s: 2, t2: 'sleep:спит в ядре', q: ['T2'], sys: 1 }, 'Помечаем «есть ждущие» и засыпаем. Ядро атомарно проверяет, что state всё ещё 2, — иначе пробуждение могло бы потеряться — и снимает поток с CPU.', 1500],
      ['T1', 'Unlock(): exchange(state, 0) вернул 2', { s: 0, t1: 'cpu:вышел' }, 'Старое значение 2 означает, что кто-то спит. Значит, нужно звать ядро.', 15],
      ['T1', 'futex(FUTEX_WAKE, &state, 1)', { q: [], t2: 'wake:просыпается', sys: 1 }, 'Системный вызов: ядро переводит T2 в очередь готовых к запуску. Через какое-то время планировщик даст ему CPU.', 1500],
      ['T2', 'exchange(state, 2) вернул 0 — замок наш', { s: 2, t2: 'cpu:в секции' }, 'T2 занял замок, но ставит 2, а не 1: он не знает, нет ли за ним других спящих. Пробуждение с переключением контекста — единицы микросекунд.', 4000],
      ['T2', 'Unlock(): exchange вернул 2 → FUTEX_WAKE', { s: 0, t2: 'cpu:вышел', sys: 1 }, 'Лишний системный вызов: ждущих нет, но state был 2. Цена простоты алгоритма.', 1500],
    ];
    const SHORT = [
      ['T1', 'Lock(): CAS(state, 0 → 1) — успех', { s: 1, t1: 'cpu:в секции' }, 'Быстрый путь: одна атомарная инструкция, без ядра.', 15],
      ['T2', 'Lock(): CAS(state, 0 → 1) — неудача', { t2: 'spin:крутится' }, 'Замок занят — крутимся и перечитываем state.', 15],
      ['T1', 'Unlock(): exchange(state, 0) вернул 1', { s: 0, t1: 'cpu:вышел' }, 'Старое значение 1 — никто не спит, будить никого не надо. Без системного вызова.', 15],
      ['T2', 'спин: увидел state = 0, CAS(0 → 1) — успех', { s: 1, t2: 'cpu:в секции' }, 'Секция была короткой: спин окупился. Ни одного системного вызова, ожидание — сотни наносекунд.', 200],
      ['T2', 'Unlock(): exchange вернул 1', { s: 0, t2: 'cpu:вышел' }, 'Готово. Вот почему мьютексы сначала крутятся: короткие секции обходятся без сна.', 15],
    ];
    let longCS = true, k, st;
    const tabs = [['long', 'длинная секция'], ['short', 'короткая секция']].map(([id, label]) =>
      h('button', { class: 'btn small', onclick: () => { longCS = id === 'long'; reset(); } }, label));
    const view = h('div', { class: 'fx-view' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(h('div', { class: 'controls' }, ...tabs), view, stats, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')), logEl);
    const script = () => (longCS ? LONG : SHORT);

    function reset() {
      k = 0;
      st = { s: 0, t1: 'cpu:работает', t2: 'cpu:работает', q: [], sys: 0, ns: 0, op: '' };
      tabs[0].classList.toggle('sel', longCS);
      tabs[1].classList.toggle('sel', !longCS);
      say('Мьютекс свободен: state = 0. Два потока на разных ядрах хотят войти в одну секцию. Нажимайте «Шаг».', '', true);
      render();
    }
    function step() {
      const sc = script();
      if (k >= sc.length) return;
      const [who, op, eff, text, ns] = sc[k++];
      const { sys = 0, ...rest } = eff;
      Object.assign(st, rest);
      st.sys += sys;
      st.ns += ns;
      st.op = `<b>${who}</b> ${op}`;
      say(text, sys ? 'warn' : k >= sc.length ? 'ok' : '');
      render();
    }
    const card = (name, v) => {
      const [cls, text] = v.split(':');
      return `<div class="fx-th ${cls}"><b>${name}</b><span>${text}</span></div>`;
    };
    function render() {
      view.innerHTML = `<div class="fx-user"><span class="label">пространство пользователя</span>` +
        `<div class="fx-row">${card('T1', st.t1)}<div class="fx-word s${st.s}"><span>state</span><b>${st.s}</b><em>${['свободен', 'занят', 'занят, есть ждущие'][st.s]}</em></div>${card('T2', st.t2)}</div>` +
        `<div class="fx-op">${st.op || '&nbsp;'}</div></div>` +
        `<div class="fx-kernel"><span class="label">ядро: очередь futex</span>${st.q.length ? st.q.map(x => `<span class="chip t2">${x} спит</span>`).join('') : '<span class="empty">пусто</span>'}</div>`;
      const us = st.ns >= 1000 ? (st.ns / 1000).toFixed(1).replace('.', ',') + ' мкс' : st.ns + ' нс';
      stats.innerHTML = `<div class="stat ${st.sys ? 'warn' : ''}"><b>${st.sys}</b><span>системных вызовов</span></div>` +
        `<div class="stat"><b>≈ ${us}</b><span>затрачено на синхронизацию</span></div>` +
        `<div class="stat"><b>${k}/${script().length}</b><span>шаг</span></div>`;
      stepBtn.disabled = k >= script().length;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- deadlock: two transfers
  Deck.demo('deadlock', root => {
    let ordered = false, th, owner, waiting, balance;
    const view = h('div', { class: 'dl-view' });
    const logEl = logBox();
    const say = logger(logEl, 2);
    const b1 = h('button', { class: 'btn primary t1b', onclick: () => step(0) }, 'Шаг T1');
    const b2 = h('button', { class: 'btn primary t2b', onclick: () => step(1) }, 'Шаг T2');
    const ordIn = h('input', { type: 'checkbox' });
    ordIn.addEventListener('change', () => { ordered = ordIn.checked; reset(); });
    root.append(
      h('div', { class: 'controls' }, b1, b2, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, ordIn, h('span', null, 'блокировать счета по возрастанию id')),
      view, logEl);

    // T1: A → B, T2: B → A. Account A has id 1, B has id 2.
    const plan = i => {
      const [from, to] = i === 0 ? ['A', 'B'] : ['B', 'A'];
      const [l1, l2] = ordered ? [from, to].sort() : [from, to];
      return [['lock', l1], ['lock', l2], ['move', from, to], ['unlock', l2], ['unlock', l1]];
    };
    function reset() {
      th = [{ pc: 0 }, { pc: 0 }];
      owner = { A: null, B: null };
      waiting = [null, null];
      balance = { A: 100, B: 100 };
      say(ordered
        ? 'Оба перевода сначала блокируют счёт A (id 1), потом B (id 2). Попробуйте снова устроить дедлок.'
        : 'T1 переводит 10 с A на B, T2 — 10 с B на A. Каждый сначала блокирует свой счёт-источник. Сделайте по одному шагу каждым потоком.', '', true);
      render();
    }
    function step(i) {
      const t = th[i], name = 'T' + (i + 1), p = plan(i);
      if (t.pc >= p.length) return;
      const [op, a, b] = p[t.pc];
      if (op === 'lock') {
        if (owner[a] != null && owner[a] !== i) {
          waiting[i] = a;
          const o = owner[a];
          if (waiting[o] != null && owner[waiting[o]] === i) {
            say(`Дедлок: ${name} ждёт счёт ${a}, который держит T${o + 1}, а T${o + 1} ждёт счёт ${waiting[o]}, который держит ${name}. Цикл ожидания — никто никогда не продолжит.`, 'bad');
          } else say(`${name} хочет счёт ${a}, но его держит T${o + 1}. ${name} засыпает и ждёт.`, 'warn');
          render();
          return;
        }
        owner[a] = i; waiting[i] = null;
        say(`${name} заблокировал счёт ${a}.`);
      } else if (op === 'move') {
        balance[a] -= 10; balance[b] += 10;
        say(`${name}: перевод ${a} → ${b} выполнен под обеими блокировками.`);
      } else {
        owner[a] = null;
        say(`${name} отпустил счёт ${a}.` + (waiting[1 - i] === a ? ` Теперь T${2 - i} может продолжить.` : ''));
      }
      t.pc++;
      if (th[0].pc >= 5 && th[1].pc >= 5) say('Оба перевода завершились. Балансы сошлись: A = 100, B = 100.', 'ok');
      render();
    }
    const deadlocked = () => waiting[0] != null && waiting[1] != null && owner[waiting[0]] === 1 && owner[waiting[1]] === 0;
    function render() {
      const dl = deadlocked();
      const prog = i => plan(i).map(([op, a, b], k) => {
        const txt = op === 'lock' ? `lock(${a})` : op === 'unlock' ? `unlock(${a})` : `${a} −10, ${b} +10`;
        const cls = k < th[i].pc ? 'done' : k === th[i].pc ? (waiting[i] ? 'wait' : 'cur') : '';
        return `<div class="rs-op ${cls}"><code>${txt}</code></div>`;
      }).join('');
      const acc = a => {
        const o = owner[a];
        const ws = [0, 1].filter(i => waiting[i] === a).map(i => `<span class="chip t${i + 1}">T${i + 1} ждёт</span>`).join('');
        return `<div class="dl-acc ${o != null ? 'held t' + (o + 1) : ''}"><b>Счёт ${a}</b><span class="label">id ${a === 'A' ? 1 : 2} · ${balance[a]} ₽</span>` +
          `<span>${o != null ? '🔒 держит T' + (o + 1) : 'свободен'}</span>${ws}</div>`;
      };
      view.innerHTML = `<div class="rs-th t1"><div class="rs-head">T1: A → B</div>${prog(0)}</div>` +
        `<div class="dl-accs ${dl ? 'cycle' : ''}">${acc('A')}${acc('B')}${dl ? '<div class="dl-cycle">цикл ожидания</div>' : ''}</div>` +
        `<div class="rs-th t2"><div class="rs-head">T2: B → A</div>${prog(1)}</div>`;
      b1.disabled = th[0].pc >= 5 || dl;
      b2.disabled = th[1].pc >= 5 || dl;
    }
    reset();
    return {};
  });
})();
