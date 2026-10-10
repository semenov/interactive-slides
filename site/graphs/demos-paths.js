// Demos for slides 10–16: Dijkstra, negative weights / Bellman–Ford, A*, union-find, Kruskal, bipartite check.
(() => {
  'use strict';
  const { h, plural, rafLoop } = Deck;
  const { logger, graphView, makeGrid, PALETTE } = window.GK;
  const INF = Infinity;
  const fmtD = d => d === INF ? '∞' : String(d).replace('-', '−');

  // ---------------------------------------------------------------- Dijkstra step by step
  Deck.demo('dijkstra', root => {
    const NODES = [{ id: 'A', x: 35, y: 125 }, { id: 'B', x: 150, y: 40 }, { id: 'C', x: 150, y: 205 },
      { id: 'D', x: 270, y: 40 }, { id: 'E', x: 270, y: 205 }, { id: 'F', x: 370, y: 125 }];
    const EDGES = [['A', 'B', 4], ['A', 'C', 1], ['B', 'C', 2], ['B', 'D', 5], ['C', 'E', 8], ['C', 'D', 9, 0.3],
      ['B', 'E', 10, 0.3], ['D', 'E', 2], ['D', 'F', 6], ['E', 'F', 3]];
    let dist, prev, heap, done, phase, u, relaxQ, hot, finished, stats, pathTo, auto = false, acc = 0;
    const gv = graphView({ w: 400, h: 250, nodes: NODES, edges: EDGES.map(([a, b, w, t]) => ({ u: a, v: b, w, t })), onNode: id => showPath(id) });
    const runBtn = h('button', { class: 'btn', onclick: () => { if (finished) reset(); auto = !auto; syncRun(); } }, 'Пуск');
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn primary', onclick: () => { auto = false; syncRun(); step(); } }, 'Шаг'), runBtn,
      h('button', { class: 'btn', onclick: reset }, 'Сброс')), gv.svg);
    const heapEl = h('div', { class: 'chips' });
    const statsEl = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'Куча (d, v)'), heapEl), statsEl, logEl);

    const nbrs = x => EDGES.map((e, i) => [e, i]).filter(([e]) => e[0] === x || e[1] === x)
      .map(([e, i]) => [e[0] === x ? e[1] : e[0], e[2], i]).sort((a, b) => a[0] < b[0] ? -1 : 1);
    const cmp = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1);
    function reset() {
      dist = {}; prev = {}; done = new Set();
      NODES.forEach(n => { dist[n.id] = INF; });
      dist.A = 0; heap = [[0, 'A']]; phase = 'pop'; u = null; relaxQ = []; hot = -1; finished = false; pathTo = null; auto = false;
      stats = { pops: 0, relax: 0, stale: 0 };
      syncRun();
      say('Источник — A, расстояние 0, в куче одна запись (0, A). Остальные — ∞.');
      render();
    }
    function step() {
      if (finished) return;
      hot = -1;
      if (phase === 'relax' && relaxQ.length) {
        const [v, w, i] = relaxQ.shift();
        hot = i;
        stats.relax++;
        const nd = dist[u] + w;
        if (nd < dist[v]) {
          const old = dist[v];
          dist[v] = nd; prev[v] = i;
          heap.push([nd, v]); heap.sort(cmp);
          say(`Ребро ${u}–${v}: ${dist[u]} + ${w} = ${nd} &lt; ${fmtD(old)} — улучшили. dist[${v}] = ${nd}, кладём (${nd}, ${v}) в кучу${old !== INF ? '; старая запись остаётся и устареет' : ''}.`);
        } else {
          say(`Ребро ${u}–${v}: ${dist[u]} + ${w} = ${nd} ≥ ${dist[v]} — не лучше, ничего не меняем.`);
        }
        if (!relaxQ.length) phase = 'pop';
        return render();
      }
      if (!heap.length) {
        finished = true; auto = false; syncRun();
        say('Куча пуста — все расстояния окончательные. Синие рёбра — дерево кратчайших путей. Нажмите на вершину, чтобы увидеть путь до неё.', 'ok');
        return render();
      }
      const [d, x] = heap.shift();
      if (d > dist[x] || done.has(x)) {
        stats.stale++;
        say(`Достали (${d}, ${x}), но dist[${x}] = ${dist[x]} &lt; ${d}: запись устарела, пропускаем.`);
        return render();
      }
      stats.pops++;
      u = x; done.add(x);
      relaxQ = nbrs(x).filter(([v]) => !done.has(v));
      phase = relaxQ.length ? 'relax' : 'pop';
      say(`Достали минимум (${d}, ${x}). Меньше ${d} в куче ничего нет, а веса неотрицательны — значит, расстояние до ${x} окончательное. ${relaxQ.length ? 'Релаксируем рёбра к непройденным соседям.' : 'Непройденных соседей нет.'}`);
      render();
    }
    function showPath(id) {
      if (!finished) return;
      pathTo = id;
      const nodes = [];
      for (let x = id; x; x = prev[x] != null ? (EDGES[prev[x]][0] === x ? EDGES[prev[x]][1] : EDGES[prev[x]][0]) : null) nodes.unshift(x);
      say(`Путь A → ${id}: <b>${nodes.join(' → ')}</b>, длина ${dist[id]}.`, 'ok');
      render();
    }
    function render() {
      const onPath = new Set();
      if (pathTo) for (let x = pathTo; prev[x] != null; x = EDGES[prev[x]][0] === x ? EDGES[prev[x]][1] : EDGES[prev[x]][0]) onPath.add(prev[x]);
      const tree = new Set(Object.values(prev));
      NODES.forEach(n => {
        gv.setNode(n.id, (done.has(n.id) ? 'done' : heap.some(e => e[1] === n.id) ? 'front' : '') + (n.id === u && !finished ? ' cur' : ''));
        gv.setSub(n.id, fmtD(dist[n.id]));
      });
      EDGES.forEach((e, i) => gv.setEdge(i, i === hot ? 'hot' : (pathTo ? onPath.has(i) : tree.has(i)) ? 'tree' : pathTo ? 'dim' : ''));
      heapEl.innerHTML = heap.length ? heap.map((e, i) => `<span class="chip${i === 0 ? ' top' : ''}${e[0] > dist[e[1]] ? ' stale' : ''}">(${e[0]}, ${e[1]})</span>`).join('') : '<span class="empty">пусто</span>';
      statsEl.innerHTML = `<div class="stat"><b>${stats.pops}</b><span>извлечений</span></div><div class="stat"><b>${stats.relax}</b><span>релаксаций</span></div><div class="stat"><b>${stats.stale}</b><span>устаревших записей</span></div>`;
    }
    function syncRun() { runBtn.textContent = auto ? 'Пауза' : 'Пуск'; }
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt * 1.4;
      while (acc >= 1 && auto) { acc--; step(); }
    });
    reset();
    return { start: loop.start, stop() { loop.stop(); auto = false; syncRun(); } };
  });

  // ---------------------------------------------------------------- negative weights: Dijkstra vs Bellman–Ford
  Deck.demo('negative', root => {
    const NODES = [{ id: 'S', x: 35, y: 125 }, { id: 'A', x: 160, y: 40 }, { id: 'B', x: 160, y: 210 },
      { id: 'C', x: 280, y: 40 }, { id: 'T', x: 370, y: 125 }];
    // Bellman–Ford goes through the edges in this (deliberately unlucky) order
    const EDGES = [['C', 'T', 1], ['A', 'C', 2], ['B', 'A', -4], ['S', 'B', 5], ['S', 'A', 2], ['B', 'T', 6], ['A', 'B', 1]];
    const EXTRA = EDGES.length - 1;
    const gv = graphView({ w: 400, h: 250, directed: true, nodes: NODES, edges: EDGES.map(([u, v, w]) => ({ u, v, w })) });
    let mode = 'dij';
    const modeBtns = [['dij', 'Дейкстра'], ['bf', 'Беллман–Форд']].map(([m, label]) => h('button', { class: 'btn small', onclick: () => { mode = m; reset(); } }, label));
    const extra = h('input', { type: 'checkbox', onchange: reset });
    root.append(
      h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Алгоритм:'), ...modeBtns),
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: step }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { let g = 0; while (step() && g++ < 100); } }, 'До конца'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, extra, h('span', null, 'Добавить A → B с весом 1: цикл A → B → A весом −3')),
      gv.svg);
    const infoEl = h('div', { class: 'chips' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(infoEl, logEl);

    let dist, closed, finished, hot, bad, pass, idx, changed, cur;
    const active = () => EDGES.map((e, i) => [e, i]).filter(([, i]) => i !== EXTRA || extra.checked);
    // reference answer (Bellman–Ford) to mark wrong Dijkstra results
    function truth() {
      const d = {}; NODES.forEach(n => { d[n.id] = INF; }); d.S = 0;
      for (let k = 0; k < NODES.length - 1; k++) active().forEach(([[a, b, w]]) => { if (d[a] + w < d[b]) d[b] = d[a] + w; });
      return d;
    }
    function reset() {
      modeBtns.forEach((b, i) => b.classList.toggle('sel', (i === 0) === (mode === 'dij')));
      gv.showEdge(EXTRA, extra.checked);
      dist = {}; NODES.forEach(n => { dist[n.id] = INF; }); dist.S = 0;
      closed = []; finished = false; hot = new Set(); bad = new Set(); pass = 1; idx = 0; changed = false; cur = null;
      say(mode === 'dij'
        ? 'Дейкстра с множеством закрытых вершин: каждый шаг закрывает ближайшую открытую вершину и релаксирует её рёбра.'
        : `Беллман–Форд: проходим по всем рёбрам в фиксированном порядке, ${NODES.length - 1} раза (V − 1), и ещё раз для проверки.`);
      render();
    }
    function step() {
      if (finished) return false;
      hot = new Set();
      return mode === 'dij' ? stepDij() : stepBF();
    }
    function stepDij() {
      const open = NODES.map(n => n.id).filter(x => !closed.includes(x) && dist[x] < INF).sort((a, b) => dist[a] - dist[b]);
      if (!open.length) {
        finished = true;
        if (extra.checked) {
          say('Дейкстра закончила и выдала какие-то числа. Но с отрицательным циклом кратчайших путей нет вовсе: каждый круг A → B → A уменьшает длину на 3.', 'bad');
        } else {
          const t = truth();
          const wrong = NODES.filter(n => t[n.id] !== dist[n.id]);
          wrong.forEach(n => bad.add(n.id));
          say(`Готово, но ответ неверный: ${wrong.map(n => `${n.id} = ${fmtD(dist[n.id])} (на самом деле ${fmtD(t[n.id])})`).join(', ')}. Путь S → B → A → C → T длиной 4 Дейкстра не нашла.`, 'bad');
        }
        render();
        return false;
      }
      const u = open[0];
      closed.push(u); cur = u;
      const msgs = [];
      let warn = false;
      active().forEach(([[a, b, w], i]) => {
        if (a !== u) return;
        hot.add(i);
        const nd = dist[u] + w;
        if (closed.includes(b)) {
          if (nd < dist[b]) { msgs.push(`${b}: ${fmtD(nd)} &lt; ${fmtD(dist[b])}, но ${b} уже закрыта — не пересматриваем`); warn = true; }
        } else if (nd < dist[b]) { msgs.push(`${b} = ${fmtD(nd)}`); dist[b] = nd; }
      });
      say(`Закрываем <b>${u}</b> (${fmtD(dist[u])}). ${msgs.length ? msgs.join('; ') + '.' : 'Улучшений нет.'}`, warn ? 'bad' : '');
      render();
      return true;
    }
    function stepBF() {
      const E = active();
      const V = NODES.length;
      if (idx >= E.length) {
        // end of a pass
        if (!changed) {
          finished = true;
          say(`Проход ${pass} ничего не изменил — расстояния окончательные${pass <= V - 1 ? ', можно остановиться раньше' : ''}. Отрицательных циклов нет. S → B → A → C → T = 4.`, 'ok');
          render();
          return false;
        }
        if (pass === V) {
          finished = true;
          say(`Проверочный ${V}-й проход всё ещё что-то улучшил — значит, есть <b>отрицательный цикл</b>. Кратчайших путей не существует; так находят и валютный арбитраж.`, 'bad');
          render();
          return false;
        }
        pass++; idx = 0; changed = false;
        say(pass === V ? `${V - 1} проходов сделано. Проход ${V} — проверочный: если что-то улучшится, есть отрицательный цикл.` : `Начинаем проход ${pass}.`);
        render();
        return true;
      }
      const [[a, b, w], i] = E[idx++];
      hot.add(i);
      const nd = dist[a] + w;
      if (dist[a] === INF) say(`Проход ${pass}, ребро ${a} → ${b}: до ${a} пока не дошли (∞), пропускаем.`);
      else if (nd < dist[b]) {
        say(`Проход ${pass}, ребро ${a} → ${b}: ${fmtD(dist[a])} + ${fmtD(w)} = ${fmtD(nd)} &lt; ${fmtD(dist[b])} — улучшили.`, pass === V ? 'bad' : '');
        dist[b] = nd; changed = true;
        if (pass === V) bad.add(b);
      } else say(`Проход ${pass}, ребро ${a} → ${b}: ${fmtD(nd)} не лучше ${fmtD(dist[b])}.`);
      render();
      return true;
    }
    function render() {
      NODES.forEach(n => {
        let cls = '';
        if (bad.has(n.id)) cls = 'bad';
        else if (mode === 'dij' && closed.includes(n.id)) cls = 'done';
        else if (dist[n.id] < INF) cls = 'front';
        gv.setNode(n.id, cls + (mode === 'dij' && n.id === cur && !finished ? ' cur' : ''));
        gv.setSub(n.id, fmtD(dist[n.id]));
      });
      EDGES.forEach((e, i) => gv.setEdge(i, hot.has(i) ? (e[2] < 0 ? 'bad' : 'hot') : ''));
      if (mode === 'dij') {
        infoEl.innerHTML = '<span class="label">Закрыты:</span> ' + (closed.length ? closed.map(x => `<span class="chip ok">${x}</span>`).join('') : '<span class="empty">никто</span>');
      } else {
        const E = active();
        infoEl.innerHTML = `<span class="label">${pass < NODES.length ? `Проход ${pass} из ${NODES.length - 1}` : `Проход ${pass}, проверочный`}:</span> ` +
          E.map(([[a, b], i], k) => `<span class="chip${k === idx - 1 ? ' top' : ''}">${a}→${b}</span>`).join('');
      }
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- A* vs Dijkstra on a grid
  Deck.demo('astar', root => {
    const R = 13, C = 23, S = [6, 2], G = [6, 20];
    const key = (r, c) => r * C + c;
    const walls = new Array(R * C).fill(false);
    // a cup open towards the start and a wall right after it: greedy search walks into both
    for (let r = 2; r <= 10; r++) walls[key(r, 14)] = true;
    for (let c = 9; c <= 14; c++) { walls[key(2, c)] = true; walls[key(10, c)] = true; }
    for (let c = 3; c <= 10; c++) walls[key(2, c)] = true;
    for (let r = 4; r <= 10; r++) walls[key(r, 5)] = true;
    const MODES = { dij: ['Дейкстра', 0], astar: ['A*', 1], greedy: ['A*, h × 3', 3] };
    const results = {};
    let mode = null, open, g, prev, closed, path, finished = true, auto = false, acc = 0, cur = -1;
    const btns = Object.entries(MODES).map(([m, [label]]) => h('button', { class: 'btn small', onclick: () => run(m) }, label));
    root.append(h('div', { class: 'controls' }, h('span', { class: 'label' }, 'Запустить:'), ...btns,
      h('button', { class: 'btn small', onclick: clear }, 'Сброс')),
    h('p', { class: 'note' }, 'Клик по клетке ставит или убирает стену.'));
    const cells = makeGrid(root, R, C, (r, c) => {
      const k = key(r, c);
      if (k === key(...S) || k === key(...G)) return;
      walls[k] = !walls[k];
      Object.keys(results).forEach(m => delete results[m]);
      clear();
    });
    const resEl = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'legend', html: '<span><i class="sw" style="background:var(--seen)"></i>просмотрена (закрыта)</span><span><i class="sw" style="background:var(--front)"></i>в куче</span><span><i class="sw" style="background:var(--accent)"></i>путь</span>' }), resEl, logEl);

    const hman = k => Math.abs(Math.floor(k / C) - G[0]) + Math.abs(k % C - G[1]);
    // binary heap of [f, h, seq, k]
    const less = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    let seq = 0;
    function push(heap, item) {
      heap.push(item);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (less(heap[i], heap[p]) >= 0) break;
        [heap[i], heap[p]] = [heap[p], heap[i]]; i = p;
      }
    }
    function pop(heap) {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m]) < 0) m = l;
          if (r < heap.length && less(heap[r], heap[m]) < 0) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
        }
      }
      return top;
    }
    function run(m) {
      mode = m;
      btns.forEach((b, i) => b.classList.toggle('sel', Object.keys(MODES)[i] === m));
      const s = key(...S);
      g = new Map([[s, 0]]); prev = new Map(); closed = new Set(); path = new Set(); cur = -1;
      open = []; seq = 0;
      push(open, [MODES[m][1] * hman(s), hman(s), seq++, s]);
      finished = false; auto = true;
      say(m === 'dij' ? 'Дейкстра: куча по g — пройденному расстоянию. Волна расходится во все стороны.'
        : m === 'astar' ? 'A*: куча по g + h, h — манхэттенское расстояние до финиша. Поиск тянется к цели.'
          : 'Взвешенный A*: f = g + 3h. Поиск почти жадный: рвётся к цели и почти не оглядывается.');
      render();
    }
    function expand() {
      while (open.length) {
        const [, , , k] = pop(open);
        if (closed.has(k)) continue;
        closed.add(k); cur = k;
        if (k === key(...G)) {
          for (let x = k; x !== undefined; x = prev.get(x)) path.add(x);
          finish();
          return;
        }
        const r = Math.floor(k / C), c = k % C;
        for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
          const n = key(nr, nc);
          if (walls[n] || closed.has(n)) continue;
          const ng = g.get(k) + 1;
          if (ng < (g.has(n) ? g.get(n) : INF)) {
            g.set(n, ng); prev.set(n, k);
            push(open, [ng + MODES[mode][1] * hman(n), hman(n), seq++, n]);
          }
        }
        return;
      }
      finish();
    }
    function bestLen() {
      const d = new Map([[key(...S), 0]]), q = [key(...S)];
      for (let i = 0; i < q.length; i++) {
        const k = q[i], r = Math.floor(k / C), c = k % C;
        for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
          const nr = r + dr, nc = c + dc, n = key(nr, nc);
          if (nr >= 0 && nr < R && nc >= 0 && nc < C && !walls[n] && !d.has(n)) { d.set(n, d.get(k) + 1); q.push(n); }
        }
      }
      return d.get(key(...G));
    }
    function finish() {
      finished = true; auto = false;
      const len = path.size ? path.size - 1 : null, best = bestLen();
      results[mode] = { seen: closed.size, len };
      if (len == null) say('Пути нет: куча опустела.', 'bad');
      else say(`${MODES[mode][0]}: просмотрено <b>${closed.size}</b> ${plural(closed.size, ['клетка', 'клетки', 'клеток'])}, путь ${len}${len === best ? ' — кратчайший' : ` — на ${len - best} длиннее кратчайшего (${best})`}.`, len === best ? 'ok' : 'warn');
      render();
    }
    function clear() {
      mode = null; finished = true; auto = false; cur = -1;
      g = new Map(); closed = new Set(); path = new Set(); open = [];
      btns.forEach(b => b.classList.remove('sel'));
      say('Выберите алгоритм и сравните, сколько клеток он просмотрит. Старт S слева, финиш F справа, между ними стены.');
      render();
    }
    function render() {
      const inOpen = new Set(open.map(e => e[3]));
      cells.forEach((el, k) => {
        let cls = 'cell';
        if (walls[k]) cls += ' wall';
        else if (k === key(...S) || k === key(...G)) cls += k === key(...S) ? ' start' : ' goal';
        else if (path.has(k)) cls += ' path';
        else if (closed.has(k)) cls += ' done';
        else if (inOpen.has(k)) cls += ' seen';
        if (k === cur && !finished) cls += ' cur';
        el.className = cls;
        el.textContent = k === key(...S) ? 'S' : k === key(...G) ? 'F' : '';
      });
      resEl.innerHTML = Object.entries(MODES).map(([m, [label]]) => {
        const r = results[m];
        return `<div class="stat"><b>${r ? r.seen : '—'}</b><span>${label}: просмотрено${r && r.len != null ? `, путь ${r.len}` : ''}</span></div>`;
      }).join('');
    }
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt * 110;
      while (acc >= 1 && auto) { acc--; expand(); }
      render();
    });
    clear();
    return { start: loop.start, stop() { loop.stop(); if (!finished) { auto = false; while (!finished) expand(); } } };
  });

  // ---------------------------------------------------------------- union-find
  Deck.demo('dsu', root => {
    const N = 10;
    const PAIRS = [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [8, 9], [4, 9]];
    let parent, rank, next, lastHops, changed, findPath;
    const byRank = h('input', { type: 'checkbox', checked: true, onchange: reset });
    const compress = h('input', { type: 'checkbox', checked: true, onchange: reset });
    const unionBtn = h('button', { class: 'btn primary', onclick: doUnion });
    const findBtn = h('button', { class: 'btn', onclick: () => doFind(0) }, 'find(0)');
    root.append(
      h('div', { class: 'controls' }, unionBtn, findBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс'),
        h('label', { class: 'toggle' }, byRank, h('span', null, 'по рангу')),
        h('label', { class: 'toggle' }, compress, h('span', null, 'сжатие путей'))));
    const forest = h('div');
    const arr = h('div', { class: 'ds-arr' });
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(forest, arr, stats, logEl);

    function find(x) {
      let hops = 0;
      const path = [x];
      while (parent[x] !== x) {
        if (compress.checked) {
          const gp = parent[parent[x]];
          if (gp !== parent[x]) changed.add(x);
          parent[x] = gp;
        }
        x = parent[x];
        path.push(x);
        hops++;
      }
      lastHops += hops;
      findPath.push(...path);
      return x;
    }
    function reset() {
      parent = [...Array(N).keys()]; rank = new Array(N).fill(0); next = 0; lastHops = 0; changed = new Set(); findPath = [];
      say('Десять одиночных множеств: каждый элемент сам себе корень. Объединим их цепочками 0–1–2–3–4 и 5–6–7–8–9, потом свяжем две цепочки. Выключите оптимизации, чтобы увидеть, как вырождается дерево.');
      render();
    }
    function doUnion() {
      if (next >= PAIRS.length) return;
      const [a, b] = PAIRS[next++];
      lastHops = 0; changed = new Set(); findPath = [];
      const fa = find(a), fb = find(b);
      if (fa === fb) { say(`union(${a}, ${b}): уже в одном множестве.`); return render(); }
      let child, top, how;
      if (byRank.checked) {
        [top, child] = rank[fa] < rank[fb] ? [fb, fa] : [fa, fb];
        how = rank[top] === rank[child] ? `ранги равны (${rank[top]}): ${child} под ${top}, ранг ${top} растёт` : `ранг ${top} больше: ${child} под ${top}, высота не растёт`;
        if (rank[top] === rank[child]) rank[top]++;
      } else {
        [top, child] = [fb, fa];
        how = `без рангов корень ${fa} просто подвешиваем под ${fb}`;
      }
      parent[child] = top;
      changed.add(child);
      say(`union(${a}, ${b}): find(${a}) = ${fa}, find(${b}) = ${fb}; ${how}. Переходов по ссылкам: ${lastHops}.`);
      render();
    }
    function doFind(x) {
      lastHops = 0; changed = new Set(); findPath = [];
      const r = find(x);
      say(`find(${x}) = ${r}: ${lastHops} ${plural(lastHops, ['переход', 'перехода', 'переходов'])} по <code>parent</code>. ${compress.checked ? (changed.size ? `Сжатие путей: ${[...changed].join(', ')} теперь указывают ближе к корню — следующий find будет короче.` : 'Путь уже короткий.') : 'Без сжатия путь останется таким же длинным и в следующий раз.'}`, lastHops > 3 ? 'warn' : '');
      render();
    }
    const depth = x => { let d = 0; while (parent[x] !== x) { x = parent[x]; d++; } return d; };
    function render() {
      const kids = Array.from({ length: N }, () => []);
      for (let i = 0; i < N; i++) if (parent[i] !== i) kids[parent[i]].push(i);
      const roots = [...Array(N).keys()].filter(i => parent[i] === i);
      const maxD = Math.max(...[...Array(N).keys()].map(depth));
      const leaves = x => kids[x].length ? kids[x].reduce((s, k) => s + leaves(k), 0) : 1;
      const total = roots.reduce((s, r) => s + leaves(r), 0);
      const W = 400, H = 180, lh = Math.min(44, (H - 40) / Math.max(1, maxD)), unit = (W - 20) / total;
      const nodes = [], edges = [];
      let x0 = 10;
      const place = (x, d, left) => {
        const width = leaves(x) * unit;
        nodes.push({ id: x, x: left + width / 2, y: 22 + d * lh });
        let l = left;
        for (const k of kids[x]) { place(k, d + 1, l); l += leaves(k) * unit; edges.push({ u: k, v: x }); }
      };
      for (const r of roots) { place(r, 0, x0); x0 += leaves(r) * unit; }
      const gv = graphView({ w: W, h: H, r: 13, directed: true, nodes, edges });
      const fp = new Set(findPath);
      nodes.forEach(n => gv.setNode(n.id, parent[n.id] === n.id ? 'done' : fp.has(n.id) ? 'front' : ''));
      edges.forEach((e, i) => gv.setEdge(i, changed.has(e.u) ? 'tree' : ''));
      forest.replaceChildren(gv.svg);
      const cells = (label, f) => `<span class="h">${label}</span>` + [...Array(N).keys()].map(f).join('');
      arr.innerHTML = cells('i', i => `<span class="i">${i}</span>`) +
        cells('parent', i => `<span class="${parent[i] === i ? 'root' : changed.has(i) ? 'chg' : ''}">${parent[i]}</span>`) +
        (byRank.checked ? cells('rank', i => `<span>${parent[i] === i ? rank[i] : '·'}</span>`) : '');
      stats.innerHTML = `<div class="stat"><b>${roots.length}</b><span>множеств</span></div><div class="stat${maxD > 3 ? ' warn' : ''}"><b>${maxD}</b><span>макс. глубина</span></div><div class="stat"><b>${lastHops}</b><span>переходов в последней операции</span></div>`;
      unionBtn.textContent = next < PAIRS.length ? `union(${PAIRS[next][0]}, ${PAIRS[next][1]})` : 'все пары объединены';
      unionBtn.disabled = next >= PAIRS.length;
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- Kruskal
  Deck.demo('kruskal', root => {
    const NODES = [{ id: 'A', x: 40, y: 70 }, { id: 'B', x: 165, y: 30 }, { id: 'C', x: 300, y: 40 }, { id: 'D', x: 370, y: 160 },
      { id: 'E', x: 245, y: 140 }, { id: 'F', x: 95, y: 175 }, { id: 'G', x: 210, y: 228 }];
    const EDGES = [['E', 'G', 2], ['C', 'E', 3], ['D', 'E', 4], ['A', 'F', 5], ['B', 'E', 6], ['C', 'D', 7], ['B', 'C', 8],
      ['B', 'F', 9], ['D', 'G', 10], ['E', 'F', 11], ['A', 'B', 12], ['F', 'G', 13]];
    const gv = graphView({ w: 400, h: 255, nodes: NODES, edges: EDGES.map(([u, v, w]) => ({ u, v, w })) });
    root.append(h('div', { class: 'controls' },
      h('button', { class: 'btn primary', onclick: step }, 'Следующее ребро'),
      h('button', { class: 'btn', onclick: () => { while (step()); } }, 'До конца'),
      h('button', { class: 'btn', onclick: reset }, 'Сброс')), gv.svg);
    const listEl = h('div', { class: 'chips' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'По весу'), listEl), logEl);
    let parent, i, state, total, taken;
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    function reset() {
      parent = {}; NODES.forEach(n => { parent[n.id] = n.id; });
      i = 0; state = []; total = 0; taken = 0;
      say('Рёбра отсортированы по весу. Каждая вершина — своя компонента (свой цвет). Берём рёбра по порядку.');
      render();
    }
    function step() {
      if (taken === NODES.length - 1 || i >= EDGES.length) return false;
      const [a, b, w] = EDGES[i];
      const ra = find(a), rb = find(b);
      if (ra !== rb) {
        parent[rb] = ra;
        state[i] = 'ok'; total += w; taken++;
        say(taken === NODES.length - 1
          ? `${a}–${b} (${w}) соединяет разные компоненты — берём. Это ${NODES.length - 1}-е ребро: дерево готово, вес <b>${total}</b>. Остальные рёбра можно не смотреть.`
          : `${a}–${b} (${w}): ${a} и ${b} в разных компонентах — берём, компоненты сливаются. Вес дерева: ${total}.`, taken === NODES.length - 1 ? 'ok' : '');
      } else {
        state[i] = 'no';
        say(`${a}–${b} (${w}): ${a} и ${b} уже в одной компоненте — ребро замкнуло бы цикл. Пропускаем.`, 'warn');
      }
      i++;
      render();
      return taken < NODES.length - 1;
    }
    function render() {
      NODES.forEach(n => { gv.setNode(n.id); gv.setFill(n.id, PALETTE[NODES.findIndex(m => m.id === find(n.id))]); });
      EDGES.forEach((e, k) => gv.setEdge(k, state[k] === 'ok' ? 'tree' : state[k] === 'no' ? 'rej' : k === i - 1 ? 'hot' : taken === NODES.length - 1 ? 'dim' : ''));
      listEl.innerHTML = EDGES.map(([a, b, w], k) => `<span class="chip${state[k] === 'ok' ? ' ok' : state[k] === 'no' ? ' no' : ''}${k === i - 1 ? ' now' : ''}">${a}${b} ${w}</span>`).join('');
    }
    reset();
    return {};
  });

  // ---------------------------------------------------------------- bipartite check
  Deck.demo('bipartite', root => {
    const NODES = [{ id: '1', x: 45, y: 55 }, { id: '2', x: 155, y: 55 }, { id: '3', x: 155, y: 195 }, { id: '4', x: 45, y: 195 },
      { id: '5', x: 255, y: 55 }, { id: '6', x: 255, y: 195 }, { id: '7', x: 365, y: 195 }, { id: '8', x: 365, y: 55 }];
    const EDGES = [['1', '2'], ['2', '3'], ['3', '4'], ['4', '1'], ['3', '6'], ['5', '6'], ['6', '7'], ['7', '8'], ['8', '5'], ['1', '7']];
    const EXTRA = EDGES.length - 1;
    const gv = graphView({ w: 400, h: 245, nodes: NODES, edges: EDGES.map(([u, v]) => ({ u, v })) });
    const extra = h('input', { type: 'checkbox', onchange: reset });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: step }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { while (step()); } }, 'До конца'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, extra, h('span', null, 'Добавить ребро 1–7')),
      gv.svg);
    const qEl = h('div', { class: 'chips' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'Очередь'), qEl), logEl);
    let col, queue, finished, hot, bad;
    const active = () => EDGES.map((e, i) => [e, i]).filter(([, i]) => i !== EXTRA || extra.checked);
    function reset() {
      col = {}; queue = []; finished = false; hot = new Set(); bad = -1;
      gv.showEdge(EXTRA, extra.checked);
      say(extra.checked ? 'Ребро 1–7 замыкает цикл 1–2–3–6–7–1 из пяти рёбер. Глазом не сразу видно — проверим раскраской.' : 'Красим вершину 1 синим и идём BFS: каждый сосед получает противоположный цвет.');
      render();
    }
    function step() {
      if (finished) return false;
      hot = new Set();
      if (!queue.length) {
        const s = NODES.find(n => !(n.id in col));
        if (!s) {
          finished = true;
          const a = NODES.filter(n => col[n.id] === 1).map(n => n.id), b = NODES.filter(n => col[n.id] === 2).map(n => n.id);
          say(`Все вершины покрашены без конфликтов — граф двудольный. Доли: {${a.join(', ')}} и {${b.join(', ')}}.`, 'ok');
          render();
          return false;
        }
        col[s.id] = 1; queue.push(s.id);
        say(`Вершина ${s.id} ещё без цвета — начинаем с неё обход, красим в синий.`);
        render();
        return true;
      }
      const u = queue.shift();
      const msgs = [];
      for (const [[a, b], i] of active()) {
        if (a !== u && b !== u) continue;
        const v = a === u ? b : a;
        hot.add(i);
        if (!(v in col)) { col[v] = 3 - col[u]; queue.push(v); msgs.push(`${v} → ${col[v] === 1 ? 'синий' : 'оранжевый'}`); }
        else if (col[v] === col[u]) {
          bad = i; finished = true;
          say(`Вершина ${u}: сосед ${v} того же цвета — <b>конфликт</b>. В графе цикл нечётной длины, двудольным он быть не может.`, 'bad');
          render();
          return false;
        }
      }
      say(`Извлекли ${u}. ${msgs.length ? 'Красим соседей: ' + msgs.join(', ') + '.' : 'Все соседи уже покрашены в противоположный цвет.'}`);
      render();
      return true;
    }
    function render() {
      NODES.forEach(n => gv.setNode(n.id, (col[n.id] === 1 ? 'c1' : col[n.id] === 2 ? 'c2' : '') + (queue.includes(n.id) ? ' cur' : '')));
      EDGES.forEach((e, i) => gv.setEdge(i, (i === bad ? 'bad' : hot.has(i) ? 'hot' : '') + (i === EXTRA ? ' extra' : '')));
      qEl.innerHTML = queue.length ? queue.map(u => `<span class="chip">${u}</span>`).join('') : '<span class="empty">пусто</span>';
    }
    reset();
    return {};
  });
})();
