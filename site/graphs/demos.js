// Demos for slides 2–8: where graphs live, representations, BFS, DFS, islands, Kahn's topological sort.
// Also defines window.GK — a small SVG graph renderer shared with demos-paths.js.
(() => {
  'use strict';
  const { h, highlight, plural, rafLoop } = Deck;
  const NS = 'http://www.w3.org/2000/svg';

  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
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

  // Graph view.
  // nodes: [{id, x, y, label?}], edges: [{u, v, w?, t?, bend?}] (t — weight label position along the edge).
  // rect: {w, h} draws nodes as rounded rectangles instead of circles.
  function graphView({ nodes, edges, directed = false, w = 400, h = 250, r = 17, rect = null, onNode = null }) {
    const svg = sv('svg', { viewBox: `0 0 ${w} ${h}`, class: 'gsvg', role: 'img' });
    const gE = sv('g'), gN = sv('g');
    svg.append(gE, gN);
    const N = {};
    nodes.forEach(n => { N[n.id] = n; });
    const cut = (dx, dy) => {
      if (!rect) return r + 1;
      const hw = rect.w / 2 + 1, hh = rect.h / 2 + 1;
      return Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
    };
    const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const edgeEls = edges.map(e => {
      const a = N[e.u], b = N[e.v];
      const rev = directed && edges.some(f => f !== e && f.u === e.v && f.v === e.u);
      const bend = e.bend != null ? e.bend : rev ? 20 : 0;
      const [px, py] = unit(-(b.y - a.y), b.x - a.x);
      const cx = (a.x + b.x) / 2 + px * bend, cy = (a.y + b.y) / 2 + py * bend;
      let [dx, dy] = unit(cx - a.x, cy - a.y);
      const sx = a.x + dx * cut(dx, dy), sy = a.y + dy * cut(dx, dy);
      [dx, dy] = unit(b.x - cx, b.y - cy);
      const tx = b.x - dx * cut(dx, dy), ty = b.y - dy * cut(dx, dy);
      const ex = directed ? tx - dx * 8 : tx, ey = directed ? ty - dy * 8 : ty;
      const g = sv('g', { class: 'ge' });
      g.append(sv('path', { class: 'ln', d: `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}` }));
      if (directed) {
        const p1 = `${(tx - dx * 11 + dy * 5.5).toFixed(1)},${(ty - dy * 11 - dx * 5.5).toFixed(1)}`;
        const p2 = `${(tx - dx * 11 - dy * 5.5).toFixed(1)},${(ty - dy * 11 + dx * 5.5).toFixed(1)}`;
        g.append(sv('path', { class: 'hd', d: `M${tx.toFixed(1)} ${ty.toFixed(1)} L${p1} L${p2} Z` }));
      }
      if (e.w != null) {
        const t = e.t != null ? e.t : 0.5;
        const lx = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t * t * tx;
        const ly = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t * t * ty;
        g.append(sv('text', { class: 'wt', x: lx.toFixed(1), y: ly.toFixed(1) }, String(e.w).replace('-', '−')));
      }
      gE.append(g);
      return g;
    });
    const nodeEls = {};
    nodes.forEach(n => {
      const g = sv('g', { class: 'gn' + (rect ? ' rect' : '') });
      const sh = rect
        ? sv('rect', { class: 'sh', x: n.x - rect.w / 2, y: n.y - rect.h / 2, width: rect.w, height: rect.h, rx: 7 })
        : sv('circle', { class: 'sh', cx: n.x, cy: n.y, r });
      const lb = sv('text', { class: 'lb', x: n.x, y: n.y + 0.5 }, n.label != null ? n.label : n.id);
      const sb = sv('text', { class: 'sb', x: n.x, y: rect ? n.y + rect.h / 2 + 11 : n.y + r + 12 });
      g.append(sh, lb, sb);
      if (onNode) {
        g.classList.add('click');
        g.addEventListener('click', () => onNode(n.id));
      }
      gN.append(g);
      nodeEls[n.id] = { g, sh, lb, sb, bd: null };
    });
    const base = 'gn' + (rect ? ' rect' : '') + (onNode ? ' click' : '');
    return {
      svg,
      setNode(id, cls = '') { nodeEls[id].g.setAttribute('class', base + (cls ? ' ' + cls : '')); },
      setSub(id, text) { nodeEls[id].sb.textContent = text; },
      setFill(id, color) {
        const el = nodeEls[id];
        el.sh.style.fill = color || '';
        el.sh.style.stroke = color ? 'rgba(0,0,0,0.35)' : '';
        el.lb.style.fill = color ? '#fff' : '';
      },
      setBadge(id, text) {
        const el = nodeEls[id], n = N[id];
        if (!el.bd) {
          const bx = rect ? n.x + rect.w / 2 - 2 : n.x + r - 2, by = rect ? n.y - rect.h / 2 - 2 : n.y - r + 2;
          el.bd = [sv('circle', { class: 'bd', cx: bx, cy: by, r: 8 }), sv('text', { class: 'bdt', x: bx, y: by + 0.5 })];
          el.g.append(...el.bd);
        }
        el.bd[0].style.display = el.bd[1].style.display = text === '' ? 'none' : '';
        el.bd[1].textContent = text;
      },
      setEdge(i, cls = '') { edgeEls[i].setAttribute('class', 'ge' + (cls ? ' ' + cls : '')); },
      showEdge(i, on) { edgeEls[i].style.display = on ? '' : 'none'; },
    };
  }

  const PALETTE = ['#1971c2', '#e8590c', '#2b8a3e', '#9c36b5', '#c2255c', '#0b7285', '#5c940d', '#d9480f', '#5f3dc4', '#087f5b'];
  window.GK = { sv, logger, graphView, PALETTE };

  // ---------------------------------------------------------------- where graphs live
  Deck.demo('where', root => {
    const CASES = [
      ['Соцсеть', 'люди', 'дружба (неориентированные) или подписки (ориентированные)', 'миллиарды вершин, сотни рёбер у вершины',
        'BFS на глубину 2 — «друзья друзей», компоненты, PageRank-подобные рекомендации',
        'Средняя дистанция между двумя пользователями Facebook — около 3,5 рукопожатия: граф огромный, но «тесный».'],
      ['Карта дорог', 'перекрёстки', 'участки дорог, вес — время проезда; односторонние улицы — ориентированные', 'десятки миллионов вершин на страну, степень 2–4',
        'Дейкстра, A*, предобработка (contraction hierarchies)',
        'Навигатор не запускает чистую Дейкстру по континенту: граф заранее «сжимают», и запрос занимает миллисекунды.'],
      ['Пакеты', 'пакет нужной версии', '«зависит от»', 'ациклический граф (DAG), хотя в npm циклы встречаются',
        'топологическая сортировка — порядок установки; поиск циклов',
        'Подбор совместимых версий — отдельная, NP-трудная задача: pip перебирает с возвратом, uv и Poetry используют решатели.'],
      ['Сборка', 'файлы и цели', '«нужно для»', 'DAG',
        'топосортировка; обход назад от изменённого файла — что пересобрать',
        'make сравнивает время изменения, Bazel — хеши входов. В обоих случаях пересобирается только то, что достижимо от изменения.'],
      ['Микросервисы', 'сервисы', 'вызовы, вес — RPS или задержка', 'ориентированный, бывают циклы',
        'достижимость: «что ляжет, если упал X»; поиск циклических вызовов',
        'Jaeger и Grafana Tempo строят карту сервисов из трейсов. Цикл A → B → A — частая причина каскадных отказов при ретраях.'],
      ['Маршрутизация', 'роутеры', 'линки с метрикой (cost)', 'тысячи вершин в домене',
        'OSPF и IS-IS — Дейкстра на каждом роутере; RIP — распределённый Беллман–Форд',
        'Упал линк — роутеры рассылают обновление топологии и пересчитывают дерево кратчайших путей. Подробнее — в <a href="/networking/">презентации про сети</a>.'],
      ['Сборщик мусора', 'объекты', 'ссылки между ними', 'ориентированный, с циклами',
        'обход от корней (стек, глобальные переменные): всё недостижимое — мусор',
        'Разметка — это DFS с явным стеком по куче. Подробнее — в <a href="/memory-management/">презентации про управление памятью</a>.'],
      ['Дедлоки', 'транзакции или потоки', '«ждёт блокировку, которую держит»', 'ориентированный граф ожиданий',
        'поиск цикла: цикл = взаимная блокировка',
        'Postgres после <code>deadlock_timeout</code> ищет цикл в графе ожиданий и отменяет одну из транзакций. Подробнее — в <a href="/concurrency-sync/">презентации про синхронизацию</a>.'],
      ['Git', 'коммиты', '«родитель»', 'DAG: у merge-коммита два родителя',
        'общий предок (merge-base), топологический порядок в <code>git log --topo-order</code>',
        '<code>git merge-base</code> ищет общих предков двух веток — от него строится трёхсторонний merge.'],
    ];
    const list = h('div', { class: 'wh-list' });
    const detail = h('div', { class: 'wh-detail', 'aria-live': 'polite' });
    const btns = CASES.map((c, i) => {
      const b = h('button', { class: 'wh-btn', onclick: () => select(i) }, c[0]);
      list.append(b);
      return b;
    });
    root.append(list, detail);
    function select(i) {
      const [name, v, e, kind, algo, note] = CASES[i];
      btns.forEach((b, j) => b.classList.toggle('sel', i === j));
      detail.innerHTML = `<b>${name}</b><dl><dt>Вершины</dt><dd>${v}</dd><dt>Рёбра</dt><dd>${e}</dd><dt>Граф</dt><dd>${kind}</dd><dt>Алгоритмы</dt><dd>${algo}</dd></dl><p>${note}</p>`;
    }
    select(0);
    return {};
  });

  // ---------------------------------------------------------------- representations
  Deck.demo('repr', root => {
    const gv = graphView({
      w: 200, h: 170, r: 15,
      nodes: [{ id: 'A', x: 30, y: 40 }, { id: 'B', x: 105, y: 85 }, { id: 'C', x: 30, y: 135 }, { id: 'D', x: 175, y: 40 }, { id: 'E', x: 175, y: 135 }],
      edges: [{ u: 'A', v: 'B' }, { u: 'A', v: 'C' }, { u: 'B', v: 'C' }, { u: 'B', v: 'D' }, { u: 'D', v: 'E' }],
    });
    const VIEWS = {
      'Список': `graph = {
    "A": ["B", "C"],
    "B": ["A", "C", "D"],
    "C": ["A", "B"],
    "D": ["B", "E"],
    "E": ["D"],
}`,
      'Матрица': `#     A  B  C  D  E
m = [[0, 1, 1, 0, 0],  # A
     [1, 0, 1, 1, 0],  # B
     [1, 1, 0, 0, 0],  # C
     [0, 1, 0, 0, 1],  # D
     [0, 0, 0, 1, 0]]  # E`,
      'Рёбра': `edges = [("A", "B"), ("A", "C"),
         ("B", "C"), ("B", "D"),
         ("D", "E")]
# в базе: таблица edges(src, dst)`,
      'CSR': `# соседи i — nbr[off[i]:off[i+1]]
off = [0, 2, 5, 7, 9, 10]
nbr = [1, 2,  0, 2, 3,  0, 1,
       1, 4,  3]`,
    };
    const code = h('code');
    const pre = h('pre', { class: 'code' }, code);
    const tabs = h('div', { class: 'controls' });
    for (const name of Object.keys(VIEWS)) {
      const b = h('button', { class: 'btn small', onclick: () => show(name, b) }, name);
      tabs.append(b);
    }
    function show(name, b) {
      [...tabs.children].forEach(x => x.classList.toggle('sel', x === b));
      code.innerHTML = highlight(VIEWS[name], 'py');
    }
    root.append(tabs, h('div', { class: 'rp-top' }, gv.svg, pre));
    show('Список', tabs.firstChild);

    const VS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
    const VL = ['1 тыс.', '10 тыс.', '100 тыс.', '1 млн', '10 млн', '100 млн', '1 млрд'];
    const DS = [2, 5, 10, 50, 200, 1000];
    const RAM = 256 * 2 ** 30;
    const slider = (label, n, idx, fmt) => {
      const out = h('output');
      const input = h('input', { type: 'range', min: 0, max: n - 1, value: idx, 'aria-label': label });
      const set = () => { out.textContent = fmt(+input.value); };
      set();
      input.addEventListener('input', () => { set(); update(); });
      root.append(h('label', { class: 'slider inline' }, h('span', { class: 'label', style: 'min-width:8.5em' }, label), input, out));
      return () => +input.value;
    };
    const vi = slider('Вершин', VS.length, 4, i => VL[i]);
    const di = slider('Средняя степень', DS.length, 2, i => DS[i]);
    const bars = h('div', { class: 'rp-bars' });
    const logEl = h('p', { class: 'log' });
    root.append(bars, logEl);
    const bytes = b => {
      const U = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ', 'ЭБ'];
      let i = 0;
      while (b >= 1024 && i < U.length - 1) { b /= 1024; i++; }
      return (b < 10 && i ? b.toFixed(1).replace('.', ',') : Math.round(b)) + ' ' + U[i];
    };
    const LO = 3, HI = 18; // log10 scale of the bars: 1 КБ … 1 ЭБ
    const pos = b => Math.max(0, Math.min(100, (Math.log10(b) - LO) / (HI - LO) * 100));
    function update() {
      const V = VS[vi()], deg = Math.min(DS[di()], V - 1), E = V * deg;
      const rows = [
        ['Матрица, бит на ячейку', V * V / 8],
        ['CSR, int32', 4 * (V + 1) + 4 * E],
        ['Python dict[int, list]', 120 * V + 8 * E],
      ];
      bars.innerHTML = rows.map(([name, b]) => `<div class="rp-row${b > RAM ? ' over' : ''}"><span>${name}</span><span class="cost-track"><span class="cost-fill" style="width:${pos(b)}%"></span><i class="rp-ram" style="left:${pos(RAM)}%"></i></span><b>${bytes(b)}</b></div>`).join('');
      const ratio = rows[0][1] / rows[1][1];
      logEl.innerHTML = `${VL[vi()]} вершин × ${deg} соседей: матрица в <b>${ratio >= 10 ? Math.round(ratio).toLocaleString('ru-RU') : ratio.toFixed(1).replace('.', ',')}</b> раз${ratio >= 2 && ratio < 5 ? 'а' : ''} больше CSR. ` +
        (rows[0][1] > RAM ? 'Матрица не влезет в сервер на 256 ГБ (красная черта).' : 'Пока всё влезает в память.') +
        ' Шкала логарифмическая.';
      logEl.className = 'log' + (rows[0][1] > RAM ? ' warn' : '');
    }
    update();
    return {};
  });

  // ---------------------------------------------------------------- shared grid helper
  function makeGrid(root, rows, cols, onClick, maxW) {
    const grid = h('div', { class: 'grid no-swipe', style: `grid-template-columns:repeat(${cols}, minmax(0, 1fr));max-width:${maxW || 9999}px` });
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const el = h('div', { class: 'cell', onclick: () => onClick(r, c) });
      cells.push(el);
      grid.append(el);
    }
    root.append(grid);
    return cells;
  }
  window.GK.makeGrid = makeGrid;

  // ---------------------------------------------------------------- BFS on a grid
  Deck.demo('bfs', root => {
    const R = 11, C = 15, S = [5, 0], G = [5, 14];
    const key = (r, c) => r * C + c;
    let walls, dist, prev, queue, head, cur, path, finished, auto = false, acc = 0, popped;
    const ctr = h('div', { class: 'controls' });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { auto = false; syncRun(); step(); } }, 'Шаг');
    const runBtn = h('button', { class: 'btn', onclick: () => { if (finished) reset(); auto = !auto; syncRun(); } }, 'Пуск');
    ctr.append(stepBtn, runBtn,
      h('button', { class: 'btn', onclick: () => { reset(); } }, 'Сброс'),
      h('button', { class: 'btn', onclick: () => { genWalls(); reset(); } }, 'Новый лабиринт'));
    root.append(ctr, h('p', { class: 'note' }, 'Нажмите «Пуск» или «Шаг». Клик по клетке ставит или убирает стену.'));
    const cells = makeGrid(root, R, C, (r, c) => {
      if ((r === S[0] && c === S[1]) || (r === G[0] && c === G[1])) return;
      walls[key(r, c)] = !walls[key(r, c)];
      reset();
    }, 430);
    const stats = h('div', { class: 'stats' });
    const legend = h('div', { class: 'legend', html: '<span><i class="sw" style="background:var(--front)"></i>в очереди (фронт)</span><span><i class="sw" style="background:var(--seen)"></i>извлечена</span><span><i class="sw" style="background:var(--accent)"></i>путь</span>' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(legend, stats, logEl);

    function neighbours(k) {
      const r = Math.floor(k / C), c = k % C, out = [];
      for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < R && nc >= 0 && nc < C && !walls[key(nr, nc)]) out.push(key(nr, nc));
      }
      return out;
    }
    function solvable() {
      const d = new Map([[key(...S), 0]]), q = [key(...S)];
      for (let i = 0; i < q.length; i++) for (const n of neighbours(q[i])) if (!d.has(n)) { d.set(n, d.get(q[i]) + 1); q.push(n); }
      return d.get(key(...G));
    }
    function genWalls() {
      for (let t = 0; t < 200; t++) {
        walls = Array.from({ length: R * C }, () => Math.random() < 0.3);
        walls[key(...S)] = walls[key(...G)] = false;
        const d = solvable();
        if (d && d >= 18) return;
      }
    }
    function reset() {
      dist = new Map([[key(...S), 0]]);
      prev = new Map([[key(...S), -1]]);
      queue = [key(...S)];
      head = 0; cur = -1; path = new Set(); finished = false; popped = 0; auto = false;
      syncRun();
      say('Старт в зелёной клетке слева. Очередь: [старт]. Каждый шаг — извлечь клетку из головы очереди и добавить в хвост её непосещённых соседей.');
      render();
    }
    function step() {
      if (finished) return;
      if (head >= queue.length) {
        finished = true; auto = false; syncRun();
        say(`Очередь пуста, до финиша не дошли: пути нет. Посещено ${popped} ${plural(popped, ['клетка', 'клетки', 'клеток'])}.`, 'bad');
        render();
        return;
      }
      cur = queue[head++];
      popped++;
      const d = dist.get(cur);
      if (cur === key(...G)) {
        for (let k = cur; k !== -1; k = prev.get(k)) path.add(k);
        finished = true; auto = false; syncRun();
        say(`Финиш извлечён на расстоянии <b>${d}</b> — это кратчайший путь: все клетки ближе извлекались раньше. Путь восстановлен по ссылкам <code>prev</code>.`, 'ok');
        render();
        return;
      }
      const added = [];
      for (const n of neighbours(cur)) if (!dist.has(n)) { dist.set(n, d + 1); prev.set(n, cur); queue.push(n); added.push(n); }
      say(`Извлекли клетку на расстоянии ${d}. ${added.length ? `Добавили в очередь ${added.length} ${plural(added.length, ['соседа', 'соседей', 'соседей'])} с расстоянием ${d + 1}.` : 'Новых соседей нет.'} В очереди: ${queue.length - head}.`);
      render();
    }
    function render() {
      const inQ = new Set(queue.slice(head));
      cells.forEach((el, k) => {
        let cls = 'cell';
        if (walls[k]) cls += ' wall';
        else if (path.has(k)) cls += ' path';
        else if (k === key(...S) || k === key(...G)) cls += k === key(...S) ? ' start' : ' goal';
        else if (inQ.has(k)) cls += ' seen';
        else if (dist.has(k)) cls += ' done';
        if (k === cur && !finished) cls += ' cur';
        el.className = cls;
        el.textContent = k === key(...S) ? 'S' : k === key(...G) ? 'F' : !walls[k] && dist.has(k) ? dist.get(k) : '';
      });
      const front = queue.length - head;
      stats.innerHTML = `<div class="stat"><b>${popped}</b><span>извлечено</span></div><div class="stat"><b>${front}</b><span>в очереди</span></div><div class="stat"><b>${path.size ? path.size - 1 : '—'}</b><span>длина пути</span></div>`;
    }
    function syncRun() { runBtn.textContent = auto ? 'Пауза' : 'Пуск'; }
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt * 30;
      while (acc >= 1 && auto) { acc--; step(); }
    });
    genWalls();
    reset();
    return { start: loop.start, stop() { loop.stop(); auto = false; syncRun(); } };
  });

  // ---------------------------------------------------------------- DFS with colours and a call stack
  Deck.demo('dfs', root => {
    const NODES = [
      { id: 'A', x: 40, y: 60 }, { id: 'B', x: 150, y: 35 }, { id: 'C', x: 60, y: 190 }, { id: 'D', x: 210, y: 120 },
      { id: 'E', x: 320, y: 50 }, { id: 'F', x: 170, y: 215 }, { id: 'G', x: 315, y: 200 },
    ];
    const EDGES = [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'], ['C', 'F'], ['D', 'E'], ['D', 'G'], ['F', 'G'], ['E', 'B']];
    const EXTRA = EDGES.length - 1;
    const gv = graphView({ w: 360, h: 245, directed: true, nodes: NODES, edges: EDGES.map(([u, v]) => ({ u, v })) });
    const extra = h('input', { type: 'checkbox', onchange: reset });
    const stepBtn = h('button', { class: 'btn primary', onclick: () => { auto = false; syncRun(); step(); } }, 'Шаг');
    const runBtn = h('button', { class: 'btn', onclick: () => { if (finished) reset(); auto = !auto; syncRun(); } }, 'Пуск');
    root.append(
      h('div', { class: 'controls' }, stepBtn, runBtn, h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, extra, h('span', null, 'Добавить ребро E → B')));
    const stackEl = h('div', { class: 'df-stack' });
    const orderEl = h('div', { class: 'chips' });
    root.append(h('div', { class: 'df-wrap' }, gv.svg, h('div', { class: 'df-side' }, h('span', { class: 'label' }, 'Стек вызовов'), stackEl)));
    root.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'Порядок выхода'), orderEl));
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(logEl);

    let color, stack, order, finished, hot, tree, bad, auto = false, acc = 0;
    const adj = u => EDGES.map((e, i) => [e, i]).filter(([e, i]) => e[0] === u && (i !== EXTRA || extra.checked));
    function reset() {
      color = {}; NODES.forEach(n => { color[n.id] = 'white'; });
      stack = []; order = []; finished = false; hot = -1; tree = new Set(); bad = new Set(); auto = false;
      syncRun();
      gv.showEdge(EXTRA, extra.checked);
      say(extra.checked ? 'Ребро E → B замыкает цикл B → D → E → B. Посмотрим, как DFS его найдёт.' : 'Нажмите «Шаг»: обход начнётся с A. Соседей перебираем по алфавиту.');
      render();
    }
    function step() {
      if (finished) return;
      hot = -1;
      if (!stack.length) {
        const next = NODES.find(n => color[n.id] === 'white');
        if (!next) {
          finished = true; auto = false; syncRun();
          const topo = order.slice().reverse().join(' ');
          say(`Все вершины чёрные, циклов нет. Обратный порядок выхода — топологическая сортировка: <b>${topo}</b>.`, 'ok');
          return render();
        }
        color[next.id] = 'grey';
        stack.push({ u: next.id, i: 0 });
        say(`dfs(${next.id}): красим серой и кладём на стек.`);
        return render();
      }
      const top = stack[stack.length - 1];
      const out = adj(top.u);
      if (top.i < out.length) {
        const [[u, v], ei] = out[top.i++];
        hot = ei;
        if (color[v] === 'white') {
          color[v] = 'grey'; tree.add(ei);
          stack.push({ u: v, i: 0 });
          say(`Ребро ${u} → ${v}: ${v} белая — рекурсивный вызов dfs(${v}).`);
        } else if (color[v] === 'grey') {
          const from = stack.findIndex(f => f.u === v);
          const cyc = stack.slice(from).map(f => f.u).concat(v).join(' → ');
          bad.add(ei);
          finished = true; auto = false; syncRun();
          say(`Ребро ${u} → ${v}: ${v} серая, то есть ещё на стеке. Обратное ребро — <b>цикл ${cyc}</b>. Топологического порядка нет.`, 'bad');
        } else {
          say(`Ребро ${u} → ${v}: ${v} уже чёрная, её поддерево обработано. Это не цикл — пропускаем.`);
        }
        return render();
      }
      color[top.u] = 'black';
      stack.pop();
      order.push(top.u);
      say(`Все рёбра ${top.u} просмотрены: красим чёрной и выходим из dfs(${top.u}).`);
      render();
    }
    function render() {
      NODES.forEach(n => gv.setNode(n.id, (color[n.id] === 'grey' ? 'grey' : color[n.id] === 'black' ? 'black' : '') + (stack.length && stack[stack.length - 1].u === n.id && !finished ? ' cur' : '')));
      EDGES.forEach((e, i) => gv.setEdge(i, (bad.has(i) ? 'bad' : i === hot ? 'hot' : tree.has(i) ? 'tree' : '') + (i === EXTRA ? ' extra' : '')));
      stackEl.innerHTML = stack.length ? stack.map(f => `<div class="df-frame">dfs(${f.u})</div>`).join('') : '<span class="empty">пусто</span>';
      orderEl.innerHTML = order.length ? order.map(u => `<span class="chip">${u}</span>`).join('') : '<span class="empty">пока никто не вышел</span>';
    }
    function syncRun() { runBtn.textContent = auto ? 'Пауза' : 'Пуск'; }
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt * 1.6;
      while (acc >= 1 && auto) { acc--; step(); }
    });
    reset();
    return { start: loop.start, stop() { loop.stop(); auto = false; syncRun(); } };
  });

  // ---------------------------------------------------------------- islands (connected components on a grid)
  Deck.demo('islands', root => {
    const R = 9, C = 13;
    let land, comp, count, scan, fill, auto = false, acc = 0, sizes;
    const diag = h('input', { type: 'checkbox', onchange: reset });
    const runBtn = h('button', { class: 'btn primary', onclick: () => { if (scan >= R * C && !fill) reset(); auto = !auto; syncRun(); } }, 'Посчитать');
    root.append(h('div', { class: 'controls' }, runBtn,
      h('button', { class: 'btn', onclick: instant }, 'Сразу'),
      h('button', { class: 'btn', onclick: () => { gen(); reset(); } }, 'Новая карта')),
      h('label', { class: 'toggle' }, diag, h('span', null, 'Соседи по диагонали тоже (8 направлений)')));
    const cells = makeGrid(root, R, C, (r, c) => { land[r * C + c] = !land[r * C + c]; reset(); }, 470);
    const stats = h('div', { class: 'stats' });
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(stats, logEl);

    function gen() {
      // a few random blobs: grow each from a seed by attaching random neighbours
      land = new Array(R * C).fill(false);
      const blobs = 7 + Math.floor(Math.random() * 3);
      for (let i = 0; i < blobs; i++) {
        const blob = [Math.floor(Math.random() * R * C)];
        land[blob[0]] = true;
        const size = 1 + Math.floor(Math.random() * 7);
        for (let t = 0; t < size * 3 && blob.length < size; t++) {
          const k = blob[Math.floor(Math.random() * blob.length)];
          const [dr, dc] = [[-1, 0], [0, 1], [1, 0], [0, -1]][Math.floor(Math.random() * 4)];
          const r = Math.floor(k / C) + dr, c = k % C + dc;
          if (r < 0 || r >= R || c < 0 || c >= C || land[r * C + c]) continue;
          land[r * C + c] = true;
          blob.push(r * C + c);
        }
      }
    }
    function nb(k) {
      const r = Math.floor(k / C), c = k % C, out = [];
      const dirs = diag.checked ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] : [[-1, 0], [0, 1], [1, 0], [0, -1]];
      for (const [dr, dc] of dirs) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < R && cc >= 0 && cc < C && land[rr * C + cc]) out.push(rr * C + cc);
      }
      return out;
    }
    function reset() {
      comp = new Array(R * C).fill(-1);
      count = 0; scan = 0; fill = null; auto = false; sizes = [];
      syncRun();
      say('Нажмите «Посчитать»: идём по клеткам слева направо, сверху вниз. Клик по клетке превращает воду в сушу и обратно.');
      render();
    }
    // One unit of work: either one cell of the current flood fill or one scanned cell.
    function tick() {
      if (fill) {
        if (fill.head < fill.q.length) {
          const k = fill.q[fill.head++];
          for (const n of nb(k)) if (comp[n] === -1) { comp[n] = fill.id; fill.q.push(n); }
          return true;
        }
        sizes.push(fill.q.length);
        say(`Остров №${fill.id + 1} залит: ${fill.q.length} ${plural(fill.q.length, ['клетка', 'клетки', 'клеток'])}. Продолжаем сканировать.`);
        fill = null;
        return true;
      }
      if (scan >= R * C) return false;
      const k = scan++;
      if (land[k] && comp[k] === -1) {
        comp[k] = count;
        fill = { id: count, q: [k], head: 0 };
        count++;
        say(`Суша, ещё не посещённая: новый остров №${count}. Запускаем обход из неё — он зальёт весь остров.`);
      }
      return true;
    }
    function finish() {
      auto = false; syncRun();
      say(`Готово: <b>${count} ${plural(count, ['остров', 'острова', 'островов'])}</b>. Каждая клетка просмотрена сканом один раз и залита один раз — O(R · C).`, 'ok');
    }
    function instant() {
      if (scan >= R * C && !fill) reset();
      while (tick());
      finish();
      render();
    }
    function render() {
      cells.forEach((el, k) => {
        el.className = 'cell ' + (land[k] ? 'land' : 'water') + (k === scan - 1 && (scan < R * C || fill) ? ' scan' : '');
        el.style.background = comp[k] >= 0 ? PALETTE[comp[k] % PALETTE.length] : '';
        el.textContent = comp[k] >= 0 && fill && comp[k] === fill.id && fill.q.indexOf(k) >= fill.head ? '·' : '';
        el.style.color = '#fff';
      });
      const nLand = land.filter(Boolean).length;
      stats.innerHTML = `<div class="stat"><b>${count}</b><span>островов</span></div><div class="stat"><b>${nLand}</b><span>клеток суши</span></div><div class="stat"><b>${Math.min(scan, R * C)} / ${R * C}</b><span>просканировано</span></div>`;
    }
    function syncRun() { runBtn.textContent = auto ? 'Пауза' : 'Посчитать'; }
    const loop = rafLoop(dt => {
      if (!auto) return;
      acc += dt * 30;
      while (acc >= 1 && auto) {
        acc--;
        // water cells are scanned quickly, several per frame
        let guard = 0;
        while (!fill && scan < R * C && !land[scan] && guard++ < 3) scan++;
        if (!tick()) { finish(); break; }
      }
      render();
    });
    gen();
    reset();
    return { start: loop.start, stop() { loop.stop(); auto = false; syncRun(); } };
  });

  // ---------------------------------------------------------------- Kahn's algorithm
  Deck.demo('topo', root => {
    const NODES = [
      { id: 'socket', x: 45, y: 85 }, { id: 'json', x: 45, y: 160 }, { id: 'crypto', x: 45, y: 228 },
      { id: 'driver', x: 150, y: 22 }, { id: 'http', x: 150, y: 120 },
      { id: 'db', x: 258, y: 22 }, { id: 'web', x: 258, y: 120 }, { id: 'auth', x: 258, y: 210 },
      { id: 'app', x: 357, y: 120 },
    ];
    const EDGES = [['socket', 'driver'], ['socket', 'http'], ['json', 'web'], ['crypto', 'auth'], ['driver', 'db'], ['http', 'web'],
      ['http', 'auth'], ['db', 'app'], ['web', 'app'], ['auth', 'app'], ['db', 'socket']];
    const EXTRA = EDGES.length - 1;
    const gv = graphView({ w: 400, h: 250, directed: true, rect: { w: 64, h: 28 }, nodes: NODES, edges: EDGES.map(([u, v]) => ({ u, v })) });
    const extra = h('input', { type: 'checkbox', onchange: reset });
    root.append(
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', onclick: step }, 'Шаг'),
        h('button', { class: 'btn', onclick: () => { while (step()); } }, 'До конца'),
        h('button', { class: 'btn', onclick: reset }, 'Сброс')),
      h('label', { class: 'toggle' }, extra, h('span', null, 'socket зависит от db — добавить ребро db → socket')),
      gv.svg);
    const qEl = h('div', { class: 'chips' }), outEl = h('div', { class: 'chips' });
    root.append(h('div', { class: 'row' }, h('span', { class: 'label' }, 'Очередь'), qEl), h('div', { class: 'row' }, h('span', { class: 'label' }, 'Порядок сборки'), outEl));
    const logEl = h('div', { class: 'log', 'aria-live': 'polite' });
    const say = logger(logEl);
    root.append(logEl);

    let indeg, queue, out, finished, hot;
    const active = () => EDGES.map((e, i) => [e, i]).filter(([, i]) => i !== EXTRA || extra.checked);
    function reset() {
      indeg = {}; NODES.forEach(n => { indeg[n.id] = 0; });
      active().forEach(([[, v]]) => indeg[v]++);
      queue = NODES.filter(n => indeg[n.id] === 0).map(n => n.id);
      out = []; finished = false; hot = new Set();
      gv.showEdge(EXTRA, extra.checked);
      say(`Посчитали входящие рёбра. Без зависимостей: ${queue.join(', ')} — они в очереди и могут собираться параллельно.`);
      render();
    }
    function step() {
      if (finished) return false;
      hot = new Set();
      if (!queue.length) {
        finished = true;
        if (out.length === NODES.length) {
          say(`Очередь пуста, вышли все ${NODES.length} вершин — порядок сборки готов. Каждая вершина и каждое ребро обработаны один раз: O(V + E).`, 'ok');
        } else {
          const left = NODES.filter(n => !out.includes(n.id)).map(n => n.id);
          say(`Очередь пуста, а вышло только ${out.length} из ${NODES.length}. У ${left.join(', ')} счётчик так и не стал нулём: они в цикле socket → driver → db → socket или зависят от него. Так пакетный менеджер и сообщает о циклической зависимости.`, 'bad');
        }
        render();
        return false;
      }
      const u = queue.shift();
      out.push(u);
      const msgs = [];
      active().forEach(([[a, v], i]) => {
        if (a !== u) return;
        hot.add(i);
        indeg[v]--;
        msgs.push(`${v}: ${indeg[v] + 1} → ${indeg[v]}${indeg[v] === 0 ? ' — в очередь' : ''}`);
        if (indeg[v] === 0) queue.push(v);
      });
      say(`Собираем <b>${u}</b>. ${msgs.length ? 'Уменьшаем счётчики: ' + msgs.join(', ') + '.' : 'От него никто не зависит.'}`);
      render();
      return true;
    }
    function render() {
      NODES.forEach(n => {
        gv.setNode(n.id, out.includes(n.id) ? 'done' : queue.includes(n.id) ? 'front' : finished ? 'bad' : '');
        gv.setBadge(n.id, out.includes(n.id) ? '' : String(indeg[n.id]));
      });
      EDGES.forEach((e, i) => gv.setEdge(i, (hot.has(i) ? 'hot' : out.includes(e[0]) ? 'dim' : '') + (i === EXTRA ? ' extra' : '')));
      qEl.innerHTML = queue.length ? queue.map(u => `<span class="chip top">${u}</span>`).join('') : '<span class="empty">пусто</span>';
      outEl.innerHTML = out.length ? out.map((u, i) => `<span class="chip ok">${i + 1}. ${u}</span>`).join('') : '<span class="empty">пока пусто</span>';
    }
    reset();
    return {};
  });
})();
