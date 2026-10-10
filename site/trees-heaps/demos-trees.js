// Demos: trees everywhere, traversals, BST, rotations, balancing, interview problems.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const { logger, treeView, layoutBinary, layoutTree, height, rnd, player } = TH;

  const T = (label, ...kids) => ({ label, kids });

  // ---------------------------------------------------------------- trees everywhere
  Deck.demo('everywhere', root => {
    const EX = [
      { name: 'DOM', tree: T('html', T('head', T('title')), T('body', T('header', T('nav')), T('main', T('h1'), T('p')))), ops: [
        { name: 'querySelectorAll', order: 'pre', text: '<code>querySelectorAll</code> возвращает элементы в порядке документа — это обход в глубину pre-order: узел, потом его дети слева направо.' },
        { name: 'всплытие click с <p>', order: 'path', target: 'p', text: 'Событие всплывает от цели к корню по ссылкам на родителя: <code>p → main → body → html</code>. Это не обход, а путь длиной в глубину дерева.' },
      ] },
      { name: 'AST', tree: T('x = …', T('+', T('a'), T('*', T('b'), T('2'))), T('x')), ops: [
        { name: 'компиляция', order: 'post', text: 'Код <code>x = a + b * 2</code>. Компилятор CPython обходит AST в post-order: сначала операнды, потом операция — <code>LOAD a, LOAD b, LOAD 2, MUL, ADD, STORE x</code>. Так выражение ложится на стековую машину.' },
        { name: 'ast.walk', order: 'bfs', text: '<code>ast.walk</code> в Python обходит дерево в ширину — через очередь <code>deque</code>. Порядок не гарантирован документацией, поэтому на него не полагаются.' },
      ] },
      { name: 'Файлы', tree: T('/', T('etc', T('hosts'), T('nginx', T('nginx.conf'))), T('home', T('vlad', T('notes.md'), T('photo.jpg'))), T('tmp')), ops: [
        { name: 'find /', order: 'pre', text: '<code>find</code> печатает каталог раньше его содержимого — pre-order. Так же работают <code>os.walk</code> (по умолчанию) и <code>tree</code>.' },
        { name: 'du, rm -r', order: 'post', text: 'Размер каталога известен только после всех детей, а удалить каталог можно, только когда он пуст. <code>du</code> и <code>rm -r</code> — post-order.' },
      ] },
      { name: 'JSON', tree: T('{…}', T('user', T('name'), T('tags', T('0'), T('1'))), T('orders', T('0', T('id'), T('sum')))), ops: [
        { name: 'json.dumps', order: 'pre', text: 'Сериализация пишет открывающую скобку и ключ раньше содержимого — pre-order. Вложенность в тысячи уровней упирается в лимит рекурсии.' },
        { name: 'глубина', order: 'post', text: 'Глубина документа: <code>1 + max(глубина детей)</code>. Ответ узла собирается из ответов детей — post-order. Так решается половина задач про деревья.' },
      ] },
      { name: 'Оргструктура', tree: T('CEO', T('CTO', T('backend', T('dev1'), T('dev2')), T('frontend')), T('CFO', T('бухгалтерия'))), ops: [
        { name: 'по уровням', order: 'bfs', text: 'Все подчинённые на 1, 2, 3 уровня ниже — обход в ширину. В SQL это <code>WITH RECURSIVE</code>: каждая итерация добавляет следующий уровень.' },
        { name: 'фонд оплаты', order: 'post', text: 'Фонд оплаты отдела = зарплата руководителя + фонды подотделов. Сначала дети, потом узел — post-order.' },
      ] },
    ];
    let ex = 0, op = 0, shown = 0, order = [];
    const exBtns = EX.map((e, i) => h('button', { class: 'btn small', onclick: () => { ex = i; op = 0; build(); } }, e.name));
    const opRow = h('div', { class: 'controls' });
    const tree = h('div', { class: 'ew-tree' });
    const log = h('p', { class: 'log' });
    root.append(h('div', { class: 'controls' }, exBtns), opRow, tree, log);
    const pl = player(() => { if (shown >= order.length) return false; shown++; paint(); }, 380);

    function flat(n, d = 0, prefix = '', last = true, out = [], parent = null) {
      const row = { n, d, parent, line: d === 0 ? '' : prefix + (last ? '└─ ' : '├─ ') };
      out.push(row);
      n.kids.forEach((k, i) => flat(k, d + 1, d === 0 ? '' : prefix + (last ? '   ' : '│  '), i === n.kids.length - 1, out, row));
      return out;
    }
    let rows = [];
    function computeOrder(o, target) {
      if (o === 'pre') return rows.slice();
      if (o === 'post') { const out = []; const rec = r => { rows.filter(x => x.parent === r).forEach(rec); out.push(r); }; rec(rows[0]); return out; }
      if (o === 'bfs') { const out = [], q = [rows[0]]; while (q.length) { const r = q.shift(); out.push(r); q.push(...rows.filter(x => x.parent === r)); } return out; }
      const out = []; let r = rows.find(x => x.n.label === target); while (r) { out.push(r); r = r.parent; } return out;
    }
    function build() {
      pl.pause();
      const e = EX[ex];
      exBtns.forEach((b, i) => b.classList.toggle('sel', i === ex));
      opRow.replaceChildren(h('span', { class: 'label' }, 'Операция:'), ...e.ops.map((o, i) => h('button', { class: 'btn small' + (i === op ? ' sel' : ''), onclick: () => { op = i; build(); } }, o.name)));
      rows = flat(e.tree);
      order = computeOrder(e.ops[op].order, e.ops[op].target);
      shown = 0;
      paint();
      log.innerHTML = e.ops[op].text;
      pl.play();
    }
    function paint() {
      const idx = new Map(order.slice(0, shown).map((r, i) => [r, i + 1]));
      tree.innerHTML = rows.map(r => {
        const k = idx.get(r);
        return `<div class="ew-row${k ? ' on' : ''}${k === shown && k ? ' cur' : ''}"><span class="ew-line">${r.line}</span><span class="ew-lab">${r.n.label.replace(/</g, '&lt;')}</span>${k ? `<span class="ew-ord">${k}</span>` : ''}</div>`;
      }).join('');
    }
    build();
    return { start() { if (shown < order.length) pl.play(); }, stop() { pl.pause(); } };
  });

  // ---------------------------------------------------------------- traversals
  const N = (key, left = null, right = null) => ({ key, left, right });
  const travTree = () => N('F', N('B', N('A'), N('D', N('C'), N('E'))), N('G', null, N('I', N('H'))));

  Deck.demo('traverse', root => {
    const MODES = [['pre', 'pre-order'], ['in', 'in-order'], ['post', 'post-order'], ['bfs', 'BFS']];
    const t = travTree();
    let mode = 'pre', frames = [], fi = 0;
    const modeBtns = MODES.map(([m, name]) => h('button', { class: 'btn small', onclick: () => { mode = m; build(); } }, name));
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 38, dy: 50, maxH: 220 });
    const sLabel = h('span', { class: 'label tr-l' });
    const stackEl = h('div', { class: 'queue tr-stack' });
    const outEl = h('div', { class: 'queue' });
    const log = h('p', { class: 'log' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { pl.pause(); step(); } }, 'Шаг');
    const autoBtn = h('button', { class: 'btn', onclick: () => { pl.on ? pl.pause() : (fi >= frames.length - 1 && (fi = 0), pl.play()); syncAuto(); } }, 'Авто');
    root.append(
      h('div', { class: 'controls' }, modeBtns),
      view,
      h('div', { class: 'tr-row' }, sLabel, stackEl),
      h('div', { class: 'tr-row' }, h('span', { class: 'label tr-l' }, 'Вывод'), outEl),
      log,
      h('div', { class: 'controls' }, stepBtn, autoBtn, h('button', { class: 'btn', onclick: () => { pl.pause(); fi = 0; render(); } }, 'Сначала')),
    );
    const pl = player(() => { if (!step()) { syncAuto(); return false; } }, 750);
    const syncAuto = () => { autoBtn.textContent = pl.on ? 'Пауза' : 'Авто'; };

    function makeFrames() {
      const fr = [], out = [], stack = [];
      const push = (cur, msg) => fr.push({ cur, stack: stack.slice(), out: out.slice(), msg });
      if (mode === 'bfs') {
        const q = [t];
        fr.push({ cur: null, stack: q.slice(), out: [], msg: 'Кладём корень F в очередь.' });
        while (q.length) {
          const n = q.shift();
          out.push(n);
          const kids = [n.left, n.right].filter(Boolean);
          q.push(...kids);
          fr.push({ cur: n, stack: q.slice(), out: out.slice(), msg: `Достаём из головы очереди <b>${n.key}</b>, выводим` + (kids.length ? ` и ставим в хвост ${plural(kids.length, ['его ребёнка', 'его детей', 'его детей'])} ${kids.map(k => k.key).join(', ')}.` : '. Детей нет.') + (q.length ? '' : ' Очередь пуста — обход закончен.') });
        }
        return fr;
      }
      const rec = n => {
        stack.push(n);
        if (mode === 'pre') { out.push(n); push(n, `Вызов visit(${n.key}): кадр в стек. Pre-order — сразу выводим <b>${n.key}</b>, потом идём в детей.`); }
        else push(n, `Вызов visit(${n.key}): кадр в стек. ${mode === 'in' ? 'Сначала обойдём левое поддерево.' : 'Сначала обойдём обоих детей.'}`);
        if (n.left) rec(n.left);
        if (mode === 'in') { out.push(n); push(n, `Левое поддерево ${n.key} обойдено — выводим <b>${n.key}</b> и идём направо.`); }
        if (n.right) rec(n.right);
        if (mode === 'post') { out.push(n); stack.pop(); push(n, `Оба поддерева ${n.key} обойдены — выводим <b>${n.key}</b> и возвращаемся: кадр снят.`); }
        else { stack.pop(); push(stack[stack.length - 1] || null, `Возврат из visit(${n.key}): кадр снят` + (stack.length ? `, продолжаем в visit(${stack[stack.length - 1].key}).` : '. Стек пуст — обход закончен.')); }
      };
      fr.push({ cur: null, stack: [], out: [], msg: 'Начинаем с вызова visit(F).' });
      rec(t);
      return fr;
    }
    function build() {
      pl.pause(); syncAuto();
      modeBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      sLabel.textContent = mode === 'bfs' ? 'Очередь' : 'Стек вызовов';
      frames = makeFrames();
      fi = 0;
      render();
    }
    function step() {
      if (fi >= frames.length - 1) return false;
      fi++; render();
      return fi < frames.length - 1;
    }
    function render() {
      const f = frames[fi];
      const done = new Set(f.out), on = new Set(f.stack);
      tv.update(layoutBinary(t, n => ({ id: n.key, label: n.key, cls: f.cur === n ? 'cur' : done.has(n) ? 'done' : on.has(n) ? 'onstack' : '' })));
      stackEl.innerHTML = f.stack.length ? f.stack.map(n => `<span class="val">${n.key}</span>`).join(mode === 'bfs' ? '' : '<span class="arr">›</span>') + (mode === 'bfs' ? '' : '<span class="more">← вершина</span>') : '<span class="empty">пусто</span>';
      if (mode === 'bfs' && f.stack.length) stackEl.insertAdjacentHTML('afterbegin', '<span class="more">голова →</span>');
      outEl.innerHTML = f.out.length ? f.out.map(n => `<span class="val done">${n.key}</span>`).join('') : '<span class="empty">пока ничего</span>';
      log.innerHTML = `<span class="step-n">${fi}/${frames.length - 1}</span> ${f.msg}`;
      stepBtn.disabled = fi >= frames.length - 1;
    }
    build();
    return { stop() { pl.pause(); syncAuto(); } };
  });

  // ---------------------------------------------------------------- BST insert/search/delete
  function bstInsert(root, key) {
    const z = N(key);
    if (!root) return z;
    let n = root;
    for (;;) {
      if (key < n.key) { if (!n.left) { n.left = z; break; } n = n.left; }
      else { if (!n.right) { n.right = z; break; } n = n.right; }
    }
    return root;
  }
  function bstPath(root, key) {
    const p = [];
    let n = root;
    while (n) { p.push(n); if (key === n.key) break; n = key < n.key ? n.left : n.right; }
    return p;
  }

  Deck.demo('bst', root => {
    let tree = null, hl = new Map(), count = 0;
    const input = h('input', { type: 'number', class: 'num-in', min: 1, max: 99, value: 45, 'aria-label': 'Ключ' });
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 36, dy: 48, maxH: 250 });
    const stats = h('div', { class: 'label' });
    const log = h('p', { class: 'log' });
    const say = logger(log, 1);
    const key = () => Math.max(1, Math.min(99, Math.round(+input.value || 0)));
    root.append(
      h('div', { class: 'controls' }, input,
        h('button', { class: 'btn small', onclick: () => find(key()) }, 'Найти'),
        h('button', { class: 'btn small primary', onclick: () => insert(key()) }, 'Вставить'),
        h('button', { class: 'btn small', onclick: () => del(key()) }, 'Удалить')),
      view, stats, log,
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => { let k; do k = rnd(1, 99); while (bstPath(tree, k).some(n => n.key === k)); input.value = k; insert(k); } }, '+ случайный'),
        h('button', { class: 'btn small', onclick: () => { const all = []; (function w(n) { if (n) { w(n.left); all.push(n.key); w(n.right); } })(tree); if (all.length) { const k = all.find(k => { const n = bstPath(tree, k).pop(); return n.left && n.right; }) ?? all[0]; input.value = k; del(k); } } }, 'Удалить узел с 2 детьми'),
        h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
    );

    function render() {
      tv.update(tree ? layoutBinary(tree, n => ({ id: n.key, label: n.key, cls: hl.get(n.key) || '' })) : []);
      count = 0; (function c(n) { if (n) { count++; c(n.left); c(n.right); } })(tree);
      stats.textContent = `${count} ${plural(count, ['ключ', 'ключа', 'ключей'])}, высота ${height(tree)}; идеально сбалансированное дерево — ${Math.ceil(Math.log2(count + 1))}`;
    }
    const pathText = p => p.map(n => n.key).join(' → ');
    function mark(path, last) { hl = new Map(path.map(n => [n.key, 'path'])); if (last != null) hl.set(last, 'found'); }
    function find(k) {
      const p = bstPath(tree, k);
      const hit = p.length && p[p.length - 1].key === k;
      mark(p, hit ? k : null);
      say(`Поиск ${k}: ${pathText(p) || 'дерево пустое'} — ${p.length} ${plural(p.length, ['сравнение', 'сравнения', 'сравнений'])}, ${hit ? 'найден' : 'такого ключа нет: дошли до пустого места'}. На каждом шаге отбрасываем целое поддерево.`, hit ? 'ok' : '');
      render();
    }
    function insert(k) {
      const p = bstPath(tree, k);
      if (p.length && p[p.length - 1].key === k) { mark(p, k); say(`Ключ ${k} уже есть — в множестве дубликаты не храним.`, 'warn'); render(); return; }
      if (count >= 20) { say('Хватит ключей: удалите что-нибудь или нажмите «Сброс».', 'warn'); return; }
      tree = bstInsert(tree, k);
      mark(p, k); hl.set(k, 'new');
      const par = p[p.length - 1];
      say(p.length ? `Вставка ${k}: спускаемся ${pathText(p)} и вешаем новый лист ${k < par.key ? 'слева' : 'справа'} от ${par.key}. Остальное дерево не меняется.` : `Дерево было пустым — ${k} стал корнем.`, 'ok');
      render();
    }
    function del(k) {
      const p = bstPath(tree, k);
      const n = p[p.length - 1];
      if (!n || n.key !== k) { mark(p, null); say(`Ключа ${k} нет — удалять нечего.`, 'warn'); render(); return; }
      const parent = p[p.length - 2];
      const relink = repl => { if (!parent) tree = repl; else if (parent.left === n) parent.left = repl; else parent.right = repl; };
      hl = new Map(p.slice(0, -1).map(x => [x.key, 'path']));
      if (!n.left || !n.right) {
        const child = n.left || n.right;
        relink(child);
        if (child) hl.set(child.key, 'new');
        say(child ? `${k} — узел с одним ребёнком: ребёнок ${child.key} встаёт на его место вместе со всем поддеревом.` : `${k} — лист: просто отрезаем его.`, 'ok');
      } else {
        let sp = n, s = n.right;
        while (s.left) { sp = s; s = s.left; }
        if (sp !== n) { sp.left = s.right; s.right = n.right; }
        s.left = n.left;
        relink(s);
        hl.set(s.key, 'new');
        say(`${k} — узел с двумя детьми. Берём следующий по порядку ключ — самый левый в правом поддереве: <b>${s.key}</b>. У него нет левого ребёнка, поэтому его легко вынуть; он встаёт на место ${k}, и порядок сохраняется.`, 'ok');
      }
      render();
    }
    function reset() {
      tree = null;
      [50, 30, 70, 20, 40, 60, 80, 35, 45, 65, 85].forEach(k => { tree = bstInsert(tree, k); });
      hl = new Map();
      input.value = 42;
      say('Дерево из 11 ключей. Введите ключ и выберите операцию.');
      render();
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- rotations
  Deck.demo('rotate', root => {
    let tree = null, moves = 0;
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 46, dy: 44, r: 18, maxH: 320 });
    const ordEl = h('div', { class: 'label' });
    const log = h('p', { class: 'log' });
    const say = logger(log, 1);
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn small', onclick: () => reset([1, 2, 3, 4, 5, 6, 7]) }, 'Цепочка 1…7'),
        h('button', { class: 'btn small', onclick: () => reset([7, 6, 5, 4, 3, 2, 1]) }, 'Цепочка 7…1'),
        h('button', { class: 'btn small', onclick: () => reset([4, 2, 6, 1, 3, 5, 7]) }, 'Идеальное')),
      view, ordEl, log,
    );
    const bf = n => height(n.left) - height(n.right);
    function parentOf(k) { let p = null, n = tree; while (n && n.key !== k) { p = n; n = k < n.key ? n.left : n.right; } return [p, n]; }
    tv.onClick = k => {
      const [p, x] = parentOf(k);
      if (!p) { say(`${k} — уже корень: поворачивать вверх некуда. Нажмите на узел ниже.`, 'warn'); return; }
      const [gp] = parentOf(p.key);
      const h0 = height(tree);
      let moved, dir;
      if (p.left === x) { moved = x.right; p.left = x.right; x.right = p; dir = 'Правый'; }
      else { moved = x.left; p.right = x.left; x.left = p; dir = 'Левый'; }
      if (!gp) tree = x; else if (gp.left === p) gp.left = x; else gp.right = x;
      moves++;
      const h1 = height(tree);
      const ok = h1 === 3;
      say(`${dir} поворот: ${k} поднялся над ${p.key}. ${moved ? `Поддерево ${moved.key} перевесили от ${k} к ${p.key}.` : 'Перевешивать было нечего.'} Высота ${h0} → ${h1}. ${ok ? `Готово за ${moves} ${plural(moves, ['поворот', 'поворота', 'поворотов'])}: высота 3 — минимум для 7 ключей.` : ''}`, ok ? 'ok' : '');
      render();
    };
    function render() {
      tv.update(layoutBinary(tree, n => {
        const b = bf(n);
        return { id: n.key, label: n.key, note: (b > 0 ? '+' : '') + b, cls: Math.abs(b) > 1 ? 'bad' : '' };
      }));
      const ord = []; (function w(n) { if (n) { w(n.left); ord.push(n.key); w(n.right); } })(tree);
      ordEl.innerHTML = `Обход in-order: <b class="mono">${ord.join(' ')}</b> · высота ${height(tree)} · под узлом — баланс h(лев) − h(прав)`;
    }
    function reset(keys) {
      tree = null; moves = 0;
      keys.forEach(k => { tree = bstInsert(tree, k); });
      say(keys[0] === 4 ? 'Сбалансированное дерево: у всех узлов баланс от −1 до +1.' : 'Вырожденное дерево — по сути список. Красным отмечены узлы, где высоты поддеревьев отличаются больше чем на 1. Нажмите на узел, чтобы поднять его.');
      render();
    }
    reset([1, 2, 3, 4, 5, 6, 7]);
    return {};
  });

  // ---------------------------------------------------------------- plain BST vs AVL / red-black
  function avlInsert(n, k, ev) {
    if (!n) return { key: k, left: null, right: null, h: 1 };
    if (k < n.key) n.left = avlInsert(n.left, k, ev); else n.right = avlInsert(n.right, k, ev);
    const hh = x => (x ? x.h : 0);
    const fix = x => { x.h = 1 + Math.max(hh(x.left), hh(x.right)); return x; };
    const rotR = y => { const x = y.left; y.left = x.right; x.right = y; fix(y); return fix(x); };
    const rotL = x => { const y = x.right; x.right = y.left; y.left = x; fix(x); return fix(y); };
    fix(n);
    const b = hh(n.left) - hh(n.right);
    if (b > 1) {
      if (k > n.left.key) { ev.push(`большой правый у ${n.key}`); n.left = rotL(n.left); } else ev.push(`правый у ${n.key}`);
      return rotR(n);
    }
    if (b < -1) {
      if (k < n.right.key) { ev.push(`большой левый у ${n.key}`); n.right = rotR(n.right); } else ev.push(`левый у ${n.key}`);
      return rotL(n);
    }
    return n;
  }
  function rbTree() {
    let root = null;
    const rot = (x, dir) => { // dir 'L': x.right goes up
      const y = dir === 'L' ? x.right : x.left;
      if (dir === 'L') { x.right = y.left; if (y.left) y.left.p = x; y.left = x; }
      else { x.left = y.right; if (y.right) y.right.p = x; y.right = x; }
      y.p = x.p;
      if (!x.p) root = y; else if (x.p.left === x) x.p.left = y; else x.p.right = y;
      x.p = y;
    };
    return {
      get root() { return root; },
      insert(k, ev) {
        let z = { key: k, left: null, right: null, p: null, red: true };
        let y = null, x = root;
        while (x) { y = x; x = k < x.key ? x.left : x.right; }
        z.p = y;
        if (!y) root = z; else if (k < y.key) y.left = z; else y.right = z;
        while (z.p && z.p.red) {
          const p = z.p, g = p.p, L = p === g.left, u = L ? g.right : g.left;
          if (u && u.red) { p.red = false; u.red = false; g.red = true; ev.push(`перекраска у ${g.key}`); z = g; continue; }
          if (z === (L ? p.right : p.left)) { z = p; rot(z, L ? 'L' : 'R'); ev.push(`${L ? 'левый' : 'правый'} у ${z.key}`); }
          z.p.red = false; z.p.p.red = true;
          ev.push(`${L ? 'правый' : 'левый'} у ${z.p.p.key}`);
          rot(z.p.p, L ? 'R' : 'L');
        }
        root.red = false;
      },
    };
  }

  Deck.demo('balance', root => {
    const MAXK = 24;
    let plain, avl, rb, next, mode = 'avl', random = false, pool = [];
    const lv = h('div', { class: 'tv-host' }), rv = h('div', { class: 'tv-host' });
    const tvL = treeView(lv, { dx: 30, dy: 38, r: 14, font: 12, pad: 16, maxH: 240 });
    const tvR = treeView(rv, { dx: 30, dy: 38, r: 14, font: 12, pad: 16, maxH: 240 });
    const hL = h('b'), hR = h('b'), tR = h('span');
    const modeBtns = [['avl', 'АВЛ'], ['rb', 'Красно-чёрное']].map(([m, name]) => h('button', { class: 'btn small', onclick: () => { mode = m; render(); } }, name));
    const ordBtns = [[false, 'По возрастанию'], [true, 'Случайно']].map(([r, name]) => h('button', { class: 'btn small', onclick: () => { random = r; reset(); } }, name));
    const addBtn = h('button', { class: 'btn small primary', onclick: () => add(1) }, '+1 ключ');
    const add5 = h('button', { class: 'btn small', onclick: () => add(5) }, '+5');
    const log = h('p', { class: 'log' });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label bal-l' }, 'Ключи:'), ordBtns),
      h('div', { class: 'controls' }, h('span', { class: 'label bal-l' }, 'Справа:'), modeBtns),
      h('div', { class: 'bal-panels' },
        h('div', { class: 'bal-p' }, h('div', { class: 'bal-h' }, 'Обычное BST · высота ', hL), lv),
        h('div', { class: 'bal-p' }, h('div', { class: 'bal-h' }, tR, ' · высота ', hR), rv)),
      log,
      h('div', { class: 'controls' }, addBtn, add5, h('button', { class: 'btn small', onclick: reset }, 'Сброс')),
    );
    let lastEv = { avl: [], rb: [] }, n = 0, lastK = null;
    function add(cnt) {
      let k;
      for (let i = 0; i < cnt && n < MAXK; i++) {
        k = random ? pool[n] : next++;
        plain = bstInsert(plain, k);
        lastEv = { avl: [], rb: [] };
        avl = avlInsert(avl, k, lastEv.avl);
        rb.insert(k, lastEv.rb);
        n++;
      }
      lastK = k;
      render();
    }
    function render() {
      const k = lastK;
      modeBtns.forEach(b => b.classList.toggle('sel', b.textContent === (mode === 'avl' ? 'АВЛ' : 'Красно-чёрное')));
      ordBtns.forEach((b, i) => b.classList.toggle('sel', !!i === random));
      tvL.update(layoutBinary(plain, x => ({ id: x.key, label: x.key, cls: x.key === k ? 'new' : '' })));
      const right = mode === 'avl' ? avl : rb.root;
      tvR.update(layoutBinary(right, x => ({ id: x.key, label: x.key, cls: mode === 'rb' ? (x.red ? 'red' : 'black') : x.key === k ? 'new' : '' })));
      const hp = height(plain), hr = height(right);
      hL.textContent = hp; hR.textContent = hr;
      tR.textContent = mode === 'avl' ? 'АВЛ-дерево' : 'Красно-чёрное';
      addBtn.disabled = add5.disabled = n >= MAXK;
      if (!n) { log.innerHTML = 'Нажимайте «+1 ключ»: один и тот же ключ вставляется в оба дерева.'; log.className = 'log'; return; }
      const ev = lastEv[mode];
      const lg = Math.ceil(Math.log2(n + 1));
      log.innerHTML = `Вставлен ${k}. ${n} ${plural(n, ['ключ', 'ключа', 'ключей'])}: обычное BST — высота ${hp}${hp === n && n > 3 ? ' (это список!)' : ''}, ${mode === 'avl' ? 'АВЛ' : 'КЧ'} — ${hr}, минимум ⌈log₂(n+1)⌉ = ${lg}. ` +
        (ev.length ? `Балансировка: ${ev.join(', ')}.` : 'Балансировка не понадобилась.');
      log.className = 'log' + (hp > 2 * hr ? ' warn' : '');
    }
    function reset() {
      plain = null; avl = null; rb = rbTree(); next = 1; n = 0; lastK = null;
      pool = Array.from({ length: 99 }, (_, i) => i + 1).sort(() => Math.random() - 0.5).slice(0, MAXK);
      lastEv = { avl: [], rb: [] };
      render();
    }
    reset();
    add(1);
    return {};
  });

  // ---------------------------------------------------------------- interview: validate BST, k-th smallest, LCA
  Deck.demo('validate', root => {
    const bad = () => N(10, N(5, N(2), N(12)), N(15, N(11), N(20)));
    const good = () => N(10, N(5, N(2), N(7)), N(15, N(11), N(20)));
    const MODES = [
      ['naive', 'Наивная проверка'], ['bounds', 'С границами'], ['kth', 'k-й наименьший (k=3)'], ['lca', 'LCA(11, 20)'],
    ];
    let mode = 'naive', frames = [], fi = 0, t;
    const modeBtns = MODES.map(([m, name]) => h('button', { class: 'btn small', onclick: () => { mode = m; build(); } }, name));
    const view = h('div', { class: 'tv-host' });
    const tv = treeView(view, { dx: 44, dy: 56, maxH: 230 });
    const extra = h('div', { class: 'tr-row' });
    const log = h('p', { class: 'log' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { pl.pause(); step(); } }, 'Шаг');
    const autoBtn = h('button', { class: 'btn', onclick: () => { pl.on ? pl.pause() : (fi >= frames.length - 1 && (fi = 0), pl.play()); syncAuto(); } }, 'Авто');
    root.append(h('div', { class: 'controls' }, modeBtns), view, extra, log,
      h('div', { class: 'controls' }, stepBtn, autoBtn, h('button', { class: 'btn', onclick: () => { pl.pause(); syncAuto(); fi = 0; render(); } }, 'Сначала')));
    const pl = player(() => { if (!step()) { syncAuto(); return false; } }, 900);
    const syncAuto = () => { autoBtn.textContent = pl.on ? 'Пауза' : 'Авто'; };
    const inf = x => (x === -Infinity ? '−∞' : x === Infinity ? '+∞' : x);

    function makeFrames() {
      const fr = [];
      if (mode === 'naive') {
        const st = new Map();
        fr.push({ st: new Map(), msg: 'Проверяем у каждого узла: левый ребёнок меньше, правый больше.' });
        const q = [t];
        while (q.length) {
          const n = q.shift();
          const l = n.left ? `${n.left.key} < ${n.key}` : '', r = n.right ? `${n.right.key} > ${n.key}` : '';
          st.set(n, 'done');
          fr.push({ st: new Map(st), cur: n, msg: l || r ? `Узел ${n.key}: ${[l, r].filter(Boolean).join(', ')} — всё верно.` : `${n.key} — лист, проверять нечего.` });
          q.push(...[n.left, n.right].filter(Boolean));
        }
        fr.push({ st: new Map([...st].map(([k]) => [k, k.key === 12 ? 'bad' : 'done'])), msg: 'Наивная проверка сказала «да», но это не BST: <b>12</b> лежит в левом поддереве 10, а там всё должно быть меньше 10. Поиск 12 пойдёт от 10 направо и не найдёт его.', cls: 'bad' });
        return fr;
      }
      if (mode === 'bounds') {
        const st = new Map(), notes = new Map();
        fr.push({ st: new Map(), notes: new Map(), msg: 'Передаём вниз допустимый интервал (lo, hi). Корень — (−∞, +∞).' });
        let failed = false;
        const rec = (n, lo, hi) => {
          if (!n || failed) return;
          notes.set(n, `(${inf(lo)}, ${inf(hi)})`);
          const ok = lo < n.key && n.key < hi;
          st.set(n, ok ? 'done' : 'bad');
          fr.push({ st: new Map(st), notes: new Map(notes), cur: n, msg: ok ? `${n.key} в интервале (${inf(lo)}, ${inf(hi)}) ✓. Налево пойдёт (${inf(lo)}, ${n.key}), направо — (${n.key}, ${inf(hi)}).` : `${n.key} не в интервале (${inf(lo)}, ${inf(hi)}) — дерево не BST. Ответ False, дальше можно не смотреть.`, cls: ok ? '' : 'bad' });
          if (!ok) { failed = true; return; }
          rec(n.left, lo, n.key);
          rec(n.right, n.key, hi);
        };
        rec(t, -Infinity, Infinity);
        return fr;
      }
      if (mode === 'kth') {
        const stack = [], st = new Map();
        let n = t, cnt = 0;
        fr.push({ st: new Map(), stack: [], msg: 'In-order обход BST даёт ключи по возрастанию. Идём итеративно со стеком и останавливаемся на третьем.' });
        while (n || stack.length) {
          while (n) { stack.push(n); st.set(n, 'onstack'); n = n.left; }
          fr.push({ st: new Map(st), stack: stack.slice(), cur: stack[stack.length - 1], msg: `Спускаемся влево до упора, кладя узлы в стек: ${stack.map(x => x.key).join(', ')}.` });
          n = stack.pop();
          cnt++;
          st.set(n, 'done');
          if (cnt === 3) { st.set(n, 'found'); fr.push({ st: new Map(st), stack: stack.slice(), cur: n, msg: `Снимаем ${n.key} — это ${cnt}-й по счёту. Ответ: <b>${n.key}</b>. Посетили ${st.size} из 7 узлов: O(h + k), а не O(n).`, cls: 'ok' }); break; }
          fr.push({ st: new Map(st), stack: stack.slice(), cur: n, msg: `Снимаем ${n.key} со стека — ${cnt}-й по возрастанию. Переходим в его правое поддерево${n.right ? ` (${n.right.key})` : ' — оно пустое'}.` });
          n = n.right;
        }
        return fr;
      }
      // LCA in BST
      const st = new Map([[t.right.left, 'target'], [t.right.right, 'target']]);
      fr.push({ st: new Map(st), msg: 'Ищем наименьшего общего предка 11 и 20. В BST это узел, где пути к ним расходятся.' });
      let n = t;
      for (;;) {
        st.set(n, 'path');
        if (11 > n.key && 20 > n.key) { fr.push({ st: new Map(st), cur: n, msg: `${n.key}: оба ключа больше — оба справа. Идём направо.` }); n = n.right; continue; }
        if (11 < n.key && 20 < n.key) { fr.push({ st: new Map(st), cur: n, msg: `${n.key}: оба ключа меньше — идём налево.` }); n = n.left; continue; }
        st.set(n, 'found');
        fr.push({ st: new Map(st), cur: n, msg: `${n.key}: 11 слева, 20 справа — пути расходятся. LCA = <b>${n.key}</b>, O(h). В обычном двоичном дереве нужен post-order: узел — ответ, если цели нашлись в обоих поддеревьях.`, cls: 'ok' });
        break;
      }
      return fr;
    }
    function build() {
      pl.pause(); syncAuto();
      modeBtns.forEach((b, i) => b.classList.toggle('sel', MODES[i][0] === mode));
      t = mode === 'naive' || mode === 'bounds' ? bad() : good();
      frames = makeFrames();
      fi = 0;
      render(true);
    }
    function step() {
      if (fi >= frames.length - 1) return false;
      fi++; render();
      return fi < frames.length - 1;
    }
    function render(instant) {
      const f = frames[fi];
      tv.update(layoutBinary(t, n => ({ id: n.key, label: n.key, note: f.notes && f.notes.get(n), cls: (f.cur === n && !['bad', 'found'].includes(f.st.get(n)) ? 'cur ' : '') + (f.st.get(n) || '') })), { instant });
      extra.hidden = mode !== 'kth';
      if (mode === 'kth') extra.innerHTML = '<span class="label tr-l">Стек</span><div class="queue">' + (f.stack.length ? f.stack.map(n => `<span class="val">${n.key}</span>`).join('') + '<span class="more">← вершина</span>' : '<span class="empty">пусто</span>') + '</div>';
      log.innerHTML = `<span class="step-n">${fi}/${frames.length - 1}</span> ${f.msg}`;
      log.className = 'log ' + (f.cls || '');
      stepBtn.disabled = fi >= frames.length - 1;
    }
    build();
    return { stop() { pl.pause(); syncAuto(); } };
  });
})();
