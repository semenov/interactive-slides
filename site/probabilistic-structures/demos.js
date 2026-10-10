// Demos for slides 2–10: memory per element, Bloom filter, its maths, HyperLogLog, Count-Min Sketch, reservoir sampling.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');

  // ---------------------------------------------------------------- shared helpers (also used by demos-sys.js)
  // murmur3 finaliser: a bijection on 32 bits with full avalanche.
  function fmix(x) {
    x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return x >>> 0;
  }
  // FNV-1a over UTF-16 units + finaliser; seed selects an independent hash function.
  function hashStr(s, seed = 0) {
    let x = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
    return fmix(x);
  }
  const hashInt = (n, seed = 0) => fmix(Math.imul((n ^ Math.imul(seed + 7, 0x632be5ab)) >>> 0, 0x9e3779b1) ^ seed);
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function logger(el, keep = 2) {
    const lines = [];
    return (text, cls = '') => {
      lines.unshift(text);
      lines.length = Math.min(lines.length, keep);
      el.innerHTML = lines.map((l, i) => `<div class="${i ? 'old' : ''}">${l}</div>`).join('');
      el.className = 'log ' + cls;
    };
  }
  function bytes(b) {
    const U = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];
    let i = 0;
    while (b >= 1024 && i < U.length - 1) { b /= 1024; i++; }
    return (b >= 100 || i === 0 ? fmt(b) : dec(b, b >= 10 ? 0 : 1)) + ' ' + U[i];
  }
  function count(n) {
    if (n >= 1e9) return dec(n / 1e9, n % 1e9 ? 1 : 0).replace(',0', '') + ' млрд';
    if (n >= 1e6) return dec(n / 1e6, n % 1e6 ? 1 : 0).replace(',0', '') + ' млн';
    if (n >= 1e3) return dec(n / 1e3, n % 1e3 ? 1 : 0).replace(',0', '') + ' тыс.';
    return String(n);
  }
  window.PS = { fmix, hashStr, hashInt, rng, logger, bytes, count, fmt, dec };

  // ---------------------------------------------------------------- memory per element
  Deck.demo('memcalc', root => {
    const NS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10];
    const ROWS = [
      ['Python <code>set[int]</code>', 'exact', n => n * 64, '≈64 Б: ячейка таблицы 16 Б с запасом + объект int 28–32 Б'],
      ['Java <code>HashSet&lt;Long&gt;</code>', 'exact', n => n * 56, '≈56 Б: узел HashMap 32 Б + Long 16 Б + слот'],
      ['Go <code>map[uint64]</code>', 'exact', n => n * 14, '≈14 Б: ключ 8 Б, байт метаданных, запас таблицы'],
      ['Массив <code>[]uint64</code>', 'exact', n => n * 8, '8 Б: только сами числа, поиск — бинарный'],
      ['Фильтр Блума, 1%', 'approx', n => n * 9.6 / 8, '9,6 бита: только «есть ли», размер не зависит от ключа'],
      ['HyperLogLog (Redis)', 'approx', n => Math.min(12304, 40 + n * 1.6), '12 КБ на любое n: только «сколько разных», ±0,81%'],
    ];
    const out = h('output');
    const input = h('input', { type: 'range', min: 0, max: NS.length - 1, value: 6, 'aria-label': 'Число элементов' });
    root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Элементов'), input, out));
    const rows = ROWS.map(([name, cls, , hint]) => {
      const fill = h('span', { class: 'mem-fill ' + cls });
      const val = h('b');
      root.append(h('div', { class: 'mem-row', title: hint },
        h('span', { class: 'mem-name', html: name }), h('span', { class: 'mem-track' }, fill), val));
      return { fill, val };
    });
    const scale = h('div', { class: 'mem-scale' }, h('span', null, '1 КБ'), h('span', null, '1 МБ'), h('span', null, '1 ГБ'), h('span', null, '1 ТБ'));
    const verdict = h('p', { class: 'log' });
    root.append(scale, h('p', { class: 'note' }, 'Серые — точные структуры, оранжевые — приблизительные. Шкала логарифмическая.'), verdict);

    function update() {
      const n = NS[+input.value];
      out.textContent = count(n);
      const lo = Math.log2(1024), hi = Math.log2(1024 ** 4);
      ROWS.forEach(([, , f], i) => {
        const b = f(n);
        const pos = Math.max(0, Math.min(1, (Math.log2(Math.max(b, 1)) - lo) / (hi - lo)));
        rows[i].fill.style.width = Math.max(1.5, pos * 100) + '%';
        rows[i].fill.classList.toggle('over', b > 64 * 1024 ** 3);
        rows[i].val.textContent = bytes(b);
      });
      const py = ROWS[0][2](n);
      if (py > 64 * 1024 ** 3) {
        verdict.innerHTML = `Точное множество в Python займёт ${bytes(py)} — не влезет в сервер на 64 ГБ. Фильтру Блума хватит ${bytes(ROWS[4][2](n))}, а HyperLogLog — 12 КБ.`;
        verdict.className = 'log bad';
      } else if (py > 1024 ** 3) {
        verdict.innerHTML = `Влезает, но уже ${bytes(py)} в куче одного процесса: долгие паузы GC и долгий рестарт. Приблизительные структуры — в сотни раз меньше.`;
        verdict.className = 'log warn';
      } else {
        verdict.innerHTML = `${bytes(py)} — точное множество дешевле любых хитростей. Вероятностные структуры нужны на больших n.`;
        verdict.className = 'log ok';
      }
    }
    input.addEventListener('input', update);
    update();
    return {};
  });

  // ---------------------------------------------------------------- Bloom filter
  Deck.demo('bloom', root => {
    const M = 32, K = 3;
    const ADD = ['кот', 'пёс', 'ёж', 'лис', 'сова', 'волк', 'бобр', 'орёл', 'тюлень', 'жаба'];
    const ASK = ['кит', 'як', 'рысь', 'заяц', 'тигр', 'лось', 'мышь', 'гусь', 'краб', 'панда', 'енот', 'утка', 'лев', 'слон', 'кит'];
    let bits, set, ai, qi;
    const field = h('input', { class: 'word-in', type: 'text', value: '', placeholder: 'слово', maxlength: 16, 'aria-label': 'Слово' });
    field.addEventListener('keydown', e => { if (e.key === 'Enter') add(field.value); });
    const grid = h('div', { class: 'bl-bits' });
    const cells = Array.from({ length: M }, (_, i) => {
      const c = h('span', { class: 'bit' }, h('small', null, i), h('b', null, '0'));
      grid.append(c);
      return c;
    });
    const members = h('div', { class: 'bl-members' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        field,
        h('button', { class: 'btn primary small', onclick: () => add(field.value) }, 'Добавить'),
        h('button', { class: 'btn small', onclick: () => query(field.value) }, 'Проверить'),
      ),
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => add(ADD[ai % ADD.length]) }, '+ следующее слово'),
        h('button', { class: 'btn small', onclick: () => query(ASK[qi++ % ASK.length]) }, 'Проверить чужое'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      grid, members, stats, logEl,
    );

    function positions(w) {
      // k independent hash functions (seeds); a repeated position is shifted so the picture always shows k bits
      const pos = [];
      for (let i = 0; i < K; i++) {
        let p = hashStr(w, 10 + i) % M;
        while (pos.includes(p)) p = (p + 1) % M;
        pos.push(p);
      }
      return pos;
    }
    function paint(pos, mode) {
      cells.forEach((c, i) => {
        c.className = 'bit' + (bits[i] ? ' on' : '');
        c.querySelector('b').textContent = bits[i];
      });
      pos.forEach(i => cells[i].classList.add(mode === 'add' ? 'hit' : bits[i] ? 'yes' : 'no'));
      const ones = bits.reduce((s, b) => s + b, 0);
      const fill = ones / M;
      stats.innerHTML =
        `<div class="stat"><b>${set.size}</b><span>добавлено</span></div>` +
        `<div class="stat"><b>${ones}/${M}</b><span>бит в единице</span></div>` +
        `<div class="stat${fill ** K > 0.1 ? ' warn' : ''}"><b>${dec(100 * fill ** K, 0)}%</b><span>шанс ложного «да»</span></div>`;
      members.innerHTML = set.size ? 'В фильтре: ' + [...set].map(w => `<code>${w}</code>`).join(' ') : '<span class="empty">Фильтр пуст</span>';
    }
    function clean(w) { return String(w).trim().toLowerCase().slice(0, 16); }
    function add(w) {
      w = clean(w);
      if (!w) { say('Введите слово.'); return; }
      if (!set.has(w) && w === ADD[ai % ADD.length]) ai++;
      const pos = positions(w);
      const fresh = pos.filter(i => !bits[i]).length;
      pos.forEach(i => { bits[i] = 1; });
      set.add(w);
      field.value = '';
      paint(pos, 'add');
      say(`«${w}» → биты ${pos.join(', ')}. Новых единиц: ${fresh}${fresh < K ? ' — часть бит уже выставили другие слова' : ''}.`);
    }
    function query(w) {
      w = clean(w);
      if (!w) { say('Введите слово.'); return; }
      const pos = positions(w);
      const zero = pos.find(i => !bits[i]);
      paint(pos, 'query');
      if (zero !== undefined) {
        say(`«${w}» → биты ${pos.join(', ')}. Бит ${zero} = 0 — <b>точно нет</b>, даже в базу ходить не нужно.`, 'ok');
      } else if (set.has(w)) {
        say(`«${w}» → биты ${pos.join(', ')}: все единицы — <b>вероятно есть</b>. И правда есть.`, 'ok');
      } else {
        say(`«${w}» → биты ${pos.join(', ')}: все единицы, но «${w}» никто не добавлял. <b>Ложное срабатывание</b>: эти биты выставили другие слова.`, 'bad');
      }
    }
    function reset() {
      bits = new Array(M).fill(0);
      set = new Set();
      ai = 0; qi = 0;
      paint([], 'add');
      say(`Пустой фильтр: ${M} бита, ${K} хеша. Все биты — нули.`);
    }
    reset();
    ['кот', 'пёс', 'ёж', 'лис'].forEach(add);
    say(`Добавлены четыре слова — по ${K} бита на каждое. Проверьте слова, которых в фильтре нет.`);
    return {};
  });

  // ---------------------------------------------------------------- Bloom maths + experiment
  Deck.demo('bloomcalc', root => {
    const mk = (label, min, max, val) => {
      const out = h('output');
      const input = h('input', { type: 'range', min, max, value: val, 'aria-label': label });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label bc-l' }, label), input, out));
      input.addEventListener('input', update);
      return { input, out, get: () => +input.value };
    };
    const bpe = mk('бит на элемент (m/n)', 1, 20, 10);
    const k = mk('хешей (k)', 1, 12, 3);
    const best = h('button', { class: 'btn small', onclick: () => { k.input.value = Math.max(1, Math.round(bpe.get() * Math.LN2)); update(); } }, 'Лучшее k');
    root.append(h('div', { class: 'controls' }, best));
    const W = 300, H = 120;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'bc-plot');
    root.append(svg);
    const stats = h('div', { class: 'stats' });
    const logEl = h('p', { class: 'log' });
    root.append(stats, logEl);

    const P = (b, kk) => (1 - Math.exp(-kk / b)) ** kk;
    function experiment(b, kk) {
      const n = 2000, m = b * n, bits = new Uint8Array(m);
      const pos = (x, i) => ((hashInt(x, 11) + Math.imul(i, hashInt(x, 23) | 1)) >>> 0) % m;
      for (let x = 0; x < n; x++) for (let i = 0; i < kk; i++) bits[pos(x, i)] = 1;
      let fp = 0;
      const T = 20000;
      for (let x = n; x < n + T; x++) {
        let all = true;
        for (let i = 0; i < kk && all; i++) all = bits[pos(x, i)] === 1;
        if (all) fp++;
      }
      return fp / T;
    }
    const pct = p => p >= 0.1 ? dec(p * 100, 0) + '%' : p >= 0.001 ? dec(p * 100, p >= 0.01 ? 1 : 2) + '%' : dec(p * 100, 3) + '%';

    function update() {
      const b = bpe.get(), kk = k.get();
      bpe.out.textContent = b;
      k.out.textContent = kk;
      // plot p(k) for this m/n on a log scale 1 … 1e-5
      const y = p => 8 + (Math.min(5, -Math.log10(Math.max(p, 1e-5))) / 5) * (H - 24);
      const x = kk2 => 24 + ((kk2 - 1) / 11) * (W - 34);
      let s = '';
      for (let d = 0; d <= 5; d++) s += `<line x1="24" x2="${W - 8}" y1="${y(10 ** -d)}" y2="${y(10 ** -d)}" class="grid"/><text x="0" y="${y(10 ** -d) + 3}">${['100%', '10%', '1%', '0,1%', '.01%', ''][d]}</text>`;
      for (let kk2 = 1; kk2 <= 12; kk2 += 1) s += `<text x="${x(kk2) - 3}" y="${H - 2}">${kk2 % 2 ? kk2 : ''}</text>`;
      const pts = [];
      for (let kk2 = 1; kk2 <= 12; kk2 += 0.25) pts.push(`${x(kk2)},${y(P(b, kk2))}`);
      s += `<polyline points="${pts.join(' ')}" class="curve"/>`;
      const kb = b * Math.LN2;
      if (kb <= 12) s += `<line x1="${x(Math.max(1, kb))}" x2="${x(Math.max(1, kb))}" y1="8" y2="${H - 16}" class="opt"/>`;
      s += `<circle cx="${x(kk)}" cy="${y(P(b, kk))}" r="5" class="dot"/>`;
      svg.innerHTML = s;

      const p = P(b, kk), e = experiment(b, kk);
      stats.innerHTML =
        `<div class="stat"><b>${pct(p)}</b><span>по формуле</span></div>` +
        `<div class="stat"><b>${pct(e)}</b><span>опыт: 2 000 вставок, 20 000 проверок</span></div>` +
        `<div class="stat"><b>${bytes(1e9 * b / 8)}</b><span>на 1 млрд элементов</span></div>`;
      const kOpt = Math.max(1, Math.round(kb));
      if (kk === kOpt) logEl.innerHTML = `При ${b} битах на элемент лучшее k = ${dec(kb)} → ${kOpt}. Ошибка ${pct(p)}; меньше можно только добавив бит.`;
      else if (kk < kOpt) logEl.innerHTML = `Хешей мало: проверка смотрит всего ${kk} ${plural(kk, ['бит', 'бита', 'бит'])}, совпасть случайно легко. Лучшее k = ${kOpt} даст ${pct(P(b, kOpt))}.`;
      else logEl.innerHTML = `Хешей много: каждая вставка выставляет ${kk} бит, и единиц уже ${dec(100 * (1 - Math.exp(-kk / b)), 0)}%. Лучшее k = ${kOpt} даст ${pct(P(b, kOpt))}.`;
      logEl.className = 'log' + (p > 0.05 ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- HyperLogLog
  Deck.demo('hll', root => {
    const PS_ = [4, 6, 8, 10];
    let p = 6, m, reg, n, seen = 0;
    const SEED = 5;
    const mBtns = PS_.map(pp => h('button', { class: 'btn small', onclick: () => setP(pp) }, `m = ${1 << pp}`));
    const bitsEl = h('div', { class: 'hl-bits' });
    const regs = h('div', { class: 'hl-regs' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Регистров:'), mBtns),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: () => addNew(1) }, '+1 посетитель'),
        h('button', { class: 'btn small', onclick: () => addNew(1000) }, '+1 000'),
        h('button', { class: 'btn small', onclick: () => addNew(100000) }, '+100 000'),
        h('button', { class: 'btn small', onclick: repeat }, 'Повторы ×10 000'),
        h('button', { class: 'btn small', onclick: () => setP(p) }, 'Сброс'),
      ),
      bitsEl, regs, stats, logEl,
    );

    function insert(id) {
      const x = hashInt(id, SEED);
      const j = x >>> (32 - p);
      const w = (x << p) >>> 0;
      const r = Math.min(Math.clz32(w) + 1, 32 - p + 1);
      if (r > reg[j]) reg[j] = r;
      return { x, j, r };
    }
    function estimate() {
      const alpha = m === 16 ? 0.673 : m === 32 ? 0.697 : m === 64 ? 0.709 : 0.7213 / (1 + 1.079 / m);
      let sum = 0, zeros = 0;
      for (const v of reg) { sum += 2 ** -v; if (!v) zeros++; }
      const raw = alpha * m * m / sum;
      if (raw <= 2.5 * m && zeros) return { e: m * Math.log(m / zeros), lc: true };
      return { e: raw, lc: false };
    }
    function render() {
      const max = Math.max(1, ...reg);
      const cols = m <= 16 ? 16 : m <= 64 ? 16 : m <= 256 ? 32 : 64;
      regs.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      regs.className = 'hl-regs' + (m > 64 ? ' dense' : '');
      if (regs.childElementCount !== m) {
        regs.textContent = '';
        for (let i = 0; i < m; i++) regs.append(h('span'));
      }
      [...regs.children].forEach((c, i) => {
        c.textContent = m <= 64 ? reg[i] : '';
        c.style.setProperty('--v', reg[i] / max);
      });
      const { e, lc } = estimate();
      const err = n ? (e - n) / n : 0;
      const sigma = 1.04 / Math.sqrt(m);
      stats.innerHTML =
        `<div class="stat"><b>${fmt(n)}</b><span>на самом деле</span></div>` +
        `<div class="stat${Math.abs(err) > 2 * sigma ? ' warn' : ''}"><b>${fmt(e)}</b><span>оценка, ${err >= 0 ? '+' : '−'}${dec(Math.abs(err) * 100)}%${lc ? ' (лин. подсчёт)' : ''}</span></div>` +
        `<div class="stat"><b>±${dec(sigma * 100)}%</b><span>типичная ошибка; ${bytes(Math.ceil(m * 6 / 8))}</span></div>`;
    }
    function showBits(x, j, r) {
      const s = x.toString(2).padStart(32, '0');
      const idx = s.slice(0, p), rest = s.slice(p);
      const z = r - 1;
      bitsEl.innerHTML = `<span class="i">${idx}</span><span class="z">${rest.slice(0, Math.min(z + 1, rest.length))}</span>${rest.slice(z + 1)}` +
        `<small>корзина ${j} · нулей ${z} → ранг ${r}</small>`;
    }
    function addNew(cnt) {
      let last;
      for (let i = 0; i < cnt; i++) last = insert(n++);
      if (cnt === 1) {
        showBits(last.x, last.j, last.r);
        say(`Посетитель #${n}: первые ${p} бит хеша выбирают корзину ${last.j}, дальше ${last.r - 1} ${plural(last.r - 1, ['ноль', 'нуля', 'нулей'])} → ранг ${last.r}. В регистре: ${reg[last.j]}.`);
      } else {
        bitsEl.innerHTML = '<span class="empty">хеш последнего посетителя показывается при добавлении по одному</span>';
        say(`+${fmt(cnt)} новых посетителей. Регистры почти не растут: чтобы ранг вырос на 1, нужно вдвое больше элементов.`);
      }
      render();
    }
    function repeat() {
      if (!n) { say('Сначала добавьте посетителей.'); return; }
      const before = estimate().e;
      const r = rng(++seen);
      for (let i = 0; i < 10000; i++) insert(Math.floor(r() * n));
      render();
      say(`10 000 повторных визитов тех же людей: оценка ${fmt(before)} → ${fmt(estimate().e)}. Тот же хеш — тот же ранг, максимум не меняется.`, 'ok');
    }
    function setP(pp) {
      p = pp; m = 1 << p;
      reg = new Uint8Array(m); n = 0;
      mBtns.forEach((b, i) => b.classList.toggle('sel', PS_[i] === p));
      bitsEl.innerHTML = '<span class="empty">хеш посетителя: 32 бита</span>';
      render();
      say(`${m} ${plural(m, ['регистр', 'регистра', 'регистров'])} по 6 бит. Типичная ошибка ±${dec(104 / Math.sqrt(m))}%. Redis берёт m = 16 384: ±0,81% за 12 КБ.`);
    }
    setP(6);
    return {};
  });

  // ---------------------------------------------------------------- Count-Min Sketch + top-K
  Deck.demo('cms', root => {
    const TAGS = ['#ai', '#python', '#go', '#rust', '#k8s', '#js', '#sql', '#linux', '#llm', '#devops', '#java', '#react', '#redis', '#kafka', '#docker',
      '#aws', '#ts', '#vim', '#bash', '#git', '#css', '#swift', '#zig', '#elixir', '#nix', '#haskell', '#ocaml', '#lua', '#perl', '#cobol'];
    const D = 4, K = 5, WS = [8, 16, 32, 64];
    const cum = [];
    TAGS.reduce((s, _, i) => { s += 1 / (i + 1) ** 1.1; cum.push(s); return s; }, 0);
    let w = 16, table, truth, top, total, sel = null, r = rng(1);
    const wBtns = WS.map(x => h('button', { class: 'btn small', onclick: () => { w = x; reset(); } }, `w = ${x}`));
    const matrix = h('div', { class: 'cm-matrix' });
    const topEl = h('div', { class: 'cm-top' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Ширина:'), wBtns),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary small', onclick: () => stream(300) }, 'Поток +300'),
        h('button', { class: 'btn small', onclick: () => stream(5000) }, '+5 000'),
        h('button', { class: 'btn small', onclick: rare }, 'Редкий тег'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
      ),
      matrix, topEl, logEl,
    );
    const col = (t, row) => hashStr(t, 100 + row) % w;
    const est = t => Math.min(...Array.from({ length: D }, (_, row) => table[row][col(t, row)]));
    function pick() {
      const x = r() * cum[cum.length - 1];
      return TAGS[cum.findIndex(c => c >= x)];
    }
    function event(t) {
      for (let row = 0; row < D; row++) table[row][col(t, row)]++;
      truth.set(t, (truth.get(t) || 0) + 1);
      total++;
      // top-K: a small map of candidates, the minimum is evicted
      const e = est(t);
      if (top.has(t) || top.size < K) { top.set(t, e); return; }
      let minT = null;
      for (const [k, v] of top) if (minT === null || v < top.get(minT)) minT = k;
      if (e > top.get(minT)) { top.delete(minT); top.set(t, e); }
    }
    function stream(nEv) {
      for (let i = 0; i < nEv; i++) event(pick());
      if (!sel) sel = [...top.keys()][0];
      render();
      say(`+${fmt(nEv)} событий, всего ${fmt(total)}. Память: ${D}×${w} = ${D * w} счётчиков, на сколько бы тегов ни пришло.`);
    }
    function rare() {
      if (!total) stream(300);
      // a tail tag, preferably one whose cells are shared with popular tags
      const tail = TAGS.slice(-10), over = tail.filter(x => est(x) > (truth.get(x) || 0));
      const pool = over.length ? over : tail;
      const t = pool[Math.floor(r() * pool.length)];
      sel = t;
      render();
      const e = est(t), tr = truth.get(t) || 0;
      say(`${t}: на самом деле ${tr}, Count-Min говорит ${e}. ${e > tr ? `Завышение на ${e - tr}: в каждой строке его ячейку делят с частыми тегами.` : 'Повезло: в одной из строк ячейка досталась ему почти одному.'}`, e > tr ? 'warn' : 'ok');
    }
    function render() {
      const cols = sel ? Array.from({ length: D }, (_, row) => col(sel, row)) : [];
      const e = sel ? est(sel) : 0;
      matrix.style.gridTemplateColumns = `repeat(${w}, minmax(0, 1fr))`;
      matrix.className = 'cm-matrix' + (w > 16 ? ' dense' : '');
      const max = Math.max(1, ...table.flat());
      matrix.innerHTML = table.map((rowA, row) => rowA.map((v, c) => {
        const hit = cols[row] === c;
        const cls = hit ? (v === e ? 'hit min' : 'hit') : '';
        return `<span class="${cls}" style="--v:${v / max}">${w <= 16 ? v : ''}</span>`;
      }).join('')).join('');
      const list = [...top.entries()].sort((a, b) => b[1] - a[1]);
      topEl.innerHTML = `<div class="cm-row head"><span>Топ-${K}</span><span>оценка</span><span>правда</span><span>ошибка</span></div>`;
      const rows = list.map(([t]) => t);
      if (sel && !rows.includes(sel)) rows.push(sel);
      for (const t of rows) {
        const ev = est(t), tr = truth.get(t) || 0;
        const b = h('button', { class: 'cm-row' + (t === sel ? ' sel' : '') + (top.has(t) ? '' : ' out'), onclick: () => { sel = t; render(); say(`${t}: минимум из ${D} счётчиков = ${ev}, на самом деле ${tr}.`); } },
          h('span', null, t), h('span', null, fmt(ev)), h('span', null, fmt(tr)), h('span', { class: ev > tr ? 'over' : '' }, ev > tr ? '+' + fmt(ev - tr) : '0'));
        topEl.append(b);
      }
      if (!total) topEl.append(h('p', { class: 'empty' }, 'Поток пуст'));
    }
    function reset() {
      table = Array.from({ length: D }, () => new Array(w).fill(0));
      truth = new Map(); top = new Map(); total = 0; sel = null; r = rng(1);
      wBtns.forEach((b, i) => b.classList.toggle('sel', WS[i] === w));
      render();
      say(`Пусто: ${D} строки по ${w} счётчиков, у каждой строки свой хеш.`);
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- reservoir sampling
  Deck.demo('reservoir', root => {
    const N = 20, K = 4;
    let i, sample, r, runs = 0, hist = new Array(N).fill(0), seed = 1;
    const streamEl = h('div', { class: 'rs-stream' });
    const resEl = h('div', { class: 'rs-res' });
    const histEl = h('div', { class: 'rs-hist' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = h('button', { class: 'btn primary small', onclick: step }, 'Следующий элемент');
    root.append(
      h('div', { class: 'controls' },
        stepBtn,
        h('button', { class: 'btn small', onclick: () => { while (i < N) step(true); render(); say(`Поток кончился. В выборке: ${sample.join(', ')}. Каждый из ${N} элементов мог попасть сюда с шансом ${K}/${N}.`, 'ok'); } }, 'До конца'),
        h('button', { class: 'btn small', onclick: newStream }, 'Новый поток'),
        h('button', { class: 'btn small', onclick: many }, '10 000 потоков'),
      ),
      h('span', { class: 'label' }, 'Поток'), streamEl,
      h('span', { class: 'label' }, `Выборка, k = ${K}`), resEl,
      histEl, logEl,
    );
    function step(quiet) {
      if (i >= N) return;
      const x = ++i;
      let msg;
      if (x <= K) { sample.push(x); msg = `Элемент ${x}: первые ${K} берём все.`; }
      else {
        const j = Math.floor(r() * x);
        if (j < K) { msg = `Элемент ${x}: шанс ${K}/${x}, выпало j = ${j} &lt; ${K} → вытесняет ${sample[j]}.`; sample[j] = x; }
        else msg = `Элемент ${x}: шанс ${K}/${x}, выпало j = ${j} ≥ ${K} → пропускаем.`;
      }
      if (!quiet) { render(); say(msg); }
    }
    function render() {
      streamEl.innerHTML = Array.from({ length: N }, (_, k) => {
        const x = k + 1;
        const cls = sample.includes(x) ? 'in' : x <= i ? 'seen' : '';
        return `<span class="${cls}${x === i ? ' cur' : ''}">${x}</span>`;
      }).join('');
      resEl.innerHTML = Array.from({ length: K }, (_, k) => `<span class="val${sample[k] ? '' : ' empty-slot'}">${sample[k] || '·'}</span>`).join('');
      stepBtn.disabled = i >= N;
      if (runs) {
        const max = Math.max(...hist, runs * K / N * 1.6);
        histEl.innerHTML = `<div class="rs-bars">${hist.map((c, k) => `<span style="height:${(c / max) * 100}%" title="${k + 1}: ${dec(100 * c / runs)}%"></span>`).join('')}` +
          `<i style="bottom:${(runs * K / N / max) * 100}%"></i></div><div class="rs-axis"><span>1</span><span>${N}</span></div>`;
      } else histEl.innerHTML = '';
    }
    function newStream() {
      i = 0; sample = []; r = rng(++seed * 7919);
      render();
      say(`Новый поток из ${N} элементов. Мы не знаем заранее, сколько их будет.`);
    }
    function many() {
      const rr = rng(seed * 31 + runs);
      for (let t = 0; t < 10000; t++) {
        const s = [];
        for (let x = 1; x <= N; x++) {
          if (x <= K) s.push(x);
          else { const j = Math.floor(rr() * x); if (j < K) s[j] = x; }
        }
        s.forEach(x => hist[x - 1]++);
      }
      runs += 10000;
      render();
      const lo = Math.min(...hist) / runs, hi = Math.max(...hist) / runs;
      say(`${fmt(runs)} потоков: каждый элемент попал в выборку в ${dec(lo * 100)}–${dec(hi * 100)}% случаев. Ожидание ${K}/${N} = ${dec(100 * K / N, 0)}% — у первого и у последнего одинаково.`, 'ok');
    }
    newStream();
    return {};
  });
})();
