// Demos for slides 2–8: address spaces, layout/ASLR, page walk, TLB, huge pages, page faults.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const hex = (n, w = 0) => '0x' + n.toString(16).padStart(w, '0');
  const size = b => {
    const u = [['ТБ', 2 ** 40], ['ГБ', 2 ** 30], ['МБ', 2 ** 20], ['КБ', 2 ** 10]];
    for (const [name, v] of u) if (b >= v) { const x = b / v; return (x >= 100 || Number.isInteger(x) ? Math.round(x) : dec(x)) + ' ' + name; }
    return b + ' Б';
  };

  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  window.VM = { fmt, dec, hex, size, logger };

  // ---------------------------------------------------------------- two address spaces
  Deck.demo('spaces', root => {
    const X = '0x5555555592a0';
    const PAGES = [
      ['код', '0x555555555000', 'r-x', 'code'],
      ['куча', '0x555555559000', 'rw-', 'heap'],
      ['libc', '0x7ffff7dc2000', 'r-x', 'libc'],
      ['стек', '0x7ffffffde000', 'rw-', 'stack'],
    ];
    const MAP = { A: { code: 2, heap: 4, libc: 6, stack: 8 }, B: { code: 2, heap: 1, libc: 6, stack: 9 } };
    let frames, sel;
    const procs = h('div', { class: 'sp-procs' });
    const ram = h('div', { class: 'sp-frames' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const op = (label, fn, cls = '') => h('button', { class: 'btn small ' + cls, onclick: fn }, h('code', null, label));
    root.append(
      procs,
      h('div', { class: 'sp-ram' }, h('span', { class: 'label' }, 'Физическая память (фреймы)'), ram),
      h('div', { class: 'controls' },
        op('A: x = 42', () => write('A', 42)),
        op('B: print(x)', () => read('B')),
        op('B: x = 99', () => write('B', 99)),
        op('A: *main = 0', segvCode, 'danger'),
        op('B: *NULL', segvNull, 'danger'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      logEl);

    function reset() {
      frames = Array.from({ length: 10 }, () => ({ tag: '', owner: '' }));
      frames[0] = { tag: 'ядро', owner: 'k' };
      frames[3] = { tag: 'чужой', owner: 'o' };
      frames[7] = { tag: 'кэш', owner: 'o' };
      frames[2] = { tag: 'код', owner: 'ab' };
      frames[6] = { tag: 'libc', owner: 'ab' };
      frames[4] = { tag: 'x = 7', owner: 'a' };
      frames[1] = { tag: 'x = 7', owner: 'b' };
      frames[8] = { tag: 'стек', owner: 'a' };
      frames[9] = { tag: 'стек', owner: 'b' };
      sel = null;
      say(`Два экземпляра одной программы (ASLR выключен, чтобы адреса совпали). Переменная <code>x</code> в обоих лежит по адресу <code>${X}</code>.`);
      render();
    }
    function pick(p, key) {
      sel = { p, key };
      const f = MAP[p][key];
      const pg = PAGES.find(x => x[3] === key);
      const other = p === 'A' ? 'B' : 'A';
      const shared = MAP[other][key] === f;
      say(`${p}: страница <code>${pg[1]}</code> (${pg[0]}, ${pg[2]}) → фрейм F${f}. ` +
        (shared ? `Процесс ${other} отображает тот же фрейм: страницы файла в памяти одни на всех.` : `У процесса ${other} по этому же адресу — другой фрейм, F${MAP[other][key]}.`));
      render();
    }
    function write(p, v) {
      const f = MAP[p].heap;
      frames[f].tag = 'x = ' + v;
      sel = { p, key: 'heap' };
      say(`${p} пишет ${v} по адресу <code>${X}</code>. Процессор переводит адрес по таблице ${p} → фрейм F${f}. Фрейм другого процесса не изменился.`, 'ok');
      render();
    }
    function read(p) {
      const f = MAP[p].heap;
      sel = { p, key: 'heap' };
      say(`${p} читает <code>${X}</code> → фрейм F${f} → <b>${frames[f].tag}</b>. Тот же адрес, но своя память.`);
      render();
    }
    function segvCode() {
      sel = { p: 'A', key: 'code' };
      say('A пишет в свой код: страница отображена, но без права записи (W = 0). Page fault, ядро видит, что VMA тоже только для чтения, — <code>SIGSEGV</code>.', 'bad');
      render();
    }
    function segvNull() {
      sel = null;
      say('B читает адрес 0: первая страница никогда не отображается, в таблице пусто. Page fault, VMA для адреса нет — <code>SIGSEGV</code>, «Segmentation fault».', 'bad');
      render();
    }
    function render() {
      procs.innerHTML = '';
      for (const p of ['A', 'B']) {
        procs.append(h('div', { class: 'sp-proc p' + p.toLowerCase() },
          h('b', null, 'Процесс ' + p),
          PAGES.map(([name, addr, perm, key]) => h('button', {
            class: 'sp-page' + (sel && sel.p === p && sel.key === key ? ' sel' : ''),
            onclick: () => pick(p, key),
          }, h('span', { class: 'sp-n' }, name), h('code', null, addr), h('span', { class: 'sp-f' }, '→ F' + MAP[p][key])))));
      }
      const hi = sel ? MAP[sel.p][sel.key] : -1;
      ram.innerHTML = frames.map((f, i) =>
        `<div class="sp-frame o-${f.owner || 'free'}${i === hi ? ' hi' : ''}"><small>F${i}</small><span>${f.tag || 'пусто'}</span></div>`).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- layout and ASLR
  Deck.demo('layout', root => {
    const P = 4096;
    const rnd = bits => Math.floor(Math.random() * 2 ** bits);
    let aslr = true, run = 0, base, sel = 'stack';
    const REG = [
      ['kernel', 'ядро', '---', 'Верхняя половина адресов. Отображена в каждом процессе, но без бита U: из пользовательского кода обращение даёт SIGSEGV.'],
      ['stack', '[stack]', 'rw-', 'Стек главного потока. Растёт вниз, по умолчанию до 8 МБ (<code>ulimit -s</code>). Ниже — защитный зазор: переполнение даёт SIGSEGV, а не порчу кучи.'],
      ['libs', 'libc.so.6', 'r-x', 'Разделяемые библиотеки — <code>mmap</code> файла. Код только для чтения, поэтому его страницы в RAM общие для всех процессов.'],
      ['anon', 'анонимный mmap', 'rw-', 'Большие <code>malloc</code> (от 128 КБ в glibc), арены рантаймов Go и JVM, стеки потоков. Растёт вниз от библиотек.'],
      ['heap', '[heap]', 'rw-', 'Классическая куча: растёт вверх через <code>brk</code>. glibc берёт отсюда мелкие блоки.'],
      ['data', '.data / .bss', 'rw-', 'Глобальные переменные. <code>.bss</code> (нулевые) места в файле не занимает — это анонимная память.'],
      ['text', 'код (.text)', 'r-x', 'Машинный код программы, отображён из исполняемого файла. Писать нельзя, исполнять можно.'],
      ['null', 'страница 0', '---', 'Нулевая страница не отображается никогда, поэтому разыменование NULL падает сразу, а не читает мусор.'],
    ];
    const view = h('div', { class: 'ly-map' });
    const detail = h('div', { class: 'ly-detail', 'aria-live': 'polite' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const tg = h('input', { type: 'checkbox', checked: true });
    tg.addEventListener('change', () => { aslr = tg.checked; relaunch(); });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: relaunch }, 'Запустить заново'),
        h('label', { class: 'toggle' }, tg, h('span', null, 'ASLR (randomize_va_space = 2)'))),
      view, detail, logEl);

    function relaunch() {
      run++;
      // Without ASLR these are the addresses a PIE binary gets on x86-64 Linux.
      const pie = 0x555555554000 + (aslr ? rnd(28) * P : 0);
      const stackTop = 0x7ffffffff000 - (aslr ? rnd(22) * P : 0);
      const mmapTop = stackTop - 0x8000000 - (aslr ? rnd(28) * P : 0x81000);
      base = {
        kernel: 0xffff800000000000,
        stack: stackTop - 0x21000,
        libs: mmapTop - 0x23d000,
        anon: mmapTop - 0x23d000 - 0x4000000,
        heap: pie + 0x5000 + (aslr ? rnd(13) * P : 0),
        data: pie + 0x3000,
        text: pie + 0x1000,
        null: 0,
      };
      say(aslr ? `Запуск №${run}: код, куча, библиотеки и стек сдвинуты на случайные смещения. Относительные расстояния внутри области сохранились.`
        : `Запуск №${run}: ASLR выключен (<code>setarch -R</code>), адреса одинаковые при каждом запуске — удобно отладчику и атакующему.`, aslr ? 'ok' : 'warn');
      render();
    }
    function render() {
      view.innerHTML = '';
      REG.forEach(([key, name, perm], i) => {
        if (i === 1 || i === 4 || i === 7) view.append(h('div', { class: 'ly-gap' }, i === 1 ? 'неканонические адреса' : '…'));
        view.append(h('button', { class: 'ly-reg r-' + key + (sel === key ? ' sel' : ''), onclick: () => { sel = key; render(); } },
          h('span', null, name), h('code', null, key === 'kernel' ? '0xffff800000000000' : hex(base[key], 12)), h('small', null, perm)));
      });
      const r = REG.find(x => x[0] === sel);
      const a = base[sel];
      const LEN = { stack: 0x21000, libs: 0x195000, anon: 0x4000000, heap: 0x21000, data: 0x1000, text: 0x2000 };
      const PATH = { stack: '[stack]', libs: '/usr/lib/libc.so.6', anon: '', heap: '[heap]', text: '/usr/bin/app', data: '/usr/bin/app' };
      const line = sel === 'kernel' || sel === 'null' ? 'в /proc/self/maps не видна' :
        `${a.toString(16)}-${(a + LEN[sel]).toString(16)} ${r[2]}p ${PATH[sel]}`;
      detail.innerHTML = `<b>${r[1]}</b> <span class="label">${r[2]}</span><p>${r[3]}</p><code class="ly-line">${line}</code>`;
    }
    relaunch();
    return {};
  });

  // ---------------------------------------------------------------- 4-level page walk
  Deck.demo('walk', root => {
    // Mapped regions of a process launched without ASLR (same as the layout slide).
    const REGIONS = [[0x555555554000, 0x55555557a000], [0x7ffff7dc2000, 0x7ffff7fff000], [0x7ffffffde000, 0x7ffffffff000]];
    const LEVELS = ['PML4', 'PDPT', 'PD', 'PT'];
    const COVER = ['512 ГБ', '1 ГБ', '2 МБ', '4 КБ'];
    const PRESETS = [['код', '555555555149'], ['куча', '5555555592a0'], ['libc', '7ffff7e1c0a0'], ['стек', '7fffffffe3cc'], ['NULL+8', '8'], ['дыра', '7f0000000000']];
    const hash = (n, salt) => { let x = (n * 2654435761 + salt * 40503) % 2147483647; x = (x * 48271) % 2147483647; return x; };
    const frameOf = (key, salt) => 0x1000 + hash(key % 1e9 + Math.floor(key / 1e9), salt) % 0x3f000;
    const CR3 = 0x1a3f000;
    let addr = 0, steps = [], shown = 0;
    const input = h('input', { class: 'hex-in', value: '5555555592a0', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Виртуальный адрес, hex' });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const bits = h('div', { class: 'wk-bits' });
    const list = h('ol', { class: 'wk-steps' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const stepBtn = h('button', { class: 'btn primary', onclick: step }, 'Шаг');
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'hex-pre' }, '0x'), input, h('button', { class: 'btn', onclick: go }, 'Перевести')),
      h('div', { class: 'controls' }, PRESETS.map(([n, v]) => h('button', { class: 'btn small', onclick: () => { input.value = v; go(); } }, n))),
      bits, h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn small', onclick: () => { while (shown < steps.length) step(); } }, 'Пройти всё')),
      list, logEl);

    const mapped = (a, shift) => {
      const lo = Math.floor(a / 2 ** shift) * 2 ** shift, hi = lo + 2 ** shift;
      return REGIONS.some(([s, e]) => s < hi && e > lo);
    };
    function go() {
      const raw = input.value.trim().replace(/^0x/i, '').replace(/[_\s]/g, '');
      list.innerHTML = '';
      steps = []; shown = 0;
      if (!/^[0-9a-f]{1,16}$/i.test(raw)) { bits.innerHTML = ''; stepBtn.disabled = true; say('Введите адрес в шестнадцатеричном виде, до 16 цифр.', 'warn'); return; }
      const big = BigInt('0x' + raw);
      if (big > 0x7fffffffffffn) {
        bits.innerHTML = '';
        stepBtn.disabled = true;
        if (big >= 0xffff800000000000n) say('Адрес из верхней половины — это ядро. Таблицы его знают, но у записей нет бита U: из пользовательского кода — page fault и <code>SIGSEGV</code>.', 'bad');
        else say('Неканонический адрес: биты 63–48 должны повторять бит 47. Процессор отвергает его сразу (general protection fault), до таблиц дело не доходит.', 'bad');
        return;
      }
      addr = Number(big);
      const idx = [39, 30, 21, 12].map(s => Math.floor(addr / 2 ** s) % 512);
      const off = addr % 4096;
      const bin = (n, w) => n.toString(2).padStart(w, '0');
      bits.innerHTML = idx.map((v, i) => `<div class="wk-chunk c${i}"><span class="label">${LEVELS[i]}</span><code>${bin(v, 9)}</code><b>${v}</b></div>`).join('') +
        `<div class="wk-chunk c4"><span class="label">смещение</span><code>${bin(off, 12)}</code><b>${hex(off, 3)}</b></div>`;
      let table = CR3;
      for (let L = 0; L < 4; L++) {
        const shift = 39 - 9 * L;
        const ok = mapped(addr, shift);
        const next = L < 3 ? frameOf(Math.floor(addr / 2 ** shift), L + 1) * 4096 : frameOf(Math.floor(addr / 4096), 9) * 4096;
        steps.push({ L, table, i: idx[L], ok, next });
        if (!ok) break;
        table = next;
      }
      stepBtn.disabled = false;
      say(`Адрес ${hex(addr)}: четыре индекса по 9 бит выбирают запись в таблице каждого уровня, 12 бит — байт внутри страницы. Нажмите «Шаг».`);
    }
    function step() {
      if (shown >= steps.length) return;
      const s = steps[shown++];
      const li = h('li', { class: s.ok ? '' : 'miss' },
        h('span', { class: 'wk-lv c' + s.L }, LEVELS[s.L]),
        h('span', null, `таблица @ ${hex(s.table)} [${s.i}] → `,
          s.ok ? h('b', null, s.L < 3 ? `${LEVELS[s.L + 1]} @ ${hex(s.next)}` : `фрейм ${hex(s.next)}`) : h('b', null, 'P = 0')));
      list.append(li);
      if (!s.ok) {
        say(`Запись [${s.i}] в ${LEVELS[s.L]} пуста: в этих ${COVER[s.L]} адресов ничего не отображено. Page fault; VMA нет — <code>SIGSEGV</code>. Пустые ветки не занимают памяти — в этом смысл дерева.`, 'bad');
        stepBtn.disabled = true;
        return;
      }
      if (s.L === 3) {
        const phys = s.next + addr % 4096;
        list.append(h('li', { class: 'done' }, h('span', { class: 'wk-lv c4' }, 'RAM'), h('span', null, `${hex(s.next)} + ${hex(addr % 4096, 3)} = `, h('b', null, hex(phys)))));
        say(`Физический адрес ${hex(phys)}. Четыре чтения таблиц ради одного обращения. Перевод сохраняется в TLB, и следующие обращения к этой странице его не повторяют.`, 'ok');
        stepBtn.disabled = true;
      } else say(`${LEVELS[s.L]}: запись [${s.i}] покрывает ${COVER[s.L]} адресов и указывает на таблицу следующего уровня. Это одно обращение к памяти.`);
    }
    go();
    return {};
  });

  // ---------------------------------------------------------------- TLB simulation
  Deck.demo('tlb', root => {
    const SIZES = [4, 8, 16, 32, 64];
    const WS = [8, 32, 128, 1024];
    const MISS = 30; // extra cycles per miss: page walk mostly hitting the caches
    const PER_FRAME = 400;
    const BASE = 0x7f0000000000, ARR = 64 * 2 ** 20;
    let n = 16, pattern = 'seq', ws = 128, huge = false;
    let tlb, pos, acc, miss, hitSlots, missSlots;
    const grid = h('div', { class: 'tl-grid' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    const pbtns = {};
    const patBtn = (key, label) => (pbtns[key] = h('button', { class: 'btn small', onclick: () => { pattern = key; reset(); } }, label));
    const sizeOut = h('output');
    const sizeIn = h('input', { type: 'range', min: 0, max: SIZES.length - 1, value: 2, 'aria-label': 'Записей в TLB' });
    sizeIn.addEventListener('input', () => { n = SIZES[+sizeIn.value]; reset(); });
    const wsOut = h('output');
    const wsIn = h('input', { type: 'range', min: 0, max: WS.length - 1, value: 2, 'aria-label': 'Рабочий набор' });
    wsIn.addEventListener('input', () => { ws = WS[+wsIn.value]; if (pattern !== 'rand') pattern = 'rand'; reset(); });
    const hugeIn = h('input', { type: 'checkbox' });
    hugeIn.addEventListener('change', () => { huge = hugeIn.checked; reset(); });
    root.append(
      h('div', { class: 'controls' }, patBtn('seq', 'подряд по 8 байт'), patBtn('stride', 'шаг 4 КБ'), patBtn('rand', 'случайно')),
      h('label', { class: 'slider inline' }, h('span', { class: 'label tl-l' }, 'записей в TLB'), sizeIn, sizeOut),
      h('label', { class: 'slider inline' }, h('span', { class: 'label tl-l' }, 'случайно по'), wsIn, wsOut),
      h('label', { class: 'toggle' }, hugeIn, h('span', null, 'страницы по 2 МБ')),
      grid, stats, logEl);

    const loop = rafLoop(() => {
      hitSlots = new Set(); missSlots = new Set();
      for (let k = 0; k < PER_FRAME; k++) access(next());
      render();
    });
    function reset() {
      tlb = []; // most recent last: [{vpn}]
      pos = 0; acc = 0; miss = 0;
      Object.entries(pbtns).forEach(([k, b]) => b.classList.toggle('sel', k === pattern));
      sizeOut.textContent = n;
      wsOut.textContent = size(ws * 4096);
      const per = huge ? 2 ** 21 : 4096;
      const text = {
        seq: `Подряд по массиву: на страницу ${fmt(per / 8)} обращений, промах только на первом.`,
        stride: `Шаг 4 КБ: каждое обращение — новая ${huge ? 'четырёхкилобайтная часть той же 2 МБ страницы, 512 обращений на запись TLB' : 'страница. Массив 64 МБ — 16 384 страницы, TLB их не удержит'}.`,
        rand: `Случайно по ${size(ws * 4096)}: ${huge ? `всего ${hp(ws)}` : `${ws} страниц на ${n} записей`}.`,
      }[pattern];
      say(text);
    }
    const hp = w => { const k = Math.max(1, Math.ceil(w * 4096 / 2 ** 21)); return k + ' ' + plural(k, ['большая страница', 'большие страницы', 'больших страниц']); };
    function next() {
      if (pattern === 'seq') { pos = (pos + 8) % ARR; return BASE + pos; }
      if (pattern === 'stride') { pos = (pos + 4096) % ARR; return BASE + pos; }
      return BASE + Math.floor(Math.random() * ws * 512) * 8;
    }
    function access(a) {
      const vpn = Math.floor(a / (huge ? 2 ** 21 : 4096));
      acc++;
      const i = tlb.indexOf(vpn);
      if (i >= 0) { tlb.splice(i, 1); tlb.push(vpn); hitSlots.add(vpn); return; }
      miss++;
      if (tlb.length >= n) tlb.shift();
      tlb.push(vpn);
      missSlots.add(vpn);
    }
    function render() {
      const cells = [];
      const sorted = [...tlb].sort((a, b) => a - b);
      for (let i = 0; i < n; i++) {
        const v = sorted[i];
        if (v == null) { cells.push('<i class="tl-c empty"></i>'); continue; }
        const cls = missSlots.has(v) ? 'miss' : hitSlots.has(v) ? 'hit' : '';
        cells.push(`<i class="tl-c ${cls}">${(v % 0x10000).toString(16).padStart(4, '0')}</i>`);
      }
      grid.style.setProperty('--cols', Math.min(n, 8));
      grid.innerHTML = cells.join('');
      const mr = acc ? miss / acc : 0;
      stats.innerHTML =
        `<div class="stat"><b>${fmt(acc)}</b><span>обращений</span></div>` +
        `<div class="stat ${mr > 0.2 ? 'warn' : ''}"><b>${dec((1 - mr) * 100, 1)}%</b><span>попаданий в TLB</span></div>` +
        `<div class="stat ${mr > 0.2 ? 'warn' : ''}"><b>+${dec(mr * MISS, 1)}</b><span>тактов на обращение (промах ≈ ${MISS})</span></div>`;
    }
    reset();
    render();
    return { start: loop.start, stop: loop.stop };
  });

  // ---------------------------------------------------------------- huge pages calculator
  Deck.demo('huge', root => {
    const WS = [64 * 2 ** 20, 256 * 2 ** 20, 2 ** 30, 4 * 2 ** 30, 16 * 2 ** 30, 32 * 2 ** 30, 64 * 2 ** 30, 256 * 2 ** 30];
    const PROCS = [1, 10, 50, 100, 200, 500];
    // Intel Skylake L2 TLB: 1536 shared entries for 4 KB and 2 MB pages, 16 for 1 GB.
    const PS = [['4 КБ', 2 ** 12, 1536], ['2 МБ', 2 ** 21, 1536], ['1 ГБ', 2 ** 30, 16]];
    let ps = 0;
    const mk = (label, list, idx, show) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
      const set = () => { out.textContent = show(list[+input.value]); };
      set();
      input.addEventListener('input', () => { set(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label hg-l' }, label), input, out));
      return () => list[+input.value];
    };
    const psBtns = PS.map(([name], i) => h('button', { class: 'btn small', onclick: () => { ps = i; update(); } }, name));
    root.append(h('div', { class: 'controls' }, h('span', { class: 'label' }, 'страница'), psBtns));
    const ws = mk('память', WS, 5, size);
    const procs = mk('процессов', PROCS, 3, String);
    const stats = h('div', { class: 'stats' });
    const reach = h('div', { class: 'hg-reach' });
    const logEl = h('p', { class: 'log' });
    root.append(stats, reach, logEl);

    // Page-table bytes for one process mapping `w` bytes with pages of `p` bytes (tables are 4 KB pages).
    function tables(w, p) {
      let bytes = 0;
      for (const span of [2 ** 21, 2 ** 30, 2 ** 39, 2 ** 48]) {
        if (span <= p) continue; // this level is not used: the entry above maps the page directly
        bytes += Math.ceil(w / span) * 4096;
      }
      return bytes;
    }
    function update() {
      psBtns.forEach((b, i) => b.classList.toggle('sel', i === ps));
      const [name, p, entries] = PS[ps];
      const w = ws(), n = procs();
      const pages = Math.ceil(w / p);
      const per = tables(w, p), total = per * n;
      const r = entries * p, cov = Math.min(1, r / w);
      stats.innerHTML =
        `<div class="stat"><b>${fmt(pages)}</b><span>страниц по ${name}</span></div>` +
        `<div class="stat"><b>${size(per)}</b><span>таблиц страниц на процесс</span></div>` +
        `<div class="stat ${total > 2 ** 30 ? 'warn' : ''}"><b>${size(total)}</b><span>таблиц у ${n} ${plural(n, ['процесса', 'процессов', 'процессов'])}</span></div>`;
      reach.innerHTML = `<span class="label">TLB покрывает ${entries} × ${name} = ${size(r)}</span>` +
        `<span class="cost-track"><span class="cost-fill" style="width:${cov * 100}%"></span></span>` +
        `<span class="label">${cov >= 1 ? 'весь набор' : dec(cov * 100, cov < 0.01 ? 2 : 1) + '% рабочего набора'}</span>`;
      if (ps === 0 && total > 2 ** 30) logEl.innerHTML = `Одни таблицы страниц занимают ${size(total)} — по ${size(per)} в каждом процессе, хотя память у них общая. TLB покрывает ничтожную долю: почти каждое случайное обращение — промах.`, logEl.className = 'log bad';
      else if (ps === 0) logEl.innerHTML = cov < 1 ? `TLB держит переводы только для ${size(r)}. Случайный доступ к ${size(w)} почти всегда промахивается.` : 'Набор маленький — хватает и обычных страниц.', logEl.className = 'log ' + (cov < 1 ? 'warn' : 'ok');
      else logEl.innerHTML = `Страниц в ${fmt(p / 4096)} раз меньше: таблицы — ${size(per)} на процесс, TLB покрывает ${size(r)}. Цена — память выделяется кусками по ${name}, а при copy-on-write копируется вся большая страница.`, logEl.className = 'log ok';
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- page fault paths
  Deck.demo('fault', root => {
    const OK = 'ok', BAD = 'bad', W = 'warn';
    const S = [
      ['Повторное чтение', 'none', 'нет fault', [['TLB: попадание', OK], ['Чтение из кэша или RAM', OK]],
        'Перевод уже в TLB — таблицы не нужны. Так проходит подавляющее большинство обращений.'],
      ['Первая запись в malloc-память', 'minor', '≈ 1 мкс', [['TLB: промах', W], ['PTE: P = 0', W], ['#PF → ядро', W], ['VMA: анонимная, rw-', OK], ['Взять фрейм, обнулить 4 КБ', OK], ['Записать PTE, повторить инструкцию', OK]],
        'Ленивое выделение: память появляется при первой записи. Ядро обязано обнулить фрейм — чтобы не отдать чужие данные.'],
      ['mmap файла, файл в page cache', 'minor', '≈ 1 мкс', [['TLB: промах', W], ['PTE: P = 0', W], ['#PF → ядро', W], ['VMA: файл, r--', OK], ['Страница уже в page cache', OK], ['Подключить тот же фрейм в PTE', OK]],
        'Диска не было: страница файла уже в памяти, её просто подключили. Так работают общие библиотеки — один фрейм на все процессы.'],
      ['mmap файла, которого нет в кэше', 'major', '0,1–10 мс', [['TLB: промах', W], ['PTE: P = 0', W], ['#PF → ядро', W], ['VMA: файл, r--', OK], ['В page cache нет — чтение с диска', BAD], ['Поток спит до конца I/O', BAD], ['Подключить фрейм, повторить', OK]],
        'Major fault: поток стоит, пока идёт чтение. Так выглядит холодный старт и «случайно медленный» запрос к базе на mmap.'],
      ['Страница выгружена в swap', 'major', '0,1–10 мс', [['TLB: промах', W], ['PTE: P = 0, внутри — место в swap', W], ['#PF → ядро', W], ['VMA: анонимная, rw-', OK], ['Прочитать страницу из swap', BAD], ['Подключить фрейм, повторить', OK]],
        'Для выгруженной страницы ядро хранит в PTE адрес в swap. Каждая такая страница — чтение с диска.'],
      ['Запись после fork', 'minor', '≈ 1–2 мкс', [['TLB: промах', W], ['PTE: P = 1, W = 0', W], ['#PF → ядро', W], ['VMA: rw- — значит, copy-on-write', OK], ['Скопировать 4 КБ в новый фрейм', W], ['PTE → новый фрейм, W = 1', OK]],
        'Страница общая с другим процессом. Ядро копирует её — с этого момента у каждого своя.'],
      ['Запись в код', 'segv', 'SIGSEGV', [['TLB: попадание, W = 0', W], ['#PF → ядро', W], ['VMA: r-x — записи нет', BAD], ['SIGSEGV', BAD]],
        'VMA запрещает запись — это ошибка программы, а не повод что-то копировать.'],
      ['Разыменование NULL или free()', 'segv', 'SIGSEGV', [['TLB: промах', W], ['PTE: P = 0', W], ['#PF → ядро', W], ['VMA для адреса нет', BAD], ['SIGSEGV', BAD]],
        'Адреса нет ни в одной VMA. Use-after-free падает так, только если память уже вернули ядру через <code>munmap</code>; иначе тихо читается чужой объект.'],
    ];
    const KIND = { none: ['без fault', 'ok'], minor: ['minor fault', 'ok'], major: ['major fault', 'warn'], segv: ['SIGSEGV', 'bad'] };
    const btns = S.map((s, i) => h('button', { class: 'sy-btn', onclick: () => show(i) }, s[0]));
    const flow = h('ol', { class: 'pf-flow' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(h('div', { class: 'sy-list' }, btns), flow, logEl);
    function show(i) {
      const [, kind, cost, steps, text] = S[i];
      btns.forEach((b, j) => b.classList.toggle('sel', i === j));
      flow.innerHTML = steps.map(([t, c], k) => `<li class="${c}" style="animation-delay:${k * 70}ms">${t}</li>`).join('') +
        `<li class="verdict ${KIND[kind][1]}" style="animation-delay:${steps.length * 70}ms"><b>${KIND[kind][0]}</b> · ${cost}</li>`;
      logEl.innerHTML = text;
      logEl.className = 'log ' + KIND[kind][1];
    }
    show(1);
    return {};
  });
})();
