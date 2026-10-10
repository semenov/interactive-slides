// Demos for slides 3–7: fetch-decode-execute, IPC, pipeline, out-of-order accumulators, branch prediction.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const hex = n => '0x' + n.toString(16).toUpperCase();

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }

  // Deterministic PRNG so that demos look the same on every visit.
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

  // ---------------------------------------------------------------- fetch / decode / execute
  Deck.demo('cpu', root => {
    const ARR = 0x2000, DATA = [3, 1, 4, 1, 5];
    const LOOP = 0x40100c;
    const flagsOf = (s, v) => { s.zf = v === 0 ? 1 : 0; s.sf = v < 0 ? 1 : 0; };
    const PROG = [
      { a: 0x401000, b: 'BE 00 20 00 00', asm: 'mov  esi, 0x2000', d: 'BE — «записать число в ESI», следующие 4 байта — само число 0x2000 (младший байт первым)',
        x: s => { s.rsi = ARR; return 'RSI = 0x2000 — адрес начала массива. Запись в ESI обнуляет старшую половину RSI.'; }, ch: ['rsi'] },
      { a: 0x401005, b: 'B9 05 00 00 00', asm: 'mov  ecx, 5', d: 'B9 — «записать число в ECX», число 5',
        x: s => { s.rcx = 5; return 'RCX = 5 — сколько элементов осталось обработать.'; }, ch: ['rcx'] },
      { a: 0x40100a, b: '31 C0', asm: 'xor  eax, eax', d: '31 — xor двух регистров, байт C0 говорит: оба операнда — EAX',
        x: s => { s.rax = 0; flagsOf(s, 0); return 'EAX = 0. Компиляторы обнуляют регистр так: инструкция на 3 байта короче, чем <code>mov eax, 0</code>. Флаг ZF = 1 — результат нулевой.'; }, ch: ['rax', 'zf'] },
      { a: LOOP, b: '03 06', asm: 'add  eax, [rsi]', label: 'loop:', d: '03 — сложение, байт 06: приёмник EAX, второй операнд — в памяти по адресу из RSI',
        x: s => {
          const i = (s.rsi - ARR) / 4, v = DATA[i];
          s.read = i;
          s.rax += v;
          flagsOf(s, s.rax);
          return `Чтение памяти по адресу ${hex(s.rsi)}: там ${v}. EAX = ${s.rax - v} + ${v} = ${s.rax}. Флаги обновились по результату.`;
        }, ch: ['rax', 'zf'] },
      { a: 0x40100e, b: '48 83 C6 04', asm: 'add  rsi, 4', d: '48 — операция над 64-битным регистром, 83 C6 — прибавить к RSI, 04 — число',
        x: s => { s.rsi += 4; flagsOf(s, s.rsi); return `RSI = ${hex(s.rsi)}: следующий элемент, int32 занимает 4 байта.`; }, ch: ['rsi'] },
      { a: 0x401012, b: '48 FF C9', asm: 'dec  rcx', d: '48 FF C9 — уменьшить 64-битный RCX на единицу',
        x: s => { s.rcx--; flagsOf(s, s.rcx); return `RCX = ${s.rcx}. ZF = ${s.zf}: ${s.zf ? 'дошли до нуля' : 'ещё не ноль'}. Следующая инструкция смотрит только на этот флаг.`; }, ch: ['rcx', 'zf'] },
      { a: 0x401015, b: '75 F5', asm: 'jnz  loop', d: '75 — «перейти, если ZF = 0», F5 = −11: смещение от адреса следующей инструкции (0x401017 − 11 = 0x40100C)',
        x: s => {
          if (!s.zf) { s.rip = LOOP; return 'ZF = 0 — переход выполнен: RIP = 0x40100C, снова к началу цикла.'; }
          return 'ZF = 1 — переход не выполняется, RIP уже указывает на следующую инструкцию.';
        }, ch: ['rip'] },
      { a: 0x401017, b: 'C3', asm: 'ret', d: 'C3 — возврат из функции: взять адрес возврата со стека',
        x: s => { s.done = true; return `Готово: в EAX сумма ${s.rax}. По соглашению о вызовах результат функции возвращается именно в EAX.`; }, ch: [] },
    ];
    const byAddr = new Map(PROG.map((p, i) => [p.a, i]));
    const PHASES = ['Выборка', 'Декодирование', 'Исполнение'];
    let s, phase, cur, timer = null, acc = 0;

    const listing = h('div', { class: 'cpu-code' });
    const rows = PROG.map(p => {
      const r = h('div', { class: 'cpu-line' }, h('span', { class: 'cpu-addr' }, p.a.toString(16)), h('span', { class: 'cpu-lbl' }, p.label || ''), h('span', null, p.asm));
      listing.append(r);
      return r;
    });
    const phaseEl = h('div', { class: 'cpu-phases' }, PHASES.map(n => h('span', null, n)));
    const decoder = h('div', { class: 'cpu-dec' });
    const regs = h('div', { class: 'cpu-regs' });
    const mem = h('div', { class: 'cpu-mem' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const phaseBtn = h('button', { class: 'btn primary', onclick: () => { halt(); stepPhase(); } }, 'Фаза');
    const instrBtn = h('button', { class: 'btn', onclick: () => { halt(); stepInstr(); } }, 'Инструкция');
    const runBtn = h('button', { class: 'btn', onclick: toggleRun }, 'Пуск');
    root.append(
      h('div', { class: 'controls' }, phaseBtn, instrBtn, runBtn, h('button', { class: 'btn', onclick: () => { halt(); reset(); } }, 'Сначала')),
      phaseEl,
      h('div', { class: 'cpu-grid' }, listing, h('div', { class: 'cpu-side' }, regs, decoder)),
      mem, logEl,
    );

    function reset() {
      s = { rip: 0x401000, rax: 0x7f3a, rcx: 0x91, rsi: 0x5c10, zf: 0, sf: 0, read: -1, done: false, n: 0 };
      phase = 0; cur = -1;
      say('Регистры содержат мусор от предыдущего кода. RIP указывает на первую инструкцию функции. Нажмите «Фаза».');
      render([]);
    }
    function stepPhase() {
      if (s.done) { say(`Функция завершилась: ${s.n} ${plural(s.n, ['инструкция', 'инструкции', 'инструкций'])}. Нажмите «Сначала».`, 'ok'); return; }
      let changed = [];
      s.read = -1;
      if (phase === 0) {
        cur = byAddr.get(s.rip);
        const p = PROG[cur], len = p.b.split(' ').length;
        const old = s.rip;
        s.rip += len;
        changed = ['rip'];
        say(`<b>Выборка.</b> Читаем байты по адресу RIP = ${hex(old)}: <code>${p.b}</code>. Длину инструкции узнаём по первым байтам, RIP ← ${hex(s.rip)}.`);
      } else if (phase === 1) {
        say(`<b>Декодирование.</b> ${PROG[cur].d}.`);
      } else {
        const p = PROG[cur];
        const text = p.x(s);
        s.n++;
        changed = p.ch;
        say(`<b>Исполнение.</b> ${text}`, s.done ? 'ok' : '');
      }
      phase = (phase + 1) % 3;
      render(changed);
    }
    function stepInstr() {
      if (s.done) { stepPhase(); return; }
      do stepPhase(); while (phase !== 0 && !s.done);
    }
    function render(changed) {
      rows.forEach((r, i) => r.classList.toggle('cur', i === cur));
      [...phaseEl.children].forEach((el, i) => el.classList.toggle('on', cur >= 0 && i === (phase + 2) % 3));
      const p = cur >= 0 ? PROG[cur] : null;
      decoder.innerHTML = `<span class="label">Байты инструкции</span><code>${p ? p.b : '—'}</code>`;
      const reg = (name, val, key) => `<div class="cpu-reg ${changed.includes(key) ? 'chg' : ''}"><span>${name}</span><b>${val}</b></div>`;
      regs.innerHTML = reg('RIP', hex(s.rip), 'rip') + reg('RAX', s.rax > 999 ? hex(s.rax) : s.rax, 'rax') +
        reg('RCX', s.rcx > 999 ? hex(s.rcx) : s.rcx, 'rcx') + reg('RSI', hex(s.rsi), 'rsi') +
        `<div class="cpu-reg ${changed.includes('zf') ? 'chg' : ''}"><span>флаги</span><b>ZF=${s.zf} SF=${s.sf}</b></div>` +
        `<div class="cpu-reg"><span>выполнено</span><b>${s.n}</b></div>`;
      mem.innerHTML = '<span class="label">Память: массив int32</span><div class="cpu-cells">' + DATA.map((v, i) => {
        const a = ARR + i * 4;
        return `<div class="cpu-cell ${i === s.read ? 'rd' : ''} ${a === s.rsi ? 'ptr' : ''}"><small>${a.toString(16)}</small><b>${v}</b></div>`;
      }).join('') + '</div>';
    }
    const loop = rafLoop(dt => {
      acc += dt;
      if (acc < 0.45) return;
      acc = 0;
      stepPhase();
      if (s.done) halt();
    });
    function toggleRun() {
      if (timer) { halt(); return; }
      if (s.done) reset();
      timer = true; runBtn.textContent = 'Пауза'; acc = 1; loop.start();
    }
    function halt() { timer = null; runBtn.textContent = 'Пуск'; loop.stop(); }
    reset();
    return { stop: halt };
  });

  // ---------------------------------------------------------------- IPC and frequency
  Deck.demo('ipc', root => {
    const N = 1e9;
    const LOADS = [
      { name: 'Арифметика в кэше', ipc: 4, br: 0, miss: 0,
        text: 'Все данные в L1, ветвления предсказуемы: ядро выполняет до 4 инструкций за такт. Время обратно пропорционально частоте.' },
      { name: 'Непредсказуемые if', ipc: 4, br: 5e7, miss: 0,
        text: '50 млн промахов предсказания по ~17 тактов. Штраф считается в тактах, поэтому с частотой он тоже уменьшается — но IPC уже около 1.' },
      { name: 'Обход списка в RAM', ipc: 4, br: 0, miss: 2e7,
        text: '20 млн зависимых загрузок по ~90 нс. Память отвечает за одно и то же время при любой частоте ядра — разгон почти ничего не даёт.' },
    ];
    const PEN = 17, MEM = 90e-9;
    let load = LOADS[0];
    const freq = h('input', { type: 'range', min: 10, max: 55, value: 30, 'aria-label': 'Частота, ГГц' });
    const fOut = h('output');
    const btns = LOADS.map(l => h('button', { class: 'btn small', onclick: () => { load = l; update(); } }, l.name));
    const big = h('div', { class: 'ipc-big' });
    const bar = h('div', { class: 'ipc-bar' });
    const legend = h('div', { class: 'ipc-legend' });
    const logEl = h('p', { class: 'log' });
    freq.addEventListener('input', update);
    root.append(
      h('div', { class: 'controls' }, btns),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Частота'), freq, fOut),
      h('p', { class: 'label' }, 'Программа: 1 млрд инструкций'),
      big, bar, legend, logEl,
    );
    const time = (l, f) => {
      const work = N / l.ipc / f, br = l.br * PEN / f, mem = l.miss * MEM;
      return { work, br, mem, total: work + br + mem };
    };
    const fmtT = t => t >= 1 ? dec(t, 2) + ' с' : Math.round(t * 1000) + ' мс';
    function update() {
      const f = +freq.value / 10 * 1e9;
      fOut.textContent = dec(f / 1e9) + ' ГГц';
      btns.forEach((b, i) => b.classList.toggle('sel', LOADS[i] === load));
      const t = time(load, f), base = time(load, 3e9);
      const ipc = N / (t.total * f);
      big.innerHTML = `<div><b>${fmtT(t.total)}</b><span>время</span></div><div><b>${dec(ipc, ipc < 1 ? 2 : 1)}</b><span>IPC в итоге</span></div>` +
        `<div><b>×${dec(base.total / t.total, 2)}</b><span>к скорости на 3 ГГц</span></div>`;
      const parts = [['work', t.work], ['br', t.br], ['mem', t.mem]];
      bar.innerHTML = parts.map(([c, v]) => `<span class="${c}" style="width:${(v / t.total) * 100}%"></span>`).join('');
      legend.innerHTML = `<span><i class="sw work"></i>работа ${fmtT(t.work)}</span><span><i class="sw br"></i>промахи предсказания ${fmtT(t.br)}</span><span><i class="sw mem"></i>ожидание памяти ${fmtT(t.mem)}</span>`;
      logEl.innerHTML = load.text;
      logEl.className = 'log ' + (load.miss ? 'warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- 5-stage pipeline
  Deck.demo('pipeline', root => {
    const P = (text, d, s, load) => ({ text, d, s, load: !!load });
    const PROGS = {
      indep: { name: 'Независимые', code: [
        P('lw  x1, 0(x10)', 'x1', ['x10'], 1), P('add x2, x3, x4', 'x2', ['x3', 'x4']), P('sub x5, x6, x7', 'x5', ['x6', 'x7']),
        P('and x8, x9, x11', 'x8', ['x9', 'x11']), P('or  x12, x13, x14', 'x12', ['x13', 'x14'])] },
      dep: { name: 'С зависимостями', code: [
        P('lw  x1, 0(x10)', 'x1', ['x10'], 1), P('add x2, x1, x4', 'x2', ['x1', 'x4']), P('lw  x5, 8(x10)', 'x5', ['x10'], 1),
        P('sub x6, x5, x7', 'x6', ['x5', 'x7']), P('and x8, x2, x6', 'x8', ['x2', 'x6'])] },
      reord: { name: 'Переставленные', code: [
        P('lw  x1, 0(x10)', 'x1', ['x10'], 1), P('lw  x5, 8(x10)', 'x5', ['x10'], 1), P('add x2, x1, x4', 'x2', ['x1', 'x4']),
        P('sub x6, x5, x7', 'x6', ['x5', 'x7']), P('and x8, x2, x6', 'x8', ['x2', 'x6'])] },
    };
    const ST = ['F', 'D', 'E', 'M', 'W'];
    let prog = 'dep', piped = true, fwd = true, shown = 99, playing = false, acc = 0, sched;
    const progBtns = Object.entries(PROGS).map(([k, p]) => h('button', { class: 'btn small', onclick: () => { prog = k; recalc(); } }, p.name));
    const pipeIn = h('input', { type: 'checkbox', checked: true });
    const fwdIn = h('input', { type: 'checkbox', checked: true });
    pipeIn.addEventListener('change', () => { piped = pipeIn.checked; recalc(); });
    fwdIn.addEventListener('change', () => { fwd = fwdIn.checked; recalc(); });
    const playBtn = h('button', { class: 'btn', onclick: play }, 'Пуск по тактам');
    const grid = h('div', { class: 'pp-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, progBtns),
      h('div', { class: 'controls' },
        h('label', { class: 'toggle' }, pipeIn, h('span', null, 'конвейер')),
        h('label', { class: 'toggle' }, fwdIn, h('span', null, 'проброс результата')),
        playBtn),
      grid,
      h('p', { class: 'pp-legend' }, h('b', null, 'F'), ' выборка ', h('b', null, 'D'), ' декодирование ', h('b', null, 'E'), ' исполнение ', h('b', null, 'M'), ' память ', h('b', null, 'W'), ' запись в регистр ', h('i', { class: 'pp-st' }, '·'), ' пауза'),
      stats, logEl,
    );

    function schedule(code) {
      const out = [];
      const notes = [];
      code.forEach((ins, i) => {
        let IF, ID, EX;
        if (!piped) { IF = i * 5; ID = IF + 1; EX = IF + 2; }
        else if (i === 0) { IF = 0; ID = 1; EX = 2; }
        else {
          const prev = out[i - 1];
          IF = prev.ID; ID = prev.EX;
          EX = prev.EX + 1;
          for (const r of ins.s) {
            let p = -1;
            for (let j = i - 1; j >= 0; j--) if (code[j].d === r) { p = j; break; }
            if (p < 0) continue;
            const need = fwd ? out[p].EX + (code[p].load ? 2 : 1) : out[p].EX + 3;
            if (need > EX) {
              notes.push(`<code>${ins.text.split(',')[0]}</code> ждёт ${r} от <code>${code[p].text.split(',')[0]}</code>: +${need - EX}`);
              EX = need;
            }
          }
        }
        out.push({ IF, ID, EX });
      });
      return { rows: out, notes, total: out[out.length - 1].EX + 3 };
    }
    function recalc() {
      progBtns.forEach((b, i) => b.classList.toggle('sel', Object.keys(PROGS)[i] === prog));
      fwdIn.disabled = !piped;
      sched = schedule(PROGS[prog].code);
      shown = sched.total;
      stopPlay();
      render();
      const n = PROGS[prog].code.length;
      const stalls = sched.rows.reduce((s, r, i) => s + (i ? r.EX - sched.rows[i - 1].EX - 1 : 0), 0);
      stats.innerHTML = `<div class="stat"><b>${sched.total}</b><span>тактов на ${n} инструкций</span></div>` +
        `<div class="stat ${stalls ? 'warn' : ''}"><b>${piped ? stalls : '—'}</b><span>тактов паузы</span></div>` +
        `<div class="stat"><b>${piped ? dec((sched.total - 4) / n, 1) : '5,0'}</b><span>тактов на инструкцию в потоке</span></div>`;
      if (!piped) logEl.innerHTML = 'Без конвейера каждая инструкция проходит все пять стадий, и только потом начинается следующая: 5 тактов на инструкцию. Зависимости не мешают — но и параллельности нет.';
      else if (!sched.notes.length) logEl.innerHTML = `Пауз нет: каждый такт стартует новая инструкция, после разгона завершается по одной за такт. ${prog === 'reord' ? 'Те же вычисления, что и «С зависимостями», но между загрузкой и её использованием теперь стоит другая инструкция.' : ''}`;
      else logEl.innerHTML = sched.notes.join('; ') + (fwd ? '. С пробросом результат АЛУ доступен следующей инструкции сразу, а значение из памяти — только после стадии M.' : '. Без проброса инструкция ждёт, пока результат запишется в регистр (стадия W).');
      logEl.className = 'log ' + (piped && sched.notes.length ? 'warn' : piped ? 'ok' : '');
    }
    function render() {
      const code = PROGS[prog].code;
      const cols = sched.total;
      grid.style.gridTemplateColumns = `minmax(0, ${matchMedia('(max-width: 520px)').matches ? 7.2 : 9.5}em) repeat(${cols}, minmax(0, 1fr))`;
      let html = '<span></span>';
      for (let c = 0; c < cols; c++) html += `<span class="pp-h ${c === shown - 1 && shown < cols ? 'now' : ''}">${cols <= 15 || c % 5 === 0 || c === shown - 1 ? c + 1 : ''}</span>`;
      code.forEach((ins, i) => {
        const r = sched.rows[i];
        html += `<span class="pp-ins">${ins.text}</span>`;
        for (let c = 0; c < cols; c++) {
          let st = '', stall = false;
          if (c >= r.IF && c < r.ID) { st = 'F'; stall = c > r.IF; }
          else if (c >= r.ID && c < r.EX) { st = 'D'; stall = c > r.ID; }
          else if (c === r.EX) st = 'E';
          else if (c === r.EX + 1) st = 'M';
          else if (c === r.EX + 2) st = 'W';
          const hide = c >= shown;
          html += st && !hide ? `<span class="pp-c s${st}${stall ? ' pp-st' : ''}">${stall ? '·' : st}</span>` : '<span class="pp-c"></span>';
        }
      });
      grid.innerHTML = html;
    }
    const loop = rafLoop(dt => {
      acc += dt;
      if (acc < 0.35) return;
      acc = 0;
      shown++;
      render();
      if (shown >= sched.total) stopPlay();
    });
    function play() {
      if (playing) { stopPlay(); return; }
      playing = true; shown = 0; acc = 1;
      playBtn.textContent = 'Стоп';
      loop.start();
    }
    function stopPlay() { playing = false; playBtn.textContent = 'Пуск по тактам'; loop.stop(); if (shown < sched.total) { shown = sched.total; render(); } }
    recalc();
    return { stop: stopPlay };
  });

  // ---------------------------------------------------------------- accumulators and out-of-order
  Deck.demo('accum', root => {
    const N = 32, LAT = 4, UNITS = 2, SCALE = 132;
    let k = 1;
    const btns = [1, 2, 4, 8].map(n => h('button', { class: 'btn small', onclick: () => { k = n; update(); } }, String(n)));
    const gantt = h('div', { class: 'ac-gantt' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Аккумуляторов'), btns), gantt,
      h('p', { class: 'note' }, 'Каждая полоска — одно сложение длиной 4 такта. Строка — свой аккумулятор, внизу — финальная свёртка аккумуляторов в одну сумму. Ширина — 132 такта.'),
      stats, logEl);

    // List scheduler: every cycle start up to UNITS ready ops, oldest first (what an out-of-order core does).
    function run(ops) {
      const start = Array(ops.length).fill(-1);
      let done = 0, c = 0;
      while (done < ops.length) {
        let issued = 0;
        for (let i = 0; i < ops.length && issued < UNITS; i++) {
          if (start[i] >= 0) continue;
          if (ops[i].deps.every(d => start[d] >= 0 && start[d] + LAT <= c)) { start[i] = c; issued++; done++; }
        }
        c++;
      }
      return start;
    }
    function update() {
      btns.forEach((b, i) => b.classList.toggle('sel', [1, 2, 4, 8][i] === k));
      const ops = [];
      for (let i = 0; i < N; i++) ops.push({ row: i % k, deps: i >= k ? [i - k] : [] });
      // Pairwise reduction of k accumulators: last op of each chain, then a tree.
      let level = [];
      for (let a = 0; a < k; a++) level.push(N - k + a);
      while (level.length > 1) {
        const next = [];
        for (let j = 0; j + 1 < level.length; j += 2) { ops.push({ row: 'r', deps: [level[j], level[j + 1]] }); next.push(ops.length - 1); }
        level = next;
      }
      const start = run(ops);
      const total = Math.max(...start) + LAT;
      const loopEnd = Math.max(...start.slice(0, N)) + LAT;
      let html = '';
      const rowsK = [...Array(k).keys()];
      for (const r of rowsK) {
        html += `<div class="ac-row"><span class="ac-l">s${r}</span><div class="ac-track">` +
          ops.map((o, i) => o.row === r ? `<i style="left:${(start[i] / SCALE) * 100}%;width:${(LAT / SCALE) * 100}%"></i>` : '').join('') + '</div></div>';
      }
      html += `<div class="ac-row red"><span class="ac-l">итог</span><div class="ac-track">` +
        ops.map((o, i) => o.row === 'r' ? `<i style="left:${(start[i] / SCALE) * 100}%;width:${(LAT / SCALE) * 100}%"></i>` : '').join('') +
        `<b class="ac-end" style="left:${(total / SCALE) * 100}%"></b></div></div>`;
      gantt.innerHTML = html;
      const busy = (ops.length * 1) / (total * UNITS);
      stats.innerHTML = `<div class="stat"><b>${total}</b><span>тактов на 32 числа</span></div>` +
        `<div class="stat"><b>${dec(loopEnd / N, 2)}</b><span>такта на элемент в цикле</span></div>` +
        `<div class="stat"><b>${Math.round(busy * 100)}%</b><span>загрузка двух блоков сложения</span></div>`;
      logEl.innerHTML = k === 1 ? 'Каждое сложение ждёт результат предыдущего: 4 такта на число, хотя блоки сложения простаивают ¾ времени. Никакая внеочередность здесь не поможет — это истинная зависимость.'
        : k < 4 ? `${k} независимые цепочки идут внахлёст: ядро само запускает готовые сложения, не дожидаясь порядка в программе. Уже в ${dec(128 / total, 1)} раза быстрее.`
        : k === 4 ? 'Четыре цепочки почти насыщают оба блока сложения: по 2 сложения за такт. Дальше упираемся уже не в задержку, а в пропускную способность.'
        : 'Восьми цепочек больше, чем нужно: блоков сложения всё равно два, а свёртка восьми аккумуляторов стоит лишних тактов. Так устроен numpy.sum и векторизованный код: несколько аккумуляторов в SIMD-регистрах.';
      logEl.className = 'log ' + (k === 1 ? 'warn' : 'ok');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- branch prediction
  Deck.demo('branch', root => {
    const N = 256, SHOW = 64, PEN = 16, BASE = 1.5;
    const r = rng(7);
    const rand = Array.from({ length: N }, () => Math.floor(r() * 256));
    const DATA = {
      random: { name: 'Случайные', v: rand },
      sorted: { name: 'Отсортированные', v: [...rand].sort((a, b) => a - b) },
      alt: { name: 'Чередование', v: Array.from({ length: N }, (_, i) => (i % 2 ? 40 + (i * 37) % 80 : 140 + (i * 53) % 110)) },
    };
    const PRED = { two: '2-битный счётчик', hist: 'С историей переходов' };
    const STATES = ['сильно «нет»', 'слабо «нет»', 'слабо «да»', 'сильно «да»'];
    let data = 'random', pred = 'two', i, misses, ctr, hist, table, outs, playing = false, acc = 0;
    const dataBtns = Object.entries(DATA).map(([key, d]) => h('button', { class: 'btn small', onclick: () => { data = key; reset(true); } }, d.name));
    const predBtns = Object.entries(PRED).map(([key, n]) => h('button', { class: 'btn small', onclick: () => { pred = key; reset(true); } }, n));
    const playBtn = h('button', { class: 'btn primary', onclick: () => (playing ? pause() : play()) }, 'Пуск');
    const strip = h('div', { class: 'br-strip' });
    const state = h('div', { class: 'br-state' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Данные'), dataBtns),
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Предсказатель'), predBtns),
      h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', onclick: () => reset(false) }, 'Сброс')),
      strip,
      h('p', { class: 'br-legend' }, h('i', { class: 'sw tk' }), 'условие истинно ', h('i', { class: 'sw nt' }), 'ложно ', h('i', { class: 'sw ms' }), 'промах предсказания'),
      state, stats, logEl,
    );
    function reset(autoplay) {
      i = 0; misses = 0; ctr = 1; hist = 0; table = Array(16).fill(1); outs = [];
      dataBtns.forEach((b, j) => b.classList.toggle('sel', Object.keys(DATA)[j] === data));
      predBtns.forEach((b, j) => b.classList.toggle('sel', Object.keys(PRED)[j] === pred));
      logEl.innerHTML = 'Каждое значение проверяется условием <code>data[i] >= 128</code>. Предсказатель угадывает исход до того, как значение загружено.';
      logEl.className = 'log';
      render(null);
      if (autoplay) play();
    }
    function step() {
      const v = DATA[data].v[i];
      const taken = v >= 128;
      const slot = pred === 'two' ? null : hist;
      const c = pred === 'two' ? ctr : table[slot];
      const guess = c >= 2;
      const miss = guess !== taken;
      if (miss) misses++;
      const nc = taken ? Math.min(3, c + 1) : Math.max(0, c - 1);
      if (pred === 'two') ctr = nc; else { table[slot] = nc; hist = ((hist << 1) | (taken ? 1 : 0)) & 15; }
      outs.push({ taken, miss });
      i++;
      render({ v, taken, guess, miss });
    }
    function render(last) {
      const from = Math.max(0, outs.length - SHOW);
      let html = '';
      for (let j = 0; j < SHOW; j++) {
        const o = outs[from + j];
        html += o ? `<i class="${o.taken ? 'tk' : 'nt'}${o.miss ? ' ms' : ''}"></i>` : '<i></i>';
      }
      strip.innerHTML = html;
      if (pred === 'two') {
        state.innerHTML = '<span class="label">Счётчик</span>' + STATES.map((n, j) => `<span class="br-c ${j === ctr ? 'on' : ''}">${n}</span>`).join('');
      } else {
        const bits = hist.toString(2).padStart(4, '0').replace(/1/g, 'д').replace(/0/g, 'н');
        state.innerHTML = `<span class="label">История: последние 4 исхода</span><span class="br-c on">${bits}</span><span class="label">→ свой счётчик: ${STATES[table[hist]]}</span>`;
      }
      const rate = i ? misses / i : 0;
      const cpe = BASE + rate * PEN;
      stats.innerHTML = `<div class="stat"><b>${i}</b><span>из ${N} значений</span></div>` +
        `<div class="stat ${rate > 0.1 ? 'warn' : ''}"><b>${dec(rate * 100, 1)}%</b><span>промахов (${misses})</span></div>` +
        `<div class="stat ${rate > 0.1 ? 'warn' : ''}"><b>≈${dec(cpe, 1)}</b><span>тактов на элемент</span></div>`;
      if (!last) return;
      if (i === N) {
        const txt = data === 'sorted' ? `Отсортированные данные: сначала все «нет», потом все «да». Промахов всего ${misses} — на границе. Цикл идёт со скоростью ~${dec(cpe, 1)} такта на элемент.`
          : data === 'random' ? `Случайные данные: угадать невозможно, промах в ~половине случаев по ${PEN} тактов. Это в ${dec(cpe / BASE, 1)} раза медленнее, чем на отсортированных.`
          : pred === 'two' ? 'Чередование «да-нет» сбивает простой счётчик: он каждый раз переключается и отстаёт на шаг. Реальные предсказатели помнят историю — переключитесь на второй.'
          : 'Предсказатель с историей выучил шаблон «да-нет-да-нет» за несколько шагов. Настоящие (TAGE, перцептроны) помнят сотни последних переходов и угадывают >95% на типичном коде.';
        logEl.innerHTML = txt;
        logEl.className = 'log ' + (rate > 0.1 ? 'warn' : 'ok');
      } else {
        logEl.innerHTML = `data[${i - 1}] = ${last.v}: условие ${last.taken ? 'истинно' : 'ложно'}, прогноз «${last.guess ? 'да' : 'нет'}» — ` +
          (last.miss ? `<b>промах</b>, выброшены начатые инструкции, −${PEN} тактов.` : 'угадал, конвейер не останавливался.');
        logEl.className = 'log ' + (last.miss ? 'bad' : '');
      }
    }
    const loop = rafLoop(dt => {
      acc += dt;
      while (acc > 0.025 && i < N) { acc -= 0.025; step(); }
      if (i >= N) pause();
    });
    function play() { if (i >= N) reset(false); playing = true; playBtn.textContent = 'Пауза'; loop.start(); }
    function pause() { playing = false; playBtn.textContent = 'Пуск'; loop.stop(); }
    reset(false);
    return { stop: pause };
  });
})();
