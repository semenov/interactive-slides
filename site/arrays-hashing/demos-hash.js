// Demos for slides 6–13: hash functions, linear probing, load factor, hash flooding, Python dict, mutable keys.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const { logger, fmt, segmented } = window.ArrDemo;
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const hex = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');
  const utf8 = new TextEncoder();

  const HASHES = {
    len: { name: 'длина строки', f: s => s.length },
    sum: { name: 'сумма кодов', f: s => [...utf8.encode(s)].reduce((a, b) => a + b, 0) },
    java: { name: 'Java: 31·h + c', f: s => { let x = 0; for (const c of s) x = (Math.imul(x, 31) + c.charCodeAt(0)) | 0; return x >>> 0; } },
    fnv: { name: 'FNV-1a', f: (s, seed = 0) => { let x = (0x811c9dc5 ^ seed) >>> 0; for (const b of utf8.encode(s)) { x ^= b; x = Math.imul(x, 0x01000193) >>> 0; } return x; } },
  };
  window.ArrDemo.HASHES = HASHES;

  // ---------------------------------------------------------------- hash function
  Deck.demo('hashfn', root => {
    const KEYS = Array.from({ length: 1000 }, (_, i) => 'user:' + (i + 1));
    let fn = 'fnv', m = 16;
    const input = h('input', { class: 'num-in wide', value: 'user:42', 'aria-label': 'Ключ', maxlength: 24, spellcheck: 'false', autocomplete: 'off' });
    const table = h('div', { class: 'hf-table' });
    const mSeg = segmented([[8, 'm = 8'], [16, 'm = 16'], [64, 'm = 64']], v => { m = v; render(); });
    const hist = h('div', { class: 'hf-hist' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    input.addEventListener('input', render);
    root.append(h('label', { class: 'controls' }, h('span', { class: 'label' }, 'Ключ'), input), table, mSeg.el, hist, stats, logEl);

    function render() {
      mSeg.mark(m);
      const key = input.value;
      table.innerHTML = '';
      for (const [id, { name, f }] of Object.entries(HASHES)) {
        const v = f(key) >>> 0;
        table.append(h('button', { class: 'hf-row' + (id === fn ? ' sel' : ''), onclick: () => { fn = id; render(); } },
          h('span', null, name), h('code', null, id === 'len' || id === 'sum' ? String(v) : hex(v)), h('b', null, '→ ' + (v % m))));
      }
      const counts = Array(m).fill(0);
      for (const k of KEYS) counts[(HASHES[fn].f(k) >>> 0) % m]++;
      const max = Math.max(...counts), empty = counts.filter(c => !c).length, ideal = KEYS.length / m;
      const mine = (HASHES[fn].f(key) >>> 0) % m;
      hist.style.setProperty('--m', m);
      hist.innerHTML = counts.map((c, i) => `<span class="${i === mine ? 'me' : ''}" style="height:${(c / max) * 100}%" title="${i}: ${c}"></span>`).join('');
      stats.innerHTML = [
        ['в худшей корзине', max, max > ideal * 2],
        ['пустых корзин', empty, empty > 0],
        ['идеал', dec(ideal, ideal % 1 ? 1 : 0), false],
      ].map(([l, v, w]) => `<div class="stat${w ? ' warn' : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
      const ratio = max / ideal;
      let text, cls = '';
      if (fn === 'len') { text = `Длина у ключей почти одна — все легли в ${m - empty} ${plural(m - empty, ['корзину', 'корзины', 'корзин'])}. Таблица превратилась в несколько длинных списков.`; cls = 'bad'; }
      else if (fn === 'sum') { text = `Сумма кодов не различает перестановки («ab» и «ba» совпадают) и даёт узкий диапазон чисел. Худшая корзина в ${dec(ratio)} раза длиннее идеала.`; cls = 'warn'; }
      else if (ratio < 1.6) { text = `${HASHES[fn].name}: худшая корзина — ${max} при идеале ${dec(ideal, ideal % 1 ? 1 : 0)}. Ключ «${key}» попал в корзину ${mine}.`; cls = 'ok'; }
      else { text = `${HASHES[fn].name}: худшая корзина в ${dec(ratio)} раза длиннее идеала — распределение неровное.`; cls = 'warn'; }
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- linear probing with tombstones
  Deck.demo('probe', root => {
    const M = 10, TOMB = 'T';
    let slots, timer = 0, path = [], result = null, buggy = false;
    const input = h('input', { class: 'num-in', type: 'number', min: 0, max: 99, value: 12, 'aria-label': 'Ключ' });
    const row = h('div', { class: 'pb-row' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const bug = h('input', { type: 'checkbox' });
    bug.addEventListener('change', () => { buggy = bug.checked; say(buggy ? 'Теперь удаление просто очищает ячейку. Попробуйте найти ключ, стоявший за удалённым.' : 'Удаление снова ставит надгробие ✝.', buggy ? 'warn' : ''); });
    root.append(
      h('div', { class: 'controls' },
        h('span', { class: 'label' }, 'Ключ'), input,
        h('button', { class: 'btn primary', onclick: () => op('ins') }, 'Вставить'),
        h('button', { class: 'btn', onclick: () => op('find') }, 'Найти'),
        h('button', { class: 'btn', onclick: () => op('del') }, 'Удалить')),
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: example }, 'Пример: 12, 22, 32, 5, 15'),
        h('button', { class: 'btn small', onclick: reset }, 'Очистить')),
      h('label', { class: 'toggle' }, bug, 'Удаление без надгробия (ошибка)'),
      row, logEl);

    function reset() { stopAnim(); slots = Array(M).fill(null); path = []; result = null; say('Пустая таблица на 10 ячеек.'); render(); }
    function example() {
      reset();
      for (const k of [12, 22, 32, 5, 15]) insertNow(k);
      say('Ключи 12, 22, 32 хотели в ячейку 2, а 5 и 15 — в 5. Получился сплошной кластер 2–6: любой ключ, попавший в него, идёт до его конца.');
      render();
    }
    function insertNow(k) {
      let i = k % M, tomb = -1;
      for (let s = 0; s < M; s++, i = (i + 1) % M) {
        if (slots[i] == null) break;
        if (slots[i] === TOMB) { if (tomb < 0) tomb = i; continue; }
        if (slots[i] === k) return;
      }
      const at = tomb >= 0 ? tomb : (slots[i] == null ? i : -1);
      if (at >= 0) slots[at] = k;
    }
    function stopAnim() { clearInterval(timer); timer = 0; }

    function op(kind) {
      stopAnim();
      const k = Math.max(0, Math.min(99, Math.trunc(+input.value || 0)));
      input.value = k;
      const start = k % M;
      const p = [];
      let i = start, tomb = -1, found = -1, stop = -1;
      for (let s = 0; s < M; s++, i = (i + 1) % M) {
        p.push(i);
        if (slots[i] == null) { stop = i; break; }
        if (slots[i] === TOMB) { if (tomb < 0) tomb = i; continue; }
        if (slots[i] === k) { found = i; break; }
      }
      let msg, cls = '', target = -1, apply = () => {};
      const pr = `${p.length} ${plural(p.length, ['проба', 'пробы', 'проб'])}`;
      const route = p.join(' → ');
      if (kind === 'ins') {
        if (found >= 0) { msg = `${k} уже есть в ячейке ${found} (${pr}). Вставка = поиск + запись.`; target = found; }
        else {
          target = tomb >= 0 ? tomb : stop;
          if (target < 0) { msg = 'Свободных ячеек нет — таблица переполнена. Настоящая таблица выросла бы гораздо раньше.'; cls = 'bad'; }
          else {
            msg = `h(${k}) = ${start}. Путь ${route}: ${pr}. ${tomb >= 0 ? `Ключа нет, а первое надгробие — в ${tomb}: занимаем его.` : `Ключ кладём в первую пустую ячейку ${target}.`}`;
            apply = () => { slots[target] = k; };
            cls = p.length > 3 ? 'warn' : 'ok';
          }
        }
      } else if (kind === 'find') {
        if (found >= 0) { msg = `Нашли ${k} в ячейке ${found}: путь ${route}, ${pr}.`; cls = 'ok'; target = found; }
        else {
          const ghost = slots.indexOf(k);
          msg = stop >= 0 ? `Путь ${route}: дошли до пустой ячейки ${stop} — значит, ${k} нет.` : `Обошли всю таблицу — ${k} нет.`;
          if (ghost >= 0) { msg = `Путь ${route}: пустая ячейка ${stop} оборвала поиск — «${k} нет». Но он лежит в ячейке ${ghost}! Это и ломает удаление без надгробия.`; cls = 'bad'; }
        }
      } else {
        if (found < 0) { msg = `Удалять нечего: ${k} не найден (путь ${route}).`; }
        else {
          target = found;
          apply = () => { slots[found] = buggy ? null : TOMB; };
          msg = buggy ? `Ячейка ${found} просто очищена. Ключи, которые шли через неё дальше, теперь не найти.` : `В ячейку ${found} поставлено надгробие ✝: поиск пройдёт через неё, вставка сможет её занять.`;
          cls = buggy ? 'warn' : 'ok';
        }
      }
      // Animate the probe path, then apply the change.
      path = []; result = null;
      let s = 0;
      const step = () => {
        if (s < p.length) { path = p.slice(0, ++s); render(); return; }
        stopAnim();
        apply();
        result = { target, ok: cls !== 'bad' && target >= 0 };
        say(msg, cls);
        render();
      };
      step();
      timer = setInterval(step, 260);
    }

    function render() {
      row.innerHTML = '';
      for (let i = 0; i < M; i++) {
        const v = slots[i];
        const n = path.indexOf(i);
        const cls = ['pb-cell'];
        if (v === TOMB) cls.push('tomb'); else if (v != null) cls.push('on');
        if (n >= 0) cls.push('path');
        if (result && result.target === i) cls.push(result.ok ? 'hit' : 'miss');
        row.append(h('div', { class: cls.join(' ') },
          h('small', null, String(i)),
          h('b', null, v === TOMB ? '✝' : v == null ? '' : String(v)),
          h('em', null, n >= 0 ? String(n + 1) : '')));
      }
    }
    reset();
    return { stop: stopAnim };
  });

  // ---------------------------------------------------------------- load factor and resize
  Deck.demo('resize', root => {
    const MAXM = 256;
    let m, keys, slots, lf = 0.75, grow = true, lastProbes = 0, moved = 0, rehashes = 0, flash = false;
    const slider = h('input', { type: 'range', min: 50, max: 95, step: 5, value: 75, 'aria-label': 'Порог заполнения' });
    const out = h('output');
    slider.addEventListener('input', () => { lf = slider.value / 100; out.textContent = dec(lf, 2); render(); });
    const growBox = h('input', { type: 'checkbox', checked: true });
    growBox.addEventListener('change', () => { grow = growBox.checked; render(); });
    const grid = h('div', { class: 'rs-grid' });
    const chart = h('div', { class: 'rs-chart' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => add(1) }, '+1 ключ'),
        h('button', { class: 'btn', onclick: () => add(10) }, '+10'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Расти при α >'), slider, out),
      h('label', { class: 'toggle' }, growBox, 'Расти вообще'),
      grid, h('div', { class: 'rs-row' }, chart, stats), logEl);
    out.textContent = dec(lf, 2);

    const hash = k => Math.imul(k ^ (k >>> 15), 0x2c1b3c6d) >>> 0;
    function place(tab, mm, k) {
      let i = hash(k) & (mm - 1), p = 1;
      while (tab[i] != null) { i = (i + 1) & (mm - 1); p++; }
      tab[i] = k;
      return p;
    }
    function reset() {
      m = 8; keys = []; slots = Array(m).fill(null); lastProbes = 0; moved = 0; rehashes = 0;
      say('Пустая таблица на 8 ячеек, линейное пробирование, позиция = hash & (m − 1).');
      render();
    }
    function add(k) {
      let grew = null, added = 0, probes = 0;
      for (let t = 0; t < k; t++) {
        if (grow && (keys.length + 1) / m > lf) {
          if (m >= MAXM) { say(`Дальше ${MAXM} ячеек схема не растёт.`, 'warn'); break; }
          const old = m;
          m *= 2;
          slots = Array(m).fill(null);
          for (const key of keys) place(slots, m, key);
          moved += keys.length; rehashes++;
          grew = { old, n: keys.length };
          flash = true;
        }
        if (keys.length >= m - 1) { say('Осталась одна пустая ячейка: без неё поиск отсутствующего ключа не остановится. Таблица без роста дальше не принимает.', 'bad'); break; }
        const key = (Math.random() * 2 ** 31) | 0;
        keys.push(key);
        probes = place(slots, m, key);
        added++;
      }
      lastProbes = probes;
      if (grew) say(`Порог ${dec(lf, 2)} превышен: таблица ${grew.old} → ${m}, все ${grew.n} ${plural(grew.n, ['ключ вставлен', 'ключа вставлены', 'ключей вставлены'])} заново — позиции сменились. Эта вставка стоила O(n).`, 'warn');
      else if (added) {
        const a = keys.length / m;
        say(`Вставка заняла ${probes} ${plural(probes, ['пробу', 'пробы', 'проб'])}. α = ${dec(a, 2)}${a > 0.85 ? ' — кластеры слипаются, пробы растут резко.' : '.'}`, a > 0.85 ? 'bad' : probes > 3 ? 'warn' : '');
      }
      render();
    }
    function render() {
      const a = keys.length / m;
      grid.style.setProperty('--cols', m <= 16 ? m : m <= 64 ? 16 : 32);
      grid.style.setProperty('--h', m <= 16 ? '26px' : m <= 64 ? '18px' : '14px');
      // displacement of each key from its home slot
      grid.innerHTML = slots.map((k, i) => {
        if (k == null) return `<span class="${flash ? 'new' : ''}"></span>`;
        const d = (i - (hash(k) & (m - 1)) + m) & (m - 1);
        return `<span class="on d${Math.min(d, 4)}${flash ? ' new' : ''}"></span>`;
      }).join('');
      flash = false;
      // average probes for a successful search: mean displacement + 1
      let sum = 0, run = 0, longest = 0;
      slots.forEach((k, i) => { if (k != null) sum += ((i - (hash(k) & (m - 1)) + m) & (m - 1)) + 1; });
      for (let i = 0; i < 2 * m; i++) { if (slots[i % m] != null) { run++; longest = Math.max(longest, Math.min(run, m)); } else run = 0; }
      const succ = keys.length ? sum / keys.length : 0;
      stats.innerHTML = [
        ['n / m', `${keys.length} / ${m}`],
        ['α', dec(a, 2), a > 0.85],
        ['проб при поиске', dec(succ || 0, 1), succ > 3],
        ['длиннейший кластер', longest, longest > 8],
        ['рехешей / перенесено', `${rehashes} / ${moved}`],
      ].map(([l, v, w]) => `<div class="stat${w ? ' warn' : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
      drawChart(a);
    }
    function drawChart(a) {
      const W = 220, H = 120, Y = 20;
      const x = v => 28 + v * (W - 34), y = v => H - 18 - Math.min(v, Y) / Y * (H - 28);
      const f = v => 0.5 * (1 + 1 / (1 - v) ** 2);
      let d = '';
      for (let v = 0; v <= 0.97; v += 0.01) d += (d ? 'L' : 'M') + x(v).toFixed(1) + ',' + y(f(v)).toFixed(1);
      const ac = Math.min(a, 0.97);
      chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Пробы при промахе в зависимости от заполнения">
        <line class="ax" x1="28" y1="${H - 18}" x2="${W - 4}" y2="${H - 18}"/><line class="ax" x1="28" y1="6" x2="28" y2="${H - 18}"/>
        ${grow ? `<line class="th" x1="${x(lf)}" y1="6" x2="${x(lf)}" y2="${H - 18}"/>` : ''}
        <path class="cv" d="${d}"/>
        <circle class="pt" cx="${x(ac)}" cy="${y(f(ac))}" r="5"/>
        <text x="24" y="${y(Y) + 4}" text-anchor="end">20</text><text x="24" y="${y(1) + 4}" text-anchor="end">1</text>
        <text x="28" y="${H - 4}">0</text><text x="${x(0.5)}" y="${H - 4}" text-anchor="middle">0,5</text><text x="${x(1)}" y="${H - 4}" text-anchor="end">α→1</text>
        <text x="34" y="14">проб при промахе</text>
      </svg>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- hash flooding
  Deck.demo('flood', root => {
    const MODES = {
      chain: 'Цепочка (Java 7, PHP 5 в 2011)',
      tree: 'Дерево в корзине (Java 8+)',
      seed: 'Случайный seed (Python, Go)',
    };
    let mode = 'chain', k = 12, seed = (Math.random() * 2 ** 32) >>> 0;
    const seg = segmented(Object.entries(MODES), id => { mode = id; render(); }, 'fl-seg');
    const slider = h('input', { type: 'range', min: 4, max: 17, value: 12, 'aria-label': 'Число ключей' });
    const out = h('output');
    slider.addEventListener('input', () => { k = +slider.value; render(); });
    const keysEl = h('div', { class: 'fl-keys' });
    const hist = h('div', { class: 'fl-hist' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    root.append(seg.el, h('label', { class: 'slider inline' }, h('span', { class: 'label' }, 'Ключей'), slider, out), keysEl, hist, stats, logEl);

    const keyOf = (i, bits) => { let s = ''; for (let b = bits - 1; b >= 0; b--) s += (i >> b) & 1 ? 'BB' : 'Aa'; return s; };
    function timeStr(ns) {
      if (ns < 1e3) return Math.round(ns) + ' нс';
      if (ns < 1e6) return dec(ns / 1e3) + ' мкс';
      if (ns < 1e9) return dec(ns / 1e6) + ' мс';
      if (ns < 120e9) return dec(ns / 1e9) + ' с';
      return dec(ns / 60e9) + ' мин';
    }
    function render() {
      seg.mark(mode);
      const n = 2 ** k;
      out.textContent = fmt(n);
      const sample = [0, 1, 2, n - 1].map(i => keyOf(i, k));
      keysEl.innerHTML = sample.map((s, j) => {
        const hv = mode === 'seed' ? HASHES.fnv.f(s, seed) : HASHES.java.f(s);
        return `${j === 3 ? '<span class="more">…</span>' : ''}<div><code>"${s.length > 14 ? '…' + s.slice(-12) : s}"</code><b>${hex(hv)}</b></div>`;
      }).join('');
      const B = 16, counts = Array(B).fill(0);
      const lim = Math.min(n, 4096);
      for (let i = 0; i < lim; i++) {
        const s = keyOf(i, k);
        const hv = mode === 'seed' ? HASHES.fnv.f(s, seed) : HASHES.java.f(s);
        counts[(hv ^ (hv >>> 16)) & (B - 1)]++;
      }
      const max = Math.max(...counts);
      hist.innerHTML = counts.map(c => `<span style="height:${Math.max(c ? 4 : 0, (c / max) * 100)}%" class="${c === lim && lim > 1 ? 'all' : ''}"></span>`).join('');
      const cmp = mode === 'chain' ? n * (n - 1) / 2 : mode === 'tree' ? n * Math.max(1, Math.log2(n)) : n * 1.3;
      const ns = cmp * 5;
      const bytes = n * (2 * k + 2);
      stats.innerHTML = [
        ['сравнений', cmp >= 1e6 ? dec(cmp / 1e6, cmp >= 1e8 ? 0 : 1) + ' млн' : fmt(Math.round(cmp))],
        ['CPU (~5 нс на сравнение)', timeStr(ns), ns > 1e9],
        ['размер POST', bytes > 1e6 ? dec(bytes / 2 ** 20) + ' МБ' : Math.round(bytes / 1024) + ' КБ'],
      ].map(([l, v, w]) => `<div class="stat${w ? ' warn' : ''}"><b>${v}</b><span>${l}</span></div>`).join('');
      let text, cls;
      if (mode === 'chain') { text = `Все ${fmt(n)} ключей имеют один хеш и легли в одну корзину. Каждая вставка проходит всю цепочку: O(n²). ${ns > 1e9 ? 'Один запрос держит ядро ' + timeStr(ns) + '.' : ''}`; cls = ns > 1e9 ? 'bad' : 'warn'; }
      else if (mode === 'tree') { text = 'Хеши по-прежнему равны, но корзина из 8+ ключей стала красно-чёрным деревом: строки Comparable, поиск — O(log n). Атака больше не работает.'; cls = 'ok'; }
      else { text = 'Хеш смешан с секретным seed, выбранным при старте процесса. Заранее подобрать коллизии нельзя: ключи «Aa…» разошлись по корзинам равномерно.'; cls = 'ok'; }
      logEl.innerHTML = text;
      logEl.className = 'log ' + cls;
    }
    render();
    return {};
  });

  // ---------------------------------------------------------------- Python compact dict
  Deck.demo('pydict', root => {
    const POOL = ['id', 'name', 'email', 'age', 'city', 'role', 'ts', 'tags', 'lang', 'plan', 'org', 'zip'];
    const EMPTY = -1, DUMMY = -2;
    let size, indices, entries, used, usable, pool, path, mark, counter;
    const input = h('input', { class: 'num-in', value: 'id', maxlength: 10, 'aria-label': 'Ключ', spellcheck: 'false', autocomplete: 'off' });
    const idxEl = h('div', { class: 'pd-idx' });
    const entEl = h('div', { class: 'pd-ent' });
    const iterEl = h('div', { class: 'pd-iter' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl, 1);
    root.append(
      h('div', { class: 'controls' },
        h('span', { class: 'label' }, 'Ключ'), input,
        h('button', { class: 'btn primary', onclick: () => set(input.value.trim()) }, h('code', null, 'd[k] = …')),
        h('button', { class: 'btn', onclick: () => del(input.value.trim()) }, h('code', null, 'del d[k]'))),
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: nextKey }, 'Следующий ключ'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      h('div', { class: 'label' }, 'indices — разреженный, по 1 байту'), idxEl,
      h('div', { class: 'label' }, 'entries — плотный, в порядке вставки'), entEl, iterEl, logEl);

    const hashOf = s => HASHES.fnv.f(s, 0x5bd1e995);
    function reset() {
      size = 8; indices = Array(size).fill(EMPTY); entries = []; used = 0; usable = (size * 2 / 3) | 0;
      pool = 0; path = []; mark = -1; counter = 0;
      input.value = POOL[0];
      say('Пустой dict: 8 индексов, места под записи — 5 (2/3 от 8).');
      render();
    }
    // CPython probing: perturb >>= 5; i = (5*i + perturb + 1) & mask
    function probe(key, hv, forInsert) {
      const mask = size - 1;
      let perturb = hv >>> 0, i = hv & mask;
      const p = [i];
      let firstFree = -1;
      for (;;) {
        const ix = indices[i];
        if (ix === EMPTY) return { found: -1, slot: firstFree >= 0 ? firstFree : i, path: p };
        if (ix === DUMMY) { if (forInsert && firstFree < 0) firstFree = i; }
        else if (entries[ix].hash === hv && entries[ix].key === key) return { found: ix, slot: i, path: p };
        perturb = perturb >>> 5;
        i = (i * 5 + perturb + 1) & mask;
        p.push(i);
      }
    }
    function resize() {
      const old = size;
      let ns = 8;
      while (ns < used * 3) ns *= 2;
      const live = entries.filter(e => !e.dead);
      size = ns; indices = Array(size).fill(EMPTY); entries = [];
      for (const e of live) { const r = probe(e.key, e.hash, true); indices[r.slot] = entries.length; entries.push(e); }
      usable = ((size * 2 / 3) | 0) - entries.length;
      return old;
    }
    function set(key) {
      if (!key) return;
      const hv = hashOf(key);
      let r = probe(key, hv, true);
      if (r.found >= 0) {
        entries[r.found].value = ++counter;
        path = r.path; mark = r.found;
        say(`«${key}» уже есть: запись #${r.found} получила новое значение, порядок не изменился. Проб: ${r.path.length}.`, 'ok');
        render();
        return;
      }
      let grew = '';
      if (usable <= 0) {
        const old = resize();
        grew = `Места под записи нет → перестройка: ${old} → ${size} индексов, удалённые записи выброшены. `;
        r = probe(key, hv, true);
      }
      indices[r.slot] = entries.length;
      entries.push({ key, hash: hv, value: ++counter, dead: false });
      used++; usable--;
      path = r.path; mark = entries.length - 1;
      const mask = size - 1;
      const route = r.path.length > 1 ? `ячейки ${r.path.join(' → ')} (первая занята — следующая по формуле с perturb)` : `ячейка ${r.path[0]} свободна`;
      say(`${grew}hash = ${hex(hv)}, i = hash &amp; ${mask} = ${hv & mask}: ${route}. Запись #${mark} — в конец entries, indices[${r.slot}] = ${mark}.`, grew ? 'warn' : '');
      render();
    }
    function del(key) {
      if (!key) return;
      const hv = hashOf(key);
      const r = probe(key, hv, false);
      path = r.path; mark = -1;
      if (r.found < 0) { say(`KeyError: «${key}» нет. Поиск остановился на пустом индексе ${r.path[r.path.length - 1]}.`, 'warn'); render(); return; }
      indices[r.slot] = DUMMY;
      entries[r.found].dead = true;
      used--;
      say(`del: indices[${r.slot}] = DUMMY (надгробие), запись #${r.found} опустела. Место под записи не вернулось — его вернёт только перестройка.`);
      render();
    }
    function nextKey() {
      const live = new Set(entries.filter(e => !e.dead).map(e => e.key));
      let k = POOL.find(p => !live.has(p));
      if (!k) k = 'k' + (++pool);
      input.value = k;
      set(k);
    }
    function render() {
      idxEl.style.setProperty('--n', size);
      idxEl.innerHTML = indices.map((ix, i) => {
        const n = path.indexOf(i);
        const cls = (ix >= 0 ? 'on' : ix === DUMMY ? 'tomb' : '') + (n >= 0 ? ' path' : '');
        return `<span class="${cls}"><small>${i}</small><b>${ix >= 0 ? ix : ix === DUMMY ? '✝' : '–'}</b></span>`;
      }).join('');
      entEl.innerHTML = entries.length ? entries.map((e, i) => e.dead
        ? `<div class="dead"><small>#${i}</small><span>— удалено —</span></div>`
        : `<div class="${i === mark ? 'mark' : ''}"><small>#${i}</small><code>${hex(e.hash).slice(0, 6)}…</code><b>'${e.key}'</b><span>${e.value}</span></div>`).join('')
        : '<p class="empty">пусто</p>';
      const live = entries.filter(e => !e.dead);
      const cap = ((size * 2 / 3) | 0);
      iterEl.innerHTML = `<span><b>list(d)</b> = [${live.map(e => `'${e.key}'`).join(', ')}]</span>` +
        `<span>Память: ${size} Б индексов + ${cap} записей × 24 Б = <b>${size + cap * 24} Б</b>; без разделения, как до 3.6: ${size} × 24 = ${size * 24} Б</span>`;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- mutable keys
  Deck.demo('mutkey', root => {
    const B = 8;
    const hp = (x, y) => (31 * x + y);
    let buckets, p, frozen = false, look = null;
    const code = h('pre', { class: 'code mk-code' });
    const pEl = h('div', { class: 'mk-p' });
    const bEl = h('div', { class: 'mk-b' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const mutBtn = h('button', { class: 'btn', onclick: () => mutate() }, h('code', null, 'p.x = 5'));
    const fz = h('input', { type: 'checkbox' });
    fz.addEventListener('change', () => { frozen = fz.checked; reset(); });
    root.append(
      h('label', { class: 'toggle' }, fz, h('span', null, h('code', null, '@dataclass(frozen=True)'))),
      code,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: add }, h('code', null, 's.add(p)')),
        mutBtn,
        h('button', { class: 'btn', onclick: () => find('p') }, h('code', null, 'p in s')),
        h('button', { class: 'btn', onclick: () => find('new') }, h('code', null, 'Point(1, 2) in s')),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      pEl, bEl, logEl);

    function reset() {
      p = { x: 1, y: 2, id: 'p' };
      mutBtn.firstChild.textContent = 'p.x = 5';
      buckets = Array.from({ length: B }, () => []);
      for (const o of [{ x: 3, y: 4, id: 'a' }, { x: 0, y: 7, id: 'b' }]) buckets[hp(o.x, o.y) % B].push({ o, hash: hp(o.x, o.y) });
      look = null;
      code.innerHTML = Deck.highlight(frozen
        ? '@dataclass(frozen=True)\nclass Point:\n    x: int\n    y: int      # __hash__ из (x, y)'
        : 'class Point:   # изменяемый\n    def __hash__(self): return hash((self.x, self.y))\n    def __eq__(self, o): return vars(self) == vars(o)', 'py');
      say('В множестве уже есть Point(3, 4) и Point(0, 7). Корзина = hash % 8 (хеши условные: 31·x + y).');
      render();
    }
    function add() {
      const hv = hp(p.x, p.y), b = hv % B;
      look = { b, res: null };
      const dup = buckets[b].find(e => e.hash === hv && e.o.x === p.x && e.o.y === p.y);
      if (dup) { say(`hash(p) = ${hv} → корзина ${b}, там равный объект — добавлять не нужно.`, 'ok'); look.res = dup; render(); return; }
      const twice = buckets.some(ch => ch.some(e => e.o === p));
      buckets[b].push({ o: p, hash: hv });
      look.res = buckets[b][buckets[b].length - 1];
      say(twice
        ? `hash(p) = ${hv} → корзина ${b}. Там p не нашли — и добавили ещё раз. Теперь один и тот же объект лежит в множестве дважды: len(s) = ${count()}.`
        : `hash(p) = ${hv} → корзина ${b}. Рядом с элементом сохранён и его хеш — ${hv}.`, twice ? 'bad' : 'ok');
      render();
    }
    function mutate() {
      if (frozen) { say('<code>FrozenInstanceError: cannot assign to field \'x\'</code> — объект неизменяем, ошибка видна сразу, а не через неделю в проде.', 'ok'); return; }
      p.x = p.x === 5 ? 1 : 5;
      mutBtn.firstChild.textContent = `p.x = ${p.x === 5 ? 1 : 5}`;
      const inSet = buckets.some(ch => ch.some(e => e.o === p));
      say(`p.x = ${p.x}. Теперь hash(p) = ${hp(p.x, p.y)}${inSet ? ', но в таблице p лежит там, куда его положили по старому хешу. Таблица об изменении не знает.' : '.'}`, inSet ? 'warn' : '');
      render();
    }
    function find(which) {
      const q = which === 'p' ? p : { x: 1, y: 2, id: 'q' };
      const hv = hp(q.x, q.y), b = hv % B;
      const chain = buckets[b];
      const hit = chain.find(e => e.hash === hv && e.o.x === q.x && e.o.y === q.y);
      look = { b, res: hit || null };
      const name = which === 'p' ? 'p' : 'Point(1, 2)';
      if (hit) say(`${name}: hash = ${hv} → корзина ${b}, хеш и == совпали → True.`, 'ok');
      else {
        const stale = chain.find(e => e.o === p && e.hash === hv);
        let why;
        if (stale) why = `там лежит p с сохранённым хешем ${hv}, хеши совпали, но p == Point(1, 2) ложно: p уже (${p.x}, ${p.y}).`;
        else if (chain.length) why = `там ${chain.map(e => `Point(${e.o.x}, ${e.o.y})`).join(', ')} — не то.`;
        else why = 'корзина пуста.';
        const lost = buckets.some(ch => ch.some(e => e.o === p));
        say(`${name}: hash = ${hv} → корзина ${b}: ${why} → False.${lost && which === 'p' ? ' Объект в множестве, но найти его нельзя.' : ''}`, lost ? 'bad' : '');
      }
      render();
    }
    const count = () => buckets.reduce((s, ch) => s + ch.length, 0);
    function render() {
      pEl.innerHTML = `<b>p</b> = Point(x=${p.x}, y=${p.y}) <span>hash(p) = ${hp(p.x, p.y)} → корзина ${hp(p.x, p.y) % B}</span>`;
      bEl.innerHTML = buckets.map((ch, i) => `<div class="${look && look.b === i ? 'look' : ''}"><small>${i}</small>${ch.map(e =>
        `<i class="${e.o === p ? 'p' : ''}${look && look.res === e ? ' hit' : ''}">${e.o === p ? 'p' : ''}(${e.o.x},${e.o.y})<em>${e.hash}</em></i>`).join('')}</div>`).join('');
    }
    reset();
    return {};
  });
})();
