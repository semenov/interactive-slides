// Demos for slides 2–10: recursion tree, tabulation, backtracking, edit distance, LCS/diff, knapsack, coins, LIS.
(() => {
  'use strict';
  const { h, plural } = Deck;
  const fmt = n => n.toLocaleString('ru-RU');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}, text) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
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

  // Auto-play helper: calls step() every `ms` while playing; returns false from step to stop.
  function player(step, btn, ms = 450) {
    let id = 0, active = true;
    const set = on => {
      clearInterval(id); id = 0;
      if (on && active) id = setInterval(() => { if (step() === false) set(false); }, ms);
      btn.textContent = id ? 'Пауза' : 'Пуск';
    };
    btn.addEventListener('click', () => set(!id));
    return {
      playing: () => !!id,
      stop: () => set(false),
      pause() { active = false; clearInterval(id); id = 0; btn.textContent = 'Пуск'; },
      resume() { active = true; },
      setMs(v) { ms = v; if (id) set(true); },
    };
  }

  function slider(label, min, max, value, onInput, fmtOut = v => v) {
    const out = h('output');
    const input = h('input', { type: 'range', min, max, value, 'aria-label': label });
    const set = () => { out.textContent = fmtOut(+input.value); };
    set();
    input.addEventListener('input', () => { set(); onInput(+input.value); });
    const el = h('label', { class: 'slider inline' }, h('span', { class: 'label' }, label), input, out);
    return { el, input, get: () => +input.value };
  }

  // ---------------------------------------------------------------- fib recursion tree
  Deck.demo('calltree', root => {
    let n = 5, memo = false, tree, order, step;
    const svg = s('svg', { class: 'ct-svg', role: 'img', 'aria-label': 'Дерево рекурсивных вызовов' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const stepBtn = h('button', { class: 'btn', onclick: () => { play.stop(); next(); } }, 'Шаг');
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    const memoBox = h('input', { type: 'checkbox' });
    memoBox.addEventListener('change', () => { memo = memoBox.checked; build(); });
    const nSl = slider('n', 2, 7, n, v => { n = v; build(); }, v => 'fib(' + v + ')');
    root.append(
      h('div', { class: 'controls' }, nSl.el, h('label', { class: 'toggle' }, memoBox, 'кэш (@cache)')),
      h('div', { class: 'controls' }, playBtn, stepBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); while (next(true) !== false); render(); finalMsg(); } }, 'Всё сразу'),
        h('button', { class: 'btn', onclick: () => { play.stop(); build(); } }, 'Сброс')),
      svg,
      h('div', { class: 'ct-legend' },
        h('span', null, h('i', { class: 'sw ct-new' }), 'считается впервые'),
        h('span', null, h('i', { class: 'sw ct-rep' }), 'повтор — уже считали'),
        h('span', null, h('i', { class: 'sw ct-hit' }), 'взято из кэша')),
      stats, logEl);
    const play = player(() => next(), playBtn, 380);

    function build() {
      const seen = new Set();
      order = [];
      let leaf = 0;
      const mk = (k, depth, parent) => {
        const node = { k, depth, parent, kids: [], idx: order.length };
        order.push(node);
        if (memo && seen.has(k)) node.kind = 'hit';
        else if (seen.has(k)) node.kind = 'rep';
        else node.kind = 'new';
        if (node.kind !== 'hit' && k >= 2) {
          node.kids.push(mk(k - 1, depth + 1, node));
          node.kids.push(mk(k - 2, depth + 1, node));
        }
        seen.add(k); // the subproblem is solved when its call returns
        if (!node.kids.length) node.x = leaf++;
        else node.x = (node.kids[0].x + node.kids[node.kids.length - 1].x) / 2;
        return node;
      };
      tree = mk(n, 0, null);
      tree.leaves = leaf;
      tree.maxDepth = Math.max(...order.map(o => o.depth));
      step = 0;
      render();
      say(memo
        ? 'С кэшем каждая подзадача считается один раз, повторный вызов сразу возвращает ответ. Нажмите «Пуск».'
        : 'Без кэша fib(' + n + ') вызывает fib(' + (n - 1) + ') и fib(' + (n - 2) + '), а те — снова тех же. Нажмите «Пуск».');
    }

    function next(silent) {
      if (step >= order.length) { return false; }
      const node = order[step++];
      if (!silent) {
        render();
        const path = [];
        for (let p = node; p; p = p.parent) path.unshift('f' + p.k);
        const stack = 'стек: ' + path.join(' → ');
        if (node.kind === 'hit') say(`fib(${node.k}) уже в кэше — ответ без вычислений. ${stack}`, 'ok');
        else if (node.kind === 'rep') say(`fib(${node.k}) уже считали, но без кэша считаем заново. ${stack}`, 'warn');
        else say(`fib(${node.k}) — новая подзадача${node.k < 2 ? ', база: ответ ' + node.k : ''}. ${stack}`);
      }
      if (step >= order.length) {
        if (!silent) finalMsg();
        return false;
      }
    }
    function finalMsg() {
      const reps = order.filter(o => o.kind === 'rep').length;
      if (memo) say(`Готово: ${order.length} ${plural(order.length, ['вызов', 'вызова', 'вызовов'])} вместо ${naive(n)}. Рост линейный: 2n − 1.`, 'ok');
      else say(`Готово: ${order.length} ${plural(order.length, ['вызов', 'вызова', 'вызовов'])}, из них ${reps} — повторы уже решённых подзадач.`, 'warn');
    }

    const fibN = k => { let a = 0, b = 1; for (let i = 0; i < k; i++) [a, b] = [b, a + b]; return a; };
    const naive = k => 2 * fibN(k + 1) - 1;

    function render() {
      const W = 320, H = 40 + tree.maxDepth * 46;
      const r = tree.leaves > 13 ? 9 : 12;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.textContent = '';
      const xs = node => 16 + (tree.leaves > 1 ? node.x / (tree.leaves - 1) : 0.5) * (W - 32);
      const ys = node => 20 + node.depth * 46;
      const cur = order[step - 1];
      const onPath = new Set();
      for (let p = cur; p; p = p.parent) onPath.add(p);
      for (const node of order) {
        for (const kid of node.kids) {
          const shown = kid.idx < step;
          svg.append(s('line', { x1: xs(node), y1: ys(node), x2: xs(kid), y2: ys(kid), class: 'ct-edge' + (shown ? '' : ' off') + (onPath.has(kid) ? ' path' : '') }));
        }
      }
      for (const node of order) {
        const shown = node.idx < step;
        const g = s('g', { class: 'ct-node ' + (shown ? 'ct-' + node.kind : 'off') + (node === cur ? ' cur' : '') + (onPath.has(node) && node !== cur ? ' path' : '') });
        g.append(s('circle', { cx: xs(node), cy: ys(node), r }));
        g.append(s('text', { x: xs(node), y: ys(node) + 4, 'font-size': r > 10 ? 11 : 9 }, String(node.k)));
        svg.append(g);
      }
      const shownN = Math.min(step, order.length);
      const reps = order.slice(0, shownN).filter(o => o.kind === 'rep').length;
      const hits = order.slice(0, shownN).filter(o => o.kind === 'hit').length;
      stats.innerHTML =
        `<div class="stat"><b>${shownN} / ${order.length}</b><span>вызовов</span></div>` +
        (memo ? `<div class="stat"><b>${hits}</b><span>из кэша</span></div>` : `<div class="stat ${reps ? 'warn' : ''}"><b>${reps}</b><span>повторных</span></div>`) +
        `<div class="stat"><b>${memo ? '79' : '331 млн'}</b><span>вызовов для fib(40)</span></div>`;
    }

    build();
    return { stop: () => play.pause(), start: () => play.resume() };
  });

  // ---------------------------------------------------------------- climbing stairs, tabulation
  Deck.demo('stairs', root => {
    let n = 8, steps = [1, 2], dp, i;
    const row = h('div', { class: 'st-row' });
    const roll = h('div', { class: 'st-roll' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    const setBtns = [[1, 2], [1, 2, 3]].map(set => h('button', {
      class: 'btn small', onclick: () => { steps = set; setBtns.forEach(b => b.classList.toggle('sel', b === btnFor(set))); play.stop(); reset(); },
    }, 'шаги ' + set.join(', ')));
    const btnFor = set => setBtns[set.length - 2];
    setBtns[0].classList.add('sel');
    const nSl = slider('ступенек', 3, 12, n, v => { n = v; play.stop(); reset(); });
    root.append(
      h('div', { class: 'controls' }, nSl.el),
      h('div', { class: 'controls' }, ...setBtns),
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); fill(); } }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { play.stop(); reset(); } }, 'Сброс')),
      row, roll, logEl);
    const play = player(() => fill(), playBtn, 600);

    function reset() {
      dp = Array(n + 1).fill(null);
      dp[0] = 1;
      i = 1;
      render([]);
      say(`База: <code>dp[0] = 1</code> — на нулевую ступеньку один способ: никуда не идти. Дальше каждая клетка — сумма ${steps.length === 2 ? 'двух' : 'трёх'} предыдущих.`);
    }
    function fill() {
      if (i > n) return false;
      const src = steps.filter(k => i - k >= 0).map(k => i - k);
      dp[i] = src.reduce((a, j) => a + dp[j], 0);
      say(`<code>dp[${i}] = ${src.map(j => 'dp[' + j + ']').join(' + ')} = ${src.map(j => dp[j]).join(' + ')} = ${dp[i]}</code>` +
        (i === n ? ` — ответ: ${fmt(dp[n])} ${plural(dp[n], ['способ', 'способа', 'способов'])}.` : ''), i === n ? 'ok' : '');
      render(src);
      i++;
      if (i > n) return false;
    }
    function render(src) {
      row.textContent = '';
      for (let k = 0; k <= n; k++) {
        row.append(h('div', { class: 'st-cell' + (dp[k] == null ? ' empty' : '') + (k === i && src.length ? ' cur' : '') + (src.includes(k) ? ' src' : '') },
          h('small', null, k), h('b', null, dp[k] == null ? '·' : dp[k])));
      }
      const last = steps.length;
      const filled = dp.map((v, k) => [k, v]).filter(([, v]) => v != null);
      const vars = filled.slice(-last).map(([k, v]) => `<span><small>dp[${k}]</small>${v}</span>`).join('');
      roll.innerHTML = `<span class="label">память при «катящихся» переменных:</span> ${vars}`;
    }
    reset();
    return { stop: () => play.pause(), start: () => play.resume() };
  });

  // ---------------------------------------------------------------- N queens backtracking
  Deck.demo('queens', root => {
    let N = 6, prune = true, board, visited, solutions, conflict, done;
    const grid = h('div', { class: 'qn-board' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    const nBtns = [4, 5, 6, 7, 8].map(k => h('button', { class: 'btn small' + (k === N ? ' sel' : ''), onclick: () => { N = k; nBtns.forEach(b => b.classList.toggle('sel', b.textContent === k + '×' + k)); play.stop(); reset(); } }, k + '×' + k));
    const pruneBox = h('input', { type: 'checkbox', checked: true });
    pruneBox.addEventListener('change', () => { prune = pruneBox.checked; play.stop(); reset(); });
    root.append(
      h('div', { class: 'controls' }, ...nBtns),
      h('label', { class: 'toggle' }, pruneBox, 'отсекать конфликт сразу, а не на полной доске'),
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); tick(); } }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { play.stop(); runToSolution(); } }, 'До решения'),
        h('button', { class: 'btn', onclick: () => { play.stop(); reset(); } }, 'Сброс')),
      h('div', { class: 'qn-wrap' }, grid, stats), logEl);
    const play = player(() => tick(), playBtn, 160);

    const attacks = (cols, r, c) => cols.some((cc, rr) => rr < r && (cc === c || Math.abs(cc - c) === r - rr));
    const validAll = cols => cols.every((c, r) => !attacks(cols, r, c));

    // Explicit DFS stack instead of a generator: the unpruned 8×8 run visits ~1.5M positions.
    let nextCol, leafDone;
    function nextEvent() {
      for (;;) {
        const r = board.length;
        if (r === N) {
          if (!leafDone) { leafDone = true; return prune || validAll(board) ? { type: 'solution' } : { type: 'bad' }; }
          leafDone = false; board.pop(); nextCol.pop(); continue;
        }
        const c = nextCol[r];
        if (c >= N) { if (r === 0) return null; board.pop(); nextCol.pop(); continue; }
        nextCol[r] = c + 1;
        visited++;
        if (prune && attacks(board, r, c)) return { type: 'conflict', r, c };
        board.push(c); nextCol.push(0);
        return { type: 'place', r, c };
      }
    }

    function reset() {
      board = [];
      visited = 0; solutions = 0; conflict = null; done = false;
      nextCol = [0]; leafDone = false;
      render();
      say(prune
        ? 'Ставим ферзя в каждую строку по очереди. Если клетка под боем — ветку не продолжаем. Нажмите «Пуск».'
        : 'Без отсечения расставляем всех ферзей вслепую и проверяем только полную доску. Нажмите «До решения» и сравните счётчик.');
    }
    function tick(silent) {
      if (done) return false;
      const e = nextEvent();
      if (!e) {
        done = true;
        if (!silent) { render(); say(`Перебор закончен: ${fmt(visited)} ${plural(visited, ['позиция', 'позиции', 'позиций'])}, ${solutions} ${plural(solutions, ['решение', 'решения', 'решений'])}.`, 'ok'); }
        return false;
      }
      conflict = e.type === 'conflict' ? e : null;
      if (e.type === 'solution') solutions++;
      if (!silent) {
        render();
        if (e.type === 'conflict') say(`Строка ${e.r + 1}, столбец ${e.c + 1}: клетка под боем — отсекаем, поддерево не строим.`, 'warn');
        else if (e.type === 'place') say(`Ставим ферзя в строку ${e.r + 1}, столбец ${e.c + 1}.`);
        else if (e.type === 'solution') say(`Решение №${solutions}! Возвращаемся назад и ищем следующее.`, 'ok');
        else if (e.type === 'bad') say('Доска заполнена, но ферзи бьют друг друга — назад.', 'warn');
      }
      return e;
    }
    function runToSolution() {
      const before = solutions;
      let guard = 0;
      while (!done && solutions === before && guard++ < 3e7) tick(true);
      render();
      if (solutions > before) say(`Решение №${solutions}: проверено ${fmt(visited)} ${plural(visited, ['позиция', 'позиции', 'позиций'])}.` + (prune ? '' : ' Включите отсечение и сравните.'), 'ok');
      else if (done) say(`Решений больше нет. Всего проверено ${fmt(visited)} ${plural(visited, ['позиция', 'позиции', 'позиций'])}, найдено ${solutions}.`, 'ok');
    }
    function render() {
      grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
      grid.style.fontSize = (N <= 5 ? 2 : N === 6 ? 1.75 : N === 7 ? 1.55 : 1.4) + 'em';
      grid.textContent = '';
      const cols = board;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        let cls = 'qn-cell' + ((r + c) % 2 ? ' dark' : '');
        const q = cols[r] === c;
        if (!q && r === cols.length && prune && attacks(cols, r, c)) cls += ' hit';
        if (conflict && conflict.r === r && conflict.c === c) cls += ' bad';
        grid.append(h('div', { class: cls }, q ? h('i', { class: 'qn-q', 'aria-label': 'ферзь' }) : conflict && conflict.r === r && conflict.c === c ? '×' : ''));
      }
      const leaves = Math.pow(N, N);
      stats.innerHTML =
        `<div class="stat"><b>${fmt(visited)}</b><span>проверено позиций</span></div>` +
        `<div class="stat"><b>${solutions}</b><span>решений</span></div>` +
        `<div class="stat"><b>${fmt(leaves)}</b><span>расстановок без отсечения (N<sup>N</sup>)</span></div>`;
    }
    reset();
    return { stop: () => play.pause(), start: () => play.resume() };
  });

  // ---------------------------------------------------------------- edit distance (Levenshtein)
  Deck.demo('editdist', root => {
    const PRESETS = [['kitten', 'sitting'], ['ашипка', 'ошибка'], ['интернет', 'интренет'], ['sunday', 'saturday']];
    let a, b, dp, cell, path;
    const inA = h('input', { class: 'txt-in', maxlength: 8, 'aria-label': 'Первое слово' });
    const inB = h('input', { class: 'txt-in', maxlength: 8, 'aria-label': 'Второе слово' });
    const table = h('div', { class: 'dp-table' });
    const ops = h('div', { class: 'ed-ops' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    const pathBtn = h('button', { class: 'btn', onclick: () => { play.stop(); while (fill(true) !== false); showPath(); } }, 'Путь правок');
    const presetBtns = PRESETS.map(([x, y]) => h('button', { class: 'btn small', onclick: () => { inA.value = x; inB.value = y; play.stop(); load(); } }, x + '→' + y));
    [inA, inB].forEach(el => el.addEventListener('input', () => { play.stop(); load(); }));
    root.append(
      h('div', { class: 'controls' }, ...presetBtns),
      h('div', { class: 'controls' }, inA, h('span', { class: 'label' }, '→'), inB),
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); fill(); } }, 'Шаг'), pathBtn),
      h('div', { class: 'dp-scroll no-swipe' }, table), ops, logEl);
    const play = player(() => fill(), playBtn, 140);

    function load() {
      a = [...inA.value.trim().toLowerCase()].slice(0, 8);
      b = [...inB.value.trim().toLowerCase()].slice(0, 8);
      dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : null)));
      cell = [1, 1];
      path = null;
      ops.textContent = '';
      render();
      say('База: первая строка и столбец — расстояние до пустой строки (вставить или удалить всё). Нажмите «Пуск».');
    }
    function fill(silent) {
      const [i, j] = cell;
      if (i > a.length || !b.length) {
        if (!silent && !path) showPath();
        return false;
      }
      const same = a[i - 1] === b[j - 1];
      const del = dp[i - 1][j] + 1, ins = dp[i][j - 1] + 1, rep = dp[i - 1][j - 1] + (same ? 0 : 1);
      dp[i][j] = Math.min(del, ins, rep);
      if (!silent) {
        render([i, j]);
        say(same
          ? `«${a[i - 1]}» = «${b[j - 1]}»: берём диагональ без штрафа — <b>${dp[i][j]}</b>.`
          : `«${a[i - 1]}» ≠ «${b[j - 1]}»: 1 + min(заменить ${dp[i - 1][j - 1]}, удалить ${dp[i - 1][j]}, вставить ${dp[i][j - 1]}) = <b>${dp[i][j]}</b>.`);
      }
      cell = j < b.length ? [i, j + 1] : [i + 1, 1];
    }
    function showPath() {
      if (!a.length || !b.length) { say('Введите оба слова.'); return; }
      let i = a.length, j = b.length;
      path = new Set([i + ',' + j]);
      const steps = [];
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { steps.unshift(['eq', a[i - 1]]); i--; j--; }
        else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { steps.unshift(['rep', a[i - 1] + '→' + b[j - 1]]); i--; j--; }
        else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { steps.unshift(['del', a[i - 1]]); i--; }
        else { steps.unshift(['ins', b[j - 1]]); j--; }
        path.add(i + ',' + j);
      }
      render();
      const LBL = { eq: '', rep: 'замена', del: 'удалить', ins: 'вставить' };
      ops.innerHTML = steps.map(([t, v]) => `<span class="op ${t}" title="${LBL[t]}">${v}</span>`).join('');
      const d = dp[a.length][b.length];
      say(`Расстояние ${d}: идём из правого нижнего угла туда, откуда пришёл минимум. Диагональ — совпадение или замена, вверх — удаление, влево — вставка.`, 'ok');
    }
    function render(cur) {
      table.style.gridTemplateColumns = `repeat(${b.length + 2}, minmax(0, 1fr))`;
      table.textContent = '';
      table.append(h('span', { class: 'hd' }), h('span', { class: 'hd' }, 'ε'), ...b.map((ch, j) => h('span', { class: 'hd' + (cur && cur[1] === j + 1 ? ' on' : '') }, ch)));
      for (let i = 0; i <= a.length; i++) {
        table.append(h('span', { class: 'hd' + (cur && i === cur[0] ? ' on' : '') }, i ? a[i - 1] : 'ε'));
        for (let j = 0; j <= b.length; j++) {
          let cls = 'c';
          if (dp[i][j] == null) cls += ' empty';
          if (cur && i === cur[0] && j === cur[1]) cls += ' cur';
          else if (cur && ((i === cur[0] - 1 && j === cur[1] - 1) || (i === cur[0] - 1 && j === cur[1]) || (i === cur[0] && j === cur[1] - 1))) cls += ' src';
          if (path && path.has(i + ',' + j)) cls += ' path';
          table.append(h('span', { class: cls }, dp[i][j] == null ? '' : dp[i][j]));
        }
      }
    }
    inA.value = 'kitten'; inB.value = 'sitting';
    load();
    return { stop: () => play.pause(), start: () => play.resume() };
  });

  // ---------------------------------------------------------------- LCS -> diff
  Deck.demo('lcsdiff', root => {
    const PRESETS = [
      ['Функция', [
        'def total(items):', '    s = 0', '    for x in items:', '        s += x.price', '    return s',
      ], [
        'def total(items, tax):', '    s = 0', '    for x in items:', '        s += x.price', '    s *= 1 + tax', '    return s',
      ]],
      ['Список', ['import os', 'import sys', 'import json', 'import re', 'import time'],
        ['import json', 'import os', 'import re', 'import sys', 'import time', 'import typing']],
    ];
    let A, B, dp, cell, done;
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const files = h('div', { class: 'lc-files' });
    const table = h('div', { class: 'dp-table small' });
    const diff = h('pre', { class: 'lc-diff' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    const pBtns = PRESETS.map((p, k) => h('button', { class: 'btn small' + (k ? '' : ' sel'), onclick: () => { pBtns.forEach(x => x.classList.toggle('sel', x === pBtns[k])); play.stop(); load(p); } }, p[0]));
    root.append(
      h('div', { class: 'controls' }, ...pBtns, playBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); while (fill(true) !== false); showDiff(); } }, 'Diff')),
      files,
      h('div', { class: 'lc-bottom' }, h('div', { class: 'dp-scroll no-swipe' }, table), diff), logEl);
    const play = player(() => fill(), playBtn, 160);

    function load(p) {
      const ids = new Map();
      const id = line => { if (!ids.has(line)) ids.set(line, L[ids.size]); return ids.get(line); };
      A = p[1].map(t => ({ t, id: id(t) }));
      B = p[2].map(t => ({ t, id: id(t) }));
      dp = Array.from({ length: A.length + 1 }, (_, i) => Array.from({ length: B.length + 1 }, (_, j) => (i && j ? null : 0)));
      cell = [1, 1];
      done = false;
      files.innerHTML = ['было', 'стало'].map((name, k) =>
        `<div class="lc-file"><span class="label">${name}</span>${(k ? B : A).map(l => `<div><i>${l.id}</i><code>${l.t.replace(/ /g, ' ')}</code></div>`).join('')}</div>`).join('');
      diff.textContent = '';
      render();
      say('Каждой разной строке дали букву. Строим таблицу LCS по буквам: совпали — диагональ + 1, иначе максимум сверху и слева.');
    }
    function fill(silent) {
      const [i, j] = cell;
      if (i > A.length) { if (!silent && !done) showDiff(); return false; }
      const same = A[i - 1].id === B[j - 1].id;
      dp[i][j] = same ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      if (!silent) {
        render([i, j]);
        say(same ? `${A[i - 1].id} = ${B[j - 1].id}: строка общая, диагональ + 1 = <b>${dp[i][j]}</b>.` : `${A[i - 1].id} ≠ ${B[j - 1].id}: max(сверху ${dp[i - 1][j]}, слева ${dp[i][j - 1]}) = <b>${dp[i][j]}</b>.`);
      }
      cell = j < B.length ? [i, j + 1] : [i + 1, 1];
    }
    function showDiff() {
      done = true;
      let i = A.length, j = B.length;
      const out = [], path = new Set([i + ',' + j]);
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && A[i - 1].id === B[j - 1].id) { out.unshift([' ', A[i - 1].t]); i--; j--; }
        else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { out.unshift(['+', B[j - 1].t]); j--; }
        else { out.unshift(['-', A[i - 1].t]); i--; }
        path.add(i + ',' + j);
      }
      render(null, path);
      diff.innerHTML = out.map(([m, t]) => `<span class="${m === '+' ? 'add' : m === '-' ? 'del' : ''}">${m} ${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('');
      const k = dp[A.length][B.length];
      say(`LCS = ${k} ${plural(k, ['строка', 'строки', 'строк'])}: они остаются, остальное — удаления и вставки. Перестановку строк diff видит как «удалить здесь, вставить там».`, 'ok');
    }
    function render(cur, path) {
      table.style.gridTemplateColumns = `repeat(${B.length + 2}, minmax(0, 1fr))`;
      table.textContent = '';
      table.append(h('span', { class: 'hd' }), h('span', { class: 'hd' }, 'ε'), ...B.map((l, j) => h('span', { class: 'hd' + (cur && cur[1] === j + 1 ? ' on' : '') }, l.id)));
      for (let i = 0; i <= A.length; i++) {
        table.append(h('span', { class: 'hd' + (cur && cur[0] === i ? ' on' : '') }, i ? A[i - 1].id : 'ε'));
        for (let j = 0; j <= B.length; j++) {
          let cls = 'c';
          if (dp[i][j] == null) cls += ' empty';
          if (cur && i === cur[0] && j === cur[1]) cls += ' cur';
          if (path && path.has(i + ',' + j)) cls += ' path';
          if (i && j && A[i - 1].id === B[j - 1].id) cls += ' eq';
          table.append(h('span', { class: cls }, dp[i][j] == null ? '' : dp[i][j]));
        }
      }
    }
    load(PRESETS[0]);
    return { stop: () => play.pause(), start: () => play.resume() };
  });

  // ---------------------------------------------------------------- 0/1 knapsack
  Deck.demo('knapsack', root => {
    const ITEMS = [
      { name: 'A', w: 5, v: 20 }, { name: 'B', w: 5, v: 20 }, { name: 'C', w: 6, v: 30 }, { name: 'D', w: 3, v: 9 },
    ];
    let W = 10, dp, row, taken;
    const items = h('div', { class: 'ks-items' });
    const table = h('div', { class: 'dp-table small' });
    const res = h('div', { class: 'ks-res' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const cap = slider('вместимость W', 4, 12, W, v => { W = v; reset(); });
    root.append(
      items, cap.el,
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: () => step() }, 'Следующий предмет'),
        h('button', { class: 'btn', onclick: () => { while (step(true) !== false); finish(); } }, 'Всё сразу'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('div', { class: 'dp-scroll no-swipe' }, table), res, logEl);

    function reset() {
      dp = [Array(W + 1).fill(0)];
      row = 1; taken = null;
      res.textContent = '';
      render();
      say('Строка 0 — ни одного предмета, ценность 0. Каждая следующая строка добавляет один предмет: для каждого w решаем, брать его или нет.');
    }
    function step(silent) {
      if (row > ITEMS.length) { if (!silent) finish(); return false; }
      const it = ITEMS[row - 1], prev = dp[row - 1];
      dp[row] = prev.map((x, w) => (w >= it.w ? Math.max(x, prev[w - it.w] + it.v) : x));
      if (!silent) {
        const gain = dp[row].filter((x, w) => x !== prev[w]).length;
        render(row);
        say(`Предмет ${it.name} (вес ${it.w}, ценность ${it.v}): <code>dp[${row}][w] = max(dp[${row - 1}][w], dp[${row - 1}][w−${it.w}] + ${it.v})</code>. Взять выгоднее в ${gain} ${plural(gain, ['клетке', 'клетках', 'клетках'])}.`);
      }
      row++;
      if (row > ITEMS.length && !silent) finish();
    }
    function finish() {
      taken = new Set();
      let w = W;
      for (let i = ITEMS.length; i > 0; i--) {
        if (dp[i][w] !== dp[i - 1][w]) { taken.add(i - 1); w -= ITEMS[i - 1].w; }
      }
      render();
      // greedy by value/weight ratio
      const order = ITEMS.map((it, k) => k).sort((x, y) => ITEMS[y].v / ITEMS[y].w - ITEMS[x].v / ITEMS[x].w);
      let left = W, gv = 0;
      const g = [];
      for (const k of order) if (ITEMS[k].w <= left) { left -= ITEMS[k].w; gv += ITEMS[k].v; g.push(ITEMS[k].name); }
      const best = dp[ITEMS.length][W];
      const pick = [...taken].sort().map(k => ITEMS[k].name);
      res.innerHTML = `<div><span class="label">ДП</span> <b>${pick.join(' + ') || '—'}</b> = ${best}</div><div class="${gv < best ? 'bad' : ''}"><span class="label">жадно по ценности/весу</span> <b>${g.join(' + ') || '—'}</b> = ${gv}</div>`;
      say(gv < best
        ? `Ответ ${best} — в правом нижнем углу. Обратный ход: где значение изменилось по сравнению со строкой выше, предмет взят. Жадный выбор взял самый «плотный» C и оставил пустое место.`
        : `Ответ ${best}. При W = ${W} жадный выбор случайно совпал с оптимумом — попробуйте W = 10.`, gv < best ? 'warn' : 'ok');
    }
    function render(cur) {
      items.innerHTML = ITEMS.map((it, k) => `<span class="ks-item${taken && taken.has(k) ? ' on' : ''}${cur === k + 1 ? ' cur' : ''}"><b>${it.name}</b> вес ${it.w} · ${it.v}</span>`).join('');
      table.style.gridTemplateColumns = `auto repeat(${W + 1}, minmax(0, 1fr))`;
      table.textContent = '';
      table.append(h('span', { class: 'hd' }, 'w'), ...Array.from({ length: W + 1 }, (_, w) => h('span', { class: 'hd' }, w)));
      let tw = W;
      const path = new Set();
      if (taken) for (let i = ITEMS.length; i >= 0; i--) { path.add(i + ',' + tw); if (i && taken.has(i - 1)) tw -= ITEMS[i - 1].w; }
      for (let i = 0; i <= ITEMS.length; i++) {
        table.append(h('span', { class: 'hd' + (cur === i ? ' on' : '') }, i ? ITEMS[i - 1].name : '∅'));
        for (let w = 0; w <= W; w++) {
          const v = dp[i] ? dp[i][w] : null;
          let cls = 'c' + (v == null ? ' empty' : '');
          if (cur === i && dp[i - 1] && v !== dp[i - 1][w]) cls += ' up';
          if (path.has(i + ',' + w)) cls += ' path';
          table.append(h('span', { class: cls }, v == null ? '' : v));
        }
      }
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- coin change: greedy vs DP
  Deck.demo('coins', root => {
    const SETS = [[1, 2, 5, 10], [1, 5, 10, 25], [1, 3, 4], [1, 7, 10], [3, 5]];
    let coins = SETS[2], amount = 6;
    const greedyEl = h('div', { class: 'cn-line' });
    const dpEl = h('div', { class: 'cn-line' });
    const waysEl = h('div', { class: 'cn-extra' });
    const arr = h('div', { class: 'cn-arr' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const sBtns = SETS.map(set => h('button', { class: 'btn small' + (set === coins ? ' sel' : ''), onclick: () => { coins = set; sBtns.forEach(b => b.classList.toggle('sel', b === sBtns[SETS.indexOf(set)])); update(); } }, set.join(', ')));
    const am = slider('сумма', 1, 30, amount, v => { amount = v; update(); });
    root.append(h('div', { class: 'controls' }, h('span', { class: 'label' }, 'номиналы:'), ...sBtns), am.el, greedyEl, dpEl, waysEl, arr, logEl);

    function solve(target) {
      const best = Array(target + 1).fill(Infinity), from = Array(target + 1).fill(0);
      best[0] = 0;
      for (let x = 1; x <= target; x++) for (const c of coins) if (c <= x && best[x - c] + 1 < best[x]) { best[x] = best[x - c] + 1; from[x] = c; }
      return { best, from };
    }
    function greedy(x) {
      const out = [];
      for (const c of [...coins].sort((p, q) => q - p)) while (c <= x) { out.push(c); x -= c; }
      return x ? null : out;
    }
    const chips = list => list.map(c => `<span class="coin">${c}</span>`).join('');
    function update() {
      const { best, from } = solve(Math.max(amount, 100));
      const g = greedy(amount);
      const d = [];
      if (best[amount] < Infinity) for (let x = amount; x > 0; x -= from[x]) d.push(from[x]);
      greedyEl.innerHTML = `<span class="label">жадно</span>${g ? chips(g) + `<b>${g.length}</b>` : '<span class="bad">не набирается: остаток не разменять</span>'}`;
      greedyEl.className = 'cn-line' + (!g || g.length > d.length ? ' worse' : '');
      dpEl.innerHTML = `<span class="label">ДП</span>${d.length ? chips(d) + `<b>${d.length}</b>` : '<span class="bad">сумму набрать нельзя</span>'}`;
      const ways = Array(amount + 1).fill(0); ways[0] = 1;
      for (const c of coins) for (let x = c; x <= amount; x++) ways[x] += ways[x - c];
      waysEl.innerHTML = `Способов набрать ${amount}: <b>${fmt(ways[amount])}</b> · можно ли набрать: <b>${best[amount] < Infinity ? 'да' : 'нет'}</b>`;
      arr.innerHTML = `<span class="label">dp[s] — минимум монет для суммы s</span><div>${best.slice(0, amount + 1).map((v, x) =>
        `<span class="${x === amount ? 'cur' : ''}${v === Infinity ? ' inf' : ''}"><small>${x}</small>${v === Infinity ? '∞' : v}</span>`).join('')}</div>`;
      let first = 0;
      for (let x = 1; x <= 100 && !first; x++) { const gg = greedy(x); if (best[x] < Infinity && (!gg || gg.length > best[x])) first = x; }
      const verdict = first ? `Для номиналов ${coins.join(', ')} жадность ошибается, первый контрпример — сумма ${first}.` : `Номиналы ${coins.join(', ')} канонические: до 100 жадный ответ всегда совпадает с ДП.`;
      logEl.className = 'log ' + (!g || (d.length && g.length > d.length) ? 'warn' : first ? '' : 'ok');
      logEl.innerHTML = (g && g.length === d.length ? 'Здесь жадный ответ оптимален. ' : !d.length ? '' : !g ? `Жадный выбор застрял с остатком, который нечем разменять, а ДП нашёл ${d.length} ${plural(d.length, ['монету', 'монеты', 'монет'])}. ` : `Жадный выбор взял крупную монету и проиграл: ${g.length} против ${d.length}. `) + verdict;
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- LIS via patience sorting
  Deck.demo('lis', root => {
    let a, k, tails, tailIdx, prev, lastPos;
    const arrEl = h('div', { class: 'ls-arr' });
    const pilesEl = h('div', { class: 'ls-tails' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    const playBtn = h('button', { class: 'btn primary' }, 'Пуск');
    root.append(
      h('div', { class: 'controls' }, playBtn,
        h('button', { class: 'btn', onclick: () => { play.stop(); step(); } }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { play.stop(); random(); } }, 'Новый массив')),
      h('span', { class: 'label' }, 'массив'), arrEl,
      h('span', { class: 'label' }, 'tails[k] — минимальный конец цепочки длины k+1'), pilesEl, logEl);
    const play = player(() => step(), playBtn, 800);

    function random() {
      a = [];
      for (let i = 0; i < 10; i++) a.push(1 + Math.floor(Math.random() * 30));
      reset();
    }
    function reset() {
      k = 0; tails = []; tailIdx = []; prev = Array(a.length).fill(-1); lastPos = -1;
      render();
      say('Идём по массиву слева направо. Для каждого числа бинарный поиск по tails: заменить первый элемент ≥ x или дописать в конец.');
    }
    function step() {
      if (k >= a.length) return false;
      const x = a[k];
      let lo = 0, hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < x) lo = m + 1; else hi = m; }
      const was = tails[lo];
      prev[k] = lo ? tailIdx[lo - 1] : -1;
      tails[lo] = x; tailIdx[lo] = k; lastPos = lo;
      k++;
      render();
      if (lo === tails.length - 1 && was === undefined) say(`${x} больше всех концов — цепочка удлинилась до ${tails.length}.`);
      else say(`${x}: бинарный поиск → позиция ${lo}. Заменяем ${was} на ${x}: цепочка длины ${lo + 1} теперь кончается меньшим числом, и её легче продолжить.`);
      if (k >= a.length) {
        say(`Готово: длина LIS = ${tails.length}. Сама подпоследовательность — по ссылкам на предыдущий элемент (подсвечена). Заметьте: tails — не обязательно сама LIS.`, 'ok');
        return false;
      }
    }
    function render() {
      const inLis = new Set();
      if (k >= a.length && tails.length) for (let i = tailIdx[tails.length - 1]; i >= 0; i = prev[i]) inLis.add(i);
      arrEl.innerHTML = a.map((x, i) => `<span class="${i === k - 1 ? 'cur' : ''}${i >= k ? ' todo' : ''}${inLis.has(i) ? ' lis' : ''}">${x}</span>`).join('');
      pilesEl.innerHTML = tails.length ? tails.map((x, i) => `<span class="${i === lastPos ? 'cur' : ''}"><small>${i}</small>${x}</span>`).join('') : '<span class="empty">пусто</span>';
    }
    a = [10, 9, 2, 5, 3, 7, 101, 18, 4, 20];
    reset();
    return { stop: () => play.pause(), start: () => play.resume() };
  });
})();
