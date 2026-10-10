// Demos for slides 10–17: CAS loop, ABA, store-buffer litmus test, double-checked locking, RW/semaphore, Amdahl.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

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

  // ---------------------------------------------------------------- CAS loop under contention
  Deck.demo('cas', root => {
    let n = 3, th, x, ok, fail, playing = false, acc = 0, last = -1;
    const out = h('output');
    const slider = h('input', { type: 'range', min: 1, max: 8, value: n, 'aria-label': 'Число потоков' });
    slider.addEventListener('input', () => { n = +slider.value; out.textContent = n; reset(); });
    out.textContent = n;
    const playBtn = h('button', { class: 'btn primary', onclick: () => { playing = !playing; playBtn.textContent = playing ? 'Пауза' : 'Пуск'; } }, 'Пуск');
    const mem = h('div', { class: 'rs-mem' });
    const rows = h('div', { class: 'cs-rows' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    root.append(
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'потоков'), slider, out),
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { micro(); render(); } }, 'Шаг'),
        h('button', { class: 'btn', onclick: fast }, '+1000 шагов'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      mem, rows, stats, logEl);

    function reset() {
      x = 0; ok = 0; fail = 0; last = -1;
      th = Array.from({ length: n }, () => ({ ph: 'load', old: null, res: '' }));
      say('Каждый поток в цикле: прочитать x, посчитать x + 1, CAS. Нажмите «Пуск» или «Шаг».', '', true);
      render();
    }
    // Any thread can be the next to execute an instruction — they run on different cores.
    function micro(quiet) {
      const i = Math.floor(Math.random() * n), t = th[i];
      last = i;
      if (t.ph === 'load') {
        t.old = x; t.ph = 'cas'; t.res = '';
        if (!quiet) say(`T${i + 1}: прочитал x = ${x}, собирается записать ${x + 1}.`);
      } else {
        if (x === t.old) {
          x = t.old + 1; ok++; t.res = 'ok';
          if (!quiet) say(`T${i + 1}: CAS(${t.old} → ${t.old + 1}) успешен — x не менялся с момента чтения.`, 'ok');
        } else {
          fail++; t.res = 'fail';
          if (!quiet) say(`T${i + 1}: CAS(${t.old} → ${t.old + 1}) провалился — x уже ${x}. Работа выброшена, повтор.`, 'warn');
        }
        t.ph = 'load';
      }
    }
    function fast() {
      for (let i = 0; i < 1000; i++) micro(true);
      const r = ok ? fail / ok : 0;
      say(`Неудачных CAS на одну успешную операцию: ${dec(r, 2)}. С ростом числа потоков растёт и доля впустую сделанной работы.`, n > 1 ? 'warn' : 'ok');
      render();
    }
    function render() {
      mem.innerHTML = `<span class="label">память</span><b>x = ${fmt(x)}</b>`;
      rows.innerHTML = th.map((t, i) => {
        const what = t.ph === 'cas' ? `прочитал ${t.old}, хочет ${t.old + 1}` : 'читает x';
        const tag = t.res === 'ok' ? '<span class="chip ok">CAS ✓</span>' : t.res === 'fail' ? '<span class="chip bad">CAS ✗ повтор</span>' : '';
        return `<div class="cs-row ${i === last ? 'act' : ''}"><span>T${i + 1}</span><span class="cs-what">${what}</span>${tag}</div>`;
      }).join('');
      const r = ok ? fail / ok : 0;
      stats.innerHTML = `<div class="stat"><b>${fmt(ok)}</b><span>успешных CAS</span></div>` +
        `<div class="stat ${fail ? 'warn' : ''}"><b>${fmt(fail)}</b><span>неудачных</span></div>` +
        `<div class="stat"><b>${dec(r, 2)}</b><span>повторов на операцию</span></div>`;
    }
    reset();
    const loop = rafLoop(dt => {
      if (!playing) return;
      acc += dt;
      if (acc >= 0.45) { acc = 0; micro(); render(); }
    });
    return { start: loop.start, stop() { loop.stop(); } };
  });

  // ---------------------------------------------------------------- Treiber stack and ABA
  Deck.demo('aba', root => {
    let tagged = false, k, st;
    const view = h('div', { class: 'ab-view' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    const tagIn = h('input', { type: 'checkbox' });
    tagIn.addEventListener('change', () => { tagged = tagIn.checked; reset(); });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')),
      h('label', { class: 'toggle' }, tagIn, h('span', null, 'счётчик версий рядом с указателем')),
      view, logEl);

    // State: stack as array of node names (top first), ver, freed set, T1 locals.
    const STEPS = () => [
      ['T1', 'pop(): old = top = A; next = A.next = B', s => { s.t1 = { old: 'A', next: 'B', ver: s.ver }; }, 'T1 прочитал вершину и следующий узел — и тут его вытеснили, не дав сделать CAS.'],
      ['T2', 'pop() → A', s => { s.stack.shift(); s.ver++; s.pool.push('A'); }, 'T2 снял A. Узел ушёл в пул свободных узлов.'],
      ['T2', 'pop() → B', s => { s.stack.shift(); s.ver++; s.pool.push('B'); s.freed = 'B'; }, 'T2 снял B и освободил его: память B может быть уже чем-то другим.'],
      ['T2', 'push(X) — узел взят из пула: это снова A', s => { s.stack.unshift('A'); s.ver++; s.pool = s.pool.filter(p => p !== 'A'); }, 'Аллокатор вернул тот же адрес A. Вершина снова A, но стек уже другой: A → C.'],
      ['T1', tagged ? 'CAS(top, (A, v0), (B, v1))' : 'CAS(top, A, B)', s => {
        if (tagged) {
          s.t1.res = 'fail';
          s.done = 'retry';
        } else {
          s.stack = ['B']; s.ver++; s.t1.res = 'ok'; s.done = 'broken';
        }
      }, null],
      ...(tagged ? [['T1', 'повтор: old = (A, v3), next = C; CAS успешен', s => {
        s.t1 = { old: 'A', next: 'C', ver: s.ver, res: 'ok' }; s.stack = ['C']; s.ver++; s.done = 'fixed';
      }, 'Со свежими данными CAS прошёл: снят A, вершина — C. Стек цел.']] : []),
    ];
    function reset() {
      k = 0;
      st = { stack: ['A', 'B', 'C'], ver: 0, pool: [], freed: null, t1: null, done: null, op: '' };
      say('Стек: A → B → C. T1 и T2 работают с ним без блокировок. Нажимайте «Шаг».', '', true);
      render();
    }
    function step() {
      const steps = STEPS();
      if (k >= steps.length) return;
      const [who, op, fn, text] = steps[k++];
      fn(st);
      st.op = `<b>${who}</b> ${op}`;
      if (st.done === 'broken') say('CAS прошёл: вершина и правда A. Но теперь top указывает на освобождённый B, а узел A, который только что вставил T2, потерян. Стек испорчен — и никакой ошибки.', 'bad');
      else if (st.done === 'retry' && k === 5) say('CAS не прошёл: указатель тот же A, но версия v3 ≠ v0. T1 понял, что стек менялся, и повторит.', 'warn');
      else if (text) say(text, st.done === 'fixed' ? 'ok' : '');
      render();
    }
    function render() {
      const node = n => `<span class="ab-node ${st.freed === n && st.done === 'broken' ? 'freed' : ''}">${n}${st.freed === n && st.done === 'broken' ? '<em>освобождён</em>' : ''}</span>`;
      const chain = st.stack.length ? st.stack.map(node).join('<span class="ab-arr">→</span>') : '<span class="empty">пусто</span>';
      const lost = st.done === 'broken' ? '<span class="ab-arr">→</span><span class="ab-q">B.next — что угодно</span><span class="ab-lost">A потерян</span>' : '';
      const t1 = st.t1 ? `old = ${st.t1.old}${tagged ? `, v${st.t1.ver}` : ''} · next = ${st.t1.next}` : '—';
      view.innerHTML = `<div class="ab-top"><span class="label">top${tagged ? ' (указатель, версия)' : ''}</span>` +
        `<b>${st.stack[0] ?? 'nil'}${tagged ? ', v' + st.ver : ''}</b></div>` +
        `<div class="ab-chain">${chain}${lost}</div>` +
        `<div class="ab-locals"><span class="label">локальные переменные T1</span><code>${t1}</code></div>` +
        `<div class="ab-locals"><span class="label">пул свободных узлов</span><code>${st.pool.join(', ') || '—'}</code></div>` +
        `<div class="fx-op">${st.op || '&nbsp;'}</div>`;
      stepBtn.disabled = k >= STEPS().length;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- store buffering litmus test
  Deck.demo('litmus', root => {
    let fence = false, s, hist;
    const view = h('div', { class: 'lt-view' });
    const histEl = h('div', { class: 'lt-hist' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    const fIn = h('input', { type: 'checkbox' });
    fIn.addEventListener('change', () => { fence = fIn.checked; hist = null; reset(); });
    const btn = (label, fn, cls = '') => h('button', { class: 'btn small ' + cls, onclick: fn }, label);
    const ex = [btn('T1: шаг', () => exec(0), 't1b'), btn('T2: шаг', () => exec(1), 't2b')];
    const dr = [btn('буфер T1 → память', () => drain(0)), btn('буфер T2 → память', () => drain(1))];
    root.append(
      h('div', { class: 'controls' }, ...ex, ...dr),
      h('label', { class: 'toggle' }, fIn, h('span', null, 'барьер между записью и чтением (MFENCE, seq_cst)')),
      view,
      h('div', { class: 'controls' }, h('button', { class: 'btn primary', onclick: batch }, '1000 прогонов'), h('button', { class: 'btn', onclick: () => { hist = null; reset(); } }, 'Сброс')),
      histEl, logEl);

    const V = ['x', 'y'];
    function fresh() { return { mem: { x: 0, y: 0 }, sb: [[], []], pc: [0, 0], r: [null, null] }; }
    function reset() {
      s = fresh();
      say('Каждый поток сначала пишет свою переменную, потом читает чужую. Запись попадает в буфер ядра, а не в память.', '', true);
      render();
    }
    // Generic machine step used by both the manual mode and the batch runner.
    function canLoad(m, i) { return !fence || m.sb[i].length === 0; }
    function doExec(m, i) {
      if (m.pc[i] === 0) { m.sb[i].push([V[i], 1]); m.pc[i] = 1; return 'store'; }
      if (m.pc[i] === 1) {
        const v = V[1 - i];
        const own = m.sb[i].find(e => e[0] === v);
        m.r[i] = own ? own[1] : m.mem[v];
        m.pc[i] = 2;
        return 'load';
      }
      return null;
    }
    function doDrain(m, i) { const e = m.sb[i].shift(); if (e) m.mem[e[0]] = e[1]; return !!e; }
    function exec(i) {
      if (s.pc[i] >= 2) return;
      if (s.pc[i] === 1 && !canLoad(s, i)) {
        doDrain(s, i);
        say(`Барьер: T${i + 1} не может читать, пока его буфер не пуст. Буфер сброшен в память, теперь x = ${s.mem.x}, y = ${s.mem.y}.`);
        render();
        return;
      }
      const op = doExec(s, i);
      if (op === 'store') say(`T${i + 1}: ${V[i]} = 1 ушло в буфер записи ядра ${i + 1}. Другое ядро этого пока не видит: в памяти ${V[i]} = ${s.mem[V[i]]}.`);
      else say(`T${i + 1}: r${i + 1} = ${V[1 - i]} — прочитал ${s.r[i]} ${s.r[i] ? 'из памяти' : '— запись другого потока ещё сидит в его буфере'}.`, s.r[i] ? '' : 'warn');
      finishCheck();
      render();
    }
    function drain(i) {
      if (doDrain(s, i)) say(`Буфер ядра ${i + 1} сброшен: теперь в памяти x = ${s.mem.x}, y = ${s.mem.y}.`);
      else say(`Буфер ядра ${i + 1} пуст.`);
      finishCheck();
      render();
    }
    function finishCheck() {
      if (s.pc[0] === 2 && s.pc[1] === 2) {
        const [a, b] = s.r;
        if (!a && !b) say('Итог: r1 = 0, r2 = 0. Ни при каком последовательном порядке так не бывает — но процессор с буферами записи это делает.', 'bad');
        else say(`Итог: r1 = ${a}, r2 = ${b} — допустимо и при последовательном выполнении.`, 'ok');
      }
    }
    function runOnce() {
      const m = fresh();
      for (;;) {
        const opts = [];
        for (const i of [0, 1]) {
          if (m.pc[i] === 0 || (m.pc[i] === 1 && canLoad(m, i))) opts.push(['e', i]);
          if (m.sb[i].length) opts.push(['d', i]);
        }
        if (!opts.length) break;
        const [kind, i] = opts[Math.floor(Math.random() * opts.length)];
        if (kind === 'e') doExec(m, i); else doDrain(m, i);
      }
      return m.r.join('');
    }
    function batch() {
      hist = hist || { '00': 0, '01': 0, '10': 0, '11': 0 };
      for (let i = 0; i < 1000; i++) hist[runOnce()]++;
      const total = Object.values(hist).reduce((a, b) => a + b, 0);
      if (hist['00']) say(`Без барьера (0, 0) выпало в ${Math.round((hist['00'] / total) * 100)}% прогонов. Модель случайно тасует события; на реальном x86 доля зависит от нагрузки, но она не ноль.`, 'bad');
      else say('С барьером исход (0, 0) не встречается ни разу: перед чтением запись обязана дойти до памяти. Атомики seq_cst в Go, Java volatile и C++ компилируются именно так.', 'ok');
      render();
    }
    function render() {
      const th = i => {
        const ops = [`${V[i]} = 1`, `r${i + 1} = ${V[1 - i]}`];
        return `<div class="rs-th t${i + 1}"><div class="rs-head">T${i + 1}<span>r${i + 1} = <b>${s.r[i] ?? '—'}</b></span></div>` +
          ops.map((o, k) => `<div class="rs-op ${k < s.pc[i] ? 'done' : k === s.pc[i] ? 'cur' : ''}"><code>${o}</code></div>`).join('') +
          `<div class="lt-sb"><span class="label">буфер записи</span>${s.sb[i].map(e => `<span class="chip t${i + 1}">${e[0]} = ${e[1]}</span>`).join('') || '<span class="empty">пуст</span>'}</div></div>`;
      };
      view.innerHTML = th(0) + `<div class="lt-mem"><span class="label">память</span><b>x = ${s.mem.x}</b><b>y = ${s.mem.y}</b></div>` + th(1);
      ex.forEach((b, i) => { b.disabled = s.pc[i] >= 2; });
      dr.forEach((b, i) => { b.disabled = !s.sb[i].length; });
      if (!hist) { histEl.innerHTML = '<span class="empty">Нажмите «1000 прогонов», чтобы увидеть распределение исходов.</span>'; return; }
      const total = Object.values(hist).reduce((a, b) => a + b, 0) || 1;
      const max = Math.max(...Object.values(hist), 1);
      histEl.innerHTML = ['11', '10', '01', '00'].map(k2 => [k2, hist[k2]]).map(([k2, v]) =>
        `<div class="lt-bar ${k2 === '00' ? 'bad' : ''}"><span>r1=${k2[0]}, r2=${k2[1]}</span><span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span></span><b>${Math.round((v / total) * 100)}%</b></div>`).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- double-checked locking
  Deck.demo('dcl', root => {
    let fixed = false, k, st;
    const view = h('div', { class: 'dc-view' });
    const logEl = logBox();
    const say = logger(logEl, 1);
    const vIn = h('input', { type: 'checkbox' });
    vIn.addEventListener('change', () => { fixed = vIn.checked; reset(); });
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: reset }, 'Сначала')),
      h('label', { class: 'toggle' }, vIn, h('span', null, h('code', null, 'volatile'), ' у поля instance')),
      view, logEl);

    const BROKEN = [
      ['T1', 'instance == null → берёт замок', s => { s.lock = 'T1'; }, 'T1 первым пришёл за конфигом.'],
      ['T1', 'p = выделить память', s => { s.obj = { port: 0, host: 'null' }; }, 'Память выделена, поля пока нулевые.'],
      ['T1', 'instance = p  ← переставлено раньше конструктора', s => { s.inst = true; }, 'Компилятор (JIT) или процессор переставил запись ссылки перед записью полей: для T1 разницы нет, это законная оптимизация.'],
      ['T2', 'instance != null → замок не нужен', s => { s.t2 = 'взял instance'; }, 'T2 проверяет без замка: ссылка уже не null.'],
      ['T2', 'connect(instance.host, instance.port)', s => { s.t2 = 'connect(null, 0) 💥'; s.bad = true; }, null],
      ['T1', 'конструктор: port = 5432, host = "db"; отпустить замок', s => { s.obj = { port: 5432, host: '"db"' }; s.lock = null; }, 'Объект достроен — но T2 уже прочитал недостроенный.'],
    ];
    const FIXED = [
      ['T1', 'instance == null → берёт замок', s => { s.lock = 'T1'; }, 'T1 первым пришёл за конфигом.'],
      ['T1', 'p = выделить память', s => { s.obj = { port: 0, host: 'null' }; }, 'Память выделена, поля пока нулевые.'],
      ['T1', 'конструктор: port = 5432, host = "db"', s => { s.obj = { port: 5432, host: '"db"' }; }, 'Запись в volatile нельзя переставить раньше предыдущих записей.'],
      ['T1', 'instance = p  (volatile-запись, release)', s => { s.inst = true; }, 'Публикация: всё, что T1 записал до неё, станет видно тому, кто прочитает ссылку.'],
      ['T2', 'instance != null (volatile-чтение, acquire)', s => { s.t2 = 'взял instance'; }, 'Чтение увидело ссылку — значит, видит и поля. Это и есть happens-before.'],
      ['T2', 'connect(instance.host, instance.port)', s => { s.t2 = 'connect("db", 5432) ✓'; }, 'T2 подключился к правильной базе.'],
    ];
    function reset() {
      k = 0;
      st = { lock: null, obj: null, inst: false, t2: 'ещё не пришёл', bad: false, op: '' };
      say('Два потока одновременно вызывают getConfig(). Нажимайте «Шаг».', '', true);
      render();
    }
    function step() {
      const sc = fixed ? FIXED : BROKEN;
      if (k >= sc.length) return;
      const [who, op, fn, text] = sc[k++];
      fn(st);
      st.op = `<b>${who}</b> ${op}`;
      if (!text) say('T2 видит объект с нулевыми полями: host = null, port = 0. NullPointerException или подключение не туда — раз в миллион запусков и только под нагрузкой.', 'bad');
      else say(text, k >= sc.length && !st.bad ? 'ok' : st.bad ? 'warn' : '');
      render();
    }
    function render() {
      const obj = st.obj ? `<div class="dc-obj ${st.obj.port ? '' : 'raw'}"><span class="label">объект Config</span><code>host = ${st.obj.host}</code><code>port = ${st.obj.port}</code></div>` : '<div class="dc-obj empty">объекта ещё нет</div>';
      view.innerHTML = `<div class="dc-mem"><div class="dc-ref"><span class="label">instance</span><b>${st.inst ? '→ объект' : 'null'}</b></div>${obj}</div>` +
        `<div class="dc-ths"><div class="fx-th ${st.lock ? 'cpu' : ''}"><b>T1</b><span>${st.lock ? 'держит замок' : k ? 'отпустил замок' : 'ещё не пришёл'}</span></div>` +
        `<div class="fx-th ${st.bad ? 'bad' : ''}"><b>T2</b><span>${st.t2}</span></div></div>` +
        `<div class="fx-op">${st.op || '&nbsp;'}</div>`;
      stepBtn.disabled = k >= (fixed ? FIXED : BROKEN).length;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- mutex vs RWMutex vs semaphore
  Deck.demo('prims', root => {
    const N = 8, HOLD = 1.1, LIMIT = 3;
    let kind = 'mutex', wfrac = 0.2, ws, inside, queue, t, done, waitSum, playing = true;
    const tabs = [['mutex', 'Mutex'], ['rw', 'RWMutex'], ['sem', 'Семафор (3)']].map(([id, label]) =>
      h('button', { class: 'btn small', onclick: () => { kind = id; reset(); } }, label));
    const out = h('output');
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 10, value: 20, 'aria-label': 'Доля писателей' });
    slider.addEventListener('input', () => { wfrac = +slider.value / 100; out.textContent = slider.value + '%'; reset(); });
    out.textContent = '20%';
    const wLabel = h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'писателей'), slider, out);
    const room = h('div', { class: 'pr-room' });
    const q = h('div', { class: 'pr-queue' });
    const stats = h('div', { class: 'stats' });
    const logEl = logBox();
    root.append(h('div', { class: 'controls' }, ...tabs), wLabel, room, q, stats, logEl);

    function reset() {
      ws = Array.from({ length: N }, (_, i) => ({ id: i + 1, st: 'think', left: Math.random() * 1.5, w: false, since: 0, hold: 0 }));
      inside = []; queue = []; t = 0; done = 0; waitSum = 0;
      tabs.forEach((b, i) => b.classList.toggle('sel', ['mutex', 'rw', 'sem'][i] === kind));
      wLabel.hidden = kind === 'sem';
      for (let i = 0; i < 40; i++) tick(0.1); // warm up so the numbers mean something right away
      render();
    }
    function admit() {
      for (;;) {
        const head = queue[0];
        if (!head) return;
        let ok;
        if (kind === 'mutex') ok = inside.length === 0;
        else if (kind === 'sem') ok = inside.length < LIMIT;
        else ok = head.w ? inside.length === 0 : !inside.some(x => x.w); // FIFO: a waiting writer blocks later readers
        if (!ok) return;
        queue.shift();
        head.st = 'in';
        head.hold = HOLD * (0.7 + Math.random() * 0.6);
        waitSum += t - head.since;
        inside.push(head);
      }
    }
    function tick(dt) {
      t += dt;
      for (const w of ws) {
        if (w.st === 'think' && (w.left -= dt) <= 0) {
          w.st = 'wait'; w.since = t; w.w = kind !== 'sem' && Math.random() < wfrac; queue.push(w);
        } else if (w.st === 'in' && (w.hold -= dt) <= 0) {
          w.st = 'think'; w.left = 0.2 + Math.random() * 0.8; done++;
          inside = inside.filter(x => x !== w);
        }
      }
      admit();
    }
    const chip = w => `<span class="pr-chip ${kind === 'sem' ? 'any' : w.w ? 'w' : 'r'}">${kind === 'sem' ? '' : w.w ? 'W' : 'R'}${w.id}</span>`;
    function render() {
      room.innerHTML = `<span class="label">${kind === 'mutex' ? 'внутри (максимум 1)' : kind === 'rw' ? 'внутри (читатели вместе или один писатель)' : 'внутри (максимум 3)'}</span>` +
        `<div class="pr-in">${inside.map(chip).join('') || '<span class="empty">никого</span>'}</div>`;
      q.innerHTML = `<span class="label">ждут</span><div class="pr-in">${queue.map(chip).join('') || '<span class="empty">очереди нет</span>'}</div>`;
      const thr = t > 0.5 ? done / t : 0;
      const avgW = done ? waitSum / Math.max(1, done + inside.length) : 0;
      stats.innerHTML = `<div class="stat"><b>${dec(thr)}</b><span>операций в секунду</span></div>` +
        `<div class="stat ${avgW > 1.5 ? 'warn' : ''}"><b>${dec(avgW)} с</b><span>среднее ожидание</span></div>` +
        `<div class="stat"><b>${fmt(done)}</b><span>сделано</span></div>`;
      logEl.innerHTML = kind === 'mutex'
        ? 'Обычный мьютекс пускает по одному, даже если все только читают. Пропускная способность — около одной операции за время удержания.'
        : kind === 'rw'
          ? (wfrac <= 0.2 ? 'Читатели заходят вместе — пропускная способность в разы выше. Сдвиньте долю писателей вверх: каждый писатель выстраивает всех за собой.' : 'Писателей много: они заходят по одному и блокируют читателей. Выигрыш от RWMutex тает, а учёт у него дороже, чем у обычного мьютекса.')
          : 'Семафор пропускает до трёх одновременно, остальные ждут. Так ограничивают нагрузку на базу или внешний API: не больше N запросов сразу.';
    }
    reset();
    let acc = 0;
    const loop = rafLoop(dt => {
      if (!playing) return;
      tick(dt);
      acc += dt;
      if (acc > 0.1) { acc = 0; render(); }
    });
    return loop;
  });

  // ---------------------------------------------------------------- Amdahl and USL
  Deck.demo('amdahl', root => {
    const CORES = [1, 2, 4, 8, 16, 32, 64, 128];
    const KAPPA = 0.0008;
    let s = 0.05, ci = 4, usl = false;
    const mkSlider = (label, min, max, val, set) => {
      const o = h('output');
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      input.addEventListener('input', () => { set(+input.value); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label am-l' }, label), input, o));
      return { o, input };
    };
    const big = h('div', { class: 'am-big' });
    root.append(big);
    const sS = mkSlider('последовательная доля', 0, 50, 5, v => { s = v / 100; });
    const sC = mkSlider('ядер', 0, CORES.length - 1, ci, v => { ci = v; });
    const uIn = h('input', { type: 'checkbox' });
    uIn.addEventListener('change', () => { usl = uIn.checked; update(); });
    root.append(h('label', { class: 'toggle' }, uIn, h('span', null, 'учесть согласование кэшей (закон Гюнтера)')));
    const svgWrap = h('div', { class: 'am-chart' });
    const legend = h('div', { class: 'am-legend' });
    const logEl = logBox();
    root.append(svgWrap, legend, logEl);

    const amd = n => 1 / (s + (1 - s) / n);
    const uslF = n => n / (1 + s * (n - 1) + KAPPA * n * (n - 1));
    const W = 360, H = 200, PL = 34, PR = 10, PT = 10, PB = 26;
    const xOf = n => PL + (Math.log2(n) / 7) * (W - PL - PR);

    svgWrap.addEventListener('pointermove', e => {
      const r = svgWrap.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const idx = Math.round(((px - PL) / (W - PL - PR)) * 7);
      if (idx >= 0 && idx < CORES.length && idx !== ci) { ci = idx; sC.input.value = idx; update(); }
    });

    function update() {
      const n = CORES[ci];
      sS.o.textContent = Math.round(s * 100) + '%';
      sC.o.textContent = n;
      const f = usl ? uslF : amd;
      const pts = [];
      for (let k = 0; k <= 70; k++) { const x = 2 ** (k / 10); pts.push([x, f(x)]); }
      const lim0 = s > 0 ? 1 / s : Infinity;
      const ymaxRaw = Math.max(...pts.map(p => p[1]), 2, !usl && lim0 < 200 ? lim0 : 0);
      const step = ymaxRaw > 40 ? 20 : ymaxRaw > 16 ? 5 : ymaxRaw > 6 ? 2 : 1;
      const ymax = Math.ceil((ymaxRaw * 1.08) / step) * step;
      const yOf = v => PT + (1 - Math.min(v, ymax) / ymax) * (H - PT - PB);
      const line = fn => pts.map(([x], k) => `${k ? 'L' : 'M'}${xOf(x).toFixed(1)},${yOf(fn(x)).toFixed(1)}`).join('');
      const ideal = `M${xOf(1)},${yOf(1)}` + pts.filter(([x]) => x <= ymax).map(([x]) => `L${xOf(x).toFixed(1)},${yOf(x).toFixed(1)}`).join('');
      let grid = '';
      for (let v = 0; v <= ymax; v += step) grid += `<line x1="${PL}" x2="${W - PR}" y1="${yOf(v)}" y2="${yOf(v)}" class="am-grid"/><text x="${PL - 6}" y="${yOf(v) + 4}" text-anchor="end">${v}</text>`;
      const xt = CORES.map(c => `<text x="${xOf(c)}" y="${H - 8}" text-anchor="middle">${c}</text>`).join('');
      const lim = s > 0 ? 1 / s : Infinity;
      const limLine = !usl && s > 0 && lim <= ymax ? `<line x1="${PL}" x2="${W - PR}" y1="${yOf(lim)}" y2="${yOf(lim)}" class="am-lim"/><text x="${W - PR}" y="${yOf(lim) - 5}" text-anchor="end" class="am-limt">предел 1/s = ${dec(lim)}×</text>` : '';
      const v = f(n);
      svgWrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ускорение в зависимости от числа ядер">${grid}${xt}${limLine}` +
        `<path d="${ideal}" class="am-ideal"/><path d="${line(f)}" class="am-curve"/>` +
        `<line x1="${xOf(n)}" x2="${xOf(n)}" y1="${PT}" y2="${H - PB}" class="am-cross"/>` +
        `<circle cx="${xOf(n)}" cy="${yOf(v)}" r="5" class="am-dot"/></svg>`;
      legend.innerHTML = `<span><i class="am-sw cur"></i>${usl ? 'с согласованием кэшей' : 'закон Амдала'}</span><span><i class="am-sw id"></i>идеал: N ядер — N×</span>`;
      big.innerHTML = `<b>${dec(v)}×</b> на ${n} ${plural(n, ['ядре', 'ядрах', 'ядрах'])} · КПД ${Math.round((v / n) * 100)}%`;
      if (usl) {
        let best = 1;
        for (let m = 1; m <= 128; m++) if (uslF(m) > uslF(best)) best = m;
        logEl.className = 'log warn';
        logEl.innerHTML = `Пик при ~${best} ${plural(best, ['ядре', 'ядрах', 'ядрах'])}: ${dec(uslF(best))}×. Дальше каждое новое ядро добавляет трафика за кэш-линию замка больше, чем полезной работы, — и система медленнее.`;
      } else if (s === 0) {
        logEl.className = 'log ok';
        logEl.innerHTML = 'Без последовательной части ускорение линейное. Так бывает с полностью независимыми задачами: рендеринг кадров, обработка разных файлов.';
      } else {
        logEl.className = 'log';
        logEl.innerHTML = `При ${Math.round(s * 100)}% последовательной работы больше ${dec(lim)}× не получить никогда. Уже на ${n} ${plural(n, ['ядре', 'ядрах', 'ядрах'])} достигнуто ${Math.round((v / lim) * 100)}% предела.`;
      }
    }
    update();
    return {};
  });
})();
