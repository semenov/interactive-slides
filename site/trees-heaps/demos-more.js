// Demos: B-tree fan-out, B+tree splits, binary heap, heap patterns, trie, longest prefix match.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const { logger, treeView, layoutTree, rnd, player } = TH;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const dec = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const bytes = b => b >= 2 ** 40 ? dec(b / 2 ** 40) + ' ТБ' : b >= 2 ** 30 ? dec(b / 2 ** 30) + ' ГБ' : b >= 2 ** 20 ? dec(b / 2 ** 20) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ';
  const big = n => n >= 1e9 ? dec(n / 1e9, n >= 1e10 ? 0 : 1) + ' млрд' : n >= 1e6 ? dec(n / 1e6, n >= 1e7 ? 0 : 1) + ' млн' : n >= 1e3 ? dec(n / 1e3, n >= 1e4 ? 0 : 1) + ' тыс.' : String(n);

  // ---------------------------------------------------------------- B-tree fan-out calculator
  Deck.demo('fanout', root => {
    const ROWS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
    const KEYS = [[4, 'int4'], [8, 'int8'], [16, 'uuid'], [32, 'строка 32 Б'], [100, 'строка 100 Б']];
    const PAGES = [[4096, '4 КБ'], [8192, '8 КБ · PG'], [16384, '16 КБ · InnoDB']];
    const FILL = 0.7;
    const mk = (label, list, idx, show) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: list.length - 1, value: idx, 'aria-label': label });
      const set = () => { out.textContent = show(list[+input.value]); };
      set();
      input.addEventListener('input', () => { set(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label fo-l' }, label), input, out));
      return () => list[+input.value];
    };
    const rows = mk('Строк', ROWS, 6, big);
    const key = mk('Ключ', KEYS, 1, k => k[1]);
    const page = mk('Страница', PAGES, 1, p => p[1]);
    const stats = h('div', { class: 'stats' });
    const levels = h('div', { class: 'fo-levels' });
    const log = h('p', { class: 'log' });
    root.append(stats, levels, log);

    function update() {
      const N = rows(), [k] = key(), [P] = page();
      const per = Math.floor((P - 40) / (k + 12)); // tuple header + pointer + line pointer ≈ 12 bytes
      const fan = Math.max(2, Math.floor(per * FILL));
      const lv = [Math.ceil(N / fan)];
      while (lv[lv.length - 1] > 1) lv.push(Math.ceil(lv[lv.length - 1] / fan));
      lv.reverse(); // root first
      const H = lv.length;
      const bin = Math.ceil(Math.log2(N + 1));
      const upper = lv.slice(0, -1).reduce((s, x) => s + x, 0) * P;
      const total = lv.reduce((s, x) => s + x, 0) * P;
      stats.innerHTML =
        `<div class="stat"><b>${fan}</b><span>ветвление: ${per} записей на странице × ${Math.round(FILL * 100)}%</span></div>` +
        `<div class="stat"><b>${H}</b><span>${plural(H, ['уровень', 'уровня', 'уровней'])} B+дерева</span></div>` +
        `<div class="stat warn"><b>${bin}</b><span>уровней двоичного дерева</span></div>`;
      const mx = Math.log10(lv[lv.length - 1] + 1);
      levels.innerHTML = lv.map((c, i) => `<div class="fo-lv"><span class="label">${i === 0 ? 'корень' : i === H - 1 ? 'листья' : 'уровень ' + (i + 1)}</span><span class="cost-track"><span class="cost-fill${i === H - 1 ? ' leaf' : ''}" style="width:${Math.max(1.5, (Math.log10(c + 1) / Math.max(mx, 1)) * 100)}%"></span></span><b>${fmt(c)}</b></div>`).join('');
      const cached = upper <= 2 * 2 ** 30;
      log.innerHTML = `Поиск: ${H} ${plural(H, ['страница', 'страницы', 'страниц'])}. ` + (cached
        ? `Все уровни кроме листьев — ${bytes(upper || P)}, они живут в кэше, так что с диска читается ${H > 1 ? 'максимум один лист' : 'одна страница'}.`
        : `Внутренние уровни — уже ${bytes(upper)}: в кэше держатся верхние, с диска — 2–3 чтения. Такие таблицы обычно секционируют.`) + ` Индекс целиком — ${bytes(total)}. Двоичному дереву понадобилось бы ${bin} переходов по указателям — ${bin} промахов кэша или случайных чтений.`;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- B+tree with splits
  Deck.demo('bplus', root => {
    const MAX = 3;
    let tree, nextSeq, path = new Set(), split = new Set(), hits = new Set(), rightFill = false, total = 0;
    const input = h('input', { type: 'number', class: 'num-in', min: 1, max: 999, value: 42, 'aria-label': 'Ключ' });
    const treeEl = h('div', { class: 'bt no-swipe' });
    const stats = h('div', { class: 'label' });
    const log = h('p', { class: 'log' });
    const say = logger(log, 1);
    const tog = h('input', { type: 'checkbox' });
    tog.addEventListener('change', () => { rightFill = tog.checked; reset(); });
    root.append(
      h('div', { class: 'controls' }, input,
        h('button', { class: 'btn small primary', onclick: () => add(Math.max(1, Math.min(999, Math.round(+input.value || 1)))) }, 'Вставить'),
        h('button', { class: 'btn small', onclick: () => add(nextSeq) }, '+ следующий по порядку'),
        h('button', { class: 'btn small', onclick: () => { let k; do k = rnd(1, 99); while (has(k)); add(k); } }, '+ случайный')),
      treeEl, stats, log,
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: range }, 'Диапазон 20…50'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс'),
        h('label', { class: 'toggle' }, tog, 'правый край: не делить пополам')),
    );
    const leafOf = k => { let n = tree; const p = [n]; while (!n.leaf) { let i = 0; while (i < n.keys.length && k >= n.keys[i]) i++; n = n.children[i]; p.push(n); } return p; };
    const has = k => leafOf(k).pop().keys.includes(k);
    function ins(node, k, ev, rightmost) {
      if (node.leaf) {
        node.keys.push(k); node.keys.sort((a, b) => a - b);
        if (node.keys.length <= MAX) return null;
        const m = rightFill && rightmost && k === node.keys[node.keys.length - 1] ? MAX : Math.ceil(node.keys.length / 2);
        const right = { leaf: true, keys: node.keys.slice(m), next: node.next };
        node.keys = node.keys.slice(0, m);
        node.next = right;
        ev.push(node, right);
        return { sep: right.keys[0], right };
      }
      let i = 0;
      while (i < node.keys.length && k >= node.keys[i]) i++;
      const r = ins(node.children[i], k, ev, rightmost && i === node.keys.length);
      if (!r) return null;
      node.keys.splice(i, 0, r.sep);
      node.children.splice(i + 1, 0, r.right);
      if (node.keys.length <= MAX) return null;
      const m = Math.floor(node.keys.length / 2);
      const sep = node.keys[m];
      const right = { leaf: false, keys: node.keys.slice(m + 1), children: node.children.slice(m + 1) };
      node.keys = node.keys.slice(0, m);
      node.children = node.children.slice(0, m + 1);
      ev.push(node, right, sep);
      return { sep, right };
    }
    function add(k) {
      if (has(k)) { say(`Ключ ${k} уже есть.`, 'warn'); return; }
      if (total >= 30) { say('Хватит ключей: нажмите «Сброс».', 'warn'); return; }
      const ev = [];
      const r = ins(tree, k, ev, true);
      let grew = false;
      if (r) { tree = { leaf: false, keys: [r.sep], children: [tree, r.right] }; grew = true; }
      total++;
      nextSeq = Math.max(nextSeq, k + 3);
      input.value = rnd(1, 99);
      path = new Set(leafOf(k)); hits = new Set([k]); split = new Set(ev.filter(x => typeof x === 'object'));
      const nSplits = ev.filter(x => typeof x === 'object').length / 2;
      const seps = ev.filter(x => typeof x === 'number');
      say(`Вставлен ${k}. ` + (nSplits ? `Лист переполнился (${MAX + 1} ключа при максимуме ${MAX}) и разделился: первый ключ правой половины стал разделителем в родителе.` +
        (seps.length ? ` Переполнился и внутренний узел — ключ ${seps.join(', ')} ушёл ещё выше.` : '') : 'В листе было место — дерево не изменилось.') +
        (grew ? ' Разделился корень — появился новый корень, дерево выросло на уровень. Все листья по-прежнему на одной глубине.' : ''), nSplits ? 'warn' : 'ok');
      render();
    }
    function range() {
      const p = leafOf(20);
      path = new Set(p); split = new Set(); hits = new Set();
      let leaf = p[p.length - 1], pages = 0, n = 0;
      while (leaf) {
        pages++;
        leaf.keys.forEach(k => { if (k >= 20 && k <= 50) { hits.add(k); n++; } });
        path.add(leaf);
        if (!leaf.keys.length || leaf.keys[leaf.keys.length - 1] > 50) break;
        leaf = leaf.next;
      }
      say(`Диапазон 20…50: спуск к листу с 20 (${p.length} ${plural(p.length, ['узел', 'узла', 'узлов'])}), дальше по ссылкам между листьями — ${pages} ${plural(pages, ['лист', 'листа', 'листов'])}, ${n} ${plural(n, ['ключ', 'ключа', 'ключей'])}. Возвращаться наверх не нужно — так работают <code>BETWEEN</code> и <code>ORDER BY … LIMIT</code>.`, 'ok');
      render();
    }
    function render() {
      const levels = [];
      let cur = [tree];
      while (cur.length) { levels.push(cur); cur = cur.flatMap(n => (n.leaf ? [] : n.children)); }
      treeEl.innerHTML = levels.map((lvl, d) => `<div class="bt-level">${lvl.map(n =>
        `<span class="bt-node${n.leaf ? ' leaf' : ''}${path.has(n) ? ' path' : ''}${split.has(n) ? ' split' : ''}">${n.keys.map(k => `<span class="${n.leaf && hits.has(k) ? 'hit' : ''}">${k}</span>`).join('') || '<span class="e">пусто</span>'}</span>`)
        .join(d === levels.length - 1 ? '<span class="bt-link">→</span>' : '')}</div>`).join('');
      const leaves = levels[levels.length - 1];
      const fill = total ? Math.round(total / (leaves.length * MAX) * 100) : 0;
      stats.textContent = `${total} ${plural(total, ['ключ', 'ключа', 'ключей'])} · высота ${levels.length} · ${leaves.length} ${plural(leaves.length, ['лист', 'листа', 'листов'])} · листья заполнены на ${fill}%`;
    }
    function reset() {
      tree = { leaf: true, keys: [], next: null };
      total = 0; nextSeq = 5;
      [10, 20, 30, 40, 50, 60].forEach(k => { const r = ins(tree, k, [], true); if (r) tree = { leaf: false, keys: [r.sep], children: [tree, r.right] }; total++; });
      nextSeq = 63;
      path = new Set(); split = new Set(); hits = new Set();
      say(rightFill ? 'Режим Postgres: если ключ — новый максимум, правый лист делится не пополам, левый остаётся полным. Жмите «+ следующий по порядку» и смотрите на заполнение.' : 'В узле не больше трёх ключей (в реальной базе — сотни). Вставляйте ключи и смотрите, как узлы делятся.');
      render();
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- binary heap: sift up / down, heapify
  Deck.demo('heap', root => {
    let a = [], uid = 0, frames = [], fi = 0, busy = false;
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 40, dy: 48, r: 16, font: 13, maxH: 210 });
    const arrEl = h('div', { class: 'hp-arr' });
    const log = h('p', { class: 'log' });
    const btns = [];
    const B = (text, cls, fn) => { const b = h('button', { class: 'btn small ' + cls, onclick: fn }, text); btns.push(b); return b; };
    root.append(
      h('div', { class: 'controls' },
        B('+ случайное', 'primary', () => push(rnd(1, 99))),
        B('Извлечь минимум', '', pop),
        B('Heapify случайного массива', '', heapify),
        B('Сброс', '', reset)),
      view, arrEl, log,
    );
    const pl = player(() => { if (fi < frames.length - 1) { fi++; show(); return; } busy = false; sync(); return false; }, 650);
    const sync = () => btns.forEach((b, i) => { b.disabled = busy || (i === 0 && a.length >= 15) || (i === 1 && !a.length); });
    const snap = (hl, msg, cls = '', extra = {}) => frames.push({ arr: a.map(x => ({ ...x })), hl, msg, cls, ...extra });
    let cmp = 0;
    const less = (i, j) => { cmp++; return a[i].v < a[j].v; };
    const swap = (i, j) => { [a[i], a[j]] = [a[j], a[i]]; };
    function siftDown(i, n, quiet) {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && less(l, m)) m = l;
        if (r < n && less(r, m)) m = r;
        if (m === i) { if (!quiet) snap([i], `${a[i].v} не больше своих детей — просеивание вниз закончено.`); return; }
        snap([i, m], `${a[i].v} больше меньшего из детей (${a[m].v}) — меняем их местами: индексы ${i} ↔ ${m}.`);
        swap(i, m);
        i = m;
      }
    }
    function run(text) { fi = 0; busy = true; sync(); show(); pl.play(); if (text) frames[0].msg = text; }
    function push(v) {
      frames = []; cmp = 0;
      a.push({ id: ++uid, v });
      let i = a.length - 1;
      snap([i], `Кладём ${v} в конец массива — индекс ${i}. Свойство кучи может нарушиться только на пути вверх.`);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!less(i, p)) { snap([i, p], `${a[i].v} ≥ родителя ${a[p].v} (индекс (${i}−1)//2 = ${p}) — стоп. Сравнений: ${cmp}.`, 'ok'); break; }
        snap([i, p], `${a[i].v} < родителя ${a[p].v} (индекс (${i}−1)//2 = ${p}) — меняем, поднимаемся.`);
        swap(i, p); i = p;
      }
      if (i === 0) snap([0], `${a[0].v} дошёл до корня — новый минимум. Сравнений: ${cmp}, не больше высоты дерева.`, 'ok');
      run();
    }
    function pop() {
      if (!a.length) return;
      frames = []; cmp = 0;
      const min = a[0].v;
      snap([0, a.length - 1], `Минимум ${min} в a[0]. Переносим последний элемент (${a[a.length - 1].v}) на его место.`);
      const last = a.pop();
      if (a.length) { a[0] = last; snap([0], `${last.v} теперь в корне — просеиваем вниз к меньшему из детей.`); siftDown(0, a.length); }
      snap([], `Извлечён ${min}. Сравнений: ${cmp} — не больше 2 × высота.`, 'ok');
      run();
    }
    function heapify() {
      frames = []; cmp = 0;
      a = Array.from({ length: 15 }, () => ({ id: ++uid, v: rnd(1, 99) }));
      snap([], 'Случайный массив из 15 чисел — ещё не куча. Просеиваем вниз все узлы с детьми, от последнего (индекс 6) к корню.');
      for (let i = (a.length >> 1) - 1; i >= 0; i--) { snap([i], `Узел ${i} (${a[i].v}): просеиваем вниз.`); siftDown(i, a.length, true); }
      const nlog = Math.round(a.length * Math.log2(a.length));
      snap([], `Готово: ${cmp} ${plural(cmp, ['сравнение', 'сравнения', 'сравнений'])}. Вставка по одному стоила бы до n·log₂n ≈ ${nlog}. Половина узлов — листья, их не трогаем, четверть опускается максимум на 1 уровень — в сумме O(n).`, 'ok');
      run();
    }
    function show() {
      const f = frames[fi];
      const hl = new Set(f.hl);
      const arr = f.arr;
      const D = arr.length ? Math.floor(Math.log2(arr.length)) : 0;
      tv.update(arr.map((x, i) => {
        const d = Math.floor(Math.log2(i + 1)), p = i - (2 ** d - 1);
        return { id: x.id, label: x.v, x: (p + 0.5) * 2 ** (D - d) - 0.5, y: d, parent: i ? arr[(i - 1) >> 1].id : null, cls: hl.has(i) ? 'cur' : i === 0 ? 'done' : '' };
      }));
      arrEl.innerHTML = arr.length ? arr.map((x, i) => `<span class="hp-cell${hl.has(i) ? ' cur' : ''}${i === 0 ? ' top' : ''}"><b>${x.v}</b><i>${i}</i></span>`).join('') : '<span class="empty">куча пуста</span>';
      log.innerHTML = f.msg;
      log.className = 'log ' + f.cls;
    }
    function reset() {
      pl.pause(); busy = false;
      a = [];
      [12, 25, 18, 40, 31, 20, 57].forEach(v => a.push({ id: ++uid, v }));
      frames = []; snap([], 'Мин-куча из 7 элементов: каждый родитель не больше детей. Дети элемента i — 2i+1 и 2i+2.');
      fi = 0; show(); sync();
    }
    reset();
    return { start() { if (busy) pl.play(); }, stop() { pl.pause(); } };
  });

  // ---------------------------------------------------------------- heap patterns: top-K, median, merge K
  Deck.demo('streams', root => {
    const MODES = [['topk', 'Top-3'], ['median', 'Медиана потока'], ['merge', 'Слияние 3 списков']];
    let mode = 'topk', st;
    const modeBtns = MODES.map(([m, name]) => h('button', { class: 'btn small', onclick: () => { mode = m; reset(); } }, name));
    const body = h('div', { class: 'sm-body' });
    const log = h('p', { class: 'log' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { pl.pause(); syncAuto(); step(); } }, 'Шаг');
    const autoBtn = h('button', { class: 'btn', onclick: () => { pl.on ? pl.pause() : pl.play(); syncAuto(); } }, 'Авто');
    root.append(h('div', { class: 'controls' }, modeBtns), body, log,
      h('div', { class: 'controls' }, stepBtn, autoBtn, h('button', { class: 'btn', onclick: reset }, 'Новые данные')));
    const pl = player(() => { if (!step()) { syncAuto(); return false; } }, 800);
    const syncAuto = () => { autoBtn.textContent = pl.on ? 'Пауза' : 'Авто'; };
    // tiny heap on arrays (min-heap by cmp)
    const hpush = (a, x, lt) => { a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (!lt(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } };
    const hpop = (a, lt) => { const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && lt(a[l], a[m])) m = l; if (r < a.length && lt(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; };
    const LT = (x, y) => x < y, GT = (x, y) => x > y;
    const chips = (arr, cls = () => '') => arr.length ? arr.map((v, i) => `<span class="val ${cls(v, i)}">${v}</span>`).join('') : '<span class="empty">пусто</span>';
    const row = (label, html) => `<div class="tr-row"><span class="label tr-l">${label}</span><div class="queue">${html}</div></div>`;

    function reset() {
      pl.pause(); syncAuto();
      modeBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      if (mode === 'merge') {
        const lists = [0, 1, 2].map(() => Array.from({ length: 4 }, () => rnd(1, 60)).sort((a, b) => a - b));
        st = { lists, pos: [0, 0, 0], heap: [], out: [], started: false };
      } else {
        st = { stream: Array.from({ length: mode === 'topk' ? 14 : 11 }, () => rnd(1, 99)), i: 0, heap: [], low: [], high: [], skipped: 0 };
      }
      render(mode === 'topk' ? 'Ищем 3 наибольших в потоке. Держим мин-кучу из 3 элементов: в корне — самый маленький из лучших, кандидат на вылет.'
        : mode === 'median' ? 'Меньшая половина — в max-куче, большая — в min-куче. Медиана — на вершинах куч.'
          : 'Три отсортированных списка. Кладём в кучу голову каждого: (значение, номер списка).');
    }
    function step() {
      if (mode === 'topk') {
        if (st.i >= st.stream.length) return false;
        const x = st.stream[st.i++];
        let msg;
        if (st.heap.length < 3) { hpush(st.heap, x, LT); msg = `${x}: в куче меньше 3 элементов — просто добавляем.`; }
        else if (x > st.heap[0]) { const out = st.heap[0]; hpop(st.heap, LT); hpush(st.heap, x, LT); msg = `${x} больше минимума топа (${out}) — ${out} вылетает, ${x} занимает его место: O(log K).`; }
        else { st.skipped++; msg = `${x} ≤ ${st.heap[0]} — в топ не попадает, отбрасываем за O(1).`; }
        render(msg + (st.i === st.stream.length ? ` Поток кончился: топ-3 = ${[...st.heap].sort((a, b) => b - a).join(', ')}. Отброшено сразу: ${st.skipped} из ${st.stream.length}.` : ''), st.i === st.stream.length ? 'ok' : '');
        return st.i < st.stream.length;
      }
      if (mode === 'median') {
        if (st.i >= st.stream.length) return false;
        const x = st.stream[st.i++];
        let msg;
        if (!st.low.length || x <= st.low[0]) { hpush(st.low, x, GT); msg = `${x} ≤ вершины меньшей половины — кладём в max-кучу.`; }
        else { hpush(st.high, x, LT); msg = `${x} больше вершины меньшей половины — кладём в min-кучу.`; }
        if (st.low.length > st.high.length + 1) { const m = hpop(st.low, GT); hpush(st.high, m, LT); msg += ` Слева стало на 2 больше — перекладываем ${m} направо.`; }
        else if (st.high.length > st.low.length) { const m = hpop(st.high, LT); hpush(st.low, m, GT); msg += ` Справа больше — перекладываем ${m} налево.`; }
        const med = st.low.length > st.high.length ? st.low[0] : (st.low[0] + st.high[0]) / 2;
        render(`${msg} Медиана: <b>${String(med).replace('.', ',')}</b> — за O(1), вставка за O(log n).`, st.i === st.stream.length ? 'ok' : '');
        return st.i < st.stream.length;
      }
      if (!st.started) {
        st.started = true;
        st.lists.forEach((l, j) => { hpush(st.heap, [l[0], j], (x, y) => x[0] < y[0]); st.pos[j] = 1; });
        render('Головы всех списков в куче. Дальше: достаём минимум, выводим, кладём следующий элемент из того же списка.');
        return true;
      }
      if (!st.heap.length) return false;
      const lt = (x, y) => x[0] < y[0];
      const [v, j] = hpop(st.heap, lt);
      st.out.push(v);
      let msg = `Минимум ${v} из списка ${j + 1} — в вывод.`;
      if (st.pos[j] < st.lists[j].length) { const nx = st.lists[j][st.pos[j]++]; hpush(st.heap, [nx, j], lt); msg += ` Кладём следующий из списка ${j + 1}: ${nx}.`; }
      else msg += ` Список ${j + 1} кончился — куча уменьшилась.`;
      const done = !st.heap.length;
      render(msg + (done ? ' Всё слито: n·log K операций, памяти — K элементов.' : ''), done ? 'ok' : '');
      return !done;
    }
    function render(msg, cls = '') {
      if (mode === 'topk') {
        const top = [...st.heap].sort((a, b) => a - b);
        body.innerHTML = row('Поток', chips(st.stream, (v, i) => i < st.i - 1 ? 'dim' : i === st.i - 1 ? 'cur' : '')) +
          row('Куча (K=3)', chips(st.heap, (v, i) => i === 0 ? 'top' : '') + (st.heap.length ? '<span class="more">← корень = минимум топа</span>' : '')) +
          row('Топ-3', chips(top.reverse(), () => 'done'));
      } else if (mode === 'median') {
        const lo = [...st.low].sort((a, b) => a - b), hi = [...st.high].sort((a, b) => a - b);
        const med = !st.low.length ? '—' : st.low.length > st.high.length ? st.low[0] : String((st.low[0] + st.high[0]) / 2).replace('.', ',');
        body.innerHTML = row('Поток', chips(st.stream, (v, i) => i < st.i - 1 ? 'dim' : i === st.i - 1 ? 'cur' : '')) +
          `<div class="md-halves"><div><span class="label">меньшая половина · max-куча</span><div class="queue">${chips(lo, (v, i) => i === lo.length - 1 ? 'top' : '')}</div></div>` +
          `<div class="md-med"><span class="label">медиана</span><b>${med}</b></div>` +
          `<div><span class="label">большая половина · min-куча</span><div class="queue">${chips(hi, (v, i) => i === 0 ? 'top' : '')}</div></div></div>` +
          '<p class="note">Половины показаны отсортированными; в памяти это два массива-кучи, отмечены вершины.</p>';
      } else {
        body.innerHTML = st.lists.map((l, j) => row('Список ' + (j + 1), chips(l, (v, i) => i < st.pos[j] - (st.heap.some(x => x[1] === j) ? 1 : 0) ? 'dim' : st.heap.some(x => x[1] === j) && i === st.pos[j] - 1 ? 'top' : ''))).join('') +
          row('Куча', chips(st.heap.map(x => x[0]), (v, i) => i === 0 ? 'cur' : '')) +
          row('Вывод', chips(st.out, () => 'done'));
      }
      log.innerHTML = msg;
      log.className = 'log ' + cls;
    }
    reset();
    return { stop() { pl.pause(); syncAuto(); } };
  });

  // ---------------------------------------------------------------- trie
  Deck.demo('trie', root => {
    let trie, words;
    const input = h('input', { type: 'text', class: 'txt-in', value: 'ко', maxlength: 10, 'aria-label': 'Префикс или слово', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 34, dy: 42, r: 15, font: 14, pad: 18, maxH: 270 });
    const sugg = h('div', { class: 'queue' });
    const stats = h('div', { class: 'label' });
    const log = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, input,
        h('button', { class: 'btn small primary', onclick: () => addWord(input.value) }, 'Добавить слово'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
      view, h('div', { class: 'tr-row' }, h('span', { class: 'label tr-l' }, 'Подсказки'), sugg), stats, log,
    );
    input.addEventListener('input', () => query());
    const node = () => ({ ch: new Map(), end: false });
    function insert(w) { let n = trie; for (const c of w) { if (!n.ch.has(c)) n.ch.set(c, node()); n = n.ch.get(c); } const was = n.end; n.end = true; return !was; }
    const clean = s => s.toLowerCase().replace(/[^а-яёa-z]/g, '').slice(0, 10);
    function addWord(raw) {
      const w = clean(raw);
      if (!w) { log.innerHTML = 'Введите слово из букв.'; log.className = 'log warn'; return; }
      if (words.length >= 14 && !words.includes(w)) { log.innerHTML = 'Хватит слов для схемы: нажмите «Сброс».'; log.className = 'log warn'; return; }
      const added = insert(w);
      if (added) words.push(w);
      query(added ? `Слово «${w}» добавлено: новые узлы появились только там, где путь разошёлся с уже известными словами.` : `«${w}» уже в словаре.`);
    }
    function collect(n, pre, out) { if (n.end) out.push(pre); [...n.ch.keys()].sort().forEach(c => collect(n.ch.get(c), pre + c, out)); return out; }
    function query(extra) {
      const p = clean(input.value);
      let n = trie, depth = 0;
      for (const c of p) { if (!n.ch.has(c)) break; n = n.ch.get(c); depth++; }
      const ok = depth === p.length;
      const found = ok ? collect(n, p, []) : [];
      const onPath = new Set(); for (let i = 0; i <= depth; i++) onPath.add(p.slice(0, i));
      const sub = new Set(found.flatMap(w => [...w].map((_, i) => w.slice(0, i + 1))));
      const items = layoutTree({ id: '', n: trie }, x => [...x.n.ch.keys()].sort().map(c => ({ id: x.id + c, n: x.n.ch.get(c), c })), x => ({
        id: x.id, label: x.id ? x.c : '·',
        cls: (x.n.end ? 'term ' : '') + (ok && x.id === p && p ? 'cur' : onPath.has(x.id) && x.id ? 'path' : p && ok && sub.has(x.id) ? 'onstack' : ''),
      }));
      tv.update(items);
      sugg.innerHTML = found.length ? found.map(w => `<span class="sug"><b>${p}</b>${w.slice(p.length)}</span>`).join('') : '<span class="empty">нет</span>';
      const letters = words.reduce((s, w) => s + w.length, 0);
      stats.textContent = `${words.length} ${plural(words.length, ['слово', 'слова', 'слов'])}, ${letters} ${plural(letters, ['буква', 'буквы', 'букв'])}, ${items.length - 1} ${plural(items.length - 1, ['узел', 'узла', 'узлов'])} · жирный круг — конец слова`;
      log.className = 'log' + (p && !ok ? ' warn' : '');
      log.innerHTML = (extra ? extra + ' ' : '') + (!p ? 'Введите префикс — подсказки появятся сразу.' : ok
        ? `Префикс «${p}»: ${p.length} ${plural(p.length, ['шаг', 'шага', 'шагов'])} от корня, дальше обход поддерева — ${found.length} ${plural(found.length, ['слово', 'слова', 'слов'])}. Размер словаря на поиск не влияет.`
        : `Префикса «${p}» нет: после «${p.slice(0, depth) || 'корня'}» нет перехода по «${p[depth]}». Узнали за ${depth + 1} ${plural(depth + 1, ['шаг', 'шага', 'шагов'])}.`);
    }
    function reset() {
      trie = node(); words = [];
      ['кот', 'код', 'кода', 'кодер', 'кол', 'коса', 'рот', 'рог', 'роза'].forEach(w => { insert(w); words.push(w); });
      input.value = 'ко';
      query();
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- longest prefix match
  Deck.demo('lpm', root => {
    const ip2n = s => s.split('.').reduce((a, x) => a * 256 + (+x), 0);
    const ROUTES = [
      ['0.0.0.0', 0, 'провайдер (по умолчанию)'], ['10.0.0.0', 8, 'VPN'], ['10.1.0.0', 16, 'офис'], ['10.1.2.0', 24, 'стойка с БД'],
      ['172.16.0.0', 12, 'docker'], ['192.168.0.0', 16, 'домашняя сеть'],
    ].map(([a, len, name]) => ({ a, len, name, n: ip2n(a) }));
    const IPS = ['10.1.2.7', '10.1.9.9', '10.200.0.1', '172.17.0.2', '192.168.1.10', '8.8.8.8'];
    const bit = (n, i) => Math.floor(n / 2 ** (31 - i)) % 2;
    const match = (ip, r, d = r.len) => { for (let i = 0; i < d; i++) if (bit(ip, i) !== bit(r.n, i)) return false; return true; };
    let ip, depth, best, events, ei, state;
    const ipBtns = IPS.map(s => h('button', { class: 'btn small', onclick: () => choose(s) }, s));
    const bitsEl = h('div', { class: 'lp-bits' });
    const table = h('div', { class: 'lp-table' });
    const log = h('p', { class: 'log' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => step() }, 'Шаг');
    root.append(h('div', { class: 'controls' }, ipBtns), bitsEl, table, log,
      h('div', { class: 'controls' }, stepBtn, h('button', { class: 'btn', onclick: () => { while (step()); } }, 'До конца')));

    function choose(s) {
      ipBtns.forEach(b => b.classList.toggle('sel', b.textContent === s));
      ip = ip2n(s);
      // events: walk the binary trie bit by bit, stopping at route ends and at the dead end
      events = [];
      let d = 0, b = null;
      for (;;) {
        const here = ROUTES.filter(r => r.len === d && match(ip, r));
        here.forEach(r => { b = r; events.push({ d, best: r, msg: `Глубина ${d}: здесь кончается префикс ${r.a}/${r.len} и биты совпали — запоминаем маршрут «${r.name}» как лучший.` }); });
        const deeper = ROUTES.some(r => r.len > d && match(ip, r, d + 1));
        if (!deeper) {
          events.push({ d, best: b, end: true, msg: `После ${d} ${plural(d, ['бита', 'бит', 'бит'])} в дереве нет ветки для следующего бита — длиннее совпадения не будет. Ответ — последний запомненный: <b>${b.a}/${b.len} → ${b.name}</b>.` });
          break;
        }
        d++;
      }
      ei = -1; depth = 0; best = null; state = new Map();
      log.innerHTML = `Адрес ${s}. Идём по битам от старшего и запоминаем последний маршрут, чей префикс полностью совпал. Нажмите «Шаг».`;
      log.className = 'log';
      render();
    }
    function step() {
      if (ei >= events.length - 1) return false;
      const e = events[++ei];
      depth = e.d; best = e.best;
      ROUTES.forEach(r => { if (r.len <= depth) state.set(r, match(ip, r) ? 'ok' : 'no'); else if (!match(ip, r, depth)) state.set(r, 'no'); });
      if (e.end) ROUTES.forEach(r => { if (!state.has(r)) state.set(r, 'no'); });
      log.innerHTML = e.msg;
      log.className = 'log' + (e.end ? ' ok' : '');
      render();
      return ei < events.length - 1;
    }
    function render() {
      let html = '';
      for (let o = 0; o < 4; o++) {
        html += '<div class="lp-oct">';
        for (let i = o * 8; i < o * 8 + 8; i++) html += `<span class="${i < depth ? 'walk' : ''}${best && i < best.len ? ' bestb' : ''}">${bit(ip, i)}</span>`;
        html += `<em>${Math.floor(ip / 2 ** (24 - o * 8)) % 256}</em></div>`;
      }
      bitsEl.innerHTML = html;
      table.innerHTML = ROUTES.map(r => {
        const s = state.get(r) || '';
        return `<div class="lp-row ${s}${best === r ? ' best' : ''}"><code>${r.a}/${r.len}</code><span>${r.name}</span><b>${best === r ? 'лучший' : s === 'ok' ? 'подходит' : s === 'no' ? 'нет' : ''}</b></div>`;
      }).join('');
      stepBtn.disabled = ei >= events.length - 1;
    }
    choose(IPS[0]);
    return {};
  });
})();
