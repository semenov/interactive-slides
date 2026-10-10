// Demos for slides 12–16: free-list allocator, size classes, values vs references, escape analysis, slice growth.
(() => {
  'use strict';
  const { h, highlight, plural } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const KB = 1024, MB = 1024 * KB, GB = 1024 * MB;
  const bytes = n => {
    if (n >= GB) return (n / GB).toFixed(1).replace('.', ',') + ' ГБ';
    if (n >= MB) return (n / MB).toFixed(n >= 10 * MB ? 0 : 1).replace('.', ',') + ' МБ';
    if (n >= 10 * KB) return Math.round(n / KB) + ' КБ';
    if (n >= KB) return (n / KB).toFixed(1).replace('.', ',') + ' КБ';
    return Math.round(n) + ' Б';
  };

  // Go size classes (runtime/sizeclasses.go), bytes.
  const GO_CLASSES = [8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 352, 384, 416, 448, 480, 512, 576, 640, 704, 768, 896, 1024, 1152, 1280, 1408, 1536, 1792, 2048, 2304, 2688, 3072, 3200, 3456, 4096, 4864, 5376, 6144, 6528, 6784, 6912, 8192, 9472, 9728, 10240, 10880, 12288, 13568, 14336, 16384, 18432, 19072, 20480, 21760, 24576, 27264, 28672, 32768];
  const goRound = n => n <= 32768 ? GO_CLASSES.find(c => c >= n) : Math.ceil(n / 8192) * 8192;

  // ---------------------------------------------------------------- first-fit free-list allocator
  Deck.demo('allocator', root => {
    const UNIT = 16, UNITS = 64;
    const REQS = [24, 60, 120, 200];
    let blocks, nextId, coalesce = true;
    const grid = h('div', { class: 'al-grid' });
    const live = h('div', { class: 'al-live' });
    const flist = h('div', { class: 'al-flist' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const coIn = h('input', { type: 'checkbox', checked: true });
    coIn.addEventListener('change', () => { coalesce = coIn.checked; });
    root.append(
      h('div', { class: 'controls' },
        REQS.map(n => h('button', { class: 'btn small', onclick: () => alloc(n) }, h('code', null, `malloc(${n})`))),
        h('button', { class: 'btn small', onclick: scenario }, 'Сценарий'),
        h('button', { class: 'btn small', onclick: () => { reset(); say('Куча пуста: один свободный блок на 1 КБ.'); render(); } }, 'Сброс')),
      h('label', { class: 'toggle' }, coIn, h('span', null, 'склеивать соседние свободные блоки при free')),
      grid, live, flist, stats, logEl);

    const lines = [];
    function say(text, cls = '') {
      lines.unshift(text);
      lines.length = 1;
      logEl.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      logEl.className = 'log ' + cls;
    }
    function reset() {
      blocks = [{ start: 0, size: UNITS, free: true }];
      nextId = 1;
    }
    const freeBlocks = () => blocks.filter(b => b.free);
    const largest = () => Math.max(0, ...freeBlocks().map(b => b.size));
    function alloc(n, quiet) {
      const need = 1 + Math.ceil(n / UNIT);
      const i = blocks.findIndex(b => b.free && b.size >= need);
      if (i < 0) {
        const free = freeBlocks().reduce((s, b) => s + b.size, 0) * UNIT;
        if (!quiet) say(`<code>malloc(${n})</code>: нужен блок ${need * UNIT} Б, но самый большой свободный — ${largest() * UNIT} Б, хотя свободно всего ${free} Б. Это фрагментация. Настоящий аллокатор попросил бы у ОС ещё памяти (<code>brk</code>/<code>mmap</code>) — процесс вырос бы.`, 'bad');
        render();
        return false;
      }
      const b = blocks[i];
      let note;
      if (b.size - need >= 2) {
        blocks.splice(i + 1, 0, { start: b.start + need, size: b.size - need, free: true });
        b.size = need;
        note = `отрезан от свободного блока, остаток ${blocks[i + 1].size * UNIT} Б вернулся в список`;
      } else {
        note = b.size > need ? `остаток ${(b.size - need) * UNIT} Б слишком мал для отдельного блока — отдан целиком` : 'подошёл точно';
      }
      b.free = false; b.req = n; b.id = nextId++;
      if (!quiet) say(`<code>p${b.id} = malloc(${n})</code>: первый подходящий блок по смещению 0x${(b.start * UNIT).toString(16)} — ${note}. Заголовок 16 Б + ${(b.size - 1) * UNIT} Б данных.`);
      if (!quiet) render();
      return true;
    }
    function free(id) {
      let i = blocks.findIndex(b => b.id === id);
      const b = blocks[i];
      b.free = true; delete b.id; delete b.req;
      let merged = 0;
      if (coalesce) {
        const nx = blocks[i + 1];
        if (nx && nx.free) { b.size += nx.size; blocks.splice(i + 1, 1); merged++; }
        const pv = blocks[i - 1];
        if (pv && pv.free) { pv.size += b.size; blocks.splice(i, 1); merged++; i--; }
      }
      say(`<code>free(p${id})</code>: блок вернулся в список свободных` + (coalesce
        ? (merged ? ` и склеился с ${merged === 2 ? 'обоими соседями' : 'соседом'} — теперь это один блок ${blocks[i].size * UNIT} Б. Соседей находят по заголовкам за O(1).` : '. Соседи заняты — склеивать не с чем.')
        : '. Склейка выключена: соседние свободные блоки остаются отдельными крошками.'), merged ? 'ok' : '');
      render();
    }
    function scenario() {
      reset();
      while (alloc(24, true));
      blocks.filter(b => !b.free && b.id % 2 === 0).map(b => b.id).forEach(id => {
        const b = blocks.find(x => x.id === id);
        b.free = true; delete b.id; delete b.req;
      });
      const free = freeBlocks().reduce((s, b) => s + b.size, 0) * UNIT;
      say(`Выделили 21 блок по 24 Б и освободили каждый второй. Свободно ${free} Б — почти половина кучи, но кусками по 48 Б. Теперь попробуйте <code>malloc(200)</code>.`, 'warn');
      render();
    }
    function render() {
      const cells = [];
      for (const b of blocks) {
        for (let u = 0; u < b.size; u++) {
          const cls = b.free ? 'fr' : 'al c' + (b.id % 4);
          const head = u === 0;
          const used = !b.free && (u - 1) * UNIT < b.req;
          cells.push(`<span class="al-c ${cls}${head ? ' hd' : ''}${!b.free && !head && !used ? ' pad' : ''}"${b.free ? '' : ` data-id="${b.id}"`}>${head ? (b.free ? '·' : 'p' + b.id) : ''}</span>`);
        }
      }
      grid.innerHTML = cells.join('');
      const al = blocks.filter(b => !b.free);
      live.innerHTML = al.length ? '<span class="label">освободить:</span>' + al.slice(0, 8).map(b => `<button class="btn small" data-id="${b.id}"><code>free(p${b.id})</code></button>`).join('') + (al.length > 8 ? `<span class="empty">ещё ${al.length - 8} — нажмите на блок</span>` : '') : '<span class="empty">Нет выделенных блоков</span>';
      const fb = freeBlocks();
      flist.innerHTML = '<span class="label">список свободных:</span> ' + (fb.length ? fb.slice(0, 5).map(b => `<code>[0x${(b.start * UNIT).toString(16)}: ${b.size * UNIT} Б]</code>`).join(' → ') + (fb.length > 5 ? ` → … ещё ${fb.length - 5}` : '') : '<span class="empty">пусто</span>');
      const freeB = fb.reduce((s, b) => s + b.size, 0) * UNIT;
      const lg = largest() * UNIT;
      const frag = freeB ? Math.round((1 - lg / freeB) * 100) : 0;
      const req = al.reduce((s, b) => s + b.req, 0);
      stats.innerHTML = `<div class="stat"><b>${req} Б</b><span>запрошено (${al.length} ${plural(al.length, ['блок', 'блока', 'блоков'])})</span></div>` +
        `<div class="stat"><b>${freeB} Б</b><span>свободно, крупнейший — ${lg} Б</span></div>` +
        `<div class="stat ${frag > 50 ? 'warn' : ''}"><b>${frag}%</b><span>фрагментация</span></div>`;
    }
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-id]');
      if (t && root.contains(t)) free(+t.dataset.id);
    });
    reset();
    say('Куча — 1 КБ, сетка по 16 байт. Выделите несколько блоков, потом освободите средний — кнопкой или нажав на блок.');
    render();
    return {};
  });

  // ---------------------------------------------------------------- size classes: Go runtime and glibc
  Deck.demo('sizeclass', root => {
    const SIZES = [1, 8, 9, 17, 24, 33, 50, 65, 100, 129, 200, 257, 500, 513, 1000, 1025, 1100, 2049, 3000, 4097, 5000, 8193, 10000, 20000, 32768, 32769, 50000, 100000, 131072, 300000, 1048576, 10485760];
    const inp = h('input', { type: 'range', min: 0, max: SIZES.length - 1, value: 6, 'aria-label': 'Размер запроса' });
    const out = h('output');
    const goCard = h('div', { class: 'sc-card' });
    const cCard = h('div', { class: 'sc-card' });
    const logEl = h('p', { class: 'log' });
    inp.addEventListener('input', update);
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'запрос'), inp, out), goCard, cCard, logEl);
    const chain = (steps, on) => `<div class="sc-path">${steps.map((s, i) => `<span class="${i === on ? 'on' : ''}">${s}</span>`).join('<i>→</i>')}</div>`;
    const card = (title, got, n, steps, on, cost) => {
      const waste = got - n;
      return `<div class="sc-h"><b>${title}</b><span>${bytes(n)} → <b>${bytes(got)}</b> · потеря ${waste ? bytes(waste) + ' (' + Math.round((waste / got) * 100) + '%)' : '0'}</span></div>` +
        chain(steps, on) + `<div class="sc-cost">${cost}</div>`;
    };
    function update() {
      const n = SIZES[+inp.value];
      out.textContent = fmt(n) + ' Б';
      // Go
      const goSteps = ['mcache (свой у P)', 'mcentral', 'mheap', 'ОС'];
      if (n < 16) {
        goCard.innerHTML = card('Go', 16, n, ['tiny: 16-байтный блок на несколько объектов', 'mcache', 'mcentral'], 0, '≈ 10 нс. Мелкие объекты без указателей упаковываются вместе в один 16-байтный блок (здесь потеря — только если некого подселить).');
      } else if (n <= 32768) {
        goCard.innerHTML = card('Go', goRound(n), n, goSteps, 0, `класс ${GO_CLASSES.indexOf(goRound(n)) + 1} из 67 · ≈ 10–30 нс: блок берётся из span нужного класса в кэше P без блокировок. Кончился — span из mcentral (блокировка класса).`);
      } else {
        goCard.innerHTML = card('Go', goRound(n), n, goSteps, 2, 'Больше 32 КБ — «крупный объект»: отдельный span прямо из mheap, округление до страниц по 8 КБ, глобальная блокировка. Микросекунды и обнуление памяти.');
      }
      // glibc
      if (n >= 131072) {
        const got = Math.ceil((n + 16) / 4096) * 4096;
        cCard.innerHTML = card('glibc malloc', got, n, ['tcache', 'арена', 'mmap'], 2, 'От 128 КБ (M_MMAP_THRESHOLD) — отдельный <code>mmap</code>: системный вызов, округление до страниц 4 КБ, а при первом касании каждой страницы — page fault и её обнуление. <code>free</code> сразу делает <code>munmap</code>.');
      } else {
        const got = Math.max(32, (n + 8 + 15) & ~15);
        const tc = n <= 1032;
        cCard.innerHTML = card('glibc malloc', got, n, ['tcache (свой у потока)', 'арена (под блокировкой)', 'mmap'], tc ? 0 : 1,
          tc ? 'Блок с 8-байтным заголовком, кратен 16, минимум 32 Б. До 1032 Б — из tcache потока: 7 блоков каждого размера, без блокировок, ≈ 10–20 нс.'
            : 'Больше 1032 Б tcache не кэширует: поиск в корзинах арены под её мьютексом, ≈ 50–100 нс, при конкуренции потоков — больше.');
      }
      logEl.innerHTML = 'Стек для сравнения: место под локальные выделено одной инструкцией при входе в функцию — 0 нс на переменную. Плюс куча в языках со сборщиком мусора: каждый выделенный байт потом надо найти и освободить.';
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- values vs references
  Deck.demo('values', root => {
    const V = [
      { id: 'goval', name: 'Go []Point', per: 16, fixed: 24, allocs: n => 1, kind: 'flat', note: 'Один непрерывный массив по 16 байт на точку. Обход читает память подряд — процессор подгружает её заранее.' },
      { id: 'goptr', name: 'Go []*Point', per: 24, fixed: 24, allocs: n => n + 1, kind: 'ptr', note: 'Массив указателей по 8 байт плюс отдельный объект 16 байт на каждую точку. Каждое выделение — работа для аллокатора и сборщика мусора.' },
      { id: 'java', name: 'Java Point[]', per: 36, fixed: 16, allocs: n => n + 1, kind: 'ptr', note: 'Ссылка 4 байта (сжатые указатели) + объект: заголовок 12 байт + два double по 8 = 28, выравнивание до 32. Value-классы (Valhalla) позволят хранить точки плоско.' },
      { id: 'py', name: 'Python list[tuple]', per: 112, fixed: 56, allocs: n => 3 * n + 1, kind: 'py', note: 'Указатель в списке 8 байт, кортеж из двух — 56 байт, каждый float — отдельный объект на 24 байта. Три объекта в куче на одну точку, у каждого счётчик ссылок.' },
      { id: 'np', name: 'NumPy (n, 2)', per: 16, fixed: 112, allocs: n => 1, kind: 'flat', note: 'Числа лежат плоско, как в C: 16 байт на точку и один буфер. Операции над всем массивом выполняет C-код без объектов Python.' },
    ];
    const NS = [1000, 10000, 100000, 1000000, 10000000];
    let v = V[0];
    const tabs = h('div', { class: 'controls' }, V.map(x => h('button', { class: 'btn small', 'data-id': x.id, onclick: () => { v = x; update(); } }, x.name)));
    const nIn = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 3, 'aria-label': 'Число точек' });
    const nOut = h('output');
    const pic = h('div', { class: 'vl-pic' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    nIn.addEventListener('input', update);
    root.append(tabs, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'точек'), nIn, nOut), pic, stats, logEl);

    function svg(kind) {
      const W = 340, cw = 60;
      let s = `<svg viewBox="0 0 ${W} ${kind === 'py' ? 150 : kind === 'ptr' ? 110 : 44}" role="img" aria-label="Раскладка в памяти">`;
      if (kind === 'flat') {
        for (let i = 0; i < 5; i++) {
          s += `<rect x="${4 + i * 66}" y="8" width="31" height="28" class="vx"/><rect x="${35 + i * 66}" y="8" width="31" height="28" class="vy"/>` +
            `<text x="${19 + i * 66}" y="27">x</text><text x="${50 + i * 66}" y="27">y</text>`;
        }
        return s + '</svg>';
      }
      const order = [2, 0, 4, 1, 3];
      for (let i = 0; i < 5; i++) {
        const bx = 8 + order[i] * 66, by = 70;
        s += `<rect x="${4 + i * 30}" y="8" width="26" height="24" class="vp"/><circle cx="${17 + i * 30}" cy="20" r="3" class="dot"/>` +
          `<path d="M${17 + i * 30} 23 C ${17 + i * 30} 50, ${bx + 26} 46, ${bx + 26} ${by}" class="ln"/>`;
        if (kind === 'ptr') {
          s += `<rect x="${bx}" y="${by}" width="52" height="28" class="obj"/><text x="${bx + 26}" y="${by + 19}">x y</text>`;
        } else {
          s += `<rect x="${bx}" y="${by}" width="52" height="28" class="obj"/><text x="${bx + 26}" y="${by + 19}">tuple</text>` +
            `<path d="M${bx + 14} ${by + 28} L ${bx + 6} ${by + 52}" class="ln"/><path d="M${bx + 38} ${by + 28} L ${bx + 46} ${by + 52}" class="ln"/>` +
            `<rect x="${bx - 6}" y="${by + 52}" width="24" height="20" class="flt"/><rect x="${bx + 34}" y="${by + 52}" width="24" height="20" class="flt"/>`;
        }
      }
      s += `<text x="${5 * 30 + 18}" y="25" class="lbl" text-anchor="start">← указатели</text>`;
      return s + '</svg>';
    }
    function update() {
      const n = NS[+nIn.value];
      nOut.textContent = fmt(n);
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.id === v.id));
      pic.innerHTML = svg(v.kind);
      const total = v.fixed + v.per * n, allocs = v.allocs(n);
      stats.innerHTML = `<div class="stat"><b>${bytes(total)}</b><span>в памяти</span></div>` +
        `<div class="stat ${allocs > 1 ? 'warn' : ''}"><b>${fmt(allocs)}</b><span>${plural(allocs, ['выделение', 'выделения', 'выделений'])} в куче</span></div>` +
        `<div class="stat"><b>${v.per} Б</b><span>на точку (данных — 16)</span></div>`;
      logEl.innerHTML = v.note;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- escape analysis guessing game
  Deck.demo('escape', root => {
    const Q = [
      { src: 'func dist() float64 {\n    p := &Point{3, 4}\n    return math.Hypot(p.X, p.Y)\n}', heap: false, m: '&Point{...} does not escape', why: '<code>&amp;</code> не значит «куча». Указатель не покидает функцию — значит, объект на стеке.' },
      { src: 'func NewPoint() *Point {\n    return &Point{3, 4}\n}', heap: true, m: '&Point{...} escapes to heap', why: 'Указатель возвращается — объект переживёт кадр. Но маленькая <code>NewPoint</code> встроится в вызывающую функцию, и там объект может снова оказаться на стеке.' },
      { src: 'func logN(n int) {\n    fmt.Println(n)\n}', heap: true, m: 'n escapes to heap', why: '<code>Println</code> принимает <code>...any</code>: значение упаковывается в интерфейс, а компилятор не видит, что <code>Println</code> его не сохранит. Числа 0–255 рантайм берёт из готовой таблицы без выделения, остальные — в кучу.' },
      { src: 'func sum() int {\n    b := make([]byte, 1024)\n    fill(b)\n    return total(b)\n}', heap: false, m: 'make([]byte, 1024) does not escape', why: 'Размер известен при компиляции, срез не убегает — 1 КБ на стеке. Предел для такого — 64 КБ, больше уйдёт в кучу.' },
      { src: 'func sum(n int) int {\n    b := make([]byte, n)\n    fill(b)\n    return total(b)\n}', heap: true, m: 'make([]byte, n) escapes to heap', why: 'Размер кадра должен быть известен заранее, а <code>n</code> — нет. С Go 1.25 компилятор держит на стеке буфер на 32 байта и идёт в кучу, только если <code>n</code> больше.' },
      { src: 'func run() {\n    x := 0\n    go func() { x++ }()\n}', heap: true, m: 'moved to heap: x', why: 'Горутина может жить дольше <code>run</code>, и её стек — другой. Захваченная переменная уходит в кучу.' },
      { src: 'var cache []*User\n\nfunc remember(u User) {\n    cache = append(cache, &u)\n}', heap: true, m: 'moved to heap: u', why: 'Адрес сохраняется в глобальной переменной — значение должно пережить вызов.' },
    ];
    let i = 0, score = 0, answered = [];
    const head = h('div', { class: 'es-head' });
    const code = h('pre', { class: 'code es-code' });
    const res = h('div', { class: 'log', 'aria-live': 'polite' });
    const bStack = h('button', { class: 'btn', onclick: () => answer(false) }, 'Стек');
    const bHeap = h('button', { class: 'btn', onclick: () => answer(true) }, 'Куча');
    const bNext = h('button', { class: 'btn primary', onclick: () => show(i + 1) }, 'Дальше →');
    root.append(head, code, h('div', { class: 'controls' }, bStack, bHeap, bNext), res);
    function show(k) {
      if (k >= Q.length) { i = 0; score = 0; answered = []; k = 0; }
      i = k;
      const q = Q[i];
      head.innerHTML = `<span class="label">Фрагмент ${i + 1} из ${Q.length}</span><span class="label">верно: ${score} из ${answered.length}</span>`;
      code.innerHTML = `<code>${highlight(q.src, 'go')}</code>`;
      bStack.disabled = bHeap.disabled = false;
      bStack.className = bHeap.className = 'btn';
      bNext.hidden = true;
      res.className = 'log';
      res.innerHTML = 'Где окажется значение: на стеке или в куче?';
    }
    function answer(heap) {
      const q = Q[i];
      const ok = heap === q.heap;
      if (ok) score++;
      answered.push(ok);
      bStack.disabled = bHeap.disabled = true;
      (q.heap ? bHeap : bStack).classList.add('right');
      bNext.hidden = false;
      bNext.textContent = i === Q.length - 1 ? 'Сначала' : 'Дальше →';
      head.innerHTML = `<span class="label">Фрагмент ${i + 1} из ${Q.length}</span><span class="label">верно: ${score} из ${answered.length}</span>`;
      res.className = 'log ' + (ok ? 'ok' : 'bad');
      res.innerHTML = `<div><b>${ok ? 'Верно' : 'Нет'}: ${q.heap ? 'куча' : 'стек'}.</b> <code>-gcflags=-m</code>: <code>${q.m.replace(/&/g, '&amp;')}</code></div><div>${q.why}</div>`;
    }
    show(0);
    return {};
  });

  // ---------------------------------------------------------------- growth of dynamic arrays
  Deck.demo('grow', root => {
    const NS = [10, 100, 1000, 10000, 100000, 1000000, 10000000];
    let lang = 'go';
    const tabs = h('div', { class: 'controls' },
      h('button', { class: 'btn small', 'data-l': 'go', onclick: () => { lang = 'go'; update(); } }, 'Go: append'),
      h('button', { class: 'btn small', 'data-l': 'py', onclick: () => { lang = 'py'; update(); } }, 'Python: list.append'));
    const nIn = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 3, 'aria-label': 'Число элементов' });
    const nOut = h('output');
    const preIn = h('input', { type: 'checkbox' });
    const preLbl = h('span');
    const caps = h('div', { class: 'gr-caps' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    nIn.addEventListener('input', update);
    preIn.addEventListener('change', update);
    root.append(tabs, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'элементов'), nIn, nOut),
      h('label', { class: 'toggle' }, preIn, preLbl), caps, stats, logEl);

    // runtime.growslice for 8-byte elements (Go 1.20+), then rounding to a size class.
    function goNext(old, need) {
      let nc = old;
      const dbl = old * 2;
      if (need > dbl) nc = need;
      else if (old < 256) nc = dbl;
      else while (nc < need) nc += (nc + 3 * 256) >> 2;
      return goRound(nc * 8) / 8;
    }
    // Objects/listobject.c list_resize (3.12).
    function pyNext(old, need) {
      let na = (need + (need >> 3) + 6) & ~3;
      if (need - old > na - need) na = (need + 3) & ~3;
      return na;
    }
    function update() {
      const n = NS[+nIn.value];
      nOut.textContent = fmt(n);
      tabs.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.l === lang));
      preLbl.innerHTML = lang === 'go' ? 'заранее: <code>make([]int, 0, n)</code>' : 'заранее: <code>[0] * n</code> и запись по индексу';
      const seq = [];
      let cap = 0, copied = 0, total = 0;
      if (preIn.checked) {
        cap = lang === 'go' ? goRound(n * 8) / 8 : n;
        seq.push(cap); total = cap * 8;
      } else {
        for (let len = 0; len < n; len++) {
          if (len === cap) {
            copied += len * 8;
            cap = lang === 'go' ? goNext(cap, len + 1) : pyNext(cap, len + 1);
            seq.push(cap);
            total += cap * 8;
          }
        }
      }
      const shown = seq.length > 14 ? [...seq.slice(0, 9), '…', ...seq.slice(-4)] : seq;
      caps.innerHTML = '<span class="label">ёмкости:</span> ' + shown.map(c => c === '…' ? '<i>…</i>' : `<code>${fmt(c)}</code>`).join(' ');
      const allocs = seq.length;
      stats.innerHTML = `<div class="stat ${allocs > 3 ? 'warn' : ''}"><b>${fmt(allocs)}</b><span>${plural(allocs, ['выделение', 'выделения', 'выделений'])}</span></div>` +
        `<div class="stat"><b>${bytes(copied)}</b><span>${lang === 'go' ? 'скопировано' : 'скопировано (максимум)'}</span></div>` +
        `<div class="stat"><b>${bytes(total - cap * 8)}</b><span>ушло в мусор</span></div>`;
      const extra = Math.round(((cap - n) / n) * 100);
      logEl.innerHTML = preIn.checked
        ? `Одно выделение, ничего не копируется. ${lang === 'go' && cap > n ? `Ёмкость ${fmt(cap)} — округлено до класса размера.` : ''}`
        : `Итоговая ёмкость ${fmt(cap)} — запас ${extra}%. Каждый рост — новое выделение и копирование всех элементов${lang === 'py' ? ' (realloc иногда расширяет блок на месте, тогда копирования нет)' : ''}, а старые массивы — мусор для ${lang === 'go' ? 'сборщика' : 'аллокатора'}.`;
    }
    update();
    return {};
  });
})();
